/**
 * Screen-space binning of the raindrop ripples. The canvas is cut into
 * TILE x TILE px tiles; each tile gets the list of drops whose ring (an
 * annulus that grows and widens with age) overlaps it, so the shader only
 * evaluates those. Most of a frame is calm water and costs almost nothing.
 */
export const TILE = 32;
export const INDEX_WIDTH = 1024;

export type Bins = {
  readonly cols: number;
  readonly rows: number;
  /** Per tile: offset into `index`, count. */
  readonly heads: Float32Array;
  /** Flattened drop indices. */
  readonly index: Float32Array;
};

/** An annulus in px: the region where one drop can change the surface. */
export type Ring = { readonly x: number; readonly y: number; readonly inner: number; readonly outer: number };

export const makeBins = (width: number, height: number, capacity: number): Bins => {
  const cols = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);
  return {
    cols,
    rows,
    heads: new Float32Array(cols * rows * 4),
    index: new Float32Array(Math.ceil(capacity / INDEX_WIDTH) * INDEX_WIDTH * 4),
  };
};

/** Fills `bins` in place for this frame. Returns the number of index entries used. */
export const binRings = (bins: Bins, rings: readonly Ring[]): number => {
  const { cols, rows, heads, index } = bins;
  const capacity = index.length / 4;
  let used = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const x1 = x0 + TILE;
      const y1 = y0 + TILE;
      const start = used;
      rings.forEach((c, i) => {
        // Nearest and farthest point of the tile from the ring centre.
        const nx = Math.max(x0, Math.min(c.x, x1)) - c.x;
        const ny = Math.max(y0, Math.min(c.y, y1)) - c.y;
        if (nx * nx + ny * ny > c.outer * c.outer) return;
        const fx = Math.max(Math.abs(x0 - c.x), Math.abs(x1 - c.x));
        const fy = Math.max(Math.abs(y0 - c.y), Math.abs(y1 - c.y));
        if (fx * fx + fy * fy < c.inner * c.inner) return;
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
