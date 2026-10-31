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
  /** The heater under the pool is on. */
  heating: boolean;
  /** The big button is held down. */
  pushing: boolean;
  /** 0..1, how hard the button presses on the lava; follows `pushing` with some lag. */
  push: number;
  /** -1..1, how hard the dial drags the top of the lava; positive drags it right. */
  shear: number;
};

const HEAT = 0.9;
const HEAT_SIDES = 0.6;
const COOL = 0.35;
/** With the heater off the whole lamp cools, much faster than a real one. */
const COOL_OFF = 3;
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

const SHEAR_STEP = 0.25;
const SHEAR_FORCE = 80;
const SHEAR_RELEASE = 1.5;

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
  return { heating: true, pushing: false, push: 0, shear: 0 };
}

/** The big button went down: even a quick tap gives a visible shove. */
export function pressPush(c: Controls): void {
  c.pushing = true;
  if (c.push < PUSH_TAP) c.push = PUSH_TAP;
}

export function releasePush(c: Controls): void {
  c.pushing = false;
}

/** One click of the dial; clockwise is positive. */
export function turnDial(c: Controls, delta: number): void {
  c.shear += delta * SHEAR_STEP;
  if (c.shear > 1) c.shear = 1;
  else if (c.shear < -1) c.shear = -1;
}

/**
 * The heater warms blobs touching the pool; everything cools; warm blobs float. Bigger blobs change temperature slower.
 * The big button pushes blobs under it down and aside, and squashes those already at the bottom.
 * The dial drags the top of the lava sideways; in the closed lamp it comes back along the bottom, as one big eddy.
 */
export function step(blobs: Blob[], c: Controls, dt: number): void {
  c.push += ((c.pushing ? 1 : 0) - c.push) * (c.pushing ? PUSH_ATTACK : PUSH_RELEASE) * dt;
  if (c.push < 0.01) c.push = 0;
  c.shear -= c.shear * SHEAR_RELEASE * dt;
  if (c.shear > -0.01 && c.shear < 0.01) c.shear = 0;

  for (const b of blobs) {
    const mass = b.r / 3;
    if (c.heating && b.y + b.r >= H - POOL_H) {
      // The heater sits under the middle, so the sides warm slower.
      const d = (2 * b.x) / W - 1;
      b.temp += ((HEAT * (1 - HEAT_SIDES * d * d)) / mass) * dt;
    }
    b.temp -= (((c.heating ? COOL : COOL * COOL_OFF) * b.temp) / mass) * dt;
    b.vy += (FLOAT_AT - b.temp) * LIFT * dt;
    b.vx += (Math.random() - 0.5) * WANDER * dt;

    let pressed = 0;
    if (c.push > 0) {
      const d = (b.x - PUSH_X) / PUSH_SPREAD;
      pressed = c.push / (1 + d * d);
      b.vy += (pressed * PUSH_DOWN * dt) / mass;
      b.vx += (pressed * PUSH_OUT * (d < 0 ? -1 : 1) * dt) / mass;
    }

    if (c.shear !== 0) {
      const ax = (Math.PI * b.x) / W;
      const ay = (Math.PI * b.y) / H;
      const f = (c.shear * SHEAR_FORCE * dt) / mass;
      b.vx += f * Math.sin(ax) * Math.cos(ay);
      b.vy -= ((f * H) / W) * Math.cos(ax) * Math.sin(ay);
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
