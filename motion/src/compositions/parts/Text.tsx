import type React from "react";
import { DANCE_GLYPHS, DanceGlyph, KAMO_GLYPHS, KamoGlyph } from "../../logo";
import type { DanceGlyphData, ElementTransform, KamoGlyphData, Origin } from "../../logo";

export type GlyphState = {
  readonly t?: ElementTransform;
  readonly opacity?: number;
  readonly origin?: Origin;
};

type Props = {
  readonly color: string;
  readonly dance?: (index: number, glyph: DanceGlyphData) => GlyphState;
  readonly kamo?: (index: number, glyph: KamoGlyphData) => GlyphState;
};

/** Both text lines with an optional per-glyph state (transform / opacity). */
export const LogoText: React.FC<Props> = ({ color, dance, kamo }) => (
  <g>
    {DANCE_GLYPHS.map((g, i) => {
      const s = dance?.(i, g) ?? {};
      return <DanceGlyph key={`d${i}`} glyph={g} color={color} t={s.t} opacity={s.opacity} origin={s.origin} />;
    })}
    {KAMO_GLYPHS.map((g, i) => {
      const s = kamo?.(i, g) ?? {};
      return <KamoGlyph key={`k${i}`} glyph={g} color={color} t={s.t} opacity={s.opacity} origin={s.origin} />;
    })}
  </g>
);
