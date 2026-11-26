import type {
  BlogAmbientEffectGroup,
  BlogAmbientEffectId,
  BlogTrackVisualConfig
} from './blog-types'

export type BlogAmbientMode = 'active' | 'minimal'
export type {
  BlogAmbientEffectGroup,
  BlogAmbientEffectId,
  BlogTrackVisualConfig
} from './blog-types'

export interface BlogAmbientPalette {
  accentLight: string       // hex clamped to WCAG-legible lightness 36%-46% on white
  accentLightHover: string
  accentLightSoft: string   // rgba(..., 0.10)
  accentLightRgb: string    // 'r, g, b'
  accentDark: string        // luminous hue clamped to lightness 66%-76% on dark
  accentDarkHover: string
  accentDarkSoft: string    // rgba(..., 0.16)
  accentDarkRgb: string     // 'r, g, b'
  glowA: string             // 'r, g, b'
  glowB: string             // 'r, g, b'
  glowC: string             // 'r, g, b'
}

export const BLOG_AMBIENT_MODE_KEY = 'do-it-laaaaaater.blog.ambient-mode.v1'

const SAMPLE_SIZE = 48
const HUE_BUCKET_COUNT = 24
const MIN_COLORFUL_PIXELS = 18
const IMAGE_LOAD_TIMEOUT_MS = 6000

const paletteCache = new Map<string, BlogAmbientPalette | null>()
const inflightExtractions = new Map<string, Promise<BlogAmbientPalette | null>>()

export const DEFAULT_AMBIENT_PALETTE: BlogAmbientPalette = {
  accentLight: '#4340d6',
  accentLightHover: '#3532b8',
  accentLightSoft: 'rgba(67, 64, 214, 0.10)',
  accentLightRgb: '67, 64, 214',
  accentDark: '#8b95f9',
  accentDarkHover: '#a5adfc',
  accentDarkSoft: 'rgba(139, 149, 249, 0.16)',
  accentDarkRgb: '139, 149, 249',
  glowA: '77, 73, 252',
  glowB: '147, 51, 234',
  glowC: '56, 189, 248'
}

export const BLOG_AMBIENT_MODES: readonly BlogAmbientMode[] = ['active', 'minimal']

/** Legacy persisted modes all migrate cleanly to `'active'` so existing visitors keep visual effects on. */
const LEGACY_ACTIVE_AMBIENT_MODES = new Set(['waves', 'silk', 'vinyl', 'wallpaper', 'glow'])

export function isBlogAmbientMode(value: unknown): value is BlogAmbientMode {
  return value === 'active' || value === 'minimal'
}

export function normalizeAmbientMode(raw: unknown): BlogAmbientMode {
  if (isBlogAmbientMode(raw)) return raw
  if (typeof raw === 'string' && LEGACY_ACTIVE_AMBIENT_MODES.has(raw)) return 'active'
  return 'active'
}

export function readAmbientMode(): BlogAmbientMode {
  try {
    const storage = globalThis.localStorage
    const raw = storage?.getItem(BLOG_AMBIENT_MODE_KEY)
    const mode = normalizeAmbientMode(raw)
    // Rewrite legacy values once so storage stays clean for every later read.
    if (raw && raw !== mode && LEGACY_ACTIVE_AMBIENT_MODES.has(raw)) {
      storage?.setItem(BLOG_AMBIENT_MODE_KEY, mode)
    }
    return mode
  } catch {
    // Ignore storage access errors in restricted browsing modes.
  }
  return 'active'
}

