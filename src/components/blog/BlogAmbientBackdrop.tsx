import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AUDIO_BAND_COUNT,
  DEFAULT_AMBIENT_PALETTE,
  DEFAULT_TRACK_VISUAL_CONFIG,
  createAudioAnalysisFrame,
  type AudioAnalysisFrame,
  type BlogAmbientMode,
  type BlogAmbientPalette,
  type BlogTrackVisualConfig,
  type BlogWaveStyle
} from '../../blog-ambient'

export interface BlogAmbientBackdropProps {
  mode: BlogAmbientMode
  active: boolean
  darkMode: boolean
  palette: BlogAmbientPalette | null
  coverUrl: string | null
  /** Zero-allocation DSP frame provider (BlogMusicProvider#getAudioFrame). */
  getAudioFrame?: () => AudioAnalysisFrame
  /** Live per-track tuning (silk speed / warp / opacity / softness, wave style / scale / opacity). */
  visualConfig?: BlogTrackVisualConfig | null
}

type RgbTuple = [number, number, number]

const FALLBACK_A: RgbTuple = [77, 73, 252]
const FALLBACK_B: RgbTuple = [147, 51, 234]
const FALLBACK_C: RgbTuple = [56, 189, 248]
const WHITE: RgbTuple = [255, 255, 255]

/** Shared silent frame for when no provider is wired (never mutated). */
const SILENT_FRAME: AudioAnalysisFrame = createAudioAnalysisFrame()

// Colour stops glide over ~700 ms (3τ) when switching songs / themes.
const COLOR_TAU_S = 0.233

// ---------------------------------------------------------------------------
// Waves constants — three museum-grade visualiser styles, no grid anywhere
// ---------------------------------------------------------------------------
const WAVES_DPR_CAP = 2
/** Half of the 620px reading column + breathing gutter: visuals stay calm inside this band. */
const READING_SAFE_HALF = 346
const BAR_SLOT_PX = 22
const MAX_BARS_PER_SIDE = 44
const PEAK_GRAVITY = 2.4 // × viewport-height per s²
const STYLE_FADE_S = 0.22
const HORIZON_POINTS = 30
const MAX_WING_ROWS = 43

interface HorizonLayerSpec {
  from: number
  to: number
  baseRatio: number
  ampRatio: number
  idleFreq: number
  idleSpeed: number
  offset: number
  alpha: number
  stroke: number
}

/** Back: deep bass silhouette · Middle: vocal / melodic dune · Front: crisp treble contour. */
const HORIZON_LAYERS: readonly HorizonLayerSpec[] = [
  { from: 0, to: 11, baseRatio: 0.15, ampRatio: 0.3, idleFreq: 1.25, idleSpeed: 0.32, offset: 0.0, alpha: 0.3, stroke: 0.22 },
  { from: 8, to: 23, baseRatio: 0.1, ampRatio: 0.22, idleFreq: 1.8, idleSpeed: -0.41, offset: 2.1, alpha: 0.28, stroke: 0.3 },
  { from: 18, to: 31, baseRatio: 0.055, ampRatio: 0.14, idleFreq: 2.6, idleSpeed: 0.55, offset: 4.4, alpha: 0.34, stroke: 0.62 }
]

// ---------------------------------------------------------------------------
// Silk (WebGL) constants
// ---------------------------------------------------------------------------
const SILK_DPR_CAP = 1.25
const SILK_PIXEL_BUDGET = 1_800_000

const SILK_VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

/**
 * Dreamy matte-pastel silk (whatamesh / Stripe gradient lineage):
 * broad low-frequency 3D simplex colour washes, velvety smoothstep blends, diffuse-only shading.
 * The glossy liquid-metal fold + crest-specular look fades in ONLY as u_softness → 0.
 */
