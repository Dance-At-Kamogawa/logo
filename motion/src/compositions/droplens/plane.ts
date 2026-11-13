/**
 * The logo plane: hairline frame, grommet rings and "Dance at / Kamogawa",
 * drawn once into a square canvas in logo space. It never changes; the
 * shader decides how much of it is visible (only through the droplets at
 * first, then everywhere after the reveal wipe).
 */
import { DANCE_GLYPHS, FRAME, KAMO_GLYPHS, PEGS } from "../../logo";

/** Texture size (px) and the logo-space margin it covers around 0..1000. */
export const PLANE_TEX = 2048;
export const PLANE_PAD = 24;
export const PLANE_SPAN = 1000 + 2 * PLANE_PAD;

export type PlaneColors = { readonly text: string; readonly frame: string };

/** Hairline width of the frame in logo units (~1.6 px at a 1080 canvas, logoScale 0.62). */
const HAIRLINE = 2.4;

const path = (d: string): Path2D => new Path2D(d);

export const drawPlane = (ctx: CanvasRenderingContext2D, colors: PlaneColors): void => {
  const s = PLANE_TEX / PLANE_SPAN;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, PLANE_TEX, PLANE_TEX);
  ctx.setTransform(s, 0, 0, s, PLANE_PAD * s, PLANE_PAD * s);

  const { x, y, width, height } = FRAME.box;
  ctx.strokeStyle = colors.frame;
  ctx.lineWidth = HAIRLINE;
  ctx.strokeRect(x, y, width, height);

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
