import type React from "react";
import { PEGS } from "./geometry.generated";
import type { Corner, PegData } from "./types";

export { PEGS };

export const pegByCorner = (corner: Corner): PegData => {
  const peg = PEGS.find((p) => p.corner === corner);
  if (!peg) throw new Error(`No peg for ${corner}`);
  return peg;
};

/** Peg centres, exported as plain data for motion paths. */
export const PEG_CENTERS: Record<Corner, { x: number; y: number }> = {
  tl: { x: pegByCorner("tl").cx, y: pegByCorner("tl").cy },
  tr: { x: pegByCorner("tr").cx, y: pegByCorner("tr").cy },
  bl: { x: pegByCorner("bl").cx, y: pegByCorner("bl").cy },
  br: { x: pegByCorner("br").cx, y: pegByCorner("br").cy },
};

type Props = {
  readonly peg: PegData;
  readonly color: string;
  /** Centre override (defaults to the peg's own centre). */
  readonly cx?: number;
  readonly cy?: number;
  /** Uniform scale of the ring. */
  readonly scale?: number;
  /**
   * 0 = solid dot (same outer radius as `dotRadius`), 1 = the grommet ring.
   * Lets a dot "open up" into a ring on impact.
   */
  readonly ring?: number;
  /** Outer radius of the solid dot when ring = 0. */
  readonly dotRadius?: number;
  /** Extra transform (e.g. squash) applied around the centre. */
  readonly transform?: string;
  readonly opacity?: number;
};

/** A grommet ring. With ring=1 and no overrides it matches the original exactly. */
export const Peg: React.FC<Props> = ({
  peg,
  color,
  cx = peg.cx,
  cy = peg.cy,
  scale = 1,
  ring = 1,
  dotRadius = peg.r + peg.strokeWidth / 2,
  transform,
  opacity = 1,
}) => {
  if (scale <= 0 || opacity <= 0) return null;
  const outerRing = peg.r + peg.strokeWidth / 2;
  const t = Math.min(1, Math.max(0, ring));
  const outer = (dotRadius + (outerRing - dotRadius) * t) * scale;
  // A stroked circle with strokeWidth == outer radius renders as a solid disc.
  const sw = (outer + (peg.strokeWidth * scale - outer) * t) * 1;
  const r = Math.max(0.001, outer - sw / 2);
  return (
    <g transform={transform} opacity={opacity}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw} />
    </g>
  );
};
