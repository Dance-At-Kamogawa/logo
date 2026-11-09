import { random } from "remotion";

/**
 * Tiny deterministic value-noise (smooth, seeded) for organic secondary
 * motion. Avoids an extra dependency.
 */
const smooth = (t: number): number => t * t * (3 - 2 * t);

const lattice = (seed: string, x: number, y: number): number => random(`${seed}:${x}:${y}`) * 2 - 1;

export const noise2D = (seed: string, x: number, y: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = lattice(seed, x0, y0);
  const b = lattice(seed, x0 + 1, y0);
  const c = lattice(seed, x0, y0 + 1);
  const d = lattice(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
};
