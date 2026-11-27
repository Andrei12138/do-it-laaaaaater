import { useEffect, useLayoutEffect, useRef } from 'react'
import type { AmbientStageProps } from '../BlogAmbientBackdrop'
import { reactBitsFragment } from './reactBitsShaders'
import { createStageMotion, stageColors } from './stageMotion'

const uniformNames = ['uResolution', 'uPointer', 'uPrimary', 'uSecondary', 'uBase',
  'uDark', 'uTime', 'uIntensity', 'uScale', 'uAudio'] as const
type GL = WebGLRenderingContext | WebGL2RenderingContext

function compile(gl: GL, kind: number, source: string) {
  const shader = gl.createShader(kind)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

function createScene(gl: GL, webgl2: boolean, effect: AmbientStageProps['effect']) {
  const vertex = compile(gl, gl.VERTEX_SHADER, `${webgl2 ? '#version 300 es\nin' : 'attribute'} vec2 aPosition;
    void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`)
  const highPrecision = !!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision
  const fragment = compile(gl, gl.FRAGMENT_SHADER, reactBitsFragment(effect, webgl2, highPrecision))
  const program = gl.createProgram()
  if (vertex && fragment && program) {
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.bindAttribLocation(program, 0, 'aPosition')
    gl.linkProgram(program)
  }
  if (vertex) gl.deleteShader(vertex)
  if (fragment) gl.deleteShader(fragment)
  if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (program) gl.deleteProgram(program)
    return null
  }
  const buffer = gl.createBuffer()
  if (!buffer) {
    gl.deleteProgram(program)
    return null
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  return { program, buffer, uniforms: Object.fromEntries(uniformNames.map((name) => [name, gl.getUniformLocation(program, name)])) }
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
    let colorPalette: AmbientStageProps['palette'] | undefined
    let colorDark: boolean | undefined
    let colors = stageColors(latest.current)

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
      const { uniforms } = scene
      if (colorPalette !== current.palette || colorDark !== current.darkMode) {
        colors = stageColors(current)
        colorPalette = current.palette
        colorDark = current.darkMode
        gl.uniform3fv(uniforms.uPrimary, colors[0])
        gl.uniform3fv(uniforms.uSecondary, colors[1])
        gl.uniform3fv(uniforms.uBase, colors[2])
        gl.uniform1f(uniforms.uDark, current.darkMode ? 1 : 0)
      }
      gl.uniform2f(uniforms.uResolution, canvas!.width, canvas!.height)
      gl.uniform2f(uniforms.uPointer, current.reducedMotion ? 0 : pointerX, current.reducedMotion ? 0 : pointerY)
      gl.uniform1f(uniforms.uTime, sample.frameMs / 1000)
      gl.uniform1f(uniforms.uIntensity, current.config.intensity)
      gl.uniform1f(uniforms.uScale, current.config.scale)
      gl.uniform4f(uniforms.uAudio, sample.impulse, sample.bass, sample.mid, sample.treble)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
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
      if (canvas.width !== targetWidth) canvas.width = targetWidth
      if (canvas.height !== targetHeight) canvas.height = targetHeight
      gl.viewport(0, 0, canvas.width, canvas.height)
      schedule()
    }
    function initialize() {
      if (!gl) return
      scene = createScene(gl, !!gl2, effect)
      colorPalette = undefined
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
      if (scene && !gl.isContextLost()) {
        gl.deleteBuffer(scene.buffer)
        gl.deleteProgram(scene.program)
      }
    }
  }, [effect])

  return <canvas ref={canvasRef} />
}
