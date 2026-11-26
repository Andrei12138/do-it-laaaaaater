import { describe, expect, it } from 'vitest'
import {
  AUDIO_BAND_COUNT,
  AUDIO_WAVEFORM_POINTS,
  AudioFrameAnalyzer,
  BLOG_AMBIENT_EFFECTS,
  BLOG_AMBIENT_EFFECT_IDS,
  BLOG_AMBIENT_MODES,
  DEFAULT_TRACK_VISUAL_CONFIG,
  TRACK_VISUAL_PRESETS,
  computeLogBandEdges,
  findMatchingVisualPreset,
  getAmbientEffectMeta,
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

describe('ambient mode & 15-effect catalog', () => {
  it('keeps active / minimal modes and migrates all legacy modes to active', () => {
    expect(BLOG_AMBIENT_MODES).toEqual(['active', 'minimal'])
    expect(normalizeAmbientMode('waves')).toBe('active')
    expect(normalizeAmbientMode('silk')).toBe('active')
    expect(normalizeAmbientMode('vinyl')).toBe('active')
    expect(normalizeAmbientMode('wallpaper')).toBe('active')
    expect(normalizeAmbientMode('glow')).toBe('active')
    expect(normalizeAmbientMode('active')).toBe('active')
    expect(normalizeAmbientMode('minimal')).toBe('minimal')
    expect(normalizeAmbientMode(null)).toBe('active')
    expect(normalizeAmbientMode('bogus')).toBe('active')
  })

  it('registers all 15 open-source effects (7 React Bits + 8 Paper Shaders)', () => {
    expect(BLOG_AMBIENT_EFFECTS).toHaveLength(15)
    expect(BLOG_AMBIENT_EFFECT_IDS).toHaveLength(15)
    expect(BLOG_AMBIENT_EFFECTS.filter((item) => item.group === 'react-bits')).toHaveLength(7)
    expect(BLOG_AMBIENT_EFFECTS.filter((item) => item.group === 'paper')).toHaveLength(8)
    for (const id of BLOG_AMBIENT_EFFECT_IDS) {
      const meta = getAmbientEffectMeta(id)
      expect(meta.id).toBe(id)
      expect(meta.name.length).toBeGreaterThan(0)
      expect(meta.intensityLabel.length).toBeGreaterThan(0)
      expect(meta.scaleLabel.length).toBeGreaterThan(0)
    }
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
      effect: 'mesh-gradient',
      sensitivity: 1,
      bassGain: 1.1,
      midGain: 1,
      trebleGain: 0.9,
      beatBoost: 1,
      smoothing: 0.55,
      speed: 1,
      intensity: 1,
      scale: 1,
      audioReactivity: 1,
      opacity: 0.78
    })
  })

  it('merges partial input, clamps every range, rejects invalid effects, and migrates legacy fields', () => {
    const cfg = normalizeTrackVisualConfig({
      effect: 'non-existent' as unknown as BlogTrackVisualConfig['effect'],
      sensitivity: 9,
      bassGain: -3,
      trebleGain: 1.4,
      smoothing: 0,
      speed: Number.NaN,
      intensity: 4,
      scale: '1.5' as unknown as number,
      audioReactivity: -1,
      opacity: 0.01
    })
    expect(cfg.effect).toBe('mesh-gradient')
    expect(cfg.sensitivity).toBe(2.5)
    expect(cfg.bassGain).toBe(0)
    expect(cfg.trebleGain).toBe(1.4)
    expect(cfg.midGain).toBe(DEFAULT_TRACK_VISUAL_CONFIG.midGain)
    expect(cfg.smoothing).toBe(0.1)
    expect(cfg.speed).toBe(DEFAULT_TRACK_VISUAL_CONFIG.speed)
    expect(cfg.intensity).toBe(2)
    expect(cfg.scale).toBe(1.5)
    expect(cfg.audioReactivity).toBe(0)
    expect(cfg.opacity).toBe(0.15)

    for (const id of BLOG_AMBIENT_EFFECT_IDS) {
      expect(normalizeTrackVisualConfig({ effect: id }).effect).toBe(id)
    }

    // Legacy D1 record migration
    const legacyMetal = normalizeTrackVisualConfig({
      silkSpeed: 1.3,
      silkWarp: 1.4,
      silkOpacity: 0.66,
      silkSoftness: 0.1
    } as unknown as Partial<BlogTrackVisualConfig>)
    expect(legacyMetal.effect).toBe('liquid-metal')
    expect(legacyMetal.speed).toBe(1.3)
    expect(legacyMetal.intensity).toBe(1.4)
    expect(legacyMetal.opacity).toBe(0.66)

    const legacyWave = normalizeTrackVisualConfig({
      waveStyle: 'horizon',
      waveScale: 1.25,
      waveOpacity: 0.82
    } as unknown as Partial<BlogTrackVisualConfig>)
    expect(legacyWave.effect).toBe('threads')
    expect(legacyWave.scale).toBe(1.25)
    expect(legacyWave.opacity).toBe(0.82)
  })

  it('ships curated presets covering Paper Shaders and React Bits including liquid-metal', () => {
    const labels = TRACK_VISUAL_PRESETS.map((preset) => preset.label)
    expect(labels).toEqual(['流光丝绸', '共振丝线', '液态水银', '北极光幕', '虹彩律动', '液态铬电音'])
    const metal = TRACK_VISUAL_PRESETS.find((preset) => preset.id === 'liquid-metal')!
    expect(metal.config.effect).toBe('liquid-metal')
    for (const preset of TRACK_VISUAL_PRESETS) {
      expect(normalizeTrackVisualConfig(preset.config)).toEqual(preset.config)
    }
    expect(findMatchingVisualPreset(normalizeTrackVisualConfig(null))?.id).toBe('mesh-silk')
    expect(findMatchingVisualPreset(normalizeTrackVisualConfig({ speed: 2.3 }))).toBeNull()
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
