import type React from "react";
import { FRAME } from "./geometry.generated";

export type FrameDrawMode =
  /** Four strokes grow clockwise from the four corners at once. */
  | "corners"
  /** One continuous stroke, following the original path direction. */
  | "path";

type Props = {
  readonly color: string;
  /** 0..1 stroke draw progress. 1 = the exact original path. */
  readonly progress?: number;
  readonly mode?: FrameDrawMode;
  /** Multiplier on the original stroke width. */
  readonly weight?: number;
  readonly opacity?: number;
  readonly transform?: string;
};

const { x, y, width, height } = FRAME.box;
const CORNERS = [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height],
] as const;

/** The square outline (the blue tarp's edge). */
export const Frame: React.FC<Props> = ({ color, progress = 1, mode = "corners", weight = 1, opacity = 1, transform }) => {
  const strokeWidth = FRAME.strokeWidth * weight;
  if (progress <= 0) return null;
  if (progress >= 1) {
    return (
      <path
        d={FRAME.d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        opacity={opacity}
        transform={transform}
      />
    );
  }
  if (mode === "path") {
    const perimeter = 4 * width;
    return (
      <path
        d={FRAME.d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={`${perimeter * progress} ${perimeter}`}
        opacity={opacity}
        transform={transform}
      />
    );
  }
  return (
    <g opacity={opacity} transform={transform}>
      {CORNERS.map(([sx, sy], i) => {
        const [ex, ey] = CORNERS[(i + 1) % 4] ?? CORNERS[0];
        return (
          <line
            key={i}
            x1={sx}
            y1={sy}
            x2={sx + (ex - sx) * progress}
            y2={sy + (ey - sy) * progress}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
};

/** Filled tarp rectangle (inside the frame). `unfold` grows it from `edge`. */
export const TarpFill: React.FC<{
  readonly color: string;
  readonly unfold?: number;
  readonly edge?: "top" | "center";
  readonly opacity?: number;
  readonly transform?: string;
}> = ({ color, unfold = 1, edge = "top", opacity = 1, transform }) => {
  if (unfold <= 0 || opacity <= 0) return null;
  const h = height * unfold;
  const ry = edge === "top" ? y : y + (height - h) / 2;
  return <rect x={x} y={ry} width={width} height={h} rx={2} fill={color} opacity={opacity} transform={transform} />;
};
