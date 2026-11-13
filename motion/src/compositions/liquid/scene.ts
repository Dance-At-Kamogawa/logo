/**
 * Liquid scene model. Pure functions of the beat grid: no clocks, no
 * Math.random (seeded `random` / noise only), so every frame is reproducible.
 *
 * The liquid is a 2D signed-distance field in logo space (0..1000) built from
 * one irregular "puddle" blob plus round-cone primitives (tendrils, drops,
 * beads), smooth-unioned in the shader. The shader lifts the field into a
 * height map and shades it as thick refractive water.
 */
import { random } from "remotion";
import { beatEnvelope } from "../../lib/beat";
import { clamp01, lerp } from "../../lib/easing";
import { PEG_CENTERS } from "../../logo";
import type { Corner } from "../../logo";

/** A round cone from a (radius ra) to b (radius rb). a == b gives a sphere. */
export type Prim = {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly ra: number;
  readonly rb: number;
  /** Width of the rounded edge profile (== radius for a sphere-like drop). */
  readonly w: number;
  /** Height of the liquid at its flat top. */
  readonly h: number;
  /** Smooth-union radius with everything before it (0 = hard union). */
  readonly k: number;
  /** 0 = milky body water (puddle, tendrils), 1 = clear glass-like drop. */
  readonly clear: number;
  /** Extra edge softness in pixels (depth-of-field for far droplets). */
  readonly soft: number;
  readonly alpha: number;
};

export type Harmonic = { readonly amp: number; readonly phase: number };

export const HARMONICS = 12; // k = 2..13

export type Blob = {
  readonly cx: number;
  readonly cy: number;
  readonly r0: number;
  /** Ellipse stretch. */
  readonly sx: number;
  readonly sy: number;
  readonly w: number;
  readonly h: number;
  readonly rim: number;
  /** 0 = milky puddle, 1 = clear drop (before the splash). */
  readonly clear: number;
  readonly harm: readonly Harmonic[];
};

export type Ripple = {
  /** Height amplitude (logo units). */
  readonly amp: number;
  /** Radius of the wave front (logo units). */
  readonly front: number;
};

export type Scene = {
  readonly blob: Blob;
  readonly prims: readonly Prim[];
  readonly ripples: readonly Ripple[];
  /** Offset of the shader's interior smoke noise (moves on a circle per loop). */
  readonly drift: { readonly x: number; readonly y: number };
};

export type StageBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export const MAX_PRIMS = 256;
export const LOOP_BEATS = 16;
export const CENTER = { x: 500, y: 505 } as const;

const TAU = Math.PI * 2;

/** Positive modulo. */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

const rnd = (seed: string): number => random(`liquid:${seed}`);

// ---------------------------------------------------------------- primitives

export const sphere = (
  x: number,
  y: number,
  r: number,
  o: Partial<Pick<Prim, "k" | "soft" | "alpha" | "h" | "clear">> = {},
): Prim => ({
  ax: x,
  ay: y,
  bx: x,
  by: y,
  ra: r,
  rb: r,
  w: r,
  h: o.h ?? r,
  k: o.k ?? 0,
  clear: o.clear ?? 1,
  soft: o.soft ?? 0,
  alpha: o.alpha ?? 1,
});

/**
 * A moving drop: a sphere with a tapered tail pointing back along its
 * velocity (logo units / beat), which reads as a motion-blurred, stretched
 * water drop.
 */
export const movingDrop = (
  x: number,
  y: number,
  r: number,
  vx: number,
  vy: number,
  o: Partial<Pick<Prim, "k" | "soft" | "alpha" | "clear">> & { readonly stretch?: number } = {},
): Prim => {
  const speed = Math.hypot(vx, vy);
  const len = Math.min(r * 7, speed * (o.stretch ?? 0.09));
  if (len < 0.5) return sphere(x, y, r, o);
  const ux = vx / speed;
  const uy = vy / speed;
  // Volume-ish conservation: a stretched drop gets a little thinner.
  const rr = r / Math.sqrt(1 + len / (r * 4));
  return {
    ax: x - ux * len,
    ay: y - uy * len,
    bx: x,
    by: y,
    ra: rr * 0.42,
    rb: rr,
    w: rr,
    h: rr,
    k: o.k ?? 0,
    clear: o.clear ?? 1,
    soft: o.soft ?? 0,
    alpha: o.alpha ?? 1,
  };
};

