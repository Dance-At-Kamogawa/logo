import type React from "react";
import { AbsoluteFill } from "remotion";
import { beatsToDuration } from "../lib/beat";
import { lerp } from "../lib/easing";
import { useBeatClock } from "../lib/useBeatClock";
import { useStageBounds } from "../logo";
import { T } from "./tarprain/plan";
import { tarpRainDefaults, tarpRainSchema, type TarpRainProps } from "./tarprain/props";
import { introRain } from "./tarprain/scene";
import { TarpCanvas } from "./tarprain/TarpCanvas";

/*
 * TarpRain — シートの上の雨粒. The blue tarp at night, seen from above. Rain
 * falls on the beat; each drop makes a tiny crown and breaks into glass beads
 * that skitter over the water-repellent sheet and collect in the strokes of
 * the logo, until the logo is written in water.
 *   0-1     dark tarp, folds catching a dim light
 *   1-16    rain on the beat (denser bar by bar); beads roll into the frame,
 *           letters and type; some miss and stay on the tarp
 *   16      bar downbeat: the last beads arrive together, the remaining dry
 *           bits snap wet, four drops land on the grommets and spread into
 *           puddles; the light-grey type comes up under the water
 *   16-26   hold: readable logo in glossy water, rain keeps falling around it
 */

export { tarpRainSchema };
export const tarpRainCompDefaults: TarpRainProps = tarpRainDefaults;
export const tarpRainDuration = (bpm: number, fps: number): number => beatsToDuration(T.total, bpm, fps);

const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2;

export const TarpRain: React.FC<TarpRainProps> = (props) => {
  const { beat } = useBeatClock(props.bpm);
  const stage = useStageBounds(props.logoScale);
  const scene = introRain(beat);

  // Slow drift: from a little close and off-centre to the whole logo.
  const u = easeInOutSine(beat / (T.resolve + 1));
  const camera = {
    x: lerp(470, 500, u) + 3 * Math.sin(beat * 0.1),
    y: lerp(535, 500, u) + 2 * Math.cos(beat * 0.08),
    zoom: lerp(1.14, 1, u),
  };

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
