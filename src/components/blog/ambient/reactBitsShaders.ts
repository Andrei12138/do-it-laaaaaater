// Adapted from DavidHDev/react-bits (MIT)
import type { BlogAmbientEffectId } from '../../../blog-ambient'

export type ReactBitsEffectId =
  | 'threads'
  | 'iridescence'
  | 'liquid-chrome'
  | 'aurora'
  | 'light-rays'
  | 'prism'
  | 'color-bends'

export const REACT_BITS_EFFECT_IDS: readonly ReactBitsEffectId[] = Object.freeze([
  'threads',
  'iridescence',
  'liquid-chrome',
  'aurora',
  'light-rays',
  'prism',
  'color-bends'
])

const REACT_BITS_SET = new Set<string>(REACT_BITS_EFFECT_IDS)

export function isReactBitsEffect(id: BlogAmbientEffectId): id is ReactBitsEffectId {
  return REACT_BITS_SET.has(id)
}

/**
 * Shared full-screen triangle vertex shader (`[-1, -1, 3, -1, -1, 3]`).
 * Written in clean GLSL ES 1.00 so it compiles natively in both WebGL2 and WebGL1 contexts.
 */
export const REACT_BITS_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const GLSL_PRECISION_HEADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`

/**
 * 1. Threads — Adapted from DavidHDev/react-bits Threads (MIT)
 * Perlin-driven diagonal silk ribbon threads with sub-pixel anti-aliased band coverage,
 * interactive cursor parting, and cover-triad gradient on a transparent premultiplied canvas.
 */
export const THREADS_FRAGMENT_SHADER = `${GLSL_PRECISION_HEADER}
uniform vec2 uResolution;
uniform vec2 uFrame;
uniform vec2 uTurn;
uniform float uTime;
uniform float uAmplitude;
uniform float uDistance;
uniform vec2 uMouse;
uniform float uThickness;
uniform float uSoftness;
uniform vec4 uPart;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uLightMode;
varying vec2 vUv;

#define THREAD_COUNT 36

float Perlin2D(vec2 P) {
  vec2 Pi = floor(P);
  vec4 Pf_Pfmin1 = P.xyxy - vec4(Pi, Pi + 1.0);
  vec4 Pt = vec4(Pi.xy, Pi.xy + 1.0);
  Pt = Pt - floor(Pt * (1.0 / 71.0)) * 71.0;
  Pt += vec2(26.0, 161.0).xyxy;
  Pt *= Pt;
  Pt = Pt.xzxz * Pt.yyww;
  vec4 hash_x = fract(Pt * (1.0 / 951.135664));
  vec4 hash_y = fract(Pt * (1.0 / 642.949883));
  vec4 grad_x = hash_x - 0.49999;
  vec4 grad_y = hash_y - 0.49999;
  vec4 grad_results = inversesqrt(grad_x * grad_x + grad_y * grad_y) * (grad_x * Pf_Pfmin1.xzxz + grad_y * Pf_Pfmin1.yyww);
  grad_results *= 1.4142135623730950;
  vec2 blend = Pf_Pfmin1.xy * Pf_Pfmin1.xy * Pf_Pfmin1.xy * (Pf_Pfmin1.xy * (Pf_Pfmin1.xy * 6.0 - 15.0) + 10.0);
  vec4 blend2 = vec4(blend, vec2(1.0 - blend));
  return dot(grad_results, blend2.zxzx * blend2.wwyy);
}

vec3 sampleTriad(float t) {
  float x = clamp(t, 0.0, 1.0) * 2.0;
  if (x < 1.0) {
    return mix(uColorA, uColorB, smoothstep(0.0, 1.0, x));
  }
  return mix(uColorB, uColorC, smoothstep(0.0, 1.0, x - 1.0));
}

