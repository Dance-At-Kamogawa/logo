/**
 * The logo as a water-attracting distance field.
 *
 * The "wet" logo (Kamogawa a little swollen, the thin "Dance at" letters
 * dilated into bead lines, a thin water line along the frame, four puddle
 * discs over the grommets) is rasterised once on a 2D canvas at 2 texels per
 * logo unit, turned into an exact signed Euclidean distance field
 * (Felzenszwalb), smoothed against staircasing and downsampled to 1 texel per
 * logo unit. Connected components tell the beads which stroke they joined.
 *
 * Computed once per browser tab and cached; deterministic.
 */
import { DANCE_GLYPHS, FRAME, KAMO_GLYPHS, PEGS } from "../../logo";

/** Grid: logo coordinates [ORIGIN, ORIGIN + SIZE) at 1 texel per unit. */
export const FIELD_SIZE = 1024;
export const FIELD_ORIGIN = -12;
const SS = 2; // supersampling of the rasterised mask
const HI = FIELD_SIZE * SS;
const INF = 1e20;

/** Half-widths (logo units) of the water strokes. */
export const WATER = {
  frame: 3.6,
  dance: 3.2,
  kamo: 1.4,
  /** Puddle radius beyond the grommet ring radius. */
  peg: 11,
} as const;

export type ComponentKind = "frame" | "letter" | "peg";

export type LogoField = {
  /** Signed distance to the wet logo (logo units; < 0 inside), FIELD_SIZE^2. */
  readonly dist: Float32Array;
  /** Gradient of `dist` (x, y interleaved). */
  readonly grad: Float32Array;
  /** Connected component per texel inside (-1 outside). */
  readonly comp: Int32Array;
  readonly kinds: readonly ComponentKind[];
  /** Component id of each peg puddle, PEGS order. */
  readonly pegComps: readonly number[];
};

const pathCache = new Map<string, Path2D>();
const path2d = (d: string): Path2D => {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
};

/** Rasterises the wet logo at HI x HI; returns 1 inside, 0 outside. */
const rasterise = (): Uint8Array => {
  const cv = document.createElement("canvas");
  cv.width = HI;
  cv.height = HI;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, HI, HI);
  ctx.setTransform(SS, 0, 0, SS, -FIELD_ORIGIN * SS, -FIELD_ORIGIN * SS);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const { x, y, width, height } = FRAME.box;
  ctx.lineWidth = 2 * WATER.frame;
  ctx.strokeRect(x, y, width, height);

  for (const g of KAMO_GLYPHS) {
    ctx.fill(path2d(g.d));
    ctx.lineWidth = 2 * WATER.kamo;
    ctx.stroke(path2d(g.d));
  }
  for (const g of DANCE_GLYPHS) {
    ctx.fill(path2d(g.fill));
    ctx.lineWidth = g.strokeWidth + 2 * WATER.dance;
    ctx.stroke(path2d(g.stroke));
  }
  for (const peg of PEGS) {
    ctx.beginPath();
    ctx.arc(peg.cx, peg.cy, peg.r + WATER.peg, 0, Math.PI * 2);
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, HI, HI).data;
  const out = new Uint8Array(HI * HI);
  for (let i = 0; i < HI * HI; i++) out[i] = (img[i * 4] ?? 0) >= 128 ? 1 : 0;
  return out;
};

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
const edt1d = (f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void => {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    const fq = f[q] ?? INF;
    let s = 0;
    for (;;) {
      const vk = v[k] ?? 0;
      s = (fq + q * q - ((f[vk] ?? INF) + vk * vk)) / (2 * q - 2 * vk);
      if (s <= (z[k] ?? -INF) && k > 0) k--;
      else break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? INF) < q) k++;
    const vk = v[k] ?? 0;
    d[q] = (q - vk) * (q - vk) + (f[vk] ?? INF);
  }
};

/** Squared distance (texels) of every texel to the nearest texel where `feature` is true. */
const edt = (n: number, feature: (i: number) => boolean): Float64Array => {
  const grid = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) grid[i] = feature(i) ? 0 : INF;
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = grid[y * n + x] ?? INF;
    edt1d(f, n, d, v, z);
    for (let y = 0; y < n; y++) grid[y * n + x] = d[y] ?? INF;
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) f[x] = grid[y * n + x] ?? INF;
    edt1d(f, n, d, v, z);
    for (let x = 0; x < n; x++) grid[y * n + x] = d[x] ?? INF;
  }
  return grid;
};

