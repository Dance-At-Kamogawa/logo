import type React from "react";
import { Composition, Folder } from "remotion";
import { Genesis, genesisDefaults, genesisDuration, genesisSchema } from "./compositions/Genesis";
import { StaticLogo } from "./compositions/StaticLogo";
import { baseSchema, defaultBaseProps } from "./lib/schema";

export const FPS = 60;

export const SIZES = {
  Square: { width: 1080, height: 1080 },
  Wide: { width: 1920, height: 1080 },
} as const;

const SIZE_ENTRIES = Object.entries(SIZES) as [keyof typeof SIZES, (typeof SIZES)[keyof typeof SIZES]][];

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Genesis">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`Genesis-${size}`}
          component={Genesis}
          schema={genesisSchema}
          defaultProps={genesisDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: genesisDuration(props.bpm, FPS) })}
          durationInFrames={genesisDuration(genesisDefaults.bpm, FPS)}
          fps={FPS}
          {...dim}
        />
      ))}
    </Folder>
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
