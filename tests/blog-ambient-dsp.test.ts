import { describe, expect, it } from 'vitest'
import {
  AUDIO_BAND_COUNT,
  AUDIO_WAVEFORM_POINTS,
  AudioFrameAnalyzer,
  BLOG_AMBIENT_MODES,
  DEFAULT_TRACK_VISUAL_CONFIG,
  TRACK_VISUAL_PRESETS,
  computeLogBandEdges,
  findMatchingVisualPreset,
  normalizeAmbientMode,
  normalizeTrackVisualConfig,
  type BlogTrackVisualConfig
} from '../src/blog-ambient'

const SAMPLE_RATE = 44100
const BINS = 1024 // fftSize 2048

function spectrum(level: number, bassBoost = 0): Uint8Array {
  const data = new Uint8Array(BINS)
  for (let i = 0; i < BINS; i += 1) {
    const boost = i < 12 ? bassBoost : 0
    data[i] = Math.max(0, Math.min(255, Math.round(level * 255 + boost * 255 - i * 0.04)))
  }
  return data
}

function sineTimeDomain(amp: number): Uint8Array {
  const data = new Uint8Array(BINS * 2)
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.round(128 + Math.sin((i / data.length) * Math.PI * 2 * 6) * amp * 127)
  }
  return data
}

describe('ambient mode migration', () => {
  it('keeps only waves / silk / minimal and migrates legacy modes to silk', () => {
    expect(BLOG_AMBIENT_MODES).toEqual(['waves', 'silk', 'minimal'])
    expect(normalizeAmbientMode('vinyl')).toBe('silk')
    expect(normalizeAmbientMode('wallpaper')).toBe('silk')
    expect(normalizeAmbientMode('glow')).toBe('silk')
    expect(normalizeAmbientMode('silk')).toBe('silk')
    expect(normalizeAmbientMode('minimal')).toBe('minimal')
    expect(normalizeAmbientMode(null)).toBe('waves')
    expect(normalizeAmbientMode('bogus')).toBe('waves')
  })
})

describe('log band edges', () => {
  it('maps 32 log-spaced bands from 40 Hz to 14 kHz with every band owning a bin', () => {
    const edges = computeLogBandEdges(SAMPLE_RATE, BINS)
    expect(edges.length).toBe(AUDIO_BAND_COUNT * 2)
    const binHz = SAMPLE_RATE / 2 / BINS
    expect(edges[0] * binHz).toBeLessThanOrEqual(40)
    expect(edges[AUDIO_BAND_COUNT * 2 - 1] * binHz).toBeGreaterThanOrEqual(13900)
    for (let b = 0; b < AUDIO_BAND_COUNT; b += 1) {
      expect(edges[b * 2 + 1]).toBeGreaterThan(edges[b * 2])
      if (b > 0) expect(edges[b * 2]).toBeGreaterThanOrEqual(edges[(b - 1) * 2])
    }
  })
})

describe('AudioFrameAnalyzer', () => {
  it('reports inactive, all-zero frames without real audio data', () => {
    const engine = new AudioFrameAnalyzer()
    let frame = engine.process(null, null, SAMPLE_RATE, 1 / 60)
    expect(frame.active).toBe(false)
    frame = engine.process(new Uint8Array(BINS), new Uint8Array(BINS * 2).fill(128), SAMPLE_RATE, 1 / 60)
    for (let i = 0; i < 10; i += 1) {
      frame = engine.process(new Uint8Array(BINS), new Uint8Array(BINS * 2).fill(128), SAMPLE_RATE, 1 / 60)
    }
    expect(frame.active).toBe(false)
    expect(frame.level).toBe(0)
    expect(Math.max(...frame.bands)).toBe(0)
  })

  it('returns the same zero-allocation frame object every call', () => {
    const engine = new AudioFrameAnalyzer()
    const a = engine.process(spectrum(0.4), sineTimeDomain(0.5), SAMPLE_RATE, 1 / 60)
    const b = engine.process(spectrum(0.4), sineTimeDomain(0.5), SAMPLE_RATE, 1 / 60)
    expect(a).toBe(b)
    expect(a.bands).toBe(b.bands)
    expect(a.bands.length).toBe(AUDIO_BAND_COUNT)
    expect(a.waveform.length).toBe(AUDIO_WAVEFORM_POINTS)
  })

  it('stays calm on quiet passages and surges on loud choruses', () => {
    const engine = new AudioFrameAnalyzer()
    let frame = engine.process(spectrum(0.1), sineTimeDomain(0.1), SAMPLE_RATE, 1 / 60)
    for (let i = 0; i < 90; i += 1) frame = engine.process(spectrum(0.1), sineTimeDomain(0.1), SAMPLE_RATE, 1 / 60)
    expect(frame.active).toBe(true)
    const quiet = frame.level
    for (let i = 0; i < 40; i += 1) frame = engine.process(spectrum(0.6), sineTimeDomain(0.9), SAMPLE_RATE, 1 / 60)
    const loud = frame.level
    expect(quiet).toBeLessThan(0.45)
    expect(loud).toBeGreaterThan(0.8)
    expect(loud - quiet).toBeGreaterThan(0.4)
    expect(Math.max(...frame.waveform)).toBeGreaterThan(0.3)
    expect(Math.min(...frame.waveform)).toBeLessThan(-0.3)
  })

  it('fires a beat impulse on a bass onset and decays it smoothly', () => {
    const engine = new AudioFrameAnalyzer()
    let frame = engine.process(spectrum(0.3), sineTimeDomain(0.4), SAMPLE_RATE, 1 / 60)
    for (let i = 0; i < 40; i += 1) frame = engine.process(spectrum(0.3), sineTimeDomain(0.4), SAMPLE_RATE, 1 / 60)
    const beatsBefore = frame.beatId
    frame = engine.process(spectrum(0.3, 0.45), sineTimeDomain(0.8), SAMPLE_RATE, 1 / 60)
    expect(frame.beatId).toBe(beatsBefore + 1)
    expect(frame.beatPulse).toBe(1)
    frame = engine.process(spectrum(0.3), sineTimeDomain(0.4), SAMPLE_RATE, 1 / 60)
    expect(frame.beatPulse).toBeCloseTo(0.86, 2)
    expect(frame.bass).toBeGreaterThan(frame.treble)
  })
})

