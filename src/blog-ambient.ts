export type BlogAmbientMode = 'waves' | 'silk' | 'vinyl' | 'minimal'

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

export function readAmbientMode(): BlogAmbientMode {
  try {
    const raw = globalThis.localStorage?.getItem(BLOG_AMBIENT_MODE_KEY)
    if (raw === 'waves' || raw === 'silk' || raw === 'vinyl' || raw === 'minimal') {
      return raw
    }
    // Seamlessly migrate legacy stored modes for existing users
    if (raw === 'glow') {
      return 'silk'
    }
    if (raw === 'wallpaper') {
      return 'vinyl'
    }
  } catch {
    // Ignore storage access errors in restricted browsing modes.
  }
  return 'waves'
}

export function saveAmbientMode(mode: BlogAmbientMode): void {
  if (mode !== 'waves' && mode !== 'silk' && mode !== 'vinyl' && mode !== 'minimal') return
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
