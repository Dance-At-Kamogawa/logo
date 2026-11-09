import type React from "react";
import { DANCE_GLYPHS, KAMO_GLYPHS } from "./geometry.generated";
import { boxCenter, transformAbout, type ElementTransform, type Origin } from "./transform";
import type { DanceGlyphData, KamoGlyphData } from "./types";

export { DANCE_GLYPHS, KAMO_GLYPHS };

type GlyphProps<T> = {
  readonly glyph: T;
  readonly color: string;
  readonly opacity?: number;
  readonly t?: ElementTransform;
  /** Pivot for `t` (defaults to the glyph's bbox centre). */
  readonly origin?: Origin;
};

/** One thin "Dance at" letter (fill + emboldening stroke, as in the source). */
export const DanceGlyph: React.FC<GlyphProps<DanceGlyphData>> = ({ glyph, color, opacity = 1, t, origin }) => {
  if (opacity <= 0) return null;
  return (
    <g opacity={opacity} transform={transformAbout(origin ?? boxCenter(glyph.box), t)}>
      <path d={glyph.fill} fill={color} />
      <path d={glyph.stroke} fill="none" stroke={color} strokeWidth={glyph.strokeWidth} strokeMiterlimit={8} />
    </g>
  );
};

/** One bold "Kamogawa" letter. */
export const KamoGlyph: React.FC<GlyphProps<KamoGlyphData>> = ({ glyph, color, opacity = 1, t, origin }) => {
  if (opacity <= 0) return null;
  return (
    <path
      d={glyph.d}
      fill={color}
      opacity={opacity}
      transform={transformAbout(origin ?? boxCenter(glyph.box), t)}
    />
  );
};

/** Union bbox of a glyph run. */
export const runBox = (glyphs: readonly { box: { x: number; y: number; width: number; height: number } }[]) => {
  const x = Math.min(...glyphs.map((g) => g.box.x));
  const y = Math.min(...glyphs.map((g) => g.box.y));
  const r = Math.max(...glyphs.map((g) => g.box.x + g.box.width));
  const b = Math.max(...glyphs.map((g) => g.box.y + g.box.height));
  return { x, y, width: r - x, height: b - y };
};

export const DANCE_BOX = runBox(DANCE_GLYPHS);
export const KAMO_BOX = runBox(KAMO_GLYPHS);
