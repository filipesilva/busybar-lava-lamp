import manifest from "./appmeta/manifest.json";
import { loadValues } from "@shared/settings";
import { H, NECK_MAX, POOL_H, W, controls, pressPush, releasePush, spawn, step, turnDial, type Blob } from "./lava";

const APP = manifest.id;
const DRAW_URL = `http://${__BUSY_ADDR__}/api/display/draw`;
const TICK_MS = 33;
const STATS_MS = 5000;
const ERROR_BACKOFF_MS = 1000;
const ERROR_BACKOFF_MAX_MS = 8000;

/** "version" in settings.json. */
const SETTINGS_VERSION = 3;
/** Defaults for the settings, as #RRGGBB. */
const BG = "#000000";
const FG = "#FF1800";
const SPEED = 0.4;
const GLOW_ALPHA = "40";
/** The lamp is lit from below: the background gets this much of the lava colour at the bottom. */
const LIT = 0.5;
/** Rows where the background bands start; each band is a linear gradient, together they fade like light from a bulb. */
const BANDS = [0, 6, 11, H];

/** A setting colour as #RRGGBB; our own opacity is appended when drawing. */
function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}/.test(value) ? value.slice(0, 7) : fallback;
}

/** `a` moved towards `b` by `t`, both as #RRGGBB. */
function mix(a: string, b: string, t: number): string {
  let out = "#";
  for (let i = 1; i < 7; i += 2) {
    const ca = parseInt(a.slice(i, i + 2), 16);
    const cb = parseInt(b.slice(i, i + 2), 16);
    out += (0x100 + Math.round(ca + (cb - ca) * t)).toString(16).slice(1);
  }
  return out;
}

function rect(id: string, x: number, y: number, w: number, h: number, radius: number, color: string, z: number): string {
  return `{"id":"${id}","type":"rectangle","x":${x},"y":${y},"width":${w},"height":${h},"radius":${radius},"fill":"solid","fill_colors":["${color}"],"border_width":0,"z_index":${z}}`;
}

function background(bg: string, fg: string): string[] {
  const shade = (y: number) => mix(bg, fg, LIT * (y / (H - 1)) ** 2);
  const out: string[] = [];
  for (let i = 0; i + 1 < BANDS.length; i++) {
    const y = BANDS[i];
    const h = BANDS[i + 1] - y;
    out.push(
      `{"id":"bg${i}","type":"rectangle","x":0,"y":${y},"width":${W},"height":${h},"radius":0,"fill":"gradient_v","fill_colors":["${shade(y)}FF","${shade(y + h - 1)}FF"],"border_width":0,"z_index":0}`,
    );
  }
  return out;
}

/** Moving blobs stretch along their path, up to this much. */
const STRETCH_MAX = 0.4;
const STRETCH_SPEED = 12;
/** Sideways drift slower than this does not stretch. */
const DRIFT = 5;
const GLOW = 2;

/** A blob still joined to the pool stretches down to it, and narrows by up to this much before it snaps. */
const NECK_THIN = 0.3;

/** Last drawn x, y, width and height of each blob (width 0 when hidden), so only changes are sent. */
const DRAWN = 4;
const drawn = new Int16Array(DRAWN * 16).fill(-1);

function changed(k: number, x: number, y: number, w: number, h: number): boolean {
  if (drawn[k] === x && drawn[k + 1] === y && drawn[k + 2] === w && drawn[k + 3] === h) return false;
  drawn[k] = x;
  drawn[k + 1] = y;
  drawn[k + 2] = w;
  drawn[k + 3] = h;
  return true;
}

function hidden(id: string, z: number): string {
  return rect(id, 0, 0, 1, 1, 0, "#00000000", z);
}

/** Elements for blobs whose drawn shape changed since the last send: the core and its glow. */
function moved(blobs: Blob[], fg: string, out: string[]): void {
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const k = i * DRAWN;
    let x = 0;
    let y = 0;
    let w = 0;
    let h = 0;
    if (b.r > 0) {
      const gap = H - POOL_H - b.y - b.r;
      const neck = b.attached && gap > 0 ? 1 - (NECK_THIN * gap) / NECK_MAX : 1;
      // A blob on a neck is shaped by the neck, not by its speed.
      let s = neck < 1 ? 0 : (b.vy < 0 ? -b.vy : b.vy) / STRETCH_SPEED;
      if (s > STRETCH_MAX) s = STRETCH_MAX;
      let sx = ((b.vx < 0 ? -b.vx : b.vx) - DRIFT) / STRETCH_SPEED;
      if (sx < 0) sx = 0;
      else if (sx > STRETCH_MAX) sx = STRETCH_MAX;
      const sq = b.squash;
      w = (2 * b.r * neck * (1 + sx) * (1 - 0.4 * s) * (1 + 0.6 * sq) + 0.5) | 0;
      h = (2 * b.r * (1 + s) * (1 - 0.4 * sx) * (1 - 0.45 * sq) + 0.5) | 0;
      x = (b.x - w / 2 + 0.5) | 0;
      // A squashed blob keeps its bottom on the floor.
      const top = sq > 0.05 ? b.y + b.r - h : b.y - h / 2;
      y = ((top + 32.5) | 0) - 32;
      if (neck < 1) h = H - POOL_H + 1 - y;
    }
    if (changed(k, x, y, w, h)) {
      if (w === 0) out.push(hidden(`b${i}`, 3), hidden(`g${i}`, 2));
      else {
        const radius = (w < h ? w : h) >> 1;
        out.push(rect(`b${i}`, x, y, w, h, radius, fg + "FF", 3));
        out.push(rect(`g${i}`, x - GLOW, y - GLOW, w + 2 * GLOW, h + 2 * GLOW, radius + GLOW, fg + GLOW_ALPHA, 2));
      }
    }
  }
}