const SILK_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_res;
uniform float u_phase;
uniform float u_speed;
uniform float u_warp;
uniform float u_softness;
uniform float u_opacity;
uniform float u_sheen;
uniform float u_beat;
uniform float u_energy;
uniform float u_dark;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
varying vec2 v_uv;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
    i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);

  // Gentle diagonal sweep (~18deg)
  const float ca = 0.9511;
  const float sa = 0.3090;
  p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
  float t = u_phase;

  // ---- Matte field: broad architectural washes (spatial frequency kept LOW on purpose)
  vec2 bp = p * 0.62;
  vec2 q = vec2(
    snoise(vec3(bp * 0.7 + vec2(0.0, t * 0.02), t * 0.06)),
    snoise(vec3(bp * 0.7 + vec2(5.2, 1.3), t * 0.06 + 3.7))
  );
  vec2 w = bp + q * (0.28 + 0.34 * u_warp) * (0.9 + 0.1 * u_speed);
  vec2 f1 = w * vec2(0.9, 1.25) + vec2(t * 0.05, 0.0);
  float n1 = snoise(vec3(f1, t * 0.09));
  float n2 = snoise(vec3(w * vec2(0.75, 1.05) + vec2(-t * 0.04, t * 0.015) + vec2(7.3, 2.1), t * 0.08 + 4.0));
  float n3 = snoise(vec3(w * vec2(1.05, 0.8) + vec2(t * 0.03, -t * 0.035) + vec2(13.1, 6.4), t * 0.11 + 9.0));

  // Four cover stops blended with velvety, wide smoothstep transitions
  float soft = mix(0.16, 0.5, u_softness);
  vec3 col = u_c0;
  col = mix(col, u_c1, smoothstep(-0.18 - soft, 0.18 + soft, n1 + 0.12) * 0.9);
  col = mix(col, u_c2, smoothstep(-0.05 - soft, 0.25 + soft, n2) * 0.78);
  col = mix(col, u_c3, smoothstep(0.08 - soft, 0.4 + soft, n3) * 0.66);

  // Airy pockets of the base tint keep the wash pastel and breathable
  float pocket = smoothstep(0.1, 0.9, -q.x * 0.6 - n1 * 0.35);
  col = mix(col, u_c0, pocket * mix(0.42, 0.34, u_dark));

  // Diffuse-only velvet shading from the broad field slope (no specular, no glare)
  float nd = snoise(vec3(f1 + vec2(0.06, 0.04), t * 0.09));
  float shade = clamp(0.5 + (nd - n1) * 3.2, 0.0, 1.0);
  col *= mix(0.975, 1.025, shade);

  // Energy & beats: a broad luminous breath across the highlight wash
  col = mix(col, u_c3, (u_beat * 0.06 + u_energy * 0.04) * smoothstep(-0.2, 0.6, n3));

  // Matte pastel lift in light mode (scaled by softness)
  col = mix(col, vec3(1.0), 0.08 * (1.0 - u_dark) * u_softness);

  // ---- Liquid-metal folds: blended in only as softness approaches 0
  float metal = smoothstep(0.25, 1.0, 1.0 - u_softness);
  if (metal > 0.002) {
    vec2 sp = p * vec2(1.0, 1.65) + vec2(t * 0.045, -t * 0.018);
    vec2 mq = vec2(
      snoise(vec3(sp * 0.85, t * 0.21)),
      snoise(vec3(sp * 0.85 + vec2(5.2, 1.3), t * 0.21 + 3.7))
    );
    vec2 mr = vec2(
      snoise(vec3(sp * 1.25 + mq * u_warp + vec2(1.7, 9.2), t * 0.27)),
      snoise(vec3(sp * 1.25 + mq * u_warp + vec2(8.3, 2.8), t * 0.27 + 1.9))
    );
    vec2 mw = sp * 0.62 + mr * (u_warp * 0.85);
    float mn = snoise(vec3(mw, t * 0.15));
    float mnl = snoise(vec3(mw + vec2(0.025, 0.025), t * 0.15));
    vec3 mcol = mix(u_c0, u_c1, smoothstep(-0.65, 0.55, mn) * 0.92);
    mcol = mix(mcol, u_c2, smoothstep(-0.25, 0.85, mr.x * 0.9 + mq.y * 0.25) * 0.78);
    mcol = mix(mcol, u_c3, smoothstep(0.25, 1.0, mn * 0.55 + mr.y * 0.6) * 0.72);
    float slope = (mnl - mn) / 0.025;
    float lit = clamp(0.5 + slope * 0.16, 0.0, 1.0);
    mcol *= mix(0.93, 1.06, lit);
    float crest = pow(clamp(1.0 - abs(mn - 0.32) * 2.6, 0.0, 1.0), 3.0);
    float spec = pow(lit, 6.0) * (0.55 + 0.45 * crest);
    vec3 sheenCol = mix(vec3(1.0), u_c3, mix(0.25, 0.55, u_dark));
    mcol += sheenCol * spec * u_sheen;
    mcol += (u_c3 - mcol) * (u_beat * 0.07 * crest);
    col = mix(col, mcol, metal);
  }

  // Colour richness: blend toward the page canvas
  vec3 base = mix(vec3(0.965, 0.965, 0.973), vec3(0.063, 0.063, 0.078), u_dark);
  col = mix(base, col, u_opacity);

  // Interleaved-gradient-noise dither: kills 8-bit banding in the long gradients
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col += (dither - 0.5) / 255.0;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`

interface SilkGlResources {
  program: WebGLProgram
  buffer: WebGLBuffer
  uRes: WebGLUniformLocation | null
  uPhase: WebGLUniformLocation | null
  uSpeed: WebGLUniformLocation | null
  uWarp: WebGLUniformLocation | null
  uSoftness: WebGLUniformLocation | null
  uOpacity: WebGLUniformLocation | null
  uSheen: WebGLUniformLocation | null
  uBeat: WebGLUniformLocation | null
  uEnergy: WebGLUniformLocation | null
  uDark: WebGLUniformLocation | null
  uC0: WebGLUniformLocation | null
  uC1: WebGLUniformLocation | null
  uC2: WebGLUniformLocation | null
  uC3: WebGLUniformLocation | null
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function initSilkGl(gl: WebGLRenderingContext): SilkGlResources | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, SILK_VERTEX_SHADER)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, SILK_FRAGMENT_SHADER)
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs)
    if (fs) gl.deleteShader(fs)
    return null
  }
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  const buffer = gl.createBuffer()
  if (!buffer) {
    gl.deleteProgram(program)
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  // Single full-screen triangle (no diagonal seam, fewer fragments than a quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.useProgram(program)
  const aPos = gl.getAttribLocation(program, 'a_pos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)
  return {
    program,
    buffer,
    uRes: gl.getUniformLocation(program, 'u_res'),
    uPhase: gl.getUniformLocation(program, 'u_phase'),
    uSpeed: gl.getUniformLocation(program, 'u_speed'),
    uWarp: gl.getUniformLocation(program, 'u_warp'),
    uSoftness: gl.getUniformLocation(program, 'u_softness'),
    uOpacity: gl.getUniformLocation(program, 'u_opacity'),
    uSheen: gl.getUniformLocation(program, 'u_sheen'),
    uBeat: gl.getUniformLocation(program, 'u_beat'),
    uEnergy: gl.getUniformLocation(program, 'u_energy'),
    uDark: gl.getUniformLocation(program, 'u_dark'),
    uC0: gl.getUniformLocation(program, 'u_c0'),
    uC1: gl.getUniformLocation(program, 'u_c1'),
    uC2: gl.getUniformLocation(program, 'u_c2'),
    uC3: gl.getUniformLocation(program, 'u_c3')
  }
}

// ---------------------------------------------------------------------------
// Colour / math helpers
// ---------------------------------------------------------------------------

function parseRgbTriplet(raw: string, fallback: RgbTuple): RgbTuple {
  const parts = raw.split(',').map((part) => Number(part.trim()))
  if (
    parts.length >= 3 &&
    Number.isFinite(parts[0]) &&
    Number.isFinite(parts[1]) &&
    Number.isFinite(parts[2])
  ) {
    return [
      Math.max(0, Math.min(255, parts[0])),
      Math.max(0, Math.min(255, parts[1])),
      Math.max(0, Math.min(255, parts[2]))
    ]
  }
  return fallback
}

function mixRgbF(a: ArrayLike<number>, b: ArrayLike<number>, ratio: number): RgbTuple {
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio, a[2] + (b[2] - a[2]) * ratio]
}

function scaleRgb(a: RgbTuple, k: number): RgbTuple {
  return [a[0] * k, a[1] * k, a[2] * k]
}

function rgbaStr(rgb: ArrayLike<number>, alpha: number): string {
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${Math.max(
    0,
    Math.min(1, alpha)
  ).toFixed(4)})`
}

function clampNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clampNum((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Writes the triad glow colours (0..255) into `out` as [a, b, c] (9 floats). */
function writeTriad(palette: BlogAmbientPalette, out: Float32Array): void {
  const a = parseRgbTriplet(palette.glowA, FALLBACK_A)
  const b = parseRgbTriplet(palette.glowB, FALLBACK_B)
  const c = parseRgbTriplet(palette.glowC, FALLBACK_C)
  out.set(a, 0)
  out.set(b, 3)
  out.set(c, 6)
}

/**
 * Four silk stops (0..1, 12 floats): c0 airy gallery tint (light) / velvet obsidian (dark),
 * c1 cover primary, c2 analogous shift, c3 luminous contrasting highlight.
 */
function writeSilkStops(palette: BlogAmbientPalette, isDark: boolean, out: Float32Array): void {
  const a = parseRgbTriplet(palette.glowA, FALLBACK_A)
  const b = parseRgbTriplet(palette.glowB, FALLBACK_B)
  const c = parseRgbTriplet(palette.glowC, FALLBACK_C)
  const stops: RgbTuple[] = isDark
    ? [mixRgbF([8, 8, 12], a, 0.12), scaleRgb(a, 0.8), scaleRgb(b, 0.72), scaleRgb(mixRgbF(c, WHITE, 0.1), 0.92)]
    : [mixRgbF([251, 251, 253], a, 0.08), mixRgbF(a, WHITE, 0.14), mixRgbF(b, WHITE, 0.22), mixRgbF(c, WHITE, 0.36)]
  for (let i = 0; i < 4; i += 1) {
    out[i * 3] = stops[i][0] / 255
    out[i * 3 + 1] = stops[i][1] / 255
    out[i * 3 + 2] = stops[i][2] / 255
  }
}

function approach(current: Float32Array, target: Float32Array, k: number): boolean {
  let moving = false
  for (let i = 0; i < current.length; i += 1) {
    const d = target[i] - current[i]
    if (Math.abs(d) > 0.0005) {
      current[i] += d * k
      moving = true
    } else {
      current[i] = target[i]
    }
  }
  return moving
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function readTabHidden(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'hidden'
}

/** Catmull-Rom spline through interleaved [x0, y0, x1, y1, ...] points as cubic Béziers. */
function traceCatmullRom(ctx: CanvasRenderingContext2D, pts: Float32Array, count: number): void {
  if (count < 2) return
  ctx.moveTo(pts[0], pts[1])
  for (let i = 0; i < count - 1; i += 1) {
    const i0 = i > 0 ? i - 1 : i
    const i3 = i + 2 < count ? i + 2 : i + 1
    const x0 = pts[i0 * 2]
    const y0 = pts[i0 * 2 + 1]
    const x1 = pts[i * 2]
    const y1 = pts[i * 2 + 1]
    const x2 = pts[(i + 1) * 2]
    const y2 = pts[(i + 1) * 2 + 1]
    const x3 = pts[i3 * 2]
    const y3 = pts[i3 * 2 + 1]
    ctx.bezierCurveTo(
      x1 + (x2 - x0) / 6,
      y1 + (y2 - y0) / 6,
      x2 - (x3 - x1) / 6,
      y2 - (y3 - y1) / 6,
      x2,
      y2
    )
  }
}

/** Fully rounded capsule (radius = half the short side) appended to a batched Path2D. */
function addCapsule(path: Path2D, x: number, y: number, w: number, h: number): void {
  if (!(w > 0) || !(h > 0)) return
  const r = Math.min(w, h) / 2
  path.moveTo(x + r, y)
  path.arcTo(x + w, y, x + w, y + h, r)
  path.arcTo(x + w, y + h, x, y + h, r)
  path.arcTo(x, y + h, x, y, r)
  path.arcTo(x, y, x + w, y, r)
  path.closePath()
}

function addDot(path: Path2D, x: number, y: number, r: number): void {
  if (!(r > 0)) return
  path.moveTo(x + r, y)
  path.arc(x, y, r, 0, Math.PI * 2)
}

/** Linear sample of the 32 log bands at fractional position t (0 = 40 Hz … 1 = 14 kHz). */
function sampleBands(bands: Float32Array, t: number): number {
  const pos = clampNum(t, 0, 1) * (AUDIO_BAND_COUNT - 1)
  const i = Math.floor(pos)
  const f = pos - i
  const a = bands[i] ?? 0
  const b = bands[Math.min(AUDIO_BAND_COUNT - 1, i + 1)] ?? a
  return a + (b - a) * f
}

/** Calm synthetic breathing used whenever no analysable audio is flowing (CORS / paused). */
function idleValue(u: number, clock: number): number {
  return (
    0.05 +
    0.05 * (0.5 + 0.5 * Math.sin(u * 7.1 + clock * 1.25)) * (0.5 + 0.5 * Math.sin(u * 2.3 - clock * 0.62))
  )
}

export function BlogAmbientBackdrop({
  mode,
  active,
  darkMode,
  palette,
  coverUrl,
  getAudioFrame,
  visualConfig
}: BlogAmbientBackdropProps) {
  const hasVisualSource = Boolean(palette || coverUrl)
  const isVisible = active && mode !== 'minimal' && hasVisualSource

  // Keep rendering through the 700ms fade-out, then stop GPU/CPU work completely
  const [motionRunning, setMotionRunning] = useState<boolean>(isVisible)
  const [reducedMotion, setReducedMotion] = useState<boolean>(readReducedMotion)
  const [tabHidden, setTabHidden] = useState<boolean>(readTabHidden)
  const [silkFallback, setSilkFallback] = useState(false)

  const wavesCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const silkCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const silkFallbackCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const effectivePalette = palette ?? DEFAULT_AMBIENT_PALETTE
  const paletteRef = useRef<BlogAmbientPalette>(effectivePalette)
  paletteRef.current = effectivePalette

  const darkModeRef = useRef<boolean>(darkMode)
  darkModeRef.current = darkMode

  const getAudioFrameRef = useRef(getAudioFrame)
  getAudioFrameRef.current = getAudioFrame

  // Read by the render loops every frame → slider drags land on the very next frame
  const visualConfigRef = useRef<BlogTrackVisualConfig>(visualConfig ?? DEFAULT_TRACK_VISUAL_CONFIG)
  visualConfigRef.current = visualConfig ?? DEFAULT_TRACK_VISUAL_CONFIG

  // Re-render hooks for reduced-motion static frames when palette / theme / tuning changes
  const wavesKickRef = useRef<(() => void) | null>(null)
  const silkKickRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (isVisible) {
      setMotionRunning(true)
      return
    }
    const timer = globalThis.setTimeout(() => {
      setMotionRunning(false)
    }, 740)
    return () => globalThis.clearTimeout(timer)
  }, [isVisible])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisChange = () => setTabHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [])

  useEffect(() => {
    wavesKickRef.current?.()
    silkKickRef.current?.()
  }, [effectivePalette, darkMode, visualConfig])

  const showWaves = isVisible && mode === 'waves'
  const showSilk = isVisible && mode === 'silk'

  const wavesActive = (showWaves || (motionRunning && mode === 'waves')) && !tabHidden
  const silkActive = (showSilk || (motionRunning && mode === 'silk')) && !tabHidden

  // -------------------------------------------------------------------------
  // Mode 'waves' — capsule spectrum · acoustic horizon dunes · symmetric wings
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!wavesActive) return
    const canvas = wavesCanvasRef.current
    if (!canvas || typeof window === 'undefined') return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let vw = 1
    let vh = 1
    // Peak-hold state, in px (bars: height, wings: length) + px/s velocity
    const barPeaks = new Float32Array(MAX_BARS_PER_SIDE * 2)
    const barPeakVel = new Float32Array(MAX_BARS_PER_SIDE * 2)
    const wingPeaks = new Float32Array(MAX_WING_ROWS * 2)
    const wingPeakVel = new Float32Array(MAX_WING_ROWS * 2)
    const horizonPts = new Float32Array(HORIZON_POINTS * 2)

    const resetPeaks = () => {
      barPeaks.fill(0)
      barPeakVel.fill(0)
      wingPeaks.fill(0)
      wingPeakVel.fill(0)
    }

    const syncSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, WAVES_DPR_CAP)
      vw = Math.max(1, window.innerWidth)
      vh = Math.max(1, window.innerHeight)
      const nextW = Math.round(vw * dpr)
      const nextH = Math.round(vh * dpr)
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW
        canvas.height = nextH
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      resetPeaks()
    }
    syncSize()

    const triad = new Float32Array(9)
    const triadTarget = new Float32Array(9)
    writeTriad(paletteRef.current, triad)

    let phase = 1.35
    let lastTs = performance.now()
    let lastBeatId = -1
    let clock = 0
    let rafId = 0
    let activeMix = 0
    let drawnStyle: BlogWaveStyle = visualConfigRef.current.waveStyle
    let styleAlpha = 1

    /** Spring peak-hold: snaps up to the bar, then falls under gravity; beats kick it upward. */
    const stepPeak = (
      peaks: Float32Array,
      vel: Float32Array,
      idx: number,
      value: number,
      dt: number,
      kick: number
    ) => {
      if (kick > 0) vel[idx] = Math.max(vel[idx], kick)
      let p = peaks[idx] + vel[idx] * dt
      vel[idx] -= PEAK_GRAVITY * vh * dt
      if (p <= value) {
        p = value
        if (vel[idx] < 0) vel[idx] = 0
      }
      peaks[idx] = p
      return p
    }

    const renderFrame = (now: number) => {
      rafId = 0
      const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000))
      lastTs = now
      clock += dt

      writeTriad(paletteRef.current, triadTarget)
      const colorK = reducedMotion ? 1 : 1 - Math.exp(-dt / COLOR_TAU_S)
      approach(triad, triadTarget, colorK)
      const cA = triad.subarray(0, 3)
      const cB = triad.subarray(3, 6)
      const cC = triad.subarray(6, 9)

      const cfg = visualConfigRef.current
      const scale = clampNum(cfg.waveScale, 0.3, 2)
      const opacity = clampNum(cfg.waveOpacity, 0.2, 1)

      const frame = getAudioFrameRef.current ? getAudioFrameRef.current() : SILENT_FRAME
      const { bands, bass, level, beatPulse } = frame
      const beatFired = frame.active && frame.beatId !== lastBeatId && lastBeatId !== -1
      lastBeatId = frame.beatId

      if (!reducedMotion) phase += dt * (0.5 + level * 0.9 + beatPulse * 0.6)
      activeMix += ((frame.active ? 1 : 0) - activeMix) * (reducedMotion ? 1 : 1 - Math.exp(-dt / 0.4))

      // Cross-fade between styles (fade out → swap → fade in)
      if (cfg.waveStyle !== drawnStyle) {
        styleAlpha -= reducedMotion ? 1 : dt / STYLE_FADE_S
        if (styleAlpha <= 0) {
          styleAlpha = 0
          drawnStyle = cfg.waveStyle
          resetPeaks()
        }
      } else if (styleAlpha < 1) {
        styleAlpha = Math.min(1, styleAlpha + (reducedMotion ? 1 : dt / STYLE_FADE_S))
      }

      const valueAt = (u: number): number => {
        const live = sampleBands(bands, u)
        if (activeMix >= 0.999) return live
        return live * activeMix + idleValue(u, clock) * (1 - activeMix)
      }

      const isDark = darkModeRef.current
      const alpha = opacity * styleAlpha
      const cx = vw * 0.5
      const safeHalf = Math.min(READING_SAFE_HALF, vw * 0.5)
      const flank = Math.max(0, cx - safeHalf)

      ctx.clearRect(0, 0, vw, vh)

      // Whisper-soft atmospheric wash (no grid, no texture)
      const wash = ctx.createLinearGradient(0, 0, vw, vh)
      wash.addColorStop(0, rgbaStr(cA, (isDark ? 0.07 : 0.045) * opacity))
      wash.addColorStop(0.5, rgbaStr(cB, (isDark ? 0.03 : 0.02) * opacity))
      wash.addColorStop(1, rgbaStr(cC, (isDark ? 0.07 : 0.045) * opacity))
      ctx.fillStyle = wash
      ctx.fillRect(0, 0, vw, vh)

      if (drawnStyle === 'bars') {
        // ---- 律动胶囊频谱: mirrored capsules, tall on the flanks, whisper-low under the column
        const half = vw * 0.5
        const perSide = clampNum(Math.round(half / BAR_SLOT_PX), 10, MAX_BARS_PER_SIDE)
        const slot = half / perSide
        const barW = clampNum(slot * 0.56, 3, 14)
        const bottomPad = Math.max(12, vh * 0.022)
        const flankMaxH = vh * 0.36 * scale
        const centreMaxH = vh * 0.07 * scale
        const kickBase = beatFired ? vh * (0.35 + 0.5 * beatPulse) * Math.min(1.6, scale) : 0

        // Grounding glow along the bottom edge (swells with the bass)
        const glowH = vh * 0.26
        const glow = ctx.createLinearGradient(0, vh - glowH, 0, vh)
        glow.addColorStop(0, rgbaStr(cA, 0))
        glow.addColorStop(1, rgbaStr(cA, (isDark ? 0.12 : 0.08) * alpha * (0.5 + bass)))
        ctx.fillStyle = glow
        ctx.fillRect(0, vh - glowH, vw, glowH)

        const flankPath = new Path2D()
        const centrePath = new Path2D()
        const dotPath = new Path2D()
        for (let side = 0; side < 2; side += 1) {
          for (let i = 0; i < perSide; i += 1) {
            const xMid = side === 0 ? slot * (i + 0.5) : vw - slot * (i + 0.5)
            const u = perSide > 1 ? i / (perSide - 1) : 0 // 0 = outer edge (bass) → 1 = centre (treble)
            const v = valueAt(u)
            const flankT = smoothstep(safeHalf - 40, safeHalf + 70, Math.abs(xMid - cx))
            const maxH = centreMaxH + (flankMaxH - centreMaxH) * flankT
            const h = barW + v * maxH
            const x = xMid - barW / 2
            addCapsule(flankT > 0.5 ? flankPath : centrePath, x, vh - bottomPad - h, barW, h)

            const idx = side * MAX_BARS_PER_SIDE + i
            const kick = kickBase > 0 && v > 0.12 ? kickBase * (0.4 + v) : 0
            const peak = reducedMotion ? h : stepPeak(barPeaks, barPeakVel, idx, h, dt, kick)
            if (flankT > 0.25) {
              addDot(dotPath, xMid, vh - bottomPad - peak - barW * 0.95, barW * 0.34)
            }
          }
        }

        const grad = ctx.createLinearGradient(0, 0, vw, 0)
        const barAlpha = (isDark ? 0.66 : 0.54) * alpha * (0.78 + 0.22 * level)
        grad.addColorStop(0, rgbaStr(cA, barAlpha))
        grad.addColorStop(0.24, rgbaStr(cB, barAlpha))
        grad.addColorStop(0.5, rgbaStr(cC, barAlpha))
        grad.addColorStop(0.76, rgbaStr(cB, barAlpha))
        grad.addColorStop(1, rgbaStr(cA, barAlpha))
        ctx.fillStyle = grad
        ctx.fill(flankPath)
        ctx.globalAlpha = 0.5
        ctx.fill(centrePath)
        ctx.globalAlpha = 1
        ctx.fillStyle = rgbaStr(mixRgbF(cC, WHITE, isDark ? 0.35 : 0.1), Math.min(1, barAlpha * 1.25))
        ctx.fill(dotPath)
      } else if (drawnStyle === 'horizon') {
        // ---- 流体声波山峦: three translucent dunes rising from the bottom edge
        const last = HORIZON_POINTS - 1
        const swell = 0.55 + 0.6 * level
        for (let li = 0; li < HORIZON_LAYERS.length; li += 1) {
          const spec = HORIZON_LAYERS[li]
          let topY = vh
          for (let j = 0; j <= last; j += 1) {
            const u = j / last
            const x = -24 + u * (vw + 48)
            const m = 1 - Math.abs(2 * u - 1) // 0 at the edges → 1 at the centre
            const bandT = (spec.from + (spec.to - spec.from) * m) / (AUDIO_BAND_COUNT - 1)
            const v = valueAt(bandT)
            const env = 0.58 + 0.42 * smoothstep(safeHalf - 60, safeHalf + 120, Math.abs(x - cx))
            const idle =
              Math.sin(u * Math.PI * 2 * spec.idleFreq + phase * spec.idleSpeed + spec.offset) * 0.5 +
              Math.sin(u * Math.PI * 2 * spec.idleFreq * 2.3 - phase * spec.idleSpeed * 0.7 + spec.offset) * 0.22
            const lift = li === 0 ? beatPulse * vh * 0.018 * scale : 0
            const y =
              vh -
              (vh * spec.baseRatio * (1 + 0.32 * idle) * scale + v * vh * spec.ampRatio * scale * env * swell + lift)
            horizonPts[j * 2] = x
            horizonPts[j * 2 + 1] = y
            if (y < topY) topY = y
          }

          const colTop = li === 0 ? cA : li === 1 ? cB : cC
          const colLow = li === 0 ? cB : li === 1 ? cC : cA
          const layerAlpha = spec.alpha * (isDark ? 1.15 : 1) * alpha * (0.82 + 0.18 * level)

          ctx.beginPath()
          traceCatmullRom(ctx, horizonPts, HORIZON_POINTS)
          ctx.lineTo(vw + 24, vh + 2)
          ctx.lineTo(-24, vh + 2)
          ctx.closePath()
          const fill = ctx.createLinearGradient(0, topY, 0, vh)
          fill.addColorStop(0, rgbaStr(colTop, layerAlpha))
          fill.addColorStop(0.55, rgbaStr(colLow, layerAlpha * 0.45))
          fill.addColorStop(1, rgbaStr(colLow, layerAlpha * 0.08))
          ctx.fillStyle = fill
          ctx.fill()

          ctx.beginPath()
          traceCatmullRom(ctx, horizonPts, HORIZON_POINTS)
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          ctx.lineWidth = li === 2 ? 1.5 : 1
          ctx.strokeStyle = rgbaStr(
            mixRgbF(colTop, WHITE, isDark ? 0.3 : 0.05),
            Math.min(1, spec.stroke * alpha * (0.75 + 0.25 * level) * (isDark ? 1.1 : 1))
          )
          ctx.stroke()
        }
      } else {
        // ---- 两侧翼展声场: symmetric horizontal meters radiating inward from both edges
        const spanH = vh * 0.72
        let rows = clampNum(Math.round(spanH / 15), 15, MAX_WING_ROWS)
        if (rows % 2 === 0) rows -= 1
        const rowH = spanH / rows
        const thick = clampNum(rowH * 0.5, 2.5, 9)
        const top = (vh - spanH) / 2
        const edgePad = Math.max(10, vw * 0.008)
        const maxLen = Math.max(72, flank - 18 - edgePad)
        const minLen = thick * 1.6
        const narrow = flank < 120
        const midRow = (rows - 1) / 2
        const kickBase = beatFired ? vh * (0.3 + 0.45 * beatPulse) : 0

        // Soft edge halos breathing with the bass
        for (let side = 0; side < 2; side += 1) {
          const gx = side === 0 ? 0 : vw
          const halo = ctx.createRadialGradient(gx, vh * 0.5, 0, gx, vh * 0.5, maxLen * 1.25)
          halo.addColorStop(0, rgbaStr(side === 0 ? cA : cC, (isDark ? 0.1 : 0.07) * alpha * (0.6 + bass)))
          halo.addColorStop(1, rgbaStr(side === 0 ? cA : cC, 0))
          ctx.fillStyle = halo
          ctx.fillRect(side === 0 ? 0 : vw - maxLen * 1.25, 0, maxLen * 1.25, vh)
        }

        const leftPath = new Path2D()
        const rightPath = new Path2D()
        const dotPath = new Path2D()
        for (let r = 0; r < rows; r += 1) {
          const d = midRow > 0 ? Math.abs(r - midRow) / midRow : 0 // 0 centre (bass) → 1 outer rows (treble)
          const v = valueAt(d * 0.94)
          const taper = 1 - 0.38 * d * d
          const len = minLen + Math.min(1, v * scale) * (maxLen - minLen) * taper
          const y = top + rowH * (r + 0.5) - thick / 2
          addCapsule(leftPath, edgePad, y, len, thick)
          addCapsule(rightPath, vw - edgePad - len, y, len, thick)
          for (let side = 0; side < 2; side += 1) {
            const idx = side * MAX_WING_ROWS + r
            const kick = kickBase > 0 && v > 0.12 ? kickBase * (0.4 + v) : 0
            const peak = reducedMotion ? len : stepPeak(wingPeaks, wingPeakVel, idx, len, dt, kick)
            const tipX = side === 0 ? edgePad + peak + thick * 1.1 : vw - edgePad - peak - thick * 1.1
            addDot(dotPath, tipX, y + thick / 2, thick * 0.36)
          }
        }

        const wingAlpha = (isDark ? 0.62 : 0.52) * alpha * (narrow ? 0.55 : 1) * (0.8 + 0.2 * level)
        const lg = ctx.createLinearGradient(edgePad, 0, edgePad + maxLen, 0)
        lg.addColorStop(0, rgbaStr(cA, wingAlpha))
        lg.addColorStop(0.6, rgbaStr(cB, wingAlpha * 0.82))
        lg.addColorStop(1, rgbaStr(cC, wingAlpha * 0.45))
        ctx.fillStyle = lg
        ctx.fill(leftPath)
        const rg = ctx.createLinearGradient(vw - edgePad, 0, vw - edgePad - maxLen, 0)
        rg.addColorStop(0, rgbaStr(cC, wingAlpha))
        rg.addColorStop(0.6, rgbaStr(cB, wingAlpha * 0.82))
        rg.addColorStop(1, rgbaStr(cA, wingAlpha * 0.45))
        ctx.fillStyle = rg
        ctx.fill(rightPath)
        ctx.fillStyle = rgbaStr(mixRgbF(cC, WHITE, isDark ? 0.35 : 0.1), Math.min(1, wingAlpha * 1.2))
        ctx.fill(dotPath)
      }

      if (!reducedMotion || styleAlpha < 1) {
        rafId = window.requestAnimationFrame(renderFrame)
      }
    }

    const schedule = () => {
      if (!rafId) rafId = window.requestAnimationFrame(renderFrame)
    }
    const onResize = () => {
      syncSize()
      schedule()
    }

    window.addEventListener('resize', onResize, { passive: true })
    wavesKickRef.current = schedule
    schedule()

    return () => {
      wavesKickRef.current = null
      if (rafId) window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
    }
  }, [wavesActive, reducedMotion])

  // -------------------------------------------------------------------------
  // Mode 'silk' — WebGL matte-pastel silk (liquid-metal sheen only as softness → 0)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!silkActive || silkFallback) return
    const canvas = silkCanvasRef.current
    if (!canvas || typeof window === 'undefined') return

    let gl: WebGLRenderingContext | null = null
    try {
      gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power'
      }) as WebGLRenderingContext | null
    } catch {
      gl = null
    }
    if (!gl) {
      setSilkFallback(true)
      return
    }
    const glCtx = gl
    let res: SilkGlResources | null = glCtx.isContextLost() ? null : initSilkGl(glCtx)
    if (!res && !glCtx.isContextLost()) {
      setSilkFallback(true)
      return
    }

    const initialCfg = visualConfigRef.current
    let contextLost = glCtx.isContextLost()
    let rafId = 0
    let lastTs = performance.now()
    let phase = 2.4
    let warp = initialCfg.silkWarp
    let sheen = darkModeRef.current ? 0.2 : 0.15
    let beat = 0
    let energy = 0
    let darkMix = darkModeRef.current ? 1 : 0
    let speed = initialCfg.silkSpeed
    let softness = initialCfg.silkSoftness
    let opacity = initialCfg.silkOpacity

    const stops = new Float32Array(12)
    const stopsTarget = new Float32Array(12)
    writeSilkStops(paletteRef.current, darkModeRef.current, stops)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, SILK_DPR_CAP)
      let w = Math.max(1, window.innerWidth) * dpr
      let h = Math.max(1, window.innerHeight) * dpr
      if (w * h > SILK_PIXEL_BUDGET) {
        const s = Math.sqrt(SILK_PIXEL_BUDGET / (w * h))
        w *= s
        h *= s
      }
      const nextW = Math.max(1, Math.round(w))
      const nextH = Math.max(1, Math.round(h))
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW
        canvas.height = nextH
      }
    }
    resize()

    const render = (now: number) => {
      rafId = 0
      if (contextLost || !res) return
      const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000))
      lastTs = now

      const isDark = darkModeRef.current
      const cfg = visualConfigRef.current
      writeSilkStops(paletteRef.current, isDark, stopsTarget)
      const colorK = reducedMotion ? 1 : 1 - Math.exp(-dt / COLOR_TAU_S)
      const colorsMoving = approach(stops, stopsTarget, colorK)
      darkMix += ((isDark ? 1 : 0) - darkMix) * colorK

      // Tuning knobs glide (~0.15 s) so preset jumps morph instead of popping
      const tuneK = reducedMotion ? 1 : 1 - Math.exp(-dt / 0.15)
      speed += (clampNum(cfg.silkSpeed, 0.2, 2.2) - speed) * tuneK
      softness += (clampNum(cfg.silkSoftness, 0, 1) - softness) * tuneK
      opacity += (clampNum(cfg.silkOpacity, 0.15, 0.95) - opacity) * tuneK
      const tuning =
        Math.abs(cfg.silkSpeed - speed) + Math.abs(cfg.silkSoftness - softness) + Math.abs(cfg.silkOpacity - opacity) >
        0.002

      const frame = getAudioFrameRef.current ? getAudioFrameRef.current() : SILENT_FRAME
      const metal = smoothstep(0.25, 1, 1 - softness)
      if (!reducedMotion) {
        // Monotonic, unhurried flow — calm intros, gently billowing on choruses
        phase += dt * speed * (0.26 + frame.level * 0.55 + frame.beatPulse * (0.45 + 0.65 * metal))
      }
      const warpTarget =
        clampNum(cfg.silkWarp, 0.2, 2) * (1 + frame.bass * 0.5 + frame.beatPulse * 0.25 + frame.mid * 0.1)
      const sheenTarget =
        (isDark ? 0.2 : 0.15) + frame.treble * 0.28 + frame.mid * 0.1 + frame.beatPulse * 0.12
      const fastK = reducedMotion ? 1 : 1 - Math.exp(-dt / 0.12)
      warp += (warpTarget - warp) * fastK
      sheen += (sheenTarget - sheen) * fastK
      energy += (frame.level - energy) * fastK
      beat += (frame.beatPulse - beat) * (reducedMotion ? 1 : 1 - Math.exp(-dt / 0.05))

      glCtx.viewport(0, 0, canvas.width, canvas.height)
      glCtx.useProgram(res.program)
      glCtx.uniform2f(res.uRes, canvas.width, canvas.height)
      glCtx.uniform1f(res.uPhase, phase)
      glCtx.uniform1f(res.uSpeed, speed)
      glCtx.uniform1f(res.uWarp, warp)
      glCtx.uniform1f(res.uSoftness, softness)
      glCtx.uniform1f(res.uOpacity, opacity)
      glCtx.uniform1f(res.uSheen, sheen)
      glCtx.uniform1f(res.uBeat, beat)
      glCtx.uniform1f(res.uEnergy, energy)
      glCtx.uniform1f(res.uDark, darkMix)
      glCtx.uniform3f(res.uC0, stops[0], stops[1], stops[2])
      glCtx.uniform3f(res.uC1, stops[3], stops[4], stops[5])
      glCtx.uniform3f(res.uC2, stops[6], stops[7], stops[8])
      glCtx.uniform3f(res.uC3, stops[9], stops[10], stops[11])
      glCtx.drawArrays(glCtx.TRIANGLES, 0, 3)

      if (!reducedMotion || colorsMoving || tuning) {
        rafId = window.requestAnimationFrame(render)
      }
    }

    const schedule = () => {
      if (!rafId && !contextLost) {
        lastTs = performance.now()
        rafId = window.requestAnimationFrame(render)
      }
    }

    const onResize = () => {
      resize()
      schedule()
    }
    const onContextLost = (event: Event) => {
      event.preventDefault()
      contextLost = true
      res = null
      if (rafId) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
    }
    const onContextRestored = () => {
      contextLost = false
      res = initSilkGl(glCtx)
      if (!res) {
        setSilkFallback(true)
        return
      }
      resize()
      schedule()
    }

    window.addEventListener('resize', onResize, { passive: true })
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    silkKickRef.current = schedule
    schedule()

    return () => {
      silkKickRef.current = null
      if (rafId) window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      if (res && !glCtx.isContextLost()) {
        glCtx.deleteBuffer(res.buffer)
        glCtx.deleteProgram(res.program)
      }
      res = null
    }
  }, [silkActive, silkFallback, reducedMotion])

  // -------------------------------------------------------------------------
  // Silk 2D fallback — only when WebGL cannot initialise
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!silkActive || !silkFallback) return
    const canvas = silkFallbackCanvasRef.current
    if (!canvas || typeof window === 'undefined') return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const W = 192
    const H = 120
    canvas.width = W
    canvas.height = H

    const triad = new Float32Array(9)
    const triadTarget = new Float32Array(9)
    writeTriad(paletteRef.current, triad)
    let phase = 2.4
    let lastTs = performance.now()
    let rafId = 0
    const BLOBS: ReadonlyArray<readonly [number, number, number, number, number]> = [
      // [colour index, fx, fy, px, py]
      [0, 1.0, 1.6, 0.0, 0.4],
      [1, -0.8, 1.3, 2.1, 1.2],
      [2, 1.15, -1.4, 4.2, 2.7],
      [0, -0.95, -1.8, 5.1, 0.85]
    ]

    const render = (now: number) => {
      rafId = 0
      const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000))
      lastTs = now
      const cfg = visualConfigRef.current
      writeTriad(paletteRef.current, triadTarget)
      approach(triad, triadTarget, reducedMotion ? 1 : 1 - Math.exp(-dt / COLOR_TAU_S))
      const frame = getAudioFrameRef.current ? getAudioFrameRef.current() : SILENT_FRAME
      if (!reducedMotion) {
        phase += dt * clampNum(cfg.silkSpeed, 0.2, 2.2) * (0.26 + frame.level * 0.55 + frame.beatPulse * 0.5)
      }
      const isDark = darkModeRef.current
      const richness = clampNum(cfg.silkOpacity, 0.15, 0.95) / 0.62
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = isDark ? '#0b0b10' : '#f8f8fb'
      ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = isDark ? 'screen' : 'source-over'
      const t = phase * 0.42
      for (let i = 0; i < BLOBS.length; i += 1) {
        const [ci, fx, fy, px, py] = BLOBS[i]
        const color = triad.subarray(ci * 3, ci * 3 + 3)
        const bx = W * (0.5 + 0.4 * Math.sin(t * fx + px))
        const by = H * (0.5 + 0.38 * Math.sin(t * fy + py))
        const radius = 78 * (1 + frame.bass * 0.25 + frame.beatPulse * 0.1) * (0.85 + 0.15 * cfg.silkWarp)
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius)
        grad.addColorStop(0, rgbaStr(color, (isDark ? 0.55 : 0.5) * richness))
        grad.addColorStop(1, rgbaStr(color, 0))
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, W, H)
      }
      ctx.globalCompositeOperation = 'source-over'
      if (!reducedMotion) rafId = window.requestAnimationFrame(render)
    }
    const schedule = () => {
      if (!rafId) rafId = window.requestAnimationFrame(render)
    }
    silkKickRef.current = schedule
    schedule()
    return () => {
      silkKickRef.current = null
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [silkActive, silkFallback, reducedMotion])

  const layerStyle = {
    '--ambient-glow-a': effectivePalette.glowA,
    '--ambient-glow-b': effectivePalette.glowB,
    '--ambient-glow-c': effectivePalette.glowC
  } as CSSProperties

  const waveStyle = visualConfig?.waveStyle ?? DEFAULT_TRACK_VISUAL_CONFIG.waveStyle

  return (
    <div
      className={`blog-ambient-layer${isVisible ? ' is-active' : ''}${
        motionRunning ? ' is-animating' : ''
      } is-mode-${mode} is-wave-${waveStyle} ${darkMode ? 'is-dark' : 'is-light'}`}
      style={layerStyle}
      aria-hidden="true"
    >
      {/* Mode 'waves' — capsule spectrum / acoustic horizon / symmetric wings */}
      <div className={`blog-ambient-stage blog-ambient-waves-stage${showWaves ? ' is-visible' : ''}`}>
        <canvas ref={wavesCanvasRef} className="blog-ambient-canvas is-waves" />
      </div>

      {/* Mode 'silk' — WebGL matte silk (2D fallback only if WebGL fails) */}
      <div className={`blog-ambient-stage blog-ambient-silk-stage${showSilk ? ' is-visible' : ''}`}>
        {silkFallback ? (
          <canvas ref={silkFallbackCanvasRef} className="blog-ambient-canvas is-silk-fallback" />
        ) : (
          <canvas ref={silkCanvasRef} className="blog-ambient-canvas is-silk" />
        )}
      </div>

      {/* Ultra-Subtle Editorial Paper Grain */}
      <div className="blog-ambient-grain" />
    </div>
  )
}
