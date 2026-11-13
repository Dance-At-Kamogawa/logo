/**
 * Condensation scene model. Pure functions of the beat grid: no clocks, no
 * Math.random (seeded `random` / noise only), so every frame is reproducible.
 *
 * Everything lives in logo space (0..1000, y down) on the window glass:
 *   - static beads: glass droplets that nucleate, grow and merge on the beat,
 *   - runners: beads that, once heavy enough (a merge on the beat), run down
 *     the glass in stick-slip surges (one surge per beat) along a seeded,
 *     meandering path, swallowing the beads they touch,
 *   - trails: the clear paths the runners wipe through the condensation,
 *     emitted as capsule segments carrying their age (beats since the head
 *     passed), so the shader can compute the trail mask analytically,
 *   - residue: tiny beads left behind in the trails.
 * Behind the glass: out-of-focus city lights and the logo (see backdrop.ts).
 */
import { random } from "remotion";
import { noise2D } from "../../lib/noise";
import { PEG_CENTERS } from "../../logo";

export type StageBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** A glass bead primitive: round cone from a (radius ra) to b (radius rb); k = smooth-union radius. */
export type BeadPrim = {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly ra: number;
  readonly rb: number;
  readonly k: number;
};

/** A piece of wiped trail: capsule with half-widths and the age (beats) of its two ends. */
export type TrailSeg = {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly wa: number;
  readonly wb: number;
  readonly agea: number;
  readonly ageb: number;
};

export type LightKind = "warm" | "cool" | "red" | "white";
export type Light = {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly kind: LightKind;
  readonly intensity: number;
};

export type CondScene = {
  readonly beads: readonly BeadPrim[];
  readonly trails: readonly TrailSeg[];
  readonly lights: readonly Light[];
  /** Global condensation density. */
  readonly fog: number;
  /** Trails re-fog after `hold` beats over `dur` beats. */
  readonly refog: { readonly hold: number; readonly dur: number };
  /** 0..1: the fog evaporating radially from the four pegs. */
  readonly reveal: number;
  /** How far beyond the hairline square the evaporated area reaches (logo units). */
  readonly margin: number;
  /** Growth of the procedural bead layers (small, medium) and micro-droplet strength. */
  readonly layers: { readonly small: number; readonly medium: number; readonly micro: number };
  /** 0..1 global fade from black. */
  readonly fade: number;
  /** Offset of the fog density noise. */
  readonly drift: { readonly x: number; readonly y: number };
};

/** Main composition timeline (beats). */
export const T = {
  /** First bead heavy enough to run. */
  firstRun: 5,
  /** Bar 5 downbeat: the fog starts to evaporate from the four pegs. */
  reveal: 16,
  revealEnd: 20.5,
  total: 28,
} as const;

export const LOOP_BEATS = 16;
export const MAX_BEADS = 1024;
export const MAX_TRAILS = 4096;
/** Hairline square (centre 500, half size 493). */
const FRAME_HALF = 493;
export const BASE_MARGIN = 70;

const TAU = Math.PI * 2;
export const mod = (a: number, n: number): number => ((a % n) + n) % n;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
const easeInQuad = (t: number): number => clamp01(t) * clamp01(t);
const rnd = (seed: string): number => random(`condensation:${seed}`);

// ---------------------------------------------------------------- reveal

const PEGS = Object.values(PEG_CENTERS);
const REVEAL_REACH = 760;

/** CPU twin of the shader's reveal mask (without the frontier noise). 1 = evaporated. */
export const revealMask = (x: number, y: number, progress: number, margin: number): number => {
  if (progress <= 0) return 0;
  const R = progress * REVEAL_REACH;
  let discs = 0;
  for (const p of PEGS) discs = Math.max(discs, smoothstep(R, R - 90, Math.hypot(x - p.x, y - p.y)));
  const dx = Math.abs(x - 500) - (FRAME_HALF + margin);
  const dy = Math.abs(y - 500) - (FRAME_HALF + margin);
  const box = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  return discs * smoothstep(40, -40, box);
};

// ---------------------------------------------------------------- runners

