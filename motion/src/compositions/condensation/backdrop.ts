/**
 * What is behind the window: out-of-focus city lights (bokeh discs) on the
 * night, and the logo (hairline frame, peg rings, "Dance at / Kamogawa"),
 * drawn on a 2D canvas in logo space. The shader sees it sharp through clear
 * glass and droplets, and through the condensation as a heavily blurred copy
 * (drawn at quarter resolution with a canvas blur filter).
 */
import { DANCE_GLYPHS, FRAME, KAMO_GLYPHS, PEGS } from "../../logo";
import type { Light, LightKind } from "./scene";

export type BackdropColors = {
  readonly text: string;
  readonly frame: string;
  readonly background: string;
  readonly warm: string;
  readonly cool: string;
  /** Overall light brightness multiplier. */
  readonly lights: number;
};

export type Camera = { readonly x: number; readonly y: number; readonly zoom: number };

const pathCache = new Map<string, Path2D>();
const path = (d: string): Path2D => {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
};

const { x: FX, y: FY, width: FW, height: FH } = FRAME.box;

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const lightColor = (kind: LightKind, c: BackdropColors): [number, number, number] => {
  switch (kind) {
    case "warm":
      return hexToRgb(c.warm);
    case "cool":
      return hexToRgb(c.cool);
    case "red":
      return [255, 70, 52];
    case "white":
      return [255, 236, 214];
  }
};

/** One out-of-focus light: a flat disc with a slightly brighter rim and a soft edge. */
const drawLight = (ctx: CanvasRenderingContext2D, l: Light, c: BackdropColors): void => {
  const a = Math.min(1, 1.6 * l.intensity * c.lights);
  if (a <= 0.003 || l.r <= 0) return;
  const [r, g, b] = lightColor(l.kind, c);
  const grad = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
  const rgba = (k: number): string => `rgba(${r},${g},${b},${(a * k).toFixed(4)})`;
  grad.addColorStop(0, rgba(0.8));
  grad.addColorStop(0.72, rgba(0.9));
  grad.addColorStop(0.88, rgba(1));
  grad.addColorStop(1, rgba(0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
  ctx.fill();
};

export const drawBackdrop = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  unit: number,
  cam: Camera,
  lights: readonly Light[],
  colors: BackdropColors,
): void => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);

  // Logo space -> px (same mapping as the shader).
  ctx.setTransform(unit, 0, 0, unit, width / 2 - cam.x * unit, height / 2 - cam.y * unit);

  ctx.globalCompositeOperation = "lighter";
  for (const l of lights) drawLight(ctx, l, colors);
  ctx.globalCompositeOperation = "source-over";

  // The flyer's hairline square.
  const hairline = Math.max(1, 1.8 * (Math.min(width, height) / 1080));
  ctx.strokeStyle = colors.frame;
  ctx.lineWidth = hairline / unit;
  ctx.strokeRect(FX, FY, FW, FH);

  // Grommet rings.
  ctx.strokeStyle = colors.text;
  for (const peg of PEGS) {
    ctx.lineWidth = peg.strokeWidth * 0.8;
    ctx.beginPath();
    ctx.arc(peg.cx, peg.cy, peg.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = colors.text;
  for (const g of DANCE_GLYPHS) {
    ctx.fill(path(g.fill));
    ctx.lineWidth = g.strokeWidth;
    ctx.miterLimit = 8;
    ctx.stroke(path(g.stroke));
  }
  for (const g of KAMO_GLYPHS) ctx.fill(path(g.d));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};

/** Quarter-resolution, heavily blurred copy: the view through the condensation. */
export const BLUR_DOWNSCALE = 4;
export const drawBlurred = (
  dst: CanvasRenderingContext2D,
  scratch: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  blurPx: number,
): void => {
  const w = dst.canvas.width;
  const h = dst.canvas.height;
  for (const c of [dst, scratch]) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
  }
  scratch.filter = "none";
  scratch.drawImage(src, 0, 0, w, h);
  dst.filter = "none";
  dst.fillStyle = "#000000";
  dst.fillRect(0, 0, w, h);
  dst.filter = `blur(${blurPx.toFixed(2)}px)`;
  dst.drawImage(scratch.canvas, 0, 0);
  dst.filter = "none";
};