export function saveAmbientMode(mode: BlogAmbientMode): void {
  if (!isBlogAmbientMode(mode)) return
  try {
    globalThis.localStorage?.setItem(BLOG_AMBIENT_MODE_KEY, mode)
  } catch {
    // Ignore quota / storage errors.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) {
    return [0, 0, l]
  }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) * 60
  } else {
    h = ((rn - gn) / d + 4) * 60
  }
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = normalizeHue(h)
  const sat = clamp(s, 0, 1)
  const light = clamp(l, 0, 1)

  if (sat === 0) {
    const gray = Math.round(light * 255)
    return [gray, gray, gray]
  }

  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = light - c / 2

  let r1 = 0
  let g1 = 0
  let b1 = 0

  if (hue < 60) {
    r1 = c
    g1 = x
  } else if (hue < 120) {
    r1 = x
    g1 = c
  } else if (hue < 180) {
    g1 = c
    b1 = x
  } else if (hue < 240) {
    g1 = x
    b1 = c
  } else if (hue < 300) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }

  return [
    Math.round(clamp((r1 + m) * 255, 0, 255)),
    Math.round(clamp((g1 + m) * 255, 0, 255)),
    Math.round(clamp((b1 + m) * 255, 0, 255))
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function formatRgbTriplet(rgb: [number, number, number]): string {
  return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function relativeLuminance(rgb: [number, number, number]): number {
  return (
    0.2126 * srgbChannelToLinear(rgb[0]) +
    0.7152 * srgbChannelToLinear(rgb[1]) +
    0.0722 * srgbChannelToLinear(rgb[2])
  )
}

function contrastRatio(lumA: number, lumB: number): number {
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeHue(a - b))
  return diff > 180 ? 360 - diff : diff
}

/**
 * Keeps yellow/amber/lime glow colors luminous rather than muddy olive/brown.
 */
function crispGlowLightness(hue: number, targetLight: number, minLight = 0.52, maxLight = 0.65): number {
  const h = normalizeHue(hue)
  const warmYellowZone = h >= 32 && h <= 98
  const floor = warmYellowZone ? Math.max(minLight, 0.56) : minLight
  return clamp(targetLight, floor, maxLight)
}

/**
 * Derives a WCAG-legible accent on white (#ffffff) with HSL lightness strictly within 36%-46%,
 * stepping lightness down toward 36% for bright yellow/green/cyan hues so contrast stays crisp.
 */
function deriveLightAccent(hue: number, sat: number): {
  accent: [number, number, number]
  hover: [number, number, number]
} {
  const s = clamp(sat, 0.58, 0.88)
  let bestL = 0.44
  for (let l = 0.46; l >= 0.36; l -= 0.01) {
    const candidate = hslToRgb(hue, s, l)
    const ratio = contrastRatio(1.0, relativeLuminance(candidate))
    bestL = l
    if (ratio >= 4.5) break
  }
  bestL = clamp(bestL, 0.36, 0.46)
  const hoverL = clamp(bestL - 0.06, 0.28, 0.40)
  return {
    accent: hslToRgb(hue, s, bestL),
    hover: hslToRgb(hue, clamp(s + 0.04, 0.58, 0.92), hoverL)
  }
}

/**
 * Derives a luminous accent on dark (#1a1a1e) with HSL lightness strictly within 66%-76%.
 */
function deriveDarkAccent(hue: number, sat: number): {
  accent: [number, number, number]
  hover: [number, number, number]
} {
  const darkSurfaceLum = relativeLuminance([26, 26, 30])
  const s = clamp(sat, 0.64, 0.92)
  let bestL = 0.70
  for (let l = 0.66; l <= 0.76; l += 0.01) {
    const candidate = hslToRgb(hue, s, l)
    const ratio = contrastRatio(relativeLuminance(candidate), darkSurfaceLum)
    bestL = l
    if (ratio >= 5.2) break
  }
  bestL = clamp(bestL, 0.66, 0.76)
  const hoverL = clamp(bestL + 0.06, 0.72, 0.84)
  return {
    accent: hslToRgb(hue, s, bestL),
    hover: hslToRgb(hue, clamp(s + 0.04, 0.64, 0.95), hoverL)
  }
}

function buildMonochromePalette(avgLum: number): BlogAmbientPalette {
  // Cool slate-indigo editorial triad tuned by grayscale cover brightness
  const primaryHue = avgLum > 0.55 ? 236 : 226
  const light = deriveLightAccent(primaryHue, 0.66)
  const dark = deriveDarkAccent(primaryHue, 0.74)

  const glowA = hslToRgb(primaryHue, 0.76, 0.57)
  const glowB = hslToRgb(normalizeHue(primaryHue + 36), 0.78, 0.60)
  const glowC = hslToRgb(normalizeHue(primaryHue + 148), 0.76, 0.60)

  const lightRgb = formatRgbTriplet(light.accent)
  const darkRgb = formatRgbTriplet(dark.accent)

  return {
    accentLight: rgbToHex(...light.accent),
    accentLightHover: rgbToHex(...light.hover),
    accentLightSoft: `rgba(${lightRgb}, 0.10)`,
    accentLightRgb: lightRgb,
    accentDark: rgbToHex(...dark.accent),
    accentDarkHover: rgbToHex(...dark.hover),
    accentDarkSoft: `rgba(${darkRgb}, 0.16)`,
    accentDarkRgb: darkRgb,
    glowA: formatRgbTriplet(glowA),
    glowB: formatRgbTriplet(glowB),
    glowC: formatRgbTriplet(glowC)
  }
}

interface HueBucket {
  index: number
  weight: number
  count: number
  sinSum: number
  cosSum: number
  satSum: number
  lightSum: number
}

export function computePaletteFromPixels(data: Uint8ClampedArray): BlogAmbientPalette {
  const buckets: HueBucket[] = Array.from({ length: HUE_BUCKET_COUNT }, (_, index) => ({
    index,
    weight: 0,
    count: 0,
    sinSum: 0,
    cosSum: 0,
    satSum: 0,
    lightSum: 0
  }))

  let colorfulPixels = 0
  let opaquePixels = 0
  let totalLum = 0

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha < 128) continue

    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const [h, s, l] = rgbToHsl(r, g, b)

    opaquePixels += 1
    totalLum += l

    // Ignore near-white, near-black, and achromatic gray pixels
    if (l < 0.08 || l > 0.92 || s < 0.15) {
      continue
    }

    colorfulPixels += 1
    const midToneFactor = Math.max(0.14, 1 - Math.abs(l - 0.54) * 1.32)
    const vibrancyWeight = Math.pow(s, 1.35) * midToneFactor

    const bucketIdx = Math.floor(h / (360 / HUE_BUCKET_COUNT)) % HUE_BUCKET_COUNT
    const rad = (h * Math.PI) / 180
    const bucket = buckets[bucketIdx]
    bucket.weight += vibrancyWeight
    bucket.count += 1
    bucket.sinSum += Math.sin(rad) * vibrancyWeight
    bucket.cosSum += Math.cos(rad) * vibrancyWeight
    bucket.satSum += s * vibrancyWeight
    bucket.lightSum += l * vibrancyWeight
  }

  if (opaquePixels === 0) {
    return DEFAULT_AMBIENT_PALETTE
  }

  const avgLum = totalLum / opaquePixels
  if (colorfulPixels < MIN_COLORFUL_PIXELS) {
    return buildMonochromePalette(avgLum)
  }

  const ranked = buckets
    .filter((b) => b.count > 0 && b.weight > 0)
    .map((b) => {
      const meanAngle = (Math.atan2(b.sinSum, b.cosSum) * 180) / Math.PI
      const hue = normalizeHue(meanAngle)
      return {
        hue,
        sat: b.satSum / b.weight,
        light: b.lightSum / b.weight,
        weight: b.weight
      }
    })
    .sort((a, b) => b.weight - a.weight)

  if (ranked.length === 0) {
    return buildMonochromePalette(avgLum)
  }

  const primary = ranked[0]

  // Only adopt a secondary/tertiary bucket from the cover if it represents a genuinely
  // distinct, saturated color (not anti-aliased transition fringe on single-hue covers like Persona 4).
  const distinctSecondary = ranked.find(
    (item) =>
      item.weight >= primary.weight * 0.18 &&
      item.sat >= 0.34 &&
      hueDistance(item.hue, primary.hue) >= 34
  )

  const secondaryHue = distinctSecondary
    ? distinctSecondary.hue
    : normalizeHue(primary.hue + 36)
  const secondarySat = distinctSecondary
    ? clamp(distinctSecondary.sat, 0.72, 0.92)
    : clamp(primary.sat * 1.04, 0.76, 0.92)
  const secondaryLight = distinctSecondary
    ? crispGlowLightness(distinctSecondary.hue, distinctSecondary.light, 0.54, 0.65)
    : crispGlowLightness(secondaryHue, Math.max(primary.light + 0.04, 0.58), 0.56, 0.66)

  const distinctTertiary = ranked.find(
    (item) =>
      item.weight >= primary.weight * 0.14 &&
      item.sat >= 0.32 &&
      hueDistance(item.hue, primary.hue) >= 48 &&
      hueDistance(item.hue, secondaryHue) >= 38
  )

  // Harmonized cool/complementary accent (+148°) guarantees unmistakable multi-tone depth
  // on single-hue covers (e.g. Persona 4 golden yellow 48° -> +36° sunlit lime-gold & +148° crisp sky-cerulean 196°).
  const tertiaryHue = distinctTertiary
    ? distinctTertiary.hue
    : normalizeHue(primary.hue + 148)
  const tertiarySat = distinctTertiary
    ? clamp(distinctTertiary.sat, 0.68, 0.90)
    : clamp(primary.sat * 0.96, 0.74, 0.90)
  const tertiaryLight = distinctTertiary
    ? crispGlowLightness(distinctTertiary.hue, distinctTertiary.light, 0.54, 0.66)
    : crispGlowLightness(tertiaryHue, 0.60, 0.56, 0.66)

  const light = deriveLightAccent(primary.hue, primary.sat)
  const dark = deriveDarkAccent(primary.hue, primary.sat)

  const glowA = hslToRgb(
    primary.hue,
    clamp(primary.sat, 0.72, 0.94),
    crispGlowLightness(primary.hue, primary.light, 0.52, 0.63)
  )
  const glowB = hslToRgb(secondaryHue, secondarySat, secondaryLight)
  const glowC = hslToRgb(tertiaryHue, tertiarySat, tertiaryLight)

  const lightRgb = formatRgbTriplet(light.accent)
  const darkRgb = formatRgbTriplet(dark.accent)

  return {
    accentLight: rgbToHex(...light.accent),
    accentLightHover: rgbToHex(...light.hover),
    accentLightSoft: `rgba(${lightRgb}, 0.10)`,
    accentLightRgb: lightRgb,
    accentDark: rgbToHex(...dark.accent),
    accentDarkHover: rgbToHex(...dark.hover),
    accentDarkSoft: `rgba(${darkRgb}, 0.16)`,
    accentDarkRgb: darkRgb,
    glowA: formatRgbTriplet(glowA),
    glowB: formatRgbTriplet(glowB),
    glowC: formatRgbTriplet(glowC)
  }
}