// ------------------------------------------------------------------ the blob

/** Ellipse radius factor at angle t (matches the shader). */
export const ellipseRadius = (t: number, sx: number, sy: number): number =>
  1 / Math.sqrt((Math.cos(t) / sx) ** 2 + (Math.sin(t) / sy) ** 2);

/** Blob boundary radius at angle t (matches the shader). */
export const blobRadius = (b: Blob, t: number): number =>
  b.r0 * ellipseRadius(t, b.sx, b.sy) + b.harm.reduce((acc, hm, i) => acc + hm.amp * Math.cos((i + 2) * t + hm.phase), 0);

/** Rest shape of the puddle: wide enough that the text sits on its flat top. */
const REST = { r0: 418, sx: 1.2, sy: 0.97, w: 104, h: 74, rim: 0.2 } as const;

const restHarmonics = (beat: number, env: number): Harmonic[] => {
  const phase = beat / LOOP_BEATS;
  return Array.from({ length: HARMONICS }, (_, i) => {
    const k = i + 2;
    // Low orders shape the outline; keep them small so the text area stays flat.
    const base = k === 2 ? 0 : (9 + 10 * rnd(`ha${k}`)) / Math.pow(k - 1, 0.55);
    const cycles = 1 + Math.floor(rnd(`hc${k}`) * 2);
    const sway = 0.45 * Math.sin(TAU * (phase * cycles + rnd(`hs${k}`)));
    return { amp: base * (1 + 0.35 * env), phase: rnd(`hp${k}`) * TAU + sway };
  });
};

// ---------------------------------------------------------------- tendrils

type TendrilDef = {
  /** Degrees; 0 = right, 90 = down (logo space is y-down). */
  readonly angle: number;
  /** Rest length beyond the rim (0 = only exists during the splash). */
  readonly len: number;
  readonly width: number;
  /** Bulb radius at the tip (0 = a plain taper). */
  readonly tip: number;
  /** Extra length during the splash burst. */
  readonly burst: number;
  /** Sideways bend of the middle (fraction of length, signed). */
  readonly bend: number;
};

// Rest tendrils avoid the diagonals, where the glass beads (grommets) sit.
const TENDRILS: readonly TendrilDef[] = [
  { angle: -95, len: 235, width: 30, tip: 15, burst: 230, bend: 0.12 },
  { angle: -68, len: 120, width: 34, tip: 23, burst: 200, bend: -0.1 },
  { angle: -114, len: 85, width: 32, tip: 17, burst: 190, bend: 0.15 },
  { angle: -16, len: 150, width: 27, tip: 13, burst: 240, bend: -0.14 },
  { angle: 17, len: 66, width: 34, tip: 0, burst: 170, bend: 0.1 },
  { angle: 76, len: 185, width: 25, tip: 12, burst: 240, bend: 0.16 },
  { angle: 101, len: 105, width: 32, tip: 21, burst: 200, bend: -0.12 },
  { angle: 165, len: 140, width: 27, tip: 15, burst: 250, bend: 0.12 },
  { angle: -164, len: 58, width: 34, tip: 0, burst: 180, bend: -0.1 },
  { angle: 121, len: 44, width: 30, tip: 0, burst: 160, bend: 0.1 },
  { angle: 60, len: 36, width: 28, tip: 0, burst: 150, bend: -0.1 },
  // Splash-only crown spikes.
  { angle: -40, len: 0, width: 20, tip: 11, burst: 300, bend: 0.08 },
  { angle: -138, len: 0, width: 20, tip: 10, burst: 290, bend: -0.08 },
  { angle: 40, len: 0, width: 18, tip: 10, burst: 280, bend: 0.1 },
  { angle: 140, len: 0, width: 20, tip: 11, burst: 300, bend: -0.1 },
  { angle: -5, len: 0, width: 17, tip: 9, burst: 260, bend: 0.06 },
  { angle: 185, len: 0, width: 17, tip: 9, burst: 270, bend: -0.06 },
];

