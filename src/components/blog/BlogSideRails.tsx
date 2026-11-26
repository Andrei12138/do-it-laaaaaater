import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode
} from 'react'
import {
  fetchBlogArchives,
  fetchBlogCatalog,
  fetchBlogFriends,
  fetchBlogPage
} from '../../blog-api'
import { generateExcerpt, type TocHeading } from '../../blog-markdown'
import {
  parseLrc,
  useBlogMusicActions,
  useBlogMusicProgress,
  type BlogAmbientMode
} from '../../blog-music'
import type {
  BlogArchiveItem,
  BlogCatalogItem,
  BlogFriend,
  BlogPageData,
  BlogPostMusic,
  BlogPostType,
  BlogProfile,
  BlogRailSummary
} from '../../blog-types'
import { AppIcon } from '../AppIcon'

export type BlogSidebarWidgetId = 'about' | 'album' | 'music' | 'equipment' | 'labs' | 'friends'

export interface BlogSidebarConfig {
  hiddenWidgets: BlogSidebarWidgetId[]
}

export const BLOG_SIDEBAR_WIDGET_LABELS: Record<
  BlogSidebarWidgetId,
  { label: string; side: 'left' | 'right' }
> = {
  about: { label: '关于我', side: 'left' },
  album: { label: '个人相册', side: 'left' },
  music: { label: '音乐播放器', side: 'right' },
  equipment: { label: '我的装备', side: 'right' },
  labs: { label: '实验室', side: 'right' },
  friends: { label: '友人帐', side: 'right' }
}

export const LEFT_WIDGET_IDS: readonly BlogSidebarWidgetId[] = ['about', 'album']
export const RIGHT_WIDGET_IDS: readonly BlogSidebarWidgetId[] = [
  'music',
  'equipment',
  'labs',
  'friends'
]

const VALID_WIDGET_IDS = new Set<BlogSidebarWidgetId>([
  ...LEFT_WIDGET_IDS,
  ...RIGHT_WIDGET_IDS
])

export function readBlogSidebarConfig(
  extensions: Record<string, unknown> | undefined
): BlogSidebarConfig {
  if (!extensions || typeof extensions !== 'object') {
    return { hiddenWidgets: [] }
  }
  const rawSidebar = extensions.sidebar
  if (!rawSidebar || typeof rawSidebar !== 'object' || Array.isArray(rawSidebar)) {
    return { hiddenWidgets: [] }
  }
  const rawHidden = (rawSidebar as Record<string, unknown>).hiddenWidgets
  if (!Array.isArray(rawHidden)) {
    return { hiddenWidgets: [] }
  }
  const seen = new Set<BlogSidebarWidgetId>()
  const hiddenWidgets: BlogSidebarWidgetId[] = []
  for (const entry of rawHidden) {
    if (typeof entry === 'string' && VALID_WIDGET_IDS.has(entry as BlogSidebarWidgetId)) {
      const widgetId = entry as BlogSidebarWidgetId
      if (!seen.has(widgetId)) {
        seen.add(widgetId)
        hiddenWidgets.push(widgetId)
      }
    }
  }
  return { hiddenWidgets }
}

export interface BlogSideRailDataProps {
  profile: BlogProfile
  isOwner: boolean
  activeRoute:
    | 'feed'
    | 'archives'
    | 'article'
    | 'moment'
    | 'about'
    | 'equipment'
    | 'labs'
    | 'friends'
  hiddenWidgets: BlogSidebarWidgetId[]
  refreshTick: number
  initialSummary?: BlogRailSummary | null
  summaryLoading?: boolean
  onNavigate: (path: string) => void
  onOpenLightbox: (images: Array<{ url: string; alt?: string }>, index: number) => void
  onOpenCompose: (type?: BlogPostType) => void
  onOpenSettings?: () => void
}

export interface BlogLeftRailProps extends BlogSideRailDataProps {
  articleHeadings?: TocHeading[]
  activeHeadingId?: string
  onJumpHeading?: (id: string) => void
  onOpenSettings?: () => void
}

// Lightweight session cache keyed by owner/guest scope and refreshTick so route switches stay flicker-free.
type RailCacheScope = 'owner' | 'guest'

interface RailDataCache {
  about?: { tick: number; data: BlogPageData }
  archives?: { tick: number; items: BlogArchiveItem[] }
  equipment?: { tick: number; items: BlogCatalogItem[] }
  labs?: { tick: number; items: BlogCatalogItem[] }
  friends?: { tick: number; items: BlogFriend[] }
}

const railCache: Record<RailCacheScope, RailDataCache> = {
  owner: {},
  guest: {}
}

function getRailScope(isOwner: boolean): RailCacheScope {
  return isOwner ? 'owner' : 'guest'
}

function getMonogram(name: string, fallback = 'B'): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return fallback
  return Array.from(trimmed)[0]?.toUpperCase() || fallback
}

function getSafeExternalUrl(raw: string | undefined | null): string | null {
  const cleaned = (raw || '').trim()
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  return null
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function shuffleFriends(items: BlogFriend[]): BlogFriend[] {
  if (items.length <= 1) return [...items]
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
  }
  // Ensure order visibly changes when there are at least 2 items
  if (next.every((item, idx) => item.id === items[idx]?.id)) {
    const first = next.shift()
    if (first) next.push(first)
  }
  return next
}

interface ExtractedAlbumPhoto {
  thumbUrl: string
  url: string
  alt?: string
}