type RunnerDef = {
  readonly key: string;
  readonly x0: number;
  readonly y0: number;
  readonly r: number;
  /** Beat of the merge that sets it off (it starts running right on it). */
  readonly start: number;
  /** Length of the first surge (logo units); later ones grow by `accel`. */
  readonly surge: number;
  readonly accel: number;
  /** Meander amplitude. */
  readonly amp: number;
  /** Below y = from, pulled into the trail of an earlier runner. */
  readonly follow?: { readonly key: string; readonly from: number };
};

type Residue = { readonly x: number; readonly y: number; readonly r: number; readonly pass: number };

type Track = {
  readonly def: RunnerDef;
  readonly ys: Float64Array;
  readonly xs: Float64Array;
  readonly ws: Float64Array;
  /** Beats after `start` at which the head passes each sample. */
  readonly passes: Float64Array;
  readonly yEnd: number;
  readonly residue: readonly Residue[];
};

const STEP = 14; // path sample spacing (logo units)
const SURGE_BEATS = 0.55;

/** Distance run after `t` beats: one eased surge per beat plus a slow creep. */
const runDistance = (d: RunnerDef, t: number): number => {
  if (t <= 0) return 0;
  let s = 4 * t;
  const n = Math.floor(t) + 1;
  for (let k = 0; k < n; k++) s += d.surge * (1 + d.accel * k) * easeOutCubic((t - k) / SURGE_BEATS);
  return s;
};

const xOnPath = (d: RunnerDef, y: number, tracks: ReadonlyMap<string, Track>): number => {
  const dy = y - d.y0;
  const ramp = smoothstep(0, 60, dy);
  const wander = d.amp * noise2D(`run:${d.key}`, dy / 120, 0.37) + 0.35 * d.amp * noise2D(`run2:${d.key}`, dy / 37, 1.7);
  const slope = (rnd(`${d.key}:slope`) - 0.5) * 0.12 * dy;
  let x = d.x0 + ramp * (wander + slope);
  if (d.follow) {
    const other = tracks.get(d.follow.key);
    if (other) {
      const ox = sampleX(other, y);
      if (ox !== null) x += (ox - x) * smoothstep(d.follow.from - 140, d.follow.from, y);
    }
  }
  return x;
};

const sampleX = (t: Track, y: number): number | null => {
  const i = (y - t.def.y0) / STEP;
  if (i < 0 || i > t.ys.length - 1) return null;
  const i0 = Math.floor(i);
  const i1 = Math.min(t.ys.length - 1, i0 + 1);
  const f = i - i0;
  return (t.xs[i0] ?? 0) * (1 - f) + (t.xs[i1] ?? 0) * f;
};

const buildTrack = (d: RunnerDef, stage: StageBox, tracks: ReadonlyMap<string, Track>): Track => {
  const yEnd = stage.y + stage.height + 3 * d.r;
  const n = Math.max(2, Math.ceil((yEnd - d.y0) / STEP) + 1);
  const ys = new Float64Array(n);
  const xs = new Float64Array(n);
  const ws = new Float64Array(n);
  const passes = new Float64Array(n);
  // Invert the run distance on a fine time grid.
  let t = 0;
  const dt = 1 / 120;
  for (let i = 0; i < n; i++) {
    const y = d.y0 + i * STEP;
    ys[i] = y;
    xs[i] = xOnPath(d, y, tracks);
    ws[i] = d.r * 0.78 * (0.85 + 0.3 * (noise2D(`w:${d.key}`, i * STEP / 90, 0) * 0.5 + 0.5));
    while (runDistance(d, t) < i * STEP && t < 64) t += dt;
    passes[i] = t;
  }
  const residue: Residue[] = [];
  for (let i = 3; i < n; i += 2) {
    if (rnd(`${d.key}:res:${i}`) > 0.42) continue;
    const u = rnd(`${d.key}:resr:${i}`);
    residue.push({
      x: (xs[i] ?? 0) + (rnd(`${d.key}:resx:${i}`) - 0.5) * 1.3 * (ws[i] ?? 0),
      y: (ys[i] ?? 0) + rnd(`${d.key}:resy:${i}`) * STEP * 2,
      r: 1.9 + u * u * 3.6,
      pass: (passes[i] ?? 0) + 0.06,
    });
  }
  return { def: d, ys, xs, ws, passes, yEnd, residue };
};

