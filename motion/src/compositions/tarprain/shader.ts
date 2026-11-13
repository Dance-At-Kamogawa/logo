import { FIELD_ORIGIN, FIELD_SIZE } from "./field";
import { INDEX_WIDTH, TILE } from "./tiles";

/**
 * Fullscreen shader: the blue tarp at night with water on it.
 *
 * Tarp: procedural crinkles/folds (value noise with analytic derivatives +
 * a few packing creases) as a normal map, a fine weave in the albedo, lit by
 * a dim pool of light with a slight plastic sheen. Everything outside the
 * pool falls to the background colour.
 *
 * Water: a 2D signed distance field (logo units) = the wet logo (precomputed
 * distance texture, cut back where its arrival beat is still in the future)
 * smooth-unioned with analytic primitives (beads as round cones, crown rings,
 * crown droplets) binned into 32 px tiles. Distance -> height profile ->
 * normal; shaded like the first Liquid's glass drops: chromatic refraction of
 * the tarp and the light-grey type, Beer-Lambert tint, Fresnel reflection of
 * a procedural studio, sharp glints, caustic, and a small soft shadow.
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
#define FIELD_SIZE ${FIELD_SIZE}
#define FIELD_ORIGIN ${FIELD_ORIGIN.toFixed(1)}

varying vec2 vUv;

uniform highp sampler2D uField;  // (distance, arrival beat, grad x, grad y), 1 texel per logo unit
uniform sampler2D uInk;          // screen space: r = type + grommets, g = hairline frame
uniform vec2 uRes;
uniform float uUnit;
uniform vec2 uCam;
uniform highp sampler2D uPrims;  // 3 texels per primitive: (ax ay bx by) (ra rb h k) (type alpha flash 0)
uniform highp sampler2D uHeads;
uniform highp sampler2D uIndex;
uniform float uFill;             // current beat vs the arrival field
uniform float uFrontS;           // arrival beats -> distance, for the front's rounding
uniform float uInkAmt;
uniform vec3 uText;
uniform vec3 uFrameCol;
uniform vec3 uTarp;
uniform vec3 uLiquid;
uniform vec3 uBackground;
uniform float uLight;            // studio rotation (shimmer)
uniform vec4 uPool;              // light pool: x y radius intensity

// ------------------------------------------------------------ noise

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Value noise with analytic derivatives (value, d/dx, d/dy).
vec3 noised(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
              du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
}
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// ------------------------------------------------------------ studio

float box(vec2 p, vec2 c, vec2 hs, float soft) {
  vec2 d = abs(p - c) - hs;
  float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, o);
}

// The first Liquid's studio: dark room, soft box upper-left, strip lights.
vec3 env(vec3 r) {
  r.xy = rot(r.xy, uLight);
  vec2 o = r.xy / (1.0 + r.z);
  vec3 col = vec3(0.012, 0.016, 0.018);
  col += vec3(0.05, 0.06, 0.065) * smoothstep(0.2, -0.9, o.y);
  col += vec3(1.9) * box(o, vec2(-0.48, -0.55), vec2(0.30, 0.17), 0.10);
  col += vec3(1.3) * box(o, vec2(0.80, -0.08), vec2(0.06, 0.48), 0.05);
  col += vec3(0.75, 0.9, 0.95) * box(o, vec2(-0.6, 0.78), vec2(0.38, 0.05), 0.07);
  col += vec3(0.35) * box(o, vec2(0.30, -0.80), vec2(0.20, 0.04), 0.05);
  col += vec3(2.2) * box(o, vec2(-0.86, -0.1), vec2(0.025, 0.42), 0.02);
  col += vec3(1.6) * box(o, vec2(0.05, -0.9), vec2(0.45, 0.022), 0.02);
  col += vec3(1.2) * box(o, vec2(0.62, 0.62), vec2(0.03, 0.22), 0.02);
  return col;
}

// ------------------------------------------------------------ the tarp

// Packing crease: a soft ridge (sign > 0) or valley along a slightly wavy line.
void crease(vec2 p, bool vertical, float at, float sgn, inout float h, inout vec2 g) {
  float along = vertical ? p.y : p.x;
  float across = vertical ? p.x : p.y;
  float wav = 7.0 * sin(along / 173.0 + at) + 3.0 * sin(along / 61.0 - at * 2.0);
  float dwav = 7.0 / 173.0 * cos(along / 173.0 + at) + 3.0 / 61.0 * cos(along / 61.0 - at * 2.0);
  float x = across - at - wav;
  float e = exp(-x * x / 30.0);
  float amp = sgn * 1.5 * (0.6 + 0.4 * vnoise(vec2(along / 90.0, at)));
  h += amp * e;
  float dx = amp * e * (-2.0 * x / 30.0);
  vec2 gg = vertical ? vec2(dx, -dx * dwav) : vec2(-dx * dwav, dx);
  g += gg;
}

// Elongated soft wrinkle ridges: 1 - (2n - 1)^2 of stretched, rotated noise.
void wrinkle(vec2 p, float ang, vec2 scale, float amp, float off, inout float h, inout vec2 g) {
  vec2 q = rot(p, ang) / scale + off;
  vec3 n = noised(q);
  float m = 2.0 * n.x - 1.0;
  h += amp * (1.0 - m * m);
  vec2 dq = -4.0 * amp * m * n.yz / scale;
  g += rot(dq, -ang);
}

vec3 tarpNormal(vec2 p) {
  float h = 0.0;
  vec2 g = vec2(0.0);
  vec3 n1 = noised(p / 260.0 + 11.3);
  h += 10.0 * n1.x; g += 10.0 * n1.yz / 260.0;
  // Domain warp so the wrinkles bend and branch instead of running in parallel.
  vec3 n0 = noised(p / 340.0 - 4.1);
  vec2 w = p + 120.0 * vec2(n1.x - 0.5, n0.x - 0.5);
  wrinkle(w, 0.35, vec2(95.0, 58.0), 2.6, 3.7, h, g);
  wrinkle(w, 2.1, vec2(70.0, 40.0), 1.5, -5.2, h, g);
  wrinkle(p, -0.8, vec2(36.0, 24.0), 0.35, 9.1, h, g);
  // Crumple creases: sharp ridges (|2n - 1|) that catch the light as thin lines.
  vec3 n4 = noised(rot(w, 1.2) / vec2(170.0, 110.0) + 2.3);
  float m4 = 2.0 * n4.x - 1.0;
  float s4 = m4 / sqrt(m4 * m4 + 0.0004);
  h -= 1.4 * abs(m4);
  g -= 1.4 * s4 * 2.0 * rot(n4.yz / vec2(170.0, 110.0), -1.2);
  crease(p, true, 262.0, 0.55, h, g);
  crease(p, false, 671.0, -0.5, h, g);
  return normalize(vec3(-g * 1.3, 1.0));
}

vec3 tarp(vec2 p) {
  vec2 dp = p - uPool.xy;
  float r2 = dot(dp, dp) / (uPool.z * uPool.z);
  float far = exp(-0.3 * r2);
  if (far < 0.004) return uBackground;
  vec3 N = tarpNormal(p);
  // Weave: tapes in a fine basket pattern, faded out before it aliases.
  float P = 6.5;
  float fade = clamp(P * uUnit / 3.0 - 1.0, 0.0, 1.0);
  vec2 c = floor(p / P);
  float dir = mod(c.x + c.y, 2.0);
  vec2 f = fract(p / P) - 0.5;
  float tape = dir > 0.5 ? f.x : f.y;
  float weave = (0.5 - 2.0 * tape * tape) * fade;
  vec3 albedo = uTarp * (0.9 + 0.2 * weave);
  vec3 L = normalize(vec3(rot(vec2(-0.45, -0.55), 0.4 * uLight), 0.7));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float pool = uPool.w * exp(-r2);
  float lam = clamp(0.55 + 3.0 * (dot(N, L) - L.z), 0.0, 1.8);
  vec3 col = albedo * (0.04 * far + pool * lam);
  // Plastic sheen: a tight highlight on folds facing the lamp + a faint studio reflection.
  float sp = pow(max(dot(N, normalize(L + V)), 0.0), 70.0);
  col += uTarp * vec3(0.7, 0.85, 1.0) * sp * pool * 2.5;
  return mix(uBackground, col, clamp(far * 1.3, 0.0, 1.0));
}

// ------------------------------------------------------------ water field

struct Field { float d; vec2 g; float w; float h; float clear; float flash; float alpha; };

void blend(inout Field f, float d, vec2 g, float w, float h, float clear, float flash, float alpha, float k) {
  k = max(k, 1e-3);
  float m = clamp(0.5 + 0.5 * (d - f.d) / k, 0.0, 1.0); // weight of the accumulated field
  f.d = mix(d, f.d, m) - k * m * (1.0 - m);
  f.g = mix(g, f.g, m);
  f.w = mix(w, f.w, m);
  f.h = mix(h, f.h, m);
  f.clear = mix(clear, f.clear, m);
  f.flash = mix(flash, f.flash, m);
  f.alpha = mix(alpha, f.alpha, m);
}

vec4 fieldTexel(ivec2 i) {
  return texelFetch(uField, clamp(i, ivec2(0), ivec2(FIELD_SIZE - 1)), 0);
}

// Wet logo: distance (units) and gradient, cut back to where water has arrived.
void logoWater(vec2 p, out float d, out vec2 g) {
  vec2 q = p - FIELD_ORIGIN - 0.5;
  if (q.x < -1.0 || q.y < -1.0 || q.x > float(FIELD_SIZE) || q.y > float(FIELD_SIZE)) {
    d = 64.0; g = vec2(0.0, 1.0); return;
  }
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec4 a = fieldTexel(i), b = fieldTexel(i + ivec2(1, 0)), c = fieldTexel(i + ivec2(0, 1)), e = fieldTexel(i + ivec2(1, 1));
  vec4 s = mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
  vec2 gd = length(s.ba) > 1e-4 ? normalize(s.ba) : vec2(0.0, 1.0);
  if (s.r > 14.0) { d = s.r; g = gd; return; }
  // Water lines are slightly beaded: thickness varies along the stroke.
  float dl = s.r + 0.9 * (vnoise(p * 0.12) - 0.5);
  float beyond = clamp((s.g - uFill) * uFrontS, -40.0, 40.0);
  vec2 gA = vec2(mix(b.g - a.g, e.g - c.g, f.y), mix(c.g - a.g, e.g - b.g, f.x));
  vec2 gf = length(gA) > 1e-6 ? normalize(gA) : gd;
  // Smooth max: the front ends round, like a bead stretching along the stroke.
  float k = 3.0;
  float hl = clamp(0.5 - 0.5 * (beyond - dl) / k, 0.0, 1.0); // weight of the stroke distance
  d = mix(beyond, dl, hl) + k * hl * (1.0 - hl);
  g = normalize(mix(gf, gd, hl) + 1e-6);
}

float primDist(vec2 p, vec4 A, vec4 B, float type, out vec2 g, out float rr) {
  if (type > 0.5) {
    vec2 v = p - A.xy;
    float l = max(length(v), 1e-4);
    float s = l >= B.x ? 1.0 : -1.0;
    g = s * v / l;
    rr = B.y;
    return abs(l - B.x) - B.y;
  }
  vec2 a = A.xy, b = A.zw;
  vec2 pa = p - a, ba = b - a;
  float bb = dot(ba, ba);
  float h = bb > 1e-4 ? clamp(dot(pa, ba) / bb, 0.0, 1.0) : 0.0;
  vec2 q = pa - ba * h;
  float len = length(q);
  rr = mix(B.x, B.y, h);
  float d = len - rr;
  vec2 pb = p - b;
  float lb = length(pb);
  if (lb - B.y < d) { d = lb - B.y; q = pb; len = lb; rr = B.y; }
  float la = length(pa);
  if (la - B.x < d) { d = la - B.x; q = pa; len = la; rr = B.x; }
  g = len > 1e-4 ? q / len : vec2(0.0, 1.0);
  return d;
}

// Light comes from the upper left: shadows fall lower right, scaled by height.
const vec2 SHADOW = vec2(0.32, 0.42);

Field scene(vec2 p, vec2 px, out float shadowD) {
  Field f;
  float dl; vec2 gl;
  logoWater(p, dl, gl);
  f = Field(dl, gl, 7.5, 5.0, 0.9, 0.0, 1.0);
  float dls; vec2 gls;
  logoWater(p - SHADOW * 4.0, dls, gls);
  shadowD = dls;

  vec4 head = texelFetch(uHeads, ivec2(px) / TILE, 0);
  int offset = int(head.x + 0.5);
  int count = int(head.y + 0.5);
  for (int n = 0; n < 1024; n++) {
    if (n >= count) break;
    int e = offset + n;
    int i = int(texelFetch(uIndex, ivec2(e % INDEX_WIDTH, e / INDEX_WIDTH), 0).x + 0.5);
    vec4 A = texelFetch(uPrims, ivec2(0, i), 0);
    vec4 B = texelFetch(uPrims, ivec2(1, i), 0);
    vec4 C = texelFetch(uPrims, ivec2(2, i), 0);
    vec2 g; float rr;
    float d = primDist(p, A, B, C.x, g, rr);
    vec2 gs; float rs;
    float ds = primDist(p - SHADOW * B.z, A, B, C.x, gs, rs);
    shadowD = min(shadowD, ds + (1.0 - C.y) * 6.0);
    if (d - B.w >= f.d) continue;
    float w = max(rr, 0.4);
    float local = rr / max(max(B.x, B.y), 1e-3);
    blend(f, d, g, w, max(B.z * (C.x > 0.5 ? 1.0 : local), 0.3), 1.0, C.z, C.y, B.w);
  }
  return f;
}

// ------------------------------------------------------------ shading

vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

vec2 logoToUv(vec2 p) {
  vec2 px = (p - uCam) * uUnit + 0.5 * uRes;
  return vec2(px.x / uRes.x, 1.0 - px.y / uRes.y);
}

vec2 ink(vec2 p) { return texture2D(uInk, logoToUv(p)).rg; }

vec3 inked(vec3 under, vec2 k) {
  under = mix(under, uFrameCol, k.g * uInkAmt);
  return mix(under, uText, k.r * uInkAmt);
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 p = (px - 0.5 * uRes) / uUnit + uCam;
  float pix = 1.0 / uUnit;

  float shadowD;
  Field f = scene(p, px, shadowD);
  vec3 base = tarp(p);
  float shadow = 1.0 - 0.62 * (1.0 - smoothstep(-2.5, 3.5, shadowD));
  vec3 dry = base * shadow;

  float aa = pix * 0.85;
  float cover = clamp(0.5 - f.d / (2.0 * aa), 0.0, 1.0) * f.alpha;
  if (cover <= 0.0) {
    gl_FragColor = vec4(toSrgb(dry), 1.0);
    return;
  }

  // Height profile: round edge of width w, flat top at h.
  float y = max(-f.d, 0.0) / f.w;
  float x = clamp(y, 0.0, 1.0);
  float circ = sqrt(max(1.0 - (1.0 - x) * (1.0 - x), 0.0));
  float dcirc = x < 1.0 ? min((1.0 - x) / max(circ, 0.04), 25.0) : 0.0;
  float height = f.h * circ;
  vec2 gh = -f.h * dcirc / f.w * f.g;

  vec3 N = normalize(vec3(-gh, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 I = -V;

  // Chromatic refraction of the tarp and the type below.
  float thick = height + 2.5;
  float depth = thick * mix(2.0, 0.9, f.clear);
  vec3 tr = refract(I, N, 1.0 / 1.325);
  vec3 tg = refract(I, N, 1.0 / 1.333);
  vec3 tb = refract(I, N, 1.0 / 1.345);
  vec2 og = tg.xy / max(-tg.z, 0.2) * depth;
  vec3 under = tarp(p + og);
  vec2 kr = ink(p + tr.xy / max(-tr.z, 0.2) * depth);
  vec2 kg = ink(p + og);
  vec2 kb = ink(p + tb.xy / max(-tb.z, 0.2) * depth);
  vec3 refr = vec3(inked(under, kr).r, inked(under, kg).g, inked(under, kb).b);

  // Absorption + in-scatter tinted by the liquid colour.
  vec3 sigma = (vec3(1.0) - uLiquid) * mix(0.010, 0.006, f.clear) + 0.0012;
  vec3 trans = exp(-sigma * thick * 1.6);
  float scatterAmt = 1.0 - exp(-thick * 0.03);
  vec3 L1 = normalize(vec3(rot(vec2(-0.5, -0.62), uLight), 0.6));
  float lit = 0.6 + 0.4 * dot(N, L1);
  float lum = dot(uLiquid, vec3(0.2126, 0.7152, 0.0722));
  vec3 milk = mix(vec3(lum), uLiquid, 0.55);
  vec3 body = refr * trans + mix(milk, uLiquid, 0.5) * scatterAmt * 0.008 * lit;

  // Caustic: light focused through the water pools on the side away from the light.
  float edge = 1.0 - N.z;
  vec2 nd = length(N.xy) > 1e-4 ? normalize(N.xy) : vec2(0.0);
  float away = max(dot(nd, -normalize(L1.xy)), 0.0);
  float caustic = pow(away, 2.5) * smoothstep(0.02, 0.3, edge) * (1.0 - smoothstep(0.6, 0.97, edge));
  body += mix(milk, uLiquid, 0.6) * caustic * 0.55;

  // Reflection + glints.
  float cosT = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 refl = env(reflect(I, N));
  vec3 H1 = normalize(L1 + V);
  vec3 L2 = normalize(vec3(rot(vec2(0.72, -0.1), uLight), 0.68));
  vec3 H2 = normalize(L2 + V);
  float spec = pow(max(dot(N, H1), 0.0), 260.0) * 3.0 + pow(max(dot(N, H2), 0.0), 520.0) * 2.0;

  vec3 col = mix(body, refl, F) + vec3(spec);
  col += vec3(0.6, 0.75, 0.78) * 0.03 * smoothstep(0.0, 0.08, edge);
  col += vec3(0.9, 1.0, 1.0) * f.flash * (0.2 + 0.7 * edge);
  col = col / (1.0 + max(col - 0.85, 0.0) * 0.6);

  vec3 outc = mix(dry, col, cover);
  gl_FragColor = vec4(toSrgb(outc), 1.0);
}
`;