function extractRecentAlbumPhotos(items: BlogArchiveItem[], limit = 9): ExtractedAlbumPhoto[] {
  const photos: ExtractedAlbumPhoto[] = []
  const seenUrls = new Set<string>()

  for (const item of items) {
    if (item.locked) continue
    for (const img of item.images || []) {
      const fullUrl = (img.url || '').trim()
      if (!fullUrl || seenUrls.has(fullUrl)) continue
      seenUrls.add(fullUrl)
      photos.push({
        thumbUrl: (img.thumbUrl || fullUrl).trim(),
        url: fullUrl,
        alt: img.alt?.trim() || item.title?.trim() || item.excerpt?.trim() || '相册照片'
      })
      if (photos.length >= limit) {
        return photos
      }
    }
  }

  return photos
}

/* --------------------------------------------------------------------------
   Article Table of Contents Card (Left Rail Top)
   -------------------------------------------------------------------------- */

function ArticleTocCard({
  headings,
  activeHeadingId,
  onJumpHeading
}: {
  headings: TocHeading[]
  activeHeadingId?: string
  onJumpHeading?: (id: string) => void
}) {
  const activeBtnRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const listEl = listRef.current
    const activeEl = activeBtnRef.current
    if (!listEl || !activeEl) return
    const itemTop = activeEl.offsetTop
    const itemBottom = itemTop + activeEl.offsetHeight
    const viewTop = listEl.scrollTop
    const viewBottom = viewTop + listEl.clientHeight
    if (itemTop < viewTop) {
      listEl.scrollTop = Math.max(0, itemTop - 8)
    } else if (itemBottom > viewBottom) {
      listEl.scrollTop = itemBottom - listEl.clientHeight + 8
    }
  }, [activeHeadingId])

  return (
    <section className="blog-rail-card blog-rail-toc" aria-label="文章目录">
      <header className="blog-rail-card-head">
        <div className="blog-rail-card-title">
          <AppIcon name="list" size={14} />
          <span>文章目录</span>
        </div>
        <span className="blog-rail-toc-count">{headings.length}</span>
      </header>

      <nav ref={listRef} className="blog-rail-toc-list" aria-label="章节导航">
        {headings.map((heading) => {
          const isActive = activeHeadingId === heading.id
          const cls = [
            'blog-rail-toc-item',
            heading.level === 3 ? 'is-h3' : '',
            isActive ? 'is-active' : ''
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <button
              key={heading.id}
              ref={isActive ? activeBtnRef : null}
              type="button"
              className={cls}
              aria-current={isActive ? 'location' : undefined}
              onClick={() => onJumpHeading?.(heading.id)}
              title={heading.text}
            >
              <span className="blog-rail-toc-dot" aria-hidden="true" />
              <span className="blog-rail-toc-text">{heading.text}</span>
            </button>
          )
        })}
      </nav>
    </section>
  )
}

/* --------------------------------------------------------------------------
   Left Widget 1: About Me Card (关于我)
   -------------------------------------------------------------------------- */

