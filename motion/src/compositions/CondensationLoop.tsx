import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { beatsToDuration } from "../lib/beat";
import { useStageBounds } from "../logo";
import { CondensationCanvas } from "./condensation/CondensationCanvas";
import { condensationDefaults, condensationSchema } from "./condensation/props";
import { LOOP_BEATS, loopScene, mod } from "./condensation/scene";

/*
 * CondensationLoop — seamless VJ loop (4 bars) of Condensation's resolved
 * state: the logo behind clear glass, a few beads; now and then a bead grows
 * heavy and runs down on the beat, wiping the fogged edges, and the fog
 * slowly re-forms from the edges and recedes again.
 *
 * Every motion is a periodic function of the loop phase
 * (frame / durationInFrames): each runner lives on its own local clock
 * (grow, run, trail re-fogs) that completes within the loop, the edge fog
 * breathes once per loop, the lights sway on closed curves and the cars wrap
 * off-stage. Frame N (one past the last) equals frame 0. The tempo is
 * stretched by < 0.2 % so the loop closes exactly.
 */

export const condensationLoopSchema = condensationSchema.extend({
  /** Rotate the loop's start point (frames). Used to verify seamlessness. */
  offsetFrames: z.number().int().min(0),
});
export type CondensationLoopProps = z.infer<typeof condensationLoopSchema>;
export const condensationLoopDefaults: CondensationLoopProps = { ...condensationDefaults, offsetFrames: 0 };
export const condensationLoopDuration = (bpm: number, fps: number): number => beatsToDuration(LOOP_BEATS, bpm, fps);

export const CondensationLoop: React.FC<CondensationLoopProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStageBounds(props.logoScale);
  const phase = mod(frame + props.offsetFrames, durationInFrames) / durationInFrames;
  const scene = loopScene(phase * LOOP_BEATS, stage);

  return (
    <AbsoluteFill style={{ backgroundColor: props.background }}>
      <CondensationCanvas
        scene={scene}
        unit={stage.unit}
        camera={{ x: 500, y: 500, zoom: 1 }}
        liquidColor={props.liquidColor}
        fogColor={props.fogColor}
        fog={props.fog}
        colors={{
          text: props.textColor,
          frame: props.frameColor,
          background: props.background,
          warm: props.warmLight,
          cool: props.coolLight,
          lights: props.lights,
        }}
      />
    </AbsoluteFill>
  );
};
