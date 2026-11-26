import { useEffect, useRef, type CSSProperties } from 'react'
import {
  GrainGradientShapes,
  LiquidMetalShapes,
  ShaderFitOptions,
  ShaderMount,
  WarpPatterns,
  emptyPixel,
  getShaderColorFromString,
  getShaderNoiseTexture,
  godRaysFragmentShader,
  grainGradientFragmentShader,
  liquidMetalFragmentShader,
  meshGradientFragmentShader,
  metaballsFragmentShader,
  neuroNoiseFragmentShader,
  smokeRingFragmentShader,
  warpFragmentShader,
  type ShaderMountUniforms
} from '@paper-design/shaders'
import {
  createAudioAnalysisFrame,
  type AudioAnalysisFrame,
  type BlogAmbientEffectId,
  type BlogAmbientPalette,
  type BlogTrackVisualConfig
} from '../../../blog-ambient'

export type PaperEffectId =
  | 'mesh-gradient'
  | 'warp'
  | 'liquid-metal'
  | 'god-rays'
  | 'neuro-noise'
  | 'metaballs'
  | 'grain-gradient'
  | 'smoke-ring'

const PAPER_EFFECT_SET: ReadonlySet<string> = new Set<PaperEffectId>([
  'mesh-gradient',
  'warp',
  'liquid-metal',
  'god-rays',
  'neuro-noise',
  'metaballs',
  'grain-gradient',
  'smoke-ring'
])

export function isPaperEffect(id: BlogAmbientEffectId): id is PaperEffectId {
  return PAPER_EFFECT_SET.has(id)
}

export interface AmbientStageProps {
  effect: BlogAmbientEffectId
  darkMode: boolean
  palette: BlogAmbientPalette
  config: BlogTrackVisualConfig
  reducedMotion: boolean
  getAudioFrame?: () => AudioAnalysisFrame
  onFallback?: () => void
}

type RgbaTuple = [number, number, number, number]
type RgbUnit = [number, number, number]

const CONTAINER_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%'
}

const MAX_PIXEL_COUNT = 2_000_000
const MIN_PIXEL_RATIO = 1
const COLOR_TAU_S = 0.22
const PARAM_TAU_S = 0.08
const AUDIO_ATTACK_TAU_S = 0.032
const AUDIO_RELEASE_TAU_S = 0.095
const UNIFORM_EPSILON = 0.0004
const SPEED_EPSILON = 0.002

/** Airy gallery canvas (#f6f6f8) and deep obsidian (#0e0e14) in 0..1 RGB. */
const LIGHT_CANVAS_RGB: RgbUnit = [246 / 255, 246 / 255, 248 / 255]
const DARK_CANVAS_RGB: RgbUnit = [14 / 255, 14 / 255, 20 / 255]
const FALLBACK_GLOW_A: RgbUnit = [77 / 255, 73 / 255, 252 / 255]
const FALLBACK_GLOW_B: RgbUnit = [147 / 255, 51 / 255, 234 / 255]
const FALLBACK_GLOW_C: RgbUnit = [56 / 255, 189 / 255, 248 / 255]
const WHITE_RGB: RgbUnit = [1, 1, 1]

const SILENT_AUDIO_FRAME: AudioAnalysisFrame = createAudioAnalysisFrame()

/**
 * Per-shader base speed multiplier compensating for internal GLSL u_time scales
 * (e.g. warp scales u_time by 0.0625 while smoke-ring uses 1.0 * u_time) so
 * config.speed = 1.0 delivers balanced, unmistakable fluid motion across all 8 shaders.
 */
const SHADER_BASE_SPEED: Readonly<Record<PaperEffectId, number>> = {
  'mesh-gradient': 1.05,
  warp: 2.45,
  'liquid-metal': 0.95,
  'god-rays': 0.92,
  'neuro-noise': 1.0,
  metaballs: 1.38,
  'grain-gradient': 1.42,
  'smoke-ring': 1.35
}

const SHADER_FRAGMENTS: Readonly<Record<PaperEffectId, string>> = {
  'mesh-gradient': meshGradientFragmentShader,
  warp: warpFragmentShader,
  'liquid-metal': liquidMetalFragmentShader,
  'god-rays': godRaysFragmentShader,
  'neuro-noise': neuroNoiseFragmentShader,
  metaballs: metaballsFragmentShader,
  'grain-gradient': grainGradientFragmentShader,
  'smoke-ring': smokeRingFragmentShader
}

/* ==========================================================================
   Pre-decoded texture singletons (ShaderMount requires complete && naturalWidth > 0)
   ========================================================================== */

let readyNoiseImage: HTMLImageElement | null = null
let noiseImagePromise: Promise<HTMLImageElement> | null = null

