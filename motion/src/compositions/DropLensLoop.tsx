import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { beatsToDuration } from "../lib/beat";
import { useStageBounds } from "../logo";
import { LensCanvas } from "./droplens/LensCanvas";
import { dropLensDefaults, dropLensSchema } from "./droplens/props";
import { LOOP_BEATS, loopScene, mod } from "./droplens/scene";

/*
 * DropLensLoop — seamless 4-bar VJ loop of DropLens's resolved state: four
 * glass beads on the grommets glint on the beat, two free drops drift over
 * the type and lens it.
 *
 * Every motion is a periodic function of the loop phase
 * (frame / durationInFrames), so frame N (one past the last) equals frame 0.
 * The tempo is stretched by < 0.2 % so the loop closes exactly.
 */

export const dropLensLoopSchema = dropLensSchema.extend({
  /** Rotate the loop's start point (frames). Used to verify seamlessness. */
  offsetFrames: z.number().int().min(0),
});
export type DropLensLoopProps = z.infer<typeof dropLensLoopSchema>;
export const dropLensLoopDefaults: DropLensLoopProps = { ...dropLensDefaults, offsetFrames: 0 };
export const dropLensLoopDuration = (bpm: number, fps: number): number => beatsToDuration(LOOP_BEATS, bpm, fps);

export const DropLensLoop: React.FC<DropLensLoopProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStageBounds(props.logoScale);
  const phase = mod(frame + props.offsetFrames, durationInFrames) / durationInFrames;
  const scene = loopScene(phase * LOOP_BEATS);
  return (
    <AbsoluteFill style={{ backgroundColor: props.background }}>
      <LensCanvas
        scene={scene}
        unit={stage.unit}
        glassColor={props.glassColor}
        background={props.background}
        colors={{ text: props.textColor, frame: props.frameColor }}
      />
    </AbsoluteFill>
  );
};
