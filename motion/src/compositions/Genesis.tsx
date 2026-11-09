import { getLength, getPointAtLength } from "@remotion/paths";
import type React from "react";
import { interpolate } from "remotion";
import { z } from "zod";
import {
  Frame,
  GOO_FILTER_ID,
  PEG_CENTERS,
  Peg,
  Stage,
  TarpFill,
  directionalScale,
  pegByCorner,
  type Corner,
} from "../logo";
import { beatEnvelope, beatsToDuration, gatedEnvelope } from "../lib/beat";
import { ease, lerp, progress, springAt, tween, wobble } from "../lib/easing";
import { baseSchema, defaultBaseProps, paletteFromProps } from "../lib/schema";
import { combinedShake } from "../lib/shake";
import { useBeatClock } from "../lib/useBeatClock";
import { SoundWave, SpeakerRings } from "./parts/Speaker";
import { Typewriter, typewriterEnd, type TypewriterTiming } from "./parts/Typewriter";

/*
 * Genesis — "an event sprouts out of nothing".
 *
 * Timeline in beats (default 140 BPM -> 22 beats = 9.4 s):
 *   0.5   a dot pops into existence (tiny, beat, spring)
 *   1.25  stretches, divides like a cell (goo/metaball) -> two dots
 *   2.5   the dots open up into speakers, thumping on every beat from 3
 *   3.5   winding journey down two rivers (Kamo / Takano) to the Delta
 *   9.0   speakers fold back into dots and divide again
 *   9.75  four dots fly to the corners, land as pegs on beat 11
 *   11.25 the tarp unfolds between the pegs, outline draws from corners
 *   12.5  caret; "Dance at" typed from 13, "Kamogawa" from 15.5
 *   ~18   hold, pegs pulse on the beat
 */

export const genesisSchema = baseSchema;
export type GenesisProps = z.infer<typeof genesisSchema>;
export const genesisDefaults: GenesisProps = { ...defaultBaseProps };

export const GENESIS_BEATS = 22;
export const genesisDuration = (bpm: number, fps: number): number => beatsToDuration(GENESIS_BEATS, bpm, fps);

const T = {
  dot: 0.5,
  dotGrow: 0.85,
  mitosis: 1.5,
  speakers: 2.5,
  thumpFrom: 3,
  thumpTo: 9,
  journey: 3.5,
  source: 5,
  journeyEnd: 9,
  collapse: 9,
  mitosis2: 9.3,
  fly: 9.85,
  land: 11,
  tarp: 11.25,
  frameDone: 12.4,
} as const;

const TYPE: TypewriterTiming = { caretIn: 12.5, line1: 13, line2: 15.5, step: 0.25, caretOut: 19.5 };

const CENTER = { x: 500, y: 500 } as const;
const SPLIT = 170;
const DOT_R = 32;
const CELL_R = 26;
const CAP_R = 17;
const CONFLUENCE = { x: 500, y: 650 } as const;

// Two "rivers": Kamo from the north-west, Takano from the north-east, meeting
// at the Delta in a Y. The speakers first drift up to the sources (APPROACH,
// not drawn), then meander downstream (RIVERS, drawn as trails).
const APPROACH = {
  kamo: "M 415 500 C 330 500 210 360 190 210 C 182 140 192 90 210 60",
  takano: "M 585 500 C 670 500 800 350 812 220 C 818 160 812 110 800 70",
} as const;
const RIVERS = {
  kamo: "M 210 60 C 310 140 140 230 236 320 C 312 392 196 466 318 540 C 386 580 420 600 440 632",
  takano: "M 800 70 C 712 150 852 236 774 322 C 712 392 808 470 684 540 C 614 580 580 600 560 632",
  delta: "M 500 652 C 500 760 466 880 500 1240",
} as const;
const lengths = <K extends string>(paths: Record<K, string>): Record<K, number> =>
  Object.fromEntries(Object.entries<string>(paths).map(([k, d]) => [k, getLength(d)])) as Record<K, number>;
const RIVER_LEN = lengths(RIVERS);
const APPROACH_LEN = lengths(APPROACH);

