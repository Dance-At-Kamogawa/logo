export type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type Corner = "tl" | "tr" | "bl" | "br";

export type PegData = {
  readonly id: string;
  readonly corner: Corner;
  /** Centre in logo space (0..1000). */
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly strokeWidth: number;
  /** Original ring outline (two half-ellipses). */
  readonly d: string;
};

export type DanceGlyphData = {
  readonly char: string;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly box: Box;
};

export type KamoGlyphData = {
  readonly char: string;
  readonly d: string;
  readonly box: Box;
};
