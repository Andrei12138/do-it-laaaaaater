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
import { createStageMotion, stageColors, type Rgb } from './stageMotion'

type PaperEffect = keyof typeof designs
type Rgba = [number, number, number, number]
type Motion = ReturnType<ReturnType<typeof createStageMotion>>
const rgba = (color: Rgb, alpha = 1): Rgba => [...color, alpha]
const clear: Rgba = [0, 0, 0, 0]
const pearl: Rgba = [0.96, 0.96, 0.98, 1]
const sizing = {
  u_fit: ShaderFitOptions.contain, u_scale: 1, u_rotation: 0,
  u_originX: 0.5, u_originY: 0.5, u_offsetX: 0, u_offsetY: 0,
  u_worldWidth: 0, u_worldHeight: 0
}

function contour(source: string, mask: string, extra = '') {
  return source.replace('fragColor = vec4(color, opacity);', `
    ${extra}
    float coverage = ${mask};
    fragColor = vec4(clamp(color, vec3(0.), vec3(opacity)), opacity) * coverage;`)
}

const designs = {
  'mesh-gradient': { pace: 1, shader: contour(meshGradientFragmentShader, `
    (1. - smoothstep(.245, .251, abs(foldY))) * smoothstep(.34, .37, fold)`, `
    float foldY = v_objectUV.y + .084 * sin(v_objectUV.x * 6. - .5 * t);
    float fold = .5 + .5 * sin(uvRotated.y * 43. + uvRotated.x * 4.);
    color *= .64 + .31 * smoothstep(.44, .77, fold);
    color = mix(color, vec3(opacity), .47 * smoothstep(.91, .99, fold));`) },
  warp: { pace: 4, shader: contour(warpFragmentShader,
    '1. - smoothstep(.31, .315, abs(v_patternUV.y * .055 + .075 * sin(v_patternUV.x * .22)))') },
  'liquid-metal': { pace: 0.82, shader: contour(liquidMetalFragmentShader, '1.') },
  'god-rays': { pace: 0.87, shader: contour(godRaysFragmentShader,
    '(1. - smoothstep(.62, .96, radius))', `
    float shaft = smoothstep(.085, .14, opacity);
    float core = smoothstep(.17, .45, opacity);
    color = mix(color / max(.001, opacity), vec3(.94), .16 * core);
    opacity = shaft * (.36 + .60 * core);
    color *= opacity;`) },
  'neuro-noise': { pace: 0.8, shader: contour(neuroNoiseFragmentShader.replace(
    'shape_uv *= .13;', 'shape_uv *= .29;').replace('float noise = neuroShape(shape_uv, t);',
    'float field = neuroShape(shape_uv, t); float noise = field;'), '1.', `
    vec2 phase = vec2(field * 19. + shape_uv.y * .13, field * 13. + shape_uv.x * .56);
    vec2 distance = abs(fract(phase) - .5);
    vec2 feather = max(vec2(.012), fwidth(phase) * .8);
    float width = .036 + .021 * u_brightness;
    vec2 line = 1. - smoothstep(vec2(width), vec2(width) + feather, distance);
    float node = (1. - smoothstep(.12, .19, length(distance))) * (.45 + .33 * u_contrast);
    opacity = max(max(line.x * .78, line.y * .46), node);
    color = mix(u_colorMid.rgb, u_colorFront.rgb, max(line.x, node));
    color = mix(color, vec3(.96), node * .52) * opacity;`) },
  metaballs: { pace: 1.3, shader: contour(metaballsFragmentShader.replace(
    '45. - 30. * u_size * sizeFrac', '32. - 23. * u_size * sizeFrac'), '1.', `
    float dome = clamp((totalShape - .4) * 2.2, 0., 1.);
    float ridge = smoothstep(.0, .12, dome) * (1. - smoothstep(.18, .31, dome));
    color *= .48 + .49 * sqrt(dome);
    vec2 slope = normalize(vec2(dFdx(totalShape), dFdy(totalShape)) + 1e-6);
    float key = pow(max(0., dot(slope, vec2(.56, -.83))), 8.) * (ridge + .28 * dome);
    color = mix(color, vec3(opacity), .82 * key);`) },
  'grain-gradient': { pace: 1, shader: contour(grainGradientFragmentShader, `
    (1. - smoothstep(.16, .166, abs(v_objectUV.y + .095 * sin(8. * v_objectUV.x - t))))`) },
  'smoke-ring': { pace: 1.55, shader: contour(smokeRingFragmentShader.replace(
    'shape_uv *= (.8 + 1.2 * noise);', 'shape_uv *= (.94 + .23 * noise);'),
    'smoothstep(.12, .19, ringShape)') }
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

function createColors(props: AmbientStageProps) {
  const [primary, secondary] = stageColors(props)
  return { primary: rgba(primary), secondary: rgba(secondary), rays: [rgba(primary, 0.83), rgba(secondary, 0.62)],
    folds: [clear, rgba(primary), rgba(secondary), clear], pair: [rgba(primary), rgba(secondary)] }
}

function uniformsFor(effect: PaperEffect, props: AmbientStageProps, motion: Motion,
  colors: ReturnType<typeof createColors>, images: Awaited<ReturnType<typeof loadTextures>>): ShaderMountUniforms {
  const { scale, intensity } = props.config
  const { impulse, bass, mid, treble } = motion
  const size = 0.57 + 0.43 * scale
  const { primary, secondary, rays, folds, pair } = colors
  const noise = { u_noiseTexture: images.noise }
  switch (effect) {
    case 'mesh-gradient': return {
      ...sizing, u_fit: ShaderFitOptions.cover, u_scale: size, u_colors: pair, u_colorsCount: pair.length,
      u_distortion: 0.10 + 0.12 * intensity + 0.11 * impulse, u_swirl: 0.15 + 0.11 * mid,
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
      ...sizing, u_colorBack: clear, u_colorTint: primary, u_image: images.pixel, u_isImage: false,
      u_shape: LiquidMetalShapes.diamond, u_scale: 0.82 * size, u_angle: 27, u_repetition: 3.2 + 1.1 * intensity,
      u_softness: 0.025, u_contour: 0.18, u_shiftRed: 0, u_shiftBlue: 0,
      u_distortion: 0.14 + 0.17 * intensity + 0.22 * impulse + 0.06 * bass
    } satisfies LiquidMetalUniforms
    case 'god-rays': return {
      ...sizing, ...noise, u_fit: ShaderFitOptions.cover, u_scale: size, u_offsetY: -0.13,
      u_colorBack: clear, u_colorBloom: pearl, u_colors: rays, u_colorsCount: rays.length,
      u_spotty: 0.08, u_midSize: 0.11 + 0.027 * impulse, u_midIntensity: 0.18,
      u_density: 0.24 + 0.11 * scale, u_intensity: Math.min(1, 0.37 + 0.23 * intensity + 0.21 * impulse),
      u_bloom: 0.035 + 0.052 * impulse
    } satisfies GodRaysUniforms
    case 'neuro-noise': return {
      ...sizing, u_fit: ShaderFitOptions.cover, u_scale: size, u_colorFront: primary, u_colorMid: secondary,
      u_colorBack: clear, u_contrast: 0.43 + 0.09 * intensity,
      u_brightness: 0.92 + 0.38 * intensity + 0.32 * impulse + 0.12 * treble
    } satisfies NeuroNoiseUniforms
    case 'metaballs': return {
      ...sizing, ...noise, u_scale: size, u_colors: pair, u_colorsCount: pair.length, u_colorBack: clear,
      u_count: Math.round(3 + 2 * intensity), u_size: Math.min(1, 0.61 + 0.18 * impulse + 0.09 * bass)
    } satisfies MetaballsUniforms
    case 'grain-gradient': return {
      ...sizing, ...noise, u_scale: size, u_rotation: -19, u_colors: pair, u_colorsCount: pair.length,
      u_colorBack: clear, u_shape: GrainGradientShapes.corners, u_softness: 0.028,
      u_intensity: 0.40 + 0.16 * intensity + 0.11 * impulse, u_noise: 0.012 + 0.024 * intensity
    } satisfies GrainGradientUniforms
    case 'smoke-ring': return {
      ...sizing, ...noise, u_scale: size, u_colorBack: clear, u_colors: pair, u_colorsCount: pair.length,
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
    let colorSource = latest.current
    let colors = createColors(colorSource)
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
      mount = new ShaderMount(container, design.shader, uniformsFor(effect, initial, initialMotion, colors, images),
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
        if (colorSource.palette !== current.palette || colorSource.darkMode !== current.darkMode) colors = createColors(current)
        colorSource = current
        const sample = motion(current, previous ? Math.min(40, now - previous) : 1000 / 60, design.pace, now)
        previous = current.reducedMotion ? 0 : now
        setAnimatedFrame(mount, sample.frameMs, uniformsFor(effect, current, sample, colors, images))
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
