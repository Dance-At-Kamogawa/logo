import type React from "react";
import { interpolate } from "remotion";
import { z } from "zod";
import { Frame, PEGS, Peg, Stage, TarpFill, directionalScale, type Corner } from "../logo";
import { DANCE_BOX, KAMO_BOX } from "../logo/Glyphs";
import { beatEnvelope, beatsToDuration } from "../lib/beat";
import { ease, lerp, progress, wobble } from "../lib/easing";
import { baseSchema, defaultBaseProps, paletteFromProps } from "../lib/schema";
import { combinedShake } from "../lib/shake";
import { useBeatClock } from "../lib/useBeatClock";
import { ImpactBurst } from "./parts/Impact";
import { LogoText } from "./parts/Text";

/*
 * TarpDrop — the blue tarp flutters down from above, lands with a bounce,
 * four pegs are hammered in one per beat, then the text stamps in.
 *
 * Beats (140 BPM -> 10 beats = 4.3 s):
 *   0-1.5  fall with flutter (skew / rotation / scaleY ripple), land on 1.5
 *   2,3,4,5 pegs hammered: tl, br, tr, bl (diagonal, like real pegging)
 *   6      "Dance at" stamps, 7 "Kamogawa" stamps; fill settles to outline
 *   8-10   hold, pegs pulse
 */

export const tarpDropSchema = baseSchema;
export type TarpDropProps = z.infer<typeof tarpDropSchema>;
export const tarpDropDefaults: TarpDropProps = { ...defaultBaseProps };
export const TARPDROP_BEATS = 10;
export const tarpDropDuration = (bpm: number, fps: number): number => beatsToDuration(TARPDROP_BEATS, bpm, fps);

const LAND = 1.5;
const HAMMER: readonly { corner: Corner; beat: number }[] = [
  { corner: "tl", beat: 2 },
  { corner: "br", beat: 3 },
  { corner: "tr", beat: 4 },
  { corner: "bl", beat: 5 },
];
const STAMP_DANCE = 6;
const STAMP_KAMO = 7;
const GROUND = { x: 500, y: 993 } as const;

