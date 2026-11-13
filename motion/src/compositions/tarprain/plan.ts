/**
 * The rain plan: every raindrop, every bead and where it goes, decided once
 * (seeded, deterministic) from the logo field. Times are in beats.
 *
 * Intro: drops fall on the beat grid, each breaks into one or two beads that
 * skitter over the tarp towards a still-dry part of a logo stroke (greedy
 * coverage, so the logo fills in scattered, organic order); some miss and
 * stay on the tarp. Each bead that joins a stroke spreads along it
 * (connected component only) for a length set by its volume: that gives the
 * static "arrival time" field the shader compares with the current beat. On
 * the bar downbeat T.resolve the last beads arrive together, whatever is
 * still dry snaps wet, and four drops land on the grommets and spread into
 * puddles.
 *
 * Loop: the resolved logo; drops keep falling on the beat; their beads roll
 * into a stroke or a resting bead and are absorbed; now and then a bead
 * swells out of a stroke and wanders to another. Every event lives less than
 * the loop, its age taken modulo the loop, so the loop closes exactly.
 */
import { random } from "remotion";
import { PEGS } from "../../logo";
import { fieldDistance, FIELD_ORIGIN, FIELD_SIZE, logoField, type LogoField } from "./field";

export const T = {
  rainStart: 1,
  /** Bar downbeat (bar 5): the logo is complete. */
  resolve: 16,
  total: 26,
} as const;
export const LOOP_BEATS = 16;

/** Distance (units) a bead's water front advances per beat, for the shader's front smoothing. */
export const FRONT_SPEED = 46;

const rnd = (seed: string): number => random(`tarprain:${seed}`);
const rr = (seed: string, a: number, b: number): number => a + (b - a) * rnd(seed);

/** Positive modulo. */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

export type Impact = {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  /** Crown size factor. */
  readonly size: number;
  readonly seed: string;
};

export type BeadFate = "join" | "stay" | "merge";

export type Bead = {
  readonly seed: string;
  /** Beat at which the bead starts to exist (grows out of the impact or a stroke). */
  readonly born: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Bezier control point. */
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** Rolling starts / ends. */
  readonly t0: number;
  readonly t1: number;
  /** join: absorbed into a stroke at t1; merge: absorbed into a resting bead; stay: rests. */
  readonly fate: BeadFate;
  /** Skitter: stop-and-go count and strength. */
  readonly stops: number;
  readonly stick: number;
  /** Grows out of a stroke instead of an impact. */
  readonly emerge: boolean;
};

export type Rest = { readonly x: number; readonly y: number; readonly r: number; readonly seed: string };

export type Plan = {
  readonly field: LogoField;
  /** RGBA float texture: distance, arrival beat, gradient x, gradient y. */
  readonly texture: Float32Array;
  readonly intro: { readonly impacts: readonly Impact[]; readonly beads: readonly Bead[] };
  readonly loop: { readonly impacts: readonly Impact[]; readonly beads: readonly Bead[]; readonly rests: readonly Rest[] };
};

type Sample = { readonly x: number; readonly y: number; readonly comp: number };

const NEVER = 1e4;

/** Wet-area sample points (every 3 units), grommet puddles excluded. */
const samplePoints = (f: LogoField): Sample[] => {
  const out: Sample[] = [];
  const N = FIELD_SIZE;
  for (let j = 1; j < N; j += 3) {
    for (let i = 1; i < N; i += 3) {
      const k = j * N + i;
      const c = f.comp[k] ?? -1;
      if (c < 0 || (f.dist[k] ?? 0) > -1 || f.kinds[c] === "peg") continue;
      out.push({ x: i + FIELD_ORIGIN + 0.5, y: j + FIELD_ORIGIN + 0.5, comp: c });
    }
  }
  return out;
};

const nearestSample = (pts: readonly Sample[], x: number, y: number, maxDist: number): Sample | null => {
  let best: Sample | null = null;
  let bd = maxDist * maxDist;
  for (const s of pts) {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
};

/** Bezier control: the path bows sideways, like a bead deflected by the tarp's folds. */
const control = (seed: string, x0: number, y0: number, x1: number, y1: number): { cx: number; cy: number } => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const bend = rr(`${seed}:bend`, -0.38, 0.38);
  return { cx: (x0 + x1) / 2 - dy * bend, cy: (y0 + y1) / 2 + dx * bend };
};

/** Letters region: the hold keeps its rain off the type. */
const inTypeArea = (x: number, y: number): boolean => x > 110 && x < 890 && y > 395 && y < 590;

// ------------------------------------------------------------------ intro