void main() {
  vec2 centered = gl_FragCoord.xy - 0.5 * uResolution;
  vec2 local = vec2(
    centered.x * uTurn.x + centered.y * uTurn.y,
    -centered.x * uTurn.y + centered.y * uTurn.x
  );

  if (uPart.z > 0.001) {
    vec2 delta = local - uPart.xy;
    float reach = max(uPart.w, 1.0);
    float pull = exp(-dot(delta, delta) / (reach * reach));
    local.y /= (1.0 + pull * uPart.z * 0.85);
  }

  float x = clamp(local.x / max(uFrame.x, 1.0) + 0.5, 0.0, 1.0);
  float pixel = 1.0 / max(uResolution.x, uResolution.y);
  float timeScaled = uTime / 10.0 + (uMouse.x - 0.5) * 0.28;
  float mouseAmp = 1.0 + (uMouse.y - 0.5) * 0.2;

  vec4 accum = vec4(0.0);
  for (int i = 0; i < THREAD_COUNT; i++) {
    float perc = float(i) / float(THREAD_COUNT);
    float splitPoint = 0.04 + perc * 0.50;
    float amplitudeNormal = smoothstep(splitPoint, max(0.7, splitPoint + 0.2), x);
    float finalAmplitude = amplitudeNormal * 0.5 * uAmplitude * mouseAmp;
    float blur = smoothstep(splitPoint, splitPoint + 0.05, x) * perc;

    float xnoise = mix(
      Perlin2D(vec2(timeScaled * 2.5, (x * 1.05 + perc) * 2.5)),
      Perlin2D(vec2(timeScaled * 3.5, (x * 1.05 + timeScaled) * 3.5)) / 1.5,
      x * 0.3
    );

    float y = 0.5 + (perc - 0.5) * uDistance + xnoise * 0.5 * finalAmplitude;
    float lineY = (y - 0.5) * uFrame.y;

    float width = 8.2 * uThickness * pixel * (1.0 - perc * 0.82);
    float band = (width * 0.5 + 10.5 * uSoftness * pixel * blur) * uFrame.y;
    float draw = max(band, 1.25);
    float edge = abs(local.y - lineY);

    if (edge < draw) {
      float vAlpha = 1.0 - smoothstep(0.0, 1.0, pow(max(perc, 1e-4), 0.32)) * 0.80;
      float coverage = (1.0 - smoothstep(0.0, draw, edge)) * (band / draw) * vAlpha;
      vec3 lineCol = sampleTriad(perc * 0.85 + x * 0.15);
      accum = accum * (1.0 - coverage) + vec4(lineCol * coverage, coverage);
    }
  }

  float alpha = clamp(accum.a, 0.0, 1.0);
  if (alpha <= 0.0002) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 color = accum.rgb / alpha;
  if (uLightMode > 0.5) {
    // Crisp premultiplied alpha over #f6f6f8 gallery white without dark curve halo
    vec3 vivid = clamp(pow(max(color, vec3(0.0)), vec3(1.12)) * 0.92, 0.0, 1.0);
    float lightAlpha = clamp(alpha * 0.94, 0.0, 1.0);
    gl_FragColor = vec4(vivid * lightAlpha, lightAlpha);
  } else {
    float glowAlpha = pow(alpha, 1.18);
    vec3 luminous = clamp(mix(color, vec3(1.0), 0.14 * alpha), 0.0, 1.0);
    gl_FragColor = vec4(luminous * glowAlpha, alpha);
  }
}
`

/**
 * 2. Iridescence — Adapted from DavidHDev/react-bits Iridescence (MIT)
 * Iterative harmonic cosine/sine interference membrane with pearlescent Light Mode
 * and deep black-pearl oil-slick Dark Mode.
 */
export const IRIDESCENCE_FRAGMENT_SHADER = `${GLSL_PRECISION_HEADER}
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec2 uMouse;
uniform vec2 uMouseVel;
uniform vec3 uPointer;
uniform float uAmplitude;
uniform float uScale;
uniform float uWarp;
uniform float uHue;
uniform float uSheen;
uniform float uLightMode;
varying vec2 vUv;

