// Usage: node tools/led.mjs out.png
// Grabs one front-screen frame and draws it as round LEDs, like the bar's web dashboard. Also a module for other tools.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const ADDR = process.env.BUSY_ADDR ?? "10.0.4.20";
const W = 72, H = 16;
/** Pixels per LED, dot radius, and the colours of an unlit LED and of the gaps. */
const S = 12, R = 0.42 * S, OFF = [22, 22, 22];
export const GAP = [8, 8, 8];

/** One raw front-screen frame: 72×16 BGR. */
export async function frame() {
  const res = await fetch(`http://${ADDR}/api/screen?display=0`);
  return Buffer.from(await res.text(), "base64");
}

/** A frame drawn as dots, with a margin of one LED. */
export function led(bgr) {
  const w = (W + 2) * S, h = (H + 2) * S, rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = Math.floor(x / S) - 1, py = Math.floor(y / S) - 1;
      let c = GAP;
      if (px >= 0 && px < W && py >= 0 && py < H) {
        const s = (py * W + px) * 3;
        const on = [bgr[s + 2], bgr[s + 1], bgr[s]];
        const lit = on[0] + on[1] + on[2] > 0 ? on : OFF;
        let k = 0;
        for (let sy = 0; sy < 4; sy++)
          for (let sx = 0; sx < 4; sx++) {
            const fx = x + (sx + 0.5) / 4 - (px + 1.5) * S, fy = y + (sy + 0.5) / 4 - (py + 1.5) * S;
            if (fx * fx + fy * fy <= R * R) k++;
          }
        c = GAP.map((g, i) => Math.round(g + ((lit[i] - g) * k) / 16));
      }
      rgb.set(c, (y * w + x) * 3);
    }
  return { w, h, rgb };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

/** An RGB image as PNG bytes. */
export function png({ w, h, rgb }) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Reads a PNG written by `png()`: RGB, 8 bits, no filters. */
export function readPng(file) {
  const d = readFileSync(file);
  let i = 8, w = 0, h = 0;
  const idat = [];
  while (i < d.length) {
    const n = d.readUInt32BE(i), type = d.toString("ascii", i + 4, i + 8);
    if (type === "IHDR") (w = d.readUInt32BE(i + 8)), (h = d.readUInt32BE(i + 12));
    if (type === "IDAT") idat.push(d.subarray(i + 8, i + 8 + n));
    i += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat)), rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) raw.copy(rgb, y * w * 3, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  return { w, h, rgb };
}

if (import.meta.main) {
  if (!process.argv[2]) {
    console.error("Usage: node tools/led.mjs out.png");
    process.exit(1);
  }
  writeFileSync(process.argv[2], png(led(await frame())));
}