const tendrilPrims = (blob: Blob, beat: number, env: (delay: number) => number, burst: (i: number) => number): Prim[] => {
  const phase = beat / LOOP_BEATS;
  return TENDRILS.flatMap((t, i) => {
    const sway = 2.2 * Math.sin(TAU * (phase * (1 + (i % 2)) + rnd(`ts${i}`)));
    const ang = ((t.angle + sway) * Math.PI) / 180;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const edge = blobRadius(blob, ang);
    const b = burst(i);
    const pulse = 1 + 0.08 * env(0.08 + (i % 4) * 0.06);
    const len = t.len * pulse * (blob.r0 / REST.r0) + t.burst * b;
    if (len < 4 && b <= 0) return [];
    const width = t.width * (1 - 0.3 * b);
    const ax = blob.cx + ux * (edge - width * 1.4);
    const ay = blob.cy + uy * (edge - width * 1.4);
    const bx = blob.cx + ux * (edge + len);
    const by = blob.cy + uy * (edge + len);
    // Bent in the middle: two cones joined at a sideways-offset knee.
    const bendNow = t.bend * (1 + 0.35 * Math.sin(TAU * (phase * 2 + rnd(`tb${i}`))) + 0.6 * b);
    const kx = (ax + bx) / 2 - uy * bendNow * len;
    const ky = (ay + by) / 2 + ux * bendNow * len;
    const mid = width * 0.55;
    const tail = Math.max(3, width * 0.24);
    const cone1: Prim = { ax, ay, bx: kx, by: ky, ra: width, rb: mid, w: width, h: width * 0.95, k: 44, clear: 0, soft: 0, alpha: 1 };
    const cone2: Prim = { ax: kx, ay: ky, bx, by, ra: mid, rb: tail, w: mid, h: mid * 0.95, k: 14, clear: 0, soft: 0, alpha: 1 };
    const tipR = (t.tip || tail) * (1 + 0.3 * b);
    const tdx = bx - kx;
    const tdy = by - ky;
    const tl = Math.hypot(tdx, tdy) || 1;
    const tip = sphere(bx + (tdx / tl) * tipR * 0.4, by + (tdy / tl) * tipR * 0.4, tipR, { k: 12, clear: 0 });
    return [cone1, cone2, tip];
  });
};

/** Tip position of tendril i at full burst (used to launch satellites). */
const tendrilTip = (blob: Blob, i: number, burstAmount: number): { x: number; y: number } => {
  const t = TENDRILS[i % TENDRILS.length] ?? TENDRILS[0];
  if (!t) return { x: blob.cx, y: blob.cy };
  const ang = (t.angle * Math.PI) / 180;
  const r = blobRadius(blob, ang) + t.len + t.burst * burstAmount;
  return { x: blob.cx + Math.cos(ang) * r, y: blob.cy + Math.sin(ang) * r };
};

// ------------------------------------------------------- floating droplets

export type Floater = {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** 0 = near (sharp, moves more), 1 = far (soft, small, slow). */
  readonly z: number;
  /** Elongated drops point along this angle (radians), or null. */
  readonly stretchAngle: number | null;
  readonly seed: number;
};

const inside = (x: number, y: number, x0: number, y0: number, x1: number, y1: number): boolean =>
  x > x0 && x < x1 && y > y0 && y < y1;

