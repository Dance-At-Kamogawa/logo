// Remotion CLI / Studio configuration.
// https://www.remotion.dev/docs/config
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setEntryPoint("src/index.ts");

// The Liquid patterns render with WebGL (three.js). "swangle" (ANGLE on
// SwiftShader) works headless without a GPU; REMOTION_GL=angle uses a GPU.
type GlRenderer = Parameters<typeof Config.setChromiumOpenGlRenderer>[0];
Config.setChromiumOpenGlRenderer((process.env.REMOTION_GL as GlRenderer | undefined) ?? "swangle");

// Fallback for sandboxes where the Chrome Headless Shell download is blocked:
// REMOTION_BROWSER_EXECUTABLE=/path/to/chromium pnpm dev
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
