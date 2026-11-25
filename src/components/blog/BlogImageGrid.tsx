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
        <button
          key={img.mediaId || `${img.url}-${idx}`}
          type="button"
          className="blog-img-cell"
          onClick={() => onOpenLightbox(lightboxImages, idx)}
          aria-label={img.alt ? `查看大图：${img.alt}` : `查看第 ${idx + 1} 张图片`}
        >
          <img src={img.thumbUrl || img.url} alt={img.alt || ''} loading="lazy" />
        </button>
      ))}
    </div>
  )
}