type Side = "kamo" | "takano";
type Pt = { x: number; y: number };

export const Genesis: React.FC<GenesisProps> = (props) => {
  const palette = paletteFromProps(props);
  const clock = useBeatClock(props.bpm);
  const { frame, fps, beat, at } = clock;
  const color = palette.color;

  // --- 1. the first dot ----------------------------------------------------
  const tiny = tween(frame, at(T.dot), at(T.dot) + 5, 0, 7, ease.out);
  const anticip = interpolate(frame, [at(T.dotGrow) - 5, at(T.dotGrow)], [0, 2.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const grow = springAt(frame, fps, at(T.dotGrow), "pop");
  const firstDotR = frame < at(T.dotGrow) ? tiny - anticip : lerp(tiny - 2.5, DOT_R, grow);
  // Idle "breathing" of the single cell before it divides.
  const breathe = 1 + 0.04 * Math.sin((frame - at(T.dotGrow)) * 0.22) * progress(frame, at(T.dotGrow), at(T.mitosis));

  // --- 2. mitosis -----------------------------------------------------------
  const stretch = tween(frame, at(T.mitosis) - 10, at(T.mitosis), 1, 1.18, ease.inOut);
  const sep = springAt(frame, fps, at(T.mitosis), { damping: 13, stiffness: 70, mass: 1 }) * SPLIT;

  // --- 3. speakers ------------------------------------------------------------
  const open =
    springAt(frame, fps, at(T.speakers), "bouncy") * (1 - progress(frame, at(T.collapse), at(T.collapse) + 12, ease.inOut));
  const thump = (side: Side): number =>
    gatedEnvelope(beat + (side === "takano" ? 0 : 0), T.thumpFrom, T.thumpTo, { decay: 5 });

  const journeyT = progress(frame, at(T.source), at(T.journeyEnd), ease.sine);
  const riverPoint = (side: Side, t: number): Pt => getPointAtLength(RIVERS[side], RIVER_LEN[side] * t) ?? CONFLUENCE;
  const approachPoint = (side: Side, t: number): Pt =>
    getPointAtLength(APPROACH[side], APPROACH_LEN[side] * t) ?? CONFLUENCE;

  /** Speaker (cell) centre at any frame up to the second division. */
  const speakerPos = (side: Side, f: number): Pt => {
    const sign = side === "kamo" ? -1 : 1;
    if (f < at(T.journey)) {
      const s = springAt(f, fps, at(T.mitosis), { damping: 13, stiffness: 70, mass: 1 }) * SPLIT;
      return { x: CENTER.x + (sign * s) / 2, y: CENTER.y };
    }
    if (f < at(T.source)) return approachPoint(side, progress(f, at(T.journey), at(T.source), ease.inOut));
    return riverPoint(side, progress(f, at(T.source), at(T.journeyEnd), ease.sine));
  };

  // Directional squash from velocity (secondary motion).
  const squashFor = (p: Pt, prev: Pt, gain = 0.012, max = 0.22) => {
    const vx = p.x - prev.x;
    const vy = p.y - prev.y;
    const speed = Math.hypot(vx, vy);
    const k = Math.min(max, speed * gain);
    return { angle: (Math.atan2(vy, vx) * 180) / Math.PI, along: 1 + k, across: 1 - k * 0.6 };
  };

  // --- 4. second division + flight to the corners --------------------------
  const corners: readonly { corner: Corner; side: Side; vSign: number; delay: number }[] = [
    { corner: "tl", side: "kamo", vSign: -1, delay: 0 },
    { corner: "tr", side: "takano", vSign: -1, delay: 2 },
    { corner: "br", side: "takano", vSign: 1, delay: 3 },
    { corner: "bl", side: "kamo", vSign: 1, delay: 5 },
  ];
  const sep2 = springAt(frame, fps, at(T.mitosis2), { damping: 12, stiffness: 90, mass: 0.8 }) * 76;
  const landFrame = (delay: number) => at(T.land) + delay;
  const flyEase = (t: number) => ease.anticipate(t);

  const flightPos = (c: (typeof corners)[number], f: number): Pt => {
    const base = speakerPos(c.side, at(T.journeyEnd));
    const s = springAt(f, fps, at(T.mitosis2), { damping: 12, stiffness: 90, mass: 0.8 }) * 76;
    const start = { x: base.x, y: base.y + (c.vSign * s) / 2 };
    const end = PEG_CENTERS[c.corner];
    const t0 = at(T.fly) + c.delay * 0.5;
    const t1 = landFrame(c.delay);
    if (f <= t0) return start;
    const raw = Math.min(1, (f - t0) / (t1 - t0));
    const t = flyEase(raw);
    // Arc outwards: control point pushed away from the centre line.
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const bend = (c.corner === "tl" || c.corner === "br" ? 1 : -1) * 0.22;
    const ctrl = { x: mid.x - dy * bend, y: mid.y + dx * bend };
    const u = 1 - t;
    return {
      x: u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x,
      y: u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y,
    };
  };

  const impacts = corners.map((c) => landFrame(c.delay));
  const shake = combinedShake(frame, impacts, { amp: 5, decay: 0.2 });

  // --- 5. tarp + frame ------------------------------------------------------
  const unfold = springAt(frame, fps, at(T.tarp), { damping: 14, stiffness: 110, mass: 0.9 });
  const tarpOpacity = 0.92 * (1 - progress(frame, at(T.frameDone), at(T.frameDone + 1.25), ease.inOut));
  const frameDraw = progress(frame, at(T.tarp), at(T.frameDone), ease.inOut);
  const frameSettle = 1 + wobble(frame, at(T.frameDone), { amp: 0.012, freq: 0.5, decay: 0.15 });

  // --- 6. hold: pegs pulse --------------------------------------------------
  const holdPulse = beatEnvelope(beat - 18, { decay: 5 }) * progress(frame, at(17.5), at(18.5));

  // River trails fade once the tarp is down.
  const trailOpacity = 0.38 * (1 - progress(frame, at(T.land), at(T.tarp + 0.75), ease.inOut));
  const deltaDraw = progress(frame, at(T.journeyEnd - 0.5), at(T.land), ease.out);

  // Which dots live in the goo layer.
  const preSplit2 = frame < at(T.mitosis2) + 14;
  const cellR = lerp(CELL_R, CAP_R, Math.min(1, Math.max(0, open)));

  const gooDots: React.ReactNode[] = [];
  if (frame >= at(T.dot) && frame < at(T.mitosis) - 0.5) {
    gooDots.push(
      <ellipse
        key="cell"
        cx={CENTER.x}
        cy={CENTER.y}
        rx={Math.max(0, firstDotR) * breathe * stretch}
        ry={Math.max(0, firstDotR) * breathe * (2 - stretch)}
        fill={color}
      />,
    );
  } else if (frame >= at(T.mitosis) - 0.5 && preSplit2) {
    (["kamo", "takano"] as const).forEach((side) => {
      const p = speakerPos(side, frame);
      const r = (sep < SPLIT * 0.6 ? lerp(DOT_R, CELL_R, sep / (SPLIT * 0.6)) : CELL_R) * (1 + 0.28 * thump(side));
      const radius = frame < at(T.speakers) ? r : cellR * (1 + 0.3 * thump(side));
      if (frame >= at(T.mitosis2)) {
        // Division into two (vertically) — still in the goo layer.
        [-1, 1].forEach((v) =>
          gooDots.push(<circle key={`${side}${v}`} cx={p.x} cy={p.y + (v * sep2) / 2} r={CELL_R} fill={color} />),
        );
      } else {
        gooDots.push(<circle key={side} cx={p.x} cy={p.y} r={Math.max(0, radius)} fill={color} />);
      }
    });
  }

  return (
    <Stage palette={palette} logoScale={props.logoScale} camera={{ x: shake.x, y: shake.y }}>
      {/* Rivers (trails of the winding journey). */}
      {trailOpacity > 0.001 && frame >= at(T.source)
        ? (["kamo", "takano"] as const).map((side) => (
            <path
              key={side}
              d={RIVERS[side]}
              fill="none"
              stroke={color}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={`${RIVER_LEN[side] * journeyT} ${RIVER_LEN[side] + 10}`}
              opacity={trailOpacity}
            />
          ))
        : null}
      {trailOpacity > 0.001 && deltaDraw > 0 ? (
        <path
          d={RIVERS.delta}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${RIVER_LEN.delta * deltaDraw} ${RIVER_LEN.delta + 10}`}
          opacity={trailOpacity}
        />
      ) : null}

      {/* Sound waves: emitted on each beat at the speaker's position at that moment. */}
      {(["kamo", "takano"] as const).flatMap((side) => {
        const nodes: React.ReactNode[] = [];
        for (let k = T.thumpFrom; k <= T.thumpTo; k++) {
          const age = beat - k;
          if (age < 0 || age > 1.6) continue;
          const p = speakerPos(side, at(k));
          nodes.push(<SoundWave key={`${side}${k}`} x={p.x} y={p.y} color={color} age={age} strength={0.5} />);
        }
        return nodes;
      })}

      {/* Tarp unfolding from the top edge. */}
      {frame >= at(T.tarp) ? <TarpFill color={palette.tarp} unfold={unfold} opacity={tarpOpacity} /> : null}
      {frame >= at(T.tarp) ? (
        <Frame
          color={color}
          progress={frameDraw}
          mode="corners"
          transform={`translate(500 500) scale(${frameSettle}) translate(-500 -500)`}
        />
      ) : null}

      {/* Speakers. */}
      {frame >= at(T.speakers) && frame < at(T.mitosis2) + 6
        ? (["kamo", "takano"] as const).map((side) => {
            const p = speakerPos(side, frame);
            const prev = speakerPos(side, frame - 1);
            const sq = squashFor(p, prev, 0.006, 0.12);
            return (
              <SpeakerRings
                key={side}
                x={p.x}
                y={p.y}
                color={color}
                open={open}
                thump={thump(side)}
                transform={directionalScale(p, sq.angle, sq.along, sq.across)}
              />
            );
          })
        : null}

      {/* Cells (goo / metaball layer). */}
      {gooDots.length > 0 ? <g filter={`url(#${GOO_FILTER_ID})`}>{gooDots}</g> : null}

      {/* Flying dots -> pegs. */}
      {!preSplit2
        ? corners.map((c) => {
            const peg = pegByCorner(c.corner);
            const land = landFrame(c.delay);
            const p = flightPos(c, frame);
            const prev = flightPos(c, frame - 1);
            const landed = frame >= land;
            const ringOpen = springAt(frame, fps, land, { damping: 10, stiffness: 240, mass: 0.5 });
            const squash = landed ? wobble(frame, land, { amp: 0.32, freq: 0.75, decay: 0.22 }) : 0;
            const sq = landed ? { ...squashFor(prev, flightPos(c, land - 2)), along: 1 - squash, across: 1 + squash * 0.7 } : squashFor(p, prev, 0.006, 0.35);
            const dotR = lerp(CELL_R, 34, progress(frame, at(T.fly), land, ease.inOut));
            const pulse = 1 + 0.07 * holdPulse;
            const burstAge = (frame - land) / fps;
            return (
              <g key={c.corner}>
                {landed && burstAge < 0.5 ? (
                  <circle
                    cx={peg.cx}
                    cy={peg.cy}
                    r={peg.r + 10 + 70 * (1 - Math.pow(1 - burstAge / 0.5, 3))}
                    fill="none"
                    stroke={color}
                    strokeWidth={5 * (1 - burstAge / 0.5) + 0.5}
                    opacity={0.6 * (1 - burstAge / 0.5)}
                  />
                ) : null}
                <Peg
                  peg={peg}
                  color={color}
                  cx={p.x}
                  cy={p.y}
                  ring={landed ? ringOpen : 0}
                  dotRadius={dotR}
                  scale={pulse}
                  transform={directionalScale(p, sq.angle, sq.along, sq.across)}
                />
              </g>
            );
          })
        : null}

      <Typewriter clock={clock} timing={TYPE} color={color} />
    </Stage>
  );
};

export const GENESIS_TYPE_END = typewriterEnd(TYPE);
