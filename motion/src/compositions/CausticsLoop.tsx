import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { beatsToDuration } from "../lib/beat";
import { useStageBounds } from "../logo";
import { CausticsCanvas } from "./caustics/CausticsCanvas";
import { causticsDefaults, causticsSchema } from "./caustics/props";
import { LOOP_BEATS, loopScene, mod } from "./caustics/scene";

/*
 * CausticsLoop — seamless VJ loop (4 bars) of the resolved projection: the
 * water keeps jiggling on the beat, the caustics shimmer, and every 2 bars
 * the logo partly dissolves into the network and re-forms on the downbeat.
 *
 * Every motion is a periodic function of the loop phase
 * (frame / durationInFrames): wave phases advance whole cycles, beat shapes
 * repeat per beat, the drops orbit closed paths. Frame N (one past the last)
 * equals frame 0. The tempo is stretched by < 0.2 % so the loop closes
 * exactly.
 */

export const causticsLoopSchema = causticsSchema.extend({
  /** Rotate the loop's start point (frames). Used to verify seamlessness. */
  offsetFrames: z.number().int().min(0),
});
export type CausticsLoopProps = z.infer<typeof causticsLoopSchema>;
export const causticsLoopDefaults: CausticsLoopProps = { ...causticsDefaults, offsetFrames: 0 };
export const causticsLoopDuration = (bpm: number, fps: number): number => beatsToDuration(LOOP_BEATS, bpm, fps);

export const CausticsLoop: React.FC<CausticsLoopProps> = (props) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const stage = useStageBounds(props.logoScale);
  const phase = mod(frame + props.offsetFrames, durationInFrames) / durationInFrames;
  const scene = loopScene(phase * LOOP_BEATS, { unit: stage.unit, width, height }, props.jiggle);
  return (
    <AbsoluteFill style={{ backgroundColor: props.background }}>
      <CausticsCanvas
        scene={scene}
        unit={stage.unit}
        colors={{
          light: props.lightColor,
          liquid: props.liquidColor,
          text: props.textColor,
          frame: props.frameColor,
          background: props.background,
        }}
      />
    </AbsoluteFill>
  );
};
