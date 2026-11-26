// Adapted from DavidHDev/react-bits (MIT)
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  createAudioAnalysisFrame,
  type AudioAnalysisFrame,
  type BlogAmbientEffectId,
  type BlogAmbientPalette,
  type BlogTrackVisualConfig
} from '../../../blog-ambient'
import {
  REACT_BITS_FRAGMENT_SHADERS,
  REACT_BITS_VERTEX_SHADER,
  isReactBitsEffect,
  type ReactBitsEffectId
} from './reactBitsShaders'

export { isReactBitsEffect, type ReactBitsEffectId }

export interface AmbientStageProps {
  effect: BlogAmbientEffectId
  darkMode: boolean
  palette: BlogAmbientPalette
  config: BlogTrackVisualConfig
  reducedMotion: boolean
  getAudioFrame?: () => AudioAnalysisFrame
  onFallback?: () => void
}

type GlContext = WebGLRenderingContext | WebGL2RenderingContext
type Rgb01 = [number, number, number]

interface CompiledShaderProgram {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

interface PulseWave {
  age: number
  strength: number
}

const MAX_DPR = 1.5
const DEFAULT_PIXEL_BUDGET = 2_000_000
const THREADS_PIXEL_BUDGET = 1_450_000
const PRISM_PIXEL_BUDGET = 850_000

/** ~600ms (3τ) exponential color transition when switching songs/covers. */
const COLOR_TAU_S = 0.2
const PARAM_TAU_S = 0.12

const FALLBACK_GLOW_A: Rgb01 = [77 / 255, 73 / 255, 252 / 255]
const FALLBACK_GLOW_B: Rgb01 = [147 / 255, 51 / 255, 234 / 255]
const FALLBACK_GLOW_C: Rgb01 = [56 / 255, 189 / 255, 248 / 255]
const FALLBACK_ACCENT_LIGHT: Rgb01 = [67 / 255, 64 / 255, 214 / 255]
const FALLBACK_ACCENT_DARK: Rgb01 = [139 / 255, 149 / 255, 249 / 255]

const SILENT_AUDIO_FRAME: AudioAnalysisFrame = createAudioAnalysisFrame()

const HUE_W = [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114]
const HUE_U = [0.701, -0.587, -0.114, -0.299, 0.413, -0.114, -0.3, -0.588, 0.886]
const HUE_V = [0.168, -0.331, 0.5, 0.328, 0.035, -0.5, -0.497, 0.296, 0.201]

const CANVAS_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoother(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

function parseRgbTriplet01(raw: string, fallback: Rgb01): Rgb01 {
  const parts = raw.split(',').map((part) => Number(part.trim()))
  if (
    parts.length >= 3 &&
    Number.isFinite(parts[0]) &&
    Number.isFinite(parts[1]) &&
    Number.isFinite(parts[2])
  ) {
    return [
      clamp(parts[0] / 255, 0, 1),
      clamp(parts[1] / 255, 0, 1),
      clamp(parts[2] / 255, 0, 1)
    ]
  }
  return fallback
}

/** Writes 15 floats: [glowA(3), glowB(3), glowC(3), accentLight(3), accentDark(3)]. */
function writePaletteTargets(palette: BlogAmbientPalette, out: Float32Array): void {
  const a = parseRgbTriplet01(palette.glowA, FALLBACK_GLOW_A)
  const b = parseRgbTriplet01(palette.glowB, FALLBACK_GLOW_B)
  const c = parseRgbTriplet01(palette.glowC, FALLBACK_GLOW_C)
  const al = parseRgbTriplet01(palette.accentLightRgb, FALLBACK_ACCENT_LIGHT)
  const ad = parseRgbTriplet01(palette.accentDarkRgb, FALLBACK_ACCENT_DARK)
  out.set(a, 0)
  out.set(b, 3)
  out.set(c, 6)
  out.set(al, 9)
  out.set(ad, 12)
}

function approachArray(current: Float32Array, target: Float32Array, k: number): boolean {
  let moving = false
  for (let i = 0; i < current.length; i += 1) {
    const diff = target[i] - current[i]
    if (Math.abs(diff) > 0.0004) {
      current[i] += diff * k
      moving = true
    } else {
      current[i] = target[i]
    }
  }
  return moving
}

/** Converts linear/sRGB [0..1] into Oklch [L, C, h] (from Aurora.txt). */
function rgbToOklch(r0: number, g0: number, b0: number, out: Float32Array, offset: number): void {
  const r = r0 <= 0.04045 ? r0 / 12.92 : Math.pow((r0 + 0.055) / 1.055, 2.4)
  const g = g0 <= 0.04045 ? g0 / 12.92 : Math.pow((g0 + 0.055) / 1.055, 2.4)
  const b = b0 <= 0.04045 ? b0 / 12.92 : Math.pow((b0 + 0.055) / 1.055, 2.4)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  out[offset] = okL
  out[offset + 1] = Math.hypot(okA, okB)
  out[offset + 2] = Math.atan2(okB, okA)
}

function unwrapAuroraHues(buf: Float32Array): void {
  let anchor = 0
  for (let i = 0; i < 3; i += 1) {
    if (buf[i * 3 + 1] > 0.02) {
      anchor = buf[i * 3 + 2]
      break
    }
  }
  let prev = anchor
  for (let i = 0; i < 3; i += 1) {
    let hue = buf[i * 3 + 1] > 0.02 ? buf[i * 3 + 2] : prev
    while (hue - prev > Math.PI) hue -= Math.PI * 2
    while (hue - prev < -Math.PI) hue += Math.PI * 2
    prev = hue
    buf[i * 3 + 2] = hue
  }
}

function writeRotation3x3(yaw: number, pitch: number, roll: number, out: Float32Array): void {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cx = Math.cos(pitch)
  const sx = Math.sin(pitch)
  const cz = Math.cos(roll)
  const sz = Math.sin(roll)
  out[0] = cy * cz + sy * sx * sz
  out[1] = cx * sz
  out[2] = -sy * cz + cy * sx * sz
  out[3] = -cy * sz + sy * sx * cz
  out[4] = cx * cz
  out[5] = sy * sz + cy * sx * cz
  out[6] = sy * cx
  out[7] = -sx
  out[8] = cy * cx
}

function multiplyMat3(a: Float32Array, b: Float32Array, out: Float32Array): void {
  for (let c = 0; c < 3; c += 1) {
    for (let r = 0; r < 3; r += 1) {
      out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]
    }
  }
}

function compileShader(gl: GlContext, type: number, source: string): WebGLShader | null {
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

function linkShaderProgram(gl: GlContext, fragmentSource: string): CompiledShaderProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, REACT_BITS_VERTEX_SHADER)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs)
    if (fs) gl.deleteShader(fs)
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    return null
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'aPosition')
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  const activeCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < activeCount; i += 1) {
    const info = gl.getActiveUniform(program, i)
    if (info) {
      const cleanName = info.name.replace(/\[0\]$/, '')
      uniforms[cleanName] = gl.getUniformLocation(program, info.name)
    }
  }
  return { program, uniforms }
}

