/**
 * Render a handful of stills from one composition (bundles once).
 *
 *   pnpm stills <compositionId> <outDir> <frame,frame,...|all:N> [scale] [propsJson]
 *
 * `all:N` renders every Nth frame. Handy for reviewing key poses.
 */
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { browserExecutable, chromiumOptions, prepare } from "./lib";

const [id, outDir, framesArg, scaleArg, propsArg] = process.argv.slice(2);
if (!id || !outDir || !framesArg) {
  console.error("usage: pnpm stills <compositionId> <outDir> <frames> [scale] [propsJson]");
  process.exit(1);
}

const serveUrl = await prepare();
const inputProps = propsArg ? (JSON.parse(propsArg) as Record<string, unknown>) : {};
const composition = await selectComposition({
  serveUrl,
  id,
  inputProps,
  browserExecutable: browserExecutable(),
  chromiumOptions: chromiumOptions(),
});

const frames = framesArg.startsWith("all:")
  ? Array.from(
      { length: Math.ceil(composition.durationInFrames / Number(framesArg.slice(4))) },
      (_, i) => i * Number(framesArg.slice(4)),
    )
  : framesArg.split(",").map((f) => (f === "last" ? composition.durationInFrames - 1 : Number(f)));

mkdirSync(outDir, { recursive: true });
for (const frame of frames) {
  const output = resolve(outDir, `${id}_${String(frame).padStart(4, "0")}.png`);
  await renderStill({
    composition,
    serveUrl,
    frame,
    output,
    inputProps,
    scale: scaleArg ? Number(scaleArg) : 1,
    browserExecutable: browserExecutable(),
    chromiumOptions: chromiumOptions(),
    overwrite: true,
  });
  console.log(output);
}
console.log(`duration ${composition.durationInFrames} frames @ ${composition.fps} fps`);
