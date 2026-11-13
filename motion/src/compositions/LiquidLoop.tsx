import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { beatsToDuration } from "../lib/beat";
import { useStageBounds } from "../logo";
import { LiquidCanvas } from "./liquid/LiquidCanvas";
import { liquidDefaults, liquidSchema } from "./liquid/props";
import { LOOP_BEATS, loopWater, mod } from "./liquid/scene";

/*
 * LiquidLoop — seamless VJ loop (4 bars) of Liquid's resolved state: rain on
 * the beat keeps rippling over the logo under the water.
 *
 * Every motion is a periodic function of the loop phase
 * (frame / durationInFrames): ripple ages wrap modulo the loop, the river's
 * plane waves and the streak drift run whole cycles, the camera sways on a
 * closed curve. Frame N (one past the last) equals frame 0. The tempo is
 * stretched by < 0.2 % so the loop closes exactly.
 */

export const liquidLoopSchema = liquidSchema.extend({
  /** Rotate the loop's start point (frames). Used to verify seamlessness. */
  offsetFrames: z.number().int().min(0),
});
export type LiquidLoopProps = z.infer<typeof liquidLoopSchema>;
export const liquidLoopDefaults: LiquidLoopProps = { ...liquidDefaults, offsetFrames: 0 };
export const liquidLoopDuration = (bpm: number, fps: number): number => beatsToDuration(LOOP_BEATS, bpm, fps);

export const LiquidLoop: React.FC<LiquidLoopProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStageBounds(props.logoScale);
  const phase = mod(frame + props.offsetFrames, durationInFrames) / durationInFrames;
  const scene = loopWater(phase * LOOP_BEATS, stage, props.rainDensity);
  const a = 2 * Math.PI * phase;
  const camera = { x: 500 + 5 * Math.sin(a), y: 500 + 3 * Math.sin(2 * a + 0.6), zoom: 1 + 0.008 * Math.sin(a + 1.2) };

  return (
    <AbsoluteFill style={{ backgroundColor: props.background }}>
      <LiquidCanvas
        scene={scene}
        unit={stage.unit}
        camera={camera}
        liquidColor={props.liquidColor}
        background={props.background}
        colors={{ text: props.textColor, frame: props.frameColor }}
      />
    </AbsoluteFill>
  );
};
