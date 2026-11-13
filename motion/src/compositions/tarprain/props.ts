import { zColor } from "@remotion/zod-types";
import { z } from "zod";

/** Props for TarpRain / TarpRainLoop (rain beads on the blue tarp collecting into the logo). */
export const tarpRainSchema = z.object({
  /** Tempo the rain falls to. */
  bpm: z.number().min(60).max(240).step(1),
  /** The tarp (night-dark blue; it is lit only by a dim pool of light). */
  tarpColor: zColor(),
  /** Tint of the water beads (refraction fringes, caustics, body scatter). */
  liquidColor: zColor(),
  /** "Dance at / Kamogawa" and the grommet rings, seen through the water. */
  textColor: zColor(),
  /** The hairline square, seen through its water line. */
  frameColor: zColor(),
  /** Beyond the light pool (keep it near black). */
  background: zColor(),
  /** Logo square size as a fraction of the shorter canvas side. */
  logoScale: z.number().min(0.3).max(1).step(0.01),
});

export type TarpRainProps = z.infer<typeof tarpRainSchema>;

export const tarpRainDefaults = {
  bpm: 140,
  tarpColor: "#163e86",
  liquidColor: "#8fdcd6",
  textColor: "#dedede",
  frameColor: "#b4b4b4",
  background: "#000000",
  logoScale: 0.7,
} satisfies TarpRainProps;
