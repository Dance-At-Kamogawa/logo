import { HARMONICS } from "./scene";
import { INDEX_WIDTH, TILE } from "./tiles";

/**
 * Fullscreen liquid shader.
 *
 * The scene is a 2D signed distance field (logo units) of smooth-unioned
 * primitives, carried together with an analytic gradient and per-primitive
 * material attributes. Distance -> height profile (rounded edge, flat top,
 * raised rim) -> surface normal. The surface is then shaded as thick water:
 * chromatic refraction of the backdrop (logo + frame drawn on a canvas),
 * Beer-Lambert absorption/scatter tinted by `uLiquid`, Fresnel reflection of
 * a procedural studio environment (soft boxes / strip lights), sharp
 * specular glints and a caustic glow on the shadow side.
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
#define HARMONICS ${HARMONICS}

varying vec2 vUv;

uniform sampler2D uBackdrop;
uniform vec2 uRes;          // composition size, px
uniform float uUnit;        // px per logo unit
uniform vec2 uCam;          // logo point at the canvas centre
uniform highp sampler2D uPrims; // 3 texels per primitive: (ax ay bx by) (ra rb w h) (k clear soft alpha)
uniform highp sampler2D uHeads; // per 32px tile: (offset, count)
uniform highp sampler2D uIndex; // primitive indices
uniform vec4 uBlob;         // cx cy r0 enabled
uniform vec4 uBlobShape;    // sx sy w h
uniform float uBlobRim;
uniform float uBlobClear;
uniform vec2 uHarm[HARMONICS];
uniform vec2 uRipple[2];    // amp, front
uniform vec3 uLiquid;       // linear rgb
uniform vec2 uNoise;        // drift of the interior smoke (periodic in loop phase)

// ------------------------------------------------------------ field

struct Field { float d; vec2 g; float w; float h; float rim; float clear; float soft; float alpha; };

void blend(inout Field f, float d, vec2 g, float w, float h, float clear, float soft, float alpha, float k) {
  k = max(k, 1e-3);
  float m = clamp(0.5 + 0.5 * (d - f.d) / k, 0.0, 1.0); // weight of the accumulated field
  f.d = mix(d, f.d, m) - k * m * (1.0 - m);
  f.g = mix(g, f.g, m);
  f.w = mix(w, f.w, m);
  f.h = mix(h, f.h, m);
  f.rim = mix(0.0, f.rim, m);
  f.clear = mix(clear, f.clear, m);
  f.soft = mix(soft, f.soft, m);
  f.alpha = mix(alpha, f.alpha, m);
}

void blobField(vec2 p, out float d, out vec2 g) {
  vec2 v = p - uBlob.xy;
  float r = max(length(v), 1e-3);
  float t = atan(v.y, v.x);
  float c = cos(t), s = sin(t);
  float sx = uBlobShape.x, sy = uBlobShape.y;
  float q = c * c / (sx * sx) + s * s / (sy * sy);
  float ell = inversesqrt(q);
  float dell = -pow(q, -1.5) * c * s * (1.0 / (sy * sy) - 1.0 / (sx * sx));
  float R = uBlob.z * ell;
  float dR = uBlob.z * dell;
  // Harmonics only shape the outline: fade them out towards the centre so the
  // deep interior has no angular structure.
  float reach = smoothstep(0.35 * uBlob.z, 0.85 * uBlob.z, r);
  for (int i = 0; i < HARMONICS; i++) {
    float k = float(i + 2);
    vec2 hm = uHarm[i];
    R += reach * hm.x * cos(k * t + hm.y);
    dR -= reach * hm.x * k * sin(k * t + hm.y);
  }
  vec2 rh = v / r;
  vec2 th = vec2(-rh.y, rh.x);
  // The polar-perturbation correction is only meaningful near the boundary;
  // clamping r keeps the deep interior (and the centre) free of artefacts.
  float slope = dR / max(r, 0.6 * abs(R) + 1.0);
  float norm = inversesqrt(1.0 + slope * slope);
  d = (r - R) * norm;
  g = normalize(rh - slope * th);
}

Field scene(vec2 p, vec2 px) {
  Field f = Field(1e5, vec2(0.0, 1.0), 1.0, 1.0, 0.0, 1.0, 0.0, 1.0);
  if (uBlob.w > 0.5 && uBlob.z > 0.5) {
    float d; vec2 g;
    blobField(p, d, g);
    f = Field(d, g, uBlobShape.z, uBlobShape.w, uBlobRim, uBlobClear, 0.0, 1.0);
  }
  vec4 head = texelFetch(uHeads, ivec2(px) / TILE, 0);
  int offset = int(head.x + 0.5);
  int count = int(head.y + 0.5);
  for (int n = 0; n < 4096; n++) {
    if (n >= count) break;
    int e = offset + n;
    int i = int(texelFetch(uIndex, ivec2(e % INDEX_WIDTH, e / INDEX_WIDTH), 0).x + 0.5);
    vec4 A = texelFetch(uPrims, ivec2(0, i), 0);
    vec4 B = texelFetch(uPrims, ivec2(1, i), 0);
    vec4 C = texelFetch(uPrims, ivec2(2, i), 0);
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
    vec2 pa2 = p - a;
    float la = length(pa2);
    if (la - B.x < d) { d = la - B.x; q = pa2; len = la; }
    // Profile radius: the cone's, grown smoothly to the cap's inside each cap.
    rr = max(rcone, max(B.y * smoothstep(1.0, 0.8, lb / max(B.y, 1e-3)), B.x * smoothstep(1.0, 0.8, la / max(B.x, 1e-3))));
    // Exact reject: beyond the blend radius the smooth union is a no-op.
    if (d - C.x >= f.d) continue;
    vec2 g = len > 1e-4 ? q / len : vec2(0.0, 1.0);
    // Cones are round tubes: edge profile and height follow the local radius.
    float local = rr / max(max(B.x, B.y), 1e-3);
    blend(f, d, g, max(B.z * local, 0.5), max(B.w * local, 0.5), C.y, C.z, C.w, C.x);
  }
  return f;
}

// ------------------------------------------------------------ shading

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

vec2 logoToUv(vec2 p) {
  vec2 px = (p - uCam) * uUnit + 0.5 * uRes;
  return vec2(px.x / uRes.x, 1.0 - px.y / uRes.y);
}

vec3 backdrop(vec2 p) {
  return toLinear(texture2D(uBackdrop, logoToUv(p)).rgb);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float smoke(vec2 p) {
  return 0.6 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 7.3) + 0.1 * vnoise(p * 4.3 - 3.1);
}

float box(vec2 p, vec2 c, vec2 hs, float soft) {
  vec2 d = abs(p - c) - hs;
  float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, o);
}

// Procedural studio: dark room, a big soft box upper-left, a strip light on
// the right, a low rim light bottom-left and a faint ceiling gradient.
// r: reflection direction, logo space (x right, y down, z toward viewer).
vec3 env(vec3 r) {
  vec2 o = r.xy / (1.0 + r.z); // stereographic-ish projection of the hemisphere
  vec3 col = vec3(0.012, 0.016, 0.018);
  col += vec3(0.05, 0.06, 0.065) * smoothstep(0.2, -0.9, o.y);
  col += vec3(1.9) * box(o, vec2(-0.48, -0.55), vec2(0.30, 0.17), 0.10);
  col += vec3(1.3) * box(o, vec2(0.80, -0.08), vec2(0.06, 0.48), 0.05);
  col += vec3(0.75, 0.9, 0.95) * box(o, vec2(-0.6, 0.78), vec2(0.38, 0.05), 0.07);
  col += vec3(0.35) * box(o, vec2(0.30, -0.80), vec2(0.20, 0.04), 0.05);
  // Thin strip lights: the long white streaks along the flyer's rims.
  col += vec3(2.2) * box(o, vec2(-0.86, -0.1), vec2(0.025, 0.42), 0.02);
  col += vec3(1.6) * box(o, vec2(0.05, -0.9), vec2(0.45, 0.022), 0.02);
  col += vec3(1.2) * box(o, vec2(0.62, 0.62), vec2(0.03, 0.22), 0.02);
  return col;
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 p = (px - 0.5 * uRes) / uUnit + uCam;
  float pix = 1.0 / uUnit; // one pixel in logo units

  vec3 base = backdrop(p);
  Field f = scene(p, px);

  float aa = pix * (0.85 + f.soft);
  float cover = clamp(0.5 - f.d / (2.0 * aa), 0.0, 1.0) * f.alpha;
  if (cover <= 0.0) {
    gl_FragColor = vec4(toSrgb(base), 1.0);
    return;
  }

  // Height profile: rounded edge of width w, flat top at h, raised rim.
  float y = max(-f.d, 0.0) / f.w;
  float x = clamp(y, 0.0, 1.0);
  float circ = sqrt(max(1.0 - (1.0 - x) * (1.0 - x), 0.0));
  float dcirc = x < 1.0 ? min((1.0 - x) / max(circ, 0.04), 25.0) : 0.0;
  float bz = (y - 0.6) / 0.32;
  float bump = exp(-bz * bz);
  float dbump = -2.0 * bz / 0.32 * bump;
  float height = f.h * (circ + f.rim * bump);
  float dhdy = f.h * (dcirc + f.rim * dbump);
  // y = -d / w  ->  grad(height) = -dhdy / w * grad(d)
  vec2 gh = -dhdy / f.w * f.g;

  // Beat ripples on the puddle (rings travelling out from its centre).
  if (uBlob.w > 0.5) {
    vec2 v = p - uBlob.xy;
    float r = length(v);
    float inner = smoothstep(0.0, 1.0, y - 1.2);
    for (int i = 0; i < 2; i++) {
      vec2 rp = uRipple[i];
      float z = (r - rp.y) / 55.0;
      float env = exp(-z * z);
      float ph = (r - rp.y) * 0.075;
      float hr = rp.x * env * cos(ph);
      float dhr = rp.x * (env * -sin(ph) * 0.075 + cos(ph) * env * (-2.0 * z / 55.0));
      height += hr * inner;
      gh += dhr * inner * (r > 1e-3 ? v / r : vec2(0.0));
    }
  }

  vec3 N = normalize(vec3(-gh, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 I = -V;

  // Refraction through the liquid onto the backdrop plane (chromatic).
  float thick = height + 6.0;
  vec3 tr = refract(I, N, 1.0 / 1.325);
  vec3 tg = refract(I, N, 1.0 / 1.333);
  vec3 tb = refract(I, N, 1.0 / 1.345);
  float depth = thick * mix(2.2, 0.75, f.clear);
  vec3 refr = vec3(
    backdrop(p + tr.xy / max(-tr.z, 0.2) * depth).r,
    backdrop(p + tg.xy / max(-tg.z, 0.2) * depth).g,
    backdrop(p + tb.xy / max(-tb.z, 0.2) * depth).b
  );

  // Absorption + in-scatter (Beer-Lambert), tinted by the liquid colour.
  // Body water is milky grey-aqua; drops are clear glass with a tinted core.
  float clear = f.clear;
  vec3 sigma = (vec3(1.0) - uLiquid) * mix(0.010, 0.006, clear) + 0.0012;
  vec3 trans = exp(-sigma * thick * 1.6);
  float scatterAmt = 1.0 - exp(-thick * 0.02);
  vec3 L1 = normalize(vec3(-0.5, -0.62, 0.6));
  float lit = 0.6 + 0.4 * dot(N, L1);
  float lum = dot(uLiquid, vec3(0.2126, 0.7152, 0.0722));
  vec3 milk = mix(vec3(lum), uLiquid, 0.55);
  // Smoky interior: darker deep inside, brighter towards the rim, slow noise.
  float deep = smoothstep(1.0, 4.5, y);
  float sm = smoke((p - uBlob.xy) / 260.0 + uNoise);
  float shade = mix(1.12, 0.62, deep) * (0.78 + 0.44 * sm);
  vec3 body = refr * trans + milk * scatterAmt * 0.62 * lit * shade * (1.0 - 0.62 * clear);

  // Caustic: light focused through the body pools on the side away from the light.
  float edge = 1.0 - N.z;
  vec2 nd = length(N.xy) > 1e-4 ? normalize(N.xy) : vec2(0.0);
  float away = max(dot(nd, -L1.xy / length(L1.xy)), 0.0);
  float caustic = pow(away, 2.5) * smoothstep(0.02, 0.3, edge) * (1.0 - smoothstep(0.6, 0.97, edge));
  body += mix(milk, uLiquid, 0.6) * caustic * mix(0.7, 1.5, clear);

  // Reflection.
  float cosT = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 R = reflect(I, N);
  vec3 refl = env(R);

  // Sharp glints.
  vec3 H1 = normalize(L1 + V);
  vec3 L2 = normalize(vec3(0.72, -0.1, 0.68));
  vec3 H2 = normalize(L2 + V);
  float spec = pow(max(dot(N, H1), 0.0), 260.0) * 3.0 + pow(max(dot(N, H2), 0.0), 520.0) * 2.0;

  vec3 col = mix(body, refl, F) + vec3(spec);
  // Gloss sheen on gently curved areas (keeps flat water from looking dead).
  col += vec3(0.6, 0.75, 0.78) * 0.03 * smoothstep(0.0, 0.08, edge);

  // Soft-clip highlights.
  col = col / (1.0 + max(col - 0.85, 0.0) * 0.6);

  vec3 outc = mix(base, col, cover);
  gl_FragColor = vec4(toSrgb(outc), 1.0);
}
`;
