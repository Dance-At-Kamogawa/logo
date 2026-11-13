/**
 * Caustic projection scene model (コースティクス投影). Pure functions of the
 * beat grid (no clocks, seeded `random` only), so every frame is
 * reproducible.
 *
 * A body of water floats in the dark; a light above it shines through and
 * the floor below catches the caustic network. The network is a mesh of
 * light rays (see shaders.ts): each ray is displaced by the gradient of the
 * water's wobbling surface (a sum of plane waves + one expanding "speaker
 * cone" ring per kick + a focusing rim at the edge of the light pool), and,
 * as `logo.s` goes to 1, by the "logo lens" that squeezes the light into the
 * strokes of the DAK logo.
 */
import { random } from "remotion";
import { clamp01, lerp } from "../../lib/easing";

export const NW = 10;
export const NDROPS = 3;
/** Intro length and the loop length, in beats. */
export const T = { light: 2.5, tease: 12, converge: 16, settle: 19, total: 28 } as const;
export const LOOP_BEATS = 16;
/** Camera distance above the floor (logo units). */
export const CAM_DIST = 1800;

const TAU = Math.PI * 2;
export const mod = (a: number, n: number): number => ((a % n) + n) % n;
const rnd = (seed: string): number => random(`caustics:${seed}`);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export type Wave = { readonly kx: number; readonly ky: number; readonly focus: number; readonly phase: number };
export type Ring = { readonly x: number; readonly y: number; readonly amp: number; readonly radius: number; readonly width: number };
export type Pool = {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** Superellipse exponent: 2 = round, 6 = rounded square. */
  readonly exp: number;
  readonly soft: number;
  readonly rim: number;
  readonly rimWidth: number;
  /** Outline harmonics (k=2,3): amp, phase. */
  readonly h: readonly [number, number, number, number];
};
export type Logo = { readonly s: number; readonly b1: number; readonly b2: number; readonly delta: number };
export type Drop = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  /** Wobble amplitude (fraction of r), wobble phase, vertical squash (+ = flattened), seed. */
  readonly wobble: number;
  readonly phase: number;
  readonly squash: number;
  readonly seed: number;
};
export type Camera = {
  /** Logo-space point looked at. */
  readonly x: number;
  readonly y: number;
  /** Radians from straight down. */
  readonly pitch: number;
  readonly yaw: number;
  readonly zoom: number;
};
export type CausticScene = {
  readonly waves: readonly Wave[];
  readonly ring: Ring;
  readonly pool: Pool;
  readonly logo: Logo;
  /** Weight of the surface-wave displacement: coarse swell, fine chop. */
  readonly noiseGain: readonly [number, number];
  /** Light intensity (0 = off). */
  readonly light: number;
  readonly exposure: number;
  /** Crisp logo emission (0..1). */
  readonly overlay: number;
  readonly camera: Camera;
  readonly drops: readonly Drop[];
};

// ------------------------------------------------------------- beat shapes

/** Kick envelope: sharp attack on every beat, exponential decay. */
const kick = (t: number, decay = 5): number => {
  const f = mod(t, 1);
  return f < 0.03 ? f / 0.03 : Math.exp(-(f - 0.03) * decay);
};
/** Monotone beat counter with a jolt on every beat (continuous). */
const kickCum = (t: number): number => {
  const f = mod(t, 1);
  return Math.floor(t) + (1 - Math.exp(-6 * f)) / (1 - Math.exp(-6));
};
/** Damped "speaker cone" oscillation after each kick, back to 0 by the next beat. */
const cone = (t: number): number => {
  const f = mod(t, 1);
  return Math.sin(TAU * 2.5 * f) * Math.exp(-3 * f) * (1 - f) * (1 - f);
};

// ------------------------------------------------------------- surface waves

type WaveSeed = {
  readonly theta: number;
  readonly lambda: number;
  readonly gridTheta: number;
  readonly gridLambda: number;
  readonly focus: number;
  readonly phase0: number;
  /** Whole cycles per loop (drift) and jolt steps per loop: periodic in LOOP_BEATS. */
  readonly drift: number;
  readonly jolt: number;
};