const introImpactBeats = (): number[] => {
  const out: number[] = [];
  const add = (b: number, p: number): void => {
    if (rnd(`ib:${b}`) < p) out.push(b);
  };
  for (let b = T.rainStart; b < 4; b++) add(b, 1);
  for (let b = 4; b < 8; b += 0.5) add(b, b % 1 === 0 ? 1 : 0.85);
  for (let b = 8; b < 12; b += 0.25) add(b, b % 0.5 === 0 ? 1 : 0.5);
  for (let b = 12; b < 14; b += 0.25) add(b, 1);
  for (let b = 14; b < 15.01; b += 0.25) add(b, 1);
  // Downbeats get a second drop.
  for (let b = 8; b < 15; b += 1) out.push(b + 0.001);
  return out.sort((a, b) => a - b);
};

type Seed = { x: number; y: number; t: number; L: number; dur: number; comp: number };

const buildIntro = (
  f: LogoField,
  pts: readonly Sample[],
): { impacts: Impact[]; beads: Bead[]; seeds: Seed[] } => {
  const impacts: Impact[] = [];
  const beads: Bead[] = [];
  const seeds: Seed[] = [];
  const covered = new Uint8Array(pts.length);
  const R = T.resolve;

  const coverAround = (s: Sample, L: number): void => {
    pts.forEach((q, i) => {
      if (q.comp === s.comp && (q.x - s.x) ** 2 + (q.y - s.y) ** 2 < L * L) covered[i] = 1;
    });
  };
  const pickUncovered = (seed: string): Sample | null => {
    const open = pts.filter((_, i) => covered[i] === 0);
    if (open.length === 0) return null;
    return open[Math.floor(rnd(seed) * open.length)] ?? null;
  };
  const nearestUncovered = (x: number, y: number, maxDist: number): Sample | null =>
    nearestSample(
      pts.filter((_, i) => covered[i] === 0),
      x,
      y,
      maxDist,
    );

  introImpactBeats().forEach((b, n) => {
    const seed = `in:${n}`;
    const finale = b >= 14;
    const target = pickUncovered(`${seed}:pick`);
    if (!target) return;
    const ang = rr(`${seed}:ang`, 0, Math.PI * 2);
    const dist = rr(`${seed}:dist`, 40, 150);
    const x = target.x + Math.cos(ang) * dist;
    const y = target.y + Math.sin(ang) * dist;
    const size = rr(`${seed}:size`, 0.75, 1.2);
    impacts.push({ t: b, x, y, size, seed });

    const siblings = rnd(`${seed}:sib`) < 0.5 ? 2 : 1;
    for (let s = 0; s < siblings; s++) {
      const bs = `${seed}:b${s}`;
      const miss = !finale && rnd(`${bs}:miss`) < 0.13;
      let dest: Sample | null = s === 0 ? target : nearestUncovered(x, y, 160);
      let x1: number;
      let y1: number;
      if (miss || !dest) {
        // Wanders off and comes to rest on dry tarp.
        let tries = 0;
        do {
          const a = rr(`${bs}:ma${tries}`, 0, Math.PI * 2);
          const d = rr(`${bs}:md${tries}`, 30, 90);
          x1 = x + Math.cos(a) * d;
          y1 = y + Math.sin(a) * d;
          tries++;
        } while ((fieldDistance(f, x1, y1) < 16 || inTypeArea(x1, y1)) && tries < 12);
        dest = null;
      } else {
        x1 = dest.x;
        y1 = dest.y;
      }
      const r = s === 0 ? rr(`${bs}:r`, 11, 18) * size : rr(`${bs}:r`, 6, 10);
      const t0 = b + 0.24;
      const speed = rr(`${bs}:v`, 36, 62);
      let t1 = t0 + Math.hypot(x1 - x, y1 - y) / speed + 0.15;
      if (dest && (finale || t1 > R - 0.3)) t1 = R; // the last beads land on the downbeat
      if (!dest) t1 = Math.min(t1, R + 2);
      const { cx, cy } = control(bs, x, y, x1, y1);
      beads.push({
        seed: bs,
        born: b,
        x0: x,
        y0: y,
        x1,
        y1,
        cx,
        cy,
        r,
        t0,
        t1,
        fate: dest ? "join" : "stay",
        stops: Math.floor(rr(`${bs}:st`, 1, 4)),
        stick: rr(`${bs}:sk`, 0.45, 0.9),
        emerge: false,
      });
      if (dest) {
        const kind = f.kinds[dest.comp];
        const L = (kind === "frame" ? rr(`${bs}:L`, 80, 130) : rr(`${bs}:L`, 34, 58)) * (r / 14);
        seeds.push({ x: x1, y: y1, t: t1, L, dur: 0.5 + L / 160, comp: dest.comp });
        coverAround(dest, L * 0.85);
      }
    }
  });

  // The hold: drops on the beat, off the type; their beads come to rest.
  for (let b = R + 1; b < T.total - 0.5; b += 0.5) {
    if (rnd(`hold:${b}`) > (b % 1 === 0 ? 0.75 : 0.2)) continue;
    const seed = `hold:${b}`;
    let x = 0;
    let y = 0;
    let tries = 0;
    do {
      x = rr(`${seed}:x${tries}`, -650, 1650);
      y = rr(`${seed}:y${tries}`, -120, 1120);
      tries++;
    } while ((fieldDistance(f, x, y) < 30 || inTypeArea(x, y) || Math.abs(x - 500) > 1000 * rnd(`${seed}:w`) + 450) && tries < 20);
    const size = rr(`${seed}:size`, 0.7, 1.1);
    impacts.push({ t: b, x, y, size, seed });
    const a = rr(`${seed}:a`, 0, Math.PI * 2);
    const d = rr(`${seed}:d`, 6, 40);
    const x1 = x + Math.cos(a) * d;
    const y1 = y + Math.sin(a) * d;
    const t0 = b + 0.24;
    beads.push({
      seed,
      born: b,
      x0: x,
      y0: y,
      x1,
      y1,
      ...control(seed, x, y, x1, y1),
      r: rr(`${seed}:r`, 7, 12.5) * size,
      t0,
      t1: t0 + d / 50 + 0.2,
      fate: "stay",
      stops: 1,
      stick: 0.6,
      emerge: false,
    });
  }
  return { impacts, beads, seeds };
};

