// Usage: node tools/sheet.mjs out.png [frames=8] [interval_ms=500] [scale=6]
// Grabs several front-screen frames and writes them stacked in one upscaled PNG, with a gap between frames.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const [out, nArg, msArg, scaleArg] = process.argv.slice(2);
const n = Number(nArg ?? 8), ms = Number(msArg ?? 500), scale = Number(scaleArg ?? 6);
const W = 72, H = 16, GAP = 1;
const ADDR = process.env.BUSY_ADDR ?? "10.0.4.20";
const frames = [];
for (let i = 0; i < n; i++) {
  const t = Date.now();
  const res = await fetch(`http://${ADDR}/api/screen?display=0`);
  frames.push(Buffer.from(await res.text(), "base64"));
  await new Promise((r) => setTimeout(r, Math.max(0, ms - (Date.now() - t))));
}
const FH = H + GAP;
const w = W * scale, h = (FH * n - GAP) * scale;
const raw = Buffer.alloc((w * 3 + 1) * h, 255);
for (let y = 0; y < h; y++) {
  const row = y * (w * 3 + 1);
  raw[row] = 0;
  const fy = Math.floor(y / scale), f = Math.floor(fy / FH), py = fy % FH;
  if (py >= H) continue;
  const bgr = frames[f];
  for (let x = 0; x < w; x++) {
    const s = (py * W + Math.floor(x / scale)) * 3;
    const d = row + 1 + x * 3;
    raw[d] = bgr[s + 2]; raw[d + 1] = bgr[s + 1]; raw[d + 2] = bgr[s];
  }
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
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8; ihdr[9] = 2;

writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]));