/** Head of a runner at local time t (beats since its start), or null once off the glass. */
const headPrim = (tr: Track, t: number): BeadPrim | null => {
  const d = tr.def;
  const s = runDistance(d, t);
  const yh = d.y0 + s;
  if (yh > tr.yEnd) return null;
  const speed = (s - runDistance(d, t - 1 / 30)) * 30; // units / beat
  const r = d.r * (1 - 0.12 * clamp01(s / 900));
  const tail = r * (0.35 + Math.min(speed / 260, 1.7));
  const xh = sampleX(tr, yh) ?? d.x0;
  const xt = sampleX(tr, Math.max(d.y0, yh - tail)) ?? d.x0;
  return { ax: xt, ay: yh - tail * 0.92, bx: xh, by: yh, ra: r * 0.5, rb: r, k: r * 0.5 };
};

/** Trail capsules wiped so far, with their ages (beats since the head passed) at local time t. */
const trailSegs = (tr: Track, t: number, out: TrailSeg[], maxAge: number): void => {
  const d = tr.def;
  if (t <= 0) return;
  const yh = Math.min(tr.yEnd, d.y0 + runDistance(d, t));
  const n = tr.ys.length;
  for (let i = 0; i + 1 < n; i++) {
    const ya = tr.ys[i] ?? 0;
    if (ya >= yh) break;
    const pa = tr.passes[i] ?? 0;
    const pb = tr.passes[i + 1] ?? 0;
    const agea = t - pa;
    if (agea > maxAge && t - pb > maxAge) continue;
    let yb = tr.ys[i + 1] ?? ya;
    let xb = tr.xs[i + 1] ?? 0;
    let wb = tr.ws[i + 1] ?? 0;
    let ageb = t - pb;
    if (yb > yh) {
      const f = (yh - ya) / (yb - ya);
      yb = yh;
      xb = (tr.xs[i] ?? 0) + ((tr.xs[i + 1] ?? 0) - (tr.xs[i] ?? 0)) * f;
      wb = (tr.ws[i] ?? 0) + ((tr.ws[i + 1] ?? 0) - (tr.ws[i] ?? 0)) * f;
      ageb = 0;
    }
    // Where the drop sat before it ran, the glass is clear as well.
    const wa = i === 0 ? d.r * 0.9 : tr.ws[i] ?? 0;
    out.push({ ax: tr.xs[i] ?? 0, ay: ya, bx: xb, by: yb, wa, wb, agea, ageb });
  }
};

/** A whole old trail at a fixed age, sampled coarser. */
const oldTrail = (tr: Track, age: number, out: TrailSeg[]): void => {
  const every = 3;
  for (let i = 0; i + every < tr.ys.length; i += every) {
    const j = i + every;
    out.push({
      ax: tr.xs[i] ?? 0,
      ay: tr.ys[i] ?? 0,
      bx: tr.xs[j] ?? 0,
      by: tr.ys[j] ?? 0,
      wa: (i === 0 ? tr.def.r * 0.9 : tr.ws[i] ?? 0) * 0.9,
      wb: (tr.ws[j] ?? 0) * 0.9,
      agea: age,
      ageb: age,
    });
  }
};

/** First beat (absolute) at which any runner's head touches (x, y, r); Infinity if never. */
const absorbedAt = (tracks: readonly Track[], x: number, y: number, r: number, skip: string): number => {
  let best = Infinity;
  for (const tr of tracks) {
    if (tr.def.key === skip) continue;
    const i = Math.round((y - tr.def.y0) / STEP);
    if (i < 0 || i >= tr.ys.length) continue;
    const dx = Math.abs((tr.xs[i] ?? 0) - x);
    if (dx < (tr.ws[i] ?? 0) + r * 0.6) best = Math.min(best, tr.def.start + (tr.passes[i] ?? 0));
  }
  return best;
};

// ---------------------------------------------------------------- static beads

type StaticBead = {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly r1: number;
  /** A neighbour that merges into this bead on beat `merge`. */
  readonly child: { readonly r: number; readonly angle: number; readonly dist: number; readonly merge: number } | null;
  readonly appear: number;
  readonly grow: number;
  /** Survives the evaporation (a few big beads stay on the clear glass). */
  readonly keep: boolean;
  /** Swallowed by a runner at this beat. */
  readonly end: number;
};

