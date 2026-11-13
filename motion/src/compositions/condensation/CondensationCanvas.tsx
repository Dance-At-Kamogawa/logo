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
import { PEG_CENTERS } from "../../logo";
import { BLUR_DOWNSCALE, drawBackdrop, drawBlurred, type BackdropColors, type Camera } from "./backdrop";
import { MAX_BEADS, MAX_TRAILS, type CondScene } from "./scene";
import { fragmentShader, vertexShader } from "./shader";
import { binCircles, INDEX_WIDTH, makeBins, type Bins, type Circle } from "./tiles";

export type { Camera };

type Props = {
  readonly scene: CondScene;
  readonly colors: BackdropColors;
  /** Droplet tint (fringes, caustics). */
  readonly liquidColor: string;
  /** Condensation tint. */
  readonly fogColor: string;
  /** Condensation density multiplier. */
  readonly fog: number;
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

type Layer = { readonly data: DataTexture; readonly heads: DataTexture; readonly index: DataTexture; readonly bins: Bins };

const makeLayer = (width: number, height: number, max: number, capacity: number): Layer => {
  const bins = makeBins(width, height, capacity);
  return {
    data: dataTexture(new Float32Array(2 * max * 4), 2, max),
    heads: dataTexture(bins.heads, bins.cols, bins.rows),
    index: dataTexture(bins.index, INDEX_WIDTH, bins.index.length / 4 / INDEX_WIDTH),
    bins,
  };
};

const canvasTexture = (cv: HTMLCanvasElement): CanvasTexture => {
  const t = new CanvasTexture(cv);
  t.generateMipmaps = false;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  return t;
};

const PEG_LIST = [PEG_CENTERS.tl, PEG_CENTERS.tr, PEG_CENTERS.bl, PEG_CENTERS.br].map((p) => new Vector2(p.x, p.y));

const makeMaterial = (sharp: CanvasTexture, blur: CanvasTexture): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uSharp: { value: sharp },
      uBlur: { value: blur },
      uRes: { value: new Vector2(1, 1) },
      uUnit: { value: 1 },
      uCam: { value: new Vector2(500, 500) },
      uBeads: { value: null },
      uBeadHeads: { value: null },
      uBeadIndex: { value: null },
      uTrails: { value: null },
      uTrailHeads: { value: null },
      uTrailIndex: { value: null },
      uFog: { value: new Vector4(1, 1e6, 1, 1) },
      uReveal: { value: new Vector4() },
      uLayers: { value: new Vector4(1, 1, 1, 0) },
      uDrift: { value: new Vector2() },
      uPegs: { value: PEG_LIST },
      uLiquid: { value: [0, 0, 0] },
      uFogTint: { value: [0, 0, 0] },
    },
  });

/** Logo space -> px. */
const toPx = (x: number, y: number, cam: Camera, unit: number, width: number, height: number): [number, number] => [
  (x - cam.x) * unit + width / 2,
  (y - cam.y) * unit + height / 2,
];

type Gpu = { readonly beads: Layer; readonly trails: Layer };

