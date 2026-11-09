// Remotion CLI / Studio configuration.
// https://www.remotion.dev/docs/config
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setEntryPoint("src/index.ts");

// Fallback for sandboxes where the Chrome Headless Shell download is blocked:
// REMOTION_BROWSER_EXECUTABLE=/path/to/chromium pnpm dev
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