const finalRadius = (b: StaticBead): number => (b.child ? Math.hypot(b.r1, b.child.r) : b.r1);

/** Over the type band, beads would hide letters: none of those survive. */
const overText = (x: number, y: number, r: number): boolean => x > 120 - r && x < 885 + r && y > 395 - r && y < 610 + r;

/** Prims of a (possibly merging) static bead at beat t. */
const beadPrims = (b: StaticBead, t: number, scale: number, out: BeadPrim[]): void => {
  if (t < b.appear) return;
  const g = easeOutCubic((t - b.appear) / b.grow) * scale;
  if (g <= 0.01) return;
  const swallow = t > b.end ? 1 - clamp01((t - b.end) / 0.12) : 1;
  if (swallow <= 0) return;
  const sphere = (x: number, y: number, r: number): void => {
    if (r < 0.6) return;
    // Slightly bottom-heavy, like a drop hanging on a vertical pane.
    out.push({ ax: x, ay: y - 0.14 * r, bx: x, by: y + 0.06 * r, ra: r * 0.88, rb: r, k: Math.max(1.5, r * 0.45) });
  };
  const c = b.child;
  if (!c || t < c.merge - 0.32) {
    sphere(b.x, b.y, b.r1 * g * swallow);
    if (c) sphere(b.x + Math.cos(c.angle) * c.dist, b.y + Math.sin(c.angle) * c.dist, c.r * g * swallow);
    return;
  }
  const cx = b.x + Math.cos(c.angle) * c.dist;
  const cy = b.y + Math.sin(c.angle) * c.dist;
  const w1 = b.r1 * b.r1;
  const w2 = c.r * c.r;
  const mx = (w1 * b.x + w2 * cx) / (w1 + w2);
  const my = (w1 * b.y + w2 * cy) / (w1 + w2);
  if (t < c.merge) {
    // The neighbour is drawn in, faster and faster, landing on the beat.
    const u = easeInQuad((t - (c.merge - 0.32)) / 0.32);
    sphere(b.x + (mx - b.x) * u * 0.6, b.y + (my - b.y) * u * 0.6, b.r1 * g * swallow);
    sphere(cx + (mx - cx) * u, cy + (my - cy) * u, c.r * g * swallow * (1 - 0.3 * u));
    return;
  }
  const dt = t - c.merge;
  const wob = 1 + 0.07 * Math.sin(dt * 22) * Math.exp(-dt * 5);
  sphere(mx, my, Math.hypot(b.r1, c.r) * g * swallow * wob);
};

// ---------------------------------------------------------------- lights

const makeLights = (stage: StageBox): Light[] => {
  const lights: Light[] = [];
  const x0 = stage.x;
  const W = stage.width;
  const row = Math.round(W / 170);
  // A distant row of sodium street lamps.
  for (let i = 0; i < row; i++) {
    const k = `row${i}`;
    lights.push({
      x: x0 + ((i + 0.3 + 0.4 * rnd(`${k}x`)) / row) * W,
      y: 650 + 50 * rnd(`${k}y`) + 0.04 * (i - row / 2) * 30,
      r: 16 + 14 * rnd(`${k}r`),
      kind: rnd(`${k}k`) < 0.8 ? "warm" : "white",
      intensity: 0.16 + 0.16 * rnd(`${k}i`),
    });
  }
  // Big soft blooms, mostly low and to the sides.
  const blooms = Math.round(W / 130);
  for (let i = 0; i < blooms; i++) {
    const k = `bloom${i}`;
    const u = rnd(`${k}k`);
    const x = x0 + rnd(`${k}x`) * W;
    let y = stage.y + stage.height * (0.25 + 0.75 * Math.sqrt(rnd(`${k}y`)));
    // Keep the type's background calm.
    if (x > 60 && x < 940 && Math.abs(y - 500) < 170) y += y < 500 ? -200 : 220;
    lights.push({
      x,
      y,
      r: 45 + 95 * rnd(`${k}r`),
      kind: u < 0.55 ? "warm" : u < 0.85 ? "cool" : "white",
      intensity: 0.04 + 0.09 * rnd(`${k}i`),
    });
  }
  // A few aqua accents and red tail lights.
  for (let i = 0; i < Math.round(W / 420); i++) {
    const k = `aqua${i}`;
    lights.push({
      x: x0 + rnd(`${k}x`) * W,
      y: 250 + 800 * rnd(`${k}y`),
      r: 26 + 30 * rnd(`${k}r`),
      kind: "cool",
      intensity: 0.12 + 0.12 * rnd(`${k}i`),
    });
  }
  for (let i = 0; i < Math.round(W / 600); i++) {
    const k = `red${i}`;
    const x = x0 + (0.1 + 0.8 * rnd(`${k}x`)) * W;
    const y = 770 + 60 * rnd(`${k}y`);
    lights.push({ x, y, r: 15, kind: "red", intensity: 0.22 });
    lights.push({ x: x + 46, y, r: 15, kind: "red", intensity: 0.22 });
  }
  return lights;
};