/** Deterministic layout of the ambient droplets for a given stage. */
export const layoutFloaters = (stage: StageBox): Floater[] => {
  const area = stage.width * stage.height;
  const count = Math.round(Math.min(46, Math.max(22, area / 75000)));
  // A few big, close drops framing the logo (like the flyer's corners).
  const out: Floater[] = [
    { x: -150, y: 880, r: 80, z: 0, stretchAngle: null, seed: 200 },
    { x: 1135, y: 70, r: 54, z: 0.05, stretchAngle: null, seed: 201 },
    { x: 720, y: -165, r: 40, z: 0.15, stretchAngle: null, seed: 202 },
    { x: 1170, y: 760, r: 30, z: 0.1, stretchAngle: Math.atan2(760 - CENTER.y, 1170 - CENTER.x), seed: 203 },
  ].filter((f) => inside(f.x, f.y, stage.x + f.r, stage.y + f.r, stage.x + stage.width - f.r, stage.y + stage.height - f.r));
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const s = `f${i}:${attempt}`;
      const x = stage.x + 40 + rnd(`${s}x`) * (stage.width - 80);
      const y = stage.y + 40 + rnd(`${s}y`) * (stage.height - 80);
      const z = rnd(`${s}z`);
      const r = (6 + 58 * Math.pow(rnd(`${s}r`), 2.6)) * (1 - 0.4 * z);
      // Keep clear of the puddle + frame interior (pegs live there) and of each other.
      if (inside(x, y, -40 - r, -40 - r, 1040 + r, 1040 + r)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 70)) continue;
      const stretched = r < 26 && rnd(`${s}st`) < 0.35;
      out.push({
        x,
        y,
        r,
        z,
        stretchAngle: stretched ? Math.atan2(y - CENTER.y, x - CENTER.x) : null,
        seed: i,
      });
      break;
    }
  }
  // A few drops inside the frame, between the puddle and the pegs (like the flyer).
  const innerSpots = [
    { x: 300, y: 92, r: 9 },
    { x: 690, y: 935, r: 12 },
    { x: 955, y: 330, r: 7 },
    { x: 40, y: 640, r: 8 },
  ];
  innerSpots.forEach((p, j) => out.push({ ...p, z: 0.15, stretchAngle: null, seed: 100 + j }));
  return out;
};

/** Rest position (periodic in the loop phase) of a floater. */
const floaterAt = (f: Floater, beat: number): { x: number; y: number; vx: number; vy: number } => {
  const phase = beat / LOOP_BEATS;
  const amp = (10 + 26 * (1 - f.z)) * (f.seed >= 100 ? 0.35 : 1);
  const p0 = rnd(`fp${f.seed}`);
  const cycles = f.z > 0.5 ? 1 : 2;
  const a = TAU * (phase * cycles + p0);
  const dir = rnd(`fd${f.seed}`) < 0.5 ? 1 : -1;
  const x = f.x + amp * Math.cos(a * dir);
  const y = f.y + amp * 0.7 * Math.sin(a * dir) + 6 * Math.sin(TAU * (phase * 4 + p0));
  // d/dbeat
  const w = (TAU * cycles) / LOOP_BEATS;
  return { x, y, vx: -amp * w * dir * Math.sin(a * dir), vy: amp * 0.7 * w * dir * Math.cos(a * dir) };
};

const floaterPrim = (f: Floater, x: number, y: number, scale: number, alpha: number, env: number): Prim => {
  const r = f.r * scale * (1 + 0.04 * env * (1 - f.z));
  const soft = f.z * f.z * 5;
  const al = alpha * (1 - 0.45 * f.z);
  if (f.stretchAngle !== null) {
    const len = r * 2.4;
    const ux = Math.cos(f.stretchAngle);
    const uy = Math.sin(f.stretchAngle);
    return {
      ax: x - ux * len,
      ay: y - uy * len,
      bx: x,
      by: y,
      ra: r * 0.16,
      rb: r * 0.8,
      w: r * 0.8,
      h: r * 0.8,
      k: 0,
      clear: 1,
      soft,
      alpha: al,
    };
  }
  return sphere(x, y, r, { soft, alpha: al });
};

// -------------------------------------------------------------- peg beads