const build = (): LogoField => {
  const mask = rasterise();
  const outside = edt(HI, (i) => mask[i] === 1);
  const inside = edt(HI, (i) => mask[i] === 0);
  const N = FIELD_SIZE;
  // Signed distance at HI, downsampled 2x2 -> N (units).
  const raw = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let acc = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const h = (y * SS + j) * HI + x * SS + i;
          const sd = mask[h] === 1 ? -(Math.sqrt(inside[h] ?? 0) - 0.5) : Math.sqrt(outside[h] ?? 0) - 0.5;
          acc += sd;
        }
      }
      raw[y * N + x] = acc / (SS * SS * SS);
    }
  }
  // [1 2 1]^2 smoothing removes the raster staircase from the normals.
  const at = (a: Float32Array, x: number, y: number): number =>
    a[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))] ?? 0;
  const tmp = new Float32Array(N * N);
  const dist = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) tmp[y * N + x] = (at(raw, x - 1, y) + 2 * at(raw, x, y) + at(raw, x + 1, y)) / 4;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) dist[y * N + x] = (at(tmp, x, y - 1) + 2 * at(tmp, x, y) + at(tmp, x, y + 1)) / 4;
  const grad = new Float32Array(N * N * 2);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = (at(dist, x + 1, y) - at(dist, x - 1, y)) / 2;
      const gy = (at(dist, x, y + 1) - at(dist, x, y - 1)) / 2;
      const l = Math.hypot(gx, gy) || 1;
      grad[(y * N + x) * 2] = gx / l;
      grad[(y * N + x) * 2 + 1] = gy / l;
    }
  }

  // Connected components of the wet area (4-connected flood fill).
  const comp = new Int32Array(N * N).fill(-1);
  const kinds: ComponentKind[] = [];
  const stack = new Int32Array(N * N);
  let next = 0;
  for (let s = 0; s < N * N; s++) {
    if ((dist[s] ?? 1) >= 0 || (comp[s] ?? 0) >= 0) continue;
    let top = 0;
    stack[top++] = s;
    comp[s] = next;
    let minX = N;
    let maxX = 0;
    while (top > 0) {
      const c = stack[--top] ?? 0;
      const cx = c % N;
      const cy = (c - cx) / N;
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      const nb = [cx > 0 ? c - 1 : -1, cx < N - 1 ? c + 1 : -1, cy > 0 ? c - N : -1, cy < N - 1 ? c + N : -1];
      for (const q of nb) {
        if (q < 0 || (dist[q] ?? 1) >= 0 || (comp[q] ?? 0) >= 0) continue;
        comp[q] = next;
        stack[top++] = q;
      }
    }
    kinds.push(maxX - minX > 0.8 * N ? "frame" : "letter");
    next++;
  }
  const pegComps = PEGS.map((peg) => {
    const id = comp[texelIndex(peg.cx, peg.cy)] ?? -1;
    if (id >= 0) kinds[id] = "peg";
    return id;
  });
  return { dist, grad, comp, kinds, pegComps };
};

/** Texel index of a logo-space point (clamped to the grid). */
export const texelIndex = (x: number, y: number): number => {
  const N = FIELD_SIZE;
  const i = Math.min(N - 1, Math.max(0, Math.floor(x - FIELD_ORIGIN)));
  const j = Math.min(N - 1, Math.max(0, Math.floor(y - FIELD_ORIGIN)));
  return j * N + i;
};

let cached: LogoField | null = null;
export const logoField = (): LogoField => {
  if (!cached) cached = build();
  return cached;
};

/** Signed distance to the wet logo at a logo-space point (nearest texel; far outside = large). */
export const fieldDistance = (f: LogoField, x: number, y: number): number => {
  const gx = x - FIELD_ORIGIN;
  const gy = y - FIELD_ORIGIN;
  const out = Math.max(0, -gx, gx - FIELD_SIZE, -gy, gy - FIELD_SIZE);
  return (f.dist[texelIndex(x, y)] ?? 100) + out;
};