/** Two cars passing far away: pairs of lights crossing, wrapping off-stage. `u` in cycles. */
const carLights = (stage: StageBox, u: number): Light[] => {
  const span = stage.width + 600;
  const out: Light[] = [];
  [
    { y: 800, off: 0.15, dir: 1, kind: "white" as const, cycles: 1 },
    { y: 845, off: 0.62, dir: -1, kind: "red" as const, cycles: 1 },
  ].forEach((c) => {
    const x = stage.x - 300 + mod(c.off * span + c.dir * u * c.cycles * span, span);
    out.push({ x, y: c.y, r: 20, kind: c.kind, intensity: 0.26 });
    out.push({ x: x + 52, y: c.y, r: 20, kind: c.kind, intensity: 0.26 });
  });
  return out;
};

/** Lights with a slow periodic sway; `phase` in cycles. */
const swayLights = (lights: readonly Light[], phase: number, on: (i: number) => number): Light[] =>
  lights.map((l, i) => ({
    ...l,
    x: l.x + 6 * Math.sin(TAU * phase + i * 1.7),
    y: l.y + 3 * Math.sin(TAU * phase + i * 2.3),
    intensity: l.intensity * on(i) * (1 + 0.08 * Math.sin(TAU * (phase * 2) + i * 0.9)),
  }));

// ---------------------------------------------------------------- world

const MAIN_RUNNERS: readonly RunnerDef[] = [
  { key: "a", x0: 372, y0: -60, r: 29, start: 5, surge: 70, accel: 0.3, amp: 26 },
  { key: "b", x0: -175, y0: 120, r: 25, start: 7, surge: 80, accel: 0.25, amp: 22 },
  { key: "c", x0: 655, y0: 170, r: 31, start: 8, surge: 75, accel: 0.3, amp: 24 },
  { key: "d", x0: 1150, y0: -40, r: 25, start: 9, surge: 90, accel: 0.25, amp: 20 },
  { key: "e", x0: 205, y0: 280, r: 27, start: 10, surge: 85, accel: 0.3, amp: 26 },
  { key: "f", x0: 795, y0: -170, r: 31, start: 11, surge: 95, accel: 0.25, amp: 22 },
  { key: "g", x0: 545, y0: 30, r: 25, start: 12, surge: 90, accel: 0.3, amp: 20, follow: { key: "c", from: 430 } },
  { key: "h", x0: 25, y0: -200, r: 27, start: 12, surge: 100, accel: 0.3, amp: 24 },
  { key: "i", x0: 470, y0: 300, r: 24, start: 13, surge: 95, accel: 0.3, amp: 22 },
  { key: "j", x0: 935, y0: 250, r: 27, start: 14, surge: 100, accel: 0.3, amp: 24 },
  { key: "k", x0: 125, y0: 600, r: 22, start: 14.5, surge: 110, accel: 0.3, amp: 20 },
  { key: "l", x0: 1235, y0: 280, r: 25, start: 15, surge: 100, accel: 0.3, amp: 22 },
  { key: "m", x0: -70, y0: 360, r: 25, start: 16, surge: 110, accel: 0.3, amp: 22 },
  { key: "n", x0: 1085, y0: 520, r: 24, start: 16, surge: 110, accel: 0.3, amp: 20 },
  { key: "o", x0: -245, y0: -110, r: 25, start: 18, surge: 110, accel: 0.3, amp: 22 },
];

