/**
 * DropLens scene model: pure functions of the beat grid (no clocks, no
 * Math.random; seeded noise only), so every frame is reproducible.
 */
import { beatEnvelope } from "../../lib/beat";
import { clamp01, lerp } from "../../lib/easing";
import { noise2D } from "../../lib/noise";
import { PEG_CENTERS } from "../../logo";
import type { Corner } from "../../logo";

export type Drop = {
  readonly x: number;
  readonly y: number;
  /** Radius, logo units. */
  readonly r: number;
  /** Distance of the logo plane below the drop centre, in radii (focus at 1.5). */
  readonly depth: number;
  readonly alpha: number;
  /** Smooth-union radius (metaball neck when drops touch). */
  readonly k: number;
  /** Extra specular gain (beat glints). */
  readonly glint: number;
};

export type LensScene = {
  readonly drops: readonly Drop[];
  readonly reveal: { readonly front: number; readonly soft: number; readonly level: number; readonly bloom: number };
  readonly glint: number;
  readonly light: number;
  readonly camera: { readonly x: number; readonly y: number };
};

/** Timeline in beats. */
export const T = {
  /** Drops steer towards the grommets from here... */
  steer: 12,
  /** ...and settle on this bar downbeat; the logo plane lights up from them. */
  settle: 16,
  /** Reveal wipe duration. */
  wipe: 4,
  total: 28,
} as const;

export const LOOP_BEATS = 16;
export const BEAD_R = 50;
/** A bead lying on the tarp: upright, ~1.25x. */
const BEAD_DEPTH = 0.3;
const FOCUS = 1.5;
const TAU = Math.PI * 2;

export const mod = (a: number, n: number): number => ((a % n) + n) % n;

const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

// ------------------------------------------------------------ free drops

type Pt = { readonly x: number; readonly y: number };

/**
 * The two drops that never settle: slow closed paths over the type, periodic
 * in LOOP_BEATS (so the resolved hold is exactly the loop).
 */
const FREE = [
  { r: 74, depth: 2.15, cx: 500, cy: 505, ax: 300, ay: 82, ph: 0.15, wob: 0.22 },
  { r: 50, depth: 2.35, cx: 520, cy: 520, ax: 150, ay: 205, ph: 0.62, wob: -0.18 },
] as const;

const freePos = (i: number, beat: number): Pt => {
  const f = FREE[i] ?? FREE[0];
  const u = beat / LOOP_BEATS;
  const dir = i === 0 ? 1 : -1;
  const th = TAU * (dir * u + f.ph) + f.wob * Math.sin(TAU * u);
  return {
    x: f.cx + f.ax * Math.cos(th) + 18 * Math.sin(2 * th + 1.3),
    y: f.cy + f.ay * Math.sin(th) + 14 * Math.cos(3 * th),
  };
};

// ------------------------------------------------------------ bead drops

const CORNERS: readonly Corner[] = ["tl", "tr", "bl", "br"];

type Key = readonly [beat: number, x: number, y: number];

/** Intro wander of the four drops that become the grommets (ends on the peg). */
const BEADS: Readonly<Record<Corner, { r: number; depth: number; appear: number; keys: readonly Key[] }>> = {
  tl: { r: 80, depth: 2.05, appear: 0.0, keys: [[0, 400, 470], [5, 300, 540], [9, 360, 380], [12.5, 300, 300]] },
  tr: { r: 96, depth: 2.3, appear: 1.5, keys: [[0, 1100, 520], [6, 760, 480], [12.5, 690, 340]] },
  bl: { r: 68, depth: 2.2, appear: 3.0, keys: [[0, -60, 560], [5.5, 190, 500], [9.5, 330, 640], [12.5, 280, 720]] },
  br: { r: 88, depth: 2.4, appear: 4.5, keys: [[0, 700, 1120], [6.5, 600, 560], [12.5, 690, 650]] },
};

/** Catmull-Rom through keys (clamped ends). */
const spline = (keys: readonly Key[], beat: number): Pt => {
  const n = keys.length;
  const first = keys[0];
  const last = keys[n - 1];
  if (!first || !last) return { x: 0, y: 0 };
  if (beat <= first[0]) return { x: first[1], y: first[2] };
  if (beat >= last[0]) return { x: last[1], y: last[2] };
  let i = 0;
  while (i < n - 2 && beat > (keys[i + 1]?.[0] ?? Infinity)) i++;
  const k0 = keys[Math.max(0, i - 1)] ?? first;
  const k1 = keys[i] ?? first;
  const k2 = keys[i + 1] ?? last;
  const k3 = keys[Math.min(n - 1, i + 2)] ?? last;
  const t = (beat - k1[0]) / (k2[0] - k1[0]);
  const cr = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  return { x: cr(k0[1], k1[1], k2[1], k3[1]), y: cr(k0[2], k1[2], k2[2], k3[2]) };
};