/** Static arrival-beat field (inside the wet logo, extended a few texels out). */
const arrivalField = (f: LogoField, seeds: readonly Seed[]): Float32Array => {
  const N = FIELD_SIZE;
  const A = new Float32Array(N * N).fill(NEVER);
  for (const s of seeds) {
    const i0 = Math.max(0, Math.floor(s.x - s.L - FIELD_ORIGIN));
    const i1 = Math.min(N - 1, Math.ceil(s.x + s.L - FIELD_ORIGIN));
    const j0 = Math.max(0, Math.floor(s.y - s.L - FIELD_ORIGIN));
    const j1 = Math.min(N - 1, Math.ceil(s.y + s.L - FIELD_ORIGIN));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        if (f.comp[k] !== s.comp) continue;
        const r = Math.hypot(i + FIELD_ORIGIN + 0.5 - s.x, j + FIELD_ORIGIN + 0.5 - s.y);
        if (r >= s.L) continue;
        // Fast at first, slowing as the bead's water runs out.
        const t = s.t + s.dur * (1 - Math.sqrt(1 - r / s.L));
        if (t < (A[k] ?? NEVER)) A[k] = t;
      }
    }
  }
  // Downbeat: the grommets fill as puddles from their centres, and whatever
  // is still dry snaps wet within a 16th.
  const pegCentre = new Map<number, { x: number; y: number }>();
  f.pegComps.forEach((c, i) => {
    const peg = PEGS[i];
    if (c >= 0 && peg) pegCentre.set(c, { x: peg.cx, y: peg.cy });
  });
  for (let k = 0; k < N * N; k++) {
    const c = f.comp[k] ?? -1;
    if (c < 0) continue;
    const x = (k % N) + FIELD_ORIGIN + 0.5;
    const y = Math.floor(k / N) + FIELD_ORIGIN + 0.5;
    const pc = pegCentre.get(c);
    if (pc) {
      A[k] = T.resolve + 0.04 + Math.hypot(x - pc.x, y - pc.y) / 130;
      continue;
    }
    const snap = T.resolve + 0.03 + 0.2 * rnd(`snap:${Math.floor(x / 23)}:${Math.floor(y / 23)}`);
    A[k] = Math.min(A[k] ?? NEVER, snap);
  }
  // Extend outwards (min of 4-neighbours) so bilinear look-ups at the edges stay clean.
  for (let it = 0; it < 4; it++) {
    const src = A.slice();
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const k = j * N + i;
        if ((f.comp[k] ?? -1) >= 0) continue;
        const m = Math.min(src[k - 1] ?? NEVER, src[k + 1] ?? NEVER, src[k - N] ?? NEVER, src[k + N] ?? NEVER);
        if (m < (A[k] ?? NEVER)) A[k] = m;
      }
    }
  }
  return A;
};

// ------------------------------------------------------------------- loop