const LOOP_RUNNERS: readonly RunnerDef[] = [
  { key: "L1", x0: -175, y0: -40, r: 27, start: 1, surge: 125, accel: 0.3, amp: 22 },
  { key: "L2", x0: 1185, y0: 160, r: 25, start: 5, surge: 125, accel: 0.3, amp: 22 },
  { key: "L3", x0: 610, y0: -230, r: 28, start: 9, surge: 130, accel: 0.3, amp: 24 },
  { key: "L4", x0: -95, y0: 420, r: 24, start: 13, surge: 125, accel: 0.3, amp: 18 },
];

/** Extra runners in the side areas of a wide frame (outside the 1000-unit square + its margin). */
const sideRunners = (stage: StageBox, prefix: string, starts: readonly number[], surge: number): RunnerDef[] => {
  const left = { a: stage.x + 70, b: -360 };
  const right = { a: 1360, b: stage.x + stage.width - 70 };
  if (left.b - left.a < 120) return [];
  return starts.map((start, i) => {
    const side = i % 2 === 0 ? left : right;
    const k = `${prefix}${i}`;
    return {
      key: k,
      x0: side.a + rnd(`${k}x`) * (side.b - side.a),
      y0: stage.y + 40 + rnd(`${k}y`) * stage.height * 0.45,
      r: 22 + 9 * rnd(`${k}r`),
      start,
      surge: surge + 30 * rnd(`${k}s`),
      accel: 0.3,
      amp: 18 + 8 * rnd(`${k}a`),
    };
  });
};

type World = {
  readonly tracks: readonly Track[];
  /** Loop only: the main composition's runs, as old, half re-fogged trails. */
  readonly old: readonly Track[];
  readonly beads: readonly StaticBead[];
  readonly lights: readonly Light[];
};

const buildTracks = (defs: readonly RunnerDef[], stage: StageBox): Track[] => {
  const map = new Map<string, Track>();
  return defs.map((d) => {
    const t = buildTrack(d, stage, map);
    map.set(d.key, t);
    return t;
  });
};

/** Static beads scattered over the glass (some merge on the beat), plus each runner's own bead. */
const makeBeads = (stage: StageBox, tracks: readonly Track[]): StaticBead[] => {
  const n = Math.round((stage.width * stage.height) / 30000);
  const beads: StaticBead[] = [];
  for (let i = 0; i < n; i++) {
    const k = `b${i}`;
    const x = stage.x + rnd(`${k}x`) * stage.width;
    const y = stage.y + rnd(`${k}y`) * stage.height;
    const r1 = 6 + Math.pow(rnd(`${k}r`), 1.8) * 17;
    const hasChild = rnd(`${k}c`) < 0.4;
    const appear = -8 + rnd(`${k}a`) * 13;
    const childR = r1 * (0.45 + 0.4 * rnd(`${k}cr`));
    const merge = Math.max(Math.ceil(appear + 3), 2 + Math.floor(rnd(`${k}m`) * 14));
    const child = hasChild
      ? { r: childR, angle: rnd(`${k}ang`) * TAU, dist: (r1 + childR) * (1.15 + 0.35 * rnd(`${k}d`)), merge }
      : null;
    const fr = child ? Math.hypot(r1, child.r) : r1;
    const keep = false;
    const bead: StaticBead = { key: k, x, y, r1, child, appear, grow: 4 + 6 * rnd(`${k}g`), keep, end: Infinity };
    // Runners' paths stay free of beads that would sit in the way before they run.
    beads.push({ ...bead, end: absorbedAt(tracks, x, y, fr, "") });
  }
  // A few big beads that stay on the clear glass at the end (placed off the type).
  HOLD_BEADS.forEach((h, i) => {
    const k = `hold${i}`;
    const x = h.x;
    beads.push({ key: k, x, y: h.y, r1: h.r, child: null, appear: -6 + 8 * rnd(`${k}a`), grow: 8, keep: true, end: absorbedAt(tracks, x, h.y, h.r, "") });
  });
  // Each runner starts as a bead that grows, and runs when a neighbour merges into it.
  for (const tr of tracks) {
    const d = tr.def;
    const k = `run:${d.key}`;
    const cr = d.r * 0.55;
    const r1 = Math.sqrt(d.r * d.r - cr * cr);
    const angle = -Math.PI / 2 + (rnd(`${k}ang`) - 0.5) * 2.2;
    const dist = (r1 + cr) * 1.2;
    // Place the pair so that the merged bead sits exactly where the run starts.
    const shift = (dist * cr * cr) / (d.r * d.r);
    beads.push({
      key: k,
      x: d.x0 - Math.cos(angle) * shift,
      y: d.y0 - Math.sin(angle) * shift,
      r1,
      child: { r: cr, angle, dist, merge: d.start },
      appear: d.start - 9,
      grow: 6,
      keep: false,
      end: d.start + 0.001, // from here on, it is the runner's head
    });
  }
  return beads;
};

