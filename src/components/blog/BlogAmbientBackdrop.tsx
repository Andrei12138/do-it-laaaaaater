import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AUDIO_BAND_COUNT,
  AUDIO_WAVEFORM_POINTS,
  DEFAULT_AMBIENT_PALETTE,
  createAudioAnalysisFrame,
  type AudioAnalysisFrame,
  type BlogAmbientMode,
  type BlogAmbientPalette
} from '../../blog-ambient'

export interface BlogAmbientBackdropProps {
  mode: BlogAmbientMode
  active: boolean
  darkMode: boolean
  palette: BlogAmbientPalette | null
  coverUrl: string | null
  /** Zero-allocation DSP frame provider (BlogMusicProvider#getAudioFrame). */
  getAudioFrame?: () => AudioAnalysisFrame
}

type RgbTuple = [number, number, number]

const TAU = Math.PI * 2
const FALLBACK_A: RgbTuple = [77, 73, 252]
const FALLBACK_B: RgbTuple = [147, 51, 234]
const FALLBACK_C: RgbTuple = [56, 189, 248]
const WHITE: RgbTuple = [255, 255, 255]

/** Shared silent frame for when no provider is wired (never mutated). */
const SILENT_FRAME: AudioAnalysisFrame = createAudioAnalysisFrame()

// Colour stops glide over ~700 ms (3τ) when switching songs / themes.
const COLOR_TAU_S = 0.233

// ---------------------------------------------------------------------------
// Waves constants
// ---------------------------------------------------------------------------
const GRID_STEP = 28
const CURSOR_RADIUS = 150
const WAVES_DPR_CAP = 2
const RING_POOL = 6
const RING_LIFE_S = 1.35
const RING_WIDTH = 46
const BLOOM_DISTANCE = 30
const DOT_BUCKETS = 4

interface RibbonSpec {
  from: number
  to: number
  yRatio: number
  ampRatio: number
  idleAmp: number
  idleFreq: number
  idleSpeed: number
  lineWidth: number
  fillDepthRatio: number
  strokeAlpha: number
  fillAlpha: number
  bloom: number
}

/** Bass deep wave · Mid melodic wave · Treble hairline — each spans its own log-band range. */
const RIBBONS: readonly RibbonSpec[] = [
  {
    from: 0,
    to: 11,
    yRatio: 0.68,
    ampRatio: 0.25,
    idleAmp: 9,
    idleFreq: 0.0042,
    idleSpeed: 0.9,
    lineWidth: 2.3,
    fillDepthRatio: 0.32,
    strokeAlpha: 0.62,
    fillAlpha: 0.15,
    bloom: 1
  },
  {
    from: 8,
    to: 23,
    yRatio: 0.48,
    ampRatio: 0.19,
    idleAmp: 7,
    idleFreq: 0.0057,
    idleSpeed: -1.15,
    lineWidth: 1.7,
    fillDepthRatio: 0.12,
    strokeAlpha: 0.55,
    fillAlpha: 0.1,
    bloom: 0.85
  },
  {
    from: 18,
    to: 31,
    yRatio: 0.3,
    ampRatio: 0.12,
    idleAmp: 4,
    idleFreq: 0.0081,
    idleSpeed: 1.6,
    lineWidth: 1.05,
    fillDepthRatio: 0,
    strokeAlpha: 0.5,
    fillAlpha: 0,
    bloom: 0.6
  }
]
const MAX_RIBBON_POINTS = AUDIO_BAND_COUNT * 2
const WAVE_THREAD_Y = 0.84

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
 * Whatamesh-grade silk: 3D simplex noise (Ashima / Gustavson), two layered domain-warp octaves,
 * four harmonised colour stops, fold lighting + crest specular, interleaved-gradient dither.
 */
