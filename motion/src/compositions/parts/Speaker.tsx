import type React from "react";

type SpeakerProps = {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  /** 0..1(+overshoot): how far the speaker rings have grown out of the dot. */
  readonly open: number;
  /** 0..1 beat envelope; pushes the cone outwards. */
  readonly thump: number;
  /** Optional squash transform around (x, y). */
  readonly transform?: string;
};

/**
 * Loudspeaker seen from the front: surround ring + cone ring. The dust cap
 * (centre dot) is drawn separately so it can live in the goo layer.
 */
export const SpeakerRings: React.FC<SpeakerProps> = ({ x, y, color, open, thump, transform }) => {
  if (open <= 0.001) return null;
  const surround = 68 * open * (1 + 0.05 * thump);
  const cone = 43 * Math.max(0, open) * (1 + 0.16 * thump);
  return (
    <g transform={transform}>
      <circle cx={x} cy={y} r={Math.max(0.01, surround)} fill="none" stroke={color} strokeWidth={9 * Math.min(1, open)} />
      <circle
        cx={x}
        cy={y}
        r={Math.max(0.01, cone)}
        fill="none"
        stroke={color}
        strokeWidth={5 * Math.min(1, open)}
        opacity={0.85}
      />
    </g>
  );
};

type WaveProps = {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  /** Age in beats since emission. */
  readonly age: number;
  /** Lifetime in beats. */
  readonly life?: number;
  readonly from?: number;
  readonly to?: number;
  readonly strength?: number;
  readonly weight?: number;
};

/** One expanding sound-wave ring. */
export const SoundWave: React.FC<WaveProps> = ({
  x,
  y,
  color,
  age,
  life = 1.6,
  from = 72,
  to = 210,
  strength = 0.45,
  weight = 6,
}) => {
  if (age < 0 || age >= life) return null;
  const t = age / life;
  const eased = 1 - Math.pow(1 - t, 3);
  const r = from + (to - from) * eased;
  const opacity = strength * Math.pow(1 - t, 1.6);
  return (
    <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={Math.max(0.5, weight * (1 - t * 0.8))} opacity={opacity} />
  );
};