function main(): void {
  const report = (err: unknown) =>
    console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

  const blobs = spawn(6);
  const ctl = controls();
  let fg = FG;
  let speed = SPEED;
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = Date.now();
  /** Elements drawn once: background and pool. */
  let statics: string[] = [];
  let pending: string[] = [];
  let backoff = 0;

  let ticks = 0;
  let sends = 0;
  let sent = 0;
  let computeMs = 0;
  let drawMs = 0;
  let statsAt = last;

  function send(elements: string[]): void {
    inFlight = true;
    const start = Date.now();
    sends++;
    sent += elements.length;
    fetch(DRAW_URL, {
      method: "POST",
      body: `{"application_name":"${APP}","priority":50,"elements":[${elements.join(",")}]}`,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`draw HTTP ${res.status}`);
        backoff = 0;
        return 0;
      })
      .catch((err) => {
        // The screen may be held by a higher priority app, e.g. right after launch or during a BUSY session: redraw everything once it is back.
        report(err);
        backoff = backoff ? Math.min(backoff * 2, ERROR_BACKOFF_MAX_MS) : ERROR_BACKOFF_MS;
        pending = statics.slice();
        drawn.fill(-1);
        return backoff;
      })
      .then((delay) => {
        drawMs += Date.now() - start;
        inFlight = false;
        if (delay && !stopped) {
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(tick, delay);
        }
      });
  }

  function tick(): void {
    timer = undefined;
    if (stopped) return;
    const start = Date.now();
    step(blobs, ctl, Math.min(((start - last) / 1000) * speed, 0.15));
    last = start;
    if (!inFlight) {
      moved(blobs, fg, pending);
      if (pending.length > 0) {
        send(pending);
        pending = [];
      }
    }
    const end = Date.now();
    computeMs += end - start;
    ticks++;
    if (end - statsAt >= STATS_MS) {
      const secs = (end - statsAt) / 1000;
      console.info(
        `${APP}: ${(sends / secs).toFixed(1)} draws/s, ${(sent / Math.max(sends, 1)).toFixed(1)} el/draw, ` +
          `${(ticks / secs).toFixed(1)} ticks/s, tick ${(computeMs / ticks).toFixed(1)} ms, draw ${(drawMs / Math.max(sends, 1)).toFixed(1)} ms`,
      );
      ticks = sends = sent = computeMs = drawMs = 0;
      statsAt = end;
    }
    if (timer === undefined) timer = setTimeout(tick, Math.max(0, TICK_MS - (end - start)));
  }

  /** The heater glows through the pool while it is on. */
  const poolGlow = () =>
    rect("poolglow", 0, H - POOL_H - GLOW, W, GLOW, 0, fg + (ctl.heating ? GLOW_ALPHA : "00"), 1);

  void loadValues(APP, SETTINGS_VERSION)
    .catch((err) => {
      report(err);
      return null;
    })
    .then((values) => {
      if (stopped) return;
      fg = color(values?.foreground, FG);
      const bg = color(values?.background, BG);
      speed = Number(values?.speed) || SPEED;
      statics = [
        ...background(bg, fg),
        rect("pool", 0, H - POOL_H, W, POOL_H, 0, fg + "FF", 3),
        poolGlow(),
      ];
      pending = statics.slice();
      last = Date.now();
      tick();
    });

  const unbind = listen("input", (event) => {
    if (stopped) return;
    if (event.key === "encoder") {
      turnDial(ctl, event.delta);
      return;
    }
    if (event.key === "ok") {
      if (event.action !== "short") return;
      ctl.heating = !ctl.heating;
      if (statics.length > 0) {
        statics[statics.length - 1] = poolGlow();
        pending.push(statics[statics.length - 1]);
      }
      return;
    }
    if (event.key === "start") {
      // The press and release edges matter here: the lava is pushed for as long as the button is held.
      if (event.action === "press") pressPush(ctl);
      else if (event.action === "release") releasePush(ctl);
      return;
    }
    if (event.key !== "back" || event.action !== "short") return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    setTimeout(unbind, 0);
  });
}

main();
