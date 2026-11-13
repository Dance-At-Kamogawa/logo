import { ThreeCanvas } from "@remotion/three";
import type React from "react";
import { useMemo } from "react";
import { useVideoConfig } from "remotion";
import { CanvasTexture, Color, LinearFilter, LinearMipmapLinearFilter, ShaderMaterial, Vector2, Vector4 } from "three";
import { PEG_CENTERS } from "../../logo";
import { drawPlane, PLANE_SPAN, PLANE_TEX, type PlaneColors } from "./plane";
import type { LensScene } from "./scene";
import { fragmentShader, MAX_DROPS, vertexShader } from "./shader";

type Props = {
  readonly scene: LensScene;
  readonly colors: PlaneColors;
  readonly glassColor: string;
  readonly background: string;
  /** px per logo unit. */
  readonly unit: number;
};

const linear = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  // Colour management is off for this raw shader: convert sRGB -> linear by hand.
  return [Math.pow(c.r, 2.2), Math.pow(c.g, 2.2), Math.pow(c.b, 2.2)];
};

const PEG_UNIFORM = (["tl", "tr", "bl", "br"] as const).map((c) => new Vector2(PEG_CENTERS[c].x, PEG_CENTERS[c].y));

const makeMaterial = (texture: CanvasTexture): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uPlane: { value: texture },
      uRes: { value: new Vector2(1, 1) },
      uUnit: { value: 1 },
      uCam: { value: new Vector2(500, 500) },
      uDrop: { value: Array.from({ length: MAX_DROPS }, () => new Vector4()) },
      uDropB: { value: Array.from({ length: MAX_DROPS }, () => new Vector4()) },
      uCount: { value: 0 },
      uPeg: { value: PEG_UNIFORM },
      uReveal: { value: new Vector4(0, 1, 0, 0) },
      uGlass: { value: [0, 0, 0] },
      uBg: { value: [0, 0, 0] },
      uGlint: { value: 1 },
      uLight: { value: 0 },
      uLod0: { value: 0 },
      uDisp: { value: 0.012 },
    },
  });

const Plane: React.FC<Props & { readonly width: number; readonly height: number }> = ({
  scene,
  colors,
  glassColor,
  background,
  unit,
  width,
  height,
}) => {
  // The logo plane is static: drawn and uploaded (with mipmaps) once.
  const material = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = PLANE_TEX;
    cv.height = PLANE_TEX;
    const ctx = cv.getContext("2d");
    if (ctx) drawPlane(ctx, colors);
    const tex = new CanvasTexture(cv);
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = 1;
    return makeMaterial(tex);
  }, [colors.text, colors.frame]);

  // Pure data copy of this frame's scene into the uniforms.
  const u = material.uniforms as Record<string, { value: unknown }>;
  const set = (name: string, value: unknown): void => {
    const slot = u[name];
    if (slot) slot.value = value;
  };
  const drops = scene.drops.slice(0, MAX_DROPS);
  const A = u.uDrop?.value as Vector4[];
  const B = u.uDropB?.value as Vector4[];
  A.forEach((v, i) => {
    const d = drops[i];
    v.set(d?.x ?? 0, d?.y ?? 0, Math.max(0.5, d?.r ?? 1), d?.depth ?? 2);
  });
  B.forEach((v, i) => {
    const d = drops[i];
    v.set(d?.alpha ?? 0, d?.k ?? 0, d?.glint ?? 0, 0);
  });
  set("uCount", drops.length);
  set("uRes", new Vector2(width, height));
  set("uUnit", unit);
  set("uCam", new Vector2(scene.camera.x, scene.camera.y));
  const r = scene.reveal;
  set("uReveal", new Vector4(r.front, Math.max(1, r.soft), r.level, r.bloom));
  set("uGlass", linear(glassColor));
  set("uBg", linear(background));
  set("uGlint", scene.glint);
  set("uLight", scene.light);
  set("uLod0", Math.max(0, Math.log2(PLANE_TEX / PLANE_SPAN / unit)));

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};

/** Fullscreen WebGL droplet lenses over the (mostly hidden) logo plane. */
export const LensCanvas: React.FC<Props> = (props) => {
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
