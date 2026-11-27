import type { AmbientStageProps } from '../BlogAmbientBackdrop'

export type Rgb = [number, number, number]

export function stageColors({ palette, darkMode }: AmbientStageProps): [Rgb, Rgb, Rgb] {
  const primary = (darkMode ? palette.accentDarkRgb : palette.accentLightRgb)
    .split(',').map((channel) => Number(channel) / 255) as Rgb
  const base: Rgb = darkMode ? [14 / 255, 14 / 255, 20 / 255] : [246 / 255, 246 / 255, 248 / 255]
  const secondary: Rgb = [0, 0, 0]
  for (let channel = 0; channel < 3; channel += 1) {
    secondary[channel] = primary[channel] * 0.56 + base[channel] * 0.44
  }
  return [primary, secondary, base]
}

export function createStageMotion() {
  let frameMs = 0
  let lastBeat = 0
  let impulse = 0
  let bass = 0
  let mid = 0
  let treble = 0
  const output = { frameMs, impulse, bass, mid, treble }
  return (props: AmbientStageProps, elapsed: number, pace = 1, frameTime?: number) => {
    const frame = props.reducedMotion ? undefined : props.getAudioFrame?.(frameTime)
    const decay = Math.exp(-elapsed / 56)
    const boost = props.config.audioReactivity
    const hasOnset = !!frame?.active && frame.beatPulse === 1 && frame.beatId !== lastBeat
    if (frame) lastBeat = frame.beatId
    if (!props.reducedMotion) {
      frameMs += elapsed * pace * props.config.speed + (hasOnset ? 34 * boost : 0)
    }
    impulse = frame?.active
      ? Math.max(impulse * decay, frame.transient, frame.beatPulse) : 0
    bass = frame?.active ? Math.max(bass * decay, frame.bass) : 0
    mid = frame?.active ? Math.max(mid * decay, frame.mid) : 0
    treble = frame?.active ? Math.max(treble * decay, frame.treble) : 0
    output.frameMs = frameMs
    output.impulse = Math.min(1.65, impulse * boost)
    output.bass = bass * boost
    output.mid = mid * boost
    output.treble = treble * boost
    return output
  }
}
