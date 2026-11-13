import type React from "react";
import { AbsoluteFill } from "remotion";
import { beatsToDuration } from "../lib/beat";
import { lerp } from "../lib/easing";
import { useBeatClock } from "../lib/useBeatClock";
import { useStageBounds } from "../logo";
import { LiquidCanvas } from "./liquid/LiquidCanvas";
import { liquidDefaults, liquidSchema, type LiquidProps } from "./liquid/props";
import { introWater, T } from "./liquid/scene";

/*
 * Liquid — 水面と波紋. The river at night, seen from above; the logo lies on
 * the riverbed and is only seen where raindrop ripples bend and focus light.
 *   0-1     still black water, faint city-light streaks drifting
 *   1-16    rain on the beat (off-beat doubles), the logo in passing fragments
 *   16      bar downbeat: four drops land on the four pegs at once; a light
 *           runs along the hairline frame
 *   16-23   a few last drops, the surface calms, the bed light develops in patches
 *   23-28   hold: readable under the water, slow undulation and caustic shimmer
 */

export { liquidSchema };
export const liquidCompDefaults: LiquidProps = liquidDefaults;
export const liquidDuration = (bpm: number, fps: number): number => beatsToDuration(T.total, bpm, fps);

const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2;

export const Liquid: React.FC<LiquidProps> = (props) => {
  const { beat } = useBeatClock(props.bpm);
  const stage = useStageBounds(props.logoScale);
  const scene = introWater(beat, stage, props.rainDensity);

  // Slow drift: from slightly close and off-centre to the full frame.
  const u = easeInOutSine(beat / (T.resolved + 2));
  const camera = {
    x: lerp(548, 500, u) + 4 * Math.sin(beat * 0.11),
    y: lerp(530, 500, u) + 3 * Math.cos(beat * 0.09),
    zoom: lerp(1.12, 1, u),
  };

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
