import { ThreeCanvas } from "@remotion/three";
import type React from "react";
import { useMemo } from "react";
import { useVideoConfig } from "remotion";
import {
  CanvasTexture,
  Color,
  DataTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector4,
} from "three";
import { DANCE_GLYPHS, FRAME, KAMO_GLYPHS, PEGS } from "../../logo";
import { FIELD_SIZE } from "./field";
import { FRONT_SPEED, rainPlan } from "./plan";
import { MAX_PRIMS, type Prim, type RainScene } from "./scene";
import { fragmentShader, vertexShader } from "./shader";
import { binRings, INDEX_WIDTH, makeBins, type Bins, type Ring } from "./tiles";

export type Camera = { readonly x: number; readonly y: number; readonly zoom: number };

export type TarpColors = {
  readonly tarp: string;
  readonly liquid: string;
  readonly text: string;
  readonly frame: string;
  readonly background: string;
};

type Props = {
  readonly scene: RainScene;
  readonly colors: TarpColors;
  /** px per logo unit (at zoom 1). */
  readonly unit: number;
  readonly camera: Camera;
};

const linear = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  // Colour management is off for this raw shader: convert sRGB -> linear by hand.
  return [Math.pow(c.r, 2.2), Math.pow(c.g, 2.2), Math.pow(c.b, 2.2)];
};

const dataTexture = (data: Float32Array, width: number, height: number): DataTexture => {
  const t = new DataTexture(data, width, height, RGBAFormat, FloatType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
};

const pathCache = new Map<string, Path2D>();
const path2d = (d: string): Path2D => {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
};

/**
 * The light-grey type, grommet rings (red channel) and hairline frame (green)
 * in screen space; the shader only shows them through the water.
 */
const drawInk = (ctx: CanvasRenderingContext2D, width: number, height: number, unit: number, cam: Camera): void => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  ctx.setTransform(unit, 0, 0, unit, width / 2 - cam.x * unit, height / 2 - cam.y * unit);
  const hairline = Math.max(1, 1.8 * (Math.min(width, height) / 1080));
  const { x, y, width: w, height: h } = FRAME.box;
  ctx.strokeStyle = "#00ff00";
  ctx.lineWidth = hairline / unit;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "#ff0000";
  ctx.fillStyle = "#ff0000";
  for (const peg of PEGS) {
    ctx.lineWidth = peg.strokeWidth * 0.8;
    ctx.beginPath();
    ctx.arc(peg.cx, peg.cy, peg.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const g of DANCE_GLYPHS) {
    ctx.fill(path2d(g.fill));
    ctx.lineWidth = g.strokeWidth;
    ctx.miterLimit = 8;
    ctx.stroke(path2d(g.stroke));
  }
  for (const g of KAMO_GLYPHS) ctx.fill(path2d(g.d));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
};

type Gpu = {
  readonly prims: DataTexture;
  readonly heads: DataTexture;
  readonly index: DataTexture;
  readonly bins: Bins;
};

const makeGpu = (width: number, height: number): Gpu => {
  const bins = makeBins(width, height, 1 << 17);
  return {
    prims: dataTexture(new Float32Array(3 * MAX_PRIMS * 4), 3, MAX_PRIMS),
    heads: dataTexture(bins.heads, bins.cols, bins.rows),
    index: dataTexture(bins.index, INDEX_WIDTH, bins.index.length / 4 / INDEX_WIDTH),
    bins,
  };
};

let fieldTexture: DataTexture | null = null;
const getFieldTexture = (): DataTexture => {
  if (!fieldTexture) fieldTexture = dataTexture(rainPlan().texture, FIELD_SIZE, FIELD_SIZE);
  return fieldTexture;
};

const makeMaterial = (ink: CanvasTexture): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uField: { value: getFieldTexture() },
      uInk: { value: ink },
      uRes: { value: new Vector2(1, 1) },
      uUnit: { value: 1 },
      uCam: { value: new Vector2(500, 500) },
      uPrims: { value: null },
      uHeads: { value: null },
      uIndex: { value: null },
      uFill: { value: 0 },
      uFrontS: { value: FRONT_SPEED },
      uInkAmt: { value: 0 },
      uText: { value: [0, 0, 0] },
      uFrameCol: { value: [0, 0, 0] },
      uTarp: { value: [0, 0, 0] },
      uLiquid: { value: [0, 0, 0] },
      uBackground: { value: [0, 0, 0] },
      uLight: { value: 0 },
      uPool: { value: new Vector4(440, 400, 600, 0.75) },
    },
  });

