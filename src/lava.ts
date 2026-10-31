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
  /** 0..1, how flat the blob is pressed against the bottom. */
  squash: number;
};

/** What the user is doing to the lava. */
export type Controls = {
  /** The big button is held down. */
  pushing: boolean;
  /** 0..1, how hard the button presses on the lava; follows `pushing` with some lag. */
  push: number;
};

const HEAT = 0.9;
const COOL = 0.35;
const LIFT = 22;
const FLOAT_AT = 0.5;
const DRAG_X = 0.8;
const DRAG_Y = 1.5;
const WANDER = 6;

/** The big button sits on top of the bar, over the middle of the screen. */
const PUSH_X = W / 2;
const PUSH_SPREAD = 14;
const PUSH_DOWN = 70;
const PUSH_OUT = 10;
const PUSH_TAP = 0.6;
const PUSH_ATTACK = 6;
const PUSH_RELEASE = 4;
const SQUASH_RELAX = 3;

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
      squash: 0,
    });
  }
  return blobs;
}

export function controls(): Controls {
  return { pushing: false, push: 0 };
}

/** The big button went down: even a quick tap gives a visible shove. */
export function pressPush(c: Controls): void {
  c.pushing = true;
  if (c.push < PUSH_TAP) c.push = PUSH_TAP;
}

export function releasePush(c: Controls): void {
  c.pushing = false;
}

/**
 * The heater warms blobs touching the pool; everything cools; warm blobs float. Bigger blobs change temperature slower.
 * The big button pushes blobs under it down and aside, and squashes those already at the bottom.
 */
export function step(blobs: Blob[], c: Controls, dt: number): void {
  c.push += ((c.pushing ? 1 : 0) - c.push) * (c.pushing ? PUSH_ATTACK : PUSH_RELEASE) * dt;
  if (c.push < 0.01) c.push = 0;

  for (const b of blobs) {
    const mass = b.r / 3;
    if (b.y + b.r >= H - POOL_H) b.temp += (HEAT / mass) * dt;
    b.temp -= ((COOL * b.temp) / mass) * dt;
    b.vy += (FLOAT_AT - b.temp) * LIFT * dt;
    b.vx += (Math.random() - 0.5) * WANDER * dt;

    let pressed = 0;
    if (c.push > 0) {
      const d = (b.x - PUSH_X) / PUSH_SPREAD;
      pressed = c.push / (1 + d * d);
      b.vy += (pressed * PUSH_DOWN * dt) / mass;
      b.vx += (pressed * PUSH_OUT * (d < 0 ? -1 : 1) * dt) / mass;
    }

    b.vx *= 1 - DRAG_X * dt;
    b.vy *= 1 - DRAG_Y * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < b.r) (b.x = b.r), (b.vx = Math.abs(b.vx));
    if (b.x > W - b.r) (b.x = W - b.r), (b.vx = -Math.abs(b.vx));
    if (b.y < b.r - 1) (b.y = b.r - 1), (b.vy = 0);

    const floor = H - b.r + 1;
    if (b.y >= floor) {
      b.y = floor;
      if (b.vy > 0) b.vy = 0;
      if (pressed > b.squash) b.squash = pressed;
    }
    b.squash -= b.squash * SQUASH_RELAX * dt;
  }
}
