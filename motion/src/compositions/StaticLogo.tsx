import type React from "react";
import { LogoMark, Stage } from "../logo";
import { paletteFromProps, type BaseProps } from "../lib/schema";

/** The still logo; used for verification against png/dak_logo.png and as a poster frame. */
export const StaticLogo: React.FC<BaseProps> = (props) => {
  const palette = paletteFromProps(props);
  return (
    <Stage palette={palette} logoScale={props.logoScale}>
      <LogoMark color={palette.color} />
    </Stage>
  );
};
