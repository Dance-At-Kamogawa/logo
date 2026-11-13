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
import { drawBackdrop, type BackdropColors } from "./backdrop";
import { dropReach, MAX_DROPS, RIPPLE, WAVES, type WaterScene } from "./scene";
import { fragmentShader, vertexShader } from "./shader";
import { binRings, INDEX_WIDTH, makeBins, type Bins, type Ring } from "./tiles";

type Props = {
  readonly scene: WaterScene;
  readonly colors: BackdropColors;
  /** Highlight tint (caustics, glints, fringes). */
  readonly liquidColor: string;
  /** Water body colour (nearly black). */
  readonly background: string;
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
  readonly drops: DataTexture;
  readonly heads: DataTexture;
  readonly index: DataTexture;
  readonly bins: Bins;
};

const makeGpu = (width: number, height: number): Gpu => {
  const bins = makeBins(width, height, 1 << 18);
  return {
    // 2 texels per drop: (x y age amp) (size flash 0 0)
    drops: dataTexture(new Float32Array(2 * MAX_DROPS * 4), 2, MAX_DROPS),
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
      uDrops: { value: null },
      uHeads: { value: null },
      uIndex: { value: null },
      uWaves: { value: Array.from({ length: WAVES }, () => new Vector4()) },
      uRipple: { value: new Vector4(RIPPLE.speed, RIPPLE.wavelength, RIPPLE.sigma0, RIPPLE.spread) },
      uDecay: { value: RIPPLE.decay },
      uBed: { value: new Vector4() },
      uSweep: { value: [new Vector4(), new Vector4()] },
      uDrift: { value: 0 },
      uLiquid: { value: [0, 0, 0] },
      uBackground: { value: [0, 0, 0] },
    },
  });

/** Writes the scene into the material's uniforms (pure data copy). */
const applyScene = (
  m: ShaderMaterial,
  gpu: Gpu,
  scene: WaterScene,
  unit: number,
  cam: Camera,
  width: number,
  height: number,
  liquid: string,
  background: string,
): void => {
  const u = m.uniforms as Record<string, { value: unknown }>;
  const set = (name: string, value: unknown): void => {
    const slot = u[name];
    if (slot) slot.value = value;
  };
  const drops = scene.drops.slice(0, MAX_DROPS);
  const D = gpu.drops.image.data as Float32Array;
  D.fill(0);
  drops.forEach((d, i) => D.set([d.x, d.y, d.age, d.amp, d.size, d.flash, 0, 0], i * 8));
  gpu.drops.needsUpdate = true;
  const rings: Ring[] = drops.map((d) => {
    const r = dropReach(d.age, d.size);
    return {
      x: (d.x - cam.x) * unit + width / 2,
      y: (d.y - cam.y) * unit + height / 2,
      inner: r.inner * unit,
      // + refraction/streak look-up reach of a pixel or two
      outer: r.outer * unit + 2,
    };
  });
  binRings(gpu.bins, rings);
  gpu.heads.needsUpdate = true;
  gpu.index.needsUpdate = true;
  set("uDrops", gpu.drops);
  set("uHeads", gpu.heads);
  set("uIndex", gpu.index);
  set("uRes", new Vector2(width, height));
  set("uUnit", unit);
  set("uCam", new Vector2(cam.x, cam.y));
  set(
    "uWaves",
    scene.waves.slice(0, WAVES).map((w) => new Vector4(w.kx, w.ky, w.amp, w.phase)),
  );
  set("uBed", new Vector4(scene.develop, scene.ambient, scene.pegGlow, 0.0004));
  set(
    "uSweep",
    scene.sweeps.map((s) => new Vector4(s.x, s.y, s.intensity, s.radius)),
  );
  set("uDrift", scene.drift);
  set("uLiquid", linear(liquid));
  set("uBackground", linear(background));
};

const Plane: React.FC<Props & { readonly width: number; readonly height: number }> = ({
  scene,
  colors,
  liquidColor,
  background,
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
  if (ctx) drawBackdrop(ctx, width, height, u, camera, colors);
  texture.needsUpdate = true;
  applyScene(material, gpu, scene, u, camera, width, height, liquidColor, background);

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};

/** Fullscreen WebGL night water over the logo on the riverbed. */
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