export const PEG_ORDER: readonly Corner[] = ["tl", "tr", "br", "bl"];
const BEAD_R = 47;

const beadPrim = (corner: Corner, beat: number, squash: number): Prim => {
  const c = PEG_CENTERS[corner];
  const i = PEG_ORDER.indexOf(corner);
  const env = beatEnvelope(mod(beat - i * 0.25, LOOP_BEATS), { decay: 7 });
  const r = BEAD_R * (1 + 0.035 * env);
  // A bead "jiggles" by stretching into a short capsule along a rotating axis.
  const s = squash + 0.05 * env;
  if (Math.abs(s) < 0.002) return sphere(c.x, c.y, r, { h: r * 0.85 });
  const ang = TAU * (rnd(`bead${corner}`) + (2 * beat) / LOOP_BEATS);
  const len = r * s;
  const ux = Math.cos(ang) * len;
  const uy = Math.sin(ang) * len;
  const rr = r / (1 + Math.abs(s) * 0.5);
  return {
    ax: c.x - ux,
    ay: c.y - uy,
    bx: c.x + ux,
    by: c.y + uy,
    ra: rr,
    rb: rr,
    w: rr,
    h: rr * 0.85,
    k: 0,
    clear: 1,
    soft: 0,
    alpha: 1,
  };
};

// ---------------------------------------------------------- rest (= loop)

export type RestParts = {
  readonly blob: Blob;
  readonly env: number;
  readonly downbeat: number;
};

const restBlob = (beat: number): RestParts => {
  const b = mod(beat, LOOP_BEATS);
  const env = beatEnvelope(b, { decay: 5 });
  const downbeat = beatEnvelope(b, { decay: 3.5, every: 4 });
  const phase = b / LOOP_BEATS;
  const blob: Blob = {
    cx: CENTER.x + 4 * Math.sin(TAU * phase),
    cy: CENTER.y + 3 * Math.sin(TAU * (phase * 2 + 0.25)),
    r0: REST.r0 * (1 + 0.012 * env + 0.008 * downbeat),
    sx: REST.sx,
    sy: REST.sy,
    w: REST.w,
    h: REST.h * (1 + 0.04 * env),
    rim: REST.rim,
    clear: 0,
    harm: restHarmonics(b, env),
  };
  return { blob, env, downbeat };
};

const smokeDrift = (beat: number): { x: number; y: number } => {
  const a = TAU * (beat / LOOP_BEATS);
  return { x: 0.6 * Math.cos(a), y: 0.6 * Math.sin(a) };
};

const restRipples = (beat: number): Ripple[] =>
  // One ring per beat travelling out from the centre; two alive at a time.
  [0, 1].map((n) => {
    const age = mod(beat, 1) + n;
    const accent = mod(Math.floor(beat) - n, 4) === 0 ? 1.8 : 1;
    return { amp: 0.42 * accent * Math.exp(-age * 1.6), front: 60 + age * 260 };
  });

/** Everything at rest, for any beat (periodic with LOOP_BEATS). */
export const restScene = (beat: number, floaters: readonly Floater[]): Scene => {
  const b = mod(beat, LOOP_BEATS);
  const { blob } = restBlob(b);
  const env = (delay: number): number => beatEnvelope(mod(b - delay, LOOP_BEATS), { decay: 5 });
  const prims: Prim[] = [
    ...tendrilPrims(blob, b, env, () => 0),
    ...PEG_ORDER.map((c) => beadPrim(c, b, 0)),
    ...floaters.map((f) => {
      const p = floaterAt(f, b);
      return floaterPrim(f, p.x, p.y, 1, 1, env(0));
    }),
  ];
  return { blob, prims, ripples: restRipples(b), drift: smokeDrift(b) };
};

// ------------------------------------------------------- intro timeline

/** Key beats of the Liquid intro (relative to its start). */
export const T = {
  heroIn: 0,
  heroLand: 4.5,
  streamFirst: 4.2,
  streamLast: 7.4,
  splash: 8,
  frameFrom: 9,
  frameTo: 11.5,
  beadLaunch: 9.4,
  beadLand: 11.5,
  danceFrom: 12.5,
  kamoFrom: 13.4,
  total: 24,
} as const;

