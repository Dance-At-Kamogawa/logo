import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { beatsToDuration } from "../lib/beat";
import { useBeatClock } from "../lib/useBeatClock";
import { useStageBounds } from "../logo";
import type { GlyphReveal } from "./liquid/backdrop";
import { LiquidCanvas } from "./liquid/LiquidCanvas";
import { liquidDefaults, liquidSchema, type LiquidProps } from "./liquid/props";
import { heroPos, introScene, layoutFloaters, T } from "./liquid/scene";
import { lerp } from "../lib/easing";

/*
 * Liquid — the flyer look: glossy aqua water on black.
 *   0-4.5    a single glass drop drifts down in slow motion
 *   4.2-7.4  more drops stream in from the edges and merge (metaballs)
 *   8        downbeat: the blob splashes into a crown of spikes, flinging droplets
 *   9-11.5   the thin square frame draws in (the tarp)
 *   9.4-12   four droplets fly to the corners and settle as glass beads (grommets)
 *   8-14     the splash relaxes into a wobbling puddle
 *   12.5-15  "Dance at / Kamogawa" surface *under* the water (refracted)
 *   16-24    hold: the puddle breathes on the beat, droplets float (= LiquidLoop)
 */

export { liquidSchema };
export const liquidCompDefaults: LiquidProps = liquidDefaults;
export const liquidDuration = (bpm: number, fps: number): number => beatsToDuration(T.total, bpm, fps);

const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2;

const reveal = (beat: number, start: number): GlyphReveal => {
  const t = Math.min(1, Math.max(0, (beat - start) / 1.6));
  const e = 1 - Math.pow(1 - t, 3);
  return { opacity: e, blur: 9 * (1 - e), dy: 10 * (1 - e) };
};

export const Liquid: React.FC<LiquidProps> = (props) => {
  const { beat } = useBeatClock(props.bpm);
  const stage = useStageBounds(props.logoScale);
  const floaters = useMemo(
    () => layoutFloaters(stage),
    [stage.x, stage.y, stage.width, stage.height],
  );
  const intro = introScene(beat, floaters);

  // Slow-motion close-up on the first drop, pulling back as the others stream in.
  const pull = easeInOutSine((beat - 1) / 6.5);
  const hero = heroPos(Math.min(beat, T.heroLand));
  const near = { x: lerp(hero.x, 500, 0.12), y: lerp(hero.y, 500, 0.12) - 40 };
  const camera = { x: lerp(near.x, 500, pull), y: lerp(near.y, 500, pull), zoom: lerp(3.2, 1, pull) };

  return (
    <AbsoluteFill style={{ backgroundColor: props.background }}>
      <LiquidCanvas
        scene={intro.scene}
        unit={stage.unit}
        camera={camera}
        liquidColor={props.liquidColor}
        colors={{ background: props.background, text: props.textColor, frame: props.frameColor }}
        backdrop={{
          frameDraw: intro.frameDraw,
          rings: intro.rings,
          dance: (i) => reveal(beat, T.danceFrom + i * 0.16),
          kamo: (i) => reveal(beat, T.kamoFrom + i * 0.12),
        }}
      />
    </AbsoluteFill>
  );
};
