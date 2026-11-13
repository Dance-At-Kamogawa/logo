import type React from "react";
import { AbsoluteFill } from "remotion";
import { beatsToDuration } from "../lib/beat";
import { useBeatClock } from "../lib/useBeatClock";
import { useStageBounds } from "../logo";
import { LensCanvas } from "./droplens/LensCanvas";
import { dropLensDefaults, dropLensSchema, type DropLensProps } from "./droplens/props";
import { introScene, T } from "./droplens/scene";

/*
 * DropLens (雫レンズ) — a few glass droplets drift in a black void. The logo
 * lies on a plane behind them but is dark: it is only seen *through* the
 * drops, magnified and upside down (ball lenses), with colour fringes.
 *   0-8     drops drift in one by one, scanning fragments of the type
 *   ~9-12   two drops brush past each other and briefly share a neck
 *   10-16   four of them steer to the grommets
 *   16      bar downbeat: they settle as glass beads (the image flips through
 *           the focus to upright), the logo plane lights up from the beads
 *   16-28   hold: beads glint round the corners on the beat, two free drops
 *           keep drifting over the type (= DropLensLoop)
 */

export { dropLensSchema };
export const dropLensCompDefaults: DropLensProps = dropLensDefaults;
export const dropLensDuration = (bpm: number, fps: number): number => beatsToDuration(T.total, bpm, fps);

export const DropLens: React.FC<DropLensProps> = (props) => {
  const { beat } = useBeatClock(props.bpm);
  const stage = useStageBounds(props.logoScale);
  const scene = introScene(beat);
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
