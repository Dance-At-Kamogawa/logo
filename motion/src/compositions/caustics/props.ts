import { zColor } from "@remotion/zod-types";
import { z } from "zod";

/** Props for the Caustics / CausticsLoop compositions (コースティクス投影). */
export const causticsSchema = z.object({
  /** Tempo the water jiggles to. */
  bpm: z.number().min(60).max(240).step(1),
  /** Tint of the caustic light (the dim parts of the filaments; the cores burn to white). */
  lightColor: zColor(),
  /** Tint of the floating water (absorption, scatter, refraction fringes). */
  liquidColor: zColor(),
  /** "Dance at / Kamogawa" and the grommet rings in the resolved projection. */
  textColor: zColor(),
  /** The hairline square. */
  frameColor: zColor(),
  /** The floor / void (keep it near black). */
  background: zColor(),
  /** Logo square size as a fraction of the shorter canvas side. */
  logoScale: z.number().min(0.3).max(1).step(0.01),
  /** Strength of the beat jiggle (0 = still water, 1 = default, 2 = hard). */
  jiggle: z.number().min(0).max(2).step(0.05),
});

export type CausticsProps = z.infer<typeof causticsSchema>;

export const causticsDefaults = {
  bpm: 140,
  lightColor: "#8fe8e0",
  liquidColor: "#6fd3cd",
  textColor: "#dedede",
  frameColor: "#bdbdbd",
  background: "#000000",
  logoScale: 0.62,
  jiggle: 1,
} satisfies CausticsProps;
