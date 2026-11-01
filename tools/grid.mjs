// Usage: node tools/grid.mjs out.png columns in.png...
// Joins same-size images from tools/led.mjs into one, left to right and top to bottom, with no gaps. A short last
// row is centred; the space beside it is filled with the colour between the LEDs.
import { writeFileSync } from "node:fs";
import { GAP, png, readPng } from "./led.mjs";

const [out, columns, ...files] = process.argv.slice(2);
if (!out || !Number(columns) || files.length === 0) {
  console.error("Usage: node tools/grid.mjs out.png columns in.png...");
  process.exit(1);
}
const cols = Math.min(Number(columns), files.length), rows = Math.ceil(files.length / cols);
const tiles = files.map(readPng);
const { w, h } = tiles[0];
if (tiles.some((t) => t.w !== w || t.h !== h)) throw new Error("images differ in size");
const W = cols * w, H = rows * h, rgb = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) rgb.set(GAP, i * 3);
tiles.forEach((t, i) => {
  const r = Math.floor(i / cols), inRow = r < rows - 1 ? cols : files.length - r * cols;
  const x0 = ((i % cols) * w) + ((cols - inRow) * w) / 2;
  for (let y = 0; y < h; y++) t.rgb.copy(rgb, ((r * h + y) * W + x0) * 3, y * w * 3, (y + 1) * w * 3);
});
writeFileSync(out, png({ w: W, h: H, rgb }));