const SILK_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_res;
uniform float u_phase;
uniform float u_warp;
uniform float u_sheen;
uniform float u_beat;
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

  // Diagonal sweeping currents (rotate ~28deg) + long horizontal silk folds
  const float ca = 0.8829;
  const float sa = 0.4695;
  p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
  float t = u_phase;
  vec2 sp = p * vec2(1.0, 1.65) + vec2(t * 0.045, -t * 0.018);

  // Domain warp octave 1
  vec2 q = vec2(
    snoise(vec3(sp * 0.85, t * 0.21)),
    snoise(vec3(sp * 0.85 + vec2(5.2, 1.3), t * 0.21 + 3.7))
  );
  // Domain warp octave 2 (warped by octave 1)
  vec2 r = vec2(
    snoise(vec3(sp * 1.25 + q * u_warp + vec2(1.7, 9.2), t * 0.27)),
    snoise(vec3(sp * 1.25 + q * u_warp + vec2(8.3, 2.8), t * 0.27 + 1.9))
  );
  vec2 w = sp * 0.62 + r * (u_warp * 0.85);
  float n = snoise(vec3(w, t * 0.15));
  float nl = snoise(vec3(w + vec2(0.025, 0.025), t * 0.15));

  // Four harmonised colour stops
  float f1 = smoothstep(-0.65, 0.55, n);
  float f2 = smoothstep(-0.25, 0.85, r.x * 0.9 + q.y * 0.25);
  float f3 = smoothstep(0.25, 1.0, n * 0.55 + r.y * 0.6);
  vec3 col = mix(u_c0, u_c1, f1 * 0.92);
  col = mix(col, u_c2, f2 * 0.78);
  col = mix(col, u_c3, f3 * 0.72);

  // Airy gallery pockets let the base breathe through (keeps light mode luminous)
  float pocket = smoothstep(0.15, 0.95, -q.x * 0.7 - n * 0.45);
  col = mix(col, u_c0, pocket * mix(0.55, 0.42, u_dark));

  // Silk fold lighting + ridge specular sheen on the crests
  float slope = (nl - n) / 0.025;
  float lit = clamp(0.5 + slope * 0.16, 0.0, 1.0);
  col *= mix(0.93, 1.06, lit);
  float crest = pow(clamp(1.0 - abs(n - 0.32) * 2.6, 0.0, 1.0), 3.0);
  float spec = pow(lit, 6.0) * (0.55 + 0.45 * crest);
  vec3 sheenCol = mix(vec3(1.0), u_c3, mix(0.25, 0.55, u_dark));
  col += sheenCol * spec * u_sheen;
  col += (u_c3 - col) * (u_beat * 0.07 * crest);

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
  uWarp: WebGLUniformLocation | null
  uSheen: WebGLUniformLocation | null
  uBeat: WebGLUniformLocation | null
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
    uWarp: gl.getUniformLocation(program, 'u_warp'),
    uSheen: gl.getUniformLocation(program, 'u_sheen'),
    uBeat: gl.getUniformLocation(program, 'u_beat'),
    uDark: gl.getUniformLocation(program, 'u_dark'),
    uC0: gl.getUniformLocation(program, 'u_c0'),
    uC1: gl.getUniformLocation(program, 'u_c1'),
    uC2: gl.getUniformLocation(program, 'u_c2'),
    uC3: gl.getUniformLocation(program, 'u_c3')
  }
}

// ---------------------------------------------------------------------------
// Colour helpers
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

