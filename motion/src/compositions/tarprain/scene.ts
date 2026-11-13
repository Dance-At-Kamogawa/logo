/**
 * Per-frame water primitives (pure functions of the beat): crown rings and
 * crown droplets at each impact, beads growing, skittering, resting or being
 * absorbed. The logo water itself is the static field + arrival texture.
 */
import { random } from "remotion";
import { clamp01 } from "../../lib/easing";
import { PEGS } from "../../logo";
import { LOOP_BEATS, mod, rainPlan, T, type Bead, type Impact, type Rest } from "./plan";

/** Round cone a->b (type 0) or ring around a with radius ra, half-thickness rb (type 1). */
export type Prim = {
  readonly type: 0 | 1;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly ra: number;
  readonly rb: number;
  /** Height of the water (sets the profile and the shadow offset). */
  readonly h: number;
  /** Smooth-union radius. */
  readonly k: number;
  readonly alpha: number;
  /** Impact glint. */
  readonly flash: number;
};

export type RainScene = {
  readonly prims: readonly Prim[];
  /** Beat compared with the arrival field (huge = fully wet). */
  readonly fillBeat: number;
  /** 0..1 strength of the light-grey type under the water. */
  readonly ink: number;
  /** Rotation of the studio light (radians), for the shimmer. */
  readonly light: number;
};

export const MAX_PRIMS = 512;
const CROWN_LIFE = 0.42;
const CROWN_DROPLETS = 7;

const rnd = (seed: string): number => random(`tarprain:${seed}`);

const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
/** Grows with a small overshoot, like surface tension pulling a bead round. */
const easeOutBack = (t: number): number => {
  const x = clamp01(t);
  const c = 1.9;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};

const sphere = (x: number, y: number, r: number, o: Partial<Prim> = {}): Prim => ({
  type: 0,
  ax: x,
  ay: y,
  bx: x,
  by: y,
  ra: r,
  rb: r,
  h: o.h ?? r,
  k: o.k ?? 0,
  alpha: o.alpha ?? 1,
  flash: o.flash ?? 0,
});

/** A moving drop: sphere with a short tapered tail pointing back along its velocity (units / beat). */
const moving = (x: number, y: number, r: number, vx: number, vy: number, o: Partial<Prim> = {}, stretch = 0.035): Prim => {
  const speed = Math.hypot(vx, vy);
  const len = Math.min(r * 1.6, speed * stretch);
  if (len < 0.4) return sphere(x, y, r, o);
  const rr = r / Math.sqrt(1 + len / (r * 3));
  return {
    type: 0,
    ax: x - (vx / speed) * len,
    ay: y - (vy / speed) * len,
    bx: x,
    by: y,
    ra: rr * 0.62,
    rb: rr,
    h: o.h ?? rr,
    k: o.k ?? 0,
    alpha: o.alpha ?? 1,
    flash: o.flash ?? 0,
  };
};

/** Crown micro-splash: a thin ring opening up and a few tiny droplets thrown off its rim. */
const crown = (imp: Impact, age: number, out: Prim[]): void => {
  if (age < 0 || age > CROWN_LIFE) return;
  const s = imp.size;
  const u = age / CROWN_LIFE;
  const R = (2.5 + 14 * easeOut(age / 0.3)) * s;
  const flash = Math.exp(-age * 22);
  out.push({
    type: 1,
    ax: imp.x,
    ay: imp.y,
    bx: imp.x,
    by: imp.y,
    ra: R,
    rb: Math.max(0.2, 1.7 * s * (1 - u) ** 1.5),
    h: 1.6 * s * (1 - u),
    k: 0.8,
    alpha: 1 - smooth(0.55, 1, u),
    flash,
  });
  for (let i = 0; i < CROWN_DROPLETS; i++) {
    const a = ((i + rnd(`${imp.seed}:ca${i}`) * 0.7) / CROWN_DROPLETS) * Math.PI * 2;
    const reach = rnd(`${imp.seed}:cr${i}`);
    const d = R * (1.05 + 0.25 * reach) + 18 * s * reach * easeOut(age / 0.38);
    const r = (1.9 + 1.6 * rnd(`${imp.seed}:cs${i}`)) * s * (1 - smooth(0.45, 1, u));
    if (r < 0.25) continue;
    const v = 70 * s * (1 - u);
    out.push(
      moving(imp.x + Math.cos(a) * d, imp.y + Math.sin(a) * d, r, Math.cos(a) * v, Math.sin(a) * v, { k: 0.5, flash: flash * 0.6 }, 0.05),
    );
  }
};

const bezier = (b: Bead, t: number): { x: number; y: number } => {
  const m = 1 - t;
  return {
    x: m * m * b.x0 + 2 * m * t * b.cx + t * t * b.x1,
    y: m * m * b.y0 + 2 * m * t * b.cy + t * t * b.y1,
  };
};