vec3 hueRotate(vec3 c, float angle) {
  const vec3 k = vec3(0.57735027);
  float ca = cos(angle);
  return c * ca + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - ca);
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  float mr = max(min(uResolution.x, uResolution.y), 1.0);
  vec2 aspect = uResolution / mr;

  vec2 toPtr = (vUv - uPointer.xy) * aspect;
  float ptrFalloff = exp(-dot(toPtr, toPtr) / 0.075);
  vec2 st = vUv - uMouseVel * ptrFalloff * 0.35;

  vec2 uv = (st * 2.0 - 1.0) * aspect;
  uv = uv / max(uScale, 0.08);
  uv += (uMouse - vec2(0.5)) * uAmplitude;

  float d = -uTime * 0.5;
  float a = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    a += cos(fi - d - a * uv.x * uWarp);
    d += sin(uv.y * fi + a);
  }
  d += uTime * 0.5;

  vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  vec3 raw = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5);
  vec3 wave = clamp((raw - 0.53) / 0.47, 0.0, 1.0);

  vec3 triad = mix(mix(uColor, uColorB, smoothstep(0.1, 0.9, wave.x)), uColorC, smoothstep(0.15, 0.85, wave.z) * 0.65);
  triad = clamp(hueRotate(triad, uHue + (wave.y - 0.5) * 0.42), 0.0, 1.0);

  float ptrSheen = uPointer.z * uSheen * exp(-dot(toPtr, toPtr) / 0.09);

  vec3 finalCol;
  if (uLightMode > 0.5) {
    // Luminous mother-of-pearl pastel iridescence harmonious with #f6f6f8 gallery canvas
    vec3 pearlTint = mix(vec3(0.975, 0.976, 0.986), triad, 0.56);
    vec3 pearl = raw * mix(vec3(0.94), pearlTint, 0.88);
    pearl = mix(vec3(0.965, 0.965, 0.975), clamp(pearl * 1.06, 0.0, 1.0), 0.78);
    pearl += triad * ptrSheen * 0.16;
    finalCol = clamp(pearl, 0.0, 1.0);
  } else {
    // Rich deep black-pearl / iridescent surface in Dark Mode
    vec3 darkBase = vec3(0.048, 0.050, 0.070);
    vec3 oil = pow(wave, vec3(1.38)) * (0.35 + 0.95 * triad);
    vec3 crest = pow(max(wave.y, wave.z), 3.2) * mix(uColorC, vec3(1.0), 0.28) * (0.28 + uSheen * 0.6);
    finalCol = darkBase + oil * 0.92 + crest + triad * ptrSheen * 0.45;
    finalCol = clamp(finalCol, 0.0, 1.0);
  }

  float dither = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  finalCol = clamp(finalCol + dither, 0.0, 1.0);
  gl_FragColor = vec4(finalCol, 1.0);
}
`

/**
 * 3. Liquid Chrome — Adapted from DavidHDev/react-bits LiquidChrome (MIT)
 * Domain-warped harmonic Jacobian bevel + studio key/side/rim environment reflection
 * + ACES tonemapping, adapted for bright mercury in Light Mode and obsidian chrome in Dark Mode.
 */
export const LIQUID_CHROME_FRAGMENT_SHADER = `${GLSL_PRECISION_HEADER}
uniform vec2 uResolution;
uniform float uUnit;
uniform float uTime;
uniform float uAmplitude;
uniform vec2 uFrequency;
uniform float uSharpness;
uniform float uDepth;
uniform vec3 uBaseColor;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec2 uShift;
uniform vec3 uPointer;
uniform float uRoughness;
uniform float uExposure;
uniform float uLightMode;
varying vec2 vUv;

float safeTanh(float x) {
  float c = clamp(x, -10.0, 10.0);
  float e = exp(-2.0 * c);
  return (1.0 - e) / (1.0 + e);
}

float lamp(vec2 p, vec2 center, vec2 size, float soft) {
  vec2 grown = size + soft;
  vec2 q = (p - center) / grown;
  q *= q;
  float d = sqrt(sqrt(max(dot(q, q), 1e-8)));
  float edge = soft / min(grown.x, grown.y);
  float shape = (1.0 - smoothstep(1.0 - edge, 1.0 + edge, d)) * (1.0 - 0.45 * d * d);
  return shape * size.x * size.y / (grown.x * grown.y);
}

vec3 studio(vec3 r, float blur) {
  vec2 p = r.xy / max(r.z + 1.0, 0.05);
  p += uShift * smoothstep(0.3, 1.0, length(p));
  float radius = length(p);
  float soft = 0.01 + blur;
  vec2 dir = p / max(radius, 1e-3);
  float key = lamp(p, vec2(-0.25, 0.42), vec2(0.32, 0.14), soft);
  float side = lamp(p, vec2(0.48, 0.12), vec2(0.08, 0.32), soft);
  float ground = lamp(p, vec2(-0.1, -0.55), vec2(0.45, 0.08), soft);
  float rise = smoothstep(-1.0, 1.0, dir.y);
  float ang = atan(dir.y, dir.x);
  vec3 coverSweep = mix(uBaseColor, mix(uColorB, uColorC, 0.5 + 0.5 * sin(ang * 1.5 + 0.8)), 0.5 + 0.5 * cos(ang - 0.6));

  if (uLightMode > 0.5) {
    // Bright gallery mercury studio: luminous silver highlights + soft cover-tinted reflections
    float edge = 0.012 + blur * 0.8;
    float lobe = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(ang * 2.0 + 0.9));
    float tone = mix(2.15, 1.15, smoothstep(0.45 - edge, 1.0 + edge, radius));
    tone = mix(tone, 0.52, smoothstep(0.96 - edge, 1.16 + edge, radius));
    tone = mix(tone, mix(0.62, 1.05, lobe) * (0.85 + 0.25 * rise), smoothstep(1.16 - edge, 1.34 + edge, radius));
    float width = 0.045 + edge;
    float diff = (radius - 1.38) / width;
    tone += 1.65 * exp(-diff * diff) * min(1.0, 0.06 / width) * (0.65 + 0.35 * rise);
    vec3 tint = mix(vec3(1.0), coverSweep * 1.18, 0.46);
    return tint * tone * (1.0 - 0.22 * side) * (1.0 - 0.15 * ground) + vec3(0.95) * key * 0.65;
  }

  float width = 0.018 + soft * 2.0;
  float rim = exp(-abs(radius - 1.0) / width) * 0.032 / width * (0.8 + smoothstep(-0.5, 0.8, p.y));
  float band = 1.0 - 0.94 * smoothstep(1.04 - soft, 1.12 + soft, radius);
  float wall = smoothstep(1.22, 1.55, radius) * (0.6 + 0.4 * rise);
  float streak = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(ang * 3.0 + 0.6));
  vec3 color = vec3(0.008, 0.009, 0.014) + 0.03 * coverSweep * smoothstep(-0.4, 0.6, p.y);
  color += mix(vec3(1.0, 0.98, 0.95), uBaseColor * 1.35, 0.45) * key * 3.8;
  color += mix(vec3(0.9, 0.95, 1.0), uColorC * 1.35, 0.55) * side * 3.0;
  color += uColorB * ground * 1.35;
  color += mix(vec3(1.0), coverSweep * 1.3, 0.5) * rim;
  color *= band;
  return color + mix(uBaseColor * 0.55, uColorC * 1.75, streak) * wall;
}

