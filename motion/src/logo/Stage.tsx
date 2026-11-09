import type React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { LOGO_VIEWBOX } from "./geometry.generated";
import type { Palette } from "./colors";

export const GOO_FILTER_ID = "dak-goo";

/** Visible area of the canvas in logo units. */
export const useStageBounds = (logoScale: number) => {
  const { width, height } = useVideoConfig();
  const unit = (logoScale * Math.min(width, height)) / LOGO_VIEWBOX;
  const w = width / unit;
  const h = height / unit;
  return { x: LOGO_VIEWBOX / 2 - w / 2, y: LOGO_VIEWBOX / 2 - h / 2, width: w, height: h, unit };
};

type Props = {
  readonly palette: Palette;
  readonly logoScale: number;
  /** Camera offset in logo units (shake). */
  readonly camera?: { x: number; y: number; scale?: number; rotate?: number };
  readonly children: React.ReactNode;
};

/**
 * Full-canvas SVG whose user space is the logo space: the 1000x1000 logo is
 * centred and sized to `logoScale` of the shorter side, everything else
 * (rivers, flying dots) can live outside it in the same coordinates.
 */
export const Stage: React.FC<Props> = ({ palette, logoScale, camera, children }) => {
  const { width, height } = useVideoConfig();
  const b = useStageBounds(logoScale);
  const c = camera ?? { x: 0, y: 0 };
  const cameraTransform = `translate(${500 + c.x} ${500 + c.y}) rotate(${c.rotate ?? 0}) scale(${c.scale ?? 1}) translate(-500 -500)`;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.background === "transparent" ? undefined : palette.background }}>
      <svg width={width} height={height} viewBox={`${b.x} ${b.y} ${b.width} ${b.height}`} style={{ overflow: "visible" }}>
        <defs>
          {/* Metaball / "goo" filter for cell-division moments. */}
          <filter
            id={GOO_FILTER_ID}
            x={b.x - 200}
            y={b.y - 200}
            width={b.width + 400}
            height={b.height + 400}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
          </filter>
        </defs>
        <g transform={cameraTransform}>{children}</g>
      </svg>
    </AbsoluteFill>
  );
};
