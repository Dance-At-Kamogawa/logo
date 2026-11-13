/**
 * Screen-space binning of the liquid primitives. The canvas is cut into
 * TILE x TILE px tiles; each tile gets the list of primitives that can change
 * a visible pixel inside it, so the shader only loops over those (most of a
 * frame is empty black, which then costs almost nothing on software GL).
 */
import type { Prim } from "./scene";

export const TILE = 32;
export const INDEX_WIDTH = 1024;

export type Bins = {
  readonly cols: number;
  readonly rows: number;
  /** Per tile: offset into `index`, count. */
  readonly heads: Float32Array;
  /** Flattened primitive indices. */
  readonly index: Float32Array;
  readonly used: number;
};

type View = {
  readonly width: number;
  readonly height: number;
  /** px per logo unit. */
  readonly unit: number;
  readonly cam: { readonly x: number; readonly y: number };
};

/**
 * Bounding circle (px) of the region where a primitive can matter: its own
 * shape plus 1.25x its blend radius (beyond that the smooth union cannot pull
 * the field below the anti-aliasing band) plus the soft edge.
 */
const bound = (p: Prim, v: View): { x: number; y: number; r: number } => {
  const mx = (p.ax + p.bx) / 2;
  const my = (p.ay + p.by) / 2;
  const half = Math.hypot(p.bx - p.ax, p.by - p.ay) / 2;
  const r = half + Math.max(p.ra, p.rb) + 1.25 * p.k;
  return {
    x: (mx - v.cam.x) * v.unit + v.width / 2,
    y: (my - v.cam.y) * v.unit + v.height / 2,
    r: r * v.unit + p.soft * 2 + 4,
  };
};

export const makeBins = (width: number, height: number, capacity: number): Bins => {
  const cols = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);
  return {
    cols,
    rows,
    heads: new Float32Array(cols * rows * 4),
    index: new Float32Array(Math.ceil(capacity / INDEX_WIDTH) * INDEX_WIDTH * 4),
    used: 0,
  };
};

/** Fills `bins` in place for this frame. Returns the number of index entries used. */
export const binPrims = (bins: Bins, prims: readonly Prim[], v: View): number => {
  const { cols, rows, heads, index } = bins;
  const capacity = index.length / 4;
  const circles = prims.map((p) => bound(p, v));
  let used = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const start = used;
      circles.forEach((c, i) => {
        // Circle vs tile rectangle.
        const nx = Math.max(x0, Math.min(c.x, x0 + TILE));
        const ny = Math.max(y0, Math.min(c.y, y0 + TILE));
        if ((c.x - nx) ** 2 + (c.y - ny) ** 2 > c.r * c.r) return;
        if (used >= capacity) return;
        index[used * 4] = i;
        used++;
      });
      const h = (ty * cols + tx) * 4;
      heads[h] = start;
      heads[h + 1] = used - start;
    }
  }
  return used;
};