vec3 shade(vec2 slope, vec3 v, float blur, vec3 f0) {
  float steep = length(slope);
  slope *= 3.0 * safeTanh(steep / 3.0) / max(steep, 1e-5);
  vec3 n = normalize(vec3(-slope, 1.0));
  vec3 r = reflect(v, n);
  float facing = clamp(dot(n, -v), 0.0, 1.0);
  return studio(r, blur) * (f0 + (1.0 - f0) * pow(1.0 - facing, 5.0));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (2.0 * frag - uResolution) / max(uUnit, 1.0);
  vec2 p = uv;
  vec2 rowX = vec2(1.0, 0.0);
  vec2 rowY = vec2(0.0, 1.0);

  for (int i = 1; i <= 5; i++) {
    float fi = float(i);
    float a = uAmplitude / fi;
    float soften = exp(0.3 - 0.3 * fi);
    float argX = fi * uFrequency.x * p.y + uTime;
    p.x += a * cos(argX);
    rowX -= a * sin(argX) * fi * uFrequency.x * soften * rowY;
    float argY = fi * uFrequency.y * p.x + uTime;
    p.y += a * cos(argY);
    rowY -= a * sin(argY) * fi * uFrequency.y * soften * rowX;
  }

  float phase = uTime - p.x - p.y;
  vec2 field = -(rowX + rowY);
  float density = max(length(field), 1e-3);
  vec2 across = field / density;
  float k = uSharpness;
  float sn = sin(phase);
  float cs = cos(phase);
  float th = safeTanh(k * sn);
  float bevel = (1.0 - th * th) / max(safeTanh(k), 1e-4);
  float fade = smoothstep(3.0, 9.0, 3.14159 * uUnit / density);
  float weight = uDepth * fade;

  // Subtle interactive pointer ripple on the liquid chrome surface
  vec2 ptrUv = (2.0 * (uPointer.xy * uResolution) - uResolution) / max(uUnit, 1.0);
  vec2 dPtr = uv - ptrUv;
  float rDist = length(dPtr);
  vec2 ripple = (dPtr / max(rDist, 1e-3)) * sin(rDist * 11.0 - uTime * 5.0) * exp(-rDist * 2.4) * uPointer.z * 0.45;

  vec2 slope = k * cs * bevel * weight * across + ripple;
  vec2 sweep = -k * bevel * (sn + 2.0 * k * cs * cs * th) * weight * density * 2.0 / max(uUnit, 1.0) * across;
  float bend = length(sweep);

  float slopeLen = length(slope);
  vec3 metalTint = mix(uBaseColor, uColorB, 0.35);
  vec3 f0 = mix(vec3(0.98), metalTint, smoothstep(0.05, 0.65, slopeLen)) * 0.94;
  vec3 v = normalize(vec3(uv * 0.08, -1.0));
  float blur = uRoughness * 0.35;

  vec3 light = vec3(0.0);
  if (bend < 0.012) {
    light = shade(slope, v, blur + bend * 0.5, f0);
  } else {
    light += shade(slope - sweep * 0.375, v, blur + bend * 0.15, f0);
    light += shade(slope - sweep * 0.125, v, blur + bend * 0.15, f0);
    light += shade(slope + sweep * 0.125, v, blur + bend * 0.15, f0);
    light += shade(slope + sweep * 0.375, v, blur + bend * 0.15, f0);
    light *= 0.25;
  }

  vec3 color = pow(aces(light * uExposure), vec3(1.0 / 2.2));
  float grain = fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
  color = clamp(color + (grain - 0.5) / 255.0, 0.0, 1.0);

  if (uLightMode > 0.5) {
    float surfaceMix = smoothstep(0.0, 0.12, slopeLen) * 0.88 + 0.12;
    vec3 galleryBg = vec3(0.965, 0.965, 0.975);
    gl_FragColor = vec4(mix(galleryBg, color, surfaceMix), 1.0);
  } else {
    float darkMix = smoothstep(0.0, 0.10, slopeLen) * 0.92 + 0.08;
    vec3 darkBg = vec3(0.052, 0.054, 0.070);
    gl_FragColor = vec4(mix(darkBg, color, darkMix), 1.0);
  }
}
`

/**
 * 4. Aurora — Adapted from DavidHDev/react-bits Aurora (MIT)
 * Multi-layer 2D Simplex aurora curtains with Oklch perceptual color ramp
 * and clean premultiplied alpha over both #f6f6f8 Light Mode and #101014 Dark Mode.
 */
export const AURORA_FRAGMENT_SHADER = `${GLSL_PRECISION_HEADER}
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uColorStops[3];
uniform float uAmplitude;
uniform float uBlend;
uniform float uHeight;
uniform float uScale;
uniform float uGlow;
uniform float uBrightness;
uniform vec3 uPointer;
uniform float uLightMode;
varying vec2 vUv;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 sampleOklch(float t) {
  float x = clamp(t, 0.0, 1.0) * 2.0;
  vec3 lch;
  if (x < 1.0) {
    float f = x * x * (3.0 - 2.0 * x);
    lch = mix(uColorStops[0], uColorStops[1], f);
  } else {
    float u = x - 1.0;
    float f = u * u * (3.0 - 2.0 * u);
    lch = mix(uColorStops[1], uColorStops[2], f);
  }
  lch.x = mix(clamp(lch.x, 0.62, 0.80), clamp(lch.x, 0.48, 0.66), uLightMode);
  lch.y = mix(lch.y, min(lch.y * 1.18, 0.28), uLightMode);
  return toSrgb(oklabToLinear(vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z))));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float y = 1.0 - frag.y / max(uResolution.y, 1.0);
  float u = frag.x / max(uResolution.x, 1.0);
  float X = (frag.x - uResolution.x * 0.5) / max(uResolution.y, 1.0);
  float t = uTime;
  float dPtr = (X - uPointer.x) / 0.42;
  float reach = uPointer.z * exp(-dPtr * dPtr);

  vec3 glow = vec3(0.0);
  float cover = 0.0;
  for (int k = 0; k < 3; k++) {
    float layer = float(k);
    float seed = layer * 13.7;
    float pace = t * (1.0 - layer * 0.18);
    float warp = snoise(vec2(X * 0.45 * uScale + pace * 0.02 + seed, pace * 0.05 + seed));
    float wave = snoise(vec2(X * 0.75 * uScale + warp * 0.35 - pace * 0.03 + seed, pace * 0.07 - seed)) * 0.72
      + snoise(vec2(X * 1.6 * uScale + warp * 0.5 + pace * 0.04 - seed, pace * 0.1 + seed * 0.5)) * 0.28;
    float hem = uHeight + layer * 0.08 + wave * 0.16 * uAmplitude;
    hem += reach * 0.08 * (layer < 0.5 ? 1.0 : 0.45);

    float soft = (0.045 + uBlend * 0.18) * (1.0 + layer * 0.85);
    float rise = hem - y;
    float low = -soft - uGlow * 0.14;
    float high = 0.28 + soft * 0.62;
    float body = pow(max(smootherstep(low, high, rise), 1e-5), 1.45 + uGlow * 0.5);
    float lobes = 0.86 + 0.14 * snoise(vec2(X * 0.9 * uScale - pace * 0.025 + seed, y * 0.3 + pace * 0.04));
    float weight = layer < 0.5 ? 1.0 : (0.42 / layer);
    float alpha = body * lobes * weight;
    alpha = clamp(alpha * (1.0 + reach * 0.25 * smootherstep(0.9, 0.0, abs(y - hem))), 0.0, 1.0);

    vec3 tint = sampleOklch(u + 0.07 * sin(pace * 0.08 + layer * 2.1) + layer * 0.12 + max(rise, 0.0) * 0.06);
    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);
    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
  }

  float strength = clamp(uBrightness, 0.0, 2.0);
  glow *= min(strength, 1.0);
  cover *= min(strength, 1.0);
  glow = 1.0 - pow(max(1.0 - glow, vec3(0.0)), vec3(max(strength, 1.0)));
  float dither = (hash(frag) - 0.5) / 255.0;

  if (uLightMode > 0.5) {
    vec3 tint = cover > 0.0002 ? clamp(glow / cover, 0.0, 1.0) : vec3(0.0);
    cover *= smootherstep(0.0, 0.22, cover);
    float alpha = clamp(cover * 0.82 + dither, 0.0, 1.0);
    gl_FragColor = vec4(tint * alpha, alpha);
    return;
  }

  vec3 outGlow = clamp(glow + dither, 0.0, 1.0);
  float outAlpha = clamp(max(cover, max(outGlow.r, max(outGlow.g, outGlow.b))) + dither, 0.0, 1.0);
  gl_FragColor = vec4(outGlow, outAlpha);
}
`

/**
 * 5. Light Rays — Adapted from DavidHDev/react-bits LightRays (MIT)
 * Volumetric top-down sunbeams with multi-phase ray interference, atmospheric fog drift,
 * cursor shadow trails, beat-driven pulse rings, and crisp Light/Dark premultiplied alpha.
 */
export const LIGHT_RAYS_FRAGMENT_SHADER = `${GLSL_PRECISION_HEADER}
uniform vec2 uResolution;
uniform float uScale;
uniform float uTime;
uniform vec2 uSource;
uniform vec2 uAim;
uniform float uReach;
uniform vec3 uColor;
uniform vec3 uColorB;
uniform float uSpread;
uniform float uLength;
uniform float uFade;
uniform float uPulsating;
uniform float uDistortion;
uniform float uDensity;
uniform float uSharpness;
uniform float uGlow;
uniform float uHaze;
uniform float uIntensity;
uniform vec4 uShadow;
uniform vec4 uPulses[4];
uniform float uLightMode;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), w.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), w.x),
    w.y
  );
}