const buildLoop = (
  f: LogoField,
  pts: readonly Sample[],
): { impacts: Impact[]; beads: Bead[]; rests: Rest[] } => {
  // Resting beads on the dry tarp (same feel as the end of the intro).
  const rests: Rest[] = [];
  for (let n = 0; rests.length < 16 && n < 400; n++) {
    // Alternate sides; fewer the further from the logo.
    const side = n % 2 === 0 ? -1 : 1;
    const x = 500 + side * rr(`rest:${n}:x`, 0, 1200);
    const y = rr(`rest:${n}:y`, -100, 1100);
    if (fieldDistance(f, x, y) < 26 || inTypeArea(x, y)) continue;
    if (rnd(`rest:${n}:w`) > Math.exp(-(((x - 500) / 850) ** 2))) continue;
    if (rests.some((q) => Math.hypot(q.x - x, q.y - y) < 90)) continue;
    rests.push({ x, y, r: rr(`rest:${n}:r`, 6, 13), seed: `rest:${n}` });
  }

  const impacts: Impact[] = [];
  const beads: Bead[] = [];
  for (let b = 0; b < LOOP_BEATS; b += 0.5) {
    if (rnd(`lb:${b}`) > (b % 1 === 0 ? 0.85 : 0.3)) continue;
    const seed = `lp:${b}`;
    let x = 0;
    let y = 0;
    let tries = 0;
    do {
      x = rr(`${seed}:x${tries}`, -550, 1550);
      y = rr(`${seed}:y${tries}`, -100, 1100);
      tries++;
    } while (
      (fieldDistance(f, x, y) < 14 || inTypeArea(x, y) || Math.abs(x - 500) > 450 + 900 * rnd(`${seed}:w${tries}`)) &&
      tries < 20
    );
    const size = rr(`${seed}:size`, 0.7, 1.15);
    impacts.push({ t: b, x, y, size, seed });
    // Roll into the nearest stroke, or into the nearest resting bead.
    const stroke = nearestSample(pts, x, y, 130);
    const rest = rests.reduce<Rest | null>(
      (best, q) => (!best || Math.hypot(q.x - x, q.y - y) < Math.hypot(best.x - x, best.y - y) ? q : best),
      null,
    );
    const toStroke = stroke && (!rest || Math.hypot(stroke.x - x, stroke.y - y) < Math.hypot(rest.x - x, rest.y - y) + 40);
    const x1 = toStroke && stroke ? stroke.x : (rest?.x ?? x);
    const y1 = toStroke && stroke ? stroke.y : (rest?.y ?? y);
    const t0 = b + 0.24;
    const t1 = t0 + Math.min(3.2, Math.hypot(x1 - x, y1 - y) / rr(`${seed}:v`, 45, 75)) + 0.15;
    beads.push({
      seed,
      born: b,
      x0: x,
      y0: y,
      x1,
      y1,
      ...control(seed, x, y, x1, y1),
      r: rr(`${seed}:r`, 7, 12) * size,
      t0,
      t1,
      fate: toStroke ? "join" : "merge",
      stops: Math.floor(rr(`${seed}:st`, 1, 4)),
      stick: rr(`${seed}:sk`, 0.45, 0.9),
      emerge: false,
    });
  }
  // A few beads leave a stroke and wander to another one.
  const leaves = [2.5, 7.75, 12.5];
  leaves.forEach((b, n) => {
    const seed = `leave:${n}`;
    const from = pts[Math.floor(rnd(`${seed}:from`) * pts.length)];
    if (!from) return;
    const a = rr(`${seed}:a`, 0, Math.PI * 2);
    const to = nearestSample(
      pts.filter((q) => q.comp !== from.comp),
      from.x + Math.cos(a) * 60,
      from.y + Math.sin(a) * 60,
      400,
    );
    if (!to) return;
    const t0 = b + 0.5;
    beads.push({
      seed,
      born: b,
      x0: from.x,
      y0: from.y,
      x1: to.x,
      y1: to.y,
      ...control(seed, from.x, from.y, to.x, to.y),
      r: rr(`${seed}:r`, 7, 10),
      t0,
      t1: t0 + Math.min(3.5, Math.hypot(to.x - from.x, to.y - from.y) / 55) + 0.2,
      fate: "join",
      stops: 3,
      stick: 0.8,
      emerge: true,
    });
  });
  return { impacts, beads, rests };
};

const build = (): Plan => {
  const field = logoField();
  const pts = samplePoints(field);
  const intro = buildIntro(field, pts);
  const A = arrivalField(field, intro.seeds);
  const N = FIELD_SIZE;
  const texture = new Float32Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    texture[k * 4] = Math.max(-64, Math.min(64, field.dist[k] ?? 64));
    texture[k * 4 + 1] = A[k] ?? NEVER;
    texture[k * 4 + 2] = field.grad[k * 2] ?? 0;
    texture[k * 4 + 3] = field.grad[k * 2 + 1] ?? 0;
  }
  return {
    field,
    texture,
    intro: { impacts: intro.impacts, beads: intro.beads },
    loop: buildLoop(field, pts),
  };
};

let cached: Plan | null = null;
export const rainPlan = (): Plan => {
  if (!cached) cached = build();
  return cached;
};
