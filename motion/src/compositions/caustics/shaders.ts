import { NDROPS, NW } from "./scene";

/**
 * Two passes.
 *
 * 1. Caustic mesh (forward light transport). A dense grid of light rays
 *    leaves the water and lands on the floor: each vertex is a ray, moved by
 *    the refraction offset (gradient of the wobbling surface, plus the logo
 *    lens), projected through the camera, and drawn additively into a
 *    half-float target. Every triangle carries the light of its source cell,
 *    so its irradiance is (source area / landed area), measured with
 *    screen-space derivatives of the two positions: squeezed triangles burn
 *    into caustic filaments, stretched ones fade to black. Drawn three times
 *    with a slightly different refraction strength per colour channel
 *    (dispersion -> chromatic fringes on the filaments).
 * 2. Composite. Tone-maps the light on the floor (cores to white, flanks
 *    tinted, mip-chain bloom), adds the crisp logo emission in the resolved
 *    state, and ray-marches the floating glass drops: refraction through the
 *    body onto the lit floor, Beer-Lambert tint, milky scatter, Fresnel
 *    reflection of the procedural studio of the first Liquid version,
 *    specular glints and a caustic glow.
 */

const CAMERA = /* glsl */ `
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uCamR;  // screen right
uniform vec3 uCamD;  // screen down
uniform vec3 uCamF;  // forward
uniform float uFocal; // px
`;

export const causticVertex = /* glsl */ `
precision highp float;
#define NW ${NW}
attribute vec2 aNear;
${CAMERA}
uniform vec4 uWaves[NW];  // kx ky focus phase
uniform vec4 uRing;       // cx cy amp radius
uniform float uRingWidth;
uniform vec4 uPool;       // cx cy r exponent
uniform vec4 uPool2;      // soft rim rimWidth light
uniform vec4 uHarm;       // a2 ph2 a3 ph3
uniform vec4 uLogo;       // s b1 b2 delta
uniform vec2 uNoiseGain;  // coarse swell, fine chop
uniform float uDisp;      // per-channel refraction scale
varying vec2 vSrc;
varying vec2 vDst;
varying float vW;

vec2 waveDisp(vec2 p, vec2 gain) {
  // Coarse swell first, then the fine chop on the swell-warped position.
  vec2 c = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    vec4 w = uWaves[i];
    float k2 = max(dot(w.xy, w.xy), 1e-8);
    c += (w.z / k2) * w.xy * cos(dot(w.xy, p) + w.w);
  }
  vec2 q = p + 0.6 * c;
  vec2 f = vec2(0.0);
  for (int i = 3; i < NW; i++) {
    vec4 w = uWaves[i];
    float k2 = max(dot(w.xy, w.xy), 1e-8);
    f += (w.z / k2) * w.xy * cos(dot(w.xy, q) + w.w);
  }
  return gain.x * c + gain.y * f;
}

// Light pool: superellipse with wobbling outline; returns signed inside
// distance and the outward direction.
float poolEdge(vec2 p, out vec2 dir) {
  vec2 v = p - uPool.xy;
  float e = uPool.w;
  vec2 a = abs(v) + 1e-4;
  float rp = pow(pow(a.x, e) + pow(a.y, e), 1.0 / e);
  float th = atan(v.y, v.x);
  float R = uPool.z * (1.0 + uHarm.x * cos(2.0 * th + uHarm.y) + uHarm.z * cos(3.0 * th + uHarm.w));
  vec2 g = sign(v) * pow(a / rp, vec2(e - 1.0));
  dir = normalize(g + 1e-5);
  return R - rp;
}

vec2 logoDisp(vec2 p) {
  vec2 v = p - aNear;
  float d = length(v);
  if (d < 1e-3) return vec2(0.0);
  vec2 n = v / d;
  float b1 = uLogo.y, b2 = uLogo.z, delta = uLogo.w;
  float dl;
  if (d < b1) {
    // Folded into the stroke: a caustic line just inside its edge.
    dl = -delta * sin(3.14159265 * d / b1);
  } else if (d < b2) {
    float t = (d - b1) / (b2 - b1);
    dl = b2 * t;
  } else {
    dl = d;
  }
  return n * (dl - d);
}

void main() {
  vec2 src = position.xy;
  vec2 dir;
  float edge = poolEdge(src, dir);
  float soft = uPool2.x;
  vW = uPool2.w * smoothstep(-0.5 * soft, soft, edge);

  vec2 D = waveDisp(src, uNoiseGain);
  // Speaker-cone ring expanding from under the blob on every kick.
  vec2 rv = src - uRing.xy;
  float rr = length(rv) + 1e-3;
  float z = (rr - uRing.w) / uRingWidth;
  D += uNoiseGain.y * uRing.z * exp(-z * z) * sin(z * 3.0) * (rv / rr);
  // Focusing rim: rays near the pool edge are bent inwards.
  float ze = edge / uPool2.z;
  D += -dir * uPool2.y * exp(-ze * ze);

  // Light the logo lens does not gather is mostly blocked (the lens is dark
  // outside its strokes), so the projection reads as light on black.
  float dn = length(src - aNear);
  float gather = 1.0 - smoothstep(uLogo.y, uLogo.y + 5.0, dn);
  float inside = 1.0 - step(1e-3, dn);
  vW *= mix(1.0, mix(0.2, 1.0, gather) * (1.0 + 1.8 * inside), uLogo.x);

  vec2 dst = src + uDisp * (D + uLogo.x * logoDisp(src));
  vSrc = src;
  vDst = dst;

  vec3 rel = vec3(dst, 0.0) - uCamPos;
  float zc = max(dot(rel, uCamF), 1.0);
  vec2 s = vec2(dot(rel, uCamR), dot(rel, uCamD)) * uFocal / zc + 0.5 * uRes;
  gl_Position = vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, 0.0, 1.0);
}
`;

