import { useEffect, useLayoutEffect, useRef } from 'react'
import type { AmbientStageProps } from '../BlogAmbientBackdrop'
import {
  aurora, chromeSim, chromeSlope, colorBends, iridescence, lightRays, liquidChrome, prism,
  screenVertex, shaderSource, threadsLine, threadsScreen, threadsVertex
} from './reactBitsShaders'
import { createStageMotion, getStageColors, type Rgb } from './stageMotion'

type GL = WebGLRenderingContext | WebGL2RenderingContext
type Values = Record<string, number | number[]>
type Motion = ReturnType<ReturnType<typeof createStageMotion>>
type Scene = NonNullable<ReturnType<typeof createScene>>
const fragments = {
  threads: threadsScreen, iridescence, 'liquid-chrome': liquidChrome, aurora,
  'light-rays': lightRays, prism, 'color-bends': colorBends
}

function compile(gl: GL, kind: number, source: string) {
  const shader = gl.createShader(kind)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  const log = gl.getShaderInfoLog(shader)
  gl.deleteShader(shader)
  throw new Error(log ?? 'React Bits shader compilation failed')
}

function createPass(gl: GL, webgl2: boolean, vertexBody: string, fragmentBody: string, derivatives = false) {
  const vertex = compile(gl, gl.VERTEX_SHADER, shaderSource(vertexBody, webgl2, true))
  let fragment: WebGLShader | null = null
  let program: WebGLProgram | null = null
  try {
    fragment = compile(gl, gl.FRAGMENT_SHADER, shaderSource(fragmentBody, webgl2, false, derivatives))
    program = gl.createProgram()
    if (!vertex || !fragment || !program) throw new Error('React Bits program allocation failed')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.bindAttribLocation(program, 0, 'aPosition')
    gl.bindAttribLocation(program, 0, 'aPoint')
    gl.bindAttribLocation(program, 1, 'aLine')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'React Bits link failed')
    const uniforms = new Map<string, { location: WebGLUniformLocation; type: number }>()
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
    for (let index = 0; index < count; index += 1) {
      const info = gl.getActiveUniform(program, index)
      const location = info && gl.getUniformLocation(program, info.name)
      if (info && location) uniforms.set(info.size > 1 ? info.name.split('[')[0] : info.name, { location, type: info.type })
    }
    return { program, uniforms }
  } catch (error) {
    if (program) gl.deleteProgram(program)
    throw error
  } finally {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
  }
}

type Pass = ReturnType<typeof createPass>

function setUniforms(gl: GL, pass: Pass, values: Values) {
  gl.useProgram(pass.program)
  for (const [name, value] of Object.entries(values)) {
    const uniform = pass.uniforms.get(name)
    if (!uniform) continue
    const { location, type } = uniform
    if (typeof value === 'number') {
      if (type === gl.FLOAT) gl.uniform1f(location, value)
      else gl.uniform1i(location, value)
    } else if (type === gl.FLOAT_VEC2) gl.uniform2fv(location, value)
    else if (type === gl.FLOAT_VEC3) gl.uniform3fv(location, value)
    else if (type === gl.FLOAT_VEC4) gl.uniform4fv(location, value)
    else if (type === gl.FLOAT_MAT3) gl.uniformMatrix3fv(location, false, value)
  }
}

const lineCount = 40
const segments = 160
const ribbon = new Float32Array((segments + 1) * 4)
for (let index = 0; index <= segments; index += 1) {
  ribbon.set([index / segments, -1, index / segments, 1], index * 4)
}

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer }
const rampSize = 128
const gridSize = 96
const emptySwirls = Array<number>(24).fill(0)
const unitVector = [0, 1]

