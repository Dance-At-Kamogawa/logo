import { useFrame } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import type React from "react";
import { useMemo } from "react";
import { useVideoConfig } from "remotion";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";
import { lensMesh } from "./lens";
import { drawLogoTexture, LOGO_TEX, type LogoColors } from "./logoTexture";
import { CAM_DIST, NDROPS, NW, type Camera, type CausticScene } from "./scene";
import { causticFragment, causticVertex, compositeFragment, quadVertex } from "./shaders";

type Props = {
  readonly scene: CausticScene;
  /** px per logo unit at zoom 1 (top-down). */
  readonly unit: number;
  readonly colors: LogoColors & { readonly light: string; readonly liquid: string; readonly background: string };
};

const linear = (hex: string): Vector3 => {
  const c = new Color(hex);
  // Colour management is off for these raw shaders: sRGB -> linear by hand.
  return new Vector3(Math.pow(c.r, 2.2), Math.pow(c.g, 2.2), Math.pow(c.b, 2.2));
};

type Uniform = { value: unknown };

/** Camera basis for a pinhole above the floor (logo space, z up toward the viewer). */
const cameraBasis = (cam: Camera, unit: number) => {
  const r = new Vector3(Math.cos(cam.yaw), Math.sin(cam.yaw), 0);
  const u = new Vector3(-Math.sin(cam.yaw), Math.cos(cam.yaw), 0);
  const back = u.clone().multiplyScalar(Math.sin(cam.pitch)).add(new Vector3(0, 0, Math.cos(cam.pitch)));
  const pos = new Vector3(cam.x, cam.y, 0).addScaledVector(back, CAM_DIST);
  const f = back.clone().negate();
  const d = new Vector3().crossVectors(r, f);
  return { pos, r, d, f, focal: unit * CAM_DIST * cam.zoom };
};

const CHANNELS = [
  { mask: new Vector3(1, 0, 0), disp: 0.965 },
  { mask: new Vector3(0, 1, 0), disp: 1 },
  { mask: new Vector3(0, 0, 1), disp: 1.035 },
] as const;

type Gpu = {
  readonly shared: Record<string, Uniform>;
  readonly composite: Record<string, Uniform>;
  readonly causticScene: Scene;
  readonly compositeScene: Scene;
  readonly target: WebGLRenderTarget;
  readonly logoCanvas: HTMLCanvasElement;
  readonly logoTexture: CanvasTexture;
  readonly camera: OrthographicCamera;
};

const makeGpu = (width: number, height: number): Gpu => {
  const lens = lensMesh();
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(lens.position, 3));
  geo.setAttribute("aNear", new BufferAttribute(lens.near, 2));
  geo.setIndex(new BufferAttribute(lens.index, 1));

  const v4 = (): Uniform => ({ value: new Vector4() });
  const shared: Record<string, Uniform> = {
    uRes: { value: new Vector2(width, height) },
    uCamPos: { value: new Vector3() },
    uCamR: { value: new Vector3() },
    uCamD: { value: new Vector3() },
    uCamF: { value: new Vector3() },
    uFocal: { value: 1 },
    uWaves: { value: Array.from({ length: NW }, () => new Vector4()) },
    uRing: v4(),
    uRingWidth: { value: 70 },
    uPool: v4(),
    uPool2: v4(),
    uHarm: v4(),
    uLogo: v4(),
    uNoiseGain: { value: new Vector2(1, 1) },
  };
  const causticScene = new Scene();
  for (const ch of CHANNELS) {
    const m = new ShaderMaterial({
      vertexShader: causticVertex,
      fragmentShader: causticFragment,
      uniforms: { ...shared, uChannel: { value: ch.mask }, uDisp: { value: ch.disp } },
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    });
    const mesh = new Mesh(geo, m);
    mesh.frustumCulled = false;
    causticScene.add(mesh);
  }

  const target = new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });

  const logoCanvas = document.createElement("canvas");
  const logoTexture = new CanvasTexture(logoCanvas);
  logoTexture.generateMipmaps = true;
  logoTexture.minFilter = LinearMipmapLinearFilter;
  logoTexture.magFilter = LinearFilter;
  logoTexture.anisotropy = 4;

  const composite: Record<string, Uniform> = {
    uRes: shared.uRes ?? { value: null },
    uCamPos: shared.uCamPos ?? { value: null },
    uCamR: shared.uCamR ?? { value: null },
    uCamD: shared.uCamD ?? { value: null },
    uCamF: shared.uCamF ?? { value: null },
    uFocal: shared.uFocal ?? { value: null },
    uCaustic: { value: target.texture },
    uLogoTex: { value: logoTexture },
    uLogoRect: { value: new Vector3(LOGO_TEX.x0, LOGO_TEX.y0, LOGO_TEX.size) },
    uLight: { value: new Vector3() },
    uLiquid: { value: new Vector3() },
    uBg: { value: new Vector3() },
    uTone: v4(),
    uDrops: { value: Array.from({ length: NDROPS }, () => new Vector4()) },
    uDropW: { value: Array.from({ length: NDROPS }, () => new Vector4()) },
  };
  const compositeScene = new Scene();
  const quad = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: compositeFragment,
      uniforms: composite,
      depthTest: false,
      depthWrite: false,
    }),
  );
  quad.frustumCulled = false;
  compositeScene.add(quad);
  return {
    shared,
    composite,
    causticScene,
    compositeScene,
    target,
    logoCanvas,
    logoTexture,
    camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1),
  };
};

