import { useEffect, useState, type CSSProperties } from 'react'
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
}

export function BlogAmbientBackdrop({
  mode,
  active,
  darkMode,
  palette,
  coverUrl
}: BlogAmbientBackdropProps) {
  const hasVisualSource = Boolean(palette || coverUrl)
  const isVisible = active && mode !== 'minimal' && hasVisualSource

  // Keep animations running during the 700ms fade-out, then pause GPU work when fully transparent
  const [motionRunning, setMotionRunning] = useState<boolean>(isVisible)

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

  const effectivePalette = palette ?? DEFAULT_AMBIENT_PALETTE
  const showGlow = isVisible && mode === 'glow'
  const showWallpaper = isVisible && mode === 'wallpaper'

  const layerStyle = {
    '--ambient-glow-a': effectivePalette.glowA,
    '--ambient-glow-b': effectivePalette.glowB,
    '--ambient-glow-c': effectivePalette.glowC
  } as CSSProperties

  const wpImageStyle: CSSProperties | undefined = coverUrl
    ? { backgroundImage: `url("${coverUrl.replace(/"/g, '\\"')}")` }
    : undefined

  return (
    <div
      className={`blog-ambient-layer${isVisible ? ' is-active' : ''}${
        motionRunning ? ' is-animating' : ''
      } is-mode-${mode} ${darkMode ? 'is-dark' : 'is-light'}`}
      style={layerStyle}
      aria-hidden="true"
    >
      {/* Mode 1: Organic Drifting Radial Aura Blobs ('glow') */}
      <div className={`blog-ambient-glow-stage${showGlow ? ' is-visible' : ''}`}>
        <div className="blog-ambient-blob blog-ambient-blob-1" />
        <div className="blog-ambient-blob blog-ambient-blob-2" />
        <div className="blog-ambient-blob blog-ambient-blob-3" />
      </div>

      {/* Mode 2: Dual Counter-Rotating Blurred Album Cover Aura ('wallpaper') */}
      <div className={`blog-ambient-wp-stage${showWallpaper ? ' is-visible' : ''}`}>
        <div
          className={`blog-ambient-wp-layer blog-ambient-wp-a${coverUrl ? ' has-cover' : ''}`}
          style={wpImageStyle}
        />
        <div
          className={`blog-ambient-wp-layer blog-ambient-wp-b${coverUrl ? ' has-cover' : ''}`}
          style={wpImageStyle}
        />
        <div className="blog-ambient-wp-veil" />
      </div>

      {/* Ultra-Subtle Editorial Paper Grain */}
      <div className="blog-ambient-grain" />
    </div>
  )
}
