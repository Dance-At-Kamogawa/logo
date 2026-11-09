export type ColorPresetName = "ink" | "white" | "tarp";

export type Palette = {
  /** Logo colour (strokes + glyphs). */
  readonly color: string;
  /** Canvas background, or "transparent". */
  readonly background: string;
  /** Tarp (blue sheet) fill used for brief "tarp" moments in the motion. */
  readonly tarp: string;
};

export const TARP_BLUE = "#1f5fb4";

export const PRESETS: Record<ColorPresetName, Palette> = {
  // The original print colour on white.
  ink: { color: "#3f3f3f", background: "#ffffff", tarp: TARP_BLUE },
  // For VJ use: white on alpha.
  white: { color: "#ffffff", background: "transparent", tarp: "rgba(255,255,255,0.22)" },
  // White logo printed on the blue tarp itself.
  tarp: { color: "#ffffff", background: TARP_BLUE, tarp: "#2c74d1" },
};

export const resolvePalette = (preset: ColorPresetName, overrides: Partial<Palette> = {}): Palette => {
  const base = PRESETS[preset];
  return {
    color: overrides.color || base.color,
    background: overrides.background || base.background,
    tarp: overrides.tarp || base.tarp,
  };
};
