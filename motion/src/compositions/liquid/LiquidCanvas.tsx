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
import { drawBackdrop, type BackdropColors, type BackdropState } from "./backdrop";
import { HARMONICS, MAX_PRIMS, type Scene } from "./scene";
import { fragmentShader, vertexShader } from "./shader";
import { binPrims, INDEX_WIDTH, makeBins, type Bins } from "./tiles";

type Props = {
  readonly scene: Scene;
  readonly backdrop: BackdropState;
  readonly colors: BackdropColors;
  readonly liquidColor: string;
  /** px per logo unit (at zoom 1). */
  readonly unit: number;
  /** Logo-space point at the canvas centre, and zoom. Default: the logo centre, 1. */
  readonly camera?: Camera;
};

export type Camera = { readonly x: number; readonly y: number; readonly zoom: number };
const DEFAULT_CAMERA: Camera = { x: 500, y: 500, zoom: 1 };

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

type Gpu = {
  readonly prims: DataTexture;
  readonly heads: DataTexture;
  readonly index: DataTexture;
  readonly bins: Bins;
};

const makeGpu = (width: number, height: number): Gpu => {
  const bins = makeBins(width, height, 1 << 17);
  return {
    // 3 texels per primitive: (ax ay bx by) (ra rb w h) (k clear soft alpha)
    prims: dataTexture(new Float32Array(3 * MAX_PRIMS * 4), 3, MAX_PRIMS),
    heads: dataTexture(bins.heads, bins.cols, bins.rows),
    index: dataTexture(bins.index, INDEX_WIDTH, bins.index.length / 4 / INDEX_WIDTH),
    bins,
  };
};

const makeMaterial = (texture: CanvasTexture): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uBackdrop: { value: texture },
      uRes: { value: new Vector2(1, 1) },
      uUnit: { value: 1 },
      uCam: { value: new Vector2(500, 500) },
      uPrims: { value: null },
      uHeads: { value: null },
      uIndex: { value: null },
      uBlob: { value: new Vector4() },
      uBlobShape: { value: new Vector4() },
      uBlobRim: { value: 0 },
      uBlobClear: { value: 0 },
      uHarm: { value: new Float32Array(HARMONICS * 2) },
      uRipple: { value: new Float32Array(4) },
      uLiquid: { value: [0, 0, 0] },
      uNoise: { value: new Vector2() },
    },
  });

/** Writes the scene into the material's uniforms (pure data copy). */
const applyScene = (
  m: ShaderMaterial,
  gpu: Gpu,
  scene: Scene,
  unit: number,
  cam: Camera,
  width: number,
  height: number,
  liquid: string,
): void => {
  const u = m.uniforms as Record<string, { value: unknown }>;
  const prims = scene.prims.slice(0, MAX_PRIMS);
  const P = gpu.prims.image.data as Float32Array;
  prims.forEach((p, i) => {
    P.set([p.ax, p.ay, p.bx, p.by, p.ra, p.rb, Math.max(0.5, p.w), Math.max(0.5, p.h), p.k, p.clear, p.soft, p.alpha], i * 12);
  });
  gpu.prims.needsUpdate = true;
  binPrims(gpu.bins, prims, { width, height, unit, cam });
  gpu.heads.needsUpdate = true;
  gpu.index.needsUpdate = true;
  const set = (name: string, value: unknown): void => {
    const slot = u[name];
    if (slot) slot.value = value;
  };
  set("uPrims", gpu.prims);
  set("uHeads", gpu.heads);
  set("uIndex", gpu.index);
  set("uRes", new Vector2(width, height));
  set("uUnit", unit);
  set("uCam", new Vector2(cam.x, cam.y));
  const b = scene.blob;
  set("uBlob", new Vector4(b.cx, b.cy, Math.max(0, b.r0), 1));
  set("uBlobShape", new Vector4(b.sx, b.sy, Math.max(1, b.w), Math.max(1, b.h)));
  set("uBlobRim", b.rim);
  set("uBlobClear", b.clear);
  const H = u.uHarm?.value as Float32Array;
  b.harm.slice(0, HARMONICS).forEach((hm, i) => H.set([hm.amp, hm.phase], i * 2));
  const R = u.uRipple?.value as Float32Array;
  [0, 1].forEach((i) => {
    const r = scene.ripples[i];
    R.set(r ? [r.amp, r.front] : [0, 0], i * 2);
  });
  set("uLiquid", linear(liquid));
  set("uNoise", new Vector2(scene.drift.x, scene.drift.y));
};

const Plane: React.FC<Props & { readonly width: number; readonly height: number }> = ({
  scene,
  backdrop,
  colors,
  liquidColor,
  unit,
  camera = DEFAULT_CAMERA,
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

  // Everything below is a pure function of the props for this frame; the
  // canvas/uniforms are updated before @remotion/three advances the renderer.
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (ctx) drawBackdrop(ctx, width, height, u, camera, backdrop, colors);
  texture.needsUpdate = true;
  applyScene(material, gpu, scene, u, camera, width, height, liquidColor);

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};

/** Fullscreen WebGL liquid over the logo backdrop. */
export const LiquidCanvas: React.FC<Props> = (props) => {
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