function createScene(gl: GL, gl2: WebGL2RenderingContext | null, id: AmbientStageProps['effect']) {
  const effect = id as keyof typeof fragments
  const fragment = fragments[effect]
  if (!fragment) return null
  const derivatives = effect === 'light-rays' || effect === 'liquid-chrome'
  if (derivatives && !gl2 && !gl.getExtension('OES_standard_derivatives')) return null

  const programs: Pass[] = []
  const textures: WebGLTexture[] = []
  const framebuffers: WebGLFramebuffer[] = []
  const quad = gl.createBuffer()
  if (!quad) return null
  let lines: WebGLBuffer | null = null
  function dispose() {
    programs.forEach(({ program }) => gl.deleteProgram(program))
    textures.forEach((texture) => gl.deleteTexture(texture))
    framebuffers.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer))
    if (lines) gl.deleteBuffer(lines)
    gl.deleteBuffer(quad)
  }
  function pass(body: string, vertex = screenVertex, needsDerivatives = false) {
    const result = createPass(gl, !!gl2, vertex, body, needsDerivatives)
    programs.push(result)
    return result
  }
  function texture(filter: number = gl.LINEAR, wrap: number = gl.CLAMP_TO_EDGE) {
    const result = gl.createTexture()
    if (!result) throw new Error('React Bits texture allocation failed')
    textures.push(result)
    gl.bindTexture(gl.TEXTURE_2D, result)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    return result
  }
  function target(filter: number = gl.LINEAR): Target {
    const image = texture(filter)
    const framebuffer = gl.createFramebuffer()
    if (!framebuffer) throw new Error('React Bits framebuffer allocation failed')
    framebuffers.push(framebuffer)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0)
    return { texture: image, framebuffer }
  }
  function allocate(output: Target, width: number, height: number,
    storage: number = gl.RGBA, format: number = gl.RGBA, type: number = gl.UNSIGNED_BYTE) {
    gl.bindTexture(gl.TEXTURE_2D, output.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, storage, width, height, 0, format, type, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return true
  }

  try {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    const screen = pass(fragment, screenVertex, derivatives)
    let threads: { linePass: Pass; target: Target } | undefined
    let ripple: { sim: Pass; slope: Pass; states: [Target, Target]; output: Target; index: number } | undefined
    let input: WebGLTexture | null = null
    if (effect === 'threads') {
      lines = gl.createBuffer()
      if (!lines) throw new Error('React Bits ribbon allocation failed')
      gl.bindBuffer(gl.ARRAY_BUFFER, lines)
      gl.bufferData(gl.ARRAY_BUFFER, ribbon, gl.STATIC_DRAW)
      threads = { linePass: pass(threadsLine, threadsVertex), target: target() }
    } else if (effect === 'liquid-chrome') {
      const half = gl2 ? null : gl.getExtension('OES_texture_half_float')
      const canRender = gl2 ? gl.getExtension('EXT_color_buffer_float')
        : half && gl.getExtension('EXT_color_buffer_half_float') && gl.getExtension('OES_texture_half_float_linear')
      if (canRender) {
        const states: [Target, Target] = [target(gl.NEAREST), target(gl.NEAREST)]
        const output = target()
        const storage = gl2?.RG16F ?? gl.RGBA
        const format = gl2?.RG ?? gl.RGBA
        const type = gl2?.HALF_FLOAT ?? half!.HALF_FLOAT_OES
        if ([...states, output].every((item) => allocate(item, gridSize, gridSize, storage, format, type))) {
          ripple = { sim: pass(chromeSim), slope: pass(chromeSlope), states, output, index: 0 }
        }
      }
    }
    if (effect === 'iridescence' || effect === 'liquid-chrome') {
      input = texture(gl.NEAREST)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    } else if (effect === 'prism') {
      input = texture(gl.LINEAR, gl.REPEAT)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rampSize, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { screen, quad, lines, threads, input, ripple, allocate, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

function oklch([red, green, blue]: Rgb): Rgb {
  const linear = (channel: number) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  const [r, g, b] = [linear(red), linear(green), linear(blue)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const axisB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, axisB), Math.atan2(axisB, a)]
}

function auroraStops(colors: Rgb[]) {
  const stops = colors.map(oklch)
  let previous = stops.find((stop) => stop[1] > 0.02)?.[2] ?? 0
  for (const stop of stops) {
    let hue = stop[1] > 0.02 ? stop[2] : previous
    while (hue - previous > Math.PI) hue -= 2 * Math.PI
    while (hue - previous < -Math.PI) hue += 2 * Math.PI
    stop[2] = previous = hue
  }
  return stops.flat()
}

function prismRotation(yaw: number, pitch: number, roll: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const cx = Math.cos(pitch), sx = Math.sin(pitch)
  const cz = Math.cos(roll), sz = Math.sin(roll)
  return [cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz,
    -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz, sy * cx, -sx, cy * cx]
}

function uploadRamp(gl: GL, pixels: Uint8Array, colors: Rgb[]) {
  for (let index = 0; index < rampSize; index += 1) {
    const phase = index / rampSize * colors.length
    const from = colors[Math.floor(phase)]
    const to = colors[(Math.floor(phase) + 1) % colors.length]
    const fraction = phase % 1
    const weight = fraction * fraction * (3 - 2 * fraction)
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[index * 4 + channel] = Math.round(255 * (from[channel] + (to[channel] - from[channel]) * weight))
    }
    pixels[index * 4 + 3] = 255
  }
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, rampSize, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
}

function drawScene(gl: GL, scene: Scene, props: AmbientStageProps, motion: Motion,
  colors: ReturnType<ReturnType<typeof getStageColors>>, width: number, height: number,
  pointerX: number, pointerY: number, paletteChanged: boolean, ramp: Uint8Array) {
  const { intensity, scale } = props.config
  const { impulse, bass, mid, treble } = motion
  const { glowA, glowB, glowC, accent } = colors
  const light = props.darkMode ? 0 : 1
  const time = motion.frameMs / 1000
  const minSide = Math.min(width, height)
  const x = 0.5 + 0.5 * pointerX, y = 0.5 + 0.5 * pointerY
  const resolution = [width, height]
  const zoom = 0.66 + 0.34 * scale
  const { effect } = props
  const { threads, ripple } = scene
  const bind = (target: Target | null, texture: WebGLTexture | null, w = width, h = height) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.viewport(0, 0, w, h)
  }
  const triangle = () => gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.activeTexture(gl.TEXTURE0)
  if (threads && scene.lines) {
    bind(threads.target, null)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindBuffer(gl.ARRAY_BUFFER, scene.lines)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const turn = -0.21
    const c = Math.cos(turn), s = Math.sin(turn)
    const across = height * c + width * Math.abs(s)
    setUniforms(gl, threads.linePass, {
      uTime: time, uResolution: resolution, uFrame: [(width * c + height * Math.abs(s)) * 1.03, across],
      uAmplitude: 2.4 + 1.15 * intensity + 0.95 * impulse, uDistance: Math.min(1.1, 0.78 * zoom),
      uMouse: [x, y], uCount: lineCount, uThickness: 0.9 + 0.3 * intensity + 0.28 * treble,
      uSoftness: 0.6, uWaves: 1.8, uSplit: 0.05, uFray: 0.24, uSeed: 0.37,
      uTurn: [c, s], uPart: [pointerX * width * 0.42, pointerY * height * 0.42, 0.14 * impulse, across * 0.25],
      uTaper: 0.24, uColor: glowA, uMidColor: glowB, uAccent: glowC
    })
    for (let index = 0; index < lineCount; index += 1) {
      gl.vertexAttrib1f(1, index)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, (segments + 1) * 2)
    }
    gl.disable(gl.BLEND)
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, scene.quad)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  if (ripple) {
    const front = ripple.states[ripple.index]
    const back = ripple.states[1 - ripple.index]
    const size = [gridSize, gridSize]
    bind(back, front.texture, gridSize, gridSize)
    setUniforms(gl, ripple.sim, {
      uState: 0, uSize: size, uStroke: [x * gridSize, y * gridSize, x * gridSize, y * gridSize],
      uImpulse: [0.028 * impulse, 4]
    })
    triangle()
    bind(ripple.output, back.texture, gridSize, gridSize)
    setUniforms(gl, ripple.slope, { uState: 0, uSize: size })
    triangle()
    ripple.index = 1 - ripple.index
  }
  bind(null, threads?.target.texture ?? ripple?.output.texture ?? scene.input)
  const common: Values = { uResolution: resolution, uTime: time, uLight: light, uGlowA: glowA, uGlowB: glowB, uGlowC: glowC }
  let values: Values
  switch (effect) {
    case 'threads': values = { uLines: 0, uOpacity: 1, uCurve: 1 }; break
    case 'iridescence': values = {
      uScale: zoom, uMouse: [x, y], uAmplitude: 0.12 + 0.08 * bass, uRotation: 0.12, uDetail: 8,
      uWarp: 0.9 + 0.2 * intensity + 0.21 * impulse, uHue: 0.18 * treble, uSaturation: 1,
      uBrightness: light ? 1.17 : 0.96, uContrast: 1.18, uGrain: 0.04, uSeed: 0.31, uOpacity: 1,
      uField: 0, uStir: 0, uPointer: [x, y, props.reducedMotion ? 0 : 0.24], uSheen: 0.3,
      uSwirls: impulse ? [x, y, 0.42, 0.65 * impulse, ...emptySwirls.slice(4)] : emptySwirls
    }; break
    case 'liquid-chrome': values = {
      uUnit: minSide * zoom, uAmplitude: 0.32 + 0.14 * intensity + 0.13 * impulse, uFrequency: [3, 2.8],
      uDetail: 4, uSharpness: 1.7, uDepth: 1.1 + 0.32 * bass, uPresence: 1,
      uShift: [0.13 * pointerX, 0.1 * pointerY], uRoughness: 0.2, uExposure: light ? 1.37 : 0.92,
      uSlope: 0, uSlopeSize: ripple ? [gridSize, gridSize] : [1, 1], uRipple: ripple ? 3.5 : 0
    }; break
    case 'aurora': values = {
      uTime: time * 2.2, uColorStops: auroraStops([glowA, glowB, glowC]), uAmplitude: 1.05 + 0.5 * intensity + 0.55 * impulse,
      uBlend: 0.55, uHeight: 0.54 + 0.06 * bass, uScale: zoom, uGlow: 0.55 + 0.3 * treble,
      uBrightness: 0.98 + 0.22 * intensity, uLayers: 3, uPointer: [pointerX * width / (2 * height), y, 0.26],
      uReveal: 1, uOpacity: 1, uLightMode: light
    }; break
    case 'light-rays': values = {
      uScale: 1, uSource: [width * 0.5, -0.09 * height], uAim: unitVector, uReach: Math.max(width, height),
      uSpread: 0.62 + 0.17 * scale, uLength: 3, uFade: 1.6, uSaturation: 1, uDensity: 1.15 + 0.18 * mid,
      uSharpness: 0.45, uGlow: 0.42 + 0.3 * impulse, uHaze: 0.23, uAtmosphere: 0.28, uNoise: 0.02,
      uDistortion: 0.11 + 0.09 * bass, uIntensity: (light ? 1.32 : 1.22) + 0.5 * intensity + 0.45 * impulse,
      uIntro: [2.6, 1], uOpacity: 1
    }; break
    case 'prism': {
      if (paletteChanged) uploadRamp(gl, ramp, [glowA, glowB, glowC])
      values = {
        uRay: prismRotation(time * 0.25 + 0.27 * pointerX, 0.16 + 0.15 * pointerY, -0.19),
        uGlow: 0.85 + 0.36 * intensity + 0.34 * impulse, uColorFreq: 1.65 + 0.14 * treble,
        uCenterShift: 0.875, uInvBaseHalf: 1 / 2.75, uInvHeight: 1 / 3.5, uMinAxis: 2.75,
        uPxScale: 1 / (height * 0.36 * zoom), uPalette: 0, uUsePalette: 1,
        uNoise: 0.007, uSaturation: 1.14, uNeutral: 0.35
      }; break
    }
    case 'color-bends': values = {
      uCanvas: resolution, uSpeed: 0.43, uRot: [0.94, 0.342], uColorCount: 4,
      uColors: [...glowA, ...glowB, ...glowC, ...accent], uTransparent: 1, uScale: zoom,
      uFrequency: 1.15 + 0.12 * mid, uWarpStrength: 0.76 + 0.22 * intensity + 0.24 * impulse,
      uPointer: [pointerX, pointerY], uMouseInfluence: 0.22, uParallax: 0.22,
      uNoise: 0.02, uIterations: 1, uIntensity: 1.35 + 0.28 * intensity + 0.14 * treble, uBandWidth: 3.2
    }; break
    default: return
  }
  setUniforms(gl, scene.screen, { ...common, ...values })
  triangle()
}

