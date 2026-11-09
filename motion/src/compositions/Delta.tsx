import { evolvePath } from "@remotion/paths";
import type React from "react";
import { z } from "zod";
import { FRAME, PEGS, Peg, Stage, directionalScale, type Corner } from "../logo";
import { beatEnvelope, beatsToDuration } from "../lib/beat";
import { ease, lerp, progress, springAt, tween, wobble } from "../lib/easing";
import { baseSchema, defaultBaseProps, paletteFromProps } from "../lib/schema";
import { combinedShake } from "../lib/shake";
import { useBeatClock } from "../lib/useBeatClock";
import { ImpactBurst } from "./parts/Impact";
import { LogoText } from "./parts/Text";

/*
 * Delta — the Kamo and Takano rivers draw in from the top and merge into a
 * Y (the Kamogawa Delta). A dot appears at the confluence, ripples outward,
 * and the last ripple squares off into the tarp. Pegs drop in, text rises.
 *
 * Beats (140 BPM -> 13 beats = 5.6 s):
 *   0-2    rivers draw in, meet on beat 2; stem flows on
 *   2      dot pops at the confluence
 *   3, 3.5 ripples
 *   4      the third ripple grows into the square
 *   5-6.5  pegs drop in on half beats (tl, tr, br, bl)
 *   7      "Dance at" rises, 7.75 "Kamogawa"
 *   9-13   hold, pegs pulse
 */

export const deltaSchema = baseSchema;
export type DeltaProps = z.infer<typeof deltaSchema>;
export const deltaDefaults: DeltaProps = { ...defaultBaseProps };
export const DELTA_BEATS = 13;
export const deltaDuration = (bpm: number, fps: number): number => beatsToDuration(DELTA_BEATS, bpm, fps);

const C = { x: 500, y: 590 } as const;
const RIVERS = {
  kamo: "M 160 -200 C 120 -40 336 10 292 190 C 254 344 430 440 500 590",
  takano: "M 860 -200 C 900 -60 700 0 728 180 C 752 330 574 450 500 590",
  stem: "M 500 590 C 500 720 452 880 516 1290",
} as const;

const PEG_ORDER: readonly Corner[] = ["tl", "tr", "br", "bl"];

export const Delta: React.FC<DeltaProps> = (props) => {
  const palette = paletteFromProps(props);
  const { frame, fps, beat, at } = useBeatClock(props.bpm);
  const color = palette.color;

  // --- rivers ----------------------------------------------------------------
  const kamoP = progress(frame, at(0), at(2), ease.inOut);
  const takanoP = progress(frame, at(0.4), at(2), ease.inOut);
  const stemP = progress(frame, at(2), at(3.25), ease.out);
  const riverFade = 1 - progress(frame, at(4), at(5), ease.inOut);
  const riverWidth = 11 * (1 - 0.5 * progress(frame, at(3.5), at(5)));

  // --- dot + ripples ---------------------------------------------------------
  const dotIn = springAt(frame, fps, at(2), "pop");
  const dotOut = progress(frame, at(3.85), at(4.15), ease.inOut);
  const dotR = 30 * dotIn * (1 - dotOut) * (1 + 0.25 * beatEnvelope(beat - 3, { decay: 7 }) * (beat < 4 ? 1 : 0));

  const ripple = (start: number, age: number) => {
    const life = 1.4;
    if (age < 0 || age > life) return null;
    const t = age / life;
    const r = 30 + 330 * (1 - Math.pow(1 - t, 3));
    return (
      <circle
        key={start}
        cx={C.x}
        cy={C.y}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={9 * (1 - t) + 1}
        opacity={0.75 * Math.pow(1 - t, 1.3)}
      />
    );
  };

  // The final ripple becomes the square tarp outline.
  const grow = springAt(frame, fps, at(4), { damping: 12, stiffness: 70, mass: 1 });
  const size = FRAME.box.width * grow;
  const squareness = progress(frame, at(4.2), at(5.1), ease.inOut);
  const cx = lerp(C.x, 500, Math.min(1, grow));
  const cy = lerp(C.y, 500, Math.min(1, grow));
  const rx = (size / 2) * (1 - squareness);
  const frameWeight = lerp(0.6, 1, progress(frame, at(4), at(5)));
  const showSquare = frame >= at(4);

  // --- pegs ------------------------------------------------------------------
  const pegLand = (i: number) => at(5 + i * 0.5);
  const shake = combinedShake(frame, PEG_ORDER.map((_, i) => pegLand(i)), { amp: 4, decay: 0.22 });
  const holdPulse = beatEnvelope(beat - 9, { decay: 5 }) * progress(frame, at(8.5), at(9.5));

  // --- text ------------------------------------------------------------------
  const rise = (start: number) => ({
    y: 46 * (1 - springAt(frame, fps, start, { damping: 14, stiffness: 120, mass: 0.8 })),
    o: progress(frame, start, start + 10, ease.out),
  });

  // Gentle push-in over the whole piece.
  const camScale = tween(frame, 0, at(DELTA_BEATS), 1.05, 1, ease.out);

  return (
    <Stage palette={palette} logoScale={props.logoScale} camera={{ x: shake.x, y: shake.y, scale: camScale }}>
      {riverFade > 0
        ? (
            [
              [RIVERS.kamo, kamoP],
              [RIVERS.takano, takanoP],
              [RIVERS.stem, stemP],
            ] as const
          ).map(([d, p], i) => {
            if (p <= 0) return null;
            const evolved = evolvePath(p, d);
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={riverWidth}
                strokeLinecap="round"
                strokeDasharray={evolved.strokeDasharray}
                strokeDashoffset={evolved.strokeDashoffset}
                opacity={riverFade}
              />
            );
          })
        : null}

      {ripple(3, beat - 3)}
      {ripple(3.5, beat - 3.5)}
      {dotR > 0.1 ? <circle cx={C.x} cy={C.y} r={dotR} fill={color} /> : null}

      {showSquare && size > 1 ? (
        <rect
          x={cx - size / 2}
          y={cy - size / 2}
          width={size}
          height={size}
          rx={rx}
          fill="none"
          stroke={color}
          strokeWidth={FRAME.strokeWidth * frameWeight}
          strokeLinejoin="round"
        />
      ) : null}

      {PEG_ORDER.map((corner, i) => {
        const peg = PEGS.find((p) => p.corner === corner);
        if (!peg) return null;
        const land = pegLand(i);
        const start = land - at(0.45);
        if (frame < start) return null;
        const fall = progress(frame, start, land, ease.slam);
        const landed = frame >= land;
        const squash = landed ? wobble(frame, land, { amp: 0.3, freq: 0.8, decay: 0.25 }) : 0;
        const center = { x: peg.cx, y: peg.cy };
        return (
          <g key={corner}>
            <ImpactBurst x={peg.cx} y={peg.cy} color={color} age={frame - land} life={22} radius={36} lines={0} />
            <Peg
              peg={peg}
              color={color}
              cy={peg.cy - 140 * (1 - fall)}
              scale={lerp(1.9, 1, fall) * (1 + 0.07 * holdPulse)}
              opacity={progress(frame, start, start + 6)}
              transform={directionalScale(center, 90, 1 - squash, 1 + squash * 0.7)}
            />
          </g>
        );
      })}

      <LogoText
        color={color}
        dance={(i) => {
          const r = rise(at(7) + i * 2.5);
          return { t: { dy: r.y }, opacity: r.o };
        }}
        kamo={(i) => {
          const r = rise(at(7.75) + i * 2.5);
          return { t: { dy: r.y * 1.3 }, opacity: r.o };
        }}
      />
    </Stage>
  );
};
