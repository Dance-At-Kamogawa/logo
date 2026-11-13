import { zColor } from "@remotion/zod-types";
import { z } from "zod";

/** Props for the Condensation / CondensationLoop compositions (fogged window, running drops). */
export const condensationSchema = z.object({
  /** Tempo: beads merge, start to run and surge on the beat. */
  bpm: z.number().min(60).max(240).step(1),
  /** Tint of the glass droplets: refraction fringes, caustics. */
  liquidColor: zColor(),
  /** "Dance at / Kamogawa" and the grommet rings (behind the glass). */
  textColor: zColor(),
  /** The hairline square. */
  frameColor: zColor(),
  /** The night behind the window (keep it near black). */
  background: zColor(),
  /** Milky tint of the condensation. */
  fogColor: zColor(),
  /** Warm city lights (sodium lamps, tail lights). */
  warmLight: zColor(),
  /** Cool city lights (aqua accents). */
  coolLight: zColor(),
  /** Overall brightness of the out-of-focus city lights. */
  lights: z.number().min(0).max(2).step(0.05),
  /** Density of the condensation (1 = default). */
  fog: z.number().min(0).max(1.5).step(0.05),
  /** Logo square size as a fraction of the shorter canvas side. */
  logoScale: z.number().min(0.3).max(1).step(0.01),
});

export type CondensationProps = z.infer<typeof condensationSchema>;

export const condensationDefaults = {
  bpm: 140,
  liquidColor: "#6fd3cd",
  textColor: "#dedede",
  frameColor: "#a6a6a6",
  background: "#000000",
  fogColor: "#9db3b5",
  warmLight: "#ffae5c",
  coolLight: "#7fd8e0",
  lights: 1,
  fog: 1,
  logoScale: 0.62,
} satisfies CondensationProps;
