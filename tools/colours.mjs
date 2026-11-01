// Usage: node tools/colours.mjs outdir [candidates=3]
// For the README colour grids: runs the app on the bar with each lava colour on the default background, and each
// background with the default lava, at Normal speed. Saves a few LED frames of each, `lava-<name>-<i>.png` and
// `background-<name>-<i>.png`, plus `sheet.png` with every candidate at half size to choose from. Copy the chosen ones
// into media/colours/ without the `-<i>`, then rebuild the grids with tools/grid.mjs. The app's settings are put back at the end.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { frame, led, png } from "./led.mjs";

const B = `http://${process.env.BUSY_ADDR ?? "10.0.4.20"}`;
const APP = "io.filipesilva.lava-lamp";
const [out, n = "3"] = process.argv.slice(2);
if (!out) {
  console.error("Usage: node tools/colours.mjs outdir [candidates=3]");
  process.exit(1);
}
const candidates = Number(n);
const settings = JSON.parse(readFileSync(new URL("../src/appmeta/settings.json", import.meta.url), "utf8"));
const { foreground, background } = settings.fields;
const slug = (label) => label.toLowerCase().replace(/ /g, "-");
const runs = [
  ...foreground.options.map((o) => ({ name: `lava-${slug(o.label)}`, fg: o.value, bg: background.default })),
  ...background.options.map((o) => ({ name: `background-${slug(o.label)}`, fg: foreground.default, bg: o.value })),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, body) => {
  const res = await fetch(B + path, { method, body: body && JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res;
};
const put = (values) => call("PUT", `/api/apps/settings?app_id=${APP}`, { version: settings.version, values });
const restart = async () => {
  await call("POST", "/api/apps/quit").catch(() => {});
  await sleep(1000);
  await call("POST", `/api/apps/launch?app_id=${APP}`);
};

mkdirSync(out, { recursive: true });
const saved = await (await call("GET", `/api/apps/settings?app_id=${APP}`)).json();
const shots = [];
try {
  for (const r of runs) {
    await put({ foreground: r.fg, background: r.bg, speed: "0.4" });
    await restart();
    // Long enough for the blobs to leave their random start and form necks.
    await sleep(30000);
    const row = [];
    for (let i = 0; i < candidates; i++) {
      const im = led(await frame());
      writeFileSync(`${out}/${r.name}-${i}.png`, png(im));
      row.push(im);
      await sleep(5000);
    }
    shots.push(row);
    console.log(r.name);
  }
} finally {
  await put(saved.values);
  await restart();
}

// Every candidate at half size, one row per run.
const { w, h } = shots[0][0], tw = w / 2, th = h / 2, gap = 4;
const W = candidates * tw + (candidates - 1) * gap, H = shots.length * th + (shots.length - 1) * gap;
const rgb = Buffer.alloc(W * H * 3, 255);
shots.forEach((row, r) =>
  row.forEach((im, c) => {
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++)
        for (let k = 0; k < 3; k++) {
          const at = (dy, dx) => im.rgb[((2 * y + dy) * w + 2 * x + dx) * 3 + k];
          rgb[((r * (th + gap) + y) * W + c * (tw + gap) + x) * 3 + k] = (at(0, 0) + at(0, 1) + at(1, 0) + at(1, 1)) >> 2;
        }
  }),
);
writeFileSync(`${out}/sheet.png`, png({ w: W, h: H, rgb }));
