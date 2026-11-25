import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent
} from 'react'
import type { BlogImageItem } from '../../blog-types'

export interface BlogImageGridProps {
  images: BlogImageItem[]
  onOpenLightbox: (images: Array<{ url: string; alt?: string }>, index: number) => void
}

function getGridVariantClass(count: number): string {
  if (count === 1) return 'is-single'
  if (count === 2) return 'is-two'
  if (count === 4) return 'is-four'
  return 'is-multi'
}

function getSafeLiveUrl(raw: string | undefined): string {
  const cleaned = (raw || '').trim()
  if (!cleaned) return ''
  if (cleaned.startsWith('/') && !cleaned.startsWith('//')) return cleaned
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  return ''
}

const LONG_PRESS_MS = 400
const TOUCH_MOVE_TOLERANCE_PX = 10

interface BlogImageCellProps {
  img: BlogImageItem
  index: number
  onSelect: () => void
}

function BlogImageCell({ img, index, onSelect }: BlogImageCellProps) {
  const liveUrl = getSafeLiveUrl(img.liveVideoUrl)
  const hasLive = Boolean(liveUrl)

  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const activeIntentRef = useRef(false)
  const longPressTimerRef = useRef<number | null>(null)
  const touchOriginRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)
  const clearSuppressTimerRef = useRef<number | null>(null)

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const stopLivePlayback = useCallback(() => {
    activeIntentRef.current = false
    setIsPlaying(false)
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.muted = true
    try {
      video.currentTime = 0
    } catch {
      // Ignore seek errors before metadata is loaded.
    }
  }, [])

  useEffect(() => {
    return () => {
      clearLongPressTimer()
      if (clearSuppressTimerRef.current !== null) {
        window.clearTimeout(clearSuppressTimerRef.current)
      }
      const video = videoRef.current
      if (video) {
        video.pause()
      }
    }
  }, [clearLongPressTimer])

  const startLivePlayback = useCallback(async (preferSound: boolean) => {
    const video = videoRef.current
    if (!video) return
    activeIntentRef.current = true
    try {
      video.muted = !preferSound
      await video.play()
      if (activeIntentRef.current) {
        setIsPlaying(true)
      } else {
        video.pause()
      }
    } catch {
      if (preferSound && activeIntentRef.current) {
        try {
          video.muted = true
          await video.play()
          if (activeIntentRef.current) {
            setIsPlaying(true)
          } else {
            video.pause()
          }
        } catch {
          setIsPlaying(false)
        }
      } else {
        setIsPlaying(false)
      }
    }
  }, [])

  const handleMouseEnter = () => {
    if (!hasLive) return
    void startLivePlayback(false)
  }

  const handleMouseLeave = () => {
    if (!hasLive) return
    clearLongPressTimer()
    stopLivePlayback()
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!hasLive || event.pointerType !== 'mouse') return
    const video = videoRef.current
    if (video && activeIntentRef.current) {
      video.muted = false
    }
  }

  const handleTouchStart = (event: TouchEvent<HTMLButtonElement>) => {
    if (!hasLive || event.touches.length !== 1) return
    const touch = event.touches[0]
    touchOriginRef.current = { x: touch.clientX, y: touch.clientY }
    suppressClickRef.current = false
    clearLongPressTimer()

    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      suppressClickRef.current = true
      void startLivePlayback(true)
    }, LONG_PRESS_MS)
  }

  const handleTouchMove = (event: TouchEvent<HTMLButtonElement>) => {
    if (!hasLive || !touchOriginRef.current || longPressTimerRef.current === null) return
    const touch = event.touches[0]
    if (!touch) return
    const dx = touch.clientX - touchOriginRef.current.x
    const dy = touch.clientY - touchOriginRef.current.y
    if (Math.hypot(dx, dy) > TOUCH_MOVE_TOLERANCE_PX) {
      clearLongPressTimer()
      touchOriginRef.current = null
    }
  }

  const handleTouchEndOrCancel = () => {
    if (!hasLive) return
    clearLongPressTimer()
    touchOriginRef.current = null
    if (activeIntentRef.current || isPlaying) {
      stopLivePlayback()
    }
    if (suppressClickRef.current) {
      if (clearSuppressTimerRef.current !== null) {
        window.clearTimeout(clearSuppressTimerRef.current)
      }
      clearSuppressTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        clearSuppressTimerRef.current = null
      }, 450)
    }
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault()
      event.stopPropagation()
      suppressClickRef.current = false
      return
    }
    if (hasLive) {
      stopLivePlayback()
    }
    onSelect()
  }

  return (
    <button
      type="button"
      className={`blog-img-cell${isPlaying ? ' is-live-playing' : ''}`}
      onClick={handleClick}
      onMouseEnter={hasLive ? handleMouseEnter : undefined}
      onMouseLeave={hasLive ? handleMouseLeave : undefined}
      onPointerDown={hasLive ? handlePointerDown : undefined}
      onTouchStart={hasLive ? handleTouchStart : undefined}
      onTouchMove={hasLive ? handleTouchMove : undefined}
      onTouchEnd={hasLive ? handleTouchEndOrCancel : undefined}
      onTouchCancel={hasLive ? handleTouchEndOrCancel : undefined}
      onContextMenu={
        hasLive
          ? (event) => {
              event.preventDefault()
            }
          : undefined
      }
      aria-label={
        img.alt
          ? `查看大图：${img.alt}${hasLive ? '（实况照片）' : ''}`
          : `查看第 ${index + 1} 张图片${hasLive ? '（实况照片）' : ''}`
      }
    >
      <img src={img.thumbUrl || img.url} alt={img.alt || ''} loading="lazy" />
      {hasLive && (
        <>
          <video
            ref={videoRef}
            className={`blog-p2-live-video${isPlaying ? ' is-playing' : ''}`}
            src={liveUrl}
            playsInline
            loop
            muted
            preload="none"
            onPlaying={() => {
              if (activeIntentRef.current) setIsPlaying(true)
            }}
          />
          <span className="blog-p2-live-badge" aria-hidden="true">
            实况
          </span>
        </>
      )}
    </button>
  )
}

export function BlogImageGrid({ images, onOpenLightbox }: BlogImageGridProps) {
  const visible = images.slice(0, 9)
  if (visible.length === 0) return null

  const lightboxImages = images.map((item) => ({
    url: item.url,
    alt: item.alt
  }))

  return (
    <div className={`blog-img-grid ${getGridVariantClass(visible.length)}`}>
      {visible.map((img, idx) => (
        <BlogImageCell
          key={img.mediaId || `${img.url}-${idx}`}
          img={img}
          index={idx}
          onSelect={() => onOpenLightbox(lightboxImages, idx)}
        />
      ))}
    </div>
  )
}