function mixRgbF(a: RgbTuple, b: RgbTuple, ratio: number): RgbTuple {
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
 * c1 vivid cover primary, c2 analogous shift, c3 luminous contrasting highlight.
 */
function writeSilkStops(palette: BlogAmbientPalette, isDark: boolean, out: Float32Array): void {
  const a = parseRgbTriplet(palette.glowA, FALLBACK_A)
  const b = parseRgbTriplet(palette.glowB, FALLBACK_B)
  const c = parseRgbTriplet(palette.glowC, FALLBACK_C)
  const stops: RgbTuple[] = isDark
    ? [mixRgbF([8, 8, 12], a, 0.12), scaleRgb(a, 0.8), scaleRgb(b, 0.72), scaleRgb(mixRgbF(c, WHITE, 0.1), 0.92)]
    : [mixRgbF([251, 251, 253], a, 0.08), mixRgbF(a, WHITE, 0.1), mixRgbF(b, WHITE, 0.16), mixRgbF(c, WHITE, 0.32)]
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

export function BlogAmbientBackdrop({
  mode,
  active,
  darkMode,
  palette,
  coverUrl,
  getAudioFrame
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

  // Re-render hooks for reduced-motion static frames when palette / theme changes
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
  }, [effectivePalette, darkMode])

  const showWaves = isVisible && mode === 'waves'
  const showSilk = isVisible && mode === 'silk'

  const wavesActive = (showWaves || (motionRunning && mode === 'waves')) && !tabHidden
  const silkActive = (showSilk || (motionRunning && mode === 'silk')) && !tabHidden

  // -------------------------------------------------------------------------
  // Mode 'waves' — 32-band log spectrum silk ribbons + beat-reactive 28px dot matrix
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!wavesActive) return
    const canvas = wavesCanvasRef.current
    if (!canvas || typeof window === 'undefined') return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let vw = 1
    let vh = 1
    let cols = 0
    let rows = 0
    let offsetX = 14
    let offsetY = 14
    // Per-ribbon, per-grid-column sampled curve Y + band energy (for dot bloom)
    let ribbonColY: Float32Array[] = RIBBONS.map(() => new Float32Array(0))
    let ribbonColV: Float32Array[] = RIBBONS.map(() => new Float32Array(0))
    const pts = new Float32Array(MAX_RIBBON_POINTS * 2)
    const ptVals = new Float32Array(MAX_RIBBON_POINTS)
    const wavePts = new Float32Array(AUDIO_WAVEFORM_POINTS * 2)
    // Ring pool: [x, y, bornAt, strength]
    const rings = new Float32Array(RING_POOL * 4).fill(-1)
    let ringCursor = 0

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
      offsetX = (vw % GRID_STEP) * 0.5 || GRID_STEP * 0.5
      offsetY = (vh % GRID_STEP) * 0.5 || GRID_STEP * 0.5
      cols = Math.max(1, Math.ceil((vw - offsetX) / GRID_STEP))
      rows = Math.max(1, Math.ceil((vh - offsetY) / GRID_STEP))
      ribbonColY = RIBBONS.map(() => new Float32Array(cols))
      ribbonColV = RIBBONS.map(() => new Float32Array(cols))
    }
    syncSize()

    let mouseTargetX = -9999
    let mouseTargetY = -9999
    let mouseX = -9999
    let mouseY = -9999
    let pointerInside = false

    const onPointerMove = (event: PointerEvent) => {
      mouseTargetX = event.clientX
      mouseTargetY = event.clientY
      if (!pointerInside) {
        mouseX = event.clientX
        mouseY = event.clientY
        pointerInside = true
      }
    }
    const onPointerOut = (event: PointerEvent) => {
      // relatedTarget === null ⇒ the pointer left the browser window
      if (event.relatedTarget === null) pointerInside = false
    }

    const triad = new Float32Array(9)
    const triadTarget = new Float32Array(9)
    writeTriad(paletteRef.current, triad)

    let phase = 1.35
    let lastTs = performance.now()
    let lastBeatId = -1
    let clock = 0
    let rafId = 0

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

      const frame = getAudioFrameRef.current ? getAudioFrameRef.current() : SILENT_FRAME
      const { bands, waveform, bass, level, beatPulse } = frame

      if (!reducedMotion) {
        phase += dt * (0.55 + level * 1.1 + beatPulse * 0.9)
        if (pointerInside) {
          const follow = Math.min(1, dt * 14)
          mouseX += (mouseTargetX - mouseX) * follow
          mouseY += (mouseTargetY - mouseY) * follow
        }
        // Spawn a harmonic ring on every detected onset
        if (frame.active && frame.beatId !== lastBeatId && lastBeatId !== -1) {
          const base = ringCursor * 4
          rings[base] = vw * 0.5
          rings[base + 1] = vh * RIBBONS[0].yRatio
          rings[base + 2] = clock
          rings[base + 3] = 0.55 + 0.45 * level
          ringCursor = (ringCursor + 1) % RING_POOL
        }
      }
      lastBeatId = frame.beatId

      const isDark = darkModeRef.current
      ctx.clearRect(0, 0, vw, vh)

      // Atmospheric wash + flank glows that swell with the bass
      const wash = ctx.createLinearGradient(0, 0, vw, vh)
      wash.addColorStop(0, rgbaStr(cA, isDark ? 0.075 : 0.05))
      wash.addColorStop(0.5, rgbaStr(cB, isDark ? 0.04 : 0.028))
      wash.addColorStop(1, rgbaStr(cC, isDark ? 0.08 : 0.055))
      ctx.fillStyle = wash
      ctx.fillRect(0, 0, vw, vh)

      const glowR = Math.max(vw, vh) * 0.42
      const glowAlpha = (isDark ? 0.07 : 0.05) + bass * (isDark ? 0.16 : 0.12) + beatPulse * 0.04
      for (let side = 0; side < 2; side += 1) {
        const gx = side === 0 ? vw * 0.06 : vw * 0.94
        const gy = vh * RIBBONS[0].yRatio
        const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, glowR)
        const glowColor = side === 0 ? cA : cC
        glow.addColorStop(0, rgbaStr(glowColor, glowAlpha))
        glow.addColorStop(1, rgbaStr(glowColor, 0))
        ctx.fillStyle = glow
        ctx.fillRect(0, 0, vw, vh)
      }

      // ---- 1) Spectrum ribbons (mirrored: outer flanks = lowest band, centre = highest)
      const cx = vw * 0.5
      const halfW = vw * 0.52
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      for (let r = 0; r < RIBBONS.length; r += 1) {
        const spec = RIBBONS[r]
        const n = spec.to - spec.from + 1
        const count = n * 2 - 1
        const baseY = vh * spec.yRatio
        const amp = vh * spec.ampRatio * (1 + beatPulse * 0.12)
        const p = phase * spec.idleSpeed
        for (let k = 0; k < count; k += 1) {
          // k: 0..n-1 left (edge → centre), n-1 centre, n..count-1 right (centre → edge)
          const j = k < n ? n - 1 - k : k - (n - 1)
          const u = j / (n - 1)
          const x = k < n ? cx - u * halfW : cx + u * halfW
          const v = bands[spec.to - j] ?? 0
          const idle = Math.sin(x * spec.idleFreq + p) * spec.idleAmp * (1 - 0.55 * v)
          let y = baseY - v * amp + idle
          if (pointerInside && !reducedMotion) {
            const dx = x - mouseX
            const dy = baseY - mouseY
            const d2 = dx * dx + dy * dy
            if (d2 < 52900) y += Math.sin(dx * 0.022) * (1 - d2 / 52900) * 10
          }
          pts[k * 2] = x
          pts[k * 2 + 1] = y
          ptVals[k] = v
        }

        // Sample curve (piecewise linear) at each dot column for bloom
        const colY = ribbonColY[r]
        const colV = ribbonColV[r]
        let seg = 0
        for (let c = 0; c < cols; c += 1) {
          const gx = offsetX + c * GRID_STEP
          while (seg < count - 2 && pts[(seg + 1) * 2] < gx) seg += 1
          const x0 = pts[seg * 2]
          const x1 = pts[(seg + 1) * 2]
          const t = x1 > x0 ? Math.min(1, Math.max(0, (gx - x0) / (x1 - x0))) : 0
          colY[c] = pts[seg * 2 + 1] + (pts[(seg + 1) * 2 + 1] - pts[seg * 2 + 1]) * t
          colV[c] = ptVals[seg] + (ptVals[seg + 1] - ptVals[seg]) * t
        }

        const strokeBoost = Math.min(0.95, spec.strokeAlpha * (isDark ? 1.05 : 0.86) + level * 0.18)
        const colorFrom = r === 0 ? cA : r === 1 ? cB : cC
        const colorTo = r === 0 ? cB : r === 1 ? cC : cA

        ctx.beginPath()
        traceCatmullRom(ctx, pts, count)
        const strokeGrad = ctx.createLinearGradient(0, 0, vw, 0)
        strokeGrad.addColorStop(0, rgbaStr(colorFrom, strokeBoost))
        strokeGrad.addColorStop(0.5, rgbaStr(colorTo, strokeBoost * 0.82))
        strokeGrad.addColorStop(1, rgbaStr(colorFrom, strokeBoost))
        ctx.strokeStyle = strokeGrad
        ctx.lineWidth = spec.lineWidth + (r === 0 ? bass * 0.9 : 0)
        ctx.stroke()

        if (spec.fillAlpha > 0) {
          const fillBottom = baseY + vh * spec.fillDepthRatio
          ctx.lineTo(pts[(count - 1) * 2], fillBottom)
          ctx.lineTo(pts[0], fillBottom)
          ctx.closePath()
          const fillGrad = ctx.createLinearGradient(0, baseY - amp, 0, fillBottom)
          const fa = Math.min(0.34, spec.fillAlpha * (isDark ? 1.15 : 1) + level * 0.08)
          fillGrad.addColorStop(0, rgbaStr(colorFrom, fa))
          fillGrad.addColorStop(0.6, rgbaStr(colorTo, fa * 0.35))
          fillGrad.addColorStop(1, rgbaStr(colorTo, 0))
          ctx.fillStyle = fillGrad
          ctx.fill()
        }
      }

      // Live waveform oscillator thread (Hann-tapered so it fades into the edges)
      {
        const baseY = vh * WAVE_THREAD_Y
        const amp = vh * 0.065
        const last = AUDIO_WAVEFORM_POINTS - 1
        for (let j = 0; j <= last; j += 1) {
          const u = j / last
          const taper = Math.sin(u * Math.PI)
          wavePts[j * 2] = -8 + u * (vw + 16)
          wavePts[j * 2 + 1] =
            baseY + waveform[j] * amp * taper + Math.sin(u * 9 + phase * 1.3) * 2.5 * taper
        }
        ctx.beginPath()
        traceCatmullRom(ctx, wavePts, AUDIO_WAVEFORM_POINTS)
        ctx.strokeStyle = rgbaStr(cC, (isDark ? 0.42 : 0.34) + level * 0.2)
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // ---- 2) Beat-reactive 28px dot matrix
      const neutral: RgbTuple = isDark ? [175, 180, 198] : [112, 117, 136]
      const dotTint = mixRgbF(neutral, [cA[0], cA[1], cA[2]], isDark ? 0.4 : 0.34)
      const accent: RgbTuple = [cA[0], cA[1], cA[2]]
      const accentHi: RgbTuple = mixRgbF(accent, [cC[0], cC[1], cC[2]], 0.45)
      const baseAlpha = (isDark ? 0.17 : 0.15) + beatPulse * 0.035
      const baseRadius = 1.15
      const cursorR2 = CURSOR_RADIUS * CURSOR_RADIUS
      const ringSpeed = (Math.hypot(vw, vh) * 0.55) / (RING_LIFE_S * 0.85)

      const basePath = new Path2D()
      const bucketPaths: Path2D[] = []
      for (let b = 0; b < DOT_BUCKETS; b += 1) bucketPaths.push(new Path2D())

      for (let row = 0; row < rows; row += 1) {
        const gy = offsetY + row * GRID_STEP
        for (let c = 0; c < cols; c += 1) {
          const gx = offsetX + c * GRID_STEP
          let intensity = 0
          let px = gx
          let py = gy

          for (let r = 0; r < RIBBONS.length; r += 1) {
            const d = Math.abs(gy - ribbonColY[r][c])
            if (d < BLOOM_DISTANCE) {
              const fall = 1 - d / BLOOM_DISTANCE
              const bloom = fall * fall * (0.18 + 0.82 * ribbonColV[r][c]) * RIBBONS[r].bloom
              if (bloom > intensity) intensity = bloom
            }
          }

          for (let i = 0; i < RING_POOL; i += 1) {
            const born = rings[i * 4 + 2]
            if (born < 0) continue
            const age = clock - born
            if (age > RING_LIFE_S) continue
            const dx = gx - rings[i * 4]
            const dy = gy - rings[i * 4 + 1]
            const dist = Math.sqrt(dx * dx + dy * dy)
            const band = Math.abs(dist - age * ringSpeed)
            if (band < RING_WIDTH) {
              const life = 1 - age / RING_LIFE_S
              const ringI = (1 - band / RING_WIDTH) ** 2 * rings[i * 4 + 3] * life
              if (ringI > intensity) intensity = ringI
              if (dist > 0.5) {
                px += (dx / dist) * ringI * 3.2
                py += (dy / dist) * ringI * 3.2
              }
            }
          }

          if (pointerInside) {
            const dx = gx - mouseX
            const dy = gy - mouseY
            const d2 = dx * dx + dy * dy
            if (d2 < cursorR2) {
              const dist = Math.sqrt(d2)
              const falloff = (1 - dist / CURSOR_RADIUS) ** 2
              const ripple = 0.75 + 0.25 * Math.sin(dist * 0.09 - phase * 4)
              if (dist > 0.5) {
                const push = falloff * 7 * ripple
                px += (dx / dist) * push
                py += (dy / dist) * push
              }
              const cursorI = falloff * 0.8
              if (cursorI > intensity) intensity = cursorI
            }
          }

          if (intensity < 0.07) {
            basePath.moveTo(px + baseRadius, py)
            basePath.arc(px, py, baseRadius, 0, TAU)
          } else {
            const b = Math.min(DOT_BUCKETS - 1, Math.floor(intensity * DOT_BUCKETS))
            const radius = baseRadius + (b + 1) * 0.36
            bucketPaths[b].moveTo(px + radius, py)
            bucketPaths[b].arc(px, py, radius, 0, TAU)
          }
        }
      }

      ctx.fillStyle = rgbaStr(dotTint, baseAlpha)
      ctx.fill(basePath)
      for (let b = 0; b < DOT_BUCKETS; b += 1) {
        const mixT = (b + 1) / DOT_BUCKETS
        const color = mixRgbF(dotTint, b >= 2 ? accentHi : accent, Math.min(1, mixT * 1.1))
        ctx.fillStyle = rgbaStr(color, Math.min(0.92, baseAlpha + mixT * (isDark ? 0.6 : 0.5)))
        ctx.fill(bucketPaths[b])
      }

      if (!reducedMotion) {
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
    if (!reducedMotion) {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('pointerout', onPointerOut, { passive: true })
    }
    wavesKickRef.current = schedule
    schedule()

    return () => {
      wavesKickRef.current = null
      if (rafId) window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerout', onPointerOut)
    }
  }, [wavesActive, reducedMotion])

  // -------------------------------------------------------------------------
  // Mode 'silk' — WebGL 3D simplex-noise domain-warped fluid silk (whatamesh-grade)
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

    let contextLost = glCtx.isContextLost()
    let rafId = 0
    let lastTs = performance.now()
    let phase = 2.4
    let warp = 0.9
    let sheen = darkModeRef.current ? 0.2 : 0.15
    let beat = 0
    let darkMix = darkModeRef.current ? 1 : 0

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
      writeSilkStops(paletteRef.current, isDark, stopsTarget)
      const colorK = reducedMotion ? 1 : 1 - Math.exp(-dt / COLOR_TAU_S)
      const colorsMoving = approach(stops, stopsTarget, colorK)
      darkMix += ((isDark ? 1 : 0) - darkMix) * colorK

      const frame = getAudioFrameRef.current ? getAudioFrameRef.current() : SILENT_FRAME
      if (!reducedMotion) {
        // Monotonic flow: calm intros, visibly accelerating & billowing on choruses / beats
        phase += dt * (0.22 + frame.level * 0.65 + frame.beatPulse * 1.1)
      }
      const warpTarget = 0.9 + frame.bass * 0.55 + frame.beatPulse * 0.28 + frame.mid * 0.12
      const sheenTarget =
        (isDark ? 0.2 : 0.15) + frame.treble * 0.28 + frame.mid * 0.1 + frame.beatPulse * 0.12
      const fastK = reducedMotion ? 1 : 1 - Math.exp(-dt / 0.12)
      warp += (warpTarget - warp) * fastK
      sheen += (sheenTarget - sheen) * fastK
      beat += (frame.beatPulse - beat) * (reducedMotion ? 1 : 1 - Math.exp(-dt / 0.05))

      glCtx.viewport(0, 0, canvas.width, canvas.height)
      glCtx.useProgram(res.program)
      glCtx.uniform2f(res.uRes, canvas.width, canvas.height)
      glCtx.uniform1f(res.uPhase, phase)
      glCtx.uniform1f(res.uWarp, warp)
      glCtx.uniform1f(res.uSheen, sheen)
      glCtx.uniform1f(res.uBeat, beat)
      glCtx.uniform1f(res.uDark, darkMix)
      glCtx.uniform3f(res.uC0, stops[0], stops[1], stops[2])
      glCtx.uniform3f(res.uC1, stops[3], stops[4], stops[5])
      glCtx.uniform3f(res.uC2, stops[6], stops[7], stops[8])
      glCtx.uniform3f(res.uC3, stops[9], stops[10], stops[11])
      glCtx.drawArrays(glCtx.TRIANGLES, 0, 3)

      if (!reducedMotion || colorsMoving) {
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
      writeTriad(paletteRef.current, triadTarget)
      approach(triad, triadTarget, reducedMotion ? 1 : 1 - Math.exp(-dt / COLOR_TAU_S))
      const frame = getAudioFrameRef.current ? getAudioFrameRef.current() : SILENT_FRAME
      if (!reducedMotion) phase += dt * (0.22 + frame.level * 0.65 + frame.beatPulse * 1.1)
      const isDark = darkModeRef.current
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
        const radius = 78 * (1 + frame.bass * 0.25 + frame.beatPulse * 0.1)
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, radius)
        grad.addColorStop(0, rgbaStr(color, isDark ? 0.55 : 0.5))
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

  return (
    <div
      className={`blog-ambient-layer${isVisible ? ' is-active' : ''}${
        motionRunning ? ' is-animating' : ''
      } is-mode-${mode} ${darkMode ? 'is-dark' : 'is-light'}`}
      style={layerStyle}
      aria-hidden="true"
    >
      {/* Mode 'waves' — 32-band spectrum ribbons + beat-ripple dot matrix */}
      <div className={`blog-ambient-stage blog-ambient-waves-stage${showWaves ? ' is-visible' : ''}`}>
        <canvas ref={wavesCanvasRef} className="blog-ambient-canvas is-waves" />
      </div>

      {/* Mode 'silk' — WebGL simplex-noise fluid silk (2D fallback only if WebGL fails) */}
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