export function extractCoverPalette(imageUrl: string): Promise<BlogAmbientPalette | null> {
  const key = typeof imageUrl === 'string' ? imageUrl.trim() : ''
  if (!key) return Promise.resolve(null)

  if (paletteCache.has(key)) {
    return Promise.resolve(paletteCache.get(key) ?? null)
  }

  const existing = inflightExtractions.get(key)
  if (existing) {
    return existing
  }

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(null)
  }

  const task = new Promise<BlogAmbientPalette | null>((resolve) => {
    let settled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'

    const finish = (result: BlogAmbientPalette | null) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      img.onload = null
      img.onerror = null
      paletteCache.set(key, result)
      inflightExtractions.delete(key)
      resolve(result)
    }

    const timer = globalThis.setTimeout(() => {
      finish(null)
    }, IMAGE_LOAD_TIMEOUT_MS)

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE_SIZE
        canvas.height = SAMPLE_SIZE
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          finish(null)
          return
        }
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        const palette = computePaletteFromPixels(imageData.data)
        finish(palette)
      } catch {
        // Never throw on CORS tainted canvas or broken image decode.
        finish(null)
      }
    }

    img.onerror = () => {
      finish(null)
    }

    try {
      img.src = key
    } catch {
      finish(null)
    }
  })

  inflightExtractions.set(key, task)
  return task
}

/* ==========================================================================
   Per-track visual tuning (15 curated open-source effects + audio response)
   ========================================================================== */

export interface BlogAmbientEffectMeta {
  id: BlogAmbientEffectId
  group: BlogAmbientEffectGroup
  name: string
  enName: string
  tagline: string
  intensityLabel: string
  scaleLabel: string
}

