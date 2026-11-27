import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  GrainGradientShapes, LiquidMetalShapes, ShaderFitOptions, ShaderMount, WarpPatterns,
  emptyPixel, getShaderNoiseTexture, godRaysFragmentShader, grainGradientFragmentShader,
  liquidMetalFragmentShader, meshGradientFragmentShader, metaballsFragmentShader,
  neuroNoiseFragmentShader, smokeRingFragmentShader, warpFragmentShader,
  type GodRaysUniforms, type GrainGradientUniforms, type LiquidMetalUniforms,
  type MeshGradientUniforms, type MetaballsUniforms, type NeuroNoiseUniforms,
  type ShaderMountUniforms, type SmokeRingUniforms, type WarpUniforms
} from '@paper-design/shaders'
import type { AmbientStageProps } from '../BlogAmbientBackdrop'
import { createStageMotion, getStageColors, mixRgb, stageColors, type Rgb } from './stageMotion'

type PaperEffect = keyof typeof designs
type Rgba = [number, number, number, number]
type Motion = ReturnType<ReturnType<typeof createStageMotion>>
const rgba = (color: Rgb, alpha = 1): Rgba => [...color, alpha]
const clear: Rgba = [0, 0, 0, 0]
const sizing = {
  u_fit: ShaderFitOptions.contain, u_scale: 1, u_rotation: 0,
  u_originX: 0.5, u_originY: 0.5, u_offsetX: 0, u_offsetY: 0,
  u_worldWidth: 0, u_worldHeight: 0
}

const designs = {
  'mesh-gradient': { pace: 1, shader: meshGradientFragmentShader },
  warp: { pace: 4, shader: warpFragmentShader },
  'liquid-metal': { pace: 0.82, shader: liquidMetalFragmentShader },
  'god-rays': { pace: 0.87, shader: godRaysFragmentShader },
  'neuro-noise': { pace: 0.8, shader: neuroNoiseFragmentShader },
  metaballs: { pace: 1.3, shader: metaballsFragmentShader },
  'grain-gradient': { pace: 1, shader: grainGradientFragmentShader },
  'smoke-ring': { pace: 1.55, shader: smokeRingFragmentShader }
} satisfies Record<string, { pace: number; shader: string }>

let textures: Promise<{ noise: HTMLImageElement; pixel: HTMLImageElement }> | undefined
function loadTextures() {
  return textures ??= (async () => {
    const noise = getShaderNoiseTexture()
    if (!noise) throw new Error('Paper Shaders noise texture unavailable')
    const pixel = new Image()
    pixel.src = emptyPixel
    await Promise.all([noise.decode(), pixel.decode()])
    return { noise, pixel }
  })().catch((error: unknown) => { textures = undefined; throw error })
}

function uniformsFor(effect: PaperEffect, props: AmbientStageProps, motion: Motion,
  colors: ReturnType<typeof stageColors>, images: Awaited<ReturnType<typeof loadTextures>>): ShaderMountUniforms {
  const { scale, intensity } = props.config
  const { impulse, bass, mid, treble } = motion
  const size = 0.57 + 0.43 * scale
  const { glowA, glowB, glowC, accent, base } = colors
  const triad = [rgba(glowA), rgba(glowB), rgba(glowC)]
  const folds = [rgba(mixRgb(base, glowB, 0.23)), ...triad]
  const blobs = [...triad, rgba(accent)]
  const noise = { u_noiseTexture: images.noise }
  switch (effect) {
    case 'mesh-gradient': return {
      ...sizing, u_fit: ShaderFitOptions.cover, u_scale: size, u_colors: folds, u_colorsCount: folds.length,
      u_distortion: 0.24 + 0.18 * intensity + 0.14 * impulse, u_swirl: 0.35 + 0.18 * mid,
      u_grainMixer: 0, u_grainOverlay: 0
    } satisfies MeshGradientUniforms
    case 'warp': return {
      ...sizing, ...noise, u_fit: ShaderFitOptions.cover, u_scale: size, u_rotation: 18,
      u_colors: folds, u_colorsCount: folds.length, u_shape: WarpPatterns.stripes,
      u_shapeScale: 0.52, u_proportion: 0.48, u_softness: 0.055,
      u_distortion: 0.04 + 0.15 * intensity + 0.12 * impulse,
      u_swirl: 0.18 + 0.16 * bass, u_swirlIterations: 5
    } satisfies WarpUniforms
    case 'liquid-metal': return {
      ...sizing, u_colorBack: clear, u_colorTint: rgba(mixRgb(mixRgb(glowA, glowB, 0.25 + 0.18 * mid), glowC, 0.18 + 0.12 * treble)), u_image: images.pixel, u_isImage: false,
      u_shape: LiquidMetalShapes.diamond, u_scale: 0.82 * size, u_angle: 27, u_repetition: 3.2 + 1.1 * intensity,
      u_softness: 0.025, u_contour: 0.18, u_shiftRed: 0.2 + 0.24 * Math.abs(glowB[0] - glowA[0]) + 0.3 * impulse,
      u_shiftBlue: 0.24 + 0.26 * Math.abs(glowC[2] - glowA[2]) + 0.24 * treble,
      u_distortion: 0.14 + 0.17 * intensity + 0.22 * impulse + 0.06 * bass
    } satisfies LiquidMetalUniforms
    case 'god-rays': return {
      ...sizing, ...noise, u_fit: ShaderFitOptions.cover, u_scale: size, u_offsetY: -0.13,
      u_colorBack: clear, u_colorBloom: rgba(mixRgb(glowC, [1, 1, 1], 0.62)), u_colors: triad, u_colorsCount: triad.length,
      u_spotty: 0.08, u_midSize: 0.11 + 0.027 * impulse, u_midIntensity: 0.18,
      u_density: 0.24 + 0.11 * scale, u_intensity: Math.min(1, 0.37 + 0.23 * intensity + 0.21 * impulse),
      u_bloom: 0.17 + 0.08 * impulse
    } satisfies GodRaysUniforms
    case 'neuro-noise': return {
      ...sizing, u_fit: ShaderFitOptions.cover, u_scale: size, u_colorFront: rgba(mixRgb(glowA, accent, 0.18)),
      u_colorMid: rgba(mixRgb(glowB, glowC, 0.27 + 0.18 * mid)), u_colorBack: rgba(base), u_contrast: 0.43 + 0.09 * intensity,
      u_brightness: 0.92 + 0.38 * intensity + 0.32 * impulse + 0.12 * treble
    } satisfies NeuroNoiseUniforms
    case 'metaballs': return {
      ...sizing, ...noise, u_fit: ShaderFitOptions.cover, u_scale: size,
      u_colors: blobs, u_colorsCount: blobs.length, u_colorBack: clear,
      u_count: Math.round(3 + 2 * intensity), u_size: Math.min(1, 0.61 + 0.18 * impulse + 0.09 * bass)
    } satisfies MetaballsUniforms
    case 'grain-gradient': return {
      ...sizing, ...noise, u_fit: ShaderFitOptions.cover, u_scale: size, u_rotation: -19, u_colors: triad, u_colorsCount: triad.length,
      u_colorBack: rgba(base), u_shape: GrainGradientShapes.corners, u_softness: 0.028,
      u_intensity: 0.40 + 0.16 * intensity + 0.11 * impulse, u_noise: 0.012 + 0.024 * intensity
    } satisfies GrainGradientUniforms
    case 'smoke-ring': return {
      ...sizing, ...noise, u_scale: size, u_colorBack: clear, u_colors: triad, u_colorsCount: triad.length,
      u_thickness: 0.034 + 0.016 * intensity + 0.012 * impulse, u_radius: 0.27 + 0.052 * impulse,
      u_innerShape: 0.78, u_noiseIterations: 4, u_noiseScale: 1.6 + 0.26 * treble
    } satisfies SmokeRingUniforms
  }
}

