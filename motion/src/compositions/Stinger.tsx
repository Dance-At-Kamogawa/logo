import type React from "react";
import { z } from "zod";
import { Frame, PEGS, Peg, Stage, TarpFill, directionalScale } from "../logo";
import { beatsToDuration } from "../lib/beat";
import { ease, lerp, progress, springAt, wobble } from "../lib/easing";
import { baseSchema, defaultBaseProps, paletteFromProps } from "../lib/schema";
import { combinedShake } from "../lib/shake";
import { useBeatClock } from "../lib/useBeatClock";
import { ImpactBurst } from "./parts/Impact";
import { LogoText } from "./parts/Text";

/*
 * Stinger — 4 beats (1.7 s at 140 BPM) for SNS intros / outros.
 *   0-0.5   pegs slam in from outside the frame
 *   0.5     tarp flash + frame whips around
 *   1       text pops with a whole-logo punch
 *   2.75-4  (outro) logo implodes into a single dot that pops away
 */

export const stingerSchema = baseSchema.extend({
  /** Play the implode-to-dot exit at the end (off = hold the logo). */
  outro: z.boolean(),
});
export type StingerProps = z.infer<typeof stingerSchema>;
export const stingerDefaults: StingerProps = { ...defaultBaseProps, outro: true };
export const STINGER_BEATS = 4;
export const stingerDuration = (bpm: number, fps: number): number => beatsToDuration(STINGER_BEATS, bpm, fps);

export const Stinger: React.FC<StingerProps> = (props) => {
  const palette = paletteFromProps(props);
  const { frame, fps, at } = useBeatClock(props.bpm);
  const color = palette.color;

  const hit = at(0.5);
  const textIn = at(1);
  const shake = combinedShake(frame, [hit, textIn], { amp: 9, decay: 0.22 });

  // Whole-logo punch when the text lands.
  const punch = 1 + wobble(frame, textIn, { amp: 0.05, freq: 0.6, decay: 0.2 });

  // Outro: anticipate (swell), then implode to a dot.
  const outroOn = props.outro;
  const implode = outroOn ? progress(frame, at(2.75), at(3.35), ease.anticipate) : 0;
  const logoScale = punch * (1 - implode);
  const dotIn = outroOn ? springAt(frame, fps, at(3.1), "pop") : 0;
  const dotOut = outroOn ? progress(frame, at(3.6), at(3.8), ease.slam) : 0;
  const dotR = 34 * dotIn * (1 - dotOut);

  const frameDraw = progress(frame, hit, hit + at(0.3), ease.out);
  const flash = (1 - progress(frame, hit + 2, hit + at(0.6), ease.out)) * (frame >= hit ? 1 : 0);

  return (
    <Stage palette={palette} logoScale={props.logoScale} camera={{ x: shake.x, y: shake.y }}>
      {logoScale > 0.001 ? (
        <g transform={`translate(500 500) scale(${logoScale}) translate(-500 -500)`}>
          <TarpFill color={palette.tarp} unfold={1} edge="center" opacity={flash} />
          <Frame color={color} progress={frameDraw} mode="corners" />
          {PEGS.map((peg) => {
            // From far outside the corner straight into place.
            const dirX = peg.cx < 500 ? -1 : 1;
            const dirY = peg.cy < 500 ? -1 : 1;
            const p = progress(frame, 0, hit, (t) => ease.slam(t) * 0.7 + t * 0.3);
            const dist = 340 * (1 - p);
            const landed = frame >= hit;
            const squash = landed ? wobble(frame, hit, { amp: 0.35, freq: 0.9, decay: 0.25 }) : 0;
            const angle = (Math.atan2(dirY, dirX) * 180) / Math.PI;
            const cx = peg.cx + dirX * dist;
            const cy = peg.cy + dirY * dist;
            const stretch = landed ? 1 - squash : 1 + 0.6 * (1 - p) * (p > 0 ? 1 : 0);
            return (
              <g key={peg.id}>
                <ImpactBurst x={peg.cx} y={peg.cy} color={color} age={frame - hit} life={20} radius={38} lines={6} rotation={angle} />
                <Peg
                  peg={peg}
                  color={color}
                  cx={cx}
                  cy={cy}
                  ring={progress(frame, hit - 2, hit + 4)}
                  dotRadius={28}
                  transform={directionalScale({ x: cx, y: cy }, angle, stretch, landed ? 1 + squash * 0.7 : 1 / Math.sqrt(stretch))}
                />
                {flash > 0.01 ? <Peg peg={peg} color={palette.onTarp} opacity={flash} /> : null}
              </g>
            );
          })}
          <LogoText
            color={color}
            dance={(i) => {
              const s = springAt(frame, fps, textIn + i * 0.8, { damping: 10, stiffness: 260, mass: 0.5 });
              return { t: { scale: lerp(0.3, 1, s) }, opacity: Math.min(1, s * 3) };
            }}
            kamo={(i) => {
              const s = springAt(frame, fps, textIn + 2 + i * 0.8, { damping: 18, stiffness: 240, mass: 0.6 });
              return { t: { scale: lerp(0.2, 1, s), dy: 30 * (1 - s) }, opacity: Math.min(1, s * 3) };
            }}
          />
        </g>
      ) : null}
      {dotR > 0.1 ? <circle cx={500} cy={500} r={dotR} fill={color} /> : null}
      {outroOn ? <ImpactBurst x={500} y={500} color={color} age={frame - at(3.8)} life={16} radius={20} lines={8} /> : null}
    </Stage>
  );
};