let readyEmptyPixelImage: HTMLImageElement | null = null
let emptyPixelPromise: Promise<HTMLImageElement> | null = null

function isImageReady(img: HTMLImageElement | null | undefined): img is HTMLImageElement {
  return Boolean(img && img.complete && img.naturalWidth > 0)
}

function waitForImageDecode(img: HTMLImageElement): Promise<HTMLImageElement> {
  if (img.complete && img.naturalWidth > 0) {
    return Promise.resolve(img)
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      img.onload = null
      img.onerror = null
      if (img.naturalWidth > 0) {
        resolve(img)
      } else {
        reject(new Error('PaperShaderStage: texture decoded with zero dimensions'))
      }
    }
    const fail = () => {
      if (settled) return
      settled = true
      img.onload = null
      img.onerror = null
      reject(new Error('PaperShaderStage: failed to load shader texture'))
    }
    img.onload = done
    img.onerror = fail
    if (typeof img.decode === 'function') {
      img.decode().then(done).catch(() => {
        if (img.complete && img.naturalWidth > 0) done()
      })
    }
  })
}

function ensureNoiseTexture(): Promise<HTMLImageElement> {
  if (isImageReady(readyNoiseImage)) {
    return Promise.resolve(readyNoiseImage)
  }
  if (!noiseImagePromise) {
    noiseImagePromise = Promise.resolve()
      .then(() => {
        const img = getShaderNoiseTexture()
        if (!img) {
          throw new Error('PaperShaderStage: noise texture unavailable outside browser')
        }
        return waitForImageDecode(img)
      })
      .then((img) => {
        readyNoiseImage = img
        return img
      })
      .catch((err) => {
        noiseImagePromise = null
        throw err
      })
  }
  return noiseImagePromise
}

function ensureEmptyPixelTexture(): Promise<HTMLImageElement> {
  if (isImageReady(readyEmptyPixelImage)) {
    return Promise.resolve(readyEmptyPixelImage)
  }
  if (!emptyPixelPromise) {
    emptyPixelPromise = Promise.resolve()
      .then(() => {
        if (typeof Image === 'undefined') {
          throw new Error('PaperShaderStage: Image unavailable outside browser')
        }
        const img = new Image()
        img.src = emptyPixel
        return waitForImageDecode(img)
      })
      .then((img) => {
        readyEmptyPixelImage = img
        return img
      })
      .catch((err) => {
        emptyPixelPromise = null
        throw err
      })
  }
  return emptyPixelPromise
}

// Prime tiny base64 textures eagerly so effect mounts are synchronous in normal usage.
if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
  void ensureNoiseTexture().catch(() => {})
  void ensureEmptyPixelTexture().catch(() => {})
}

function effectNeedsNoiseTexture(effect: PaperEffectId): boolean {
  return (
    effect === 'warp' ||
    effect === 'god-rays' ||
    effect === 'metaballs' ||
    effect === 'grain-gradient' ||
    effect === 'smoke-ring'
  )
}

/* ==========================================================================
   Color & Math Helpers
   ========================================================================== */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function parseRgbTripletUnit(raw: string, fallback: RgbUnit): RgbUnit {
  const parts = raw.split(',')
  if (parts.length >= 3) {
    const r = Number(parts[0]?.trim())
    const g = Number(parts[1]?.trim())
    const b = Number(parts[2]?.trim())
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [clamp(r / 255, 0, 1), clamp(g / 255, 0, 1), clamp(b / 255, 0, 1)]
    }
  }
  return fallback
}

function parseHexColorUnit(hex: string, fallback: RgbUnit): RgbUnit {
  const rgba = getShaderColorFromString(hex)
  if (
    Array.isArray(rgba) &&
    Number.isFinite(rgba[0]) &&
    Number.isFinite(rgba[1]) &&
    Number.isFinite(rgba[2])
  ) {
    return [rgba[0], rgba[1], rgba[2]]
  }
  return fallback
}

