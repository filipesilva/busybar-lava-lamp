import manifest from "./appmeta/manifest.json";
import { loadValues } from "@shared/settings";
import { H, POOL_H, W, controls, pressPush, releasePush, spawn, step, type Blob } from "./lava";

const APP = manifest.id;
const DRAW_URL = `http://${__BUSY_ADDR__}/api/display/draw`;
const TICK_MS = 33;
const STATS_MS = 5000;
const ERROR_BACKOFF_MS = 1000;
const ERROR_BACKOFF_MAX_MS = 8000;

/** "version" in settings.json. */
const SETTINGS_VERSION = 3;
/** Defaults for the settings, as #RRGGBB. */
const BG = "#280000";
const FG = "#FF1800";
const GLOW_ALPHA = "40";
/** Opacity steps of the leading edge, which fades in so blobs move by less than a pixel. */
const EDGE_ALPHAS = ["00", "40", "80", "C0"];

/** A setting colour as #RRGGBB; our own opacity is appended when drawing. */
function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}/.test(value) ? value.slice(0, 7) : fallback;
}

function rect(id: string, x: number, y: number, w: number, h: number, radius: number, color: string, z: number): string {
  return `{"id":"${id}","type":"rectangle","x":${x},"y":${y},"width":${w},"height":${h},"radius":${radius},"fill":"solid","fill_colors":["${color}"],"border_width":0,"z_index":${z}}`;
}

/** Moving blobs stretch along their path, up to this much. */
const STRETCH_MAX = 0.4;
const STRETCH_SPEED = 12;
const GLOW = 2;

/** Last drawn x, core y, width, height, edge y and edge opacity step of each blob, so only changes are sent. */
const DRAWN = 6;
const drawn = new Int16Array(DRAWN * 16).fill(-1);

/**
 * Elements for blobs whose drawn shape changed since the last send: the core, its glow, and a copy one pixel ahead in the
 * direction of motion whose opacity follows the fractional position.
 */
function moved(blobs: Blob[], fg: string, out: string[]): void {
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    let s = (b.vy < 0 ? -b.vy : b.vy) / STRETCH_SPEED;
    if (s > STRETCH_MAX) s = STRETCH_MAX;
    const sq = b.squash;
    const w = (2 * b.r * (1 - 0.4 * s) * (1 + 0.6 * sq) + 0.5) | 0;
    const h = (2 * b.r * (1 + s) * (1 - 0.45 * sq) + 0.5) | 0;
    const x = (b.x - w / 2 + 0.5) | 0;
    // A squashed blob keeps its bottom on the floor.
    const top = sq > 0.05 ? b.y + b.r - h : b.y - h / 2;
    const floor = ((top + 32) | 0) - 32;
    const frac = top - floor;
    const down = b.vy >= 0;
    const y = down ? floor : floor + 1;
    const edgeY = down ? floor + 1 : floor;
    const q = ((down ? frac : 1 - frac) * EDGE_ALPHAS.length) | 0;

    const k = i * DRAWN;
    const core = drawn[k] !== x || drawn[k + 1] !== y || drawn[k + 2] !== w || drawn[k + 3] !== h;
    if (!core && drawn[k + 4] === edgeY && drawn[k + 5] === q) continue;
    drawn[k] = x;
    drawn[k + 1] = y;
    drawn[k + 2] = w;
    drawn[k + 3] = h;
    drawn[k + 4] = edgeY;
    drawn[k + 5] = q;
    const radius = (w < h ? w : h) >> 1;
    if (core) {
      out.push(rect(`b${i}`, x, y, w, h, radius, fg + "FF", 3));
      out.push(rect(`g${i}`, x - GLOW, y - GLOW, w + 2 * GLOW, h + 2 * GLOW, radius + GLOW, fg + GLOW_ALPHA, 2));
    }
    out.push(rect(`e${i}`, x, edgeY, w, h, radius, fg + EDGE_ALPHAS[q], 3));
  }
}

function main(): void {
  const report = (err: unknown) =>
    console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

  const blobs = spawn(6);
  const ctl = controls();
  let fg = FG;
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
    step(blobs, ctl, Math.min((start - last) / 1000, 0.1));
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

  void loadValues(APP, SETTINGS_VERSION)
    .catch((err) => {
      report(err);
      return null;
    })
    .then((values) => {
      if (stopped) return;
      fg = color(values?.foreground, FG);
      const bg = color(values?.background, BG);
      statics = [
        rect("bg", 0, 0, W, H, 0, bg + "FF", 0),
        rect("pool", 0, H - POOL_H, W, POOL_H, 0, fg + "FF", 3),
        rect("poolglow", 0, H - POOL_H - GLOW, W, GLOW, 0, fg + GLOW_ALPHA, 1),
      ];
      pending = statics.slice();
      last = Date.now();
      tick();
    });

  const unbind = listen("input", (event) => {
    if (stopped) return;
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
