import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  DEFAULT_AMBIENT_PALETTE,
  type BlogAmbientMode,
  type BlogAmbientPalette
} from '../../blog-ambient'

export interface BlogAmbientBackdropProps {
  mode: BlogAmbientMode
  active: boolean
  darkMode: boolean
  palette: BlogAmbientPalette | null
  coverUrl: string | null
  trackTitle?: string
  trackArtist?: string
  getAudioEnergy?: () => { bass: number; mid: number; level: number }
}

type RgbTuple = [number, number, number]

const TAU = Math.PI * 2
const SILK_WIDTH = 320
const SILK_HEIGHT = 200
const GRID_STEP = 28
const CURSOR_RADIUS = 168

const VINYL_GROOVE_RADII = [
  192, 185, 178, 170, 163, 154, 146, 139, 130, 122, 114, 105, 97, 89, 82
]

function parseRgbTriplet(raw: string, fallback: RgbTuple): RgbTuple {
  const parts = raw.split(',').map((part) => Number(part.trim()))
  if (
    parts.length >= 3 &&
    Number.isFinite(parts[0]) &&
    Number.isFinite(parts[1]) &&
    Number.isFinite(parts[2])
  ) {
    return [
      Math.max(0, Math.min(255, parts[0])),
      Math.max(0, Math.min(255, parts[1])),
      Math.max(0, Math.min(255, parts[2]))
    ]
  }
  return fallback
}

function lerpRgb(current: RgbTuple, target: RgbTuple, t: number): RgbTuple {
  return [
    current[0] + (target[0] - current[0]) * t,
    current[1] + (target[1] - current[1]) * t,
    current[2] + (target[2] - current[2]) * t
  ]
}

function mixRgb(a: RgbTuple, b: RgbTuple, ratio: number): RgbTuple {
  return [
    Math.round(a[0] + (b[0] - a[0]) * ratio),
    Math.round(a[1] + (b[1] - a[1]) * ratio),
    Math.round(a[2] + (b[2] - a[2]) * ratio)
  ]
}

