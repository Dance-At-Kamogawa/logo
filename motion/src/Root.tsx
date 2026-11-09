import type React from "react";
import { Composition, Folder } from "remotion";
import { StaticLogo } from "./compositions/StaticLogo";
import { baseSchema, defaultBaseProps } from "./lib/schema";

export const FPS = 60;

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Still">
      <Composition
        id="Logo-Square"
        component={StaticLogo}
        schema={baseSchema}
        defaultProps={defaultBaseProps}
        durationInFrames={1}
        fps={FPS}
        width={1080}
        height={1080}
      />
    </Folder>
  </>
);
