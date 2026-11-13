import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { beatsToDuration } from "../lib/beat";
import { useStageBounds } from "../logo";
import { LiquidCanvas } from "./liquid/LiquidCanvas";
import { liquidDefaults, liquidSchema } from "./liquid/props";
import { layoutFloaters, LOOP_BEATS, mod, restScene } from "./liquid/scene";

/*
 * LiquidLoop — seamless VJ loop of Liquid's final state (4 bars).
 *
 * Every motion is a periodic function of the loop phase
 * (frame / durationInFrames): harmonics sway on whole cycles, droplets orbit
 * whole circles, beat envelopes repeat. Frame N (one past the last) equals
 * frame 0. The tempo is stretched by < 0.2 % so the loop closes exactly.
 */

export const liquidLoopSchema = liquidSchema.extend({
  /** Rotate the loop's start point (frames). Used to verify seamlessness. */
  offsetFrames: z.number().int().min(0),
});
export type LiquidLoopProps = z.infer<typeof liquidLoopSchema>;
export const liquidLoopDefaults: LiquidLoopProps = { ...liquidDefaults, offsetFrames: 0 };
export const liquidLoopDuration = (bpm: number, fps: number): number => beatsToDuration(LOOP_BEATS, bpm, fps);

const ALL_ON = () => ({ opacity: 1, blur: 0, dy: 0 });

export const LiquidLoop: React.FC<LiquidLoopProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStageBounds(props.logoScale);
  const floaters = useMemo(
    () => layoutFloaters(stage),
    [stage.x, stage.y, stage.width, stage.height],
  );
  const phase = mod(frame + props.offsetFrames, durationInFrames) / durationInFrames;
  const scene = restScene(phase * LOOP_BEATS, floaters);

  return (
    <AbsoluteFill style={{ backgroundColor: props.background }}>
      <LiquidCanvas
        scene={scene}
        unit={stage.unit}
        liquidColor={props.liquidColor}
        colors={{ background: props.background, text: props.textColor, frame: props.frameColor }}
        backdrop={{ frameDraw: 1, rings: { tl: 1, tr: 1, bl: 1, br: 1 }, dance: ALL_ON, kamo: ALL_ON }}
      />
    </AbsoluteFill>
  );
};