/** Hermite blend from the wander to the peg, arriving at rest on T.settle. */
const beadIntroPos = (c: Corner, beat: number): Pt => {
  const b = BEADS[c];
  const lastKey = b.keys[b.keys.length - 1];
  const tEnd = lastKey?.[0] ?? T.steer;
  const peg = PEG_CENTERS[c];
  // A slow drift that dies out as the drop settles.
  const calm = 1 - smooth((beat - T.steer) / (T.settle - T.steer));
  const wob = {
    x: 26 * noise2D(`dl-${c}x`, beat * 0.22, 0) * calm,
    y: 26 * noise2D(`dl-${c}y`, 0, beat * 0.22) * calm,
  };
  if (beat <= tEnd) {
    const p = spline(b.keys, beat);
    return { x: p.x + wob.x, y: p.y + wob.y };
  }
  // Cubic Hermite from the last key (with the spline's exit velocity) to the peg at rest.
  const p0 = spline(b.keys, tEnd);
  const pm = spline(b.keys, tEnd - 0.05);
  const span = T.settle - tEnd;
  const v0 = { x: ((p0.x - pm.x) / 0.05) * span, y: ((p0.y - pm.y) / 0.05) * span };
  const t = clamp01((beat - tEnd) / span);
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
  const h10 = t ** 3 - 2 * t ** 2 + t;
  const h01 = -2 * t ** 3 + 3 * t ** 2;
  return {
    x: h00 * p0.x + h10 * v0.x + h01 * peg.x + wob.x,
    y: h00 * p0.y + h10 * v0.y + h01 * peg.y + wob.y,
  };
};

/** Depth of the plane under a bead drop: through the focus on the downbeat, then lying on the tarp. */
const beadDepth = (c: Corner, beat: number, restDepth: number): number => {
  const free = BEADS[c].depth;
  const s = T.settle;
  if (beat < s - 1.5) return free;
  if (beat < s) return lerp(free, FOCUS, smooth((beat - (s - 1.5)) / 1.5) ** 1.5);
  const t = clamp01((beat - s) / 1.0);
  return lerp(FOCUS, restDepth, 1 - (1 - t) ** 3);
};

// ------------------------------------------------------------ resolved (loop) state

const beadGlint = (i: number, beat: number): number =>
  // One bead catches the light on each beat of the bar, going round the corners.
  0.9 * beatEnvelope(mod(beat - [0, 1, 3, 2][i]!, 4), { decay: 3.2, every: 4 });

const restBead = (c: Corner, i: number, beat: number): Drop => {
  const peg = PEG_CENTERS[c];
  const breathe = beatEnvelope(mod(beat, 4), { decay: 2.4, every: 4 });
  const sway = Math.sin(TAU * (beat / LOOP_BEATS + i * 0.25));
  return {
    x: peg.x,
    y: peg.y,
    r: BEAD_R * (1 + 0.025 * breathe + 0.01 * sway),
    depth: BEAD_DEPTH + 0.04 * sway,
    alpha: 1,
    k: 22,
    glint: beadGlint(i, beat),
  };
};

const freeDrop = (i: number, beat: number, alpha: number): Drop => {
  const f = FREE[i] ?? FREE[0];
  const p = freePos(i, beat);
  return {
    x: p.x,
    y: p.y,
    r: f.r,
    depth: f.depth + 0.12 * Math.sin(TAU * (beat / LOOP_BEATS) * 2 + i),
    alpha,
    k: 34,
    glint: 0.25 * beatEnvelope(mod(beat, 1), { decay: 5 }),
  };
};

const studio = (beat: number) => ({
  glint: 1 + 0.35 * beatEnvelope(mod(beat, 4), { decay: 2.6, every: 4 }) + 0.12 * beatEnvelope(mod(beat, 1), { decay: 5 }),
  light: 0.22 * Math.sin((TAU * beat) / LOOP_BEATS),
  camera: { x: 500 + 4 * Math.sin((TAU * beat) / LOOP_BEATS), y: 500 + 3 * Math.sin((2 * TAU * beat) / LOOP_BEATS + 0.7) },
});

/** Resolved state at a loop beat (0..LOOP_BEATS). */
export const loopScene = (beat: number): LensScene => ({
  drops: [...CORNERS.map((c, i) => restBead(c, i, beat)), freeDrop(0, beat, 1), freeDrop(1, beat, 1)],
  reveal: { front: 1e4, soft: 200, level: 1, bloom: 0 },
  ...studio(beat),
});

// ------------------------------------------------------------ intro

export const introScene = (beat: number): LensScene => {
  if (beat >= T.settle + T.wipe + 0.5) return loopScene(mod(beat - T.settle, LOOP_BEATS));
  const lb = beat - T.settle; // == the loop beat once settled
  const settle = smooth((beat - (T.settle - 2)) / 2.6);
  const beads = CORNERS.map((c, i): Drop => {
    const b = BEADS[c];
    const p = beadIntroPos(c, beat);
    const rest = restBead(c, i, mod(lb, LOOP_BEATS));
    const appear = smooth((beat - b.appear) / 2.5);
    // The downbeat: every bead flashes as it passes through the focus.
    const land = beatEnvelope(Math.max(0, beat - T.settle + 0.05), { decay: 1.6, attack: 0.05, every: 1e3 });
    return {
      x: p.x,
      y: p.y,
      r: lerp(b.r, rest.r, settle),
      depth: beadDepth(c, beat, rest.depth),
      alpha: appear,
      k: lerp(36, rest.k, settle),
      glint: beat >= T.settle ? Math.max(rest.glint, 1.4 * land) : 0.2 * beatEnvelope(mod(beat - i, 4), { decay: 4, every: 4 }),
    };
  });
  const frees = [0, 1].map((i) => freeDrop(i, lb, smooth((beat - (6 + 2.5 * i)) / 3)));
  const w = clamp01((beat - T.settle) / T.wipe);
  const front = beat < T.settle ? 0 : 1100 * (1 - (1 - w) ** 1.6);
  return {
    drops: [...beads, ...frees],
    reveal: { front, soft: 90, level: 1, bloom: beat < T.settle ? 0 : 0.5 * (1 - w) ** 0.7 },
    ...studio(lb),
  };
};