export const BLOG_AMBIENT_EFFECTS: readonly BlogAmbientEffectMeta[] = Object.freeze([
  // React Bits (7 MIT WebGL shaders)
  {
    id: 'threads',
    group: 'react-bits',
    name: '共振丝线',
    enName: 'Threads',
    tagline: '纤细发丝全屏交织，随旋律与节拍拨动起伏',
    intensityLabel: '波动幅度',
    scaleLabel: '丝线间距'
  },
  {
    id: 'iridescence',
    group: 'react-bits',
    name: '虹彩流体膜',
    enName: 'Iridescence',
    tagline: '珍珠母贝般的液态彩光曲面，色彩流动感极强',
    intensityLabel: '虹彩扰动',
    scaleLabel: '色带密度'
  },
  {
    id: 'liquid-chrome',
    group: 'react-bits',
    name: '液态铬金属',
    enName: 'Liquid Chrome',
    tagline: '丝滑水银涡流与镜面高光，支持音频与鼠标扰动',
    intensityLabel: '涡流振幅',
    scaleLabel: '波纹频率'
  },
  {
    id: 'aurora',
    group: 'react-bits',
    name: '北极光幕',
    enName: 'Aurora',
    tagline: '轻盈飘动的极光幕帘，柔和铺满背景不抢视线',
    intensityLabel: '极光振幅',
    scaleLabel: '光幕柔和度'
  },
  {
    id: 'light-rays',
    group: 'react-bits',
    name: '丁达尔光束',
    enName: 'Light Rays',
    tagline: '顶部垂落的体积光柱与柔雾散射，通透高级',
    intensityLabel: '光束扩散',
    scaleLabel: '光柱长度'
  },
  {
    id: 'prism',
    group: 'react-bits',
    name: '旋转棱镜光',
    enName: 'Prism',
    tagline: '立体旋转光谱棱镜，色散光芒随鼓点呼吸',
    intensityLabel: '光谱辉度',
    scaleLabel: '棱镜尺度'
  },
  {
    id: 'color-bends',
    group: 'react-bits',
    name: '流动彩带',
    enName: 'Color Bends',
    tagline: '流畅弯折的多色光谱丝带，干净通透富有动感',
    intensityLabel: '弯折扭曲',
    scaleLabel: '彩带尺度'
  },
  // Paper Shaders (8 Apache-2.0 zero-dependency WebGL shaders)
  {
    id: 'mesh-gradient',
    group: 'paper',
    name: '流光网格',
    enName: 'MeshGradient',
    tagline: '大幅度有机旋涡流动的多色丝绸网格（默认推荐）',
    intensityLabel: '扭曲与旋涡',
    scaleLabel: '网格尺度'
  },
  {
    id: 'warp',
    group: 'paper',
    name: '丝绸波浪',
    enName: 'Warp',
    tagline: '流动丝绸褶皱与大理石纹波浪，动效饱满',
    intensityLabel: '褶皱扭曲',
    scaleLabel: '波浪尺度'
  },
  {
    id: 'liquid-metal',
    group: 'paper',
    name: '液态水银',
    enName: 'LiquidMetal',
    tagline: 'Paper 官方物理折光与色散液态金属质感',
    intensityLabel: '折光变形',
    scaleLabel: '纹路尺度'
  },
  {
    id: 'god-rays',
    group: 'paper',
    name: '圣光光束',
    enName: 'GodRays',
    tagline: '中心散射的耀眼圣光射线，层次分明',
    intensityLabel: '光束强度',
    scaleLabel: '射线密度'
  },
  {
    id: 'neuro-noise',
    group: 'paper',
    name: '神经光脉',
    enName: 'NeuroNoise',
    tagline: '液态发光神经网络脉络，交点随节拍律动',
    intensityLabel: '脉络对比',
    scaleLabel: '脉络尺度'
  },
  {
    id: 'metaballs',
    group: 'paper',
    name: '融球流体',
    enName: 'Metaballs',
    tagline: '多色有机光球在画布游走、拉丝融合',
    intensityLabel: '光球数量',
    scaleLabel: '光球尺度'
  },
  {
    id: 'grain-gradient',
    group: 'paper',
    name: '胶片颗粒',
    enName: 'GrainGradient',
    tagline: '电影质感颗粒与抽象流体渐变结合',
    intensityLabel: '颗粒质感',
    scaleLabel: '形态尺度'
  },
  {
    id: 'smoke-ring',
    group: 'paper',
    name: '烟雾光环',
    enName: 'SmokeRing',
    tagline: '层叠噪声塑造的柔和彩烟环形光晕',
    intensityLabel: '烟雾厚度',
    scaleLabel: '光环半径'
  }
])

export const BLOG_AMBIENT_EFFECT_IDS: readonly BlogAmbientEffectId[] = Object.freeze(
  BLOG_AMBIENT_EFFECTS.map((item) => item.id)
)

const AMBIENT_EFFECT_SET = new Set<string>(BLOG_AMBIENT_EFFECT_IDS)

export function isBlogAmbientEffectId(value: unknown): value is BlogAmbientEffectId {
  return typeof value === 'string' && AMBIENT_EFFECT_SET.has(value)
}

export function getAmbientEffectMeta(effect: BlogAmbientEffectId): BlogAmbientEffectMeta {
  return (
    BLOG_AMBIENT_EFFECTS.find((item) => item.id === effect) ??
    BLOG_AMBIENT_EFFECTS.find((item) => item.id === 'mesh-gradient')!
  )
}

export const DEFAULT_TRACK_VISUAL_CONFIG: Readonly<BlogTrackVisualConfig> = Object.freeze({
  effect: 'mesh-gradient',
  sensitivity: 1.0,
  bassGain: 1.1,
  midGain: 1.0,
  trebleGain: 0.9,
  beatBoost: 1.0,
  smoothing: 0.55,
  speed: 1.0,
  intensity: 1.0,
  scale: 1.0,
  audioReactivity: 1.0,
  opacity: 0.78
})

export type BlogTrackVisualNumericKey = Exclude<keyof BlogTrackVisualConfig, 'effect'>

/** Inclusive slider ranges + step for every numeric tuning knob. */
export const TRACK_VISUAL_RANGES: Readonly<
  Record<BlogTrackVisualNumericKey, { min: number; max: number; step: number }>
> = Object.freeze({
  sensitivity: { min: 0.2, max: 2.5, step: 0.05 },
  bassGain: { min: 0, max: 2, step: 0.05 },
  midGain: { min: 0, max: 2, step: 0.05 },
  trebleGain: { min: 0, max: 2, step: 0.05 },
  beatBoost: { min: 0, max: 2, step: 0.05 },
  smoothing: { min: 0.1, max: 0.9, step: 0.01 },
  speed: { min: 0.1, max: 2.5, step: 0.05 },
  intensity: { min: 0.1, max: 2.0, step: 0.05 },
  scale: { min: 0.3, max: 2.2, step: 0.05 },
  audioReactivity: { min: 0, max: 2.0, step: 0.05 },
  opacity: { min: 0.15, max: 1.0, step: 0.01 }
})

