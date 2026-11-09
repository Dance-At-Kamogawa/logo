import { zColor } from "@remotion/zod-types";
import { z } from "zod";
import { resolvePalette, type Palette } from "../logo/colors";

/** Props shared by every composition (editable in Remotion Studio). */
export const baseSchema = z.object({
  preset: z.enum(["ink", "white", "tarp"]),
  /** Overrides the preset's logo colour. Empty = use preset. */
  color: z.union([zColor(), z.literal("")]),
  /** Overrides the preset's background; "transparent" for alpha. Empty = preset. */
  background: z.string(),
  /** Tempo the motion is timed to. */
  bpm: z.number().min(60).max(240).step(1),
  /** Logo square size as a fraction of the shorter canvas side. */
  logoScale: z.number().min(0.3).max(1).step(0.01),
});

export type BaseProps = z.infer<typeof baseSchema>;

export const defaultBaseProps = {
  preset: "ink",
  color: "",
  background: "",
  bpm: 140,
  logoScale: 0.74,
} satisfies BaseProps;

export const paletteFromProps = (p: BaseProps): Palette =>
  resolvePalette(p.preset, { color: p.color || undefined, background: p.background || undefined });
