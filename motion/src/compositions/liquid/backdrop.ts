/**
 * The riverbed: the logo (hairline frame, peg rings, "Dance at / Kamogawa")
 * drawn on a 2D canvas in logo space on black. The water shader samples it
 * through the refracting surface and lights it with the ripples' caustics,
 * so the logo is genuinely seen *under* the water.
 */
import { DANCE_GLYPHS, FRAME, KAMO_GLYPHS, PEGS } from "../../logo";

export type BackdropColors = {
  readonly text: string;
  readonly frame: string;
};

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

export const drawBackdrop = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  unit: number,
  cam: { readonly x: number; readonly y: number },
  colors: BackdropColors,
): void => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  // Logo space -> px (same mapping as the shader).
  ctx.setTransform(unit, 0, 0, unit, width / 2 - cam.x * unit, height / 2 - cam.y * unit);

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