/** Writes the scene into the material's uniforms (pure data copy). */
const applyScene = (m: ShaderMaterial, gpu: Gpu, p: Props, u: number, width: number, height: number): void => {
  const uni = m.uniforms as Record<string, { value: unknown }>;
  const set = (name: string, value: unknown): void => {
    const slot = uni[name];
    if (slot) slot.value = value;
  };
  const { scene, camera: cam } = p;

  const beads = scene.beads.slice(0, MAX_BEADS);
  const B = gpu.beads.data.image.data as Float32Array;
  B.fill(0);
  const beadCircles: Circle[] = beads.map((b, i) => {
    B.set([b.ax, b.ay, b.bx, b.by, b.ra, b.rb, b.k, 0], i * 8);
    const [x, y] = toPx((b.ax + b.bx) / 2, (b.ay + b.by) / 2, cam, u, width, height);
    const r = Math.max(b.ra, b.rb);
    // Bounding circle + the dry halo around the bead (0.85 r) + blend radius.
    const reach = Math.hypot(b.bx - b.ax, b.by - b.ay) / 2 + r * 1.9 + b.k;
    return { x, y, r: reach * u + 2 };
  });
  binCircles(gpu.beads.bins, beadCircles);

  const trails = scene.trails.slice(0, MAX_TRAILS);
  const Tr = gpu.trails.data.image.data as Float32Array;
  Tr.fill(0);
  const trailCircles: Circle[] = trails.map((s, i) => {
    Tr.set([s.ax, s.ay, s.bx, s.by, s.wa, s.wb, s.agea, s.ageb], i * 8);
    const [x, y] = toPx((s.ax + s.bx) / 2, (s.ay + s.by) / 2, cam, u, width, height);
    const reach = Math.hypot(s.bx - s.ax, s.by - s.ay) / 2 + Math.max(s.wa, s.wb) * 1.7;
    return { x, y, r: reach * u + 2 };
  });
  binCircles(gpu.trails.bins, trailCircles);

  for (const l of [gpu.beads, gpu.trails]) {
    l.data.needsUpdate = true;
    l.heads.needsUpdate = true;
    l.index.needsUpdate = true;
  }
  set("uBeads", gpu.beads.data);
  set("uBeadHeads", gpu.beads.heads);
  set("uBeadIndex", gpu.beads.index);
  set("uTrails", gpu.trails.data);
  set("uTrailHeads", gpu.trails.heads);
  set("uTrailIndex", gpu.trails.index);
  set("uRes", new Vector2(width, height));
  set("uUnit", u);
  set("uCam", new Vector2(cam.x, cam.y));
  set("uFog", new Vector4(scene.fog * p.fog, scene.refog.hold, scene.refog.dur, scene.fade));
  set("uReveal", new Vector4(scene.reveal, scene.margin, 760, 0));
  set("uLayers", new Vector4(scene.layers.small, scene.layers.medium, scene.layers.micro, 0));
  set("uDrift", new Vector2(scene.drift.x, scene.drift.y));
  set("uLiquid", linear(p.liquidColor));
  set("uFogTint", linear(p.fogColor));
};

const Plane: React.FC<Props & { readonly width: number; readonly height: number }> = (props) => {
  const { width, height, unit, camera } = props;
  const u = unit * camera.zoom;
  const res = useMemo(() => {
    const sharpCanvas = document.createElement("canvas");
    const blurCanvas = document.createElement("canvas");
    const scratchCanvas = document.createElement("canvas");
    const sharp = canvasTexture(sharpCanvas);
    const blur = canvasTexture(blurCanvas);
    return { sharpCanvas, blurCanvas, scratchCanvas, sharp, blur, material: makeMaterial(sharp, blur) };
  }, []);
  const gpu = useMemo<Gpu>(
    () => ({ beads: makeLayer(width, height, MAX_BEADS, 1 << 17), trails: makeLayer(width, height, MAX_TRAILS, 1 << 17) }),
    [width, height],
  );

  // Everything below is a pure function of the props for this frame; the
  // canvases/uniforms are updated before @remotion/three advances the renderer.
  const { sharpCanvas, blurCanvas, scratchCanvas } = res;
  const bw = Math.ceil(width / BLUR_DOWNSCALE);
  const bh = Math.ceil(height / BLUR_DOWNSCALE);
  if (sharpCanvas.width !== width || sharpCanvas.height !== height) {
    sharpCanvas.width = width;
    sharpCanvas.height = height;
    blurCanvas.width = bw;
    blurCanvas.height = bh;
    scratchCanvas.width = bw;
    scratchCanvas.height = bh;
  }
  const ctx = sharpCanvas.getContext("2d");
  const bctx = blurCanvas.getContext("2d");
  const sctx = scratchCanvas.getContext("2d");
  if (ctx && bctx && sctx) {
    drawBackdrop(ctx, width, height, u, camera, props.scene.lights, props.colors);
    // ~26 logo units of blur at full resolution.
    drawBlurred(bctx, sctx, sharpCanvas, (26 * u) / BLUR_DOWNSCALE);
  }
  res.sharp.needsUpdate = true;
  res.blur.needsUpdate = true;
  applyScene(res.material, gpu, props, u, width, height);

  return (
    <mesh frustumCulled={false} material={res.material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};

/** Fullscreen WebGL window glass: condensation, droplets and the night behind. */
export const CondensationCanvas: React.FC<Props> = (props) => {
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
