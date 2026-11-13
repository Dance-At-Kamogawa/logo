import { zColor } from "@remotion/zod-types";
import { z } from "zod";

/** Props for DropLens / DropLensLoop (glass droplets lensing a hidden logo). */
export const dropLensSchema = z.object({
  /** Tempo the motion is timed to. */
  bpm: z.number().min(60).max(240).step(1),
  /** Glass tint (absorption + inner scatter of the droplets). */
  glassColor: zColor(),
  /** "Dance at / Kamogawa" and the grommet rings. */
  textColor: zColor(),
  /** The hairline square. */
  frameColor: zColor(),
  background: zColor(),
  /** Logo square size as a fraction of the shorter canvas side. */
  logoScale: z.number().min(0.3).max(1).step(0.01),
});

export type DropLensProps = z.infer<typeof dropLensSchema>;

export const dropLensDefaults = {
  bpm: 140,
  glassColor: "#6fd3cd",
  textColor: "#dedede",
  frameColor: "#b0b0b0",
  background: "#000000",
  logoScale: 0.62,
} satisfies DropLensProps;