const TRACK_VISUAL_NUMERIC_KEYS = Object.keys(TRACK_VISUAL_RANGES) as BlogTrackVisualNumericKey[]

function parseFiniteNum(raw: unknown): number {
  return typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? Number(raw)
      : Number.NaN
}

/**
 * Fills missing / invalid fields with defaults and clamps every number into its range.
 * Gracefully migrates legacy pre-v10 configs (silkSpeed / silkWarp / silkSoftness / waveStyle).
 */
export function normalizeTrackVisualConfig(
  partial?: Partial<BlogTrackVisualConfig> | null
): BlogTrackVisualConfig {
  const src = (partial && typeof partial === 'object' ? partial : {}) as Record<string, unknown>
  const out = { ...DEFAULT_TRACK_VISUAL_CONFIG } as BlogTrackVisualConfig

  for (const key of TRACK_VISUAL_NUMERIC_KEYS) {
    const num = parseFiniteNum(src[key])
    if (Number.isFinite(num)) {
      const range = TRACK_VISUAL_RANGES[key]
      out[key] = Math.round(clamp(num, range.min, range.max) * 1000) / 1000
    }
  }

  // Legacy field fallback when new keys are absent
  if (!Number.isFinite(parseFiniteNum(src.speed))) {
    const legacySpeed = parseFiniteNum(src.silkSpeed)
    if (Number.isFinite(legacySpeed)) {
      const r = TRACK_VISUAL_RANGES.speed
      out.speed = Math.round(clamp(legacySpeed, r.min, r.max) * 1000) / 1000
    }
  }
  if (!Number.isFinite(parseFiniteNum(src.intensity))) {
    const legacyWarp = parseFiniteNum(src.silkWarp)
    if (Number.isFinite(legacyWarp)) {
      const r = TRACK_VISUAL_RANGES.intensity
      out.intensity = Math.round(clamp(legacyWarp, r.min, r.max) * 1000) / 1000
    }
  }
  if (!Number.isFinite(parseFiniteNum(src.scale))) {
    const legacyScale = parseFiniteNum(src.waveScale)
    if (Number.isFinite(legacyScale)) {
      const r = TRACK_VISUAL_RANGES.scale
      out.scale = Math.round(clamp(legacyScale, r.min, r.max) * 1000) / 1000
    }
  }
  if (!Number.isFinite(parseFiniteNum(src.opacity))) {
    const legacyOpacity = Number.isFinite(parseFiniteNum(src.silkOpacity))
      ? parseFiniteNum(src.silkOpacity)
      : parseFiniteNum(src.waveOpacity)
    if (Number.isFinite(legacyOpacity)) {
      const r = TRACK_VISUAL_RANGES.opacity
      out.opacity = Math.round(clamp(legacyOpacity, r.min, r.max) * 1000) / 1000
    }
  }

  if (isBlogAmbientEffectId(src.effect)) {
    out.effect = src.effect
  } else {
    const legacySoftness = parseFiniteNum(src.silkSoftness)
    if (Number.isFinite(legacySoftness) && legacySoftness <= 0.35) {
      out.effect = 'liquid-metal'
    } else if (typeof src.waveStyle === 'string') {
      out.effect = 'threads'
    }
  }

  return out
}

export function trackVisualConfigEquals(a: BlogTrackVisualConfig, b: BlogTrackVisualConfig): boolean {
  if (a.effect !== b.effect) return false
  for (const key of TRACK_VISUAL_NUMERIC_KEYS) {
    if (Math.abs(a[key] - b[key]) > 0.0051) return false
  }
  return true
}

export interface TrackVisualPreset {
  id: 'mesh-silk' | 'threads-pulse' | 'liquid-metal' | 'aurora-dream' | 'iridescence-pop' | 'chrome-bass'
  label: string
  hint: string
  config: BlogTrackVisualConfig
}

export const TRACK_VISUAL_PRESETS: readonly TrackVisualPreset[] = Object.freeze([
  {
    id: 'mesh-silk',
    label: '流光丝绸',
    hint: 'Paper 流光网格 · 灵动多色旋涡，适合大多数曲目',
    config: normalizeTrackVisualConfig(DEFAULT_TRACK_VISUAL_CONFIG)
  },
  {
    id: 'threads-pulse',
    label: '共振丝线',
    hint: 'React Bits 纤细丝线随旋律交织起伏，克制雅致',
    config: normalizeTrackVisualConfig({
      effect: 'threads',
      sensitivity: 1.15,
      bassGain: 1.15,
      midGain: 1.2,
      trebleGain: 1.0,
      beatBoost: 1.1,
      smoothing: 0.48,
      speed: 1.05,
      intensity: 1.15,
      scale: 1.0,
      audioReactivity: 1.25,
      opacity: 0.84
    })
  },
  {
    id: 'liquid-metal',
    label: '液态水银',
    hint: 'Paper 物理折光液态水银，色散金属质感拉满',
    config: normalizeTrackVisualConfig({
      effect: 'liquid-metal',
      sensitivity: 1.1,
      bassGain: 1.25,
      midGain: 1.0,
      trebleGain: 1.05,
      beatBoost: 1.2,
      smoothing: 0.48,
      speed: 1.05,
      intensity: 1.1,
      scale: 1.05,
      audioReactivity: 1.15,
      opacity: 0.72
    })
  },
  {
    id: 'aurora-dream',
    label: '北极光幕',
    hint: '慢速柔和极光，适合钢琴 / 民谣 / 抒情曲目',
    config: normalizeTrackVisualConfig({
      effect: 'aurora',
      sensitivity: 0.9,
      bassGain: 0.95,
      midGain: 1.15,
      trebleGain: 0.9,
      beatBoost: 0.65,
      smoothing: 0.74,
      speed: 0.75,
      intensity: 1.0,
      scale: 1.0,
      audioReactivity: 0.85,
      opacity: 0.76
    })
  },
  {
    id: 'iridescence-pop',
    label: '虹彩律动',
    hint: '珍珠母贝虹彩流体，适合流行 / 舞曲 / 合成器',
    config: normalizeTrackVisualConfig({
      effect: 'iridescence',
      sensitivity: 1.25,
      bassGain: 1.15,
      midGain: 1.1,
      trebleGain: 1.2,
      beatBoost: 1.35,
      smoothing: 0.42,
      speed: 1.15,
      intensity: 1.15,
      scale: 1.0,
      audioReactivity: 1.2,
      opacity: 0.68
    })
  },
  {
    id: 'chrome-bass',
    label: '液态铬电音',
    hint: '重低音强驱动液态铬涡流，适合 EDM / 摇滚',
    config: normalizeTrackVisualConfig({
      effect: 'liquid-chrome',
      sensitivity: 1.35,
      bassGain: 1.7,
      midGain: 0.9,
      trebleGain: 0.85,
      beatBoost: 1.65,
      smoothing: 0.36,
      speed: 1.25,
      intensity: 1.25,
      scale: 1.1,
      audioReactivity: 1.45,
      opacity: 0.74
    })
  }
])

