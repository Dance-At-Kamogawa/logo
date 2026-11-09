import type React from "react";
import { z } from "zod";
import { Frame, PEGS, Peg, Stage } from "../logo";
import { beatEnvelope, beatsToDuration } from "../lib/beat";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { baseSchema, defaultBaseProps, paletteFromProps } from "../lib/schema";
import { SoundWave } from "./parts/Speaker";
import { LogoText } from "./parts/Text";

/*
 * BeatLoop — VJ loop. The static logo with pegs and frame pulsing on the
 * beat and sound rings radiating from the pegs.
 *
 * Seamless: everything is a pure function of the loop phase
 * (frame / durationInFrames), so frame N (one past the last frame) equals
 * frame 0. The duration is `bars * 4` beats rounded to whole frames; the
 * tempo is stretched by < 0.2 % so the loop closes exactly.
 */

export const beatLoopSchema = baseSchema.extend({
  /** Loop length in 4/4 bars. */
  bars: z.number().int().min(1).max(16),
  /** Rotate the loop's start point (frames). Used to verify seamlessness. */
  offsetFrames: z.number().int().min(0),
});
export type BeatLoopProps = z.infer<typeof beatLoopSchema>;
export const beatLoopDefaults: BeatLoopProps = {
  ...defaultBaseProps,
  preset: "white",
  bars: 4,
  offsetFrames: 0,
};
export const beatLoopDuration = (bpm: number, bars: number, fps: number): number => beatsToDuration(bars * 4, bpm, fps);

const RING_LIFE = 1.75;

/** Positive modulo. */
const mod = (a: number, n: number): number => ((a % n) + n) % n;

export const BeatLoop: React.FC<BeatLoopProps> = (props) => {
  const palette = paletteFromProps(props);
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const color = palette.color;
  const beats = props.bars * 4;

  // Loop phase -> position on the beat grid (0..beats). Periodic by construction.
  const phase = mod(frame + props.offsetFrames, durationInFrames) / durationInFrames;
  const beat = phase * beats;
  const inBar = beat % 4;

  const env = beatEnvelope(beat, { decay: 6 });
  const downbeat = beatEnvelope(beat, { decay: 4, every: 4 });
  // Offbeat ghost pulse (the "tss" between kicks) for a bit of groove.
  const offbeat = beatEnvelope(mod(beat - 0.5, beats), { decay: 9 });

  const frameScale = 1 + 0.006 * env + 0.008 * downbeat;
  const frameWeight = 1 + 0.25 * downbeat;

  // Text: a little wave runs through "Kamogawa" on the last beat of every 2 bars.
  const waveBeat = mod(beat - 7, 8); // 0 at beats 7, 15, ...
  const kamoWave = (i: number): number => {
    const local = waveBeat - i * 0.07;
    if (local < 0 || local > 0.6) return 0;
    return -Math.sin((local / 0.6) * Math.PI) * 14;
  };

  return (
    <Stage palette={palette} logoScale={props.logoScale}>
      {/* Sound rings emitted from every peg on every beat (wrapping across the loop seam). */}
      {PEGS.flatMap((peg, pi) =>
        Array.from({ length: beats }, (_, k) => {
          const age = mod(beat - k, beats);
          if (age >= RING_LIFE) return null;
          const accent = k % 4 === 0 ? 1 : 0.6;
          return (
            <SoundWave
              key={`${pi}-${k}`}
              x={peg.cx}
              y={peg.cy}
              color={color}
              age={age}
              life={RING_LIFE}
              from={peg.r + 6}
              to={peg.r + 120 + 40 * accent}
              strength={0.8 * accent}
              weight={7}
            />
          );
        }),
      )}

      <Frame
        color={color}
        weight={frameWeight}
        transform={`translate(500 500) scale(${frameScale}) translate(-500 -500)`}
      />
      {PEGS.map((peg) => (
        <Peg key={peg.id} peg={peg} color={color} scale={1 + 0.16 * env + 0.05 * offbeat} />
      ))}
      <LogoText
        color={color}
        dance={(i) => ({ t: { dy: inBar >= 3 ? -3 * env * Math.sin((i / 6) * Math.PI) : 0 } })}
        kamo={(i) => ({ t: { dy: kamoWave(i) } })}
      />
    </Stage>
  );
};