float shape(float strength, float width) {
  float edge = max(mix(0.5, 0.08, uSharpness), width);
  return mix(strength, smoothstep(0.62 - edge, 0.62 + edge, strength), uSharpness);
}

void main() {
  vec2 coord = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / max(uScale, 0.01);
  vec2 delta = coord - uSource;
  float dist = length(delta);
  vec2 dir = delta / max(dist, 1e-4);
  float cosAngle = dot(dir, uAim);
  float angle = cosAngle + uDistortion * sin(uTime * 2.0 + dist * 0.02) * 0.2;

  // Smooth analytical angular derivative (avoids 2x2 fwidth blockiness & works in WebGL1+2)
  float sinAngle = sqrt(max(1.0 - cosAngle * cosAngle, 1e-4));
  float slope = (sinAngle / max(dist * uScale, 1.0)) * 1.25 + 0.002 * abs(uDistortion);
  float depth = dist / max(uReach, 1.0);

  float source = exp(-depth * depth * 9.0) * 0.9 + exp(-depth * 3.2) * 0.25;
  float glowLight = uGlow * source * smoothstep(-0.2, 0.6, cosAngle);
  float spread = pow(max(angle, 0.0), 1.0 / max(uSpread, 0.02));
  float lengthFalloff = clamp(1.0 - dist / max(uReach * uLength, 1.0), 0.0, 1.0);
  float fadeFalloff = clamp(1.0 - dist / max(uReach * uFade, 1.0), 0.45, 1.0);
  float envelope = spread * lengthFalloff * fadeFalloff;

  if ((envelope * 1.6 + glowLight) * uIntensity < 0.0012) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float phaseA = angle * 36.2214 * uDensity + uTime * 1.5;
  float phaseB = -angle * 21.11349 * uDensity + uTime * 1.5;
  float phaseC = angle * 22.3991 * uDensity + uTime * 1.1;
  float phaseD = -angle * 18.0234 * uDensity + uTime * 1.1;
  float strengthA = clamp(0.75 + 0.15 * sin(phaseA) + 0.2 * cos(phaseB), 0.0, 1.0);
  float strengthB = clamp(0.75 + 0.15 * sin(phaseC) + 0.2 * cos(phaseD), 0.0, 1.0);
  float widthA = abs(0.15 * 36.2214 * cos(phaseA) + 0.2 * 21.11349 * sin(phaseB)) * uDensity * slope;
  float widthB = abs(0.15 * 22.3991 * cos(phaseC) + 0.2 * 18.0234 * sin(phaseD)) * uDensity * slope;
  float pulseA = mix(1.0, 0.78 + 0.22 * sin(uTime * 4.5), uPulsating);
  float pulseB = mix(1.0, 0.78 + 0.22 * sin(uTime * 3.3), uPulsating);
  float rayLight = envelope * (0.52 * shape(strengthA, widthA) * pulseA + 0.42 * shape(strengthB, widthB) * pulseB);

  if (uHaze > 0.0) {
    float around = atan(uAim.x * dir.y - uAim.y * dir.x, cosAngle);
    vec2 drift = vec2(around * 2.2 + uTime * 0.035, depth * 2.6 - uTime * 0.11);
    float fog = 0.65 * valueNoise(drift * vec2(3.0, 1.0)) + 0.35 * valueNoise(drift * vec2(7.0, 2.3) + 4.1);
    rayLight *= mix(1.0, 0.28 + 1.18 * fog, uHaze);
  }

  if (uShadow.z > 0.001) {
    vec2 toCursor = uShadow.xy - uSource;
    float cursorDistance = length(toCursor);
    float along = dot(delta, toCursor) / max(cursorDistance * cursorDistance, 1e-4);
    float side = abs(delta.x * toCursor.y - delta.y * toCursor.x) / max(cursorDistance, 1e-4);
    float trail = max(along - 1.0, 0.0);
    float width = uShadow.w * along + 0.22 * trail * cursorDistance;
    float behind = smoothstep(0.97, 1.25, along) * exp(-trail * 1.1);
    float shade = (1.0 - smoothstep(width * 0.3, width * 1.6, side)) * behind;
    rayLight *= 1.0 - uShadow.z * 0.58 * shade;
  }

  float boost = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 wave = uPulses[i];
    if (wave.z <= 0.0) continue;
    float px = (depth - wave.x) / max(wave.y, 0.02);
    boost += wave.z * exp(-px * px);
  }

  float light = (rayLight * (1.0 + boost) + glowLight) * uIntensity;
  float crossHue = clamp(0.5 + 0.9 * (dir.x * uAim.y - dir.y * uAim.x), 0.0, 1.0);
  vec3 hue = mix(uColor, uColorB, crossHue * 0.55);

  float grain = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  if (uLightMode > 0.5) {
    vec3 color = hue * light;
    float energy = max(color.r, max(color.g, color.b));
    float maxCh = max(max(hue.r, max(hue.g, hue.b)), 1e-4);
    vec3 tone = clamp(1.0 - (1.0 - hue / maxCh) * 1.65, 0.0, 1.0);
    float warm = clamp((min(tone.r, tone.g) - tone.b) * 2.0, 0.0, 1.0);
    vec3 ink = tone * (mix(0.68, 0.88, warm) - 0.08 * smoothstep(0.35, 1.15, energy));
    float density = clamp(0.86 * (1.0 - exp(-2.05 * energy)) + grain, 0.0, 1.0);
    gl_FragColor = vec4(ink * density, density);
    return;
  }

  float level = light < 0.75 ? light : 0.75 + 0.25 * (1.0 - exp(-(light - 0.75) / 0.25));
  float alpha = clamp(level + grain, 0.0, 1.0);
  float top = max(hue.r, max(hue.g, hue.b));
  vec3 luminous = clamp(mix(hue, vec3(top), smoothstep(0.75, 1.0, level) * 0.42), 0.0, 1.0);
  gl_FragColor = vec4(luminous * alpha, alpha);
}
`

/**
 * 6. Prism — Adapted from DavidHDev/react-bits Prism (MIT)
 * Volumetric octahedral pyramid raymarcher with spectral dispersion blended with
 * the cover triad palette, hue-shift matrix, and crisp Light/Dark premultiplied alpha.
 */
export const PRISM_FRAGMENT_SHADER = `${GLSL_PRECISION_HEADER}
uniform vec2 uResolution;
uniform mat3 uRay;
uniform float uGlow;
uniform float uColorFreq;
uniform float uCenterShift;
uniform float uInvBaseHalf;
uniform float uInvHeight;
uniform float uMinAxis;
uniform float uPxScale;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uTime;
uniform float uSaturation;
uniform mat3 uHue;
uniform float uLightMode;
varying vec2 vUv;

