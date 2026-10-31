export const W = 72;
export const H = 16;
export const POOL_H = 2;

export type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  temp: number;
};

const HEAT = 0.9;
const COOL = 0.35;
const LIFT = 22;
const FLOAT_AT = 0.5;
const DRAG_X = 0.8;
const DRAG_Y = 1.5;
const WANDER = 6;

export function spawn(n: number): Blob[] {
  const blobs: Blob[] = [];
  for (let i = 0; i < n; i++) {
    const r = 2 + Math.floor(Math.random() * 3);
    blobs.push({
      x: ((i + 0.5) * W) / n,
      y: r + Math.random() * (H - 2 * r),
      vx: 0,
      vy: 0,
      r,
      temp: Math.random(),
    });
  }
  return blobs;
}

/** The heater warms blobs touching the pool; everything cools; warm blobs float. Bigger blobs change temperature slower. */
export function step(blobs: Blob[], dt: number): void {
  for (const b of blobs) {
    const mass = b.r / 3;
    if (b.y + b.r >= H - POOL_H) b.temp += (HEAT / mass) * dt;
    b.temp -= ((COOL * b.temp) / mass) * dt;
    b.vy += (FLOAT_AT - b.temp) * LIFT * dt;
    b.vx += (Math.random() - 0.5) * WANDER * dt;
    b.vx *= 1 - DRAG_X * dt;
    b.vy *= 1 - DRAG_Y * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < b.r) (b.x = b.r), (b.vx = Math.abs(b.vx));
    if (b.x > W - b.r) (b.x = W - b.r), (b.vx = -Math.abs(b.vx));
    if (b.y < b.r - 1) (b.y = b.r - 1), (b.vy = 0);
    if (b.y > H - b.r + 1) (b.y = H - b.r + 1), (b.vy = 0);
  }
}
