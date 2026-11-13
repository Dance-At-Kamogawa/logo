/**
 * The "logo lens": where each ray through the water would have to land for
 * the caustic light to draw the DAK logo (frame hairline, peg rings, glyphs).
 *
 * The logo is rasterised once into a binary mask in logo space, an exact
 * Euclidean distance transform (Felzenszwalb-Huttenlocher, tracking the
 * nearest feature pixel) gives, for every point of the floor, the nearest
 * point of the logo. Each vertex of the caustic mesh stores that point; the
 * vertex shader then squeezes the light from a band around every stroke into
 * the stroke (see `logoDisp` in shaders.ts). Pure function of the logo
 * geometry: computed once per page and cached.
 */
import { DANCE_GLYPHS, FRAME, KAMO_GLYPHS, PEGS } from "../../logo";

/** Logo-space square covered by the caustic mesh (the light pool's reach). */
export const LENS = { x0: -220, y0: -220, size: 1440 } as const;
/** Mesh vertices per side. */
export const GRID = 560;
/** Mask resolution (px per side). */
const MASK = 2048;
/** Width of the target hairline (logo units). */
const FRAME_TARGET = 3;

const { x: FX, y: FY, width: FW, height: FH } = FRAME.box;

const rasterLogo = (): Uint8Array => {
  const cv = document.createElement("canvas");
  cv.width = MASK;
  cv.height = MASK;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const out = new Uint8Array(MASK * MASK);
  if (!ctx) return out;
  const s = MASK / LENS.size;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MASK, MASK);
  ctx.setTransform(s, 0, 0, s, -LENS.x0 * s, -LENS.y0 * s);
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = FRAME_TARGET;
  ctx.strokeRect(FX, FY, FW, FH);
  for (const peg of PEGS) {
    ctx.lineWidth = peg.strokeWidth * 0.8;
    ctx.beginPath();
    ctx.arc(peg.cx, peg.cy, peg.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const g of DANCE_GLYPHS) {
    ctx.fill(new Path2D(g.fill));
    ctx.lineWidth = g.strokeWidth;
    ctx.stroke(new Path2D(g.stroke));
  }
  for (const g of KAMO_GLYPHS) ctx.fill(new Path2D(g.d));
  const img = ctx.getImageData(0, 0, MASK, MASK).data;
  for (let i = 0; i < out.length; i++) out[i] = (img[i * 4] ?? 0) >= 128 ? 1 : 0;
  return out;
};

/**
 * Exact 2D EDT with feature tracking. Returns, per pixel, the index of the
 * nearest mask pixel (-1 when the mask is empty).
 */
const nearestFeature = (mask: Uint8Array, n: number): Int32Array => {
  // Pass 1: nearest feature row within each column.
  const fy = new Int32Array(n * n).fill(-1);
  for (let x = 0; x < n; x++) {
    let last = -1;
    for (let y = 0; y < n; y++) {
      if (mask[y * n + x]) last = y;
      fy[y * n + x] = last;
    }
    let next = -1;
    for (let y = n - 1; y >= 0; y--) {
      if (mask[y * n + x]) next = y;
      const i = y * n + x;
      const up = fy[i] ?? -1;
      if (next >= 0 && (up < 0 || next - y < y - up)) fy[i] = next;
    }
  }
  // Pass 2: lower envelope of parabolas along each row.
  const out = new Int32Array(n * n).fill(-1);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const g = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    let k = -1;
    for (let q = 0; q < n; q++) {
      const r = fy[y * n + q] ?? -1;
      if (r < 0) continue;
      g[q] = (y - r) * (y - r);
      while (k >= 0) {
        const p = v[k] ?? 0;
        const s = (g[q]! + q * q - (g[p]! + p * p)) / (2 * q - 2 * p);
        if (s <= (z[k] ?? -Infinity)) k--;
        else {
          k++;
          v[k] = q;
          z[k] = s;
          z[k + 1] = Infinity;
          break;
        }
      }
      if (k < 0) {
        k = 0;
        v[0] = q;
        z[0] = -Infinity;
        z[1] = Infinity;
      }
    }
    if (k < 0) continue;
    let j = 0;
    for (let x = 0; x < n; x++) {
      while ((z[j + 1] ?? Infinity) < x) j++;
      const q = v[j] ?? 0;
      out[y * n + x] = (fy[y * n + q] ?? 0) * n + q;
    }
  }
  return out;
};

export type LensMesh = {
  /** xyz per vertex: source position on the floor (logo units), z = 0. */
  readonly position: Float32Array;
  /** Nearest point of the logo for every vertex (== position inside the logo). */
  readonly near: Float32Array;
  readonly index: Uint32Array;
};

let cached: LensMesh | null = null;

export const lensMesh = (): LensMesh => {
  if (cached) return cached;
  const mask = rasterLogo();
  const nearest = nearestFeature(mask, MASK);
  const texel = LENS.size / MASK;
  const position = new Float32Array(GRID * GRID * 3);
  const near = new Float32Array(GRID * GRID * 2);
  const step = LENS.size / (GRID - 1);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = LENS.x0 + i * step;
      const y = LENS.y0 + j * step;
      const v = j * GRID + i;
      position[v * 3] = x;
      position[v * 3 + 1] = y;
      const tx = Math.min(MASK - 1, Math.max(0, Math.floor((x - LENS.x0) / texel)));
      const ty = Math.min(MASK - 1, Math.max(0, Math.floor((y - LENS.y0) / texel)));
      const f = nearest[ty * MASK + tx] ?? -1;
      if (f < 0 || mask[ty * MASK + tx]) {
        near[v * 2] = x;
        near[v * 2 + 1] = y;
      } else {
        near[v * 2] = LENS.x0 + ((f % MASK) + 0.5) * texel;
        near[v * 2 + 1] = LENS.y0 + (Math.floor(f / MASK) + 0.5) * texel;
      }
    }
  }
  const index = new Uint32Array((GRID - 1) * (GRID - 1) * 6);
  let k = 0;
  for (let j = 0; j < GRID - 1; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i;
      const b = a + 1;
      const c = a + GRID;
      const d = c + 1;
      index.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  cached = { position, near, index };
  return cached;
};