const vec4 PHASE_COS = vec4(1.0, 0.5403023058681398, -0.4161468365471424, -0.9899924966004454);
const vec4 PHASE_SIN = vec4(0.0, 0.8414709848078965, 0.9092974268256817, 0.1411200080598672);

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453123);
}

float pyramid(vec3 p) {
  vec3 q = vec3(abs(p.x) * uInvBaseHalf, abs(p.y) * uInvHeight, abs(p.z) * uInvBaseHalf);
  return max((q.x + q.y + q.z - 1.0) * uMinAxis * 0.5773502691896258, -p.y);
}

vec3 sampleCyclicPalette(float phase) {
  float t = fract(phase * 0.15915494309189535) * 3.0;
  if (t < 1.0) {
    float k = t * t * (3.0 - 2.0 * t);
    return mix(uColorA, uColorB, k);
  }
  if (t < 2.0) {
    float u = t - 1.0;
    float k = u * u * (3.0 - 2.0 * u);
    return mix(uColorB, uColorC, k);
  }
  float u = t - 2.0;
  float k = u * u * (3.0 - 2.0 * u);
  return mix(uColorC, uColorA, k);
}

vec3 grade(vec3 col) {
  col = clamp(col, 0.0, 1.0);
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = clamp(mix(vec3(L), col, uSaturation), 0.0, 1.0);
  return clamp(uHue * col, 0.0, 1.0);
}

