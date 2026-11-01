// Usage: node tools/icons.mjs
// Draws the app icons into src/appmeta: two blobs pinching apart, shaded like the lava (dark top, bright bottom).
// The front icon is 8×8 colour, the back icon 11×11 greyscale, both RGBA PNG.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

/** Centres and radii as fractions of the icon size, so the same shape draws at any size. */
const BLOBS = [
  { x: 0.34, y: 0.34, r: 0.23 },
  { x: 0.72, y: 0.72, r: 0.16 },
];
/** Metaball field level of the surface; above 1 pulls the blobs apart into a neck. */
const SURFACE = 1.15;
/** Pixels less covered than this are left out, so edges stay crisp on the LEDs. */
const MIN_COVER = 0.25;
const SAMPLES = 6;

const field = (blobs, x, y) => blobs.reduce((f, b) => f + (b.r * b.r) / ((x - b.x) ** 2 + (y - b.y) ** 2), 0);

/** The blobs moved so their outline sits in the middle of the icon. */
function centred(blobs) {
  const N = 200;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N, y = (j + 0.5) / N;
      if (field(blobs, x, y) < SURFACE) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  const dx = 0.5 - (x0 + x1) / 2, dy = 0.5 - (y0 + y1) / 2;
  return blobs.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy }));
}

/** n×n RGBA pixels, each coloured from `top` to `bottom` down the blob that owns it, with alpha from its coverage. */
function draw(n, top, bottom) {
  const blobs = centred(BLOBS);
  const out = Buffer.alloc(n * n * 4);
  for (let py = 0; py < n; py++)
    for (let px = 0; px < n; px++) {
      let cover = 0, shade = 0;
      for (let sy = 0; sy < SAMPLES; sy++)
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / n, y = (py + (sy + 0.5) / SAMPLES) / n;
          if (field(blobs, x, y) < SURFACE) continue;
          let owner = blobs[0], best = 0;
          for (const b of blobs) {
            const g = (b.r * b.r) / ((x - b.x) ** 2 + (y - b.y) ** 2);
            if (g > best) (best = g), (owner = b);
          }
          cover++;
          shade += Math.min(1, Math.max(0, (y - owner.y + owner.r) / (2 * owner.r)));
        }
      if (cover < MIN_COVER * SAMPLES * SAMPLES) continue;
      const t = shade / cover, i = (py * n + px) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(top[c] + (bottom[c] - top[c]) * t);
      out[i + 3] = Math.round((255 * cover) / (SAMPLES * SAMPLES));
    }
  return out;
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
function png(n, rgba) {
  const raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) rgba.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// The lava red of the app, and its top shaded by the app's SHADE of 0.4.
writeFileSync("src/appmeta/icon_front_8x8.png", png(8, draw(8, [0x99, 0x0e, 0x00], [0xff, 0x18, 0x00])));
writeFileSync("src/appmeta/icon_back_11x11.png", png(11, draw(11, [0x50, 0x50, 0x50], [0xff, 0xff, 0xff])));