const HOLD_BEADS: readonly { x: number; y: number; r: number }[] = [
  { x: 290, y: 215, r: 24 },
  { x: 722, y: 262, r: 18 },
  { x: 760, y: 720, r: 21 },
  { x: 302, y: 758, r: 17 },
  { x: 592, y: 842, r: 27 },
  { x: 130, y: 360, r: 15 },
];

const worldCache = new Map<string, World>();
const worldFor = (stage: StageBox, kind: "main" | "loop"): World => {
  const key = `${kind}:${stage.x.toFixed(2)}:${stage.y.toFixed(2)}:${stage.width.toFixed(2)}`;
  const hit = worldCache.get(key);
  if (hit) return hit;
  let world: World;
  const lights = makeLights(stage);
  if (kind === "main") {
    const defs = [...MAIN_RUNNERS, ...sideRunners(stage, "sm", [6, 8, 9, 11, 12, 13, 15, 17], 85)];
    const tracks = buildTracks(defs, stage);
    world = { tracks, old: [], beads: makeBeads(stage, tracks), lights };
  } else {
    const defs = [...LOOP_RUNNERS, ...sideRunners(stage, "sl", [3, 7, 11, 15, 0, 9], 125)];
    const tracks = buildTracks(defs, stage);
    // The loop keeps the main composition's surviving beads, minus those in the loop runners' way.
    const main = worldFor(stage, "main");
    const beads = main.beads
      .filter((b) => b.end === Infinity && !b.key.startsWith("run:"))
      .filter((b) => absorbedAt(tracks, b.x, b.y, finalRadius(b) + 12, "") === Infinity)
      .map((b) => ({ ...b, appear: -1e4 }));
    world = { tracks, old: main.tracks, beads, lights };
  }
  worldCache.set(key, world);
  return world;
};

// ---------------------------------------------------------------- frames

const evaporation = (b: StaticBead, reveal: number, margin: number): number =>
  b.keep ? 1 : 1 - revealMask(b.x, b.y, reveal, margin);

/** The main composition at a (fractional) beat. */
export const introScene = (beat: number, stage: StageBox): CondScene => {
  const w = worldFor(stage, "main");
  const reveal = easeOutCubic((beat - T.reveal) / (T.revealEnd - T.reveal)) * (beat > T.reveal ? 1 : 0);
  const margin = BASE_MARGIN;
  const beads: BeadPrim[] = [];
  for (const b of w.beads) {
    const ev = evaporation(b, reveal, margin);
    if (ev > 0.02) beadPrims(b, beat, ev, beads);
  }
  const trails: TrailSeg[] = [];
  for (const tr of w.tracks) {
    const t = beat - tr.def.start;
    if (t <= 0) continue;
    const head = headPrim(tr, t);
    if (head) beads.push(head);
    trailSegs(tr, t, trails, 1e9);
    for (const r of tr.residue) {
      if (t < r.pass) continue;
      const ev = 1 - revealMask(r.x, r.y, reveal, margin);
      const g = easeOutCubic((t - r.pass) / 0.15) * ev;
      if (g > 0.05) beads.push({ ax: r.x, ay: r.y, bx: r.x, by: r.y, ra: r.r * g, rb: r.r * g, k: 0.5 });
    }
  }
  const lightOn = (i: number): number => smoothstep(0, 1.6, beat - 0.12 * (i % 23));
  const lights = [...swayLights(w.lights, beat / 64, lightOn), ...carLights(stage, beat / 40).map((l) => ({ ...l, intensity: l.intensity * smoothstep(1, 3, beat) }))];
  return {
    beads,
    trails,
    lights,
    fog: 1,
    refog: { hold: 1e6, dur: 1 },
    reveal,
    margin,
    layers: {
      small: 0.55 + 0.45 * easeOutCubic(beat / 10),
      medium: easeOutCubic((beat - 1) / 12),
      micro: 1,
    },
    fade: smoothstep(0, 2.5, beat),
    drift: { x: beat * 0.004, y: -beat * 0.0025 },
  };
};