export const TarpDrop: React.FC<TarpDropProps> = (props) => {
  const palette = paletteFromProps(props);
  const { frame, beat, at } = useBeatClock(props.bpm);
  const color = palette.color;
  const land = at(LAND);

  // --- fall + flutter ---------------------------------------------------------
  // Accelerates in, still fast on contact (so the landing reads as an impact).
  const fall = progress(frame, 0, land, (t) => ease.slam(t) * 0.55 + t * 0.45);
  const airborne = 1 - fall;
  const ft = frame / 60;
  const flutter = {
    rotate: 7 * Math.sin(ft * 7.5) * airborne,
    skewX: 9 * Math.sin(ft * 9.3 + 1.1) * airborne,
    scaleY: 1 - 0.2 * Math.abs(Math.sin(ft * 6.1 + 0.4)) * airborne,
    dx: 60 * Math.sin(ft * 4.2) * airborne,
  };
  const dy = -1500 * airborne;
  // Landing bounce: squash at the ground, then wobble.
  const bounce = frame >= land ? wobble(frame, land, { amp: 0.09, freq: 0.55, decay: 0.16 }) : 0;
  const tarpTransform =
    `translate(${GROUND.x + flutter.dx} ${GROUND.y + dy}) rotate(${flutter.rotate}) skewX(${flutter.skewX}) ` +
    `scale(${(1 + bounce * 0.6) * 1} ${flutter.scaleY * (1 - bounce)}) translate(${-GROUND.x} ${-GROUND.y})`;

  // --- hammer impacts --------------------------------------------------------
  const impactFrames = [land, ...HAMMER.map((h) => at(h.beat)), at(STAMP_DANCE), at(STAMP_KAMO)];
  const shake = combinedShake(frame, impactFrames, { amp: 6, decay: 0.2 });
  // Each hit dents the tarp a little.
  const dent = HAMMER.reduce((acc, h) => acc + wobble(frame, at(h.beat), { amp: 0.006, freq: 0.9, decay: 0.3 }), 0);

  // Fill: solid while falling and pegging, settles to the outline at the stamp.
  const fillOpacity = 1 - progress(frame, at(STAMP_DANCE - 0.5), at(STAMP_KAMO + 0.5), ease.inOut);
  const holdPulse = beatEnvelope(beat - 8, { decay: 5 }) * progress(frame, at(7.5), at(8.5));

  const stamp = (start: number) => {
    const t0 = start - 9;
    const p = progress(frame, t0, start, ease.slam);
    const settle = frame >= start ? wobble(frame, start, { amp: 0.06, freq: 0.9, decay: 0.28 }) : 0;
    return { scale: lerp(1.9, 1, p) * (1 - settle), opacity: progress(frame, t0, t0 + 4) };
  };
  const sDance = stamp(at(STAMP_DANCE));
  const sKamo = stamp(at(STAMP_KAMO));
  const danceOrigin = { x: DANCE_BOX.x + DANCE_BOX.width / 2, y: DANCE_BOX.y + DANCE_BOX.height / 2 };
  const kamoOrigin = { x: KAMO_BOX.x + KAMO_BOX.width / 2, y: KAMO_BOX.y + KAMO_BOX.height / 2 };

  return (
    <Stage palette={palette} logoScale={props.logoScale} camera={{ x: shake.x, y: shake.y }}>
      <g transform={`translate(500 500) scale(${1 + dent}) translate(-500 -500)`}>
        <g transform={tarpTransform}>
          <TarpFill color={palette.tarp} opacity={fillOpacity} />
          <Frame color={color} />
        </g>
      </g>

      {HAMMER.map(({ corner, beat: b }, i) => {
        const peg = PEGS.find((p) => p.corner === corner);
        if (!peg) return null;
        const hit = at(b);
        const start = hit - at(0.4);
        if (frame < start) return null;
        // Wind-up: rises a bit, then slams.
        const lift = interpolate(frame, [start, start + (hit - start) * 0.55, hit], [0, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease.inOut,
        });
        const slam = progress(frame, start + (hit - start) * 0.55, hit, ease.slam);
        const scale = frame < hit ? lerp(1.5, 2.1, lift) * (1 - slam) + slam : 1;
        const squash = frame >= hit ? wobble(frame, hit, { amp: 0.32, freq: 0.85, decay: 0.24 }) : 0;
        const center = { x: peg.cx, y: peg.cy };
        return (
          <g key={corner}>
            <ImpactBurst x={peg.cx} y={peg.cy} color={color} age={frame - hit} life={22} radius={38} lines={8} rotation={i * 22} />
            {/* Shadow of the raised peg. */}
            {frame < hit ? (
              <circle cx={peg.cx} cy={peg.cy} r={peg.r * (1 - 0.4 * lift)} fill={color} opacity={0.12 + 0.18 * slam} />
            ) : null}
            <Peg
              peg={peg}
              color={color}
              cy={peg.cy - 50 * lift}
              scale={scale * (1 + 0.07 * holdPulse)}
              opacity={progress(frame, start, start + 5)}
              transform={directionalScale(center, 0, 1 + squash * 0.7, 1 - squash)}
            />
            {/* Grommets read white on the solid tarp; fades with the fill. */}
            <Peg
              peg={peg}
              color={palette.onTarp}
              cy={peg.cy - 50 * lift}
              scale={scale * (1 + 0.07 * holdPulse)}
              opacity={progress(frame, start, start + 5) * (frame >= hit ? fillOpacity : 0)}
              transform={directionalScale(center, 0, 1 + squash * 0.7, 1 - squash)}
            />
          </g>
        );
      })}

      <LogoText
        color={color}
        dance={() => ({ t: { scale: sDance.scale }, opacity: sDance.opacity, origin: danceOrigin })}
        kamo={() => ({ t: { scale: sKamo.scale }, opacity: sKamo.opacity, origin: kamoOrigin })}
      />
      {fillOpacity > 0.01 ? (
        <g opacity={fillOpacity}>
          <LogoText
            color={palette.onTarp}
            dance={() => ({ t: { scale: sDance.scale }, opacity: sDance.opacity, origin: danceOrigin })}
            kamo={() => ({ t: { scale: sKamo.scale }, opacity: sKamo.opacity, origin: kamoOrigin })}
          />
        </g>
      ) : null}
    </Stage>
  );
};