void main() {
  vec2 f = (gl_FragCoord.xy - 0.5 * uResolution) * uPxScale;
  vec3 origin = uRay * vec3(f, 0.0);
  vec3 axis = uRay * vec3(0.0, 0.0, 1.0);
  float z = 5.0;
  vec4 o = vec4(0.0);

  for (int i = 0; i < 80; i++) {
    vec3 p = origin + axis * z;
    float d = 0.1 + 0.2 * abs(pyramid(p + vec3(0.0, uCenterShift, 0.0)));
    z -= d;
    float phase = (p.y + z) * uColorFreq;
    vec4 spectral = sin(phase) * PHASE_COS + cos(phase) * PHASE_SIN + 1.0;
    vec3 pal = sampleCyclicPalette(phase) * 2.0;
    vec4 band = vec4(mix(spectral.rgb, pal, 0.68), spectral.a);
    o += band / d;
  }

  // Scale 80-step integral by (100/80)^2 = 1.5625 to match 100-step luminance; clamp to prevent exp overflow
  vec4 raw = min(o * o * (uGlow * 1.5625e-5), vec4(16.0));
  vec4 e = exp(2.0 * raw);
  vec4 mapped = (e - 1.0) / (e + 1.0);
  float dither = (rand(gl_FragCoord.xy + vec2(fract(uTime))) - 0.5) / 255.0;

  if (uLightMode > 0.5) {
    float peak = max(raw.r, max(raw.g, raw.b));
    vec3 hue = grade(raw.rgb / max(peak, 1e-6));
    vec3 ink = clamp(pow(max(hue, vec3(0.0)), vec3(1.28)) * 0.84, 0.0, 1.0);
    float strength = max(mapped.r, max(mapped.g, mapped.b)) * mapped.a;
    float cover = clamp(strength * 0.94 + dither, 0.0, 1.0);
    gl_FragColor = vec4(ink * cover, cover);
  } else {
    vec3 darkCol = grade(mapped.rgb);
    float cover = clamp(mapped.a + dither, 0.0, 1.0);
    gl_FragColor = vec4(darkCol * cover, cover);
  }
}
`

/**
 * 7. Color Bends — Adapted from DavidHDev/react-bits ColorBends (MIT)
 * Flowing multi-ribbon domain-warped cover-palette bends adapted from Three.js
 * to pure WebGL uniforms with clean transparent alpha in both Light and Dark Mode.
 */
export const COLOR_BENDS_FRAGMENT_SHADER = `${GLSL_PRECISION_HEADER}
uniform vec2 uCanvas;
uniform float uTime;
uniform vec2 uRot;
uniform vec3 uColors[4];
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer;
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uIntensity;
uniform float uBandWidth;
uniform float uLightMode;
varying vec2 vUv;