describe('normalizeTrackVisualConfig', () => {
  it('returns the full default config for null / undefined / junk input', () => {
    expect(normalizeTrackVisualConfig(null)).toEqual(DEFAULT_TRACK_VISUAL_CONFIG)
    expect(normalizeTrackVisualConfig(undefined)).toEqual(DEFAULT_TRACK_VISUAL_CONFIG)
    expect(normalizeTrackVisualConfig('nope' as unknown as Partial<BlogTrackVisualConfig>)).toEqual(
      DEFAULT_TRACK_VISUAL_CONFIG
    )
    expect(DEFAULT_TRACK_VISUAL_CONFIG).toMatchObject({
      sensitivity: 1,
      bassGain: 1.1,
      midGain: 1,
      trebleGain: 0.9,
      beatBoost: 1,
      smoothing: 0.55,
      silkSpeed: 0.85,
      silkWarp: 0.72,
      silkOpacity: 0.62,
      silkSoftness: 0.88,
      waveStyle: 'bars',
      waveScale: 1,
      waveOpacity: 0.78
    })
  })

  it('merges partial input, clamps every range and rejects invalid values', () => {
    const cfg = normalizeTrackVisualConfig({
      sensitivity: 9,
      bassGain: -3,
      trebleGain: 1.4,
      smoothing: 0,
      silkSpeed: Number.NaN,
      silkOpacity: 0.01,
      silkSoftness: 4,
      waveScale: '1.5' as unknown as number,
      waveOpacity: Number.POSITIVE_INFINITY,
      waveStyle: 'dots' as unknown as BlogTrackVisualConfig['waveStyle']
    })
    expect(cfg.sensitivity).toBe(2.5)
    expect(cfg.bassGain).toBe(0)
    expect(cfg.trebleGain).toBe(1.4)
    expect(cfg.midGain).toBe(DEFAULT_TRACK_VISUAL_CONFIG.midGain)
    expect(cfg.smoothing).toBe(0.1)
    expect(cfg.silkSpeed).toBe(DEFAULT_TRACK_VISUAL_CONFIG.silkSpeed)
    expect(cfg.silkOpacity).toBe(0.15)
    expect(cfg.silkSoftness).toBe(1)
    expect(cfg.waveScale).toBe(1.5)
    expect(cfg.waveOpacity).toBe(DEFAULT_TRACK_VISUAL_CONFIG.waveOpacity)
    expect(cfg.waveStyle).toBe('bars')
    expect(normalizeTrackVisualConfig({ waveStyle: 'wings' }).waveStyle).toBe('wings')
    expect(normalizeTrackVisualConfig({ waveStyle: 'horizon' }).waveStyle).toBe('horizon')
  })

  it('ships curated presets including a glossy liquid-metal look', () => {
    const labels = TRACK_VISUAL_PRESETS.map((preset) => preset.label)
    expect(labels).toEqual(['默认均衡', '柔和抒情', '动感流行', '重低音电音', '液态金属'])
    const metal = TRACK_VISUAL_PRESETS.find((preset) => preset.id === 'liquid-metal')!
    expect(metal.config.silkSoftness).toBeLessThan(0.15)
    expect(metal.config.silkWarp).toBeGreaterThan(1.2)
    for (const preset of TRACK_VISUAL_PRESETS) {
      expect(normalizeTrackVisualConfig(preset.config)).toEqual(preset.config)
    }
    expect(findMatchingVisualPreset(normalizeTrackVisualConfig(null))?.id).toBe('balanced')
    expect(findMatchingVisualPreset(normalizeTrackVisualConfig({ silkSpeed: 2.1 }))).toBeNull()
  })
})