function mixRgb(a: RgbUnit, b: RgbUnit, ratio: number): RgbUnit {
  const t = clamp(ratio, 0, 1)
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function scaleRgb(a: RgbUnit, factor: number): RgbUnit {
  return [clamp(a[0] * factor, 0, 1), clamp(a[1] * factor, 0, 1), clamp(a[2] * factor, 0, 1)]
}

function toRgba(rgb: RgbUnit, alpha = 1): RgbaTuple {
  return [clamp(rgb[0], 0, 1), clamp(rgb[1], 0, 1), clamp(rgb[2], 0, 1), clamp(alpha, 0, 1)]
}

/**
 * Writes 16 target color/theme floats:
 * [0..2] glowA, [3..5] glowB, [6..8] glowC, [9..11] accentLight, [12..14] accentDark, [15] darkMix
 */
function writeColorTargets(palette: BlogAmbientPalette, darkMode: boolean, out: Float32Array): void {
  const gA = parseRgbTripletUnit(palette.glowA, FALLBACK_GLOW_A)
  const gB = parseRgbTripletUnit(palette.glowB, FALLBACK_GLOW_B)
  const gC = parseRgbTripletUnit(palette.glowC, FALLBACK_GLOW_C)
  const accL = parseHexColorUnit(palette.accentLight, gA)
  const accD = parseHexColorUnit(palette.accentDark, gC)

  out[0] = gA[0]
  out[1] = gA[1]
  out[2] = gA[2]
  out[3] = gB[0]
  out[4] = gB[1]
  out[5] = gB[2]
  out[6] = gC[0]
  out[7] = gC[1]
  out[8] = gC[2]
  out[9] = accL[0]
  out[10] = accL[1]
  out[11] = accL[2]
  out[12] = accD[0]
  out[13] = accD[1]
  out[14] = accD[2]
  out[15] = darkMode ? 1 : 0
}

function stepFloatBuffer(current: Float32Array, target: Float32Array, k: number): boolean {
  let moving = false
  for (let i = 0; i < current.length; i += 1) {
    const diff = target[i] - current[i]
    if (Math.abs(diff) > 0.0004) {
      current[i] += diff * k
      moving = true
    } else if (current[i] !== target[i]) {
      current[i] = target[i]
      moving = true
    }
  }
  return moving
}

interface UnpackedColors {
  glowA: RgbUnit
  glowB: RgbUnit
  glowC: RgbUnit
  accentLight: RgbUnit
  accentDark: RgbUnit
  darkMix: number
  canvasBack: RgbUnit
}

function unpackColors(buf: Float32Array): UnpackedColors {
  const glowA: RgbUnit = [buf[0], buf[1], buf[2]]
  const glowB: RgbUnit = [buf[3], buf[4], buf[5]]
  const glowC: RgbUnit = [buf[6], buf[7], buf[8]]
  const accentLight: RgbUnit = [buf[9], buf[10], buf[11]]
  const accentDark: RgbUnit = [buf[12], buf[13], buf[14]]
  const darkMix = clamp(buf[15], 0, 1)

  const lightBack = mixRgb(LIGHT_CANVAS_RGB, glowA, 0.04)
  const darkBack = mixRgb(DARK_CANVAS_RGB, glowA, 0.06)
  const canvasBack = mixRgb(lightBack, darkBack, darkMix)

  return {
    glowA,
    glowB,
    glowC,
    accentLight,
    accentDark,
    darkMix,
    canvasBack
  }
}

function buildColorUniforms(effect: PaperEffectId, c: UnpackedColors): ShaderMountUniforms {
  const { glowA, glowB, glowC, accentLight, accentDark, darkMix, canvasBack } = c

  switch (effect) {
    case 'mesh-gradient':
    case 'warp': {
      // Slot 0 anchors the airy #f6f6f8 gallery (light) / #0e0e14 obsidian (dark) pocket
      // while slots 1..3 carry vivid cover colors so frosted cards remain razor-sharp.
      const stop0 = mixRgb(
        mixRgb(LIGHT_CANVAS_RGB, glowA, 0.06),
        mixRgb(DARK_CANVAS_RGB, glowA, 0.1),
        darkMix
      )
      const stop1 = mixRgb(mixRgb(glowA, WHITE_RGB, 0.1), scaleRgb(glowA, 0.92), darkMix)
      const stop2 = mixRgb(mixRgb(glowB, WHITE_RGB, 0.14), scaleRgb(glowB, 0.88), darkMix)
      const stop3 = mixRgb(
        mixRgb(glowC, WHITE_RGB, 0.16),
        mixRgb(glowC, accentDark, 0.35),
        darkMix
      )
      return {
        u_colors: [toRgba(stop0, 1), toRgba(stop1, 1), toRgba(stop2, 1), toRgba(stop3, 1)],
        u_colorsCount: 4
      }
    }

    case 'liquid-metal': {
      // LiquidMetal applies u_colorTint via color-burn; lifting light-mode tint keeps
      // gallery-silver speculars bright while imbuing midtones with vivid cover reflections.
      const baseHue = mixRgb(glowA, glowB, 0.32)
      const lightTint = mixRgb(baseHue, WHITE_RGB, 0.28)
      const darkTint = mixRgb(baseHue, accentDark, 0.2)
      const tintRgb = mixRgb(lightTint, darkTint, darkMix)
      const tintAlpha = lerp(0.64, 0.82, darkMix)
      return {
        u_colorBack: toRgba(canvasBack, 1),
        u_colorTint: toRgba(tintRgb, tintAlpha)
      }
    }

    case 'god-rays': {
      // Light mode uses saturated deeper cover rays with low additive bloom so rays
      // contrast crisply against #f6f6f8 instead of washing out to pure white.
      const ray0 = mixRgb(mixRgb(glowA, accentLight, 0.38), glowA, darkMix)
      const ray1 = mixRgb(mixRgb(glowB, accentLight, 0.3), glowB, darkMix)
      const ray2 = mixRgb(mixRgb(glowC, accentLight, 0.32), glowC, darkMix)
      const ray3 = mixRgb(accentLight, accentDark, darkMix)
      const rayAlpha = lerp(0.86, 0.9, darkMix)
      const bloomRgb = mixRgb(glowA, accentDark, lerp(0.25, 0.65, darkMix))
      return {
        u_colorBack: toRgba(canvasBack, 1),
        u_colorBloom: toRgba(bloomRgb, lerp(0.28, 0.68, darkMix)),
        u_colors: [
          toRgba(ray0, rayAlpha),
          toRgba(ray1, rayAlpha),
          toRgba(ray2, rayAlpha),
          toRgba(ray3, rayAlpha)
        ],
        u_colorsCount: 4
      }
    }

    case 'neuro-noise': {
      // NeuroNoise multiplies blendFront by up to 1.4x at crossing nodes; scaling light-mode
      // front color prevents white-clipping so neural nodes glow with rich cover chroma on #f6f6f8.
      const midLight = mixRgb(accentLight, glowB, 0.45)
      const midDark = mixRgb(glowB, glowA, 0.5)
      const frontLight = scaleRgb(mixRgb(glowA, glowC, 0.52), 0.78)
      const frontDark = mixRgb(glowC, WHITE_RGB, 0.26)
      return {
        u_colorBack: toRgba(canvasBack, 1),
        u_colorMid: toRgba(mixRgb(midLight, midDark, darkMix), lerp(0.88, 0.94, darkMix)),
        u_colorFront: toRgba(mixRgb(frontLight, frontDark, darkMix), lerp(0.95, 1.0, darkMix))
      }
    }

    case 'metaballs': {
      const ball0 = mixRgb(mixRgb(glowA, accentLight, 0.18), glowA, darkMix)
      const ball1 = mixRgb(mixRgb(glowB, accentLight, 0.14), glowB, darkMix)
      const ball2 = mixRgb(mixRgb(glowC, accentLight, 0.16), glowC, darkMix)
      const ball3 = mixRgb(accentLight, accentDark, darkMix)
      const ballAlpha = lerp(0.86, 0.92, darkMix)
      return {
        u_colorBack: toRgba(canvasBack, 1),
        u_colors: [
          toRgba(ball0, ballAlpha),
          toRgba(ball1, ballAlpha),
          toRgba(ball2, ballAlpha),
          toRgba(ball3, ballAlpha)
        ],
        u_colorsCount: 4
      }
    }

    case 'grain-gradient': {
      const band0 = mixRgb(mixRgb(glowA, accentLight, 0.24), glowA, darkMix)
      const band1 = glowB
      const band2 = glowC
      const band3 = mixRgb(mixRgb(glowA, WHITE_RGB, 0.2), accentDark, darkMix)
      const bandAlpha = lerp(0.92, 0.96, darkMix)
      return {
        u_colorBack: toRgba(canvasBack, 1),
        u_colors: [
          toRgba(band0, bandAlpha),
          toRgba(band1, bandAlpha),
          toRgba(band2, bandAlpha),
          toRgba(band3, bandAlpha)
        ],
        u_colorsCount: 4
      }
    }

    case 'smoke-ring': {
      // In SmokeRing, u_colors[0] is the dense inner ring core and u_colors[3] is the outer smoke wisp.
      const core = mixRgb(accentLight, mixRgb(accentDark, WHITE_RGB, 0.18), darkMix)
      const mid1 = mixRgb(glowA, glowC, darkMix)
      const mid2 = glowB
      const outer = mixRgb(glowC, glowA, darkMix)
      return {
        u_colorBack: toRgba(canvasBack, 1),
        u_colors: [
          toRgba(core, lerp(0.94, 0.96, darkMix)),
          toRgba(mid1, lerp(0.9, 0.92, darkMix)),
          toRgba(mid2, lerp(0.88, 0.9, darkMix)),
          toRgba(outer, lerp(0.85, 0.88, darkMix))
        ],
        u_colorsCount: 4
      }
    }
  }
}

interface SmoothedDynamics {
  speed: number
  intensity: number
  scale: number
  audioReactivity: number
  darkMix: number
  level: number
  bass: number
  mid: number
  treble: number
  beatPulse: number
}

function buildStaticSizingUniforms(effect: PaperEffectId): ShaderMountUniforms {
  let fit: number = ShaderFitOptions.cover
  let rotation = 0
  if (effect === 'warp') {
    fit = ShaderFitOptions.none
    rotation = -14
  } else if (effect === 'neuro-noise') {
    fit = ShaderFitOptions.none
  } else if (effect === 'grain-gradient') {
    fit = ShaderFitOptions.none
    rotation = -18
  } else if (effect === 'smoke-ring') {
    fit = ShaderFitOptions.contain
  }

  return {
    u_fit: fit,
    u_rotation: rotation,
    u_originX: 0.5,
    u_originY: 0.5,
    u_offsetX: 0,
    u_offsetY: 0,
    u_worldWidth: 0,
    u_worldHeight: 0
  }
}

function computeDynamicNumericUniforms(
  effect: PaperEffectId,
  d: SmoothedDynamics
): Record<string, number> {
  const { intensity, scale, audioReactivity: react, darkMix, level, bass, mid, treble, beatPulse } = d
  const beatBreath = 1 + react * (beatPulse * 0.055 + bass * 0.035)

  switch (effect) {
    case 'mesh-gradient':
      return {
        u_scale: clamp(scale * beatBreath, 0.25, 3.2),
        u_distortion: clamp(0.32 + intensity * 0.34 + react * (bass * 0.22 + level * 0.12), 0.06, 1.0),
        u_swirl: clamp(0.24 + intensity * 0.36 + react * (mid * 0.2 + beatPulse * 0.22), 0.04, 1.0),
        u_grainMixer: clamp(0.05 + intensity * 0.07 + react * treble * 0.08, 0, 0.42),
        u_grainOverlay: lerp(0.025, 0.045, darkMix)
      }

    case 'warp':
      return {
        u_scale: clamp(scale * beatBreath, 0.25, 3.2),
        u_shape: WarpPatterns.checks,
        u_shapeScale: clamp(0.24 + 0.14 / Math.max(0.35, scale), 0.1, 0.72),
        u_proportion: clamp(0.5 + react * (bass - treble) * 0.1, 0.32, 0.68),
        u_softness: clamp(1.0 - intensity * 0.18 + react * level * 0.08, 0.55, 1.0),
        u_distortion: clamp(0.18 + intensity * 0.24 + react * (bass * 0.18 + level * 0.1), 0.04, 0.95),
        u_swirl: clamp(0.32 + intensity * 0.34 + react * (mid * 0.18 + beatPulse * 0.2), 0.06, 1.0),
        u_swirlIterations: 10
      }

    case 'liquid-metal':
      return {
        u_scale: clamp((0.98 + scale * 0.18) * beatBreath, 0.35, 3.2),
        u_repetition: clamp(2.0 + (2.3 - scale) * 1.45 + intensity * 0.75, 1.2, 7.5),
        u_softness: lerp(
          clamp(0.66 - intensity * 0.12, 0.34, 0.88),
          clamp(0.42 - intensity * 0.1, 0.16, 0.74),
          darkMix
        ),
        u_shiftRed: clamp(0.22 + intensity * 0.22 + react * (beatPulse * 0.36 + treble * 0.18), -1, 1),
        u_shiftBlue: clamp(0.22 + intensity * 0.22 + react * (beatPulse * 0.36 + bass * 0.18), -1, 1),
        u_distortion: clamp(0.18 + intensity * 0.34 + react * (bass * 0.28 + level * 0.14), 0.04, 1.0),
        u_contour: clamp(0.46 + intensity * 0.24 + react * beatPulse * 0.22, 0.2, 1.0),
        u_angle: 25 + react * (mid * 10 + beatPulse * 6),
        u_shape: LiquidMetalShapes.none
      }

    case 'god-rays':
      return {
        u_scale: clamp((0.88 + scale * 0.16) * beatBreath, 0.35, 2.8),
        u_density: clamp(0.18 + scale * 0.26, 0.12, 0.82),
        u_intensity: clamp(0.4 + intensity * 0.28 + react * (level * 0.18 + beatPulse * 0.16), 0.16, 0.98),
        u_bloom: lerp(
          clamp(0.05 + react * beatPulse * 0.1, 0.02, 0.18),
          clamp(0.44 + intensity * 0.22 + react * beatPulse * 0.24, 0.2, 0.95),
          darkMix
        ),
        u_spotty: clamp(0.26 + (2.0 - intensity) * 0.15 + react * treble * 0.18, 0.1, 0.85),
        u_midSize: clamp(0.16 + react * (bass * 0.12 + beatPulse * 0.1), 0.08, 0.48),
        u_midIntensity: lerp(
          clamp(0.22 + react * beatPulse * 0.22, 0.1, 0.55),
          clamp(0.36 + react * beatPulse * 0.34, 0.16, 0.86),
          darkMix
        )
      }

    case 'neuro-noise':
      return {
        u_scale: clamp(scale * 1.05 * beatBreath, 0.25, 3.2),
        u_brightness: clamp(0.16 + intensity * 0.16 + react * (level * 0.18 + beatPulse * 0.22), 0.06, 0.72),
        u_contrast: clamp(0.24 + intensity * 0.14 + react * (bass * 0.1 - beatPulse * 0.04), 0.12, 0.62)
      }

    case 'metaballs':
      return {
        u_scale: clamp((0.84 + scale * 0.22) * beatBreath, 0.35, 2.6),
        u_count: clamp(4 + intensity * 6.5 + react * (level * 1.8 + beatPulse * 1.4), 3, 18),
        u_size: clamp(0.42 + scale * 0.22 + react * (bass * 0.14 + beatPulse * 0.12), 0.18, 0.94)
      }

    case 'grain-gradient':
      return {
        u_scale: clamp(scale * 1.15 * beatBreath, 0.3, 3.4),
        u_shape: GrainGradientShapes.wave,
        u_softness: clamp(0.72 - intensity * 0.12 + react * mid * 0.1, 0.35, 1.0),
        u_intensity: clamp(0.22 + intensity * 0.3 + react * (bass * 0.22 + level * 0.14), 0.06, 0.95),
        u_noise: clamp(0.16 + intensity * 0.28 + react * (treble * 0.18 + beatPulse * 0.12), 0.04, 0.88)
      }

    case 'smoke-ring':
      return {
        u_scale: clamp((0.84 + scale * 0.2) * beatBreath, 0.4, 2.2),
        u_thickness: clamp(0.22 + intensity * 0.24 + react * (bass * 0.16 + level * 0.12), 0.1, 0.85),
        u_radius: clamp(0.18 + scale * 0.15 + react * (beatPulse * 0.06 + bass * 0.04), 0.1, 0.58),
        u_innerShape: 0.88,
        u_noiseScale: clamp(1.6 + intensity * 0.65 + react * treble * 0.45, 0.6, 4.2),
        u_noiseIterations: 6
      }
  }
}

function computeTargetSpeed(effect: PaperEffectId, d: SmoothedDynamics, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  const base = SHADER_BASE_SPEED[effect]
  const liveBoost = d.audioReactivity * (d.level * 0.8 + d.beatPulse * 0.65)
  return clamp(base * (d.speed + liveBoost), 0.06, 8.0)
}

/* ==========================================================================
   Component
   ========================================================================== */

export function PaperShaderStage({
  effect,
  darkMode,
  palette,
  config,
  reducedMotion,
  getAudioFrame,
  onFallback
}: AmbientStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const configRef = useRef<BlogTrackVisualConfig>(config)
  configRef.current = config

  const paletteRef = useRef<BlogAmbientPalette>(palette)
  paletteRef.current = palette

  const darkModeRef = useRef<boolean>(darkMode)
  darkModeRef.current = darkMode

  const reducedMotionRef = useRef<boolean>(reducedMotion)
  reducedMotionRef.current = reducedMotion

  const getAudioFrameRef = useRef(getAudioFrame)
  getAudioFrameRef.current = getAudioFrame

  const onFallbackRef = useRef(onFallback)
  onFallbackRef.current = onFallback

  const syncControlRef = useRef<((forceStaticSnap?: boolean) => void) | null>(null)

  const resolvedEffect: PaperEffectId = isPaperEffect(effect) ? effect : 'mesh-gradient'

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof window === 'undefined') return

    let disposed = false
    let mount: ShaderMount | null = null
    let rafId: number | null = null
    let removeContextLostListener: (() => void) | null = null

    const colorCurrent = new Float32Array(16)
    const colorTarget = new Float32Array(16)
    writeColorTargets(paletteRef.current, darkModeRef.current, colorCurrent)
    colorTarget.set(colorCurrent)

    const initialCfg = configRef.current
    const dynamics: SmoothedDynamics = {
      speed: clamp(initialCfg.speed, 0.1, 2.5),
      intensity: clamp(initialCfg.intensity, 0.1, 2.0),
      scale: clamp(initialCfg.scale, 0.3, 2.2),
      audioReactivity: clamp(initialCfg.audioReactivity, 0, 2.0),
      darkMix: darkModeRef.current ? 1 : 0,
      level: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      beatPulse: 0
    }

    let appliedNumeric: Record<string, number> = {}
    let appliedSpeed = 0
    let lastTickMs = performance.now()

    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    const applyImmediateSnap = () => {
      if (!mount || disposed) return
      const cfg = configRef.current
      writeColorTargets(paletteRef.current, darkModeRef.current, colorCurrent)
      colorTarget.set(colorCurrent)

      dynamics.speed = clamp(cfg.speed, 0.1, 2.5)
      dynamics.intensity = clamp(cfg.intensity, 0.1, 2.0)
      dynamics.scale = clamp(cfg.scale, 0.3, 2.2)
      dynamics.audioReactivity = clamp(cfg.audioReactivity, 0, 2.0)
      dynamics.darkMix = colorCurrent[15]
      dynamics.level = 0
      dynamics.bass = 0
      dynamics.mid = 0
      dynamics.treble = 0
      dynamics.beatPulse = 0

      const nextColors = buildColorUniforms(resolvedEffect, unpackColors(colorCurrent))
      const nextNumeric = computeDynamicNumericUniforms(resolvedEffect, dynamics)
      appliedNumeric = { ...nextNumeric }

      const nextSpeed = computeTargetSpeed(resolvedEffect, dynamics, reducedMotionRef.current)
      appliedSpeed = nextSpeed
      mount.setSpeed(nextSpeed)
      mount.setUniforms({ ...nextColors, ...nextNumeric })
    }

    const tick = (now: number) => {
      rafId = null
      if (disposed || !mount) return
      if (reducedMotionRef.current || document.visibilityState === 'hidden') {
        return
      }

      const dt = Math.min(0.1, Math.max(1 / 240, (now - lastTickMs) / 1000))
      lastTickMs = now

      // 1. Smoothly interpolate palette & light/dark canvas transition (~650ms)
      writeColorTargets(paletteRef.current, darkModeRef.current, colorTarget)
      const colorK = 1 - Math.exp(-dt / COLOR_TAU_S)
      const colorsMoving = stepFloatBuffer(colorCurrent, colorTarget, colorK)
      dynamics.darkMix = colorCurrent[15]

      // 2. Smoothly interpolate slider/preset parameters (~150ms)
      const cfg = configRef.current
      const paramK = 1 - Math.exp(-dt / PARAM_TAU_S)
      dynamics.speed += (clamp(cfg.speed, 0.1, 2.5) - dynamics.speed) * paramK
      dynamics.intensity += (clamp(cfg.intensity, 0.1, 2.0) - dynamics.intensity) * paramK
      dynamics.scale += (clamp(cfg.scale, 0.3, 2.2) - dynamics.scale) * paramK
      dynamics.audioReactivity += (clamp(cfg.audioReactivity, 0, 2.0) - dynamics.audioReactivity) * paramK

      // 3. Read zero-allocation DSP audio frame and envelope-smooth transients
      const rawFrame = getAudioFrameRef.current ? getAudioFrameRef.current() : SILENT_AUDIO_FRAME
      const isAudioActive = rawFrame.active
      const targetLevel = isAudioActive ? clamp(rawFrame.level, 0, 1) : 0
      const targetBass = isAudioActive ? clamp(rawFrame.bass, 0, 1) : 0
      const targetMid = isAudioActive ? clamp(rawFrame.mid, 0, 1) : 0
      const targetTreble = isAudioActive ? clamp(rawFrame.treble, 0, 1) : 0
      const targetBeat = isAudioActive ? clamp(rawFrame.beatPulse, 0, 1) : 0

      const attackK = 1 - Math.exp(-dt / AUDIO_ATTACK_TAU_S)
      const releaseK = 1 - Math.exp(-dt / AUDIO_RELEASE_TAU_S)

      dynamics.level += (targetLevel - dynamics.level) * (targetLevel > dynamics.level ? attackK : releaseK)
      dynamics.bass += (targetBass - dynamics.bass) * (targetBass > dynamics.bass ? attackK : releaseK)
      dynamics.mid += (targetMid - dynamics.mid) * (targetMid > dynamics.mid ? attackK : releaseK)
      dynamics.treble += (targetTreble - dynamics.treble) * (targetTreble > dynamics.treble ? attackK : releaseK)
      dynamics.beatPulse +=
        (targetBeat - dynamics.beatPulse) * (targetBeat > dynamics.beatPulse ? attackK : releaseK)

      // 4. Push speed & changed uniforms to ShaderMount
      const nextSpeed = computeTargetSpeed(resolvedEffect, dynamics, false)
      if (Math.abs(nextSpeed - appliedSpeed) > SPEED_EPSILON) {
        appliedSpeed = nextSpeed
        mount.setSpeed(nextSpeed)
      }

      const nextNumeric = computeDynamicNumericUniforms(resolvedEffect, dynamics)
      let hasUniformChanges = colorsMoving
      const uniformPatch: ShaderMountUniforms = colorsMoving
        ? buildColorUniforms(resolvedEffect, unpackColors(colorCurrent))
        : {}

      for (const key of Object.keys(nextNumeric)) {
        const val = nextNumeric[key]
        const prev = appliedNumeric[key]
        if (prev === undefined || Math.abs(val - prev) > UNIFORM_EPSILON) {
          appliedNumeric[key] = val
          uniformPatch[key] = val
          hasUniformChanges = true
        }
      }

      if (hasUniformChanges) {
        mount.setUniforms(uniformPatch)
      }

      rafId = requestAnimationFrame(tick)
    }

    const syncControl = (forceStaticSnap = false) => {
      if (disposed || !mount) return
      if (reducedMotionRef.current) {
        stopLoop()
        if (appliedSpeed !== 0) {
          appliedSpeed = 0
          mount.setSpeed(0)
        }
        if (forceStaticSnap) {
          applyImmediateSnap()
        }
        return
      }
      if (document.visibilityState === 'hidden') {
        stopLoop()
        return
      }
      if (rafId === null) {
        lastTickMs = performance.now()
        rafId = requestAnimationFrame(tick)
      }
    }

    const handleVisibilityChange = () => {
      syncControl(false)
    }

    const mountWithTextures = (noiseImg?: HTMLImageElement, emptyImg?: HTMLImageElement) => {
      if (disposed) return
      try {
        const sizingUniforms = buildStaticSizingUniforms(resolvedEffect)
        const colorUniforms = buildColorUniforms(resolvedEffect, unpackColors(colorCurrent))
        const numericUniforms = computeDynamicNumericUniforms(resolvedEffect, dynamics)
        appliedNumeric = { ...numericUniforms }

        const initialUniforms: ShaderMountUniforms = {
          ...sizingUniforms,
          ...colorUniforms,
          ...numericUniforms
        }

        if (noiseImg) {
          initialUniforms.u_noiseTexture = noiseImg
        }
        if (resolvedEffect === 'liquid-metal' && emptyImg) {
          initialUniforms.u_image = emptyImg
          initialUniforms.u_isImage = false
        }

        const initialSpeed = computeTargetSpeed(resolvedEffect, dynamics, reducedMotionRef.current)
        appliedSpeed = initialSpeed

        mount = new ShaderMount(
          container,
          SHADER_FRAGMENTS[resolvedEffect],
          initialUniforms,
          undefined,
          initialSpeed,
          0,
          MIN_PIXEL_RATIO,
          MAX_PIXEL_COUNT
        )

        const onContextLost = (event: Event) => {
          event.preventDefault()
          if (!disposed) {
            onFallbackRef.current?.()
          }
        }
        mount.canvasElement.addEventListener('webglcontextlost', onContextLost)
        removeContextLostListener = () => {
          mount?.canvasElement.removeEventListener('webglcontextlost', onContextLost)
        }

        syncControlRef.current = syncControl
        document.addEventListener('visibilitychange', handleVisibilityChange)
        syncControl(reducedMotionRef.current)
      } catch {
        if (!disposed) {
          onFallbackRef.current?.()
        }
      }
    }

    // Mount synchronously whenever pre-decoded textures are already hot; otherwise await decode.
    if (resolvedEffect === 'liquid-metal') {
      if (isImageReady(readyEmptyPixelImage)) {
        mountWithTextures(undefined, readyEmptyPixelImage)
      } else {
        void ensureEmptyPixelTexture()
          .then((img) => mountWithTextures(undefined, img))
          .catch(() => {
            if (!disposed) onFallbackRef.current?.()
          })
      }
    } else if (effectNeedsNoiseTexture(resolvedEffect)) {
      if (isImageReady(readyNoiseImage)) {
        mountWithTextures(readyNoiseImage, undefined)
      } else {
        void ensureNoiseTexture()
          .then((img) => mountWithTextures(img, undefined))
          .catch(() => {
            if (!disposed) onFallbackRef.current?.()
          })
      }
    } else {
      mountWithTextures()
    }

    return () => {
      disposed = true
      syncControlRef.current = null
      stopLoop()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      removeContextLostListener?.()
      removeContextLostListener = null
      if (mount) {
        try {
          mount.dispose()
        } catch {
          // Ignore WebGL cleanup errors on torn-down contexts.
        }
        mount = null
      }
    }
  }, [resolvedEffect])

  // Update loop state or render static frames when reducedMotion / config / palette / darkMode change.
  useEffect(() => {
    syncControlRef.current?.(reducedMotion)
  }, [reducedMotion, config, palette, darkMode])

  return <div ref={containerRef} className="blog-paper-shader-stage" style={CONTAINER_STYLE} />
}

export default PaperShaderStage
