import type React from "react";
import { Composition, Folder } from "remotion";
import { BeatLoop, beatLoopDefaults, beatLoopDuration, beatLoopSchema } from "./compositions/BeatLoop";
import { Delta, deltaDefaults, deltaDuration, deltaSchema } from "./compositions/Delta";
import { Genesis, genesisDefaults, genesisDuration, genesisSchema } from "./compositions/Genesis";
import { Stinger, stingerDefaults, stingerDuration, stingerSchema } from "./compositions/Stinger";
import { TarpDrop, tarpDropDefaults, tarpDropDuration, tarpDropSchema } from "./compositions/TarpDrop";
import { Liquid, liquidCompDefaults, liquidDuration, liquidSchema } from "./compositions/Liquid";
import { LiquidLoop, liquidLoopDefaults, liquidLoopDuration, liquidLoopSchema } from "./compositions/LiquidLoop";
import {
  Condensation,
  condensationCompDefaults,
  condensationDuration,
  condensationSchema,
} from "./compositions/Condensation";
import {
  CondensationLoop,
  condensationLoopDefaults,
  condensationLoopDuration,
  condensationLoopSchema,
} from "./compositions/CondensationLoop";

import { TarpRain, tarpRainCompDefaults, tarpRainDuration, tarpRainSchema } from "./compositions/TarpRain";
import { Caustics, causticsCompDefaults, causticsDuration, causticsSchema } from "./compositions/Caustics";
import { StaticLogo } from "./compositions/StaticLogo";
import { DropLens, dropLensCompDefaults, dropLensDuration, dropLensSchema } from "./compositions/DropLens";
import {
  DropLensLoop,
  dropLensLoopDefaults,
  dropLensLoopDuration,
  dropLensLoopSchema,
} from "./compositions/DropLensLoop";
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
    <Folder name="Liquid">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`Liquid-${size}`}
          component={Liquid}
          schema={liquidSchema}
          defaultProps={liquidCompDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: liquidDuration(props.bpm, FPS) })}
          durationInFrames={liquidDuration(liquidCompDefaults.bpm, FPS)}
          fps={FPS}
          {...dim}
        />
      ))}
    </Folder>
    <Folder name="LiquidLoop">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`LiquidLoop-${size}`}
          component={LiquidLoop}
          schema={liquidLoopSchema}
          defaultProps={liquidLoopDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: liquidLoopDuration(props.bpm, FPS) })}
          durationInFrames={liquidLoopDuration(liquidLoopDefaults.bpm, FPS)}
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
    <Folder name="DropLens">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`DropLens-${size}`}
          component={DropLens}
          schema={dropLensSchema}
          defaultProps={dropLensCompDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: dropLensDuration(props.bpm, FPS) })}
          durationInFrames={dropLensDuration(dropLensCompDefaults.bpm, FPS)}
          fps={FPS}
          {...dim}
        />
      ))}
      <Composition
        id="DropLensLoop-Wide"
        component={DropLensLoop}
        schema={dropLensLoopSchema}
        defaultProps={dropLensLoopDefaults}
        calculateMetadata={({ props }) => ({ durationInFrames: dropLensLoopDuration(props.bpm, FPS) })}
        durationInFrames={dropLensLoopDuration(dropLensLoopDefaults.bpm, FPS)}
        fps={FPS}
        {...SIZES.Wide}
      />
    </Folder>
    <Folder name="Condensation">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`Condensation-${size}`}
          component={Condensation}
          schema={condensationSchema}
          defaultProps={condensationCompDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: condensationDuration(props.bpm, FPS) })}
          durationInFrames={condensationDuration(condensationCompDefaults.bpm, FPS)}
          fps={FPS}
          {...dim}
        />
      ))}
      <Composition
        id="CondensationLoop-Wide"
        component={CondensationLoop}
        schema={condensationLoopSchema}
        defaultProps={condensationLoopDefaults}
        calculateMetadata={({ props }) => ({ durationInFrames: condensationLoopDuration(props.bpm, FPS) })}
        durationInFrames={condensationLoopDuration(condensationLoopDefaults.bpm, FPS)}
        fps={FPS}
        {...SIZES.Wide}
      />
    </Folder>
    <Folder name="TarpRain">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`TarpRain-${size}`}
          component={TarpRain}
          schema={tarpRainSchema}
          defaultProps={tarpRainCompDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: tarpRainDuration(props.bpm, FPS) })}
          durationInFrames={tarpRainDuration(tarpRainCompDefaults.bpm, FPS)}
          fps={FPS}
          {...dim}
        />
      ))}
      <Composition
        id="TarpRainLoop-Wide"
        component={TarpRainLoop}
        schema={tarpRainLoopSchema}
        defaultProps={tarpRainLoopDefaults}
        calculateMetadata={({ props }) => ({ durationInFrames: tarpRainLoopDuration(props.bpm, FPS) })}
        durationInFrames={tarpRainLoopDuration(tarpRainLoopDefaults.bpm, FPS)}
        fps={FPS}
        {...SIZES.Wide}
      />
    </Folder>
    <Folder name="Caustics">
      {SIZE_ENTRIES.map(([size, dim]) => (
        <Composition
          key={size}
          id={`Caustics-${size}`}
          component={Caustics}
          schema={causticsSchema}
          defaultProps={causticsCompDefaults}
          calculateMetadata={({ props }) => ({ durationInFrames: causticsDuration(props.bpm, FPS) })}
          durationInFrames={causticsDuration(causticsCompDefaults.bpm, FPS)}
          fps={FPS}
          {...dim}
        />
      ))}
      <Composition
        id="CausticsLoop-Wide"
        component={CausticsLoop}
        schema={causticsLoopSchema}
        defaultProps={causticsLoopDefaults}
        calculateMetadata={({ props }) => ({ durationInFrames: causticsLoopDuration(props.bpm, FPS) })}
        durationInFrames={causticsLoopDuration(causticsLoopDefaults.bpm, FPS)}
        fps={FPS}
        {...SIZES.Wide}
      />
    </Folder>
  </>
);