function AboutRailWidget({
  profile,
  isOwner,
  activeRoute,
  refreshTick,
  initialSummary,
  summaryLoading = false,
  onNavigate,
  onOpenSettings
}: BlogSideRailDataProps) {
  const scope = getRailScope(isOwner)
  const [aboutPage, setAboutPage] = useState<BlogPageData | null>(
    () => railCache[scope].about?.data ?? null
  )

  useEffect(() => {
    if (refreshTick === 0 && initialSummary) {
      return
    }
    if (refreshTick === 0 && summaryLoading) {
      return
    }
    const cached = railCache[scope].about
    if (cached && cached.tick === refreshTick) {
      setAboutPage(cached.data)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchBlogPage('about')
        if (cancelled) return
        railCache[scope].about = { tick: refreshTick, data }
        setAboutPage(data)
      } catch {
        // Keep profile fallback if /api/blog/pages/about is unavailable
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshTick, initialSummary, summaryLoading, scope])

  const useSummaryAbout =
    refreshTick === 0 &&
    Boolean(initialSummary) &&
    !(railCache[scope].about && railCache[scope].about?.tick === refreshTick)

  const displayName = profile.nickname || profile.siteName || '个人博客'
  const subtitle =
    (profile.aboutSubtitle !== undefined
      ? profile.aboutSubtitle.trim()
      : useSummaryAbout
        ? initialSummary?.aboutSubtitle?.trim()
        : aboutPage?.subtitle?.trim()) || '数字花园与个人简介'
  const aboutExcerpt = useMemo(() => {
    if (useSummaryAbout && initialSummary) {
      if (initialSummary.aboutExcerpt?.trim()) return initialSummary.aboutExcerpt.trim()
      if (profile.bio?.trim()) return profile.bio.trim()
      return isOwner ? '点击右上角详情完善「关于我」独立页面…' : '记录日常片段、阅读与思考。'
    }
    if (aboutPage?.content?.trim()) {
      const stripped = generateExcerpt(aboutPage.content, 110)
      if (stripped) return stripped
    }
    if (profile.bio?.trim()) return profile.bio.trim()
    return isOwner ? '点击右上角详情完善「关于我」独立页面…' : '记录日常片段、阅读与思考。'
  }, [useSummaryAbout, initialSummary, aboutPage?.content, profile.bio, isOwner])

  const isCurrent = activeRoute === 'about'

  return (
    <section
      className={`blog-rail-card blog-rail-about${isCurrent ? ' is-route-active' : ''}`}
      aria-label="关于我"
    >
      <header className="blog-rail-card-head">
        <div className="blog-rail-card-title">
          <AppIcon name="user" size={14} />
          <span>关于我</span>
          {isCurrent && <span className="blog-rail-active-badge">当前</span>}
        </div>
        <div className="blog-rail-head-actions">
          {isOwner && onOpenSettings && (
            <button
              type="button"
              className="blog-rail-icon-btn"
              onClick={onOpenSettings}
              title="自定义简介与副标题"
              aria-label="自定义简介与副标题"
            >
              <AppIcon name="edit" size={13} />
            </button>
          )}
          <a
            href="/about"
            className="blog-rail-more"
            onClick={(event) => {
              if (!isPlainLeftClick(event)) return
              event.preventDefault()
              onNavigate('/about')
            }}
          >
            <span>详情</span>
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </header>

      <div className="blog-rail-about-author">
        <button
          type="button"
          className="blog-rail-about-avatar"
          onClick={() => onNavigate('/about')}
          aria-label={`查看 ${displayName} 的关于页面`}
        >
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt={displayName} />
          ) : (
            <span>{getMonogram(displayName)}</span>
          )}
        </button>

        <div className="blog-rail-about-meta">
          <button
            type="button"
            className="blog-rail-about-name"
            onClick={() => onNavigate('/about')}
          >
            {displayName}
          </button>
          <span className="blog-rail-about-sub">{subtitle}</span>
        </div>
      </div>

      <p className="blog-rail-about-bio">{aboutExcerpt}</p>

      <div className="blog-rail-stats" role="list" aria-label="博客统计">
        <button
          type="button"
          role="listitem"
          className="blog-rail-stat"
          onClick={() => onNavigate('/')}
        >
          <span className="blog-rail-stat-value">{profile.stats.momentCount}</span>
          <span className="blog-rail-stat-label">动态</span>
        </button>
        <button
          type="button"
          role="listitem"
          className="blog-rail-stat"
          onClick={() => onNavigate('/')}
        >
          <span className="blog-rail-stat-value">{profile.stats.articleCount}</span>
          <span className="blog-rail-stat-label">文章</span>
        </button>
        <button
          type="button"
          role="listitem"
          className="blog-rail-stat"
          onClick={() => onNavigate('/about')}
        >
          <span className="blog-rail-stat-value">{profile.stats.commentCount}</span>
          <span className="blog-rail-stat-label">留言</span>
        </button>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------------
   Left Widget 2: Mini Photo Album Card (个人相册 3x3)
   -------------------------------------------------------------------------- */

function AlbumRailWidget({
  isOwner,
  activeRoute,
  refreshTick,
  initialSummary,
  summaryLoading = false,
  onNavigate,
  onOpenLightbox,
  onOpenCompose
}: BlogSideRailDataProps) {
  const scope = getRailScope(isOwner)
  const [archiveItems, setArchiveItems] = useState<BlogArchiveItem[]>(
    () => railCache[scope].archives?.items ?? []
  )
  const [loaded, setLoaded] = useState<boolean>(
    () => Boolean(railCache[scope].archives) || (refreshTick === 0 && Boolean(initialSummary))
  )

  useEffect(() => {
    if (refreshTick === 0 && initialSummary) {
      setLoaded(true)
      return
    }
    if (refreshTick === 0 && summaryLoading) {
      return
    }
    const cached = railCache[scope].archives
    if (cached && cached.tick === refreshTick) {
      setArchiveItems(cached.items)
      setLoaded(true)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchBlogArchives()
        if (cancelled) return
        const items = Array.isArray(res?.items) ? res.items : []
        railCache[scope].archives = { tick: refreshTick, items }
        setArchiveItems(items)
      } catch {
        // Keep existing or empty state on network failure
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshTick, initialSummary, summaryLoading, scope])

  const useSummaryPhotos =
    refreshTick === 0 &&
    Boolean(initialSummary) &&
    !(railCache[scope].archives && railCache[scope].archives?.tick === refreshTick)

  const photos = useMemo<ExtractedAlbumPhoto[]>(() => {
    if (useSummaryPhotos && initialSummary) {
      return (initialSummary.recentAlbumPhotos || []).slice(0, 9).map((item) => ({
        url: item.url,
        thumbUrl: (item.thumbUrl || item.url).trim(),
        alt: item.alt?.trim() || '相册照片'
      }))
    }
    return extractRecentAlbumPhotos(archiveItems, 9)
  }, [useSummaryPhotos, initialSummary, archiveItems])
  const lightboxImages = useMemo(
    () => photos.map((photo) => ({ url: photo.url, alt: photo.alt })),
    [photos]
  )
  const isCurrent = activeRoute === 'archives'

  return (
    <section
      className={`blog-rail-card blog-rail-album${isCurrent ? ' is-route-active' : ''}`}
      aria-label="个人相册"
    >
      <header className="blog-rail-card-head">
        <div className="blog-rail-card-title">
          <AppIcon name="album" size={14} />
          <span>个人相册</span>
          {isCurrent && <span className="blog-rail-active-badge">当前</span>}
        </div>
        <a
          href="/archives"
          className="blog-rail-more"
          onClick={(event) => {
            if (!isPlainLeftClick(event)) return
            event.preventDefault()
            onNavigate('/archives')
          }}
        >
          <span>全部</span>
          <span aria-hidden="true">→</span>
        </a>
      </header>

      {photos.length > 0 ? (
        <div className="blog-rail-album-grid">
          {photos.map((photo, idx) => (
            <button
              key={`${photo.url}-${idx}`}
              type="button"
              className="blog-rail-album-tile"
              onClick={() => onOpenLightbox(lightboxImages, idx)}
              aria-label={`查看相册图片 ${idx + 1}${photo.alt ? `：${photo.alt}` : ''}`}
              title={photo.alt || '点击放大查看'}
            >
              <img src={photo.thumbUrl} alt={photo.alt || ''} loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
        <div className="blog-rail-empty">
          <span className="blog-rail-empty-text">
            {loaded ? '暂无公开相册图片' : '正在同步相册…'}
          </span>
          {loaded && isOwner && (
            <button
              type="button"
              className="blog-rail-empty-btn"
              onClick={() => onOpenCompose('moment')}
            >
              <AppIcon name="plus" size={12} />
              <span>发图动态</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/* --------------------------------------------------------------------------
   Right Widget 1: Persistent Music Player Card (音乐播放器)
   -------------------------------------------------------------------------- */

const AMBIENT_MODE_NEXT: Record<BlogAmbientMode, BlogAmbientMode> = {
  waves: 'silk',
  silk: 'minimal',
  minimal: 'waves'
}

const AMBIENT_MODE_SHORT_LABELS: Record<BlogAmbientMode, string> = {
  waves: '声波',
  silk: '极光',
  minimal: '极简'
}

function MusicRailWidget({ isOwner }: BlogSideRailDataProps) {
  const {
    tracks,
    currentTrack,
    isPlaying,
    volume,
    setVolume,
    muted,
    toggleMute,
    ambientMode,
    setAmbientMode,
    openImmersion,
    togglePlay,
    prevTrack,
    nextTrack,
    seekTo,
    openDrawer,
    openManager,
    openTuner,
    tunerOpen
  } = useBlogMusicActions()
  const { currentTime, duration, currentLyricLine } = useBlogMusicProgress()

  const displayTrack: BlogPostMusic | null = useMemo(() => {
    if (currentTrack) return currentTrack
    const first = tracks[0]
    if (!first) return null
    return {
      trackId: first.id,
      title: first.title,
      artist: first.artist || '',
      coverUrl: first.coverUrl,
      audioUrl: first.audioUrl,
      lrc: first.lrcText || undefined
    }
  }, [currentTrack, tracks])

  const parsedLyrics = useMemo(() => {
    if (!displayTrack) return []
    const rawLrc =
      displayTrack.lrc ??
      tracks.find((item) => item.id === displayTrack.trackId)?.lrcText ??
      ''
    return parseLrc(rawLrc)
  }, [tracks, displayTrack])

  const nextLyricLine = useMemo(() => {
    if (parsedLyrics.length === 0) return ''
    let activeIdx = -1
    for (let i = 0; i < parsedLyrics.length; i += 1) {
      if (parsedLyrics[i].time <= currentTime + 0.12) {
        activeIdx = i
      } else {
        break
      }
    }
    if (activeIdx >= 0 && activeIdx + 1 < parsedLyrics.length) {
      return parsedLyrics[activeIdx + 1].text
    }
    if (activeIdx === -1 && parsedLyrics.length > 0) {
      return parsedLyrics[0].text
    }
    return ''
  }, [currentTime, parsedLyrics])

  const hasMusic = tracks.length > 0 || Boolean(displayTrack)

  if (!hasMusic) {
    if (!isOwner) return null
    return (
      <section className="blog-rail-card blog-rail-music is-empty" aria-label="音乐播放器">
        <header className="blog-rail-card-head">
          <div className="blog-rail-card-title">
            <AppIcon name="music" size={14} />
            <span>音乐歌单</span>
          </div>
        </header>
        <div className="blog-rail-empty">
          <span className="blog-rail-empty-text">音乐歌单 · 暂无歌曲</span>
          <button
            type="button"
            className="blog-rail-empty-btn"
            onClick={openManager}
          >
            <AppIcon name="upload" size={12} />
            <span>上传歌曲</span>
          </button>
        </div>
      </section>
    )
  }

  if (!displayTrack) return null

  const effectiveDuration =
    duration > 0
      ? duration
      : tracks.find((item) => item.id === displayTrack.trackId)?.durationSec || 0

  const primaryLyric =
    currentLyricLine ||
    (parsedLyrics.length > 0
      ? isPlaying
        ? '♪ 前奏播放中…'
        : parsedLyrics[0].text
      : isPlaying
        ? '正在播放 · 点击展开歌单'
        : '点击播放 · 边听边逛')

  const secondaryLyric =
    currentLyricLine && nextLyricLine
      ? nextLyricLine
      : !currentLyricLine && parsedLyrics.length > 1 && !isPlaying
        ? parsedLyrics[1].text
        : ''

  const displayVol = muted ? 0 : volume
  const volPercent = Math.round(displayVol * 100)
  const seekPercent =
    effectiveDuration > 0
      ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100))
      : 0
  const ambientLabel = AMBIENT_MODE_SHORT_LABELS[ambientMode] ?? '声波'
  const showTuner = isOwner && Boolean(currentTrack)

  const footerPillBaseStyle: CSSProperties = {
    height: 28,
    padding: '0 10px',
    borderRadius: 'var(--blog-radius-pill, 50px)',
    fontSize: 12,
    gap: 5,
    minWidth: 0
  }

  return (
    <section
      className={`blog-rail-card blog-rail-music${isPlaying ? ' is-playing' : ''}`}
      aria-label="音乐播放器"
    >
      <header className="blog-rail-card-head">
        <div className="blog-rail-card-title">
          <AppIcon name="music" size={14} />
          <span>{isPlaying ? '正在播放' : '音乐播放器'}</span>
        </div>

        <div className="blog-rail-head-actions">
          <button
            type="button"
            className="blog-rail-more"
            onClick={openDrawer}
            title="展开歌词与完整歌单"
          >
            <span>歌单</span>
            {tracks.length > 0 && (
              <span className="blog-rail-inline-count">{tracks.length}</span>
            )}
          </button>
          {isOwner && (
            <button
              type="button"
              className="blog-rail-more"
              onClick={openManager}
              title="管理博客歌单"
            >
              <span>管理</span>
            </button>
          )}
        </div>
      </header>

      <div className="blog-rail-music-top">
        <button
          type="button"
          className={`blog-rail-music-disc${isPlaying ? ' is-playing' : ''}`}
          onClick={togglePlay}
          title={isPlaying ? '暂停' : '播放'}
          aria-label={isPlaying ? '暂停音乐' : '播放音乐'}
        >
          {displayTrack.coverUrl ? (
            <img src={displayTrack.coverUrl} alt={displayTrack.title} />
          ) : (
            <AppIcon name="music" size={18} />
          )}
        </button>

        <div className="blog-rail-music-meta">
          <div className="blog-rail-music-title" title={displayTrack.title}>
            {displayTrack.title}
          </div>
          <div className="blog-rail-music-artist" title={displayTrack.artist || '未知歌手'}>
            {displayTrack.artist || '未知歌手'}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="blog-rail-music-lyrics"
        onClick={openDrawer}
        title="点击展开同步歌词抽屉"
      >
        <span
          className={`blog-rail-music-lyric-active${secondaryLyric ? '' : ' is-two-line'}`}
        >
          {primaryLyric}
        </span>
        {secondaryLyric && (
          <span className="blog-rail-music-lyric-next">{secondaryLyric}</span>
        )}
      </button>

      <div className="blog-rail-music-progress">
        <input
          type="range"
          className="blog-rail-music-seek"
          min={0}
          max={effectiveDuration > 0 ? effectiveDuration : 100}
          step={0.1}
          value={effectiveDuration > 0 ? Math.min(currentTime, effectiveDuration) : 0}
          disabled={effectiveDuration <= 0}
          style={{ '--seek-pct': `${seekPercent.toFixed(2)}%` } as CSSProperties}
          onChange={(event) => seekTo(Number(event.target.value))}
          aria-label="音乐播放进度"
        />
        <div className="blog-rail-music-times">
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(effectiveDuration)}</span>
        </div>
      </div>

      <div className="blog-rail-music-controls" style={{ justifyContent: 'center' }}>
        <div className="blog-rail-music-transport">
          <button
            type="button"
            className="blog-rail-music-btn"
            onClick={prevTrack}
            disabled={tracks.length <= 1}
            title="上一首"
            aria-label="上一首"
          >
            <AppIcon name="skipBack" size={14} />
          </button>

          <button
            type="button"
            className="blog-rail-music-play"
            onClick={togglePlay}
            title={isPlaying ? '暂停' : '播放'}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            <AppIcon name={isPlaying ? 'pause' : 'play'} size={15} />
          </button>

          <button
            type="button"
            className="blog-rail-music-btn"
            onClick={nextTrack}
            disabled={tracks.length <= 1}
            title="下一首"
            aria-label="下一首"
          >
            <AppIcon name="skipForward" size={14} />
          </button>
        </div>
      </div>

      <div className="blog-volume-row">
        <button
          type="button"
          className="blog-volume-mute-btn"
          onClick={toggleMute}
          title={muted || volume === 0 ? '取消静音' : '静音'}
          aria-label={muted || volume === 0 ? '取消静音' : '静音'}
        >
          <AppIcon name={muted || volume === 0 ? 'volumeOff' : 'volume'} size={14} />
        </button>
        <input
          type="range"
          className="blog-volume-slider"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          style={{ '--vol-pct': `${volPercent}%` } as CSSProperties}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="音量"
        />
        <span className="blog-volume-pct">{volPercent}%</span>
      </div>

      <div
        className="blog-rail-music-footer"
        style={{
          display: 'grid',
          gridTemplateColumns: showTuner
            ? 'minmax(0, 1.15fr) minmax(0, 1.15fr) minmax(0, 0.8fr)'
            : 'repeat(2, minmax(0, 1fr))',
          gap: 6,
          paddingTop: 2
        }}
      >
        <button
          type="button"
          className="blog-btn blog-btn-subtle blog-btn-sm"
          style={footerPillBaseStyle}
          onClick={openImmersion}
          title="打开全屏沉浸封面与歌词舞台"
        >
          <AppIcon name="sparkles" size={12} />
          <span>沉浸舞台</span>
        </button>

        <button
          type="button"
          className="blog-btn blog-btn-subtle blog-btn-sm"
          style={
            ambientMode !== 'minimal'
              ? {
                  ...footerPillBaseStyle,
                  background: 'var(--blog-link-soft)',
                  color: 'var(--blog-link)',
                  borderColor: 'transparent'
                }
              : footerPillBaseStyle
          }
          onClick={() => setAmbientMode(AMBIENT_MODE_NEXT[ambientMode] ?? 'waves')}
          title="循环切换音乐播放背景氛围（声波 / 极光 / 极简）"
          aria-label={`背景氛围：${ambientLabel}，点击切换`}
        >
          <span>氛围 · {ambientLabel}</span>
        </button>

        {showTuner && (
          <button
            type="button"
            className="blog-btn blog-btn-subtle blog-btn-sm"
            style={
              tunerOpen
                ? {
                    ...footerPillBaseStyle,
                    padding: '0 8px',
                    background: 'var(--blog-link-soft)',
                    color: 'var(--blog-link)',
                    borderColor: 'transparent'
                  }
                : { ...footerPillBaseStyle, padding: '0 8px' }
            }
            onClick={() => openTuner(currentTrack?.trackId)}
            title="打开本曲实时视觉调参面板（音频响应 / 丝绸极光 / 声波形态）"
            aria-label="打开本曲实时视觉调参面板"
            aria-pressed={tunerOpen}
          >
            <AppIcon name="settings" size={12} />
            <span>调参</span>
          </button>
        )}
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------------
   Right Widget 2: Equipment Card (我的装备)
   -------------------------------------------------------------------------- */

function EquipmentRailWidget({
  isOwner,
  activeRoute,
  refreshTick,
  initialSummary,
  summaryLoading = false,
  onNavigate
}: BlogSideRailDataProps) {
  const scope = getRailScope(isOwner)
  const [items, setItems] = useState<BlogCatalogItem[]>(() => {
    if (refreshTick === 0 && initialSummary) {
      return Array.isArray(initialSummary.equipment) ? initialSummary.equipment : []
    }
    return railCache[scope].equipment?.items ?? []
  })
  const [loaded, setLoaded] = useState<boolean>(
    () => Boolean(railCache[scope].equipment) || (refreshTick === 0 && Boolean(initialSummary))
  )

  useEffect(() => {
    if (refreshTick === 0 && initialSummary) {
      setItems(Array.isArray(initialSummary.equipment) ? initialSummary.equipment : [])
      setLoaded(true)
      return
    }
    if (refreshTick === 0 && summaryLoading) {
      return
    }
    const cached = railCache[scope].equipment
    if (cached && cached.tick === refreshTick) {
      setItems(cached.items)
      setLoaded(true)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchBlogCatalog('equipment')
        if (cancelled) return
        const nextItems = Array.isArray(res?.items) ? res.items : []
        railCache[scope].equipment = { tick: refreshTick, items: nextItems }
        setItems(nextItems)
      } catch {
        // Silent fallback
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshTick, initialSummary, summaryLoading, scope])

  if (items.length === 0 && !isOwner) {
    return null
  }

  const visibleItems = items.slice(0, 4)
  const isCurrent = activeRoute === 'equipment'

  return (
    <section
      className={`blog-rail-card blog-rail-equipment${isCurrent ? ' is-route-active' : ''}`}
      aria-label="我的装备"
    >
      <header className="blog-rail-card-head">
        <div className="blog-rail-card-title">
          <AppIcon name="cpu" size={14} />
          <span>我的装备</span>
          {isCurrent && <span className="blog-rail-active-badge">当前</span>}
        </div>
        <a
          href="/equipment"
          className="blog-rail-more"
          onClick={(event) => {
            if (!isPlainLeftClick(event)) return
            event.preventDefault()
            onNavigate('/equipment')
          }}
        >
          <span>全部</span>
          <span aria-hidden="true">→</span>
        </a>
      </header>

      {visibleItems.length > 0 ? (
        <div className="blog-rail-list">
          {visibleItems.map((item) => {
            const safeUrl = getSafeExternalUrl(item.linkUrl)
            const subtitle =
              item.subtitle?.trim() || item.category?.trim() || item.description?.trim() || ''
            const inner = (
              <>
                <span className="blog-rail-item-thumb">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.title} loading="lazy" />
                  ) : (
                    <AppIcon name="cpu" size={16} />
                  )}
                </span>
                <span className="blog-rail-item-body">
                  <span className="blog-rail-item-top">
                    <span className="blog-rail-item-title">{item.title}</span>
                    {item.tag?.trim() && (
                      <span className="blog-rail-tag">{item.tag.trim()}</span>
                    )}
                  </span>
                  {subtitle && (
                    <span className="blog-rail-item-sub is-mono">{subtitle}</span>
                  )}
                </span>
              </>
            )

            if (safeUrl) {
              return (
                <a
                  key={item.id}
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="blog-rail-item"
                  title={item.title}
                >
                  {inner}
                </a>
              )
            }

            return (
              <button
                key={item.id}
                type="button"
                className="blog-rail-item"
                onClick={() => onNavigate('/equipment')}
                title={item.title}
              >
                {inner}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="blog-rail-empty">
          <span className="blog-rail-empty-text">
            {loaded ? '还没有添加常用装备' : '正在加载装备…'}
          </span>
          {loaded && isOwner && (
            <button
              type="button"
              className="blog-rail-empty-btn"
              onClick={() => onNavigate('/equipment')}
            >
              <AppIcon name="plus" size={12} />
              <span>添加装备</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/* --------------------------------------------------------------------------
   Right Widget 3: Labs Card (实验室)
   -------------------------------------------------------------------------- */

function LabsRailWidget({
  isOwner,
  activeRoute,
  refreshTick,
  initialSummary,
  summaryLoading = false,
  onNavigate
}: BlogSideRailDataProps) {
  const scope = getRailScope(isOwner)
  const [items, setItems] = useState<BlogCatalogItem[]>(() => {
    if (refreshTick === 0 && initialSummary) {
      return Array.isArray(initialSummary.labs) ? initialSummary.labs : []
    }
    return railCache[scope].labs?.items ?? []
  })
  const [loaded, setLoaded] = useState<boolean>(
    () => Boolean(railCache[scope].labs) || (refreshTick === 0 && Boolean(initialSummary))
  )

  useEffect(() => {
    if (refreshTick === 0 && initialSummary) {
      setItems(Array.isArray(initialSummary.labs) ? initialSummary.labs : [])
      setLoaded(true)
      return
    }
    if (refreshTick === 0 && summaryLoading) {
      return
    }
    const cached = railCache[scope].labs
    if (cached && cached.tick === refreshTick) {
      setItems(cached.items)
      setLoaded(true)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchBlogCatalog('labs')
        if (cancelled) return
        const nextItems = Array.isArray(res?.items) ? res.items : []
        railCache[scope].labs = { tick: refreshTick, items: nextItems }
        setItems(nextItems)
      } catch {
        // Silent fallback
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshTick, initialSummary, summaryLoading, scope])

  if (items.length === 0 && !isOwner) {
    return null
  }

  const visibleItems = items.slice(0, 3)
  const isCurrent = activeRoute === 'labs'

  return (
    <section
      className={`blog-rail-card blog-rail-labs${isCurrent ? ' is-route-active' : ''}`}
      aria-label="实验室"
    >
      <header className="blog-rail-card-head">
        <div className="blog-rail-card-title">
          <AppIcon name="flask" size={14} />
          <span>实验室</span>
          {isCurrent && <span className="blog-rail-active-badge">当前</span>}
        </div>
        <a
          href="/labs"
          className="blog-rail-more"
          onClick={(event) => {
            if (!isPlainLeftClick(event)) return
            event.preventDefault()
            onNavigate('/labs')
          }}
        >
          <span>全部</span>
          <span aria-hidden="true">→</span>
        </a>
      </header>

      {visibleItems.length > 0 ? (
        <div className="blog-rail-list">
          {visibleItems.map((item) => {
            const safeUrl = getSafeExternalUrl(item.linkUrl)
            const statusTag = item.tag?.trim() || item.category?.trim() || ''
            const subtitle = item.subtitle?.trim() || item.description?.trim() || ''
            const inner = (
              <>
                <span className="blog-rail-item-thumb is-compact">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.title} loading="lazy" />
                  ) : (
                    <AppIcon name="flask" size={15} />
                  )}
                </span>
                <span className="blog-rail-item-body">
                  <span className="blog-rail-item-top">
                    <span className="blog-rail-item-title">{item.title}</span>
                    {statusTag && <span className="blog-rail-tag">{statusTag}</span>}
                  </span>
                  {subtitle && <span className="blog-rail-item-sub">{subtitle}</span>}
                </span>
                <span className="blog-rail-item-ext" aria-hidden="true">
                  ↗
                </span>
              </>
            )

            if (safeUrl) {
              return (
                <a
                  key={item.id}
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="blog-rail-item"
                  title={item.title}
                >
                  {inner}
                </a>
              )
            }

            return (
              <button
                key={item.id}
                type="button"
                className="blog-rail-item"
                onClick={() => onNavigate('/labs')}
                title={item.title}
              >
                {inner}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="blog-rail-empty">
          <span className="blog-rail-empty-text">
            {loaded ? '还没有添加实验项目' : '正在加载项目…'}
          </span>
          {loaded && isOwner && (
            <button
              type="button"
              className="blog-rail-empty-btn"
              onClick={() => onNavigate('/labs')}
            >
              <AppIcon name="plus" size={12} />
              <span>添加项目</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/* --------------------------------------------------------------------------
   Right Widget 4: Friends / Blogroll Card (友人帐)
   -------------------------------------------------------------------------- */

function FriendChipAvatar({ name, avatarUrl }: { name: string; avatarUrl: string }) {
  const [failed, setFailed] = useState(false)
  const cleanUrl = (avatarUrl || '').trim()

  useEffect(() => {
    setFailed(false)
  }, [cleanUrl])

  if (cleanUrl && !failed) {
    return (
      <span className="blog-rail-friend-avatar">
        <img
          src={cleanUrl}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    )
  }

  return (
    <span className="blog-rail-friend-avatar" aria-hidden="true">
      {getMonogram(name, '友')}
    </span>
  )
}

function FriendsRailWidget({
  isOwner,
  activeRoute,
  refreshTick,
  initialSummary,
  summaryLoading = false,
  onNavigate
}: BlogSideRailDataProps) {
  const scope = getRailScope(isOwner)
  const [friends, setFriends] = useState<BlogFriend[]>(() => {
    if (refreshTick === 0 && initialSummary) {
      return Array.isArray(initialSummary.friends) ? initialSummary.friends : []
    }
    return railCache[scope].friends?.items ?? []
  })
  const [displayFriends, setDisplayFriends] = useState<BlogFriend[]>(() => {
    if (refreshTick === 0 && initialSummary) {
      return Array.isArray(initialSummary.friends) ? initialSummary.friends : []
    }
    return railCache[scope].friends?.items ?? []
  })
  const [loaded, setLoaded] = useState<boolean>(
    () => Boolean(railCache[scope].friends) || (refreshTick === 0 && Boolean(initialSummary))
  )

  useEffect(() => {
    if (refreshTick === 0 && initialSummary) {
      const nextFriends = Array.isArray(initialSummary.friends) ? initialSummary.friends : []
      setFriends(nextFriends)
      setDisplayFriends(nextFriends)
      setLoaded(true)
      return
    }
    if (refreshTick === 0 && summaryLoading) {
      return
    }
    const cached = railCache[scope].friends
    if (cached && cached.tick === refreshTick) {
      setFriends(cached.items)
      setDisplayFriends(cached.items)
      setLoaded(true)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchBlogFriends()
        if (cancelled) return
        const nextFriends = Array.isArray(res?.friends) ? res.friends : []
        railCache[scope].friends = { tick: refreshTick, items: nextFriends }
        setFriends(nextFriends)
        setDisplayFriends(nextFriends)
      } catch {
        // Silent fallback
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshTick, initialSummary, summaryLoading, scope])

  const handleShuffle = useCallback(() => {
    setDisplayFriends((prev) => shuffleFriends(prev.length > 0 ? prev : friends))
  }, [friends])

  if (friends.length === 0 && !isOwner) {
    return null
  }

  const visibleFriends = displayFriends.slice(0, 6)
  const isCurrent = activeRoute === 'friends'

  return (
    <section
      className={`blog-rail-card blog-rail-friends${isCurrent ? ' is-route-active' : ''}`}
      aria-label="友人帐"
    >
      <header className="blog-rail-card-head">
        <div className="blog-rail-card-title">
          <AppIcon name="users" size={14} />
          <span>友人帐</span>
          {isCurrent && <span className="blog-rail-active-badge">当前</span>}
        </div>

        <div className="blog-rail-head-actions">
          {friends.length > 1 && (
            <button
              type="button"
              className="blog-rail-icon-btn"
              onClick={handleShuffle}
              title="随机换一批"
              aria-label="随机排序友链"
            >
              <AppIcon name="shuffle" size={13} />
            </button>
          )}
          <a
            href="/friends"
            className="blog-rail-more"
            onClick={(event) => {
              if (!isPlainLeftClick(event)) return
              event.preventDefault()
              onNavigate('/friends')
            }}
          >
            <span>全部</span>
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </header>

      {visibleFriends.length > 0 ? (
        <div className="blog-rail-friends-grid">
          {visibleFriends.map((friend) => {
            const safeUrl = getSafeExternalUrl(friend.url)
            const tooltip = friend.description?.trim()
              ? `${friend.name} — ${friend.description.trim()}`
              : friend.name

            if (safeUrl) {
              return (
                <a
                  key={friend.id}
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="blog-rail-friend-chip"
                  title={tooltip}
                >
                  <FriendChipAvatar name={friend.name} avatarUrl={friend.avatarUrl} />
                  <span className="blog-rail-friend-name">{friend.name}</span>
                </a>
              )
            }

            return (
              <button
                key={friend.id}
                type="button"
                className="blog-rail-friend-chip"
                onClick={() => onNavigate('/friends')}
                title={tooltip}
              >
                <FriendChipAvatar name={friend.name} avatarUrl={friend.avatarUrl} />
                <span className="blog-rail-friend-name">{friend.name}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="blog-rail-empty">
          <span className="blog-rail-empty-text">
            {loaded ? '还没有添加友链' : '正在加载友链…'}
          </span>
          {loaded && isOwner && (
            <button
              type="button"
              className="blog-rail-empty-btn"
              onClick={() => onNavigate('/friends')}
            >
              <AppIcon name="plus" size={12} />
              <span>添加友链</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/* --------------------------------------------------------------------------
   Widget Registry & Rail Containers
   -------------------------------------------------------------------------- */

const WIDGET_RENDERERS: Record<
  BlogSidebarWidgetId,
  (props: BlogSideRailDataProps) => ReactNode
> = {
  about: (props) => <AboutRailWidget key="about" {...props} />,
  album: (props) => <AlbumRailWidget key="album" {...props} />,
  music: (props) => <MusicRailWidget key="music" {...props} />,
  equipment: (props) => <EquipmentRailWidget key="equipment" {...props} />,
  labs: (props) => <LabsRailWidget key="labs" {...props} />,
  friends: (props) => <FriendsRailWidget key="friends" {...props} />
}

export function BlogLeftRail(props: BlogLeftRailProps) {
  const { articleHeadings, activeHeadingId, onJumpHeading, hiddenWidgets } = props
  const showArticleToc =
    props.activeRoute === 'article' &&
    Array.isArray(articleHeadings) &&
    articleHeadings.length >= 2

  const hiddenSet = useMemo(() => new Set(hiddenWidgets), [hiddenWidgets])

  return (
    <aside className="blog-bento-rail is-left" aria-label="博客左侧栏">
      {showArticleToc && articleHeadings && (
        <ArticleTocCard
          headings={articleHeadings}
          activeHeadingId={activeHeadingId}
          onJumpHeading={onJumpHeading}
        />
      )}
      {LEFT_WIDGET_IDS.filter((id) => !hiddenSet.has(id)).map((id) =>
        WIDGET_RENDERERS[id](props)
      )}
    </aside>
  )
}

export function BlogRightRail(props: BlogSideRailDataProps) {
  const hiddenSet = useMemo(() => new Set(props.hiddenWidgets), [props.hiddenWidgets])

  return (
    <aside className="blog-bento-rail is-right" aria-label="博客右侧栏">
      {RIGHT_WIDGET_IDS.filter((id) => !hiddenSet.has(id)).map((id) =>
        WIDGET_RENDERERS[id](props)
      )}
    </aside>
  )
}
