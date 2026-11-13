import { PLANE_PAD, PLANE_SPAN } from "./plane";

export const MAX_DROPS = 8;

/**
 * Fullscreen droplet-lens shader.
 *
 * A few glass droplets float above the logo plane. Their outlines are a
 * smooth union of circles (so two drops that touch grow a metaball neck);
 * the surface is the matching height field, i.e. a sphere cap per drop.
 * Every pixel inside a drop is ray-traced through a virtual ball lens:
 * refract in at the front surface, exit at the back, refract out and hit the
 * logo plane `depth` radii below the centre. Far from the plane (depth >
 * the ball's focal length 1.5 r) the image is magnified and inverted, close
 * to it (a bead lying on the plane) it is upright, at the focus it blows up.
 * Three refractive indices give the chromatic fringes. The glass itself
 * follows the first version's droplets: aqua Beer-Lambert absorption, a
 * faint milky scatter, a caustic on the shadow side, Fresnel reflection of a
 * procedural studio and sharp glints.
 *
 * The plane is visible outside the drops only where `uReveal` has spread
 * (a soft wipe from the four grommets).
 */

export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;

#define MAX_DROPS ${MAX_DROPS}
#define PAD ${PLANE_PAD.toFixed(1)}
#define SPAN ${PLANE_SPAN.toFixed(1)}

varying vec2 vUv;

uniform sampler2D uPlane;
uniform vec2 uRes;          // composition size, px
uniform float uUnit;        // px per logo unit
uniform vec2 uCam;          // logo point at the canvas centre
uniform vec4 uDrop[MAX_DROPS];  // x y radius depth(in radii, below the centre)
uniform vec4 uDropB[MAX_DROPS]; // alpha blendRadius glint 0
uniform int uCount;
uniform vec2 uPeg[4];
uniform vec4 uReveal;       // front radius, softness, level behind the front, bloom
uniform vec3 uGlass;        // linear rgb
uniform vec3 uBg;           // linear rgb
uniform float uGlint;       // global specular gain (beat)
uniform float uLight;       // studio rotation, radians
uniform float uLod0;        // plane mip level at 1:1 on screen
uniform float uDisp;        // dispersion (index spread)

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

vec3 plane(vec2 p, float lod) {
  vec2 uv = (p + PAD) / SPAN;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  return toLinear(textureLod(uPlane, vec2(uv.x, 1.0 - uv.y), lod).rgb);
}

float revealAt(vec2 p, out float bloom) {
  float dm = 1e5;
  for (int i = 0; i < 4; i++) dm = min(dm, length(p - uPeg[i]));
  float z = (dm - uReveal.x) / uReveal.y;
  bloom = uReveal.w * exp(-z * z);
  return uReveal.z * (1.0 - smoothstep(-1.0, 0.0, z));
}

float box(vec2 p, vec2 c, vec2 hs, float soft) {
  vec2 d = abs(p - c) - hs;
  float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, o);
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Procedural studio (first-version droplets): dark room, a big soft box
// upper-left, strip lights; r is the reflection direction (logo space, z up).
vec3 env(vec3 r) {
  vec2 o = rot(uLight) * (r.xy / (1.0 + r.z));
  vec3 col = vec3(0.010, 0.013, 0.015);
  col += vec3(0.05, 0.06, 0.065) * smoothstep(0.2, -0.9, o.y);
  col += vec3(1.9) * box(o, vec2(-0.48, -0.55), vec2(0.30, 0.17), 0.10);
  col += vec3(1.1) * box(o, vec2(0.80, -0.08), vec2(0.06, 0.48), 0.05);
  col += vec3(0.75, 0.9, 0.95) * box(o, vec2(-0.6, 0.78), vec2(0.38, 0.05), 0.07);
  col += vec3(0.35) * box(o, vec2(0.30, -0.80), vec2(0.20, 0.04), 0.05);
  col += vec3(2.2) * box(o, vec2(-0.86, -0.1), vec2(0.025, 0.42), 0.02);
  col += vec3(1.6) * box(o, vec2(0.05, -0.9), vec2(0.45, 0.022), 0.02);
  col += vec3(1.2) * box(o, vec2(0.62, 0.62), vec2(0.03, 0.22), 0.02);
  return col;
}

