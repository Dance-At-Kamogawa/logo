import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { beatsToDuration } from "../lib/beat";
import { useStageBounds } from "../logo";
import { LOOP_BEATS, mod } from "./tarprain/plan";
import { tarpRainDefaults, tarpRainSchema } from "./tarprain/props";
import { loopRain } from "./tarprain/scene";
import { TarpCanvas } from "./tarprain/TarpCanvas";

/*
 * TarpRainLoop — seamless VJ loop (4 bars) of TarpRain's resolved state: the
 * logo in water on the tarp, rain on the beat, beads rolling into strokes or
 * resting beads, now and then one leaving a stroke for another.
 *
 * Every motion is a periodic function of the loop phase
 * (frame / durationInFrames): event ages wrap modulo the loop, the light
 * sways on a closed curve, the camera too. Frame N (one past the last)
 * equals frame 0. The tempo is stretched by < 0.2 % so the loop closes exactly.
 */

export const tarpRainLoopSchema = tarpRainSchema.extend({
  /** Rotate the loop's start point (frames). Used to verify seamlessness. */
  offsetFrames: z.number().int().min(0),
});
export type TarpRainLoopProps = z.infer<typeof tarpRainLoopSchema>;
export const tarpRainLoopDefaults: TarpRainLoopProps = { ...tarpRainDefaults, offsetFrames: 0 };
export const tarpRainLoopDuration = (bpm: number, fps: number): number => beatsToDuration(LOOP_BEATS, bpm, fps);

export const TarpRainLoop: React.FC<TarpRainLoopProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStageBounds(props.logoScale);
  const phase = mod(frame + props.offsetFrames, durationInFrames) / durationInFrames;
  const scene = loopRain(phase * LOOP_BEATS);
  const a = 2 * Math.PI * phase;
  const camera = { x: 500 + 4 * Math.sin(a), y: 500 + 2.5 * Math.sin(2 * a + 0.6), zoom: 1 + 0.006 * Math.sin(a + 1.2) };

  return (
    <AbsoluteFill style={{ backgroundColor: props.background }}>
      <TarpCanvas
        scene={scene}
        unit={stage.unit}
        camera={camera}
        colors={{
          tarp: props.tarpColor,
          liquid: props.liquidColor,
          text: props.textColor,
          frame: props.frameColor,
          background: props.background,
        }}
      />
    </AbsoluteFill>
  );
};
