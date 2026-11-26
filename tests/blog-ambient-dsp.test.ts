import { describe, expect, it } from 'vitest'
import {
  AUDIO_BAND_COUNT,
  AUDIO_WAVEFORM_POINTS,
  AudioFrameAnalyzer,
  BLOG_AMBIENT_MODES,
  computeLogBandEdges,
  normalizeAmbientMode
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