function runFrames(config: BlogTrackVisualConfig, frames = 60, level = 0.3, bassBoost = 0.1) {
  const engine = new AudioFrameAnalyzer()
  let frame = engine.process(spectrum(level, bassBoost), sineTimeDomain(0.4), SAMPLE_RATE, 1 / 60, 1, config)
  for (let i = 0; i < frames; i += 1) {
    frame = engine.process(spectrum(level, bassBoost), sineTimeDomain(0.4), SAMPLE_RATE, 1 / 60, 1, config)
  }
  return { bass: frame.bass, mid: frame.mid, treble: frame.treble, level: frame.level, bands: Array.from(frame.bands) }
}

describe('per-track DSP weighting', () => {
  const base = normalizeTrackVisualConfig(null)

  it('bassGain scales only the low bands', () => {
    const low = runFrames({ ...base, bassGain: 0.4 })
    const high = runFrames({ ...base, bassGain: 1.6 })
    expect(high.bass).toBeGreaterThan(low.bass * 1.5)
    expect(high.treble).toBeCloseTo(low.treble, 3)
  })

  it('trebleGain = 0 silences the treble bands while bass keeps moving', () => {
    const muted = runFrames({ ...base, trebleGain: 0 })
    const open = runFrames({ ...base, trebleGain: 1.6 })
    // Upper treble bands go fully silent; the 2-band crossfade at 2.2 kHz keeps a soft shoulder
    for (let b = 24; b < AUDIO_BAND_COUNT; b += 1) expect(muted.bands[b]).toBe(0)
    expect(muted.treble).toBeLessThan(open.treble * 0.25)
    expect(open.treble).toBeGreaterThan(0.05)
    expect(muted.bass).toBeGreaterThan(0.05)
  })

  it('sensitivity scales overall band energy and loudness', () => {
    const calm = runFrames({ ...base, sensitivity: 0.4 })
    const hot = runFrames({ ...base, sensitivity: 2 })
    const sum = (arr: number[]) => arr.reduce((acc, v) => acc + v, 0)
    expect(sum(hot.bands)).toBeGreaterThan(sum(calm.bands) * 1.8)
    expect(hot.level).toBeGreaterThan(calm.level)
  })

  it('applies a new config on the very next frame (no re-instantiation)', () => {
    const engine = new AudioFrameAnalyzer()
    let prior = 0
    for (let i = 0; i < 60; i += 1) {
      prior = engine.process(spectrum(0.3, 0.1), sineTimeDomain(0.4), SAMPLE_RATE, 1 / 60, 1, base).treble
    }
    const after = engine.process(spectrum(0.3, 0.1), sineTimeDomain(0.4), SAMPLE_RATE, 1 / 60, 1, {
      ...base,
      trebleGain: 0
    }).treble
    expect(prior).toBeGreaterThan(0.02)
    expect(after).toBeLessThan(prior * 0.95)
  })

  it('higher smoothing attacks more slowly from silence', () => {
    const attackAfter = (smoothing: number) => {
      const engine = new AudioFrameAnalyzer()
      const cfg = { ...base, smoothing }
      for (let i = 0; i < 12; i += 1) engine.process(spectrum(0.02), sineTimeDomain(0.02), SAMPLE_RATE, 1 / 60, 1, cfg)
      const frame = engine.process(spectrum(0.5, 0.2), sineTimeDomain(0.6), SAMPLE_RATE, 1 / 60, 1, cfg)
      return frame.bass
    }
    expect(attackAfter(0.15)).toBeGreaterThan(attackAfter(0.85))
  })

  it('beatBoost = 0 disables beat impulses', () => {
    const engine = new AudioFrameAnalyzer()
    const cfg = { ...base, beatBoost: 0 }
    for (let i = 0; i < 40; i += 1) engine.process(spectrum(0.3), sineTimeDomain(0.4), SAMPLE_RATE, 1 / 60, 1, cfg)
    const frame = engine.process(spectrum(0.3, 0.45), sineTimeDomain(0.8), SAMPLE_RATE, 1 / 60, 1, cfg)
    expect(frame.beatPulse).toBe(0)
  })
})
