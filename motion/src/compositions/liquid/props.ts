import { zColor } from "@remotion/zod-types";
import { z } from "zod";

/** Props for the Liquid / LiquidLoop compositions (night river, rain ripples). */
export const liquidSchema = z.object({
  /** Tempo the rain falls to. */
  bpm: z.number().min(60).max(240).step(1),
  /** Tint of the highlights: caustics, glints, refraction fringes, ripple crests. */
  liquidColor: zColor(),
  /** "Dance at / Kamogawa" and the grommet rings (on the riverbed). */
  textColor: zColor(),
  /** The hairline square. */
  frameColor: zColor(),
  /** The water body (keep it near black). */
  background: zColor(),
  /** Logo square size as a fraction of the shorter canvas side. */
  logoScale: z.number().min(0.3).max(1).step(0.01),
  /** 1 = default rain; < 1 drops some of the optional drops, 2 = every scheduled drop. */
  rainDensity: z.number().min(0).max(2).step(0.05),
});

export type LiquidProps = z.infer<typeof liquidSchema>;

export const liquidDefaults = {
  bpm: 140,
  liquidColor: "#6fd3cd",
  textColor: "#dedede",
  frameColor: "#a6a6a6",
  background: "#000000",
  logoScale: 0.62,
  rainDensity: 1,
} satisfies LiquidProps;