void main() {
  float t = uTime;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 q = vec2(rp.x * (uCanvas.x / max(uCanvas.y, 1.0)), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  vec2 shift = vec2(0.2 * cos(t) - 7.56);
  vec2 toward = uPointer - rp;
  q += toward * uMouseInfluence * 0.2;

  vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
  q += (rr - q) * 0.15;
  shift *= 0.85;

  float kBelow = clamp(uWarpStrength, 0.0, 1.0);
  float kMix = pow(max(kBelow, 1e-4), 0.3);
  float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
  float spare = 1.0 - kBelow * gain;

  vec2 s = q;
  vec3 sumCol = vec3(0.0);
  float weightSum = 0.0;
  float cover = 0.0;

  for (int i = 0; i < 4; i++) {
    s -= 0.014;
    vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
    float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
    vec2 disp = (r - s) * kBelow;
    vec2 warped = s + disp * gain - shift * spare;
    float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
    float m = mix(m0, m1, kMix);
    float w = 1.0 - exp(-uBandWidth / exp(min(uBandWidth * m, 24.0)));
    sumCol += uColors[i] * w;
    weightSum += w;
    cover = max(cover, w);
  }

  float dither = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;

  if (uLightMode > 0.5) {
    // Normalize overlapping ribbons so bands never blow out to invisible white on #f6f6f8
    vec3 avgCol = weightSum > 1e-4 ? sumCol / max(weightSum, 0.92) : vec3(0.0);
    vec3 ink = clamp(pow(max(avgCol, vec3(0.0)), vec3(1.12)) * 0.88, 0.0, 1.0);
    float alpha = clamp(cover * 0.88 + dither, 0.0, 1.0);
    gl_FragColor = vec4(ink * alpha, alpha);
    return;
  }

  vec3 col = clamp(sumCol * uIntensity, 0.0, 1.0);
  float alpha = clamp(cover + dither, 0.0, 1.0);
  gl_FragColor = vec4(col * alpha, alpha);
}
`

export const REACT_BITS_FRAGMENT_SHADERS: Readonly<Record<ReactBitsEffectId, string>> = Object.freeze({
  threads: THREADS_FRAGMENT_SHADER,
  iridescence: IRIDESCENCE_FRAGMENT_SHADER,
  'liquid-chrome': LIQUID_CHROME_FRAGMENT_SHADER,
  aurora: AURORA_FRAGMENT_SHADER,
  'light-rays': LIGHT_RAYS_FRAGMENT_SHADER,
  prism: PRISM_FRAGMENT_SHADER,
  'color-bends': COLOR_BENDS_FRAGMENT_SHADER
})
