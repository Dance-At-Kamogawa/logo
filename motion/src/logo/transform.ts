import type { Box } from "./types";

export type ElementTransform = {
  /** Offset in logo units. */
  readonly dx?: number;
  readonly dy?: number;
  readonly scale?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  /** Degrees. */
  readonly rotate?: number;
  readonly skewX?: number;
};

export type Origin = { readonly x: number; readonly y: number };

export const boxCenter = (box: Box): Origin => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Bottom-centre of a box (good pivot for squash and stretch). */
export const boxBottom = (box: Box): Origin => ({ x: box.x + box.width / 2, y: box.y + box.height });

const isIdentity = (t: ElementTransform): boolean =>
  !t.dx && !t.dy && (t.scale ?? 1) === 1 && (t.scaleX ?? 1) === 1 && (t.scaleY ?? 1) === 1 && !t.rotate && !t.skewX;

/** SVG transform string that applies `t` around `origin`. */
export const transformAbout = (origin: Origin, t: ElementTransform = {}): string | undefined => {
  if (isIdentity(t)) return undefined;
  const s = t.scale ?? 1;
  const sx = s * (t.scaleX ?? 1);
  const sy = s * (t.scaleY ?? 1);
  return [
    `translate(${origin.x + (t.dx ?? 0)} ${origin.y + (t.dy ?? 0)})`,
    t.rotate ? `rotate(${t.rotate})` : "",
    t.skewX ? `skewX(${t.skewX})` : "",
    `scale(${sx} ${sy})`,
    `translate(${-origin.x} ${-origin.y})`,
  ]
    .filter(Boolean)
    .join(" ");
};

/** Squash/stretch along an arbitrary direction (degrees). */
export const directionalScale = (origin: Origin, angleDeg: number, along: number, across: number): string =>
  `translate(${origin.x} ${origin.y}) rotate(${angleDeg}) scale(${along} ${across}) rotate(${-angleDeg}) translate(${-origin.x} ${-origin.y})`;
