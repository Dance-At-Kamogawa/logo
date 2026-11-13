import { INDEX_WIDTH, TILE } from "./tiles";

/**
 * Fullscreen window-glass shader.
 *
 * Per pixel (logo space, y down):
 *   1. condensation density: seeded fbm, minus the wiped trails (capsule
 *      segments with ages, so they can re-fog), minus the evaporation that
 *      spreads from the four pegs, minus a dry ring around each big bead;
 *   2. through the condensation: the blurred backdrop, a milky in-scatter lit
 *      by the lights behind, and a micro-droplet texture (tiny lenses that
 *      catch the light);
 *   3. glass droplets: the big beads/runners (smooth-unioned round cones, so
 *      merging beads neck together) and two procedural cellular bead layers.
 *      They are shaded like the first Liquid's clear drops: chromatic
 *      refraction of the sharp backdrop (strong enough to give each drop the
 *      inverted mini image of the night behind), Fresnel reflection of a
 *      procedural studio environment, sharp glints, an aqua caustic.
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

varying vec2 vUv;

uniform sampler2D uSharp;
uniform sampler2D uBlur;
uniform vec2 uRes;              // composition size, px
uniform float uUnit;            // px per logo unit
uniform vec2 uCam;              // logo point at the canvas centre
uniform highp sampler2D uBeads;      // 2 texels per bead: (ax ay bx by) (ra rb k 0)
uniform highp sampler2D uBeadHeads;  // per tile: (offset, count)
uniform highp sampler2D uBeadIndex;
uniform highp sampler2D uTrails;     // 2 texels per segment: (ax ay bx by) (wa wb agea ageb)
uniform highp sampler2D uTrailHeads;
uniform highp sampler2D uTrailIndex;
uniform vec4 uFog;              // density, refog hold, refog duration, fade
uniform vec4 uReveal;           // progress, margin, reach, 0
uniform vec4 uLayers;           // small, medium, micro, 0
uniform vec2 uDrift;
uniform vec2 uPegs[4];
uniform vec3 uLiquid;           // linear rgb
uniform vec3 uFogTint;          // linear rgb

// ------------------------------------------------------------ utils

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 7.3) + 0.15 * vnoise(p * 4.1 - 3.1);
}

vec2 logoToUv(vec2 p) {
  vec2 px = (p - uCam) * uUnit + 0.5 * uRes;
  return vec2(px.x / uRes.x, 1.0 - px.y / uRes.y);
}
vec3 sharpAt(vec2 p) { return toLinear(texture2D(uSharp, logoToUv(p)).rgb); }
vec3 blurAt(vec2 p) { return toLinear(texture2D(uBlur, logoToUv(p)).rgb); }

// ------------------------------------------------------------ droplet field

struct Field { float d; vec2 g; float w; float h; };

void blend(inout Field f, float d, vec2 g, float w, float h, float k) {
  k = max(k, 1e-3);
  float m = clamp(0.5 + 0.5 * (d - f.d) / k, 0.0, 1.0); // weight of the accumulated field
  f.d = mix(d, f.d, m) - k * m * (1.0 - m);
  f.g = mix(g, f.g, m);
  f.w = mix(w, f.w, m);
  f.h = mix(h, f.h, m);
}

Field beadField(vec2 p, vec2 px) {
  Field f = Field(1e5, vec2(0.0, 1.0), 1.0, 1.0);
  vec4 head = texelFetch(uBeadHeads, ivec2(px) / TILE, 0);
  int offset = int(head.x + 0.5);
  int count = int(head.y + 0.5);
  for (int n = 0; n < 2048; n++) {
    if (n >= count) break;
    int e = offset + n;
    int i = int(texelFetch(uBeadIndex, ivec2(e % INDEX_WIDTH, e / INDEX_WIDTH), 0).x + 0.5);
    vec4 A = texelFetch(uBeads, ivec2(0, i), 0);
    vec4 B = texelFetch(uBeads, ivec2(1, i), 0);
    vec2 a = A.xy, b = A.zw;
    vec2 pa = p - a, ba = b - a;
    float bb = dot(ba, ba);
    float h = bb > 1e-4 ? clamp(dot(pa, ba) / bb, 0.0, 1.0) : 0.0;
    vec2 q = pa - ba * h;
    float len = length(q);
    float rr = mix(B.x, B.y, h);
    float d = len - rr;
    // The linear-radius cone undercuts its end caps; union in full spheres there.
    vec2 pb = p - b;
    float lb = length(pb);
    float rcone = rr;
    if (lb - B.y < d) { d = lb - B.y; q = pb; len = lb; }
    float la = length(pa);
    if (la - B.x < d) { d = la - B.x; q = pa; len = la; }
    rr = max(rcone, max(B.y * smoothstep(1.0, 0.8, lb / max(B.y, 1e-3)), B.x * smoothstep(1.0, 0.8, la / max(B.x, 1e-3))));
    // Exact reject: beyond the blend radius the smooth union is a no-op.
    if (d - B.z >= f.d) continue;
    vec2 g = len > 1e-4 ? q / len : vec2(0.0, 1.0);
    blend(f, d, g, max(rr, 0.5), max(0.62 * rr, 0.4), B.z);
  }
  return f;
}

// One procedural bead per cell (fits inside its cell, so no neighbour search).
void layerBead(vec2 p, float C, float rmax, float presence, float grow, float seed, mat2 rot, inout Field f) {
  vec2 q = rot * p / C + seed;
  vec2 id = floor(q);
  if (hash12(id + seed * 7.13) > presence) return;
  vec2 c = id + 0.5 + (hash22(id + seed * 3.7) - 0.5) * 0.48;
  float r = rmax * (0.3 + 0.7 * hash12(id * 1.37 + seed)) * grow;
  if (r <= 0.004) return;
  vec2 v = q - c;
  float len = length(v);
  float d = (len - r) * C;
  if (d < f.d) {
    f.d = d;
    // Back to logo space (rot is orthonormal).
    f.g = len > 1e-5 ? (v / len) * rot : vec2(0.0, 1.0);
    f.w = r * C;
    f.h = 0.6 * r * C;
  }
}

// ------------------------------------------------------------ trails & evaporation

float trailClear(vec2 p, vec2 px, float wobble, out float rim) {
  float clear = 0.0;
  rim = 0.0;
  vec4 head = texelFetch(uTrailHeads, ivec2(px) / TILE, 0);
  int offset = int(head.x + 0.5);
  int count = int(head.y + 0.5);
  for (int n = 0; n < 4096; n++) {
    if (n >= count) break;
    int e = offset + n;
    int i = int(texelFetch(uTrailIndex, ivec2(e % INDEX_WIDTH, e / INDEX_WIDTH), 0).x + 0.5);
    vec4 A = texelFetch(uTrails, ivec2(0, i), 0);
    vec4 B = texelFetch(uTrails, ivec2(1, i), 0);
    vec2 pa = p - A.xy, ba = A.zw - A.xy;
    float bb = dot(ba, ba);
    float h = bb > 1e-4 ? clamp(dot(pa, ba) / bb, 0.0, 1.0) : 0.0;
    float w = mix(B.x, B.y, h);
    float dist = length(pa - ba * h) + wobble * w;
    float age = mix(B.z, B.w, h);
    float rf = clamp((age - uFog.y) / uFog.z, 0.0, 1.0);
    float keep = 1.0 - rf * rf * (3.0 - 2.0 * rf);
    float c = 1.0 - smoothstep(w * 0.6, w, dist);
    clear = max(clear, c * keep);
    // The condensate swept aside piles up along the trail's edges.
    rim = max(rim, (smoothstep(w * 1.45, w * 1.0, dist) - c) * keep);
  }
  return clear;
}

float revealClear(vec2 p, float n, out float front) {
  front = 0.0;
  float discs = 0.0;
  if (uReveal.x > 0.0) {
    float R = uReveal.x * uReveal.z;
    for (int i = 0; i < 4; i++) {
      float dd = length(p - uPegs[i]) + (n - 0.5) * 130.0;
      discs = max(discs, smoothstep(R, R - 130.0, dd));
    }
  }
  vec2 q = abs(p - 500.0) - vec2(493.0 + uReveal.y - 120.0);
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 120.0;
  float inside = smoothstep(60.0, -60.0, box + (n - 0.5) * 220.0);
  front = discs * (1.0 - discs) * 4.0 * inside;
  return discs * inside;
}

// ------------------------------------------------------------ shading

float box(vec2 p, vec2 c, vec2 hs, float soft) {
  vec2 d = abs(p - c) - hs;
  float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, o);
}

// The first Liquid's procedural studio (soft box, strip lights), dimmed: a
// dark room behind the viewer. r: reflection direction (x right, y down, z to viewer).
vec3 env(vec3 r) {
  vec2 o = r.xy / (1.0 + r.z);
  vec3 col = vec3(0.008, 0.011, 0.013);
  col += vec3(0.035, 0.045, 0.05) * smoothstep(0.2, -0.9, o.y);
  col += vec3(1.5) * box(o, vec2(-0.48, -0.55), vec2(0.30, 0.17), 0.10);
  col += vec3(0.9) * box(o, vec2(0.80, -0.08), vec2(0.06, 0.48), 0.05);
  col += vec3(0.55, 0.75, 0.8) * box(o, vec2(-0.6, 0.78), vec2(0.38, 0.05), 0.07);
  col += vec3(2.0) * box(o, vec2(-0.86, -0.1), vec2(0.025, 0.42), 0.02);
  col += vec3(1.4) * box(o, vec2(0.05, -0.9), vec2(0.45, 0.022), 0.02);
  col += vec3(1.0) * box(o, vec2(0.62, 0.62), vec2(0.03, 0.22), 0.02);
  return col;
}

const float DEPTH = 640.0; // glass -> scene behind it (logo units): sets the drops' inverted images

vec3 shadeDrop(Field f, vec2 p, float pix, float glow, out float cover) {
  float aa = pix * 0.9;
  cover = clamp(0.5 - f.d / (2.0 * aa), 0.0, 1.0);
  float y = max(-f.d, 0.0) / f.w;
  float x = clamp(y, 0.0, 1.0);
  float circ = sqrt(max(1.0 - (1.0 - x) * (1.0 - x), 0.0));
  float dcirc = x < 1.0 ? min((1.0 - x) / max(circ, 0.04), 25.0) : 0.0;
  float height = f.h * circ;
  vec2 gh = -f.h * dcirc / f.w * f.g;
  vec3 N = normalize(vec3(-gh, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 I = -V;

  // Refraction onto the scene behind the glass (chromatic): a little lens
  // that turns the night upside down.
  vec3 tr = refract(I, N, 1.0 / 1.325);
  vec3 tg = refract(I, N, 1.0 / 1.333);
  vec3 tb = refract(I, N, 1.0 / 1.345);
  vec2 sR = p + tr.xy / max(-tr.z, 0.25) * DEPTH;
  vec2 sG = p + tg.xy / max(-tg.z, 0.25) * DEPTH;
  vec2 sB = p + tb.xy / max(-tb.z, 0.25) * DEPTH;
  vec3 refr = vec3(sharpAt(sR).r, sharpAt(sG).g, sharpAt(sB).b);
  float edge = 1.0 - N.z;
  // Towards the rim the lens looks far off-axis: the image smears (and the
  // samples would alias), so fade to the blurred scene there.
  float smear = smoothstep(0.15, 0.6, edge);
  if (smear > 0.0) refr = mix(refr, vec3(blurAt(sR).r, blurAt(sG).g, blurAt(sB).b), smear);
  vec3 tint = mix(vec3(1.0), uLiquid, 0.3);
  vec3 body = refr * tint * mix(1.0, 0.3, smoothstep(0.2, 0.75, edge));

  // Caustic: light focused through the drop pools on the side away from the light.
  vec3 L1 = normalize(vec3(-0.5, -0.62, 0.6));
  vec2 nd = length(N.xy) > 1e-4 ? normalize(N.xy) : vec2(0.0);
  float away = max(dot(nd, -L1.xy / length(L1.xy)), 0.0);
  float caustic = pow(away, 2.5) * smoothstep(0.02, 0.3, edge) * (1.0 - smoothstep(0.6, 0.97, edge));
  body += uLiquid * caustic * (0.12 + 1.8 * glow);
  body += uLiquid * 0.025 * (1.0 - edge) * height / max(f.h, 1e-3);

  float cosT = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 refl = env(reflect(I, N)) * 1.5;
  vec3 H1 = normalize(L1 + V);
  vec3 L2 = normalize(vec3(0.72, -0.1, 0.68));
  vec3 H2 = normalize(L2 + V);
  float spec = pow(max(dot(N, H1), 0.0), 260.0) * 3.0 + pow(max(dot(N, H2), 0.0), 520.0) * 2.0;
  vec3 col = mix(body, refl, F) + vec3(spec);
  col += vec3(0.5, 0.65, 0.7) * 0.02 * smoothstep(0.0, 0.08, edge);
  return col;
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 p = (px - 0.5 * uRes) / uUnit + uCam;
  float pix = 1.0 / uUnit;

  vec3 sharp = sharpAt(p);
  vec3 blur = blurAt(p);
  float L = luma(blur);

  // --- condensation density
  float n1 = vnoise(p * 0.011 + uDrift * 3.0 + 3.1) * 0.6 + vnoise(p * 0.033 - uDrift * 2.0) * 0.4;
  // Thickness varies (brightness, droplet size); coverage is opaque.
  float thick = 0.4 + 1.2 * fbm(p / 210.0 + uDrift);
  float density = clamp(uFog.x, 0.0, 1.0);
  float rim;
  float tclear = trailClear(p, px, (vnoise(p * 0.09) - 0.5) * 0.4, rim);
  float front;
  float rclear = revealClear(p, n1, front);
  Field f = beadField(p, px);
  float halo = f.d < 1e4 ? (1.0 - smoothstep(0.0, 0.85 * f.w, f.d)) : 0.0;
  float fogLocal = density * (1.0 - tclear) * (1.0 - rclear);
  float fog = fogLocal * (1.0 - 0.92 * halo);

  // --- through the condensation: blurred night, milky in-scatter, micro-droplets
  vec3 haze = blur * 0.8 + uFogTint * (0.022 + 1.1 * L) * thick;
  haze += uFogTint * rim * (0.012 + 0.9 * L) * 0.6;
  haze += uFogTint * front * (0.01 + 0.6 * L) * 0.5;
  float micro = uLayers.z;
  if (micro > 0.0 && fog > 0.02) {
    for (int k = 0; k < 2; k++) {
      float C = k == 0 ? 6.5 : 3.6;
      vec2 q = p / C + float(k) * 17.3;
      vec2 id = floor(q);
      vec2 c = id + 0.5 + (hash22(id) - 0.5) * 0.45;
      float r = k == 0 ? 0.16 + 0.2 * hash12(id + 4.1) : 0.24 + 0.2 * hash12(id + 4.1);
      float len = length(q - c);
      float a = pix / C;
      float inside = smoothstep(r + a, r - a, len);
      vec2 nv = (q - c) / r;
      float spark = inside * smoothstep(0.75, 0.0, length(nv - vec2(-0.3, -0.38)));
      float dark = inside * smoothstep(0.35, 1.0, length(nv));
      float s = k == 0 ? 0.9 : 0.45;
      haze *= 1.0 - 0.32 * dark * micro * s;
      haze += (blur * 1.3 + uFogTint * 0.004) * spark * micro * s;
    }
  }
  vec3 col = mix(sharp, haze, fog);

  // --- procedural bead layers, where the glass is still fogged
  float lg = smoothstep(0.3, 0.85, fogLocal) * (1.0 - halo);
  if (lg > 0.01) {
    layerBead(p, 22.0, 0.2, 0.6, uLayers.x * lg * (0.7 + 0.3 * thick), 1.3, mat2(0.878, 0.479, -0.479, 0.878), f);
    layerBead(p, 74.0, 0.2, 0.2, uLayers.y * lg, 5.9, mat2(0.955, -0.296, 0.296, 0.955), f);
  }

  if (f.d < 2.0 * pix) {
    float cover;
    vec3 drop = shadeDrop(f, p, pix, L, cover);
    col = mix(col, drop, cover);
  }

  // Soft-clip highlights, gentle vignette, fade from black.
  col = col / (1.0 + max(col - 0.85, 0.0) * 0.6);
  vec2 vq = (px / uRes - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col *= 1.0 - 0.22 * smoothstep(0.45, 1.05, length(vq));
  col *= uFog.w;
  gl_FragColor = vec4(toSrgb(col), 1.0);
}
`;