const WAVE_SEEDS: readonly WaveSeed[] = Array.from({ length: NW }, (_, i) => {
  const coarse = i < 3;
  const theta = rnd(`th${i}`) * Math.PI;
  const lambda = coarse ? lerp(360, 520, rnd(`la${i}`)) : lerp(70, 150, rnd(`la${i}`));
  // Organised state: axis/diagonal directions, wavelengths dividing the square.
  const gridTheta = (Math.round(theta / (Math.PI / 4)) % 4) * (Math.PI / 4);
  const div = Math.max(2, Math.round(1000 / lambda));
  return {
    theta,
    lambda,
    gridTheta,
    gridLambda: (gridTheta % (Math.PI / 2) === 0 ? 1000 : 1000 * Math.SQRT2) / (div + (gridTheta % (Math.PI / 2) === 0 ? 0 : 1)),
    focus: coarse ? 0.45 : 0.3,
    phase0: rnd(`ph${i}`) * TAU,
    drift: (rnd(`dr${i}`) < 0.5 ? 1 : 2) * (rnd(`ds${i}`) < 0.5 ? -1 : 1),
    jolt: rnd(`jo${i}`) < 0.5 ? -1 : 1,
  };
});

const angleLerp = (a: number, b: number, t: number): number => {
  let d = mod(b - a + Math.PI / 2, Math.PI) - Math.PI / 2;
  if (d < -Math.PI / 2) d += Math.PI;
  return a + d * t;
};

const waves = (t: number, org: number, focusMul: number): Wave[] =>
  WAVE_SEEDS.map((w) => {
    const th = angleLerp(w.theta, w.gridTheta, org);
    const la = lerp(w.lambda, w.gridLambda, org);
    const k = TAU / la;
    const phase = w.phase0 + (TAU * w.drift * t) / LOOP_BEATS + ((TAU * w.jolt) / LOOP_BEATS) * 2 * kickCum(t);
    return { kx: k * Math.cos(th), ky: k * Math.sin(th), focus: w.focus * focusMul * lerp(1, 0.85, org), phase };
  });

// ------------------------------------------------------------- drops

/** Screen-space spot (fraction of width/height from the centre) of the resting blob. */
const restSpot = (aspect: number): { sx: number; sy: number } =>
  aspect > 1.2 ? { sx: 0.31, sy: -0.2 } : { sx: 0.39, sy: -0.39 };

const REST_Z = 520;
const MAIN_R = 66;

/**
 * World position that projects to `restSpot` under the final top-down
 * camera (target 500,500, zoom 1).
 */
const restMain = (aspect: number, unit: number, width: number, height: number): { x: number; y: number } => {
  const s = restSpot(aspect);
  const k = (CAM_DIST - REST_Z) / (unit * CAM_DIST);
  return { x: 500 + s.sx * width * k, y: 500 + s.sy * height * k };
};

const satellites = (main: { x: number; y: number; z: number }, t: number, jig: number, settle: number): Drop[] =>
  [0, 1].map((i) => {
    const a = (TAU * (i === 0 ? 1 : -1) * t) / LOOP_BEATS + i * 2.4;
    const rad = lerp(150, 118, settle) + i * 36;
    return {
      x: main.x + rad * Math.cos(a),
      y: main.y + rad * 0.8 * Math.sin(a),
      z: main.z - 70 + 40 * i + 10 * Math.sin((TAU * 2 * t) / LOOP_BEATS + i),
      r: i === 0 ? 17 : 10,
      wobble: 0.05 + 0.1 * jig * kick(t - 0.06 * (i + 1), 6),
      phase: (TAU * 3 * t) / LOOP_BEATS + 0.3 * cone(t),
      squash: 0.16 * jig * cone(t - 0.06 * (i + 1)),
      seed: 3.1 + i * 1.7,
    };
  });

export type Frame = { readonly unit: number; readonly width: number; readonly height: number };

// ------------------------------------------------------------- intro

