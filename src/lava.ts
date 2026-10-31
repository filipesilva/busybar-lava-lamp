export const W = 72;
export const H = 16;
export const POOL_H = 2;

export type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 once merged into another blob; the slot can be reused by a split. */
  r: number;
  temp: number;
  /** 0..1, how flat the blob is pressed against the bottom. */
  squash: number;
  /** Still joined to the pool by a neck. */
  attached: boolean;
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
const COOL_TOP = 3;
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
/** How fast cold wax in the pool slumps flat; at 2 it stays flat until half way to floating again. */
const SLUMP = 2;
const SLUMP_MAX = 0.8;
const SLUMP_EASE = 10;

const SHEAR_STEP = 0.25;
const SHEAR_FORCE = 80;
const SHEAR_RELEASE = 1.5;

/** Gap between a blob and the pool, in pixels, at which its neck snaps. */
export const NECK_MAX = 4;
const NECK_PULL = 1.5;
/** Blobs closer than this fraction of their summed radii touch: they merge if moving together, and bump apart if not. */
const MERGE_AT = 0.85;
const MERGE_DV = 8;
/** Wax is sticky: blobs within this fraction of their summed radii pull together. */
const REACH = 1.6;
const COHESION = 15;
const SPREAD = 40;
const R_MAX = 5;
/** A blob this big leaves part of its wax in the pool when it breaks away. */
const R_SPLIT = 3.5;
const SPLIT_KEEP = 0.4;

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
      attached: false,
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
 * Blobs rise from the pool on a neck that stretches and snaps, merge when they meet, and spread out along the pool.
 */
export function step(blobs: Blob[], c: Controls, dt: number): void {
  c.push += ((c.pushing ? 1 : 0) - c.push) * (c.pushing ? PUSH_ATTACK : PUSH_RELEASE) * dt;
  if (c.push < 0.01) c.push = 0;
  c.shear -= c.shear * SHEAR_RELEASE * dt;
  if (c.shear > -0.01 && c.shear < 0.01) c.shear = 0;

  for (const b of blobs) {
    if (b.r === 0) continue;
    const mass = b.r / 3;
    if (c.heating && b.attached) {
      // The heater sits under the middle, so the sides warm slower.
      const d = (2 * b.x) / W - 1;
      b.temp += ((HEAT * (1 - HEAT_SIDES * d * d)) / mass) * dt;
    }
    let cool = c.heating ? COOL : COOL * COOL_OFF;
    // The top of the lamp is its coolest part.
    if (b.y <= b.r - 1) cool *= COOL_TOP;
    b.temp -= ((cool * b.temp) / mass) * dt;
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

    const gap = H - POOL_H - b.y - b.r;
    if (!b.attached) b.attached = gap <= 0;
    else if (gap > NECK_MAX) {
      b.attached = false;
      split(blobs, b);
    } else if (gap > 0) b.vy += (NECK_PULL * gap * dt) / mass;
    else {
      // Cold wax slumps flat as it sinks into the pool, fully once its centre reaches the surface; it domes up again as it warms.
      let slump = SLUMP * (1 - b.temp / FLOAT_AT);
      if (slump > SLUMP_MAX) slump = SLUMP_MAX;
      const depth = -gap / b.r;
      slump *= depth < 1 ? depth : 1;
      if (slump > b.squash) b.squash = slump;
    }

    b.vx *= 1 - DRAG_X * dt;
    b.vy *= 1 - DRAG_Y * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < b.r) (b.x = b.r), (b.vx = Math.abs(b.vx));
    if (b.x > W - b.r) (b.x = W - b.r), (b.vx = -Math.abs(b.vx));
    if (b.y <= b.r - 1) {
      b.y = b.r - 1;
      if (b.vy < 0) b.vy = 0;
      // Hot wax pressed against the top slumps flat too, and rounds up again as it cools.
      let slump = SLUMP * (b.temp / FLOAT_AT - 1);
      if (slump > SLUMP_MAX) slump = SLUMP_MAX;
      if (slump > b.squash) b.squash += (slump - b.squash) * SLUMP_EASE * dt;
    }

    // Blobs rest with their bottom just below the screen, or sink until their centre reaches the pool surface.
    let floor = H - b.r + 1;
    if (floor < H - POOL_H) floor = H - POOL_H;
    if (b.y >= floor) {
      b.y = floor;
      if (b.vy > 0) b.vy = 0;
      if (pressed > b.squash) b.squash = pressed;
    }
    b.squash -= b.squash * SQUASH_RELAX * dt;
  }
  meet(blobs, dt);
}

