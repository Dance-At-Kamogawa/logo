import { bundle } from "@remotion/bundler";
import { ensureBrowser } from "@remotion/renderer";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Optional browser override. Set REMOTION_BROWSER_EXECUTABLE to use an
 * existing Chromium (e.g. when the Chrome Headless Shell download is blocked).
 */
export const browserExecutable = (): string | null => {
  const env = process.env.REMOTION_BROWSER_EXECUTABLE;
  if (env) {
    if (!existsSync(env)) throw new Error(`REMOTION_BROWSER_EXECUTABLE not found: ${env}`);
    return env;
  }
  return null;
};

export const prepare = async (): Promise<string> => {
  const exe = browserExecutable();
  if (!exe) await ensureBrowser();
  console.log("Bundling…");
  return bundle({ entryPoint: resolve(ROOT, "src/index.ts") });
};