/** Stick-slip progress: monotonic, with `stops` near-stops along the way. */
const skitter = (b: Bead, u: number): number => {
  const e = u * u * (3 - 2 * u);
  const n = b.stops;
  return clamp01(e - (b.stick * Math.sin(2 * Math.PI * n * e)) / (2 * Math.PI * n));
};

const beadPos = (b: Bead, beat: number): { x: number; y: number } => {
  const u = clamp01((beat - b.t0) / Math.max(0.01, b.t1 - b.t0));
  const p = bezier(b, skitter(b, u));
  // A little lateral wobble while rolling (folds in the tarp).
  const w = Math.sin(Math.PI * u) * 1.6 * Math.sin(u * 17 + rnd(`${b.seed}:wp`) * 6);
  const dx = b.x1 - b.x0;
  const dy = b.y1 - b.y0;
  const l = Math.hypot(dx, dy) || 1;
  return { x: p.x - (dy / l) * w, y: p.y + (dx / l) * w };
};

/** `age` = beat - bead.born (already wrapped for the loop). */
const bead = (b: Bead, age: number, out: Prim[]): void => {
  if (age < 0) return;
  const beat = b.born + age;
  let r = b.r;
  if (b.emerge) r *= easeOutBack((age - 0.05) / 0.5);
  else r *= easeOutBack((age - 0.07) / 0.2);
  if (r <= 0.05) return;
  if (b.fate !== "stay") {
    // Absorbed: the bead drains into the stroke / resting bead it touched.
    const after = beat - b.t1;
    if (after > 0) r *= 1 - smooth(0, 0.35, after);
    if (r <= 0.15) return;
  }
  const p = beadPos(b, beat);
  const q = beadPos(b, beat - 0.04);
  const vx = (p.x - q.x) / 0.04;
  const vy = (p.y - q.y) / 0.04;
  // Small wobble right after it is born and when it stops.
  const jig = 1 + 0.06 * Math.sin(age * 40) * Math.exp(-age * 7);
  out.push(moving(p.x, p.y, r * jig, vx, vy, { k: b.fate === "stay" ? 2 : 6 }));
};

const rest = (q: Rest, beat: number, swell: number, out: Prim[]): void => {
  // Faint breathing so resting beads catch the moving light differently.
  const br = 1 + 0.025 * Math.sin(((beat + rnd(`${q.seed}:ph`) * LOOP_BEATS) / LOOP_BEATS) * Math.PI * 4);
  out.push(sphere(q.x, q.y, q.r * br * (1 + swell), { k: 2 }));
};

/** Slow rotation of the studio light: the shimmer on beads and strokes. */
const lightAt = (phase: number): number => 0.22 * Math.sin(2 * Math.PI * phase) + 0.08 * Math.sin(4 * Math.PI * phase + 1.3);

export const introRain = (beat: number): RainScene => {
  const plan = rainPlan();
  const prims: Prim[] = [];
  for (const imp of plan.intro.impacts) crown(imp, beat - imp.t, prims);
  for (const b of plan.intro.beads) bead(b, beat - b.born, prims);
  // Four drops on the grommets at the downbeat (crowns only; the puddles are in the field).
  if (beat >= T.resolve - 0.01) {
    PEGS.forEach((peg, i) =>
      crown({ t: T.resolve, x: peg.cx, y: peg.cy, size: 1.25, seed: `peg:${i}` }, beat - T.resolve, prims),
    );
  }
  const ink = 0.88 * smooth(T.resolve - 0.5, T.resolve + 2, beat);
  return { prims: prims.slice(0, MAX_PRIMS), fillBeat: beat, ink, light: lightAt(beat / LOOP_BEATS) };
};

export const loopRain = (beat: number): RainScene => {
  const plan = rainPlan();
  const prims: Prim[] = [];
  const { impacts, beads, rests } = plan.loop;
  for (const imp of impacts) crown(imp, mod(beat - imp.t, LOOP_BEATS), prims);
  const swell = new Map<Rest, number>();
  for (const b of beads) {
    const age = mod(beat - b.born, LOOP_BEATS);
    bead(b, age, prims);
    if (b.fate === "merge") {
      const target = rests.find((q) => q.x === b.x1 && q.y === b.y1);
      const after = age - (b.t1 - b.born);
      if (target && after > 0) {
        // Volume moves over: the resting bead swells, then relaxes.
        const v = 0.18 * (b.r / target.r) * smooth(0, 0.35, after) * (1 - smooth(0.6, 3.5, after));
        swell.set(target, (swell.get(target) ?? 0) + v);
      }
    }
  }
  for (const q of rests) rest(q, beat, swell.get(q) ?? 0, prims);
  return { prims: prims.slice(0, MAX_PRIMS), fillBeat: 1e5, ink: 0.88, light: lightAt(beat / LOOP_BEATS) };
};