/** A big blob breaking away from the pool leaves some of its wax behind, as a new blob. */
function split(blobs: Blob[], b: Blob): void {
  if (b.r < R_SPLIT) return;
  let rest: Blob | undefined;
  for (const o of blobs) if (o.r === 0) rest = o;
  if (!rest) return;
  const area = b.r * b.r;
  b.r = Math.sqrt(area * (1 - SPLIT_KEEP));
  rest.r = Math.sqrt(area * SPLIT_KEEP);
  // Beside it, not under it: they cannot share the same space, and should not follow each other up the same path.
  rest.x = b.x + (Math.random() < 0.5 ? -1 : 1) * (b.r + rest.r);
  rest.y = H - rest.r + 1;
  rest.vx = rest.vy = 0;
  rest.temp = b.temp / 2;
  rest.squash = 0;
  rest.attached = true;
}

/**
 * Blobs on the same side of the pool surface meet. In the air wax is sticky: nearby blobs pull together and merge once
 * they overlap and move together. At the pool and against the top it spreads out sideways. Blobs too big to merge, that
 * meet too fast, or that meet one pressed against the top, push each other away, as surface tension keeps them apart.
 */
function meet(blobs: Blob[], dt: number): void {
  for (let i = 0; i < blobs.length; i++) {
    const a = blobs[i];
    if (a.r === 0) continue;
    for (let j = i + 1; j < blobs.length; j++) {
      const b = blobs[j];
      if (b.r === 0 || a.attached !== b.attached) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      const reach = (a.r + b.r) * REACH;
      if (d2 > reach * reach || d2 === 0) continue;
      const wa = a.r * a.r;
      const wb = b.r * b.r;
      const w = wa + wb;
      const d = Math.sqrt(d2);

      const topA = a.y <= a.r - 1;
      const topB = b.y <= b.r - 1;
      const touching = d <= (a.r + b.r) * MERGE_AT;
      const dvx = a.vx - b.vx;
      const dvy = a.vy - b.vy;
      const fast = dvx * dvx + dvy * dvy > MERGE_DV * MERGE_DV;
      if (a.attached || topA || topB || w > R_MAX * R_MAX || (touching && fast)) {
        const f = (SPREAD * dt * (1 - d / reach)) / d;
        const fy = a.attached || (topA && topB) ? 0 : f;
        a.vx += (dx * f * 3) / a.r;
        a.vy += (dy * fy * 3) / a.r;
        b.vx -= (dx * f * 3) / b.r;
        b.vy -= (dy * fy * 3) / b.r;
        continue;
      }

      if (!touching) {
        const f = (COHESION * dt) / d;
        a.vx -= (dx * f * 3) / a.r;
        a.vy -= (dy * f * 3) / a.r;
        b.vx += (dx * f * 3) / b.r;
        b.vy += (dy * f * 3) / b.r;
        continue;
      }
      a.x = (a.x * wa + b.x * wb) / w;
      a.y = (a.y * wa + b.y * wb) / w;
      a.vx = (a.vx * wa + b.vx * wb) / w;
      a.vy = (a.vy * wa + b.vy * wb) / w;
      a.temp = (a.temp * wa + b.temp * wb) / w;
      a.squash = a.squash > b.squash ? a.squash : b.squash;
      a.r = Math.sqrt(w);
      b.r = 0;
    }
  }
}
