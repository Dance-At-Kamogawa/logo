/**
 * The resolved logo as it is finally projected: drawn once on a 2D canvas in
 * logo space (light grey glyphs and rings, hairline frame, on black). The
 * composite shader samples it on the floor and lets the caustic light
 * modulate it, so the end state is crisp and readable while still shimmering.
 */
import { DANCE_GLYPHS, FRAME, KAMO_GLYPHS, PEGS } from "../../logo";

/** Logo-space square covered by the texture. */
export const LOGO_TEX = { x0: -50, y0: -50, size: 1100, px: 2048 } as const;

const { x: FX, y: FY, width: FW, height: FH } = FRAME.box;

export type LogoColors = { readonly text: string; readonly frame: string };

/**
 * @param hairline frame line width in logo units (about 1.8 px on screen).
 */
export const drawLogoTexture = (cv: HTMLCanvasElement, colors: LogoColors, hairline: number): void => {
  cv.width = LOGO_TEX.px;
  cv.height = LOGO_TEX.px;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const s = LOGO_TEX.px / LOGO_TEX.size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, LOGO_TEX.px, LOGO_TEX.px);
  ctx.setTransform(s, 0, 0, s, -LOGO_TEX.x0 * s, -LOGO_TEX.y0 * s);
  ctx.strokeStyle = colors.frame;
  ctx.lineWidth = hairline;
  ctx.strokeRect(FX, FY, FW, FH);
  ctx.strokeStyle = colors.text;
  for (const peg of PEGS) {
    ctx.lineWidth = peg.strokeWidth * 0.8;
    ctx.beginPath();
    ctx.arc(peg.cx, peg.cy, peg.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = colors.text;
  for (const g of DANCE_GLYPHS) {
    ctx.fill(new Path2D(g.fill));
    ctx.lineWidth = g.strokeWidth;
    ctx.miterLimit = 8;
    ctx.stroke(new Path2D(g.stroke));
  }
  for (const g of KAMO_GLYPHS) ctx.fill(new Path2D(g.d));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};
