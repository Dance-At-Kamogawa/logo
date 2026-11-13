/**
 * Night-river scene model (水面と波紋). Pure functions of the beat grid: no
 * clocks, no Math.random (seeded `random` only), so every frame is
 * reproducible.
 *
 * The water is a height field: a few slow plane waves (the river's own
 * undulation) plus one damped radial wave packet per raindrop. The shader
 * evaluates height, gradient and Hessian analytically, refracts the logo
 * (which lies on the riverbed) and lights the bed with the caustics the
 * ripples focus onto it. On still water the bed is dark, so the logo is only
 * seen in the fragments that ripples happen to light.
 */
import { random } from "remotion";
import { clamp01 } from "../../lib/easing";
import { PEG_CENTERS } from "../../logo";
import type { Corner } from "../../logo";

export const LOOP_BEATS = 16;
export const MAX_DROPS = 96;
export const WAVES = 5;

const TAU = Math.PI * 2;

/** Positive modulo. */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

const rnd = (seed: string): number => random(`ripple:${seed}`);

/**
 * Ripple physics shared by the shader (uniforms) and the tile culling.
 * Distances in logo units, time in beats.
 */
export const RIPPLE = {
  /** Speed of the main ring (logo units / beat) for a size-1 drop. */
  speed: 112,
  /** Carrier wavelength of the main ring. */
  wavelength: 24,
  /** Packet half-width at impact and its growth per unit of travel (dispersion). */
  sigma0: 14,
  spread: 0.2,
  /** Amplitude decay per beat. */
  decay: 0.42,
  /** Beats after which a drop is dropped from the active list. */
  life: 8,
  /** Pre-impact beats in which the falling drop shows as a tiny dot. */
  fall: 0.14,
} as const;

/** Radius (logo units) beyond / within which a drop no longer changes the surface. */
export const dropReach = (age: number, size: number): { inner: number; outer: number } => {
  if (age < 0) return { inner: 0, outer: 12 };
  const c = RIPPLE.speed * Math.sqrt(size);
  const front = c * age;
  const sigma = RIPPLE.sigma0 * size + RIPPLE.spread * front;
  // Second, slower capillary packet trails at 0.55 x the front.
  const inner2 = front * 0.55 - 3.3 * sigma * 0.7;
  return {
    inner: Math.max(0, Math.min(front - 3.3 * sigma, inner2) - 30 * size),
    outer: front + 3.3 * sigma + 40 * size,
  };
};

export type Drop = {
  /** Impact beat. */
  readonly t: number;
  readonly x: number;
  readonly y: number;
  /** Height amplitude (logo units) of the main ring at impact. */
  readonly amp: number;
  /** Scales wavelength and speed (bigger drop = longer, faster rings). */
  readonly size: number;
  /** Strength of the impact glint. */
  readonly flash: number;
};

export type ActiveDrop = Drop & { readonly age: number };

export type Wave = { readonly kx: number; readonly ky: number; readonly amp: number; readonly phase: number };

/** A point light on the riverbed (the travelling highlight along the frame). */
export type Sweep = { readonly x: number; readonly y: number; readonly intensity: number; readonly radius: number };

export type WaterScene = {
  readonly drops: readonly ActiveDrop[];
  readonly waves: readonly Wave[];
  /** Bed light: 0 = still water hides the logo, 1 = resolved (spatially developed in the shader). */
  readonly develop: number;
  /** Final bed light level once developed. */
  readonly ambient: number;
  /** Extra early development around the four pegs. */
  readonly pegGlow: number;
  readonly sweeps: readonly [Sweep, Sweep];
  /** Streak drift, 0..1 per loop (the streak pattern is periodic in it). */
  readonly drift: number;
};

export type StageBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

// ------------------------------------------------------------ the river

/**
 * The river's own slow undulation: a handful of long plane waves, each a
 * whole number of cycles per loop so LiquidLoop closes exactly.
 */
const WAVE_DEFS = [
  { len: 620, angle: -8, amp: 1.5, cycles: 1 },
  { len: 410, angle: 17, amp: 0.9, cycles: 2 },
  { len: 230, angle: -31, amp: 0.38, cycles: 3 },
  { len: 150, angle: 64, amp: 0.16, cycles: 4 },
  { len: 97, angle: -72, amp: 0.07, cycles: 5 },
] as const;

export const riverWaves = (beat: number, calm = 1): Wave[] => {
  const phase = beat / LOOP_BEATS;
  return WAVE_DEFS.map((w, i) => {
    const k = TAU / w.len;
    const a = (w.angle * Math.PI) / 180;
    return {
      kx: k * Math.cos(a),
      ky: k * Math.sin(a),
      amp: w.amp * calm,
      phase: TAU * (rnd(`w${i}`) - phase * w.cycles),
    };
  });
};