const STREAM = 11;

type Stream = { readonly angle: number; readonly r: number; readonly arrive: number; readonly swirl: number };
const STREAMS: readonly Stream[] = Array.from({ length: STREAM }, (_, i) => ({
  angle: TAU * (i / STREAM + 0.07 * (rnd(`sa${i}`) - 0.5)),
  r: 13 + 15 * rnd(`sr${i}`),
  arrive: lerp(T.streamFirst, T.streamLast, i / (STREAM - 1)) + 0.25 * (rnd(`sw${i}`) - 0.5),
  swirl: (rnd(`ss${i}`) - 0.5) * 2,
}));

const HERO_R = 42;
const STREAM_TRAVEL = 2.6; // beats

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3);
const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

/** Damped spring 0 -> 1 with overshoot, in beats. */
const springBeats = (t: number, freq = 5.2, decay = 3.1): number => {
  if (t <= 0) return 0;
  return 1 - Math.exp(-decay * t) * Math.cos(freq * t);
};

export const heroPos = (beat: number): { x: number; y: number } => {
  const u = easeInOutSine((beat - T.heroIn) / (T.heroLand - T.heroIn));
  // Slow, slightly curved fall from top-left.
  const x = lerp(330, CENTER.x, u) + 70 * Math.sin(u * Math.PI);
  const y = lerp(-380, CENTER.y, u);
  return { x, y };
};

const streamPos = (s: Stream, beat: number): { x: number; y: number } => {
  const u = easeInCubic((beat - (s.arrive - STREAM_TRAVEL)) / STREAM_TRAVEL);
  const dist = 1500 * (1 - u);
  const ang = s.angle + s.swirl * 0.5 * (1 - u) * Math.sin(u * Math.PI);
  return { x: CENTER.x + Math.cos(ang) * dist, y: CENTER.y + Math.sin(ang) * dist };
};

const velocity = (f: (b: number) => { x: number; y: number }, beat: number): { vx: number; vy: number } => {
  const e = 0.02;
  const a = f(beat - e);
  const b = f(beat + e);
  return { vx: (b.x - a.x) / (2 * e), vy: (b.y - a.y) / (2 * e) };
};

/** Absorbed liquid area (as an equivalent radius) before the splash. */
const absorbedRadius = (beat: number): number => {
  const absorbed = (arrive: number, r: number): number => r * r * clamp01((beat - arrive) / 0.35);
  const area = absorbed(T.heroLand, HERO_R) + STREAMS.reduce((acc, s) => acc + absorbed(s.arrive, s.r), 0);
  return Math.sqrt(area) * 1.12;
};

