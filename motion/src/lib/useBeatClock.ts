import { useCurrentFrame, useVideoConfig } from "remotion";
import { makeBeatClock, type BeatClock } from "./beat";

export const useBeatClock = (bpm: number): BeatClock => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return makeBeatClock(frame, fps, bpm);
};
