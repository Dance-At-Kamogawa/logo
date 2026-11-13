import type React from "react";
import { AbsoluteFill } from "remotion";
import { beatsToDuration } from "../lib/beat";
import { lerp } from "../lib/easing";
import { useBeatClock } from "../lib/useBeatClock";
import { useStageBounds } from "../logo";
import { CondensationCanvas } from "./condensation/CondensationCanvas";
import { condensationDefaults, condensationSchema, type CondensationProps } from "./condensation/props";
import { introScene, T } from "./condensation/scene";

/*
 * Condensation — 窓の結露. A fogged window on a rainy Kyoto night; behind it
 * out-of-focus city lights and the logo.
 *   0-3     the lights come on behind the fog; the glass is a frosted haze
 *   0-16    glass beads grow and merge on the beat; from beat 5, beads heavy
 *           enough run down in surges on the beat, wiping clear meandering
 *           trails: the logo in passing slivers, each drop holding an
 *           inverted image of the night
 *   16      bar 5 downbeat: the fog evaporates outward from the four pegs
 *   20-28   hold: the logo crisp behind clear glass, a few beads left, the
 *           edges still fogged and striped with trails
 */

export { condensationSchema };
export const condensationCompDefaults: CondensationProps = condensationDefaults;
export const condensationDuration = (bpm: number, fps: number): number => beatsToDuration(T.total, bpm, fps);

const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2;

export const Condensation: React.FC<CondensationProps> = (props) => {
  const { beat } = useBeatClock(props.bpm);
  const stage = useStageBounds(props.logoScale);
  const scene = introScene(beat, stage);
  // A slow settle: from slightly close to the full frame.
  const u = easeInOutSine(beat / (T.revealEnd + 2));
  const camera = { x: lerp(512, 500, u), y: lerp(492, 500, u), zoom: lerp(1.07, 1, u) };

  return (
    <AbsoluteFill style={{ backgroundColor: props.background }}>
      <CondensationCanvas
        scene={scene}
        unit={stage.unit}
        camera={camera}
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
