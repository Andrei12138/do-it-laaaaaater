import { useEffect, useState } from 'react'
import type { BlogPostVideo } from '../../blog-types'
import { AppIcon } from '../AppIcon'

export interface BlogVideoCardProps {
  video: BlogPostVideo
}

function getSafeMediaUrl(raw: string | null | undefined): string {
  const cleaned = (raw || '').trim()
  if (!cleaned) return ''
  if (cleaned.startsWith('/') && !cleaned.startsWith('//')) return cleaned
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  return ''
}

function extractHostname(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

function isDirectVideoFile(video: BlogPostVideo): boolean {
  if (video.source === 'upload') return true
  const url = (video.url || '').trim()
  if (url.startsWith('/api/blog/media/')) return true
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url)
}

function getPlatformLabel(video: BlogPostVideo): string {
  if (video.platform?.trim()) return video.platform.trim()
  if (video.source === 'bilibili') return 'Bilibili'
  if (video.source === 'youtube') return 'YouTube'
  if (video.source === 'upload') return '实拍视频'
  return extractHostname(video.url) || '视频'
}

function buildAutoplayEmbedUrl(embedUrl: string, source: BlogPostVideo['source']): string {
  const safe = getSafeMediaUrl(embedUrl)
  if (!safe) return ''
  try {
    const parsed = new URL(safe)
    parsed.searchParams.set('autoplay', '1')
    if (source === 'youtube') {
      parsed.searchParams.set('rel', '0')
    }
    return parsed.toString()
  } catch {
    return safe
  }
}

export function BlogVideoCard({ video }: BlogVideoCardProps) {
  const [embedActive, setEmbedActive] = useState(false)
  const [coverFailed, setCoverFailed] = useState(false)

  useEffect(() => {
    setEmbedActive(false)
    setCoverFailed(false)
  }, [video.url, video.embedUrl, video.coverUrl])

  const safeUrl = getSafeMediaUrl(video.url)
  const safeEmbedUrl = getSafeMediaUrl(video.embedUrl)
  const safeCoverUrl = !coverFailed ? getSafeMediaUrl(video.coverUrl) : ''
  const platformLabel = getPlatformLabel(video)

  if (!safeUrl && !safeEmbedUrl) return null

  if (isDirectVideoFile(video) && safeUrl) {
    return (
      <div className="blog-p2-video-card">
        <video
          className="blog-p2-video-player"
          src={safeUrl}
          poster={safeCoverUrl || undefined}
          controls
          playsInline
          preload="metadata"
        />
        {(video.title || video.platform) && (
          <div className="blog-p2-video-meta">
            {video.title ? (
              <span
                style={{
                  fontWeight: 500,
                  color: 'var(--blog-text)',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {video.title}
              </span>
            ) : (
              <span />
            )}
            <span className="blog-p2-video-badge">
              <AppIcon name="video" size={12} />
              <span>{video.source === 'upload' ? '实拍视频' : platformLabel}</span>
            </span>
          </div>
        )}
      </div>
    )
  }

  if (safeEmbedUrl) {
    const activeIframeSrc = buildAutoplayEmbedUrl(safeEmbedUrl, video.source)
    const sourceBadgeText =
      video.source === 'bilibili'
        ? '来自 Bilibili'
        : video.source === 'youtube'
          ? '来自 YouTube'
          : `来自 ${platformLabel}`

    return (
      <div className="blog-p2-video-card">
        <div className="blog-p2-video-embed">
          {embedActive ? (
            <iframe
              src={activeIframeSrc}
              title={video.title || `${platformLabel} 视频播放器`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <>
              {safeCoverUrl && (
                <img
                  src={safeCoverUrl}
                  alt={video.title || platformLabel}
                  loading="lazy"
                  onError={() => setCoverFailed(true)}
                />
              )}
              <button
                type="button"
                onClick={() => setEmbedActive(true)}
                aria-label={video.title ? `播放视频：${video.title}` : `播放 ${platformLabel} 视频`}
              >
                <AppIcon name="play" size={18} />
                <span>{video.title ? '点击播放' : `播放 · ${platformLabel}`}</span>
              </button>
            </>
          )}
        </div>

        <div className="blog-p2-video-meta">
          <span className="blog-p2-video-badge">
            <AppIcon name="video" size={12} />
            <span>{sourceBadgeText}</span>
          </span>

          {video.title && (
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--blog-text-secondary)',
                fontSize: 12.5
              }}
              title={video.title}
            >
              {video.title}
            </span>
          )}

          {safeUrl && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                color: 'var(--blog-link)',
                textDecoration: 'none',
                flexShrink: 0,
                marginLeft: 'auto'
              }}
            >
              <span>打开原视频</span>
              <AppIcon name="external" size={12} />
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="blog-share-card"
    >
      <div className="blog-share-thumb">
        {safeCoverUrl ? (
          <img
            src={safeCoverUrl}
            alt={video.title || '视频封面'}
            loading="lazy"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <AppIcon name="video" size={22} />
        )}
      </div>
      <div className="blog-share-info">
        <div className="blog-share-title">{video.title || safeUrl}</div>
        <div
          className="blog-share-domain"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span className="blog-p2-video-badge">
            <AppIcon name="video" size={11} />
            <span>来自 {platformLabel}</span>
          </span>
          <AppIcon name="external" size={11} />
        </div>
      </div>
    </a>
  )
}