export const introScene = (t: number, fr: Frame, jiggle: number): CausticScene => {
  const aspect = fr.width / fr.height;
  const settle = smooth(T.converge, T.settle, t);
  // The water jiggles hard before the logo, relaxes after it.
  const jig = jiggle * lerp(1, 0.32, settle);
  const org = easeInOutSine((t - 8) / (T.converge - 0.5 - 8));
  const tease = Math.exp(-Math.pow((t - T.tease - 0.15) / 0.45, 2)) * 0.2;
  const s = Math.max(tease, easeInOutCubic((t - (T.converge - 1)) / 1));
  const resid = 0.22;
  const focusMul = (1 + 0.55 * jig * kick(t)) * lerp(1, 1.12, smooth(10, 15.5, t));

  const grow = easeInOutSine((t - 1) / (T.converge - 0.6 - 1));
  const poolX = lerp(585, 500, grow);
  const poolY = lerp(520, 500, grow);
  const pool: Pool = {
    x: poolX,
    y: poolY,
    r: lerp(230, 720, grow),
    exp: lerp(2, 7, smooth(11, 16, t)),
    soft: lerp(55, 170, smooth(10, 16.5, t)),
    rim: lerp(26, 0, smooth(12, 16.5, t)) * (1 + 0.3 * jig * kick(t)),
    rimWidth: 26,
    h: [0.06 * (1 - settle) + 0.03 * jig * cone(t), 0.6 + 0.15 * t, 0.04 * (1 - settle), 1.7 - 0.11 * t],
  };
  const ringFront = 60 + 520 * mod(t, 1);
  const ring: Ring = {
    x: poolX,
    y: poolY,
    amp: 16 * jig * Math.exp(-2.2 * mod(t, 1)) * smooth(0.5, 3, t),
    radius: ringFront,
    width: 70,
  };

  const view = easeInOutSine(t / (T.settle - 1));
  const camera: Camera = {
    x: lerp(590, 500, view),
    y: lerp(640, 500, view),
    pitch: lerp((50 * Math.PI) / 180, 0, view),
    yaw: lerp((-13 * Math.PI) / 180, 0, view),
    zoom: lerp(1.3, 1, view),
  };

  const rest = restMain(aspect, fr.unit, fr.width, fr.height);
  const fly = easeInOutSine((t - 6) / (T.settle - 6));
  const main = {
    x: lerp(660, rest.x, fly) + 14 * Math.sin(t * 0.7),
    y: lerp(470, rest.y, fly) + 10 * Math.cos(t * 0.53),
    z: lerp(300, REST_Z, fly) + 8 * Math.sin(t * 0.9),
  };
  const mainDrop: Drop = {
    ...main,
    r: lerp(92, MAIN_R, fly),
    wobble: 0.035 + 0.075 * jig * kick(t, 4) + 0.03 * (1 - settle),
    phase: 0.5 * t + 0.4 * cone(t) * jig,
    squash: 0.13 * jig * cone(t),
    seed: 0.7,
  };

  const flash = Math.exp(-Math.max(0, t - T.converge) * 1.8) * smooth(T.converge - 0.3, T.converge, t);
  return {
    waves: waves(t, org, focusMul),
    ring,
    pool,
    logo: { s, b1: 22, b2: 48, delta: 1.6 },
    noiseGain: [1 - s + s * 0.03, 1 - s + s * resid * (1 + 0.6 * jig * kick(t))],
    light: smooth(0, T.light, t),
    exposure: 1 + 0.6 * flash,
    overlay: easeInOutSine((t - T.converge - 0.25) / (T.settle - T.converge)),
    camera,
    drops: [mainDrop, ...satellites(main, t, jig, fly)],
  };
};

// ------------------------------------------------------------- loop

/** Resolved state, periodic in LOOP_BEATS: the logo dissolves a little and re-forms every 2 bars. */
export const loopScene = (t: number, fr: Frame, jiggle: number): CausticScene => {
  const aspect = fr.width / fr.height;
  const jig = jiggle * 0.32;
  const u = mod(t, 8);
  // 0 at the 2-bar downbeat, swelling through the second bar, snapping back on the next downbeat.
  const dis = smooth(3, 6.6, u) * (1 - smooth(7.2, 8, u));
  const s = 1 - 0.5 * dis;
  const resid = 0.22;
  const rest = restMain(aspect, fr.unit, fr.width, fr.height);
  const a = (TAU * t) / LOOP_BEATS;
  const main = {
    x: rest.x + 14 * Math.sin(a * 2),
    y: rest.y + 10 * Math.cos(a * 3),
    z: REST_Z + 8 * Math.sin(a * 4),
  };
  return {
    waves: waves(t, 1, 1 + 0.55 * jig * kick(t)),
    ring: { x: 500, y: 500, amp: 16 * jig * Math.exp(-2.2 * mod(t, 1)), radius: 60 + 520 * mod(t, 1), width: 70 },
    pool: { x: 500, y: 500, r: 720, exp: 7, soft: 170, rim: 0, rimWidth: 26, h: [0.03 * jig * cone(t), a, 0, 0] },
    logo: { s, b1: 22, b2: 48, delta: 1.6 },
    noiseGain: [1 - s + s * 0.03, 1 - s + s * resid * (1 + 0.6 * jig * kick(t))],
    light: 1,
    exposure: 1 + 0.35 * Math.exp(-1.8 * u),
    overlay: 1 - 0.45 * dis,
    camera: { x: 500 + 3 * Math.sin(a), y: 500 + 2 * Math.sin(2 * a + 0.6), pitch: 0, yaw: 0, zoom: 1 + 0.006 * Math.sin(a + 1.2) },
    drops: [
      {
        ...main,
        r: MAIN_R,
        wobble: 0.035 + 0.075 * jig * kick(t, 4),
        phase: 3 * Math.sin(a) + 0.4 * cone(t) * jig,
        squash: 0.13 * jig * cone(t),
        seed: 0.7,
      },
      ...satellites(main, t, jig, 1),
    ],
  };
};