// ------------------------------------------------------------ rain

type Hit = {
  readonly beat: number;
  /** Relative strength. */
  readonly amp?: number;
  /** Inclusion weight: kept when rnd < weight x rainDensity (fixed-position hits always). */
  readonly w?: number;
  /** Fixed position (the pegs). */
  readonly at?: { readonly x: number; readonly y: number };
  readonly size?: number;
};

const PEGS: readonly Corner[] = ["tl", "tr", "br", "bl"];

const pegHits = (beat: number): Hit[] =>
  PEGS.map((c) => ({ beat, at: PEG_CENTERS[c], amp: 1.25, size: 1.1 }));

type Region = { x0: number; y0: number; x1: number; y1: number };

/**
 * Seeded scatter. Most drops land on the logo (so the ripples have something
 * to reveal), the rest anywhere in view; consecutive drops keep apart so the
 * fragments wander.
 */
const place = (key: string, i: number, prev: readonly { x: number; y: number }[], stage: StageBox): { x: number; y: number } => {
  const text: Region = { x0: 110, y0: 390, x1: 890, y1: 600 };
  const logo: Region = { x0: 30, y0: 30, x1: 970, y1: 970 };
  const view: Region = { x0: stage.x + 60, y0: stage.y + 60, x1: stage.x + stage.width - 60, y1: stage.y + stage.height - 60 };
  let best = { x: 500, y: 500 };
  let bestD = -1;
  for (let a = 0; a < 24; a++) {
    const s = `${key}${i}:${a}`;
    const u = rnd(`${s}r`);
    const reg = u < 0.5 ? text : u < 0.82 ? logo : view;
    const x = reg.x0 + rnd(`${s}x`) * (reg.x1 - reg.x0);
    const y = reg.y0 + rnd(`${s}y`) * (reg.y1 - reg.y0);
    const d = Math.min(1e9, ...prev.slice(-4).map((p) => Math.hypot(p.x - x, p.y - y)));
    if (d > 260) return { x, y };
    if (d > bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
};

const realize = (key: string, hits: readonly Hit[], stage: StageBox, density: number): Drop[] => {
  const out: Drop[] = [];
  hits.forEach((h, i) => {
    // Fixed drops (the pegs) always fall; the rest thin out with the density.
    if (!h.at && rnd(`${key}keep${i}`) >= (h.w ?? 1) * density) return;
    const pos = h.at ?? place(key, i, out, stage);
    const size = h.size ?? 0.8 + 0.45 * rnd(`${key}s${i}`);
    out.push({
      t: h.beat,
      x: pos.x,
      y: pos.y,
      amp: (h.amp ?? 1) * (0.8 + 0.4 * rnd(`${key}a${i}`)),
      size,
      flash: 0.7 + 0.6 * rnd(`${key}f${i}`),
    });
  });
  return out;
};

/** Key beats of the Liquid intro. */
export const T = {
  /** Bar downbeat on which the four drops land on the pegs. */
  climax: 16,
  /** The surface has calmed and the logo is fully developed. */
  resolved: 23,
  total: 28,
} as const;

/**
 * Liquid: rain builds from a single drop to a groove, the four-peg downbeat,
 * a few last drops, then calm. Off-beat doubles (x.5 / x.75) add swing.
 */
const INTRO_HITS: readonly Hit[] = [
  { beat: 1.0, amp: 1.1 },
  { beat: 3.5, w: 0.9 },
  { beat: 4.0 },
  { beat: 5.5, w: 0.7 },
  { beat: 6.0 },
  { beat: 7.0 },
  { beat: 7.75, amp: 0.7, w: 0.6 },
  { beat: 8.0, amp: 1.1 },
  { beat: 9.0 },
  { beat: 9.5, amp: 0.8, w: 0.6 },
  { beat: 10.0 },
  { beat: 10.75, amp: 0.7, w: 0.5 },
  { beat: 11.0 },
  { beat: 11.5, amp: 0.8 },
  { beat: 11.5, amp: 0.6, w: 0.6 },
  { beat: 12.0, amp: 1.1 },
  { beat: 12.75, amp: 0.7, w: 0.6 },
  { beat: 13.0 },
  { beat: 13.5, amp: 0.8 },
  { beat: 14.0 },
  { beat: 14.5, amp: 0.8, w: 0.8 },
  { beat: 14.75, amp: 0.6, w: 0.5 },
  { beat: 15.0 },
  { beat: 15.5, amp: 0.8 },
  { beat: 15.75, amp: 0.6, w: 0.7 },
  ...pegHits(T.climax),
  { beat: 17.5, amp: 0.7, w: 0.8 },
  { beat: 18.5, amp: 0.6, w: 0.7 },
  { beat: 20.0, amp: 0.55, w: 0.6 },
  { beat: 22.0, amp: 0.45, w: 0.5 },
];

/**
 * LiquidLoop: one hit per beat, off-beat doubles that alternate per bar, and
 * the four-peg drop on the loop's downbeat.
 */
const LOOP_HITS: readonly Hit[] = [
  ...pegHits(0),
  ...Array.from({ length: LOOP_BEATS - 1 }, (_, i): Hit => ({ beat: i + 1, amp: (i + 1) % 4 === 0 ? 1.05 : 0.85 })),
  ...[1.5, 2.5, 3.5, 9.5, 10.5, 11.5].map((beat): Hit => ({ beat, amp: 0.65, w: 0.55 })),
  ...[6.75, 7.5, 7.75, 14.75, 15.25, 15.5].map((beat): Hit => ({ beat, amp: 0.6, w: 0.5 })),
];

const cache = new Map<string, Drop[]>();
const schedule = (key: "intro" | "loop", stage: StageBox, density: number): Drop[] => {
  const id = `${key}:${stage.x.toFixed(1)}:${stage.y.toFixed(1)}:${density}`;
  let d = cache.get(id);
  if (!d) {
    d = realize(key, key === "intro" ? INTRO_HITS : LOOP_HITS, stage, density);
    cache.set(id, d);
  }
  return d;
};

const active = (drops: readonly Drop[], ageOf: (d: Drop) => number): ActiveDrop[] =>
  drops
    .map((d) => ({ ...d, age: ageOf(d) }))
    .filter((d) => d.age > -RIPPLE.fall && d.age < RIPPLE.life)
    // Newest first, so the cap only ever drops the faintest rings.
    .sort((a, b) => a.age - b.age)
    .slice(0, MAX_DROPS);

// ------------------------------------------------------------ highlights

const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/**
 * Two lights run along the hairline frame from the top-left corner, one each
 * way, and meet at the bottom-right (age in beats since the peg downbeat).
 */
const frameSweeps = (age: number): [Sweep, Sweep] => {
  const dur = 3.2;
  const u = smooth(age / dur);
  const fade = age < 0 ? 0 : Math.min(1, age / 0.25) * (1 - smooth((age - dur * 0.7) / (dur * 0.45)));
  const lo = 6.957;
  const hi = 993.043;
  const along = (s: number, clockwise: boolean): { x: number; y: number } => {
    // s in 0..2 = half the perimeter, in side lengths.
    const a = Math.min(1, s);
    const b = Math.max(0, s - 1);
    if (clockwise) return s <= 1 ? { x: lo + (hi - lo) * a, y: lo } : { x: hi, y: lo + (hi - lo) * b };
    return s <= 1 ? { x: lo, y: lo + (hi - lo) * a } : { x: lo + (hi - lo) * b, y: hi };
  };
  const p = along(2 * u, true);
  const q = along(2 * u, false);
  const intensity = 2.6 * fade;
  return [
    { ...p, intensity, radius: 70 },
    { ...q, intensity, radius: 70 },
  ];
};

// ------------------------------------------------------------ scenes

/** Liquid at a given beat. */
export const introWater = (beat: number, stage: StageBox, density: number): WaterScene => {
  const drops = active(schedule("intro", stage, density), (d) => beat - d.t);
  const develop = smooth((beat - (T.climax + 0.4)) / (T.resolved - T.climax - 0.4));
  return {
    drops,
    // The river itself settles a little once the rain stops.
    waves: riverWaves(beat, 1 - 0.35 * smooth((beat - T.climax) / 8)),
    develop,
    ambient: 1,
    pegGlow: smooth((beat - T.climax - 0.15) / 1.4),
    sweeps: frameSweeps(beat - T.climax),
    drift: beat / LOOP_BEATS,
  };
};

/** LiquidLoop at a given beat (periodic with LOOP_BEATS). */
export const loopWater = (beat: number, stage: StageBox, density: number): WaterScene => {
  const b = mod(beat, LOOP_BEATS);
  const drops = active(schedule("loop", stage, density), (d) => {
    const age = mod(b - d.t, LOOP_BEATS);
    // Show the falling dot just before the impact, across the loop seam too.
    return age > LOOP_BEATS - RIPPLE.fall ? age - LOOP_BEATS : age;
  });
  const sweepAge = mod(b, LOOP_BEATS);
  return {
    drops,
    waves: riverWaves(b, 0.65),
    develop: 1,
    ambient: 0.7,
    pegGlow: 1,
    sweeps: frameSweeps(sweepAge > LOOP_BEATS - 1 ? sweepAge - LOOP_BEATS : sweepAge),
    drift: b / LOOP_BEATS,
  };
};