function acquireGlContext(canvas: HTMLCanvasElement): GlContext | null {
  const attrs: WebGLContextAttributes = {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance'
  }
  return (
    (canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null) ??
    (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null)
  )
}

function pixelBudgetFor(effect: ReactBitsEffectId): number {
  if (effect === 'prism') return PRISM_PIXEL_BUDGET
  if (effect === 'threads') return THREADS_PIXEL_BUDGET
  return DEFAULT_PIXEL_BUDGET
}

export function ReactBitsStage({
  effect,
  darkMode,
  palette,
  config,
  reducedMotion,
  getAudioFrame,
  onFallback
}: AmbientStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [contextGen, setContextGen] = useState(0)

  const resolvedEffect: ReactBitsEffectId = isReactBitsEffect(effect) ? effect : 'threads'

  const effectRef = useRef<ReactBitsEffectId>(resolvedEffect)
  effectRef.current = resolvedEffect

  const darkModeRef = useRef<boolean>(darkMode)
  darkModeRef.current = darkMode

  const paletteRef = useRef<BlogAmbientPalette>(palette)
  paletteRef.current = palette

  const configRef = useRef<BlogTrackVisualConfig>(config)
  configRef.current = config

  const reducedMotionRef = useRef<boolean>(reducedMotion)
  reducedMotionRef.current = reducedMotion

  const getAudioFrameRef = useRef(getAudioFrame)
  getAudioFrameRef.current = getAudioFrame

  const onFallbackRef = useRef(onFallback)
  onFallbackRef.current = onFallback

  const kickRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof window === 'undefined') return

    const gl = acquireGlContext(canvas)
    if (!gl) {
      onFallbackRef.current?.()
      return
    }

    const triBuffer = gl.createBuffer()
    if (!triBuffer) {
      onFallbackRef.current?.()
      return
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, triBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)

    const programCache = new Map<ReactBitsEffectId, CompiledShaderProgram>()
    const getOrCompile = (id: ReactBitsEffectId): CompiledShaderProgram | null => {
      const existing = programCache.get(id)
      if (existing) return existing
      const compiled = linkShaderProgram(gl, REACT_BITS_FRAGMENT_SHADERS[id])
      if (compiled) programCache.set(id, compiled)
      return compiled
    }

    // Eagerly verify initial effect compiles cleanly
    if (!getOrCompile(effectRef.current)) {
      gl.deleteBuffer(triBuffer)
      onFallbackRef.current?.()
      return
    }

    // Pre-allocated zero-GC state buffers
    const colorsCur = new Float32Array(15)
    const colorsTgt = new Float32Array(15)
    writePaletteTargets(paletteRef.current, colorsCur)
    colorsTgt.set(colorsCur)

    const paramsCur = new Float32Array([
      configRef.current.speed,
      configRef.current.intensity,
      configRef.current.scale,
      configRef.current.audioReactivity,
      darkModeRef.current ? 0 : 1
    ])
    const paramsTgt = new Float32Array(paramsCur)

    const auroraStopsBuf = new Float32Array(9)
    const bendsColorsBuf = new Float32Array(12)
    const pulsesBuf = new Float32Array(16)
    const prismTiltMat = new Float32Array(9)
    const prismSpinMat = new Float32Array(9)
    const prismRayMat = new Float32Array(9)
    const prismHueMat = new Float32Array(9)
    const pulses: PulseWave[] = []

    const view = { cssWidth: 1, cssHeight: 1, dpr: 1 }
    const pointer = {
      uvX: 0.5,
      uvY: 0.5,
      smoothUvX: 0.5,
      smoothUvY: 0.5,
      velX: 0,
      velY: 0,
      inside: false,
      seen: false,
      presence: 0
    }
    const chromeTilt = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 }
    const prismPose = { yaw: 0, pitch: 0 }

    const clocks: Record<ReactBitsEffectId, number> = {
      threads: 2.4,
      iridescence: 1.2,
      'liquid-chrome': 8.5,
      aurora: 3.1,
      'light-rays': 1.8,
      prism: 0.9,
      'color-bends': 1.5
    }

    let activeEffect: ReactBitsEffectId = effectRef.current
    let lastBeatId = -1
    let rafId = 0
    let lastTs = 0
    let contextLost = false
    let alive = true

    const syncCanvasSize = (forEffect: ReactBitsEffectId) => {
      const rect = canvas.getBoundingClientRect()
      const cssWidth = Math.max(1, rect.width || window.innerWidth || 1)
      const cssHeight = Math.max(1, rect.height || window.innerHeight || 1)
      const budget = pixelBudgetFor(forEffect)
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        MAX_DPR,
        Math.sqrt(budget / Math.max(1, cssWidth * cssHeight))
      )
      const nextW = Math.max(1, Math.round(cssWidth * dpr))
      const nextH = Math.max(1, Math.round(cssHeight * dpr))
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW
        canvas.height = nextH
      }
      view.cssWidth = cssWidth
      view.cssHeight = cssHeight
      view.dpr = nextW / cssWidth
    }

    const renderScene = (dt: number, staticSnap: boolean) => {
      if (contextLost || !alive) return

      const currentEffect = effectRef.current
      if (currentEffect !== activeEffect) {
        activeEffect = currentEffect
        syncCanvasSize(activeEffect)
      }

      const shader = getOrCompile(activeEffect)
      if (!shader) {
        onFallbackRef.current?.()
        return
      }

      writePaletteTargets(paletteRef.current, colorsTgt)
      const cfg = configRef.current
      paramsTgt[0] = clamp(cfg.speed, 0.1, 2.5)
      paramsTgt[1] = clamp(cfg.intensity, 0.1, 2.0)
      paramsTgt[2] = clamp(cfg.scale, 0.3, 2.2)
      paramsTgt[3] = clamp(cfg.audioReactivity, 0, 2.0)
      paramsTgt[4] = darkModeRef.current ? 0 : 1

      const colorK = staticSnap ? 1 : 1 - Math.exp(-dt / COLOR_TAU_S)
      const paramK = staticSnap ? 1 : 1 - Math.exp(-dt / PARAM_TAU_S)
      const colorsMoving = approachArray(colorsCur, colorsTgt, colorK)
      const paramsMoving = approachArray(paramsCur, paramsTgt, paramK)

      const speed = paramsCur[0]
      const intensity = paramsCur[1]
      const scale = paramsCur[2]
      const audioReact = staticSnap ? 0 : paramsCur[3]
      const lightMode = paramsCur[4]

      const frame =
        !staticSnap && getAudioFrameRef.current ? getAudioFrameRef.current() : SILENT_AUDIO_FRAME
      const level = frame.active ? frame.level : 0
      const bass = frame.active ? frame.bass : 0
      const mid = frame.active ? frame.mid : 0
      const treble = frame.active ? frame.treble : 0
      const beatPulse = frame.active ? frame.beatPulse : 0

      if (frame.active && frame.beatId !== lastBeatId) {
        if (lastBeatId !== -1 && audioReact > 0.05 && beatPulse > 0.2) {
          pulses.push({ age: 0, strength: clamp(beatPulse * audioReact * 0.65, 0.15, 1.1) })
          if (pulses.length > 4) pulses.shift()
        }
        lastBeatId = frame.beatId
      }

      // Pointer smoothing
      const tgtX = pointer.inside ? pointer.uvX : 0.5
      const tgtY = pointer.inside ? pointer.uvY : 0.5
      const follow = staticSnap ? 1 : 1 - Math.exp(-dt * 5.5)
      const prevSmoothX = pointer.smoothUvX
      const prevSmoothY = pointer.smoothUvY
      pointer.smoothUvX += (tgtX - pointer.smoothUvX) * follow
      pointer.smoothUvY += (tgtY - pointer.smoothUvY) * follow
      const instVx = dt > 1e-4 ? clamp((pointer.smoothUvX - prevSmoothX) / dt, -2.5, 2.5) : 0
      const instVy = dt > 1e-4 ? clamp((pointer.smoothUvY - prevSmoothY) / dt, -2.5, 2.5) : 0
      const velFollow = staticSnap ? 1 : 1 - Math.exp(-dt * 8)
      pointer.velX += (instVx * 0.16 - pointer.velX) * velFollow
      pointer.velY += (instVy * 0.16 - pointer.velY) * velFollow
      pointer.presence +=
        ((pointer.inside && !staticSnap ? 1 : 0) - pointer.presence) *
        (staticSnap ? 1 : 1 - Math.exp(-dt * 4))

      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        pulses[i].age += dt
        if (pulses[i].age >= 1.9) pulses.splice(i, 1)
      }

      const w = canvas.width
      const h = canvas.height
      const u = shader.uniforms

      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(shader.program)
      gl.bindBuffer(gl.ARRAY_BUFFER, triBuffer)

      // Helper blended cover colors: slightly deepen Toward accentLight in Light Mode for crisp contrast on #f6f6f8
      const lightAccentMix = 0.24 * lightMode
      const cAr = colorsCur[0] * (1 - lightAccentMix) + colorsCur[9] * lightAccentMix
      const cAg = colorsCur[1] * (1 - lightAccentMix) + colorsCur[10] * lightAccentMix
      const cAb = colorsCur[2] * (1 - lightAccentMix) + colorsCur[11] * lightAccentMix
      const cBr = colorsCur[3] * (1 - lightAccentMix * 0.6) + colorsCur[9] * (lightAccentMix * 0.6)
      const cBg = colorsCur[4] * (1 - lightAccentMix * 0.6) + colorsCur[10] * (lightAccentMix * 0.6)
      const cBb = colorsCur[5] * (1 - lightAccentMix * 0.6) + colorsCur[11] * (lightAccentMix * 0.6)
      const cCr = colorsCur[6]
      const cCg = colorsCur[7]
      const cCb = colorsCur[8]

      if (activeEffect === 'threads') {
        if (!staticSnap) {
          clocks.threads +=
            dt *
            (0.85 * speed + audioReact * (level * 0.95 + mid * 0.55 + beatPulse * 0.75)) *
            6.0
        }
        const angleRad = (25 * Math.PI) / 180
        const cos = Math.cos(angleRad)
        const sin = Math.sin(angleRad)
        const frameLen = Math.abs(w * cos) + Math.abs(h * sin)
        const frameAcross = Math.abs(w * sin) + Math.abs(h * cos)

        const px = (pointer.smoothUvX - 0.5) * w
        const py = (pointer.smoothUvY - 0.5) * h
        const localPx = px * cos + py * sin
        const localPy = -px * sin + py * cos

        const amp =
          1.68 *
          intensity *
          (0.65 + audioReact * (level * 1.1 + bass * 0.7 + beatPulse * 0.5))
        const dist = clamp(
          0.42 * scale * (1.0 + audioReact * (bass * 0.14 + beatPulse * 0.08)),
          0.12,
          1.15
        )

        gl.uniform2f(u.uResolution, w, h)
        gl.uniform2f(u.uFrame, frameLen, frameAcross)
        gl.uniform2f(u.uTurn, cos, sin)
        gl.uniform1f(u.uTime, clocks.threads)
        gl.uniform1f(u.uAmplitude, amp)
        gl.uniform1f(u.uDistance, dist)
        gl.uniform2f(u.uMouse, pointer.smoothUvX, pointer.smoothUvY)
        gl.uniform1f(u.uThickness, 0.72 + audioReact * beatPulse * 0.16)
        gl.uniform1f(u.uSoftness, 1.25)
        gl.uniform4f(u.uPart, localPx, localPy, pointer.presence * 0.85, Math.min(w, h) * 0.16)
        gl.uniform3f(u.uColorA, cAr, cAg, cAb)
        gl.uniform3f(u.uColorB, cBr, cBg, cBb)
        gl.uniform3f(u.uColorC, cCr, cCg, cCb)
        gl.uniform1f(u.uLightMode, lightMode)
      } else if (activeEffect === 'iridescence') {
        const uSpeed = speed * (0.85 + audioReact * (level * 0.9 + beatPulse * 0.7))
        if (!staticSnap) {
          clocks.iridescence += dt * uSpeed
        }
        const amp =
          0.15 * intensity * (0.7 + audioReact * (level * 0.95 + beatPulse * 0.85))
        const warp = clamp(
          0.88 + 0.45 * intensity + audioReact * (bass * 0.38 + mid * 0.26),
          0.35,
          2.45
        )
        const effScale = clamp(scale * (1.0 + audioReact * beatPulse * 0.05), 0.3, 2.4)
        const hue = audioReact * (treble * 0.38 + beatPulse * 0.24)

        gl.uniform2f(u.uResolution, view.cssWidth, view.cssHeight)
        gl.uniform1f(u.uTime, clocks.iridescence)
        gl.uniform3f(u.uColor, colorsCur[0], colorsCur[1], colorsCur[2])
        gl.uniform3f(u.uColorB, colorsCur[3], colorsCur[4], colorsCur[5])
        gl.uniform3f(u.uColorC, colorsCur[6], colorsCur[7], colorsCur[8])
        gl.uniform2f(u.uMouse, pointer.smoothUvX, pointer.smoothUvY)
        gl.uniform2f(u.uMouseVel, pointer.velX, pointer.velY)
        gl.uniform3f(u.uPointer, pointer.uvX, pointer.uvY, pointer.presence)
        gl.uniform1f(u.uAmplitude, amp)
        gl.uniform1f(u.uScale, effScale)
        gl.uniform1f(u.uWarp, warp)
        gl.uniform1f(u.uHue, hue)
        gl.uniform1f(u.uSheen, 0.34 + audioReact * (treble * 0.25 + beatPulse * 0.3))
        gl.uniform1f(u.uLightMode, lightMode)
      } else if (activeEffect === 'liquid-chrome') {
        if (!staticSnap) {
          clocks['liquid-chrome'] +=
            dt * (0.28 * speed + audioReact * (level * 0.36 + bass * 0.3 + beatPulse * 0.34))
        }
        const nx = (pointer.smoothUvX - 0.5) * 2
        const ny = (0.5 - pointer.smoothUvY) * 2
        const targetYaw = pointer.inside
          ? nx * 0.35
          : 0.22 * Math.sin(clocks['liquid-chrome'] * 1.3)
        const targetPitch = pointer.inside
          ? -ny * 0.28
          : 0.16 * Math.sin(clocks['liquid-chrome'] * 0.9 + 1.7)
        if (!staticSnap) {
          const stiffness = 32
          const damping = 2 * Math.sqrt(stiffness) * 0.95
          chromeTilt.vyaw +=
            ((targetYaw - chromeTilt.yaw) * stiffness - chromeTilt.vyaw * damping) * dt
          chromeTilt.vpitch +=
            ((targetPitch - chromeTilt.pitch) * stiffness - chromeTilt.vpitch * damping) * dt
          chromeTilt.yaw += chromeTilt.vyaw * dt
          chromeTilt.pitch += chromeTilt.vpitch * dt
        }

        const amp = clamp(
          0.3 * intensity * (0.72 + audioReact * (bass * 0.85 + beatPulse * 0.55)),
          0.06,
          1.35
        )
        const freqX = clamp(2.85 * scale * (1.0 + audioReact * bass * 0.18), 0.5, 8.0)
        const freqY = clamp(2.65 * scale * (1.0 + audioReact * mid * 0.18), 0.5, 8.0)
        const rippleStrength = clamp(pointer.presence * 0.8 + audioReact * beatPulse * 0.55, 0, 1.4)

        gl.uniform2f(u.uResolution, w, h)
        gl.uniform1f(u.uUnit, Math.min(w, h))
        gl.uniform1f(u.uTime, clocks['liquid-chrome'])
        gl.uniform1f(u.uAmplitude, amp)
        gl.uniform2f(u.uFrequency, freqX, freqY)
        gl.uniform1f(u.uSharpness, 1.65)
        gl.uniform1f(u.uDepth, 1.0 + audioReact * (bass * 0.22 + beatPulse * 0.18))
        gl.uniform3f(u.uBaseColor, colorsCur[0], colorsCur[1], colorsCur[2])
        gl.uniform3f(u.uColorB, colorsCur[3], colorsCur[4], colorsCur[5])
        gl.uniform3f(u.uColorC, colorsCur[6], colorsCur[7], colorsCur[8])
        gl.uniform2f(u.uShift, chromeTilt.yaw, chromeTilt.pitch)
        gl.uniform3f(u.uPointer, pointer.smoothUvX, pointer.smoothUvY, rippleStrength)
        gl.uniform1f(u.uRoughness, 0.28)
        gl.uniform1f(u.uExposure, 0.98 + audioReact * beatPulse * 0.12)
        gl.uniform1f(u.uLightMode, lightMode)
      } else if (activeEffect === 'aurora') {
        if (!staticSnap) {
          clocks.aurora +=
            dt * (0.95 * speed + audioReact * (level * 0.85 + mid * 0.55 + beatPulse * 0.65))
        }
        rgbToOklch(colorsCur[0], colorsCur[1], colorsCur[2], auroraStopsBuf, 0)
        rgbToOklch(colorsCur[3], colorsCur[4], colorsCur[5], auroraStopsBuf, 3)
        rgbToOklch(colorsCur[6], colorsCur[7], colorsCur[8], auroraStopsBuf, 6)
        unwrapAuroraHues(auroraStopsBuf)

        const amp =
          1.05 *
          intensity *
          (0.7 + audioReact * (bass * 0.95 + mid * 0.65 + beatPulse * 0.6))
        const blend = clamp(
          0.48 * scale + audioReact * (mid * 0.16 + beatPulse * 0.12),
          0.12,
          1.0
        )
        const spatialScale = clamp(1.12 / Math.sqrt(Math.max(0.3, scale)), 0.55, 1.95)
        const glow = 0.6 + 0.2 * intensity + audioReact * (level * 0.25 + beatPulse * 0.28)
        const brightness = 1.05 + audioReact * (level * 0.2 + beatPulse * 0.18)
        const ptrX = ((pointer.smoothUvX - 0.5) * view.cssWidth) / Math.max(1, view.cssHeight)

        gl.uniform2f(u.uResolution, w, h)
        gl.uniform1f(u.uTime, clocks.aurora)
        gl.uniform3fv(u.uColorStops, auroraStopsBuf)
        gl.uniform1f(u.uAmplitude, amp)
        gl.uniform1f(u.uBlend, blend)
        gl.uniform1f(u.uHeight, 0.48 + audioReact * bass * 0.05)
        gl.uniform1f(u.uScale, spatialScale)
        gl.uniform1f(u.uGlow, glow)
        gl.uniform1f(u.uBrightness, brightness)
        gl.uniform3f(u.uPointer, ptrX, 1 - pointer.smoothUvY, pointer.presence)
        gl.uniform1f(u.uLightMode, lightMode)
      } else if (activeEffect === 'light-rays') {
        const raysSpeed =
          0.92 * speed + audioReact * (treble * 0.85 + level * 0.6 + beatPulse * 0.7)
        if (!staticSnap) {
          clocks['light-rays'] += dt * raysSpeed
        }

        pulsesBuf.fill(0)
        for (let i = 0; i < pulses.length && i < 4; i += 1) {
          const t = pulses[i].age
          pulsesBuf[i * 4] = 0.05 + t * 1.05
          pulsesBuf[i * 4 + 1] = 0.14 + t * 0.14
          pulsesBuf[i * 4 + 2] =
            pulses[i].strength * smoother(t / 0.15) * (1 - smoother(t / 1.9))
        }

        const cssW = view.cssWidth
        const cssH = view.cssHeight
        const sourceX = 0.5 * cssW
        const sourceY = -0.18 * cssH
        const mx = pointer.smoothUvX * cssW - sourceX
        const my = (1 - pointer.smoothUvY) * cssH - sourceY
        const ml = Math.hypot(mx, my) || 1
        const influence = 0.12
        const bx = (mx / ml) * influence
        const by = 1 + (my / ml - 1) * influence
        const bl = Math.hypot(bx, by) || 1

        const lightSpread = clamp(
          0.54 * intensity * (0.8 + audioReact * (treble * 0.45 + beatPulse * 0.35)),
          0.12,
          1.85
        )
        const rayLength = clamp(
          2.25 * scale * (0.85 + audioReact * (level * 0.35 + bass * 0.25)),
          0.6,
          4.8
        )
        const pulsating = clamp(
          0.22 + audioReact * (treble * 0.6 + beatPulse * 0.8),
          0,
          1
        )

        gl.uniform2f(u.uResolution, w, h)
        gl.uniform1f(u.uScale, view.dpr)
        gl.uniform1f(u.uTime, clocks['light-rays'])
        gl.uniform2f(u.uSource, sourceX, sourceY)
        gl.uniform2f(u.uAim, bx / bl, by / bl)
        gl.uniform1f(u.uReach, Math.max(cssW, cssH))
        gl.uniform3f(u.uColor, cAr, cAg, cAb)
        gl.uniform3f(u.uColorB, cCr, cCg, cCb)
        gl.uniform1f(u.uSpread, lightSpread)
        gl.uniform1f(u.uLength, rayLength)
        gl.uniform1f(u.uFade, 1.1)
        gl.uniform1f(u.uPulsating, pulsating)
        gl.uniform1f(u.uDistortion, 0.08 + audioReact * bass * 0.12)
        gl.uniform1f(u.uDensity, 1.05)
        gl.uniform1f(u.uSharpness, 0.36)
        gl.uniform1f(u.uGlow, 0.62 + audioReact * beatPulse * 0.25)
        gl.uniform1f(u.uHaze, 0.28)
        gl.uniform1f(u.uIntensity, 1.05 + audioReact * (level * 0.3 + beatPulse * 0.25))
        gl.uniform4f(
          u.uShadow,
          pointer.smoothUvX * cssW,
          (1 - pointer.smoothUvY) * cssH,
          pointer.presence * 0.7,
          16
        )
        gl.uniform4fv(u.uPulses, pulsesBuf)
        gl.uniform1f(u.uLightMode, lightMode)
      } else if (activeEffect === 'prism') {
        const timeScale =
          0.55 * speed + audioReact * (level * 0.55 + beatPulse * 0.45)
        if (!staticSnap) {
          clocks.prism += dt * timeScale
        }
        const targetYaw = pointer.inside ? -(pointer.smoothUvX * 2 - 1) * 0.18 : 0
        const targetPitch = pointer.inside ? (1 - pointer.smoothUvY * 2) * 0.18 : 0
        const inertiaFollow = staticSnap ? 1 : 1 - Math.pow(0.92, dt * 60)
        prismPose.yaw += (targetYaw - prismPose.yaw) * inertiaFollow
        prismPose.pitch += (targetPitch - prismPose.pitch) * inertiaFollow

        const t = clocks.prism
        writeRotation3x3(prismPose.yaw, prismPose.pitch, 0, prismTiltMat)
        writeRotation3x3(
          t * 0.55,
          Math.sin(t * 0.6 + 0.6) * 0.58,
          Math.sin(t * 0.35 + 1.9) * 0.48,
          prismSpinMat
        )
        multiplyMat3(prismTiltMat, prismSpinMat, prismRayMat)

        const hueShift = audioReact * (treble * 0.65 + beatPulse * 0.35)
        const hc = Math.cos(hueShift)
        const hs = Math.sin(hueShift)
        for (let i = 0; i < 9; i += 1) {
          prismHueMat[i] = HUE_W[i] + HUE_U[i] * hc + HUE_V[i] * hs
        }

        const baseWidth = 5.5
        const height = 3.5
        const half = baseWidth * 0.5
        const glow = clamp(
          1.05 * intensity * (0.72 + audioReact * (level * 0.95 + beatPulse * 0.85)),
          0.2,
          3.6
        )
        const prismScale = clamp(
          3.4 * scale * (1.0 + audioReact * (bass * 0.1 + beatPulse * 0.08)),
          1.0,
          7.8
        )

        gl.uniform2f(u.uResolution, w, h)
        gl.uniformMatrix3fv(u.uRay, false, prismRayMat)
        gl.uniform1f(u.uGlow, glow)
        gl.uniform1f(u.uColorFreq, 1.0)
        gl.uniform1f(u.uCenterShift, height * 0.25)
        gl.uniform1f(u.uInvBaseHalf, 1 / half)
        gl.uniform1f(u.uInvHeight, 1 / height)
        gl.uniform1f(u.uMinAxis, Math.min(half, height))
        gl.uniform1f(u.uPxScale, 1 / Math.max(1, h * 0.1 * prismScale))
        gl.uniform3f(u.uColorA, colorsCur[0], colorsCur[1], colorsCur[2])
        gl.uniform3f(u.uColorB, colorsCur[3], colorsCur[4], colorsCur[5])
        gl.uniform3f(u.uColorC, colorsCur[6], colorsCur[7], colorsCur[8])
        gl.uniform1f(u.uTime, t)
        gl.uniform1f(u.uSaturation, 1.45)
        gl.uniformMatrix3fv(u.uHue, false, prismHueMat)
        gl.uniform1f(u.uLightMode, lightMode)
      } else if (activeEffect === 'color-bends') {
        const bendsSpeed =
          0.28 * speed + audioReact * (level * 0.36 + bass * 0.26 + beatPulse * 0.3)
        if (!staticSnap) {
          clocks['color-bends'] += dt * bendsSpeed
        }
        const rotRad = ((90 + clocks['color-bends'] * 8) * Math.PI) / 180

        // 4 cover-derived stops: glowA, glowB, glowC, and mode-aware accent
        bendsColorsBuf[0] = cAr
        bendsColorsBuf[1] = cAg
        bendsColorsBuf[2] = cAb
        bendsColorsBuf[3] = cBr
        bendsColorsBuf[4] = cBg
        bendsColorsBuf[5] = cBb
        bendsColorsBuf[6] = cCr
        bendsColorsBuf[7] = cCg
        bendsColorsBuf[8] = cCb
        bendsColorsBuf[9] = colorsCur[12] * (1 - lightMode) + colorsCur[9] * lightMode
        bendsColorsBuf[10] = colorsCur[13] * (1 - lightMode) + colorsCur[10] * lightMode
        bendsColorsBuf[11] = colorsCur[14] * (1 - lightMode) + colorsCur[11] * lightMode

        const warpStrength = clamp(
          0.95 * intensity * (0.7 + audioReact * (bass * 0.75 + mid * 0.45 + beatPulse * 0.55)),
          0.1,
          2.5
        )
        const bendsScale = clamp(
          scale * (1.0 + audioReact * beatPulse * 0.06),
          0.3,
          2.5
        )
        const freq = clamp(
          1.0 + 0.16 * (intensity - 1.0) + audioReact * (mid * 0.22 + bass * 0.14),
          0.55,
          1.85
        )

        gl.uniform2f(u.uCanvas, view.cssWidth, view.cssHeight)
        gl.uniform1f(u.uTime, clocks['color-bends'])
        gl.uniform2f(u.uRot, Math.cos(rotRad), Math.sin(rotRad))
        gl.uniform3fv(u.uColors, bendsColorsBuf)
        gl.uniform1f(u.uScale, bendsScale)
        gl.uniform1f(u.uFrequency, freq)
        gl.uniform1f(u.uWarpStrength, warpStrength)
        gl.uniform2f(u.uPointer, pointer.smoothUvX * 2 - 1, pointer.smoothUvY * 2 - 1)
        gl.uniform1f(u.uMouseInfluence, 0.75)
        gl.uniform1f(u.uParallax, 0.45)
        gl.uniform1f(u.uIntensity, 1.35 + audioReact * (level * 0.25 + beatPulse * 0.2))
        gl.uniform1f(u.uBandWidth, 6.0)
        gl.uniform1f(u.uLightMode, lightMode)
      }

      gl.drawArrays(gl.TRIANGLES, 0, 3)
      return colorsMoving || paramsMoving
    }

    const tick = (now: number) => {
      rafId = 0
      if (!alive || contextLost || document.visibilityState === 'hidden') return
      const dt = lastTs > 0 ? clamp((now - lastTs) / 1000, 0.001, 0.05) : 1 / 60
      lastTs = now

      if (reducedMotionRef.current) {
        renderScene(dt, true)
        lastTs = 0
        return
      }

      renderScene(dt, false)
      rafId = window.requestAnimationFrame(tick)
    }

    const wake = () => {
      if (!alive || contextLost || document.visibilityState === 'hidden') return
      if (reducedMotionRef.current) {
        if (rafId) {
          window.cancelAnimationFrame(rafId)
          rafId = 0
        }
        renderScene(1 / 60, true)
        return
      }
      if (!rafId) {
        lastTs = 0
        rafId = window.requestAnimationFrame(tick)
      }
    }

    kickRef.current = wake

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, rect.width)
      const h = Math.max(1, rect.height)
      const x = (event.clientX - rect.left) / w
      const y = 1 - (event.clientY - rect.top) / h
      const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1
      pointer.uvX = clamp(x, 0, 1)
      pointer.uvY = clamp(y, 0, 1)
      pointer.inside = inside
      if (inside) pointer.seen = true
    }

    const onPointerDown = (event: PointerEvent) => {
      if (reducedMotionRef.current || effectRef.current !== 'light-rays') return
      const rect = canvas.getBoundingClientRect()
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        pulses.push({ age: 0, strength: 0.85 })
        if (pulses.length > 4) pulses.shift()
      }
    }

    const onPointerLeave = () => {
      pointer.inside = false
    }

    const onVisibilityChange = () => {
      lastTs = 0
      if (document.visibilityState === 'hidden') {
        if (rafId) {
          window.cancelAnimationFrame(rafId)
          rafId = 0
        }
      } else {
        wake()
      }
    }

    const onContextLost = (event: Event) => {
      event.preventDefault()
      contextLost = true
      if (rafId) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
    }

    const onContextRestored = () => {
      setContextGen((prev) => prev + 1)
    }

    const handleResize = () => {
      syncCanvasSize(effectRef.current)
      if (reducedMotionRef.current) {
        renderScene(1 / 60, true)
      } else {
        wake()
      }
    }

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(canvas)
    } else {
      window.addEventListener('resize', handleResize)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    document.documentElement.addEventListener('pointerleave', onPointerLeave)
    document.addEventListener('visibilitychange', onVisibilityChange)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)

    syncCanvasSize(effectRef.current)
    renderScene(1 / 60, reducedMotionRef.current)
    wake()

    return () => {
      alive = false
      kickRef.current = null
      if (rafId) window.cancelAnimationFrame(rafId)
      if (resizeObserver) resizeObserver.disconnect()
      else window.removeEventListener('resize', handleResize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)

      if (!gl.isContextLost()) {
        for (const entry of programCache.values()) {
          gl.deleteProgram(entry.program)
        }
        programCache.clear()
        gl.deleteBuffer(triBuffer)
      }
    }
  }, [contextGen])

  useEffect(() => {
    kickRef.current?.()
  }, [resolvedEffect, darkMode, palette, config, reducedMotion])

  return <canvas ref={canvasRef} aria-hidden="true" style={CANVAS_STYLE} />
}

export default ReactBitsStage
