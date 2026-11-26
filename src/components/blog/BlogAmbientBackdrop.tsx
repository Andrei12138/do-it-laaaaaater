import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from 'react'
import {
  DEFAULT_AMBIENT_PALETTE,
  getAmbientEffectMeta,
  normalizeTrackVisualConfig,
  type AudioAnalysisFrame,
  type BlogAmbientEffectId,
  type BlogAmbientMode,
  type BlogAmbientPalette,
  type BlogTrackVisualConfig
} from '../../blog-ambient'

export interface AmbientStageProps {
  effect: BlogAmbientEffectId
  darkMode: boolean
  palette: BlogAmbientPalette
  config: BlogTrackVisualConfig
  reducedMotion: boolean
  getAudioFrame?: () => AudioAnalysisFrame
  onFallback?: () => void
}

export interface BlogAmbientBackdropProps {
  mode: BlogAmbientMode
  active: boolean
  darkMode: boolean
  palette: BlogAmbientPalette | null
  coverUrl: string | null
  /** Zero-allocation DSP frame provider (BlogMusicProvider#getAudioFrame). */
  getAudioFrame?: () => AudioAnalysisFrame
  /** Live per-track tuning (effect, 6 DSP sliders, 5 physical shader sliders). */
  visualConfig?: BlogTrackVisualConfig | null
}

const PaperShaderStage = lazy(() => import('./ambient/PaperShaderStage'))
const ReactBitsStage = lazy(() => import('./ambient/ReactBitsStage'))

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function BlogAmbientBackdrop({
  mode,
  active,
  darkMode,
  palette,
  coverUrl,
  getAudioFrame,
  visualConfig
}: BlogAmbientBackdropProps) {
  const hasVisualSource = Boolean(palette || coverUrl)
  const isVisible = active && mode !== 'minimal' && hasVisualSource

  // Keep stage mounted through the 700ms CSS fade-out, and load zero shader JS until active is true
  const [motionRunning, setMotionRunning] = useState<boolean>(isVisible)
  const [reducedMotion, setReducedMotion] = useState<boolean>(readReducedMotion)
  const [stageFallback, setStageFallback] = useState<boolean>(false)

  const cfg = useMemo(() => normalizeTrackVisualConfig(visualConfig), [visualConfig])
  const effectMeta = useMemo(() => getAmbientEffectMeta(cfg.effect), [cfg.effect])
  const effectivePalette = palette ?? DEFAULT_AMBIENT_PALETTE

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

  // Reset WebGL fallback flag when switching effects so another stage/shader can recover cleanly
  useEffect(() => {
    setStageFallback(false)
  }, [cfg.effect])

  const handleFallback = useCallback(() => {
    setStageFallback(true)
  }, [])

  const stageMounted = isVisible || motionRunning
  const StageComponent = effectMeta.group === 'paper' ? PaperShaderStage : ReactBitsStage

  const layerStyle = {
    '--ambient-glow-a': effectivePalette.glowA,
    '--ambient-glow-b': effectivePalette.glowB,
    '--ambient-glow-c': effectivePalette.glowC
  } as CSSProperties

  return (
    <div
      className={`blog-ambient-layer ${darkMode ? 'is-dark' : 'is-light'}${
        isVisible ? ' is-active' : ''
      }`}
      style={layerStyle}
      aria-hidden="true"
    >
      <div
        className={`blog-ambient-stage${isVisible ? ' is-visible' : ''}`}
        style={{ opacity: cfg.opacity }}
      >
        {stageMounted &&
          (stageFallback ? (
            <div className="blog-ambient-css-fallback" />
          ) : (
            <Suspense fallback={null}>
              <StageComponent
                effect={cfg.effect}
                darkMode={darkMode}
                palette={effectivePalette}
                config={cfg}
                reducedMotion={reducedMotion}
                getAudioFrame={getAudioFrame}
                onFallback={handleFallback}
              />
            </Suspense>
          ))}
      </div>
      <div className="blog-ambient-grain" />
    </div>
  )
}