export const causticFragment = /* glsl */ `
precision highp float;
uniform vec3 uChannel;
varying vec2 vSrc;
varying vec2 vDst;
varying float vW;
void main() {
  vec2 a = dFdx(vSrc), b = dFdy(vSrc);
  vec2 c = dFdx(vDst), d = dFdy(vDst);
  float As = abs(a.x * b.y - a.y * b.x);
  float Ad = abs(c.x * d.y - c.y * d.x);
  float I = vW * As / max(Ad, As * 0.025);
  gl_FragColor = vec4(uChannel * I, 1.0);
}
`;

export const quadVertex = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const compositeFragment = /* glsl */ `
precision highp float;
#define NDROPS ${NDROPS}
${CAMERA}
uniform sampler2D uCaustic;
uniform sampler2D uLogoTex;
uniform vec3 uLogoRect;  // x0 y0 size (logo units)
uniform vec3 uLight;     // linear
uniform vec3 uLiquid;
uniform vec3 uBg;
uniform vec4 uTone;      // exposure, overlay, bloom, -
uniform vec4 uDrops[NDROPS];  // xyz r
uniform vec4 uDropW[NDROPS];  // wobble phase squash seed

vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

// ---------------------------------------------------------------- floor light

vec3 tone(vec3 I) {
  vec3 L = I * uTone.x;
  float y = dot(L, vec3(0.3333));
  // Unfocused light (I ~ 1) stays a dim haze; filaments burn to white.
  vec3 v = 1.0 - exp(-pow(L * 0.2, vec3(2.6)) * 2.2);
  float white = smoothstep(0.3, 0.9, 1.0 - exp(-max(y - 2.0, 0.0) * 0.25));
  return v * mix(uLight, vec3(1.0), white);
}

vec3 floorLight(vec2 uv) {
  vec3 I = texture2D(uCaustic, uv).rgb;
  vec3 col = tone(I);
  vec3 b = textureLod(uCaustic, uv, 2.0).rgb * 0.5 + textureLod(uCaustic, uv, 4.0).rgb * 0.35 + textureLod(uCaustic, uv, 6.0).rgb * 0.25;
  col += uLight * uTone.z * 0.012 * max(b - 1.2, 0.0) * uTone.x;
  return col;
}

vec2 toScreen(vec3 P) {
  vec3 rel = P - uCamPos;
  float zc = max(dot(rel, uCamF), 1.0);
  return vec2(dot(rel, uCamR), dot(rel, uCamD)) * uFocal / zc + 0.5 * uRes;
}

vec3 logoEmission(vec2 floorP, vec2 uv) {
  vec2 t = (floorP - uLogoRect.xy) / uLogoRect.z;
  if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) return vec3(0.0);
  vec3 c = pow(texture2D(uLogoTex, vec2(t.x, 1.0 - t.y)).rgb, vec3(2.2));
  // Shimmer: the projected logo breathes with the light caustics on it.
  float y = dot(textureLod(uCaustic, uv, 1.0).rgb, vec3(0.3333)) * uTone.x;
  float sh = 0.72 + 0.28 * smoothstep(0.6, 6.0, y);
  return c * sh * uTone.y;
}

vec3 floorAt(vec2 px) {
  vec2 uv = vec2(px.x, uRes.y - px.y) / uRes;
  vec3 col = uBg + floorLight(uv);
  return col;
}

// ---------------------------------------------------------------- drops

vec3 rayDir(vec2 px) {
  vec2 s = (px - 0.5 * uRes) / uFocal;
  return normalize(uCamF + s.x * uCamR + s.y * uCamD);
}

float wob(vec3 n, vec4 w) {
  return w.x * (0.5 * sin(3.0 * n.x + 1.7 * n.y + w.y + w.w)
    + 0.35 * sin(2.0 * n.y - 2.3 * n.z - 1.3 * w.y + 2.0 * w.w)
    + 0.25 * sin(4.0 * n.z + 1.1 * n.x + 0.7 * w.y + 4.0 * w.w));
}

float dropSdf(vec3 p, int i) {
  vec4 D = uDrops[i];
  vec4 W = uDropW[i];
  vec3 v = p - D.xyz;
  // Speaker-cone squash: flattened along z, bulged in x/y (volume ~ kept).
  v *= vec3(1.0 - 0.5 * W.z, 1.0 - 0.5 * W.z, 1.0 + W.z);
  float l = length(v);
  vec3 n = v / max(l, 1e-4);
  return (l - D.w * (1.0 + wob(n, W))) * 0.8;
}

vec3 dropNormal(vec3 p, int i) {
  float e = 0.5;
  return normalize(vec3(
    dropSdf(p + vec3(e, 0, 0), i) - dropSdf(p - vec3(e, 0, 0), i),
    dropSdf(p + vec3(0, e, 0), i) - dropSdf(p - vec3(0, e, 0), i),
    dropSdf(p + vec3(0, 0, e), i) - dropSdf(p - vec3(0, 0, e), i)));
}

float boxL(vec2 p, vec2 c, vec2 hs, float soft) {
  vec2 d = abs(p - c) - hs;
  float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, o);
}

// The first Liquid's procedural studio (camera space: x right, y down, z to viewer).
vec3 env(vec3 r) {
  vec2 o = r.xy / (1.0 + max(r.z, -0.95));
  vec3 col = vec3(0.012, 0.016, 0.018);
  col += vec3(0.05, 0.06, 0.065) * smoothstep(0.2, -0.9, o.y);
  col += vec3(1.9) * boxL(o, vec2(-0.48, -0.55), vec2(0.30, 0.17), 0.10);
  col += vec3(1.3) * boxL(o, vec2(0.80, -0.08), vec2(0.06, 0.48), 0.05);
  col += vec3(0.75, 0.9, 0.95) * boxL(o, vec2(-0.6, 0.78), vec2(0.38, 0.05), 0.07);
  col += vec3(0.35) * boxL(o, vec2(0.30, -0.80), vec2(0.20, 0.04), 0.05);
  col += vec3(2.2) * boxL(o, vec2(-0.86, -0.1), vec2(0.025, 0.42), 0.02);
  col += vec3(1.6) * boxL(o, vec2(0.05, -0.9), vec2(0.45, 0.022), 0.02);
  col += vec3(1.2) * boxL(o, vec2(0.62, 0.62), vec2(0.03, 0.22), 0.02);
  return col;
}

vec3 toCam(vec3 r) { return vec3(dot(r, uCamR), dot(r, uCamD), -dot(r, uCamF)); }

// What a ray leaving the drop sees: the lit floor (or the dark room above).
vec3 behind(vec3 p, vec3 d) {
  if (d.z < -0.02) {
    float t = -p.z / d.z;
    vec3 f = p + d * t;
    vec2 s = toScreen(f);
    if (s.x < 0.0 || s.y < 0.0 || s.x > uRes.x || s.y > uRes.y) return uBg;
    return floorAt(s) + logoEmission(f.xy, vec2(s.x, uRes.y - s.y) / uRes);
  }
  return env(toCam(d)) * 0.35;
}

// Returns premultiplied drop colour (rgb) and coverage (a).
vec4 shadeDrop(int i, vec3 ro, vec3 rd, float pix) {
  vec4 D = uDrops[i];
  vec3 oc = ro - D.xyz;
  float R = D.w * 1.45;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - R * R;
  float h = b * b - c;
  if (h < 0.0) return vec4(0.0);
  float t = -b - sqrt(h);
  float tEnd = -b + sqrt(h);
  float best = 1e9;
  float tBest = t;
  bool hit = false;
  for (int k = 0; k < 48; k++) {
    vec3 p = ro + rd * t;
    float d = dropSdf(p, i);
    if (d < best) { best = d; tBest = t; }
    if (d < 0.02) { hit = true; break; }
    t += max(d, 0.05);
    if (t > tEnd) break;
  }
  // Silhouette anti-aliasing from the closest approach.
  float pxAt = pix * tBest;
  float cover = hit ? 1.0 : clamp(1.0 - best / (pxAt * 1.0), 0.0, 1.0);
  if (cover <= 0.0) return vec4(0.0);
  vec3 P = ro + rd * tBest;
  vec3 N = dropNormal(P, i);
  vec3 V = -rd;

  // Through the body: refract in, march to the back, refract out (per channel).
  vec3 Tg = refract(rd, N, 1.0 / 1.333);
  vec3 q = P + Tg * 0.6;
  float thick = 0.0;
  for (int k = 0; k < 24; k++) {
    float d = -dropSdf(q, i);
    if (d < 0.05) break;
    q += Tg * d;
    thick += d;
  }
  vec3 Nb = -dropNormal(q, i);
  vec3 through;
  vec3 offs = vec3(-1.0, 0.0, 1.0) * 0.012;
  vec3 rgb;
  for (int c = 0; c < 3; c++) {
    float eta = 1.333 + offs[c];
    vec3 o = refract(Tg, -Nb, eta);
    vec3 s;
    if (dot(o, o) < 1e-4) s = env(toCam(reflect(Tg, -Nb))) * 0.5; // total internal reflection
    else s = behind(q, o);
    rgb[c] = s[c];
  }
  through = rgb;

  // Beer-Lambert tint + milky in-scatter lit from above.
  vec3 sigma = (vec3(1.0) - uLiquid) * 0.006 + 0.001;
  vec3 trans = exp(-sigma * thick * 1.6);
  vec3 Ltop = vec3(0.0, 0.0, 1.0);
  float lum = dot(uLiquid, vec3(0.2126, 0.7152, 0.0722));
  vec3 milk = mix(vec3(lum), uLiquid, 0.8);
  float scatter = 1.0 - exp(-thick * 0.012);
  vec3 body = through * trans + milk * scatter * 0.2 * uTone.w * (0.6 + 0.4 * dot(N, Ltop));
  // Light from above pools on the underside (the drop's own caustic).
  float under = pow(max(-N.z, 0.0), 2.0) * smoothstep(0.0, 0.5, 1.0 - abs(dot(N, V)));
  body += mix(milk, uLiquid, 0.6) * under * 1.6 * uTone.w;

  float cosT = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 Rc = toCam(reflect(rd, N));
  vec3 refl = env(Rc);
  vec3 Vc = toCam(V);
  vec3 Nc = toCam(N);
  vec3 L1 = normalize(vec3(-0.5, -0.62, 0.6));
  vec3 L2 = normalize(vec3(0.72, -0.1, 0.68));
  float spec = pow(max(dot(Nc, normalize(L1 + Vc)), 0.0), 260.0) * 3.0
    + pow(max(dot(Nc, normalize(L2 + Vc)), 0.0), 520.0) * 2.0;
  vec3 col = mix(body, refl, F) + vec3(spec);
  col += vec3(0.6, 0.75, 0.78) * 0.03 * smoothstep(0.0, 0.4, 1.0 - cosT);
  col += uLiquid * pow(1.0 - cosT, 3.0) * 0.45;
  return vec4(col * cover, cover);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 rd = rayDir(px);
  vec3 col = floorAt(px);
  // The floor point under this pixel (for the crisp logo).
  if (rd.z < -1e-3) {
    vec3 f = uCamPos + rd * (-uCamPos.z / rd.z);
    col += logoEmission(f.xy, uv);
  }
  float pix = 1.0 / uFocal;
  // Drops, far to near.
  for (int i = 0; i < NDROPS; i++) {
    vec4 d = shadeDrop(i, uCamPos, rd, pix);
    col = col * (1.0 - d.a) + d.rgb;
  }
  col = col / (1.0 + max(col - 0.85, 0.0) * 0.6);
  gl_FragColor = vec4(toSrgb(col), 1.0);
}
`;
