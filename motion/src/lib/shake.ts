import { noise2D } from "./noise";

/**
 * Decaying camera shake after an impact. Returns an offset in logo units.
 * Deterministic (seeded noise), so renders are reproducible.
 */
export const impactShake = (
  frame: number,
  impactFrame: number,
  opts: { amp?: number; decay?: number; seed?: string } = {},
): { x: number; y: number } => {
  const { amp = 6, decay = 0.18, seed = "shake" } = opts;
  const t = frame - impactFrame;
  if (t < 0 || t > 40) return { x: 0, y: 0 };
  const falloff = Math.exp(-t * decay);
  return {
    x: noise2D(`${seed}x`, t * 0.9, 0) * amp * falloff,
    y: noise2D(`${seed}y`, 0, t * 0.9) * amp * falloff,
  };
};

/** Sum of several impact shakes. */
export const combinedShake = (
  frame: number,
  impacts: readonly number[],
  opts: { amp?: number; decay?: number } = {},
): { x: number; y: number } =>
  impacts.reduce(
    (acc, f, i) => {
      const s = impactShake(frame, f, { ...opts, seed: `impact${i}` });
      return { x: acc.x + s.x, y: acc.y + s.y };
    },
    { x: 0, y: 0 },
  );