/** Screen-space reach (px) of a primitive: its disc + blend + shadow + refraction look-ups. */
const reach = (p: Prim, unit: number, cam: Camera, width: number, height: number): Ring => {
  const mx = (p.ax + p.bx) / 2;
  const my = (p.ay + p.by) / 2;
  const half = Math.hypot(p.bx - p.ax, p.by - p.ay) / 2;
  const extra = p.k + 0.6 * p.h + 3;
  const outer = p.type === 1 ? p.ra + p.rb + extra : half + Math.max(p.ra, p.rb) + extra;
  const inner = p.type === 1 ? Math.max(0, p.ra - p.rb - extra) : 0;
  return {
    x: (mx - cam.x) * unit + width / 2,
    y: (my - cam.y) * unit + height / 2,
    inner: inner * unit,
    outer: outer * unit + 2,
  };
};

const Plane: React.FC<Props & { readonly width: number; readonly height: number }> = ({
  scene,
  colors,
  unit,
  camera,
  width,
  height,
}) => {
  const u = unit * camera.zoom;
  const { canvas, texture, material } = useMemo(() => {
    const cv = document.createElement("canvas");
    const tex = new CanvasTexture(cv);
    tex.generateMipmaps = false;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    return { canvas: cv, texture: tex, material: makeMaterial(tex) };
  }, []);
  const gpu = useMemo(() => makeGpu(width, height), [width, height]);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (ctx) drawInk(ctx, width, height, u, camera);
  texture.needsUpdate = true;

  const prims = scene.prims.slice(0, MAX_PRIMS);
  const D = gpu.prims.image.data as Float32Array;
  D.fill(0);
  prims.forEach((p, i) =>
    D.set([p.ax, p.ay, p.bx, p.by, p.ra, p.rb, p.h, p.k, p.type, p.alpha, p.flash, 0], i * 12),
  );
  gpu.prims.needsUpdate = true;
  binRings(
    gpu.bins,
    prims.map((p) => reach(p, u, camera, width, height)),
  );
  gpu.heads.needsUpdate = true;
  gpu.index.needsUpdate = true;

  const uni = material.uniforms as Record<string, { value: unknown }>;
  const set = (name: string, value: unknown): void => {
    const slot = uni[name];
    if (slot) slot.value = value;
  };
  set("uPrims", gpu.prims);
  set("uHeads", gpu.heads);
  set("uIndex", gpu.index);
  set("uRes", new Vector2(width, height));
  set("uUnit", u);
  set("uCam", new Vector2(camera.x, camera.y));
  set("uFill", scene.fillBeat);
  set("uInkAmt", scene.ink);
  set("uLight", scene.light);
  set("uText", linear(colors.text));
  set("uFrameCol", linear(colors.frame));
  set("uTarp", linear(colors.tarp));
  set("uLiquid", linear(colors.liquid));
  set("uBackground", linear(colors.background));

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};

/** Fullscreen WebGL: the tarp at night and the water on it. */
export const TarpCanvas: React.FC<Props> = (props) => {
  const { width, height } = useVideoConfig();
  return (
    <ThreeCanvas
      width={width}
      height={height}
      linear
      flat
      dpr={1}
      gl={{ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Plane {...props} width={width} height={height} />
    </ThreeCanvas>
  );
};
