import type React from "react";
import { Frame } from "./Frame";
import { DANCE_GLYPHS, DanceGlyph, KAMO_GLYPHS, KamoGlyph } from "./Glyphs";
import { PEGS, Peg } from "./Peg";

/** The complete static logo in logo space (0..1000). */
export const LogoMark: React.FC<{ readonly color: string }> = ({ color }) => (
  <g>
    <Frame color={color} />
    {PEGS.map((p) => (
      <Peg key={p.id} peg={p} color={color} />
    ))}
    {DANCE_GLYPHS.map((g, i) => (
      <DanceGlyph key={i} glyph={g} color={color} />
    ))}
    {KAMO_GLYPHS.map((g, i) => (
      <KamoGlyph key={i} glyph={g} color={color} />
    ))}
  </g>
);
