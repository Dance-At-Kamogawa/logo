import type React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { beatsToDuration } from "../lib/beat";
import { useBeatClock } from "../lib/useBeatClock";
import { useStageBounds } from "../logo";
import { CausticsCanvas } from "./caustics/CausticsCanvas";
import { causticsDefaults, causticsSchema, type CausticsProps } from "./caustics/props";
import { introScene, T } from "./caustics/scene";

/*
 * Caustics — コースティクス投影. A body of glass-clear water floats in the
 * dark and jiggles to the kick like water on a speaker cone; a light above
 * shines through it and the floor catches the caustic network.
 *   0-2.5   the light comes up: a small pool of filaments under the blob,
 *           seen at an angle
 *   2.5-12  the pool grows, every kick shakes the network (expanding ring,
 *           flashing focus); the camera starts to rise
 *   8-15.5  the wobble modes organise (axis-aligned, wavelengths dividing
 *           the square); a fleeting hint of the frame at beat 12
 *   15-16   bar downbeat: the water becomes a lens that focuses the light
 *           into the DAK logo
 *   16-19   the blob relaxes and drifts aside, the camera arrives top-down
 *   19-28   hold: the logo as a soft caustic projection, fine shimmer
 */

export { causticsSchema };
export const causticsCompDefaults: CausticsProps = causticsDefaults;
export const causticsDuration = (bpm: number, fps: number): number => beatsToDuration(T.total, bpm, fps);

export const Caustics: React.FC<CausticsProps> = (props) => {
  const { beat } = useBeatClock(props.bpm);
  const { width, height } = useVideoConfig();
  const stage = useStageBounds(props.logoScale);
  const scene = introScene(beat, { unit: stage.unit, width, height }, props.jiggle);
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