export default function ReactBitsStage(props: AmbientStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useRef(props)
  const wake = useRef<(() => void) | null>(null)
  const { effect } = props

  useLayoutEffect(() => {
    latest.current = props
    wake.current?.()
  }, [props])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const attributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false }
    const gl2 = canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null
    const gl = gl2 ?? (canvas.getContext('webgl', attributes) as WebGLRenderingContext | null)
    if (!gl) { latest.current.onFallback?.(); return }
    const motion = createStageMotion()
    let scene: ReturnType<typeof createScene> = null
    let raf = 0
    let previous = 0
    let pointerX = 0
    let pointerY = 0
    const colors = getStageColors(canvas, latest.current)
    let previousColors: ReturnType<typeof colors> | undefined
    const ramp = new Uint8Array(rampSize * 4)

    function cancel() {
      cancelAnimationFrame(raf)
      raf = 0
      previous = 0
    }
    function schedule() {
      if (!raf && scene && !document.hidden) raf = requestAnimationFrame(draw)
    }
    function draw(now: number) {
      raf = 0
      if (!scene || !gl || document.hidden) return
      const current = latest.current
      const elapsed = previous ? Math.min(40, now - previous) : 1000 / 60
      previous = now
      const sample = motion(current, elapsed, 1, now)
      const palette = colors(current, now)
      drawScene(gl, scene, current, sample, palette, canvas!.width, canvas!.height,
        current.reducedMotion ? 0 : pointerX, current.reducedMotion ? 0 : pointerY, palette !== previousColors, ramp)
      previousColors = palette
      if (!current.reducedMotion) schedule()
      else previous = 0
    }
    function resize() {
      if (!scene || !canvas || !gl) return
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      const budget = effect === 'prism' ? 1_250_000 : 2_200_000
      const dpr = Math.min(devicePixelRatio || 1, 1.75, Math.sqrt(budget / (width * height)))
      const targetWidth = Math.max(1, Math.floor(width * dpr))
      const targetHeight = Math.max(1, Math.floor(height * dpr))
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }
      if (scene.threads && !scene.allocate(scene.threads.target, targetWidth, targetHeight)) {
        scene.dispose()
        scene = null
        latest.current.onFallback?.()
        return
      }
      schedule()
    }
    function initialize() {
      if (!gl) return
      try { scene = createScene(gl, gl2, effect) }
      catch (error) { console.warn(`Unable to initialize React Bits effect ${effect}`, error) }
      previousColors = undefined
      if (!scene) { latest.current.onFallback?.(); return }
      latest.current.onRecovered?.()
      resize()
    }
    function lost(event: Event) {
      event.preventDefault()
      cancel()
      scene = null
      latest.current.onFallback?.()
    }
    function point(event: PointerEvent) {
      if (event.pointerType === 'touch' || latest.current.reducedMotion) return
      pointerX = event.clientX / Math.max(1, innerWidth) * 2 - 1
      pointerY = 1 - event.clientY / Math.max(1, innerHeight) * 2
    }
    function visibility() { if (document.hidden) cancel(); else schedule() }

    wake.current = schedule
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    observer?.observe(canvas)
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', point, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', initialize)
    initialize()
    return () => {
      cancel()
      wake.current = null
      observer?.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', point)
      document.removeEventListener('visibilitychange', visibility)
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', initialize)
      if (scene && !gl.isContextLost()) scene.dispose()
    }
  }, [effect])

  return <canvas ref={canvasRef} />
}