function rgbaStr(rgb: RgbTuple, alpha: number): string {
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha.toFixed(4)})`
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function readTabHidden(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'hidden'
}

export function BlogAmbientBackdrop({
  mode,
  active,
  darkMode,
  palette,
  coverUrl,
  trackTitle,
  trackArtist,
  getAudioEnergy
}: BlogAmbientBackdropProps) {
  const hasVisualSource = Boolean(palette || coverUrl)
  const isVisible = active && mode !== 'minimal' && hasVisualSource

  // Keep animations alive during the 700ms fade-out, then pause GPU/CPU work completely
  const [motionRunning, setMotionRunning] = useState<boolean>(isVisible)
  const [reducedMotion, setReducedMotion] = useState<boolean>(readReducedMotion)
  const [tabHidden, setTabHidden] = useState<boolean>(readTabHidden)
  const [coverBroken, setCoverBroken] = useState(false)

  const wavesCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const silkCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const effectivePalette = palette ?? DEFAULT_AMBIENT_PALETTE
  const paletteRef = useRef<BlogAmbientPalette>(effectivePalette)
  paletteRef.current = effectivePalette

  const darkModeRef = useRef<boolean>(darkMode)
  darkModeRef.current = darkMode

  const getAudioEnergyRef = useRef(getAudioEnergy)
  getAudioEnergyRef.current = getAudioEnergy

  useEffect(() => {
    setCoverBroken(false)
  }, [coverUrl])

  useEffect(() => {
    if (isVisible) {
      setMotionRunning(true)
      return
    }
    const timer = globalThis.setTimeout(() => {
      setMotionRunning(false)
    }, 740)
    return () => globalThis.clearTimeout(timer)
  }, [isVisible])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisChange = () => setTabHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [])

  const showWaves = isVisible && mode === 'waves'
  const showSilk = isVisible && mode === 'silk'
  const showVinyl = isVisible && mode === 'vinyl'

  const wavesActive = (showWaves || (motionRunning && mode === 'waves')) && !tabHidden
  const silkActive = (showSilk || (motionRunning && mode === 'silk')) && !tabHidden

  // -------------------------------------------------------------------------
  // Mode 1: 'waves' — High-DPI Figma Precision Dot Matrix + 5 Silk Audio Wave Ribbons
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!wavesActive) return
    const canvas = wavesCanvasRef.current
    if (!canvas || typeof window === 'undefined') return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let vw = 0
    let vh = 0
    let dpr = 1

    const syncSize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      vw = Math.max(1, window.innerWidth)
      vh = Math.max(1, window.innerHeight)
      const nextW = Math.round(vw * dpr)
      const nextH = Math.round(vh * dpr)
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW
        canvas.height = nextH
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    syncSize()

    let mouseTargetX = -9999
    let mouseTargetY = -9999
    let mouseX = -9999
    let mouseY = -9999
    let pointerInside = false

    const onMouseMove = (event: MouseEvent) => {
      mouseTargetX = event.clientX
      mouseTargetY = event.clientY
      if (!pointerInside) {
        mouseX = event.clientX
        mouseY = event.clientY
        pointerInside = true
      }
    }
    const onMouseLeave = () => {
      pointerInside = false
      mouseTargetX = -9999
      mouseTargetY = -9999
    }

    window.addEventListener('resize', syncSize, { passive: true })
    if (!reducedMotion) {
      window.addEventListener('mousemove', onMouseMove, { passive: true })
      window.addEventListener('mouseleave', onMouseLeave, { passive: true })
    }

    const initPal = paletteRef.current
    let curA = parseRgbTriplet(initPal.glowA, [77, 73, 252])
    let curB = parseRgbTriplet(initPal.glowB, [147, 51, 234])
    let curC = parseRgbTriplet(initPal.glowC, [56, 189, 248])

    let smoothBass = 0
    let smoothMid = 0
    let smoothLevel = 0
    let phase = 1.35
    let shimmerPhase = 0
    let lastTs = performance.now()
    let rafId = 0

    const renderFrame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000))
      lastTs = now

      const targetPal = paletteRef.current
      const targetA = parseRgbTriplet(targetPal.glowA, [77, 73, 252])
      const targetB = parseRgbTriplet(targetPal.glowB, [147, 51, 234])
      const targetC = parseRgbTriplet(targetPal.glowC, [56, 189, 248])

      const colorStep = Math.min(1, dt * 4.2)
      curA = lerpRgb(curA, targetA, colorStep)
      curB = lerpRgb(curB, targetB, colorStep)
      curC = lerpRgb(curC, targetC, colorStep)

      const rawEnergy = getAudioEnergyRef.current
        ? getAudioEnergyRef.current()
        : { bass: 0, mid: 0, level: 0 }

      const bassRate = rawEnergy.bass > smoothBass ? 0.28 : 0.09
      const midRate = rawEnergy.mid > smoothMid ? 0.24 : 0.09
      const lvlRate = rawEnergy.level > smoothLevel ? 0.22 : 0.08
      smoothBass += (rawEnergy.bass - smoothBass) * bassRate
      smoothMid += (rawEnergy.mid - smoothMid) * midRate
      smoothLevel += (rawEnergy.level - smoothLevel) * lvlRate

      if (!reducedMotion) {
        phase += dt * (0.95 + smoothMid * 1.65 + smoothLevel * 0.45)
        shimmerPhase += dt * (1.5 + smoothBass * 2.6 + smoothMid * 1.2)
        if (pointerInside) {
          mouseX += (mouseTargetX - mouseX) * Math.min(1, dt * 14)
          mouseY += (mouseTargetY - mouseY) * Math.min(1, dt * 14)
        } else {
          mouseX = -9999
          mouseY = -9999
        }
      }

      const isDark = darkModeRef.current
      ctx.clearRect(0, 0, vw, vh)

      // Subtle atmospheric corner wash so dots & ribbons sit on an editorial gallery canvas
      const washGrad = ctx.createLinearGradient(0, 0, vw, vh)
      washGrad.addColorStop(0, rgbaStr(curA, isDark ? 0.08 : 0.055))
      washGrad.addColorStop(0.5, rgbaStr(curB, isDark ? 0.045 : 0.032))
      washGrad.addColorStop(1, rgbaStr(curC, isDark ? 0.085 : 0.06))
      ctx.fillStyle = washGrad
      ctx.fillRect(0, 0, vw, vh)

      // 1) Precision 28px Figma Dot Matrix (batched base pass + audio shimmer crest pass + cursor halo)
      const neutralBase: RgbTuple = isDark ? [175, 180, 198] : [115, 120, 138]
      const dotTint = mixRgb(neutralBase, curA, isDark ? 0.42 : 0.38)
      const shimmerTint = mixRgb(curA, curC, 0.48)
      const baseDotAlpha = (isDark ? 0.19 : 0.165) + smoothBass * 0.065
      const baseRadius = 1.2
      const cursorR2 = CURSOR_RADIUS * CURSOR_RADIUS

      const offsetX = ((vw % GRID_STEP) * 0.5) || 14
      const offsetY = ((vh % GRID_STEP) * 0.5) || 14

      const nearCursorDots: Array<{
        x: number
        y: number
        r: number
        falloff: number
      }> = []

      ctx.beginPath()
      for (let gy = offsetY; gy < vh; gy += GRID_STEP) {
        for (let gx = offsetX; gx < vw; gx += GRID_STEP) {
          const dx = gx - mouseX
          const dy = gy - mouseY
          const d2 = dx * dx + dy * dy
          if (d2 < cursorR2) {
            const dist = Math.sqrt(d2)
            const falloff = Math.pow(1 - dist / CURSOR_RADIUS, 2)
            const push = dist > 0.5 ? (falloff * 7.2) / dist : 0
            nearCursorDots.push({
              x: gx + dx * push,
              y: gy + dy * push,
              r: baseRadius + falloff * 0.95 + smoothBass * 0.28,
              falloff
            })
            continue
          }
          ctx.moveTo(gx + baseRadius, gy)
          ctx.arc(gx, gy, baseRadius, 0, TAU)
        }
      }
      ctx.fillStyle = rgbaStr(dotTint, baseDotAlpha)
      ctx.fill()

      // Audio-reactive traveling shimmer wave across the dot matrix
      const shimmerStrength = 0.08 + smoothBass * 0.24 + smoothMid * 0.10
      if (!reducedMotion && shimmerStrength > 0.05) {
        ctx.beginPath()
        const shimmerRadius = baseRadius + 0.32 + smoothBass * 0.42
        for (let gy = offsetY; gy < vh; gy += GRID_STEP) {
          for (let gx = offsetX; gx < vw; gx += GRID_STEP) {
            const waveCrest = Math.sin(gx * 0.0055 + gy * 0.0042 - shimmerPhase)
            if (waveCrest > 0.72) {
              ctx.moveTo(gx + shimmerRadius, gy)
              ctx.arc(gx, gy, shimmerRadius, 0, TAU)
            }
          }
        }
        ctx.fillStyle = rgbaStr(shimmerTint, isDark ? shimmerStrength * 0.85 : shimmerStrength * 0.72)
        ctx.fill()
      }

      // Cursor-displaced luminous dots
      for (let i = 0; i < nearCursorDots.length; i += 1) {
        const d = nearCursorDots[i]
        const cursorColor = mixRgb(curA, curC, d.falloff * 0.55)
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, TAU)
        ctx.fillStyle = rgbaStr(
          cursorColor,
          Math.min(0.88, baseDotAlpha + d.falloff * (isDark ? 0.52 : 0.46))
        )
        ctx.fill()
      }

      // 2) 5 Silk Audio Wave Ribbons (razor-sharp 1.4px–2.2px harmonic curves + delicate ribbon fill)
      const ribbons: ReadonlyArray<{
        color: RgbTuple
        endColor: RgbTuple
        yRatio: number
        baseAmp: number
        freq1: number
        freq2: number
        freq3: number
        speedMul: number
        phaseOffset: number
        lineWidth: number
        fillDepth: number
        strokeAlpha: number
        fillAlpha: number
      }> = [
        {
          color: curA,
          endColor: curB,
          yRatio: 0.23,
          baseAmp: 24,
          freq1: 0.0034,
          freq2: 0.0076,
          freq3: 0.0019,
          speedMul: 1.0,
          phaseOffset: 0.0,
          lineWidth: 2.15,
          fillDepth: 68,
          strokeAlpha: isDark ? 0.58 : 0.46,
          fillAlpha: isDark ? 0.14 : 0.10
        },
        {
          color: curB,
          endColor: curC,
          yRatio: 0.38,
          baseAmp: 30,
          freq1: 0.0029,
          freq2: 0.0064,
          freq3: 0.0023,
          speedMul: -0.84,
          phaseOffset: 1.4,
          lineWidth: 1.85,
          fillDepth: 74,
          strokeAlpha: isDark ? 0.52 : 0.42,
          fillAlpha: isDark ? 0.12 : 0.09
        },
        {
          color: curC,
          endColor: curA,
          yRatio: 0.53,
          baseAmp: 34,
          freq1: 0.0025,
          freq2: 0.0058,
          freq3: 0.0017,
          speedMul: 1.16,
          phaseOffset: 2.75,
          lineWidth: 2.2,
          fillDepth: 82,
          strokeAlpha: isDark ? 0.60 : 0.48,
          fillAlpha: isDark ? 0.14 : 0.105
        },
        {
          color: mixRgb(curA, curC, 0.5),
          endColor: curB,
          yRatio: 0.68,
          baseAmp: 26,
          freq1: 0.0038,
          freq2: 0.0081,
          freq3: 0.0021,
          speedMul: -0.96,
          phaseOffset: 4.1,
          lineWidth: 1.6,
          fillDepth: 64,
          strokeAlpha: isDark ? 0.46 : 0.38,
          fillAlpha: isDark ? 0.11 : 0.085
        },
        {
          color: mixRgb(curB, curC, 0.45),
          endColor: curC,
          yRatio: 0.81,
          baseAmp: 21,
          freq1: 0.0031,
          freq2: 0.0069,
          freq3: 0.0015,
          speedMul: 0.78,
          phaseOffset: 5.3,
          lineWidth: 1.4,
          fillDepth: 56,
          strokeAlpha: isDark ? 0.44 : 0.36,
          fillAlpha: isDark ? 0.10 : 0.08
        }
      ]

      const stepX = 6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      for (let rIdx = 0; rIdx < ribbons.length; rIdx += 1) {
        const rib = ribbons[rIdx]
        const baseY = vh * rib.yRatio
        const dynAmp =
          rib.baseAmp * (1 + smoothBass * 1.28 + smoothMid * 0.36 + smoothLevel * 0.22)
        const p = phase * rib.speedMul + rib.phaseOffset

        ctx.beginPath()
        let firstY = baseY
        for (let x = 0; x <= vw + stepX; x += stepX) {
          const clampedX = Math.min(vw, x)
          // Gentle horizontal breathing envelope — slightly livelier on outer rails, serene behind center text
          const normX = clampedX / Math.max(1, vw)
          const centerDip = 1 - 0.24 * Math.exp(-Math.pow((normX - 0.5) / 0.24, 2))

          const h1 = Math.sin(clampedX * rib.freq1 + p) * 0.56
          const h2 = Math.sin(clampedX * rib.freq2 - p * 0.72 + rib.phaseOffset) * 0.30
          const h3 = Math.cos(clampedX * rib.freq3 + p * 1.34) * 0.14

          // Subtle tactile mouse ripple along the ribbon
          let cursorLift = 0
          if (pointerInside) {
            const dx = clampedX - mouseX
            const dy = baseY - mouseY
            const distSq = dx * dx + dy * dy
            if (distSq < 48400) {
              cursorLift =
                Math.sin(dx * 0.025) * (1 - distSq / 48400) * 12 * (dy >= 0 ? 1 : -1)
            }
          }

          const y = baseY + (h1 + h2 + h3) * dynAmp * centerDip + cursorLift
          if (x === 0) {
            firstY = y
            ctx.moveTo(0, y)
          } else {
            ctx.lineTo(clampedX, y)
          }
        }

        // Stroke crisp curve first on a cloned path or stroke before closing fill
        const strokeGrad = ctx.createLinearGradient(0, baseY, vw, baseY)
        const boostAlpha = Math.min(0.88, rib.strokeAlpha + smoothBass * 0.16 + smoothMid * 0.08)
        strokeGrad.addColorStop(0, rgbaStr(rib.color, boostAlpha * 0.82))
        strokeGrad.addColorStop(0.5, rgbaStr(mixRgb(rib.color, rib.endColor, 0.5), boostAlpha))
        strokeGrad.addColorStop(1, rgbaStr(rib.endColor, boostAlpha * 0.85))
        ctx.strokeStyle = strokeGrad
        ctx.lineWidth = rib.lineWidth
        ctx.stroke()

        // Close path downward for delicate translucent silk ribbon fill
        const fillBottom = baseY + rib.fillDepth + dynAmp * 0.65
        ctx.lineTo(vw, fillBottom)
        ctx.lineTo(0, fillBottom)
        ctx.lineTo(0, firstY)
        ctx.closePath()

        const fillGrad = ctx.createLinearGradient(0, baseY - dynAmp, 0, fillBottom)
        const activeFillAlpha = Math.min(0.32, rib.fillAlpha + smoothBass * 0.065)
        fillGrad.addColorStop(0, rgbaStr(rib.color, activeFillAlpha))
        fillGrad.addColorStop(0.55, rgbaStr(rib.endColor, activeFillAlpha * 0.42))
        fillGrad.addColorStop(1, rgbaStr(rib.endColor, 0))
        ctx.fillStyle = fillGrad
        ctx.fill()
      }

      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(renderFrame)
      }
    }

    rafId = window.requestAnimationFrame(renderFrame)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', syncSize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [wavesActive, reducedMotion, darkMode, effectivePalette])

  // -------------------------------------------------------------------------
  // Mode 2: 'silk' — 60fps Lightweight Fluid Aurora Canvas (320x200 GPU-upscaled)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!silkActive) return
    const canvas = silkCanvasRef.current
    if (!canvas || typeof window === 'undefined') return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    if (canvas.width !== SILK_WIDTH || canvas.height !== SILK_HEIGHT) {
      canvas.width = SILK_WIDTH
      canvas.height = SILK_HEIGHT
    }

    const initPal = paletteRef.current
    let curA = parseRgbTriplet(initPal.glowA, [77, 73, 252])
    let curB = parseRgbTriplet(initPal.glowB, [147, 51, 234])
    let curC = parseRgbTriplet(initPal.glowC, [56, 189, 248])

    let smoothBass = 0
    let smoothLevel = 0
    let silkTime = 2.4
    let lastTs = performance.now()
    let rafId = 0

    // omega = TAU / 9.6s -> completes crisp, visibly flowing figure-8 fluid sweeps every ~8-12s
    const BASE_OMEGA = TAU / 9.6

    const renderSilk = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000))
      lastTs = now

      const targetPal = paletteRef.current
      const targetA = parseRgbTriplet(targetPal.glowA, [77, 73, 252])
      const targetB = parseRgbTriplet(targetPal.glowB, [147, 51, 234])
      const targetC = parseRgbTriplet(targetPal.glowC, [56, 189, 248])

      const colorStep = Math.min(1, dt * 4.2)
      curA = lerpRgb(curA, targetA, colorStep)
      curB = lerpRgb(curB, targetB, colorStep)
      curC = lerpRgb(curC, targetC, colorStep)

      const rawEnergy = getAudioEnergyRef.current
        ? getAudioEnergyRef.current()
        : { bass: 0, mid: 0, level: 0 }

      smoothBass += (rawEnergy.bass - smoothBass) * (rawEnergy.bass > smoothBass ? 0.25 : 0.08)
      smoothLevel += (rawEnergy.level - smoothLevel) * (rawEnergy.level > smoothLevel ? 0.20 : 0.08)

      if (!reducedMotion) {
        silkTime += dt * (1 + smoothLevel * 0.55 + smoothBass * 0.35)
      }

      const isDark = darkModeRef.current
      const W = SILK_WIDTH
      const H = SILK_HEIGHT

      // Base editorial canvas tone
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = isDark ? '#0e0e13' : '#f5f6fa'
      ctx.fillRect(0, 0, W, H)

      // 5 actively orbiting figure-8 aurora currents using harmonized triad (glowA, glowB, glowC)
      const currents: ReadonlyArray<{
        color: RgbTuple
        outerColor: RgbTuple
        fx: number
        fy: number
        px: number
        py: number
        radius: number
        stretchX: number
        stretchY: number
        rotSpeed: number
        alpha: number
      }> = [
        {
          color: curA,
          outerColor: curB,
          fx: 1.0,
          fy: 2.0,
          px: 0.0,
          py: 0.4,
          radius: 118,
          stretchX: 1.55,
          stretchY: 0.82,
          rotSpeed: 0.65,
          alpha: isDark ? 0.52 : 0.44
        },
        {
          color: curC,
          outerColor: curA,
          fx: -0.92,
          fy: 1.84,
          px: 2.1,
          py: 1.2,
          radius: 122,
          stretchX: 1.62,
          stretchY: 0.78,
          rotSpeed: -0.58,
          alpha: isDark ? 0.50 : 0.42
        },
        {
          color: curB,
          outerColor: curC,
          fx: 1.14,
          fy: -1.72,
          px: 4.2,
          py: 2.7,
          radius: 112,
          stretchX: 1.48,
          stretchY: 0.85,
          rotSpeed: 0.74,
          alpha: isDark ? 0.46 : 0.40
        },
        {
          color: mixRgb(curA, curC, 0.52),
          outerColor: curC,
          fx: 0.82,
          fy: 1.64,
          px: 1.05,
          py: 3.9,
          radius: 104,
          stretchX: 1.70,
          stretchY: 0.72,
          rotSpeed: -0.82,
          alpha: isDark ? 0.42 : 0.36
        },
        {
          color: mixRgb(curB, curA, 0.45),
          outerColor: curC,
          fx: -1.08,
          fy: -2.16,
          px: 5.1,
          py: 0.85,
          radius: 108,
          stretchX: 1.52,
          stretchY: 0.80,
          rotSpeed: 0.52,
          alpha: isDark ? 0.44 : 0.38
        }
      ]

      ctx.globalCompositeOperation = isDark ? 'screen' : 'source-over'

      const t = silkTime * BASE_OMEGA
      for (let i = 0; i < currents.length; i += 1) {
        const c = currents[i]
        const cx = W * (0.5 + 0.39 * Math.sin(t * c.fx + c.px))
        const cy = H * (0.5 + 0.36 * Math.sin(t * c.fy + c.py))
        const r = c.radius * (1 + smoothBass * 0.22 + smoothLevel * 0.10)
        const angle = t * c.rotSpeed + c.px

        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(angle)
        ctx.scale(c.stretchX, c.stretchY)

        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
        const peakAlpha = Math.min(0.76, c.alpha + smoothBass * 0.10)
        grad.addColorStop(0, rgbaStr(c.color, peakAlpha))
        grad.addColorStop(0.46, rgbaStr(mixRgb(c.color, c.outerColor, 0.45), peakAlpha * 0.56))
        grad.addColorStop(1, rgbaStr(c.outerColor, 0))

        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, TAU)
        ctx.fill()
        ctx.restore()
      }

      // 3 sweeping luminous silk ribbon currents weaving across the figure-8 field
      const silkRibbons: ReadonlyArray<{
        c1: RgbTuple
        c2: RgbTuple
        c3: RgbTuple
        yBase: number
        amp: number
        speed: number
        offset: number
        width: number
      }> = [
        { c1: curA, c2: curC, c3: curB, yBase: 0.28, amp: 34, speed: 1.05, offset: 0.0, width: 28 },
        { c1: curC, c2: curB, c3: curA, yBase: 0.54, amp: 38, speed: -0.92, offset: 2.2, width: 32 },
        { c1: curB, c2: curA, c3: curC, yBase: 0.76, amp: 30, speed: 1.18, offset: 4.3, width: 26 }
      ]

      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (let i = 0; i < silkRibbons.length; i += 1) {
        const sr = silkRibbons[i]
        const sp = t * sr.speed * 1.45 + sr.offset
        const y0 = H * sr.yBase + Math.sin(sp) * sr.amp
        const cp1x = W * 0.33 + Math.cos(sp * 0.9) * 28
        const cp1y = H * sr.yBase + Math.cos(sp * 1.3 + 1.1) * (sr.amp * 1.35)
        const cp2x = W * 0.67 + Math.sin(sp * 0.85) * 28
        const cp2y = H * sr.yBase - Math.sin(sp * 1.15 + 0.6) * (sr.amp * 1.35)
        const y1 = H * sr.yBase + Math.cos(sp * 1.05 + 2.0) * sr.amp

        const ribGrad = ctx.createLinearGradient(0, y0, W, y1)
        const rAlpha = (isDark ? 0.36 : 0.30) + smoothBass * 0.10
        ribGrad.addColorStop(0, rgbaStr(sr.c1, rAlpha))
        ribGrad.addColorStop(0.5, rgbaStr(sr.c2, rAlpha * 1.12))
        ribGrad.addColorStop(1, rgbaStr(sr.c3, rAlpha))

        ctx.beginPath()
        ctx.moveTo(-24, y0)
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, W + 24, y1)
        ctx.strokeStyle = ribGrad
        ctx.lineWidth = sr.width * (1 + smoothBass * 0.24)
        ctx.stroke()
      }

      ctx.globalCompositeOperation = 'source-over'

      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(renderSilk)
      }
    }

    rafId = window.requestAnimationFrame(renderSilk)

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [silkActive, reducedMotion, darkMode, effectivePalette])

  const layerStyle = {
    '--ambient-glow-a': effectivePalette.glowA,
    '--ambient-glow-b': effectivePalette.glowB,
    '--ambient-glow-c': effectivePalette.glowC
  } as CSSProperties

  const validCoverUrl = coverUrl && !coverBroken ? coverUrl : null
  const vinylSpinning = active && showVinyl && !reducedMotion && !tabHidden

  return (
    <div
      className={`blog-ambient-layer${isVisible ? ' is-active' : ''}${
        motionRunning ? ' is-animating' : ''
      } is-mode-${mode} ${darkMode ? 'is-dark' : 'is-light'}`}
      style={layerStyle}
      aria-hidden="true"
    >
      {/* Mode 1: 'waves' — Figma Sound Grid & 5 Audio-Reactive Silk Wave Ribbons */}
      <div className={`blog-ambient-stage blog-ambient-waves-stage${showWaves ? ' is-visible' : ''}`}>
        <canvas ref={wavesCanvasRef} className="blog-ambient-canvas is-waves" />
      </div>

      {/* Mode 2: 'silk' — 60fps Canvas Fluid Chromatic Aurora */}
      <div className={`blog-ambient-stage blog-ambient-silk-stage${showSilk ? ' is-visible' : ''}`}>
        <canvas ref={silkCanvasRef} className="blog-ambient-canvas is-silk" />
      </div>

      {/* Mode 3: 'vinyl' — Crisp Unstretched Architectural Vinyl & Artwork Showcase */}
      <div
        className={`blog-ambient-stage blog-ambient-vinyl-stage${showVinyl ? ' is-visible' : ''}${
          vinylSpinning ? ' is-spinning' : ''
        }`}
      >
        <div className="blog-vinyl-ambient-wash" />

        {/* Left Outer Edge: Rotating Matte Vinyl Half-Disc + Razor-Sharp Circular Label */}
        <div className="blog-vinyl-left-assembly">
          <div className="blog-vinyl-aura" />
          <div className="blog-vinyl-platter">
            <div className={`blog-vinyl-disc${vinylSpinning ? ' is-rotating' : ''}`}>
              <svg
                className="blog-vinyl-grooves"
                viewBox="0 0 400 400"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <path
                    id="blog-vinyl-runout-arc"
                    d="M 200,200 m -79,0 a 79,79 0 1,1 158,0 a 79,79 0 1,1 -158,0"
                  />
                </defs>
                {VINYL_GROOVE_RADII.map((radius, idx) => (
                  <circle
                    key={radius}
                    cx="200"
                    cy="200"
                    r={radius}
                    stroke={
                      idx % 4 === 0
                        ? 'rgba(255, 255, 255, 0.13)'
                        : idx % 2 === 0
                          ? 'rgba(255, 255, 255, 0.065)'
                          : 'rgba(255, 255, 255, 0.035)'
                    }
                    strokeWidth={idx % 4 === 0 ? '1.1' : '0.65'}
                  />
                ))}
                <circle
                  cx="200"
                  cy="200"
                  r="78"
                  stroke="rgba(255, 255, 255, 0.16)"
                  strokeWidth="0.9"
                  strokeDasharray="3 5"
                />
                <text
                  fill="rgba(255, 255, 255, 0.22)"
                  fontSize="6.2"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  letterSpacing="2.4"
                >
                  <textPath href="#blog-vinyl-runout-arc" startOffset="6%">
                    DO IT LAAAAAATER · 33 1/3 RPM · HIGH FIDELITY STEREO
                  </textPath>
                </text>
              </svg>

              <div className="blog-vinyl-label">
                {validCoverUrl ? (
                  <img
                    src={validCoverUrl}
                    alt=""
                    decoding="async"
                    onError={() => setCoverBroken(true)}
                  />
                ) : (
                  <div className="blog-vinyl-label-fallback">
                    <span>33⅓ RPM</span>
                  </div>
                )}
                <div className="blog-vinyl-spindle" />
              </div>
            </div>

            {/* Stationary diagonal gallery light sheen catching the spinning grooves */}
            <div className="blog-vinyl-sheen" />
          </div>
        </div>

        {/* Right Outer Edge: Crisp Tilted 1:1 Vinyl Sleeve Accent + Radial Glow */}
        <div className="blog-vinyl-sleeve-echo">
          <div className="blog-vinyl-sleeve-glow" />
          <div className="blog-vinyl-sleeve-card">
            <div className="blog-vinyl-sleeve-art">
              {validCoverUrl ? (
                <img
                  src={validCoverUrl}
                  alt=""
                  decoding="async"
                  onError={() => setCoverBroken(true)}
                />
              ) : (
                <div className="blog-vinyl-sleeve-fallback" />
              )}
            </div>
            {(trackTitle || trackArtist) && (
              <div className="blog-vinyl-sleeve-meta">
                {trackTitle && <span className="blog-vinyl-sleeve-title">{trackTitle}</span>}
                {trackArtist && <span className="blog-vinyl-sleeve-artist">{trackArtist}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Narrow / Mobile (< 1240px): Crisp Subtle Corner Silk Tint without Crowding */}
        <div className="blog-vinyl-mobile-tint" />
      </div>

      {/* Ultra-Subtle Editorial Paper Grain */}
      <div className="blog-ambient-grain" />
    </div>
  )
}
