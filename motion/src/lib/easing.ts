import { Easing, interpolate, spring, type SpringConfig } from "remotion";

/** Easing presets used across all compositions. */
export const ease = {
  /** Fast out, long soft landing. */
  out: Easing.bezier(0.16, 1, 0.3, 1),
  /** Material-style standard curve. */
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  /** Strong ease-in, for things that slam into place. */
  slam: Easing.bezier(0.7, 0, 0.84, 0),
  /** Anticipation: pulls back first, then shoots forward. */
  anticipate: Easing.bezier(0.6, -0.35, 0.4, 1),
  /** Overshoots past the target and settles. */
  overshoot: Easing.bezier(0.34, 1.56, 0.64, 1),
  /** Soft in-out, for drifting things. */
  sine: Easing.inOut(Easing.sin),
} as const;

/** Spring presets (Remotion SpringConfig). */
export const springs = {
  /** Small things popping into existence. */
  pop: { damping: 9, stiffness: 220, mass: 0.6 },
  /** Snappy, nearly no overshoot. */
  snappy: { damping: 20, stiffness: 260, mass: 0.7 },
  /** Bouncy landing. */
  bouncy: { damping: 7, stiffness: 160, mass: 0.8 },
  /** Gentle settle. */
  gentle: { damping: 16, stiffness: 90, mass: 1 },
  /** Heavy object landing. */
  heavy: { damping: 11, stiffness: 120, mass: 1.6 },
} satisfies Record<string, Partial<SpringConfig>>;

type SpringPreset = keyof typeof springs;

/** spring() starting at a fractional frame (used with beat-grid timings). */
export const springAt = (
  frame: number,
  fps: number,
  start: number,
  preset: SpringPreset | Partial<SpringConfig> = "pop",
  durationInFrames?: number,
): number => {
  const config = typeof preset === "string" ? springs[preset] : preset;
  return spring({ frame: frame - start, fps, config, durationInFrames });
};

/** Clamped interpolate between two frames with an easing. */
export const tween = (
  frame: number,
  start: number,
  end: number,
  from: number,
  to: number,
  easing: (t: number) => number = ease.inOut,
): number =>
  interpolate(frame, [start, end], [from, to], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** 0..1 progress between two frames with easing. */
export const progress = (frame: number, start: number, end: number, easing: (t: number) => number = ease.inOut): number =>
  tween(frame, start, end, 0, 1, easing);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** Damped sine: secondary motion after an impact (frame relative to impact). */
export const wobble = (frame: number, start: number, opts: { amp?: number; freq?: number; decay?: number } = {}): number => {
  const { amp = 1, freq = 0.35, decay = 0.12 } = opts;
  const t = frame - start;
  if (t < 0) return 0;
  return amp * Math.sin(t * freq) * Math.exp(-t * decay);
};