export function findMatchingVisualPreset(config: BlogTrackVisualConfig): TrackVisualPreset | null {
  return TRACK_VISUAL_PRESETS.find((preset) => trackVisualConfigEquals(preset.config, config)) ?? null
}

/* ==========================================================================
   Real-time music analysis (zero-allocation DSP frame)
   ========================================================================== */

export const AUDIO_BAND_COUNT = 32
export const AUDIO_WAVEFORM_POINTS = 64
export const AUDIO_BAND_MIN_HZ = 40
export const AUDIO_BAND_MAX_HZ = 14000
export const AUDIO_ANALYSER_FFT_SIZE = 2048
export const AUDIO_ANALYSER_SMOOTHING = 0.65
export const AUDIO_ANALYSER_MIN_DB = -85
export const AUDIO_ANALYSER_MAX_DB = -18

const BAND_ATTACK = 0.55
const BAND_RELEASE = 0.14
const PEAK_DECAY = 0.992
const PEAK_FLOOR = 0.18
const BAND_PEAK_DECAY = 0.995
const BAND_PEAK_FLOOR = 0.3
const BEAT_DECAY = 0.86
const FLUX_HISTORY = 35
const BEAT_COOLDOWN_S = 0.16
const BASS_BANDS_END = 10 // bands 0..9   ≈ 40 Hz – 250 Hz
const MID_BANDS_END = 22 // bands 10..21  ≈ 250 Hz – 2.2 kHz (vocals / melody)
const ONSET_BANDS_END = 12 // bass + low-mid energy used for spectral-flux onsets
const SILENT_FRAMES_BEFORE_INACTIVE = 6

/**
 * One analysed audio frame. The engine mutates and returns the SAME object every frame
 * (zero allocations in the render loop) — consumers must read it synchronously.
 */
export interface AudioAnalysisFrame {
  /** 32 logarithmically spaced bands (40 Hz → 14 kHz), 0..1, fast-attack / organic-release. */
  bands: Float32Array
  /** 64-point live oscilloscope waveform, -1..1 (zero-crossing triggered, auto-gained). */
  waveform: Float32Array
  bass: number
  mid: number
  treble: number
  /** Adaptive loudness 0..1: calm (~0.15) on quiet passages, surging to 1 on drops / choruses. */
  level: number
  /** Spring impulse: jumps to 1.0 on a spectral-flux onset, decays ×0.86 per 60 Hz frame. */
  beatPulse: number
  /** Monotonic onset counter — increments once per detected beat. */
  beatId: number
  /** True ONLY while real, non-zero analyser data is flowing. */
  active: boolean
}

export function createAudioAnalysisFrame(): AudioAnalysisFrame {
  return {
    bands: new Float32Array(AUDIO_BAND_COUNT),
    waveform: new Float32Array(AUDIO_WAVEFORM_POINTS),
    bass: 0,
    mid: 0,
    treble: 0,
    level: 0,
    beatPulse: 0,
    beatId: 0,
    active: false
  }
}

/**
 * Logarithmic band → FFT-bin map. Returns [lo0, hi0, lo1, hi1, ...] with `hi` exclusive;
 * every band owns at least one bin, so the deep-bass bands never read empty.
 */
export function computeLogBandEdges(
  sampleRate: number,
  binCount: number,
  bandCount = AUDIO_BAND_COUNT,
  minHz = AUDIO_BAND_MIN_HZ,
  maxHz = AUDIO_BAND_MAX_HZ
): Int32Array {
  const edges = new Int32Array(bandCount * 2)
  const bins = Math.max(1, Math.floor(binCount))
  const nyquist = Math.max(1, sampleRate) / 2
  const binHz = nyquist / bins
  const top = Math.max(minHz * 2, Math.min(maxHz, nyquist * 0.98))
  const ratio = top / minHz
  for (let b = 0; b < bandCount; b += 1) {
    const f0 = minHz * Math.pow(ratio, b / bandCount)
    const f1 = minHz * Math.pow(ratio, (b + 1) / bandCount)
    const lo = clamp(Math.floor(f0 / binHz), 0, bins - 1)
    const hi = clamp(Math.ceil(f1 / binHz), lo + 1, bins)
    edges[b * 2] = lo
    edges[b * 2 + 1] = hi
  }
  return edges
}

