// Runs the lava physics (src/lava.ts) on the computer at the bar's tick rate and Normal speed, and prints numbers, so
// physics changes can be tuned before trying them on the bar. Times are in real seconds.
//
// Usage: node tools/sim.ts <check> [runs]
//   life    per run: blob count and sizes, neck snaps, merges and splits over 10 minutes, with the heater off for 25 s.
//           Snaps that stop growing mean the lamp stalled.
//   clump   % of time blobs overlap sideways in the pool, against the top, or stack touching in a column.
//   dwell   median seconds per visit against the top and in the pool.
//   land    temperature and squash of blobs as they land on the pool.
//   settle  blobs 30 s after the heater goes off.
//   spin    blobs every 10 s after spinning the dial 10 clicks/s for 4 s.
import { H, POOL_H, controls, spawn, step, turnDial, type Blob, type Controls } from "../src/lava.ts";

/** Seconds per tick measured on the bar, and the Normal speed setting. */
const TICK = 0.043;
const SPEED = 0.4;

function run(seconds: number, each: (t: number, blobs: Blob[], c: Controls) => void): void {
  const blobs = spawn(6);
  const c = controls();
  for (let t = 0; t < seconds; t += TICK) {
    step(blobs, c, TICK * SPEED);
    each(t, blobs, c);
  }
}

const alive = (blobs: Blob[]) => blobs.filter((b) => b.r > 0);
const atTop = (b: Blob) => b.y <= b.r - 1;
const inPool = (b: Blob) => b.attached && H - POOL_H - b.y - b.r <= 0;
const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(0)}%`;
const quantile = (xs: number[], q: number) => xs.sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))].toFixed(2);
const blob = (b: Blob) =>
  `${b.attached ? "@" : " "}x${b.x.toFixed(0).padStart(2)} y${b.y.toFixed(0).padStart(2)} r${b.r.toFixed(1)} sq${b.squash.toFixed(1)}`;

const checks: Record<string, (runs: number) => void> = {
  life(runs) {
    for (let i = 0; i < runs; i++) {
      let snaps = 0;
      let merges = 0;
      let splits = 0;
      let blobs: Blob[] = [];
      const was: boolean[] = [];
      let count = 6;
      run(600, (t, bs, c) => {
        c.heating = t < 100 || t >= 125;
        bs.forEach((b, j) => {
          if (was[j] && !b.attached && b.r > 0) snaps++;
          was[j] = b.attached;
        });
        const n = alive(bs).length;
        if (n < count) merges += count - n;
        if (n > count) splits += n - count;
        count = n;
        blobs = bs;
      });
      console.log(`n=${count} r=${blobs.map((b) => b.r.toFixed(1)).join(",")} snaps=${snaps} merges=${merges} splits=${splits}`);
    }
  },

  clump(runs) {
    let ticks = 0;
    let pool = 0;
    let top = 0;
    let column = 0;
    for (let i = 0; i < runs; i++)
      run(300, (_, bs) => {
        ticks++;
        const a = alive(bs);
        let p = 0;
        let tp = 0;
        let cl = 0;
        for (let j = 0; j < a.length; j++)
          for (let k = j + 1; k < a.length; k++) {
            const A = a[j];
            const B = a[k];
            const dx = Math.abs(A.x - B.x);
            if (dx >= (A.r * (1 + 0.6 * A.squash) + B.r * (1 + 0.6 * B.squash)) * 0.8) continue;
            if (A.attached && B.attached) p = 1;
            else if (atTop(A) && atTop(B)) tp = 1;
            else if (dx < (A.r + B.r) * 0.4 && Math.abs(A.y - B.y) < A.r + B.r) cl = 1;
          }
        pool += p;
        top += tp;
        column += cl;
      });
    console.log(`time with overlap: pool ${pct(pool, ticks)}, top ${pct(top, ticks)}, stacked in a column ${pct(column, ticks)}`);
  },

  dwell(runs) {
    const tops: number[] = [];
    const pools: number[] = [];
    for (let i = 0; i < runs; i++) {
      const top: number[] = [];
      const pool: number[] = [];
      run(600, (_, bs) =>
        bs.forEach((b, j) => {
          if (b.r > 0 && atTop(b)) top[j] = (top[j] ?? 0) + TICK;
          else if (top[j]) (tops.push(top[j]), (top[j] = 0));
          if (b.r > 0 && inPool(b)) pool[j] = (pool[j] ?? 0) + TICK;
          else if (pool[j]) (pools.push(pool[j]), (pool[j] = 0));
        }),
      );
    }
    console.log(`top: median ${quantile(tops, 0.5)} s over ${tops.length} visits | pool: median ${quantile(pools, 0.5)} s over ${pools.length} visits`);
  },

  land(runs) {
    const temps: number[] = [];
    let squash = 0;
    for (let i = 0; i < runs; i++) {
      const was: boolean[] = [];
      run(600, (t, bs) =>
        bs.forEach((b, j) => {
          if (t > 10 && b.r > 0 && b.attached && !was[j]) temps.push(b.temp);
          if (b.attached && b.squash > squash) squash = b.squash;
          was[j] = b.attached;
        }),
      );
    }
    const q = (p: number) => quantile(temps, p);
    console.log(`${temps.length} landings: temp p10 ${q(0.1)}, median ${q(0.5)}, p90 ${q(0.9)}; max squash in the pool ${squash.toFixed(2)}`);
  },

  settle(runs) {
    for (let i = 0; i < runs; i++) {
      let blobs: Blob[] = [];
      run(40, (t, bs, c) => ((c.heating = t < 10), (blobs = bs)));
      console.log(alive(blobs).sort((a, b) => a.x - b.x).map(blob).join(" | "));
    }
  },

  spin(runs) {
    for (let i = 0; i < runs; i++) {
      let clicks = 0;
      let next = 10;
      run(61, (t, bs, c) => {
        if (t >= 10 && t < 14 && t * 10 >= 100 + clicks) (turnDial(c, 1), clicks++);
        if (t < next) return;
        next += 10;
        console.log(`t=${t.toFixed(0).padStart(2)} ${alive(bs).sort((a, b) => a.x - b.x).map(blob).join(" | ")}`);
      });
      console.log();
    }
  },
};

const [name, runs] = process.argv.slice(2);
const check = checks[name];
if (!check) {
  console.error(`Usage: node tools/sim.ts <${Object.keys(checks).join("|")}> [runs]`);
  process.exit(1);
}
check(Number(runs ?? 3));
