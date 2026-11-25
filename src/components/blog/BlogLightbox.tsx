import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '../AppIcon'

export interface BlogLightboxImage {
  url: string
  alt?: string
}

export interface BlogLightboxProps {
  images: BlogLightboxImage[]
  index: number
  onClose: () => void
}

function clampIndex(idx: number, length: number): number {
  if (length <= 0) return 0
  return Math.max(0, Math.min(idx, length - 1))
}

export function BlogLightbox({ images, index, onClose }: BlogLightboxProps) {
  const [cur, setCur] = useState(() => clampIndex(index, images.length))
  const [zoomed, setZoomed] = useState(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setCur(clampIndex(index, images.length))
    setZoomed(false)
  }, [index, images.length])

  const hasMultiple = images.length > 1

  const goPrev = useCallback(() => {
    if (images.length <= 1) return
    setZoomed(false)
    setCur((prev) => (prev - 1 + images.length) % images.length)
  }, [images.length])

  const goNext = useCallback(() => {
    if (images.length <= 1) return
    setZoomed(false)
    setCur((prev) => (prev + 1) % images.length)
  }, [images.length])

  useEffect(() => {
    if (images.length === 0) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [images.length, onClose, goPrev, goNext])

  if (images.length === 0) return null

  const activeImage = images[cur] || images[0]

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start || zoomed || !hasMultiple || event.changedTouches.length === 0) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0) goNext()
      else goPrev()
    }
  }

  const content = (
    <div
      className="blog-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <button
        type="button"
        className="blog-lightbox-close"
        onClick={onClose}
        aria-label="关闭预览"
        title="关闭 (Esc)"
      >
        <AppIcon name="close" size={20} />
      </button>

      {hasMultiple && (
        <button
          type="button"
          className="blog-lightbox-nav blog-lightbox-prev"
          onClick={(event) => {
            event.stopPropagation()
            goPrev()
          }}
          aria-label="上一张"
          title="上一张 (←)"
        >
          <AppIcon name="chevronLeft" size={22} />
        </button>
      )}

      <div
        className="blog-lightbox-stage"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <img
          src={activeImage.url}
          alt={activeImage.alt || `图片 ${cur + 1}`}
          className={zoomed ? 'blog-lightbox-img is-zoomed' : 'blog-lightbox-img'}
          style={{ transform: zoomed ? 'scale(1.85)' : 'scale(1)' }}
          draggable={false}
          onClick={(event) => {
            event.stopPropagation()
            setZoomed((prev) => !prev)
          }}
        />
      </div>

      {hasMultiple && (
        <button
          type="button"
          className="blog-lightbox-nav blog-lightbox-next"
          onClick={(event) => {
            event.stopPropagation()
            goNext()
          }}
          aria-label="下一张"
          title="下一张 (→)"
        >
          <AppIcon name="chevronRight" size={22} />
        </button>
      )}

      <div
        className="blog-lightbox-counter"
        style={{ borderRadius: '999px' }}
        aria-live="polite"
      >
        {cur + 1} / {images.length}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