function setAnimatedFrame(mount: ShaderMount, frameMs: number, uniforms: ShaderMountUniforms) {
  // v0.0.82 draws synchronously in both setters at speed zero. Batch their invalidations into one draw.
  const redraw = Reflect.get(mount, 'renderUnlessAnimating')
  if (typeof redraw !== 'function') {
    mount.setUniforms(uniforms)
    mount.setFrame(frameMs)
    return
  }
  Reflect.set(mount, 'renderUnlessAnimating', deferDraw)
  try { mount.setUniforms(uniforms) }
  finally { Reflect.set(mount, 'renderUnlessAnimating', redraw) }
  mount.setFrame(frameMs)
}
const deferDraw = () => {}

export default function PaperShaderStage(props: AmbientStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  const wake = useRef<(() => void) | null>(null)
  const [generation, setGeneration] = useState(0)
  const effect = props.effect as PaperEffect

  useLayoutEffect(() => { latest.current = props; wake.current?.() }, [props])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let lost = false
    let mount: ShaderMount | undefined
    let raf = 0
    let previous = 0
    const colors = getStageColors(container, latest.current)
    const motion = createStageMotion()
    const design = designs[effect]

    function cancel() { cancelAnimationFrame(raf); raf = 0; previous = 0 }
    function contextLost(event: Event) { event.preventDefault(); lost = true; cancel(); latest.current.onFallback?.() }
    function contextRestored() { setGeneration((value) => value + 1) }

    void loadTextures().then((images) => {
      if (disposed) return
      const initial = { ...latest.current, reducedMotion: true }
      const initialMotion = motion(initial, 0)
      function resize() {
        if (lost || !mount || !container) return
        const budget = Math.ceil(container.clientWidth * container.clientHeight * 1.75 ** 2)
        mount.setMaxPixelCount(Math.max(1, Math.min(2_200_000, budget)))
      }
      mount = new ShaderMount(container, design.shader,
        uniformsFor(effect, initial, initialMotion, colors(latest.current, performance.now()), images),
        { alpha: true, premultipliedAlpha: true }, 0, 0, 1, 2_200_000)
      mount.canvasElement.addEventListener('webglcontextlost', contextLost)
      mount.canvasElement.addEventListener('webglcontextrestored', contextRestored)
      resize()
      window.addEventListener('resize', resize)
      removeResize = () => window.removeEventListener('resize', resize)

      function schedule() { if (!raf && !lost && !document.hidden) raf = requestAnimationFrame(draw) }
      function draw(now: number) {
        raf = 0
        if (!mount || document.hidden || lost) return
        const current = latest.current
        const sample = motion(current, previous ? Math.min(40, now - previous) : 1000 / 60, design.pace, now)
        previous = current.reducedMotion ? 0 : now
        setAnimatedFrame(mount, sample.frameMs, uniformsFor(effect, current, sample, colors(current, now), images))
        if (!current.reducedMotion) schedule()
      }
      wake.current = schedule
      latest.current.onRecovered?.()
      schedule()
    }).catch(() => {
      if (!disposed) { container.replaceChildren(); latest.current.onFallback?.() }
    })
    let removeResize = () => {}
    function visibility() { if (document.hidden) cancel(); else wake.current?.() }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true
      cancel()
      wake.current = null
      removeResize()
      document.removeEventListener('visibilitychange', visibility)
      mount?.canvasElement.removeEventListener('webglcontextlost', contextLost)
      mount?.canvasElement.removeEventListener('webglcontextrestored', contextRestored)
      mount?.dispose()
    }
  }, [effect, generation])

  return <div ref={containerRef} />
}