const setV4 = (u: Uniform | undefined, x: number, y: number, z: number, w: number): void => {
  if (u?.value instanceof Vector4) u.value.set(x, y, z, w);
};
const setV3 = (u: Uniform | undefined, v: Vector3): void => {
  if (u?.value instanceof Vector3) u.value.copy(v);
};
const setArr = (u: Uniform | undefined, rows: readonly (readonly [number, number, number, number])[]): void => {
  const arr = u?.value;
  if (!Array.isArray(arr)) return;
  rows.forEach((r, i) => {
    const v: unknown = arr[i];
    if (v instanceof Vector4) v.set(r[0], r[1], r[2], r[3]);
  });
};

/** Writes the scene into the uniforms (pure data copy). */
const apply = (gpu: Gpu, scene: CausticScene, unit: number, colors: Props["colors"]): void => {
  const { shared: s, composite: c } = gpu;
  const cam = cameraBasis(scene.camera, unit);
  setV3(s.uCamPos, cam.pos);
  setV3(s.uCamR, cam.r);
  setV3(s.uCamD, cam.d);
  setV3(s.uCamF, cam.f);
  if (s.uFocal) s.uFocal.value = cam.focal;
  setArr(
    s.uWaves,
    scene.waves.map((w) => [w.kx, w.ky, w.focus, w.phase] as const),
  );
  setV4(s.uRing, scene.ring.x, scene.ring.y, scene.ring.amp, scene.ring.radius);
  if (s.uRingWidth) s.uRingWidth.value = scene.ring.width;
  const p = scene.pool;
  setV4(s.uPool, p.x, p.y, p.r, p.exp);
  setV4(s.uPool2, p.soft, p.rim, p.rimWidth, scene.light);
  setV4(s.uHarm, p.h[0], p.h[1], p.h[2], p.h[3]);
  setV4(s.uLogo, scene.logo.s, scene.logo.b1, scene.logo.b2, scene.logo.delta);
  if (s.uNoiseGain?.value instanceof Vector2) s.uNoiseGain.value.set(scene.noiseGain[0], scene.noiseGain[1]);

  setV3(c.uLight, linear(colors.light));
  setV3(c.uLiquid, linear(colors.liquid));
  setV3(c.uBg, linear(colors.background));
  setV4(c.uTone, scene.exposure, scene.overlay, 1, scene.light);
  setArr(
    c.uDrops,
    scene.drops.map((d) => [d.x, d.y, d.z, d.r] as const),
  );
  setArr(
    c.uDropW,
    scene.drops.map((d) => [d.wobble, d.phase, d.squash, d.seed] as const),
  );
};

const Passes: React.FC<Props & { readonly width: number; readonly height: number }> = ({
  scene,
  unit,
  colors,
  width,
  height,
}) => {
  const gpu = useMemo(() => makeGpu(width, height), [width, height]);
  // The hairline is ~1.8 px at 1080 in the final top-down view.
  const hairline = Math.max(1, 1.8 * (Math.min(width, height) / 1080)) / unit;
  useMemo(() => {
    drawLogoTexture(gpu.logoCanvas, { text: colors.text, frame: colors.frame }, hairline);
    gpu.logoTexture.needsUpdate = true;
  }, [gpu, colors.text, colors.frame, hairline]);

  // Pure function of the props for this frame.
  apply(gpu, scene, unit, colors);

  // Priority 1 takes over rendering: light pass into the half-float target,
  // then the composite to the screen. (Only used as the render hook; all
  // animation comes from the Remotion frame through `scene`.)
  useFrame(({ gl }) => {
    gl.setRenderTarget(gpu.target);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, false, false);
    gl.render(gpu.causticScene, gpu.camera);
    gl.setRenderTarget(null);
    gl.render(gpu.compositeScene, gpu.camera);
  }, 1);
  return null;
};

/** Fullscreen WebGL: floating glass water, caustic light on the floor. */
export const CausticsCanvas: React.FC<Props> = (props) => {
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
      <Passes {...props} width={width} height={height} />
    </ThreeCanvas>
  );
};