/** The VJ loop at beat b in [0, LOOP_BEATS): every motion is periodic. */
export const loopScene = (b: number, stage: StageBox): CondScene => {
  const w = worldFor(stage, "loop");
  const phase = b / LOOP_BEATS;
  // The fog creeps back in from the edges and evaporates again, once per loop.
  const margin = BASE_MARGIN - 55 * (0.5 - 0.5 * Math.cos(TAU * phase));
  const refog = { hold: 1, dur: 3.5 };
  const maxAge = refog.hold + refog.dur;
  const beads: BeadPrim[] = [];
  for (const sb of w.beads) beadPrims(sb, 1e3, evaporation(sb, 1, BASE_MARGIN), beads);
  const trails: TrailSeg[] = [];
  // The earlier runs' trails, half fogged over again.
  for (const tr of w.old) oldTrail(tr, refog.hold + 0.45 * refog.dur, trails);
  for (const tr of w.tracks) {
    // Local time in [-4, 12): grow for 4 beats, run, re-fog; done before it wraps.
    const t = mod(b - tr.def.start + 4, LOOP_BEATS) - 4;
    if (t < 0) {
      const g = easeOutCubic((t + 4) / 3.6);
      const r = tr.def.r * g;
      if (r > 0.6)
        beads.push({ ax: tr.def.x0, ay: tr.def.y0 - 0.14 * r, bx: tr.def.x0, by: tr.def.y0 + 0.06 * r, ra: r * 0.88, rb: r, k: r * 0.45 });
      continue;
    }
    const head = headPrim(tr, t);
    if (head) beads.push(head);
    trailSegs(tr, t, trails, maxAge);
    for (const r of tr.residue) {
      if (t < r.pass) continue;
      const age = t - r.pass;
      const g = easeOutCubic(age / 0.15) * (1 - smoothstep(refog.hold, maxAge, age));
      if (g > 0.05) beads.push({ ax: r.x, ay: r.y, bx: r.x, by: r.y, ra: r.r * g, rb: r.r * g, k: 0.5 });
    }
  }
  const lights = [...swayLights(w.lights, phase, () => 1), ...carLights(stage, phase)];
  return {
    beads,
    trails,
    lights,
    fog: 1,
    refog,
    reveal: 1,
    margin,
    layers: { small: 1, medium: 1, micro: 1 },
    fade: 1,
    drift: { x: 0.12 * Math.cos(TAU * phase), y: 0.12 * Math.sin(TAU * phase) },
  };
};

/** Diagnostics: per loop runner, local beats until its head leaves and its last trail sample re-fogs (must be < 12). */
export const loopTiming = (stage: StageBox): { key: string; done: number }[] =>
  worldFor(stage, "loop").tracks.map((tr) => {
    let t = 0;
    while (headPrim(tr, t) && t < 64) t += 1 / 60;
    const last = tr.passes[tr.passes.length - 1] ?? 0;
    return { key: tr.def.key, done: Math.max(t, last + 1 + 3.5) };
  });

/** Diagnostics: the static beads still on the glass at the end of the main composition. */
export const survivors = (stage: StageBox): string[] =>
  worldFor(stage, "main")
    .beads.filter((b) => b.end === Infinity && (b.keep || revealMask(b.x, b.y, 1, BASE_MARGIN) < 0.5))
    .map((b) => `${b.key}@${b.x.toFixed(0)},${b.y.toFixed(0)} r${finalRadius(b).toFixed(1)}${b.keep ? " keep" : ""}`);
