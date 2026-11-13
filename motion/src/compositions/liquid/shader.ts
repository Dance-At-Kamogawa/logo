import { WAVES } from "./scene";
import { INDEX_WIDTH, TILE } from "./tiles";

/**
 * Fullscreen night-river shader (seen from straight above).
 *
 * Height field = slow plane waves + one damped radial wave packet per
 * raindrop (a fast main ring and a slower, finer capillary ring, plus the
 * impact crater/jet). Height, gradient and Hessian are all analytic.
 *
 *  - Refraction: the logo lies on the riverbed (a canvas texture); the
 *    surface slope shifts where each colour channel samples it, so ripples
 *    bend the logo and leave chromatic fringes.
 *  - Caustics: light focused by the surface lands on the bed with intensity
 *    1 / |det(I + D * Hessian)|. On still water the bed is dark, so the logo
 *    only shows in the fragments that ripples light up.
 *  - Reflection: an almost black night sky with a faint aqua glow, broken
 *    horizontal streaks of distant city lights, and two lamps for sharp
 *    glints on the ring flanks.
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

#define TILE ${TILE}
#define INDEX_WIDTH ${INDEX_WIDTH}
#define WAVES ${WAVES}
#define TAU 6.28318530718

varying vec2 vUv;

uniform sampler2D uBackdrop;
uniform vec2 uRes;              // composition size, px
uniform float uUnit;            // px per logo unit
uniform vec2 uCam;              // logo point at the canvas centre
uniform highp sampler2D uDrops; // 2 texels per drop: (x y age amp) (size flash 0 0)
uniform highp sampler2D uHeads; // per 32px tile: (offset, count)
uniform highp sampler2D uIndex; // drop indices
uniform vec4 uWaves[WAVES];     // kx ky amp phase
uniform vec4 uRipple;           // speed wavelength sigma0 spread
uniform float uDecay;
uniform vec4 uBed;              // develop ambient pegGlow ghost
uniform vec4 uSweep[2];         // x y intensity radius
uniform float uDrift;           // 0..1 per loop
uniform vec3 uLiquid;           // linear rgb (highlight tint)
uniform vec3 uBackground;       // linear rgb (water body)

// ------------------------------------------------------------ surface

struct Surf { float h; vec2 g; vec3 H; }; // H = (hxx, hxy, hyy)

// Adds a radial profile with derivatives d1 = h'(r), d2 = h''(r).
void addRadial(inout Surf s, vec2 v, float r, float h, float d1, float d2) {
  vec2 n = v / max(r, 1e-3);
  float t = d1 / max(r, 3.0);
  s.h += h;
  s.g += d1 * n;
  s.H += vec3(
    d2 * n.x * n.x + t * (1.0 - n.x * n.x),
    (d2 - t) * n.x * n.y,
    d2 * n.y * n.y + t * (1.0 - n.y * n.y)
  );
}

// Gaussian wave packet A * E(u) * cos(k u), u = r - front.
void packet(float r, float front, float sigma, float k, float A, inout float h, inout float d1, inout float d2) {
  float u = r - front;
  float q = u / sigma;
  if (abs(q) > 3.3) return;
  float is2 = 1.0 / (sigma * sigma);
  float E = exp(-q * q);
  float E1 = -2.0 * u * is2 * E;
  float E2 = (4.0 * u * u * is2 * is2 - 2.0 * is2) * E;
  float c = cos(k * u), sn = sin(k * u);
  h += A * E * c;
  d1 += A * (E1 * c - k * E * sn);
  d2 += A * (E2 * c - 2.0 * k * E1 * sn - k * k * E * c);
}

float flashSum = 0.0;

Surf surface(vec2 p, vec2 px) {
  Surf s = Surf(0.0, vec2(0.0), vec3(0.0));
  for (int i = 0; i < WAVES; i++) {
    vec4 w = uWaves[i];
    float ph = dot(w.xy, p) + w.w;
    float c = cos(ph), sn = sin(ph);
    s.h += w.z * c;
    s.g += -w.z * sn * w.xy;
    s.H += -w.z * c * vec3(w.x * w.x, w.x * w.y, w.y * w.y);
  }
  vec4 head = texelFetch(uHeads, ivec2(px) / TILE, 0);
  int offset = int(head.x + 0.5);
  int count = int(head.y + 0.5);
  for (int n = 0; n < 512; n++) {
    if (n >= count) break;
    int e = offset + n;
    int i = int(texelFetch(uIndex, ivec2(e % INDEX_WIDTH, e / INDEX_WIDTH), 0).x + 0.5);
    vec4 A = texelFetch(uDrops, ivec2(0, i), 0);
    vec4 B = texelFetch(uDrops, ivec2(1, i), 0);
    vec2 v = p - A.xy;
    float r = length(v);
    float age = A.z;
    float size = B.x;
    if (age < 0.0) {
      // The falling drop, seen from above: a tiny bright dot just before impact.
      float f = smoothstep(-0.14, 0.0, age);
      flashSum += 0.5 * f * exp(-r * r / (9.0 * size));
      continue;
    }
    float c1 = uRipple.x * sqrt(size);
    float k = TAU / (uRipple.y * size);
    float front = c1 * age;
    float sig = uRipple.z * size + uRipple.w * front;
    float amp = A.w * exp(-uDecay * age) * inversesqrt(1.0 + front / 110.0) * smoothstep(0.0, 0.05, age);
    float h = 0.0, d1 = 0.0, d2 = 0.0;
    packet(r, front, sig, k, amp, h, d1, d2);
    // Slower, finer capillary rings trailing inside the main ring.
    packet(r, front * 0.55, sig * 0.7, k * 1.7, amp * 0.42, h, d1, d2);
    // Crater, then the little jet: a short damped bounce at the impact point.
    float cs = 9.0 * size;
    float Bc = A.w * 2.4 * sin(age * TAU / 0.55) * exp(-age * 4.5);
    float Ec = exp(-r * r / (cs * cs));
    h += -Bc * Ec;
    d1 += -Bc * (-2.0 * r / (cs * cs)) * Ec;
    d2 += -Bc * (4.0 * r * r / (cs * cs * cs * cs) - 2.0 / (cs * cs)) * Ec;
    // Keep the centre regular (h'(0) = 0).
    d1 *= smoothstep(0.0, 5.0, r);
    addRadial(s, v, r, h, d1, d2);
    flashSum += B.y * exp(-age * 9.0) * exp(-r * r / (120.0 * size * size));
  }
  return s;
}

// ------------------------------------------------------------ helpers

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

vec2 logoToUv(vec2 p) {
  vec2 px = (p - uCam) * uUnit + 0.5 * uRes;
  return vec2(px.x / uRes.x, 1.0 - px.y / uRes.y);
}

vec3 bedAt(vec2 p) { return toLinear(texture2D(uBackdrop, logoToUv(p)).rgb); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Broken horizontal streaks of distant lights reflected on the river, in
// "sky plane" coordinates (logo units). Periodic in uDrift.
const float SL = 3000.0;
vec3 streaks(vec2 q) {
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    float fj = float(j);
    float y0 = j == 0 ? -170.0 : j == 1 ? 262.0 : j == 2 ? 712.0 : 1160.0;
    float th = j == 1 ? 4.0 : j == 2 ? 6.0 : 8.0;
    float dir = j == 1 ? -1.0 : 1.0;
    float gain = j == 1 ? 0.55 : j == 2 ? 0.7 : 1.0;
    vec3 tint = j == 1 ? vec3(0.75, 0.95, 1.0) : j == 3 ? vec3(1.0, 0.8, 0.6) : vec3(1.0, 0.9, 0.78);
    float x = q.x / SL + uDrift * dir;
    float yy = y0 + 9.0 * sin(TAU * (x * 2.0 + fj * 0.31)) + 4.0 * sin(TAU * (x * 7.0 + fj * 0.53));
    float dy = (q.y - yy) / th;
    float band = exp(-dy * dy);
    if (band < 2e-3) continue;
    // Long soft segments with a slow shimmer: lights smeared across the current.
    float m = 0.5 + 0.5 * cos(TAU * (x * 4.0 + 0.17 * fj));
    float m2 = 0.5 + 0.5 * cos(TAU * (x * 9.0 + 0.41 * fj));
    float m4 = 0.5 + 0.5 * cos(TAU * (x * 2.0 + 0.61 * fj));
    float lights = smoothstep(0.35, 0.95, m) * (0.55 + 0.45 * m2) * smoothstep(0.15, 0.7, m4);
    acc += tint * gain * band * lights;
  }
  return acc;
}

// ------------------------------------------------------------ main

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 p = (px - 0.5 * uRes) / uUnit + uCam;

  Surf s = surface(p, px);
  vec3 N = normalize(vec3(-s.g, 1.0));
  float slope = length(s.g);

  // ---- under the surface: the logo on the riverbed
  vec2 off = -s.g * 30.0;
  vec3 bed = vec3(bedAt(p + off * 0.9).r, bedAt(p + off).g, bedAt(p + off * 1.12).b);

  // Caustic focusing onto the bed.
  float Dc = 34.0;
  float a = 1.0 + Dc * s.H.x, b = Dc * s.H.y, d = 1.0 + Dc * s.H.z;
  float J = a * d - b * b;
  float I = min(1.0 / max(abs(J), 0.16), 6.0);
  float focus = max(I - 1.0, 0.0);

  // Bed light: develops in patches (low-frequency noise), earlier at the pegs.
  float n = vnoise(p / 170.0 + 3.7) * 0.7 + vnoise(p / 61.0 - 1.3) * 0.3;
  float dev = smoothstep(0.0, 1.0, clamp(uBed.x * 1.75 - 0.75 * n, 0.0, 1.0));
  vec2 pc = vec2(p.x < 500.0 ? 95.7 : 904.2, p.y < 500.0 ? 92.0 : 905.1);
  float pd = length(p - pc);
  dev = max(dev, uBed.z * exp(-pd * pd / (95.0 * 95.0)));
  float amb = mix(uBed.w, uBed.y, dev);

  vec3 aqua = uLiquid / max(max(uLiquid.r, uLiquid.g), uLiquid.b);
  vec3 causticTint = mix(vec3(1.0), aqua, 0.55);

  vec3 light = vec3(amb * mix(1.0, I, 0.5));
  // Only real ripples (not the river's slow swell) light the bed enough to see.
  float ripple = smoothstep(0.015, 0.12, slope);
  light += causticTint * (0.9 * smoothstep(0.08, 1.5, focus) * focus + 1.6 * ripple * slope) * mix(1.0, 0.6, dev);
  for (int i = 0; i < 2; i++) {
    vec4 sw = uSweep[i];
    vec2 dv = p - sw.xy;
    light += mix(vec3(1.0), aqua, 0.3) * sw.z * exp(-dot(dv, dv) / (sw.w * sw.w));
  }
  vec3 under = bed * light;

  // ---- reflection: night sky, city-light streaks, lamps
  vec3 R = reflect(vec3(0.0, 0.0, -1.0), N);
  vec3 sky = uBackground;
  // A faint aqua glow low in the sky on one side: ripple flanks facing it catch it.
  // Thresholded so the slow swell stays black and only ripple flanks catch it.
  sky += aqua * 0.35 * smoothstep(0.05, 0.4, dot(R.xy, normalize(vec2(-0.55, -0.83))));
  sky += vec3(0.6, 0.66, 0.7) * 0.14 * smoothstep(0.1, 0.55, dot(R.xy, normalize(vec2(0.8, 0.3))));
  vec2 q = p + R.xy * 140.0;
  sky += streaks(q) * 0.05;

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L1 = normalize(vec3(-0.22, -0.3, 1.0));
  vec3 L2 = normalize(vec3(0.3, 0.06, 1.0));
  float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 2600.0) * 2.4
             + pow(max(dot(N, normalize(L2 + V)), 0.0), 3200.0) * 1.5;
  vec3 glint = mix(vec3(1.0), aqua, 0.25) * spec;

  vec3 col = under + sky + glint;
  // Impact glints.
  col += mix(vec3(1.0), aqua, 0.35) * flashSum * 1.4;

  // Gentle vignette keeps the edges black.
  vec2 vc = (px - 0.5 * uRes) / uRes.y;
  col *= 1.0 - 0.45 * smoothstep(0.45, 1.05, length(vc));

  // Soft-clip highlights.
  col = col / (1.0 + max(col - 0.8, 0.0) * 0.7);
  // Static (per-pixel) dither against banding in the dark gradients.
  gl_FragColor = vec4(toSrgb(col) + (hash(px) - 0.5) / 255.0, 1.0);
}
`;
