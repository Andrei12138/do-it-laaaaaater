import { useEffect, useRef, useState } from 'react'
import { useOptionalBlogMusic } from '../../blog-music'
import type { BlogMusicTrack, BlogPostMusic } from '../../blog-types'
import { AppIcon } from '../AppIcon'

export interface BlogMusicCardProps {
  music: BlogPostMusic
}

function getSafeMediaUrl(raw: string | null | undefined): string {
  const cleaned = (raw || '').trim()
  if (!cleaned) return ''
  if (cleaned.startsWith('/') && !cleaned.startsWith('//')) return cleaned
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  return ''
}

export function BlogMusicCard({ music }: BlogMusicCardProps) {
  const musicCtx = useOptionalBlogMusic()
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null)
  const [fallbackPlaying, setFallbackPlaying] = useState(false)
  const [coverFailed, setCoverFailed] = useState(false)

  useEffect(() => {
    setCoverFailed(false)
    setFallbackPlaying(false)
  }, [music.audioUrl, music.coverUrl])

  const safeAudioUrl = getSafeMediaUrl(music.audioUrl)
  const safeCoverUrl = !coverFailed ? getSafeMediaUrl(music.coverUrl) : ''
  if (!safeAudioUrl) return null

  const isSameGlobalTrack = Boolean(
    musicCtx?.currentTrack && musicCtx.currentTrack.audioUrl === safeAudioUrl
  )
  const isPlaying = musicCtx ? Boolean(isSameGlobalTrack && musicCtx.isPlaying) : fallbackPlaying

  const handleTogglePlay = () => {
    if (musicCtx) {
      if (isSameGlobalTrack) {
        musicCtx.togglePlay()
        return
      }
      const matched = music.trackId
        ? musicCtx.tracks.find((item: BlogMusicTrack) => item.id === music.trackId)
        : musicCtx.tracks.find((item: BlogMusicTrack) => item.audioUrl === safeAudioUrl)
      musicCtx.playTrack({
        trackId: music.trackId || matched?.id,
        title: music.title || matched?.title || '未命名曲目',
        artist: music.artist || matched?.artist || '未知艺术家',
        coverUrl: music.coverUrl ?? matched?.coverUrl ?? null,
        audioUrl: safeAudioUrl,
        lrc: music.lrc || matched?.lrcText || undefined
      })
      return
    }

    const audio = fallbackAudioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => {
        setFallbackPlaying(false)
      })
    } else {
      audio.pause()
    }
  }

  const displayTitle = music.title?.trim() || '未命名曲目'
  const displayArtist = music.artist?.trim() || '未知艺术家'
  const activeLyric =
    isSameGlobalTrack && musicCtx?.isPlaying && musicCtx.currentLyricLine
      ? musicCtx.currentLyricLine
      : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        className={`blog-p2-music-card${isPlaying ? ' is-playing' : ''}`}
        role="group"
        aria-label={`音乐卡片：${displayTitle}`}
        onClick={musicCtx ? handleTogglePlay : undefined}
        style={musicCtx ? { cursor: 'pointer' } : undefined}
      >
        <div className="blog-p2-music-card-cover">
          {safeCoverUrl ? (
            <img
              src={safeCoverUrl}
              alt={displayTitle}
              loading="lazy"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <AppIcon name="music" size={22} />
          )}
          <button
            type="button"
            className="blog-p2-music-card-play"
            aria-label={isPlaying ? `暂停 ${displayTitle}` : `播放 ${displayTitle}`}
            onClick={(event) => {
              event.stopPropagation()
              handleTogglePlay()
            }}
          >
            <AppIcon name={isPlaying ? 'pause' : 'play'} size={15} />
          </button>
        </div>

        <div className="blog-p2-music-card-info">
          <div className="blog-p2-music-card-title" title={displayTitle}>
            {displayTitle}
          </div>
          <div className="blog-p2-music-card-artist" title={activeLyric || displayArtist}>
            {activeLyric || displayArtist}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginTop: 2,
              fontSize: 11,
              fontFamily: 'var(--blog-font-mono)',
              color: 'var(--blog-text-muted)'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AppIcon name="music" size={11} />
              <span>来自 音乐</span>
            </span>
            {musicCtx && isSameGlobalTrack && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  musicCtx.openDrawer()
                }}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  color: 'var(--blog-link)',
                  font: 'inherit',
                  cursor: 'pointer'
                }}
              >
                歌词 ↗
              </button>
            )}
          </div>
        </div>
      </div>

      {!musicCtx && (
        <audio
          ref={fallbackAudioRef}
          controls
          preload="metadata"
          src={safeAudioUrl}
          onPlay={() => setFallbackPlaying(true)}
          onPause={() => setFallbackPlaying(false)}
          onEnded={() => setFallbackPlaying(false)}
          style={{ width: '100%', maxWidth: 360, height: 34 }}
        />
      )}
    </div>
  )
}
