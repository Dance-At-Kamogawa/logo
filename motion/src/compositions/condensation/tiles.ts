/**
 * Screen-space binning. The canvas is cut into TILE x TILE px tiles; each
 * tile gets the list of primitives (beads, trail segments) whose bounding
 * circle overlaps it, so the shader only evaluates those. Most of a frame is
 * plain fog and costs almost nothing.
 */
export const TILE = 32;
export const INDEX_WIDTH = 1024;

export type Bins = {
  readonly cols: number;
  readonly rows: number;
  /** Per tile: offset into `index`, count. */
  readonly heads: Float32Array;
  /** Flattened primitive indices. */
  readonly index: Float32Array;
  /** Scratch: per-tile counters. */
  readonly counts: Int32Array;
};

/** A bounding circle in px. */
export type Circle = { readonly x: number; readonly y: number; readonly r: number };

export const makeBins = (width: number, height: number, capacity: number): Bins => {
  const cols = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);
  return {
    cols,
    rows,
    heads: new Float32Array(cols * rows * 4),
    index: new Float32Array(Math.ceil(capacity / INDEX_WIDTH) * INDEX_WIDTH * 4),
    counts: new Int32Array(cols * rows),
  };
};

type Range = { tx0: number; tx1: number; ty0: number; ty1: number };

const tileRange = (b: Bins, c: Circle): Range | null => {
  const tx0 = Math.max(0, Math.floor((c.x - c.r) / TILE));
  const tx1 = Math.min(b.cols - 1, Math.floor((c.x + c.r) / TILE));
  const ty0 = Math.max(0, Math.floor((c.y - c.r) / TILE));
  const ty1 = Math.min(b.rows - 1, Math.floor((c.y + c.r) / TILE));
  if (tx0 > tx1 || ty0 > ty1) return null;
  return { tx0, tx1, ty0, ty1 };
};

const overlaps = (c: Circle, tx: number, ty: number): boolean => {
  const nx = Math.max(tx * TILE, Math.min(c.x, (tx + 1) * TILE)) - c.x;
  const ny = Math.max(ty * TILE, Math.min(c.y, (ty + 1) * TILE)) - c.y;
  return nx * nx + ny * ny <= c.r * c.r;
};

/** Fills `bins` in place (counting sort). Returns the number of index entries used. */
export const binCircles = (b: Bins, circles: readonly Circle[]): number => {
  const { cols, heads, index, counts } = b;
  const capacity = index.length / 4;
  counts.fill(0);
  const ranges = circles.map((c) => tileRange(b, c));
  ranges.forEach((r, i) => {
    const c = circles[i];
    if (!r || !c) return;
    for (let ty = r.ty0; ty <= r.ty1; ty++)
      for (let tx = r.tx0; tx <= r.tx1; tx++) {
        if (!overlaps(c, tx, ty)) continue;
        const t = ty * cols + tx;
        counts[t] = (counts[t] ?? 0) + 1;
      }
  });
  let total = 0;
  for (let t = 0; t < counts.length; t++) {
    const n = Math.min(counts[t] ?? 0, Math.max(0, capacity - total));
    heads[t * 4] = total;
    heads[t * 4 + 1] = n;
    counts[t] = 0;
    total += n;
  }
  ranges.forEach((r, i) => {
    const c = circles[i];
    if (!r || !c) return;
    for (let ty = r.ty0; ty <= r.ty1; ty++)
      for (let tx = r.tx0; tx <= r.tx1; tx++) {
        if (!overlaps(c, tx, ty)) continue;
        const t = ty * cols + tx;
        const used = counts[t] ?? 0;
        if (used >= (heads[t * 4 + 1] ?? 0)) continue;
        index[((heads[t * 4] ?? 0) + used) * 4] = i;
        counts[t] = used + 1;
      }
  });
  return total;
};