/** Which tendril each floater is flung from, and when. */
const launchOf = (f: Floater): { tendril: number; at: number; dur: number } => {
  const ang = Math.atan2(f.y - CENTER.y, f.x - CENTER.x);
  let best = 0;
  let bestD = Infinity;
  TENDRILS.forEach((t, i) => {
    const d = Math.abs(mod((t.angle * Math.PI) / 180 - ang + Math.PI, TAU) - Math.PI);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  const dist = Math.hypot(f.x - CENTER.x, f.y - CENTER.y);
  return { tendril: best, at: T.splash + 0.22 + 0.35 * rnd(`la${f.seed}`), dur: 1.6 + dist / 900 };
};

export type IntroState = {
  readonly scene: Scene;
  /** 0..1 frame draw-in. */
  readonly frameDraw: number;
  /** Peg ring reveal per corner (0..1). */
  readonly rings: Readonly<Record<Corner, number>>;
};

/** The Liquid intro at a given beat (converges to `restScene(beat - splash)`). */
export const introScene = (beat: number, floaters: readonly Floater[]): IntroState => {
  const s = beat - T.splash; // beats since splash
  const restBeat = mod(s, LOOP_BEATS);
  const rest = restBlob(restBeat);
  const env = (delay: number): number => (s < 0 ? 0 : beatEnvelope(mod(restBeat - delay, LOOP_BEATS), { decay: 5 }));
  const prims: Prim[] = [];

  // --- Blob: grows by absorbing drops, anticipates, then splashes to rest.
  const pre = absorbedRadius(beat);
  const anticip = s < 0 ? 1 - 0.18 * easeInCubic((beat - (T.splash - 0.6)) / 0.6) : 1;
  const sp = springBeats(s);
  const crown = s < 0 ? 0 : Math.exp(-s * 1.4) * Math.min(1, s / 0.12);
  const wob = s < 0 ? 0 : Math.exp(-s * 0.9);
  const preHarm: Harmonic[] = Array.from({ length: HARMONICS }, (_, i) => {
    const k = i + 2;
    // Pre-splash: a jelly-like low-order wobble while drops merge in.
    const preAmp = k <= 4 ? pre * 0.06 * Math.sin(beat * (2.2 + k) + k) : 0;
    const crownAmp = k >= 9 ? 26 * crown * (k % 2 === 1 ? 1 : 0.55) : k <= 4 ? 30 * wob * Math.sin(s * 4.5 + k) : 0;
    const restH = rest.blob.harm[i] ?? { amp: 0, phase: 0 };
    return s < 0 ? { amp: preAmp, phase: k * 1.3 } : { amp: restH.amp * clamp01(sp) + crownAmp, phase: restH.phase };
  });
  const blob: Blob =
    s < 0
      ? { cx: CENTER.x, cy: CENTER.y, r0: pre * anticip, sx: 1, sy: 1, w: Math.max(10, pre), h: Math.max(10, pre * 0.85), rim: 0, clear: 0.8, harm: preHarm }
      : {
          ...rest.blob,
          r0: lerp(pre * anticip, rest.blob.r0, sp),
          sx: lerp(1, REST.sx, clamp01(sp)),
          sy: lerp(1, REST.sy, clamp01(sp)),
          w: lerp(pre, REST.w, clamp01(s / 1.5)),
          h: lerp(pre * 0.85, rest.blob.h, clamp01(s / 1.5)) * (1 + 0.25 * crown),
          rim: REST.rim * clamp01(s / 1.5),
          clear: 0.8 * (1 - clamp01(s / 1.2)),
          harm: preHarm,
        };

  // --- Hero drop + streaming drops (before they are absorbed).
  if (beat < T.heroLand + 0.35) {
    const p = heroPos(beat);
    const v = velocity(heroPos, beat);
    const left = 1 - clamp01((beat - T.heroLand) / 0.35);
    const breathe = 1 + 0.04 * Math.sin(beat * 3.1);
    prims.push(movingDrop(p.x, p.y, HERO_R * breathe * Math.sqrt(left), v.vx, v.vy, { k: 42, stretch: 0.045, clear: 0.8 }));
  }
  STREAMS.forEach((st) => {
    const start = st.arrive - STREAM_TRAVEL;
    if (beat < start || beat > st.arrive + 0.35) return;
    const p = streamPos(st, beat);
    const v = velocity((b) => streamPos(st, b), beat);
    const left = 1 - clamp01((beat - st.arrive) / 0.35);
    prims.push(movingDrop(p.x, p.y, st.r * Math.sqrt(left), v.vx, v.vy, { k: 46, stretch: 0.055, clear: 0.6 }));
  });

  // --- Tendrils: burst out on the splash, relax to their rest length.
  if (s >= 0) {
    const burst = (i: number): number => {
      const t = s - (i % 5) * 0.025;
      if (t <= 0) return 0;
      const up = easeOutCubic(t / 0.45);
      const down = Math.exp(-Math.max(0, t - 0.45) * 1.7);
      return up * down;
    };
    const growIn = clamp01(s / 0.25);
    const scaled: Blob = { ...blob };
    prims.push(
      ...tendrilPrims(scaled, restBeat, env, burst).map((p) => ({ ...p, ra: p.ra * growIn, rb: p.rb * growIn })),
    );
  }

  // --- Peg beads: flung from the splash to the four corners.
  const rings: Record<Corner, number> = { tl: 0, tr: 0, bl: 0, br: 0 };
  PEG_ORDER.forEach((corner, i) => {
    const launch = T.beadLaunch + i * 0.12;
    const land = T.beadLand + i * 0.18;
    if (beat < launch) return;
    const target = PEG_CENTERS[corner];
    const toward = Math.atan2(target.y - CENTER.y, target.x - CENTER.x);
    const startR = blobRadius(blob, toward) * 0.85;
    const from = { x: CENTER.x + Math.cos(toward) * startR, y: CENTER.y + Math.sin(toward) * startR };
    if (beat < land) {
      const path = (b: number): { x: number; y: number } => {
        const u = easeInOutSine((b - launch) / (land - launch));
        // Arc: bulge perpendicular to the flight direction.
        const nx = -Math.sin(toward);
        const ny = Math.cos(toward);
        const bulge = 120 * Math.sin(u * Math.PI) * (i % 2 === 0 ? 1 : -1);
        return { x: lerp(from.x, target.x, u) + nx * bulge, y: lerp(from.y, target.y, u) + ny * bulge };
      };
      const p = path(beat);
      const v = velocity(path, beat);
      const grow = 0.45 + 0.55 * easeOutCubic((beat - launch) / (land - launch));
      prims.push(movingDrop(p.x, p.y, BEAD_R * grow, v.vx, v.vy, { stretch: 0.06, k: 14 }));
    } else {
      const t = beat - land;
      const squash = 0.55 * Math.exp(-t * 2.4) * Math.cos(t * 13);
      prims.push(beadPrim(corner, restBeat, squash));
      rings[corner] = clamp01(t / 0.6);
    }
  });

  // --- Satellites: flung from tendril tips, drifting into their rest spots.
  if (s >= 0) {
    floaters.forEach((f) => {
      const l = launchOf(f);
      const local = beat - l.at;
      if (local < 0) return;
      const u = local / l.dur;
      const from = tendrilTip(blob, l.tendril, 1);
      const path = (b: number): { x: number; y: number } => {
        const uu = easeOutCubic((b - l.at) / l.dur);
        const r = floaterAt(f, mod(b - T.splash, LOOP_BEATS));
        return { x: lerp(from.x, r.x, uu), y: lerp(from.y, r.y, uu) };
      };
      const p = path(beat);
      const v = velocity(path, beat);
      const scale = 0.35 + 0.65 * easeOutCubic(u * 1.5);
      if (u >= 1) {
        const r = floaterAt(f, restBeat);
        prims.push(floaterPrim(f, r.x, r.y, 1, 1, env(0)));
      } else {
        const fp = floaterPrim(f, p.x, p.y, scale, clamp01(local / 0.15), env(0));
        // Flight streak, on top of the drop's own shape.
        const streak = movingDrop(p.x, p.y, f.r * scale * (1 - 0.45 * f.z), v.vx, v.vy, { stretch: 0.05, soft: fp.soft, alpha: fp.alpha });
        prims.push(Math.hypot(v.vx, v.vy) > 60 ? streak : fp);
      }
    });
  }

  // --- Ripples: the splash ring, then the regular beat rings.
  const ripples: Ripple[] =
    s < 0
      ? []
      : [
          { amp: 4 * Math.exp(-s * 1.1), front: 60 + s * 330 },
          ...restRipples(restBeat).map((r) => ({ ...r, amp: r.amp * clamp01((s - 2) / 2) })),
        ];

  return {
    scene: { blob, prims: prims.slice(0, MAX_PRIMS), ripples, drift: smokeDrift(restBeat) },
    frameDraw: easeInOutSine((beat - T.frameFrom) / (T.frameTo - T.frameFrom)),
    rings,
  };
};