type ByteSpectrum = ArrayLike<number>

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Per-band weight from the bass / mid / treble gains, crossfaded over ±2 bands at each
 * region boundary so dragging one gain never opens a hard step in the spectrum.
 */
function writeBandGains(out: Float32Array, cfg: BlogTrackVisualConfig): void {
  const bass = clamp(finiteOr(cfg.bassGain, 1.1), 0, 2)
  const mid = clamp(finiteOr(cfg.midGain, 1), 0, 2)
  const treble = clamp(finiteOr(cfg.trebleGain, 0.9), 0, 2)
  const blend = 2
  for (let b = 0; b < out.length; b += 1) {
    const centre = b + 0.5
    const toMid = clamp((centre - (BASS_BANDS_END - blend)) / (blend * 2), 0, 1)
    const toTreble = clamp((centre - (MID_BANDS_END - blend)) / (blend * 2), 0, 1)
    const low = bass + (mid - bass) * toMid
    out[b] = low + (treble - low) * toTreble
  }
}

/**
 * Turns raw AnalyserNode byte data into an expressive, musically-shaped frame:
 * log bands, adaptive auto-gain (rolling peak tracker), spectral-flux beat onsets
 * and a triggered oscilloscope waveform. Frame-rate independent (dt-normalised).
 */
export class AudioFrameAnalyzer {
  readonly frame: AudioAnalysisFrame = createAudioAnalysisFrame()

  private readonly raw = new Float32Array(AUDIO_BAND_COUNT)
  private readonly bandGains = new Float32Array(AUDIO_BAND_COUNT).fill(1)
  private readonly fluxHistory = new Float32Array(FLUX_HISTORY)
  private fluxIndex = 0
  private fluxFilled = 0
  private edges: Int32Array | null = null
  private edgesSampleRate = 0
  private edgesBinCount = 0
  private peak = PEAK_FLOOR
  private bandPeak = BAND_PEAK_FLOOR
  private wavePeak = 0.25
  private silentFrames = SILENT_FRAMES_BEFORE_INACTIVE
  private clock = 0
  private lastBeatAt = -1

  reset(): void {
    const f = this.frame
    f.bands.fill(0)
    f.waveform.fill(0)
    f.bass = 0
    f.mid = 0
    f.treble = 0
    f.level = 0
    f.beatPulse = 0
    f.active = false
    this.raw.fill(0)
    this.fluxHistory.fill(0)
    this.fluxIndex = 0
    this.fluxFilled = 0
    this.peak = PEAK_FLOOR
    this.bandPeak = BAND_PEAK_FLOOR
    this.wavePeak = 0.25
    this.silentFrames = SILENT_FRAMES_BEFORE_INACTIVE
  }

  /**
   * @param freq      getByteFrequencyData() output, or null when no audio is capturable
   * @param timeDomain getByteTimeDomainData() output, or null
   * @param sampleRate AudioContext.sampleRate
   * @param dtSeconds  time since the previous processed frame
   * @param volume     element volume (0..1); its pre-analyser attenuation is compensated in dB
   * @param config     per-track tuning — read EVERY call, so slider changes land on the very next frame
   */
  process(
    freq: ByteSpectrum | null,
    timeDomain: ByteSpectrum | null,
    sampleRate: number,
    dtSeconds: number,
    volume = 1,
    config: BlogTrackVisualConfig = DEFAULT_TRACK_VISUAL_CONFIG
  ): AudioAnalysisFrame {
    const f = this.frame
    const raw = this.raw
    const n = AUDIO_BAND_COUNT
    const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 1 / 60, 1 / 240, 0.1)
    const k = dt * 60
    const cfg = config ?? DEFAULT_TRACK_VISUAL_CONFIG
    const sensitivity = clamp(finiteOr(cfg.sensitivity, 1), 0.2, 2.5)
    const beatBoost = clamp(finiteOr(cfg.beatBoost, 1), 0, 2)
    // smoothing 0.55 ≙ the hand-tuned 0.55 attack / 0.14 release; higher = calmer, lower = snappier
    const smoothing = clamp(finiteOr(cfg.smoothing, 0.55), 0.1, 0.9)
    const attackBase = clamp(BAND_ATTACK * (1 - (smoothing - 0.55) * 1.2), 0.12, 0.92)
    const releaseBase = clamp(BAND_RELEASE * (1 - (smoothing - 0.55) * 1.6), 0.03, 0.4)
    const attack = 1 - Math.pow(1 - attackBase, k)
    const release = 1 - Math.pow(1 - releaseBase, k)
    this.clock += dt
    writeBandGains(this.bandGains, cfg)

    // 1) Log-band magnitudes (avg/max blend keeps transients crisp inside wide treble bands)
    let anyNonZero = false
    if (freq && freq.length > 0) {
      if (!this.edges || this.edgesSampleRate !== sampleRate || this.edgesBinCount !== freq.length) {
        this.edges = computeLogBandEdges(sampleRate, freq.length)
        this.edgesSampleRate = sampleRate
        this.edgesBinCount = freq.length
      }
      const edges = this.edges
      const safeVol = clamp(Number.isFinite(volume) ? volume : 1, 0.05, 1)
      // Byte data spans (maxDb - minDb) dB → compensate the element volume's attenuation.
      const volShift = Math.min(
        0.35,
        (-20 * Math.log10(safeVol)) / (AUDIO_ANALYSER_MAX_DB - AUDIO_ANALYSER_MIN_DB)
      )
      for (let b = 0; b < n; b += 1) {
        const lo = edges[b * 2]
        const hi = edges[b * 2 + 1]
        let sum = 0
        let max = 0
        for (let i = lo; i < hi; i += 1) {
          const v = freq[i]
          sum += v
          if (v > max) max = v
        }
        if (max > 0) anyNonZero = true
        const v = ((sum / Math.max(1, hi - lo)) * 0.6 + max * 0.4) / 255
        // Gentle +tilt: music energy falls with frequency; keep treble readable.
        const tilt = 1 + 0.32 * (b / (n - 1))
        raw[b] = v > 0 ? Math.min(1, (v + volShift) * tilt) : 0
      }
    } else {
      raw.fill(0)
    }