// Ball lens of unit radius: entry normal N (= entry point), index n, logo
// plane at z = -depth. Returns the hit on the plane relative to the virtual
// centre, in radii.
vec2 lens(vec3 N, float n, float depth) {
  vec3 T1 = refract(vec3(0.0, 0.0, -1.0), N, 1.0 / n);
  float t = -2.0 * dot(N, T1);
  vec3 P2 = N + t * T1;
  vec3 N2 = normalize(P2);
  vec3 T2 = refract(T1, -N2, n);
  if (dot(T2, T2) < 0.5) T2 = reflect(T1, -N2);
  float tz = min(T2.z, -0.06);
  float s = (-depth - P2.z) / tz;
  return P2.xy + T2.xy * s;
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 p = (px - 0.5 * uRes) / uUnit + uCam;
  float pix = 1.0 / uUnit;

  float bloom;
  float lvl = revealAt(p, bloom);
  vec3 base = uBg + plane(p, uLod0) * (lvl + bloom) + uGlass * bloom * 0.0007;

  // ---- droplet field: smooth union of circles with blended attributes
  float fd = 1e5;
  vec2 fg = vec2(0.0, 1.0);
  float fr = 1.0, fD = 2.0, fa = 0.0, fgl = 0.0;
  for (int i = 0; i < MAX_DROPS; i++) {
    if (i >= uCount) break;
    vec4 A = uDrop[i];
    vec4 B = uDropB[i];
    if (B.x <= 0.0) continue;
    vec2 v = p - A.xy;
    float L = length(v);
    float d = L - A.z;
    vec2 g = L > 1e-4 ? v / L : vec2(0.0, 1.0);
    if (fd > 1e4) {
      fd = d; fg = g; fr = A.z; fD = A.w; fa = B.x; fgl = B.z;
      continue;
    }
    float k = max(B.y, 1e-3);
    if (d - fd >= k) continue;
    float m = clamp(0.5 + 0.5 * (d - fd) / k, 0.0, 1.0); // weight of the accumulated field
    fd = mix(d, fd, m) - k * m * (1.0 - m);
    fg = mix(g, fg, m);
    fr = mix(A.z, fr, m);
    fD = mix(A.w, fD, m);
    fa = mix(B.x, fa, m);
    fgl = mix(B.z, fgl, m);
  }

  float cover = clamp(0.5 - fd / (1.6 * pix), 0.0, 1.0) * fa;
  if (cover <= 0.0) {
    gl_FragColor = vec4(toSrgb(base), 1.0);
    return;
  }

  // ---- surface: sphere-cap height field of the blended distance
  float din = min(fd, 0.0);
  float h = sqrt(max(-din * (2.0 * fr + din), 0.0));
  float Lr = fr + din;
  vec3 N = normalize(vec3(fg * Lr, max(h, 0.02 * fr)));
  float rho = clamp(length(N.xy), 0.0, 0.9995);

  // ---- refraction through the ball onto the plane (chromatic)
  float f = 1.5; // paraxial focal length of an n=1.5 ball, in radii from the centre
  float mag = abs(f - fD) / f * (1.0 + 5.0 * pow(rho, 6.0));
  float lod = max(0.0, uLod0 + log2(max(mag, 0.05)) + 0.3);
  vec2 cv = p - fr * N.xy; // virtual centre of the local sphere
  vec3 refr = uBg + vec3(
    plane(cv + fr * lens(N, 1.5 - uDisp, fD), lod).r,
    plane(cv + fr * lens(N, 1.5, fD), lod).g,
    plane(cv + fr * lens(N, 1.5 + uDisp, fD), lod).b
  );

  // ---- glass body
  float thick = 2.0 * h;
  vec3 sigma = (vec3(1.0) - uGlass) * 0.0042 + 0.0006;
  vec3 trans = exp(-sigma * thick);
  vec3 L1 = normalize(vec3(rot(-uLight) * vec2(-0.5, -0.62), 0.6));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float lit = 0.6 + 0.4 * dot(N, L1);
  float lum = dot(uGlass, vec3(0.2126, 0.7152, 0.0722));
  vec3 milk = mix(vec3(lum), uGlass, 0.6);
  float scatterAmt = 1.0 - exp(-thick * 0.012);
  vec3 body = refr * trans + milk * scatterAmt * 0.2 * lit;

  // Caustic: light focused through the drop pools on the side away from the light.
  float edge = 1.0 - N.z;
  vec2 nd = length(N.xy) > 1e-4 ? normalize(N.xy) : vec2(0.0);
  float away = max(dot(nd, -normalize(L1.xy)), 0.0);
  float caustic = pow(away, 2.5) * smoothstep(0.02, 0.3, edge) * (1.0 - smoothstep(0.6, 0.97, edge));
  body += mix(milk, uGlass, 0.7) * caustic * 0.9;

  // Reflection + glints.
  float F = 0.03 + 0.97 * pow(1.0 - max(N.z, 0.0), 5.0);
  vec3 refl = env(reflect(-V, N));
  vec3 H1 = normalize(L1 + V);
  vec3 L2 = normalize(vec3(rot(-uLight) * vec2(0.72, -0.1), 0.68));
  vec3 H2 = normalize(L2 + V);
  float g = uGlint * (0.6 + fgl);
  float spec = (pow(max(dot(N, H1), 0.0), 300.0) * 3.0 + pow(max(dot(N, H2), 0.0), 600.0) * 2.0) * g;

  vec3 col = mix(body, refl, F) + vec3(spec);
  col += vec3(0.6, 0.75, 0.78) * 0.025 * smoothstep(0.0, 0.08, edge);
  col = col / (1.0 + max(col - 0.85, 0.0) * 0.6);

  gl_FragColor = vec4(toSrgb(mix(base, col, cover)), 1.0);
}
`;
