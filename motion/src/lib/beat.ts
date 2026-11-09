/**
 * Beat-grid helpers. Everything is expressed in beats so that changing the
 * BPM prop re-times a composition while keeping its musical structure.
 */

export const framesPerBeat = (bpm: number, fps: number): number => (60 / bpm) * fps;

/** Frame (fractional) at which a given beat starts. */
export const beatToFrame = (beat: number, bpm: number, fps: number): number => beat * framesPerBeat(bpm, fps);

/** Current position on the beat grid (fractional beats). */
export const frameToBeat = (frame: number, bpm: number, fps: number): number => frame / framesPerBeat(bpm, fps);

/** Whole-frame duration for a number of beats. */
export const beatsToDuration = (beats: number, bpm: number, fps: number): number =>
  Math.max(1, Math.round(beatToFrame(beats, bpm, fps)));

/**
 * Percussive envelope for a position on the beat grid: instant-ish attack at
 * each beat, exponential decay until the next. `attack` is in beats.
 * Returns 0..1.
 */
export const beatEnvelope = (beat: number, opts: { decay?: number; attack?: number; every?: number } = {}): number => {
  const { decay = 6, attack = 0.04, every = 1 } = opts;
  if (beat < 0) return 0;
  const local = beat % every;
  if (local < attack) return local / attack;
  return Math.exp(-(local - attack) * decay);
};

/**
 * Like beatEnvelope but only active between two beats; fades the grid out
 * smoothly at the boundaries so pulses never pop in/out.
 */
export const gatedEnvelope = (
  beat: number,
  from: number,
  to: number,
  opts: { decay?: number; attack?: number; every?: number } = {},
): number => {
  if (beat < from || beat > to + 1) return 0;
  return beatEnvelope(beat - from, opts);
};