    this.silentFrames = anyNonZero ? 0 : this.silentFrames + 1
    const active = Boolean(freq) && this.silentFrames < SILENT_FRAMES_BEFORE_INACTIVE
    f.active = active

    // 2) Adaptive auto-gain: rolling peak tracker
    let instant = 0
    let maxRaw = 0
    for (let b = 0; b < n; b += 1) {
      instant += raw[b]
      if (raw[b] > maxRaw) maxRaw = raw[b]
    }
    instant /= n
    this.peak = Math.max(instant, this.peak * Math.pow(PEAK_DECAY, k), PEAK_FLOOR)
    this.bandPeak = Math.max(maxRaw, this.bandPeak * Math.pow(BAND_PEAK_DECAY, k), BAND_PEAK_FLOOR)
    const relative = Math.pow(clamp(instant / this.peak, 0, 1), 1.5)
    const absolute = clamp(instant / 0.55, 0, 1)
    const targetLevel = active
      ? clamp((relative * 0.62 + absolute * 0.38) * Math.pow(sensitivity, 0.8), 0, 1)
      : 0
    f.level += (targetLevel - f.level) * (targetLevel > f.level ? attack : release)

    // 3) Bands: contour relative to the loudest band, scaled by the loudness envelope,
    //    then weighted by the per-track sensitivity × bass / mid / treble gains.
    const gain = 0.35 + 0.65 * targetLevel
    const bands = f.bands
    const bandGains = this.bandGains
    let bassSum = 0
    let midSum = 0
    let trebleSum = 0
    for (let b = 0; b < n; b += 1) {
      const shaped = Math.pow(clamp(raw[b] / this.bandPeak, 0, 1), 1.6) * gain
      const target = active ? clamp(((shaped - 0.02) / 0.98) * sensitivity * bandGains[b], 0, 1) : 0
      const cur = bands[b]
      const next = cur + (target - cur) * (target > cur ? attack : release)
      bands[b] = next
      if (b < BASS_BANDS_END) bassSum += next
      else if (b < MID_BANDS_END) midSum += next
      else trebleSum += next
    }
    f.bass = bassSum / BASS_BANDS_END
    f.mid = midSum / (MID_BANDS_END - BASS_BANDS_END)
    f.treble = trebleSum / (n - MID_BANDS_END)

    // 4) Spectral-flux beat onset on bass + low-mid energy vs ~35-frame rolling baseline
    let lowEnergy = 0
    for (let b = 0; b < ONSET_BANDS_END; b += 1) lowEnergy += raw[b]
    lowEnergy /= ONSET_BANDS_END
    let baseline = lowEnergy
    if (this.fluxFilled > 0) {
      let histSum = 0
      for (let i = 0; i < this.fluxFilled; i += 1) histSum += this.fluxHistory[i]
      baseline = histSum / this.fluxFilled
    }
    const flux = lowEnergy - baseline
    // beatBoost > 1 → more onsets register and each punch rings longer; < 1 → weaker, stricter
    const threshold = (0.025 + baseline * 0.14) / Math.max(0.4, beatBoost)
    if (
      active &&
      beatBoost > 0 &&
      this.fluxFilled >= 8 &&
      flux > threshold &&
      lowEnergy > 0.1 &&
      this.clock - this.lastBeatAt > BEAT_COOLDOWN_S
    ) {
      f.beatPulse = Math.min(1, beatBoost)
      f.beatId += 1
      this.lastBeatAt = this.clock
    } else {
      const decay = Math.pow(BEAT_DECAY, 1 / Math.max(0.5, beatBoost))
      f.beatPulse *= Math.pow(decay, k)
      if (f.beatPulse < 0.0005) f.beatPulse = 0
    }
    this.fluxHistory[this.fluxIndex] = lowEnergy
    this.fluxIndex = (this.fluxIndex + 1) % FLUX_HISTORY
    if (this.fluxFilled < FLUX_HISTORY) this.fluxFilled += 1

    // 5) Triggered oscilloscope waveform (rising zero-crossing → stable, readable shape)
    const wave = f.waveform
    const points = AUDIO_WAVEFORM_POINTS
    if (active && timeDomain && timeDomain.length >= points * 2) {
      const len = timeDomain.length
      const half = len >> 1
      let start = 0
      for (let i = 1; i < half; i += 1) {
        if (timeDomain[i - 1] < 128 && timeDomain[i] >= 128) {
          start = i
          break
        }
      }
      const span = Math.min(len - start, half)
      const stride = span / points
      let maxAbs = 0
      for (let j = 0; j < points; j += 1) {
        const s = Math.abs((timeDomain[start + Math.floor(j * stride)] - 128) / 128)
        if (s > maxAbs) maxAbs = s
      }
      this.wavePeak = Math.max(maxAbs, this.wavePeak * Math.pow(0.985, k), 0.12)
      const waveGain = Math.min(4, 0.92 / this.wavePeak) * (0.4 + 0.6 * f.level)
      const waveSmooth = 1 - Math.pow(0.5, k)
      for (let j = 0; j < points; j += 1) {
        const s = clamp(((timeDomain[start + Math.floor(j * stride)] - 128) / 128) * waveGain, -1, 1)
        wave[j] += (s - wave[j]) * waveSmooth
      }
    } else {
      const fade = Math.pow(0.85, k)
      for (let j = 0; j < points; j += 1) wave[j] *= fade
    }

    return f
  }
}
