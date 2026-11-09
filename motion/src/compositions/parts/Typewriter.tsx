import type React from "react";
import { interpolate, random } from "remotion";
import { DANCE_GLYPHS, DanceGlyph, KAMO_GLYPHS, KamoGlyph } from "../../logo";
import type { Box } from "../../logo";
import type { BeatClock } from "../../lib/beat";
import { ease, tween } from "../../lib/easing";

/**
 * Typewriter reveal of the real outlined glyphs: "Dance at" then
 * "Kamogawa", one glyph per keystroke, with a beat-synced blinking caret.
 */

export type TypewriterTiming = {
  /** Beat at which the caret appears. */
  readonly caretIn: number;
  /** First keystroke of line 1. */
  readonly line1: number;
  /** First keystroke of line 2. */
  readonly line2: number;
  /** Beats per keystroke. */
  readonly step: number;
  /** Beat at which the caret fades out. */
  readonly caretOut: number;
};

type Slot = { readonly box: Box; readonly glyph: number | null };

// "Dance at": the space is a virtual slot between "e" and "a".
const danceSlots: Slot[] = (() => {
  const slots: Slot[] = [];
  DANCE_GLYPHS.forEach((g, i) => {
    if (i === 5) {
      const e = DANCE_GLYPHS[4];
      if (e) {
        const left = e.box.x + e.box.width;
        const right = g.box.x;
        slots.push({ box: { x: left + (right - left) / 2 - 4, y: g.box.y, width: 8, height: 0 }, glyph: null });
      }
    }
    slots.push({ box: g.box, glyph: i });
  });
  return slots;
})();
const kamoSlots: Slot[] = KAMO_GLYPHS.map((g, i) => ({ box: g.box, glyph: i }));

const firstDance = DANCE_GLYPHS[0];
const firstKamo = KAMO_GLYPHS[0];
if (!firstDance || !firstKamo) throw new Error("Glyph data missing");

const LINE1 = { top: firstDance.box.y - 2, bottom: firstDance.box.y + firstDance.box.height + 2, width: 6 };
const LINE2 = { top: firstKamo.box.y - 2, bottom: firstKamo.box.y + firstKamo.box.height + 2, width: 12 };

/** Caret x for `k` typed glyphs on a line: centred in the gap after the last one. */
const caretX = (slots: readonly Slot[], k: number, pad: number): number => {
  const first = slots[0];
  const last = slots[slots.length - 1];
  if (!first || !last) return 0;
  if (k <= 0) return first.box.x - pad;
  if (k >= slots.length) return last.box.x + last.box.width + pad;
  const prev = slots[k - 1];
  const next = slots[k];
  if (!prev || !next) return 0;
  return (prev.box.x + prev.box.width + next.box.x) / 2;
};

export const typewriterEnd = (t: TypewriterTiming): number => t.line2 + kamoSlots.length * t.step;

type Props = {
  readonly clock: BeatClock;
  readonly timing: TypewriterTiming;
  readonly color: string;
};

/** Per-key pop: snaps in, overshoots a hair, with a tiny typewriter misalignment. */
const keyPop = (frame: number, start: number, seed: string) => {
  const t = frame - start;
  const scale = interpolate(t, [0, 2, 7], [1.35, 0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.out,
  });
  const jitter = (random(seed) - 0.5) * 8;
  const dy = interpolate(t, [0, 6], [jitter - 6, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  return { scale, dy };
};

export const Typewriter: React.FC<Props> = ({ clock, timing, color }) => {
  const { frame, beat, at } = clock;
  const keyBeat1 = (k: number) => timing.line1 + k * timing.step;
  const keyBeat2 = (k: number) => timing.line2 + k * timing.step;

  const typed1 = beat < timing.line1 ? 0 : Math.min(danceSlots.length, Math.floor((beat - timing.line1) / timing.step) + 1);
  const typed2 = beat < timing.line2 ? 0 : Math.min(kamoSlots.length, Math.floor((beat - timing.line2) / timing.step) + 1);

  // --- caret ---------------------------------------------------------------
  const onLine2 = beat >= timing.line2 - timing.step * 2;
  const line = onLine2 ? LINE2 : LINE1;
  const slots = onLine2 ? kamoSlots : danceSlots;
  const typed = onLine2 ? typed2 : typed1;
  const lastKeyBeat = onLine2 ? keyBeat2(Math.max(0, typed - 1)) : keyBeat1(Math.max(0, typed - 1));
  // Ease the caret from the previous insertion point to the new one.
  const xFrom = caretX(slots, Math.max(0, typed - 1), line.width + 6);
  const xTo = caretX(slots, typed, line.width + 6);
  const settle = typed === 0 ? 1 : tween(frame, at(lastKeyBeat), at(lastKeyBeat) + 4, 0, 1, ease.out);
  let cx = xFrom + (xTo - xFrom) * settle;
  // Carriage return: glide from the end of line 1 to the start of line 2.
  const crStart = timing.line2 - timing.step * 2;
  if (onLine2 && typed2 === 0) {
    const from = caretX(danceSlots, danceSlots.length, LINE1.width + 6);
    const to = caretX(kamoSlots, 0, LINE2.width + 6);
    cx = tween(frame, at(crStart), at(crStart) + 9, from, to, ease.inOut);
  }
  const typing = beat >= timing.line1 && beat < typewriterEnd(timing) + timing.step;
  const blinkOn = typing || beat % 1 < 0.5;
  const caretIn = tween(frame, at(timing.caretIn), at(timing.caretIn) + 6, 0, 1, ease.out);
  const caretOut = 1 - tween(frame, at(timing.caretOut), at(timing.caretOut) + 8, 0, 1, ease.out);
  const caretOpacity = blinkOn ? caretIn * caretOut : 0;
  const crShrink = onLine2 && typed2 === 0 ? tween(frame, at(crStart), at(crStart) + 9, LINE1.width, LINE2.width, ease.inOut) : line.width;
  const top = onLine2 && typed2 === 0 ? tween(frame, at(crStart), at(crStart) + 9, LINE1.top, LINE2.top, ease.inOut) : line.top;
  const bottom =
    onLine2 && typed2 === 0 ? tween(frame, at(crStart), at(crStart) + 9, LINE1.bottom, LINE2.bottom, ease.inOut) : line.bottom;

  return (
    <g>
      {danceSlots.map((slot, k) => {
        if (slot.glyph === null || k >= typed1) return null;
        const g = DANCE_GLYPHS[slot.glyph];
        if (!g) return null;
        const pop = keyPop(frame, at(keyBeat1(k)), `d${k}`);
        return (
          <DanceGlyph
            key={`d${k}`}
            glyph={g}
            color={color}
            t={{ scale: pop.scale, dy: pop.dy }}
            origin={{ x: g.box.x + g.box.width / 2, y: g.box.y + g.box.height }}
          />
        );
      })}
      {kamoSlots.map((slot, k) => {
        if (slot.glyph === null || k >= typed2) return null;
        const g = KAMO_GLYPHS[slot.glyph];
        if (!g) return null;
        const pop = keyPop(frame, at(keyBeat2(k)), `k${k}`);
        return (
          <KamoGlyph
            key={`k${k}`}
            glyph={g}
            color={color}
            t={{ scale: pop.scale, dy: pop.dy }}
            origin={{ x: g.box.x + g.box.width / 2, y: g.box.y + g.box.height }}
          />
        );
      })}
      {caretOpacity > 0 ? (
        <rect x={cx - crShrink / 2} y={top} width={crShrink} height={bottom - top} fill={color} opacity={caretOpacity} />
      ) : null}
    </g>
  );
};
