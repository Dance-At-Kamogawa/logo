/**
 * Renders the release matrix to motion/out/.
 *
 *   pnpm render                 # everything
 *   pnpm render --list          # print the matrix
 *   pnpm render --only=genesis  # jobs whose output name contains "genesis" (comma-separated OK)
 *
 * Env:
 *   RENDER_CONCURRENCY           frames rendered in parallel (default: Remotion's default)
 *   REMOTION_BROWSER_EXECUTABLE  use an existing Chromium instead of Chrome Headless Shell
 */
import { renderMedia, selectComposition, type Codec } from "@remotion/renderer";
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { browserExecutable, prepare, ROOT } from "./lib";

type Preset = "ink" | "white" | "tarp";

type Job = {
  /** Output file name (inside out/). */
  readonly file: string;
  readonly composition: string;
  readonly preset: Preset;
  readonly kind: "mp4" | "prores-alpha" | "gif";
  /** Extra post-processing derived from this job's output. */
  readonly hapAlpha?: string;
};

const OUT = resolve(ROOT, "out");
const PATTERNS = ["Genesis", "Delta", "TarpDrop", "BeatLoop", "Stinger"] as const;
const SIZES = { Square: "1080x1080", Wide: "1920x1080" } as const;

const slug = (s: string): string => s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

export const MATRIX: readonly Job[] = [
  // Every pattern, both sizes, H.264, ink on white.
  ...PATTERNS.flatMap((p) =>
    (Object.keys(SIZES) as (keyof typeof SIZES)[]).map(
      (size): Job => ({
        file: `dak-${slug(p)}-${SIZES[size]}-ink.mp4`,
        composition: `${p}-${size}`,
        preset: "ink",
        kind: "mp4",
      }),
    ),
  ),
  // Alpha masters for VJ / compositing.
  { file: "dak-genesis-1920x1080-white-alpha.mov", composition: "Genesis-Wide", preset: "white", kind: "prores-alpha" },
  {
    file: "dak-beat-loop-1920x1080-white-alpha.mov",
    composition: "BeatLoop-Wide",
    preset: "white",
    kind: "prores-alpha",
    hapAlpha: "dak-beat-loop-1920x1080-white-hap-alpha.mov",
  },
  // Small GIF for SNS / chat.
  { file: "dak-stinger-540x540-ink.gif", composition: "Stinger-Square", preset: "ink", kind: "gif" },
];

const args = process.argv.slice(2);
const only = args
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const jobs = MATRIX.filter((j) => !only || only.some((o) => j.file.toLowerCase().includes(o)));

if (args.includes("--list")) {
  for (const j of jobs) console.log(`${j.composition.padEnd(16)} ${j.kind.padEnd(13)} ${j.file}${j.hapAlpha ? ` (+ ${j.hapAlpha})` : ""}`);
  process.exit(0);
}
if (jobs.length === 0) {
  console.error("No jobs match", only);
  process.exit(1);
}

const run = (cmd: string, cmdArgs: string[]): void => {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status ?? res.signal}`);
};

const mb = (file: string): string => `${(statSync(file).size / 1024 / 1024).toFixed(1)} MB`;

mkdirSync(OUT, { recursive: true });
const serveUrl = await prepare();
const concurrency = process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null;
const started = Date.now();

for (const [i, job] of jobs.entries()) {
  const inputProps = { preset: job.preset };
  const composition = await selectComposition({
    serveUrl,
    id: job.composition,
    inputProps,
    browserExecutable: browserExecutable(),
  });
  const outputLocation = resolve(OUT, job.file);
  console.log(
    `\n[${i + 1}/${jobs.length}] ${job.composition} (${composition.width}x${composition.height}, ${composition.durationInFrames}f) -> ${job.file}`,
  );

  const codec: Codec = job.kind === "mp4" ? "h264" : job.kind === "gif" ? "gif" : "prores";
  let lastLogged = -1;
  await renderMedia({
    serveUrl,
    composition,
    codec,
    outputLocation,
    inputProps,
    concurrency,
    browserExecutable: browserExecutable(),
    overwrite: true,
    ...(job.kind === "mp4" ? { crf: 16, pixelFormat: "yuv420p" as const, imageFormat: "jpeg" as const, jpegQuality: 95 } : {}),
    ...(job.kind === "prores-alpha"
      ? { proResProfile: "4444" as const, pixelFormat: "yuva444p10le" as const, imageFormat: "png" as const }
      : {}),
    ...(job.kind === "gif" ? { scale: 0.5, everyNthFrame: 2, numberOfGifLoops: null, imageFormat: "png" as const } : {}),
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== lastLogged) {
        lastLogged = pct;
        process.stdout.write(`${pct}% `);
      }
    },
  });
  console.log(`\n  ✓ ${job.file} ${mb(outputLocation)}`);

  if (job.hapAlpha) {
    const hap = resolve(OUT, job.hapAlpha);
    // HAP Alpha for Resolume / VDMX. -chunks lets the decoder use several threads.
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", outputLocation, "-c:v", "hap", "-format", "hap_alpha", "-chunks", "4", hap]);
    console.log(`  ✓ ${job.hapAlpha} ${mb(hap)}`);
  }
}

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)} s -> ${OUT}`);
