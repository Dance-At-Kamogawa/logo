import { zColor } from "@remotion/zod-types";
import { z } from "zod";

/** Props for the Liquid / LiquidLoop compositions (flyer look: aqua water on black). */
export const liquidSchema = z.object({
  /** Tempo the motion is timed to. */
  bpm: z.number().min(60).max(240).step(1),
  /** Water tint (absorption + scatter). */
  liquidColor: zColor(),
  /** "Dance at / Kamogawa" and the grommet rings. */
  textColor: zColor(),
  /** The thin square outline. */
  frameColor: zColor(),
  background: zColor(),
  /** Logo square size as a fraction of the shorter canvas side. */
  logoScale: z.number().min(0.3).max(1).step(0.01),
});

export type LiquidProps = z.infer<typeof liquidSchema>;

export const liquidDefaults = {
  bpm: 140,
  liquidColor: "#6fd3cd",
  textColor: "#c8c8c8",
  frameColor: "#9a9a9a",
  background: "#000000",
  logoScale: 0.66,
} satisfies LiquidProps;
