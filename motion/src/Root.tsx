import type React from "react";
import { Composition, Folder } from "remotion";
import { BeatLoop, beatLoopDefaults, beatLoopDuration, beatLoopSchema } from "./compositions/BeatLoop";
import { Delta, deltaDefaults, deltaDuration, deltaSchema } from "./compositions/Delta";
import { Genesis, genesisDefaults, genesisDuration, genesisSchema } from "./compositions/Genesis";
import { Stinger, stingerDefaults, stingerDuration, stingerSchema } from "./compositions/Stinger";
import { TarpDrop, tarpDropDefaults, tarpDropDuration, tarpDropSchema } from "./compositions/TarpDrop";
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
    <Folder name="Delta">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`Delta-${size}`}
          component={Delta}
          schema={deltaSchema}
          defaultProps={deltaDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: deltaDuration(props.bpm, FPS) })}
          durationInFrames={deltaDuration(deltaDefaults.bpm, FPS)}
          fps={FPS}
          {...dim}
        />
      ))}
    </Folder>
    <Folder name="TarpDrop">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`TarpDrop-${size}`}
          component={TarpDrop}
          schema={tarpDropSchema}
          defaultProps={tarpDropDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: tarpDropDuration(props.bpm, FPS) })}
          durationInFrames={tarpDropDuration(tarpDropDefaults.bpm, FPS)}
          fps={FPS}
          {...dim}
        />
      ))}
    </Folder>
    <Folder name="BeatLoop">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`BeatLoop-${size}`}
          component={BeatLoop}
          schema={beatLoopSchema}
          defaultProps={beatLoopDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: beatLoopDuration(props.bpm, props.bars, FPS) })}
          durationInFrames={beatLoopDuration(beatLoopDefaults.bpm, beatLoopDefaults.bars, FPS)}
          fps={FPS}
          {...dim}
        />
      ))}
    </Folder>
    <Folder name="Stinger">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`Stinger-${size}`}
          component={Stinger}
          schema={stingerSchema}
          defaultProps={stingerDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: stingerDuration(props.bpm, FPS) })}
          durationInFrames={stingerDuration(stingerDefaults.bpm, FPS)}
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
