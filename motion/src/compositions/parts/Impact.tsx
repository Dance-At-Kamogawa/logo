import type React from "react";

type Props = {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  /** Frames since impact. */
  readonly age: number;
  /** Lifetime in frames. */
  readonly life?: number;
  readonly radius?: number;
  /** Number of radial speed lines (0 = ring only). */
  readonly lines?: number;
  readonly rotation?: number;
};

/** Impact burst: an expanding ring plus short radial "hit" lines. */
export const ImpactBurst: React.FC<Props> = ({ x, y, color, age, life = 24, radius = 40, lines = 8, rotation = 0 }) => {
  if (age < 0 || age > life) return null;
  const t = age / life;
  const out = 1 - Math.pow(1 - t, 3);
  const ringR = radius + 80 * out;
  const fade = Math.pow(1 - t, 1.4);
  return (
    <g>
      <circle cx={x} cy={y} r={ringR} fill="none" stroke={color} strokeWidth={6 * (1 - t) + 0.5} opacity={0.55 * fade} />
      {Array.from({ length: lines }, (_, i) => {
        const a = ((i / lines) * 360 + rotation) * (Math.PI / 180);
        const r0 = radius + 18 + 70 * out;
        const r1 = r0 + 26 * (1 - t);
        return (
          <line
            key={i}
            x1={x + Math.cos(a) * r0}
            y1={y + Math.sin(a) * r0}
            x2={x + Math.cos(a) * r1}
            y2={y + Math.sin(a) * r1}
            stroke={color}
            strokeWidth={6 * (1 - t) + 1}
            strokeLinecap="round"
            opacity={0.8 * fade}
          />
        );
      })}
    </g>
  );
};
