// Usage: node tools/gif.mjs out.gif seconds [hz=15]
// Records the front screen as an animated GIF with the LED look of tools/led.mjs, at the real speed. Polls the screen
// at `hz` and keeps each new frame with its time; 15 Hz catches nearly every draw without slowing the app. Needs ffmpeg.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frame, led, png } from "./led.mjs";

const [out, secondsArg, hzArg = "15"] = process.argv.slice(2);
if (!out || !Number(secondsArg)) {
  console.error("Usage: node tools/gif.mjs out.gif seconds [hz=15]");
  process.exit(1);
}
const seconds = Number(secondsArg), hz = Number(hzArg);

const frames = [];
let last;
const t0 = Date.now();
while (Date.now() - t0 < seconds * 1000) {
  const start = Date.now();
  const f = await frame();
  if (!last || !f.equals(last)) frames.push({ t: start - t0, f });
  last = f;
  await new Promise((r) => setTimeout(r, Math.max(0, 1000 / hz - (Date.now() - start))));
}

const dir = mkdtempSync(join(tmpdir(), "lava-gif-"));
try {
  let list = "";
  frames.forEach(({ t, f }, i) => {
    const name = `${String(i).padStart(4, "0")}.png`;
    writeFileSync(join(dir, name), png(led(f)));
    const next = i + 1 < frames.length ? frames[i + 1].t : seconds * 1000;
    list += `file '${name}'\nduration ${((next - t) / 1000).toFixed(3)}\n`;
  });
  // The concat demuxer only applies the last duration if the last file is listed again.
  list += `file '${String(frames.length - 1).padStart(4, "0")}.png'\n`;
  writeFileSync(join(dir, "list.txt"), list);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
    "-vf", "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
    "-fps_mode", "passthrough", "-loop", "0", out,
  ]);
  console.log(`${frames.length} frames, ${(frames.length / seconds).toFixed(1)}/s`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
