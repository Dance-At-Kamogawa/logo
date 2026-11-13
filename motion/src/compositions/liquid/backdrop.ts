/**
 * The "dry" layer under the liquid: background, the thin square frame, the
 * peg rings and the "Dance at / Kamogawa" glyphs, drawn on a 2D canvas in
 * logo space. The liquid shader samples it with refraction, so the text is
 * genuinely seen *through* the water.
 */
import { DANCE_GLYPHS, FRAME, KAMO_GLYPHS, PEGS } from "../../logo";
import type { Corner } from "../../logo";

export type GlyphReveal = {
  readonly opacity: number;
  /** Blur radius in px. */
  readonly blur: number;
  /** Vertical offset in logo units. */
  readonly dy: number;
};

export type BackdropState = {
  readonly frameDraw: number;
  readonly rings: Readonly<Record<Corner, number>>;
  readonly dance: (i: number) => GlyphReveal;
  readonly kamo: (i: number) => GlyphReveal;
};

export type BackdropColors = {
  readonly background: string;
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
  state: BackdropState,
  colors: BackdropColors,
): void => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);

  // Logo space -> px (same mapping as the shader).
  const toPx = (): void => ctx.setTransform(unit, 0, 0, unit, width / 2 - cam.x * unit, height / 2 - cam.y * unit);
  toPx();

  // Thin frame (the flyer's hairline square), drawn in from the four corners.
  const hairline = Math.max(1, 1.6 * (Math.min(width, height) / 1080));
  const fp = Math.max(0, Math.min(1, state.frameDraw));
  if (fp > 0) {
    ctx.strokeStyle = colors.frame;
    ctx.lineWidth = hairline / unit;
    ctx.lineCap = "butt";
    const corners: [number, number][] = [
      [FX, FY],
      [FX + FW, FY],
      [FX + FW, FY + FH],
      [FX, FY + FH],
    ];
    ctx.beginPath();
    corners.forEach(([sx, sy], i) => {
      const [ex, ey] = corners[(i + 1) % 4] ?? corners[0] ?? [sx, sy];
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (ex - sx) * fp, sy + (ey - sy) * fp);
    });
    if (fp >= 1) ctx.closePath();
    ctx.stroke();
  }

  // Grommet rings (seen through the glass beads that land on them).
  for (const peg of PEGS) {
    const t = state.rings[peg.corner];
    if (t <= 0) continue;
    ctx.globalAlpha = t;
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = peg.strokeWidth * 0.7;
    ctx.beginPath();
    ctx.arc(peg.cx, peg.cy, peg.r * (0.6 + 0.4 * t), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const withGlyph = (reveal: GlyphReveal, draw: () => void): void => {
    if (reveal.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, reveal.opacity);
    if (reveal.blur > 0.05) ctx.filter = `blur(${reveal.blur.toFixed(2)}px)`;
    ctx.translate(0, reveal.dy);
    draw();
    ctx.restore();
  };

  ctx.fillStyle = colors.text;
  ctx.strokeStyle = colors.text;
  DANCE_GLYPHS.forEach((g, i) =>
    withGlyph(state.dance(i), () => {
      ctx.fillStyle = colors.text;
      ctx.strokeStyle = colors.text;
      ctx.fill(path(g.fill));
      ctx.lineWidth = g.strokeWidth;
      ctx.miterLimit = 8;
      ctx.stroke(path(g.stroke));
    }),
  );
  KAMO_GLYPHS.forEach((g, i) =>
    withGlyph(state.kamo(i), () => {
      ctx.fillStyle = colors.text;
      ctx.fill(path(g.d));
    }),
  );
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};
