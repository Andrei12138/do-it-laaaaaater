import type { AmbientStageProps } from '../BlogAmbientBackdrop'

export type Rgb = [number, number, number]

const rgb = (value: string) => value.split(',').map((channel) => Number(channel) / 255) as Rgb

export const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount
]

export function stageColors({ palette, darkMode }: AmbientStageProps) {
  return {
    glowA: rgb(palette.glowA), glowB: rgb(palette.glowB), glowC: rgb(palette.glowC),
    accent: rgb(darkMode ? palette.accentDarkRgb : palette.accentLightRgb),
    base: rgb(darkMode ? '14, 14, 20' : '246, 246, 248')
  }
}

export function createStageColors(initial: AmbientStageProps) {
  let { palette, darkMode } = initial
  let current = stageColors(initial)
  let from = current
  let target = current
  let start: number | undefined
  return (props: AmbientStageProps, now: number) => {
    if (palette !== props.palette || darkMode !== props.darkMode) {
      ({ palette, darkMode } = props)
      from = current
      target = stageColors(props)
      start = now
    }
    if (props.reducedMotion || (start !== undefined && now - start >= 500)) {
      start = undefined
      return current = target
    }
    if (start === undefined) return current
    const progress = (now - start) / 500
    const blend = progress * progress * (3 - 2 * progress)
    return current = {
      glowA: mixRgb(from.glowA, target.glowA, blend), glowB: mixRgb(from.glowB, target.glowB, blend),
      glowC: mixRgb(from.glowC, target.glowC, blend), accent: mixRgb(from.accent, target.accent, blend),
      base: target.base
    }
  }
}

const layerColors = new WeakMap<HTMLElement, ReturnType<typeof createStageColors>>()

export function getStageColors(node: HTMLElement, initial: AmbientStageProps) {
  const layer = node.parentElement ?? node
  let colors = layerColors.get(layer)
  if (!colors) {
    colors = createStageColors(initial)
    layerColors.set(layer, colors)
  }
  return colors
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
