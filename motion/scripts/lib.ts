import { bundle } from "@remotion/bundler";
import { ensureBrowser, type ChromiumOptions } from "@remotion/renderer";
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

const GL_RENDERERS = ["angle", "swangle", "swiftshader", "egl", "vulkan", "angle-egl"] as const;
type GlRenderer = (typeof GL_RENDERERS)[number];
const isGl = (v: string): v is GlRenderer => (GL_RENDERERS as readonly string[]).includes(v);

/**
 * WebGL backend for Chrome Headless Shell (the Liquid patterns need WebGL).
 * Default "swangle" (ANGLE on SwiftShader): software rendering that works on
 * GPU-less machines such as CI. Override with REMOTION_GL (e.g. angle on a
 * machine with a GPU).
 */
export const glRenderer = (): GlRenderer => {
  const env = process.env.REMOTION_GL;
  if (!env) return "swangle";
  if (!isGl(env)) throw new Error(`REMOTION_GL must be one of ${GL_RENDERERS.join(", ")}`);
  return env;
};

export const chromiumOptions = (): ChromiumOptions => ({ gl: glRenderer() });
