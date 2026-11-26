import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { errorMessage } from './api-error'
import {
  AUDIO_ANALYSER_FFT_SIZE,
  AUDIO_ANALYSER_MAX_DB,
  AUDIO_ANALYSER_MIN_DB,
  AUDIO_ANALYSER_SMOOTHING,
  AudioFrameAnalyzer,
  DEFAULT_AMBIENT_PALETTE,
  extractCoverPalette,
  readAmbientMode,
  saveAmbientMode,
  type AudioAnalysisFrame,
  type BlogAmbientMode,
  type BlogAmbientPalette
} from './blog-ambient'
import './blog-ambient.css'
import {
  createBlogMusicTrack,
  deleteBlogMusicTrack,
  fetchBlogMusicTracks,
  updateBlogMusicTrack,
  uploadBlogFile,
  uploadBlogMedia
} from './blog-api'
import { extractAudioMetadata } from './blog-audio-meta'
import type { BlogMusicTrack, BlogPostMusic } from './blog-types'
import { AppIcon } from './components/AppIcon'
import { showToast } from './components/Toast'

export type { AudioAnalysisFrame, BlogAmbientMode, BlogAmbientPalette } from './blog-ambient'

/** Lightweight compatibility view of the current {@link AudioAnalysisFrame}. */
export interface AudioEnergy {
  bass: number
  mid: number
  level: number
}

export interface LrcLine {
  time: number
  text: string
}

export interface BlogMusicProgressValue {
  currentTime: number
  duration: number
  currentLyricLine: string
}

export interface BlogMusicActionsContextValue {
  tracks: BlogMusicTrack[]
  loading: boolean
  currentTrack: BlogPostMusic | null
  isPlaying: boolean
  muted: boolean
  volume: number
  setVolume: (vol: number) => void
  ambientMode: BlogAmbientMode
  setAmbientMode: (mode: BlogAmbientMode) => void
  palette: BlogAmbientPalette | null
  getAudioEnergy: () => AudioEnergy
  /** Zero-allocation DSP frame (same object every call — read synchronously per RAF). */
  getAudioFrame: () => AudioAnalysisFrame
  immersionOpen: boolean
  openImmersion: () => void
  closeImmersion: () => void
  refreshTracks: () => Promise<void>
  playTrack: (track: BlogPostMusic) => void
  togglePlay: () => void
  toggleMute: () => void
  nextTrack: () => void
  prevTrack: () => void
  seekTo: (seconds: number) => void
  openDrawer: () => void
  openManager: () => void
}

export type BlogMusicStableValue = BlogMusicActionsContextValue

export interface BlogMusicContextValue
  extends BlogMusicActionsContextValue,
    BlogMusicProgressValue {}

const DEFAULT_MUSIC_PROGRESS: BlogMusicProgressValue = {
  currentTime: 0,
  duration: 0,
  currentLyricLine: ''
}

const BLOG_VOLUME_STORAGE_KEY = 'do-it-laaaaaater.blog.volume.v1'
const DEFAULT_BLOG_VOLUME = 0.85

export const BlogMusicContext = createContext<BlogMusicActionsContextValue | null>(null)
export const BlogMusicProgressContext =
  createContext<BlogMusicProgressValue>(DEFAULT_MUSIC_PROGRESS)

const LRC_TIMESTAMP_GLOBAL_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const LRC_TIMESTAMP_STRIP_RE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g

export function parseLrc(lrcText: string): Array<{ time: number; text: string }> {
  if (!lrcText || typeof lrcText !== 'string') return []

  const normalized = lrcText.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const entries: Array<{ time: number; text: string }> = []

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim()
    if (!trimmedLine) continue

    const timestamps: number[] = []
    LRC_TIMESTAMP_GLOBAL_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = LRC_TIMESTAMP_GLOBAL_RE.exec(trimmedLine)) !== null) {
      const minutes = Number(match[1])
      const seconds = Number(match[2])
      const fracPart = match[3] ? Number(`0.${match[3]}`) : 0
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(fracPart)) {
        continue
      }
      const totalSeconds = Math.round((minutes * 60 + seconds + fracPart) * 1000) / 1000
      if (totalSeconds >= 0) {
        timestamps.push(totalSeconds)
      }
    }

    if (timestamps.length === 0) continue

    const lyricText = trimmedLine.replace(LRC_TIMESTAMP_STRIP_RE, '').trim()
    if (!lyricText) continue

    for (const time of timestamps) {
      entries.push({ time, text: lyricText })
    }
  }

  entries.sort((a, b) => a.time - b.time)
  return entries
}

export function useBlogMusicProgress(): BlogMusicProgressValue {
  return useContext(BlogMusicProgressContext)
}

export function useOptionalBlogMusicActions(): BlogMusicActionsContextValue | null {
  return useContext(BlogMusicContext)
}

export function useBlogMusicActions(): BlogMusicActionsContextValue {
  const ctx = useContext(BlogMusicContext)
  if (!ctx) {
    throw new Error('useBlogMusicActions must be used within a BlogMusicProvider')
  }
  return ctx
}

export function useOptionalBlogMusic(): BlogMusicContextValue | null {
  const stable = useContext(BlogMusicContext)
  const progress = useContext(BlogMusicProgressContext)
  return useMemo(() => (stable ? { ...stable, ...progress } : null), [stable, progress])
}

export function useBlogMusic(): BlogMusicContextValue {
  const stable = useContext(BlogMusicContext)
  const progress = useContext(BlogMusicProgressContext)
  if (!stable) {
    throw new Error('useBlogMusic must be used within a BlogMusicProvider')
  }
  return useMemo(() => ({ ...stable, ...progress }), [stable, progress])
}

function readInitialVolume(): number {
  try {
    const raw = globalThis.localStorage?.getItem(BLOG_VOLUME_STORAGE_KEY)
    if (raw !== null && raw !== undefined && raw.trim() !== '') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        return Math.round(parsed * 100) / 100
      }
    }
  } catch {
    // Ignore storage read errors.
  }
  return DEFAULT_BLOG_VOLUME
}

function persistVolume(vol: number): void {
  try {
    globalThis.localStorage?.setItem(BLOG_VOLUME_STORAGE_KEY, String(vol))
  } catch {
    // Ignore storage write errors.
  }
}

function getErrorMessage(err: unknown, fallback = '操作失败，请稍后重试'): string {
  if (err instanceof Error && err.message) return errorMessage(err)
  return fallback
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function trackToPostMusic(track: BlogMusicTrack): BlogPostMusic {
  return {
    trackId: track.id,
    title: track.title,
    artist: track.artist || '',
    coverUrl: track.coverUrl,
    audioUrl: track.audioUrl,
    lrc: track.lrcText || undefined
  }
}

function parseFilenameMeta(filename: string): { title: string; artist: string } {
  const base = filename.replace(/\.[^/.]+$/, '').trim()
  const splitIdx = base.indexOf(' - ')
  if (splitIdx > 0 && splitIdx < base.length - 3) {
    return {
      artist: base.slice(0, splitIdx).trim(),
      title: base.slice(splitIdx + 3).trim()
    }
  }
  return { title: base, artist: '' }
}

function probeLocalAudioDuration(file: File): Promise<number | null> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    let settled = false
    const objectUrl = URL.createObjectURL(file)
    const tempAudio = new Audio()
    tempAudio.preload = 'metadata'

    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      tempAudio.removeAttribute('src')
      URL.revokeObjectURL(objectUrl)
      resolve(value)
    }

    const timer = window.setTimeout(() => finish(null), 3500)
    tempAudio.onloadedmetadata = () => {
      const dur = tempAudio.duration
      finish(Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null)
    }
    tempAudio.onerror = () => finish(null)
    tempAudio.src = objectUrl
  })
}

function readCurrentBlogTheme(): 'light' | 'dark' {
  if (typeof document !== 'undefined') {
    const rootTheme = document.querySelector<HTMLElement>('.blog-root')?.getAttribute('data-blog-theme')
    if (rootTheme === 'dark' || rootTheme === 'light') return rootTheme
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem('do-it-laaaaaater.blog.theme.v1')
      if (stored === 'dark') return 'dark'
      if (stored === 'light') return 'light'
    } catch {
      // Ignore storage access errors.
    }
    try {
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
    } catch {
      // Ignore matchMedia errors.
    }
  }
  return 'light'
}

function useSyncedBlogTheme(active: boolean): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readCurrentBlogTheme())

  useEffect(() => {
    if (!active || typeof document === 'undefined') return
    const sync = () => setTheme(readCurrentBlogTheme())
    sync()

    const rootEl = document.querySelector<HTMLElement>('.blog-root')
    if (!rootEl || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(sync)
    observer.observe(rootEl, { attributes: true, attributeFilter: ['data-blog-theme'] })
    return () => observer.disconnect()
  }, [active])

  return theme
}

function normalizeClipboardImageFile(rawFile: File): File {
  if (rawFile.name && /\.[a-z0-9]{2,5}$/i.test(rawFile.name)) {
    return rawFile
  }
  const mime = (rawFile.type || 'image/png').toLowerCase()
  const ext = mime.includes('gif')
    ? 'gif'
    : mime.includes('webp')
      ? 'webp'
      : mime.includes('jpeg') || mime.includes('jpg')
        ? 'jpg'
        : 'png'
  return new File([rawFile], `pasted-cover-${Date.now()}.${ext}`, { type: mime })
}

/* --------------------------------------------------------------------------
   Apple Music Fullscreen Immersion Stage Modal
   -------------------------------------------------------------------------- */

interface BlogMusicImmersionModalProps {
  open: boolean
  managerOpen: boolean
  isOwner: boolean
  track: BlogPostMusic
  tracks: BlogMusicTrack[]
  isPlaying: boolean
  muted: boolean
  volume: number
  currentTime: number
  effectiveDuration: number
  parsedLyrics: LrcLine[]
  activeLyricIndex: number
  ambientMode: BlogAmbientMode
  palette: BlogAmbientPalette | null
  onClose: () => void
  onSetAmbientMode: (mode: BlogAmbientMode) => void
  onTogglePlay: () => void
  onPrev: () => void
  onNext: () => void
  onSeek: (seconds: number) => void
  onSetVolume: (vol: number) => void
  onToggleMute: () => void
  onPlayTrack: (track: BlogMusicTrack) => void
  onOpenManager: () => void
}

type AnalyserByteArray = Parameters<AnalyserNode['getByteFrequencyData']>[0]

function isSameOriginAudioUrl(rawUrl: string): boolean {
  const cleaned = rawUrl.trim()
  if (!cleaned || typeof window === 'undefined') return false
  if (cleaned.startsWith('/') && !cleaned.startsWith('//')) return true
  if (cleaned.startsWith('blob:') || cleaned.startsWith('data:')) return true
  try {
    const parsed = new URL(cleaned, window.location.origin)
    return parsed.origin === window.location.origin
  } catch {
    return false
  }
}

const AMBIENT_MODE_OPTIONS: ReadonlyArray<{ mode: BlogAmbientMode; label: string }> = [
  { mode: 'waves', label: '声波点阵' },
  { mode: 'silk', label: '丝绸极光' },
  { mode: 'minimal', label: '纯白极简' }
]

function BlogMusicImmersionModal({
  open,
  managerOpen,
  isOwner,
  track,
  tracks,
  isPlaying,
  muted,
  volume,
  currentTime,
  effectiveDuration,
  parsedLyrics,
  activeLyricIndex,
  ambientMode,
  palette,
  onClose,
  onSetAmbientMode,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onSetVolume,
  onToggleMute,
  onPlayTrack,
  onOpenManager
}: BlogMusicImmersionModalProps) {
  const [showPlaylist, setShowPlaylist] = useState(false)
  const lrcScrollRef = useRef<HTMLDivElement | null>(null)
  const activeLineRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) {
      setShowPlaylist(false)
    }
  }, [open])

  // Escape & Space keyboard shortcuts + body scroll lock
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (managerOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === ' ' || event.code === 'Space') {
        const target = event.target as HTMLElement | null
        const tag = target?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') {
          return
        }
        event.preventDefault()
        onTogglePlay()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, managerOpen, onClose, onTogglePlay])

  // Keep active lyric centered inside .blog-immersion-lrc
  useEffect(() => {
    if (!open || showPlaylist) return
    const container = lrcScrollRef.current
    const activeEl = activeLineRef.current
    if (!container || !activeEl) return

    const targetTop =
      activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reducedMotion ? 'auto' : 'smooth'
    })
  }, [open, showPlaylist, activeLyricIndex, track.audioUrl])

  if (!open || typeof document === 'undefined') return null

  const effectivePalette = palette ?? DEFAULT_AMBIENT_PALETTE
  const matchedLibraryTrack = tracks.find(
    (item) => (track.trackId && item.id === track.trackId) || item.audioUrl === track.audioUrl
  )
  const albumLabel = matchedLibraryTrack?.album?.trim() || ''

  const stageStyle = {
    '--immersion-glow-a': effectivePalette.glowA,
    '--immersion-glow-b': effectivePalette.glowB,
    '--immersion-glow-c': effectivePalette.glowC
  } as CSSProperties

  const bgImageStyle: CSSProperties | undefined = track.coverUrl
    ? { backgroundImage: `url("${track.coverUrl.replace(/"/g, '\\"')}")` }
    : undefined

  const clampedTime =
    effectiveDuration > 0 ? Math.min(currentTime, effectiveDuration) : 0
  const seekPercent =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (clampedTime / effectiveDuration) * 100)) : 0
  const displayVol = muted ? 0 : volume
  const volPercent = Math.round(displayVol * 100)

  return createPortal(
    <div
      className={`blog-immersion-stage${isPlaying ? ' is-playing' : ''}`}
      style={stageStyle}
      role="dialog"
      aria-modal="true"
      aria-label="全屏沉浸音乐舞台"
    >
      {/* Dynamic Blurred Rotating Cover Wallpaper */}
      <div className="blog-immersion-bg" aria-hidden="true">
        <div className="blog-immersion-bg-layer blog-immersion-bg-a" style={bgImageStyle} />
        <div className="blog-immersion-bg-layer blog-immersion-bg-b" style={bgImageStyle} />
        <div className="blog-immersion-bg-scrim" />
      </div>

      {/* Top Bar: Ambient Mode Switcher Pills + Close */}
      <header className="blog-immersion-topbar">
        <div className="blog-immersion-mode-pills" role="group" aria-label="背景氛围模式">
          {AMBIENT_MODE_OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              className={`blog-immersion-mode-pill${ambientMode === opt.mode ? ' is-active' : ''}`}
              aria-pressed={ambientMode === opt.mode}
              onClick={() => onSetAmbientMode(opt.mode)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="blog-immersion-top-actions">
          {isOwner && (
            <button
              type="button"
              className="blog-immersion-close-btn"
              onClick={onOpenManager}
              title="管理歌单"
            >
              <AppIcon name="settings" size={14} />
              <span>管理歌单</span>
            </button>
          )}
          <button
            type="button"
            className="blog-immersion-close-btn"
            onClick={onClose}
            aria-label="关闭全屏歌词"
          >
            <span className="blog-immersion-esc-kbd">Esc</span>
            <AppIcon name="close" size={15} />
          </button>
        </div>
      </header>

      {/* Main 2-Column Stage: Floating Album Art (Left) + Large Scrolling LRC (Right) */}
      <div className="blog-immersion-main">
        <div className="blog-immersion-art-col">
          <div className={`blog-immersion-artwork${isPlaying ? ' is-playing' : ''}`}>
            {track.coverUrl ? (
              <img src={track.coverUrl} alt={track.title} />
            ) : (
              <AppIcon name="music" size={64} />
            )}
          </div>

          <div className="blog-immersion-track-info">
            <h2 className="blog-immersion-title" title={track.title}>
              {track.title}
            </h2>
            <p className="blog-immersion-artist">
              {track.artist || '未知歌手'}
              {albumLabel ? ` · ${albumLabel}` : ''}
            </p>
          </div>
        </div>

        <div className="blog-immersion-lyrics-col">
          {showPlaylist && tracks.length > 0 ? (
            <div className="blog-immersion-playlist-panel" aria-label="播放列表">
              <div className="blog-immersion-playlist-head">
                <span>播放列表（{tracks.length} 首）</span>
                <button
                  type="button"
                  className="blog-immersion-mode-pill"
                  onClick={() => setShowPlaylist(false)}
                >
                  返回歌词
                </button>
              </div>
              {tracks.map((item, idx) => {
                const active =
                  track.trackId === item.id || track.audioUrl === item.audioUrl
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`blog-immersion-playlist-item${active ? ' is-active' : ''}`}
                    onClick={() => {
                      if (active) onTogglePlay()
                      else onPlayTrack(item)
                    }}
                  >
                    <span
                      style={{
                        width: 24,
                        fontFamily: 'var(--blog-font-mono, monospace)',
                        fontSize: 12,
                        opacity: 0.72
                      }}
                    >
                      {active && isPlaying ? '♪' : String(idx + 1).padStart(2, '0')}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {item.title}
                    </span>
                    <span
                      style={{
                        maxWidth: 160,
                        fontSize: 12.5,
                        opacity: 0.68,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {item.artist || '未知歌手'}
                    </span>
                    {item.durationSec ? (
                      <span
                        style={{
                          fontFamily: 'var(--blog-font-mono, monospace)',
                          fontSize: 11.5,
                          opacity: 0.65
                        }}
                      >
                        {formatAudioTime(item.durationSec)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : (
            <div ref={lrcScrollRef} className="blog-immersion-lrc" aria-label="沉浸式同步歌词">
              {parsedLyrics.length === 0 ? (
                <div className="blog-immersion-lrc-empty">
                  <AppIcon name="music" size={28} />
                  <span>纯音乐或暂无 LRC 同步歌词</span>
                </div>
              ) : (
                parsedLyrics.map((line, idx) => {
                  const isActive = idx === activeLyricIndex
                  const distance =
                    activeLyricIndex >= 0 ? Math.abs(idx - activeLyricIndex) : idx + 1
                  const tierClass = isActive
                    ? 'is-active'
                    : distance <= 2
                      ? 'is-near'
                      : 'is-far'

                  return (
                    <button
                      key={`${line.time}-${idx}`}
                      ref={isActive ? activeLineRef : null}
                      type="button"
                      className={`blog-immersion-lrc-line ${tierClass}`}
                      onClick={() => {
                        onSeek(line.time)
                        if (!isPlaying) onTogglePlay()
                      }}
                    >
                      {line.text}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Frosted Glass Transport Bar */}
      <footer className="blog-immersion-bottombar">
        <div className="blog-immersion-scrubber-row">
          <span className="blog-immersion-time">{formatAudioTime(currentTime)}</span>
          <input
            type="range"
            className="blog-immersion-scrubber"
            min={0}
            max={effectiveDuration > 0 ? effectiveDuration : 100}
            step={0.1}
            value={clampedTime}
            disabled={effectiveDuration <= 0}
            style={{ '--seek-pct': `${seekPercent.toFixed(2)}%` } as CSSProperties}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="播放进度"
          />
          <span className="blog-immersion-time is-end">{formatAudioTime(effectiveDuration)}</span>
        </div>

        <div className="blog-immersion-controls-row">
          <div className="blog-volume-row blog-immersion-vol-wrap">
            <button
              type="button"
              className="blog-volume-mute-btn"
              onClick={onToggleMute}
              title={muted || volume === 0 ? '取消静音' : '静音'}
              aria-label={muted || volume === 0 ? '取消静音' : '静音'}
            >
              <AppIcon name={muted || volume === 0 ? 'volumeOff' : 'volume'} size={16} />
            </button>
            <input
              type="range"
              className="blog-volume-slider"
              min={0}
              max={1}
              step={0.01}
              value={displayVol}
              style={{ '--vol-pct': `${volPercent}%` } as CSSProperties}
              onChange={(e) => onSetVolume(Number(e.target.value))}
              aria-label="音量调节"
            />
          </div>

          <div className="blog-immersion-transport">
            <button
              type="button"
              className="blog-immersion-ctrl-btn"
              onClick={onPrev}
              title="上一首"
              aria-label="上一首"
            >
              <AppIcon name="skipBack" size={18} />
            </button>
            <button
              type="button"
              className="blog-immersion-play-btn"
              onClick={onTogglePlay}
              title={isPlaying ? '暂停' : '播放'}
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              <AppIcon name={isPlaying ? 'pause' : 'play'} size={20} />
            </button>
            <button
              type="button"
              className="blog-immersion-ctrl-btn"
              onClick={onNext}
              title="下一首"
              aria-label="下一首"
            >
              <AppIcon name="skipForward" size={18} />
            </button>
          </div>

          <div className="blog-immersion-right-tools">
            {tracks.length > 0 && (
              <button
                type="button"
                className={`blog-immersion-playlist-btn${showPlaylist ? ' is-active' : ''}`}
                aria-pressed={showPlaylist}
                onClick={() => setShowPlaylist((prev) => !prev)}
              >
                <AppIcon name="list" size={14} />
                <span>歌单 {tracks.length}</span>
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>,
    document.body
  )
}

/* --------------------------------------------------------------------------
   Owner Playlist Manager Modal (Auto Embedded Cover/Tag Extraction + Ctrl+V)
   -------------------------------------------------------------------------- */

interface BlogMusicManagerModalProps {
  open: boolean
  blogTheme: 'light' | 'dark'
  tracks: BlogMusicTrack[]
  currentTrack: BlogPostMusic | null
  isPlaying: boolean
  onClose: () => void
  onPlayPreview: (track: BlogMusicTrack) => void
  onTogglePlay: () => void
  onTracksChanged: () => Promise<void>
}

function BlogMusicManagerModal({
  open,
  blogTheme,
  tracks,
  currentTrack,
  isPlaying,
  onClose,
  onPlayPreview,
  onTogglePlay,
  onTracksChanged
}: BlogMusicManagerModalProps) {
  // Add Track form states
  const [audioMediaId, setAudioMediaId] = useState('')
  const [audioFilename, setAudioFilename] = useState('')
  const [durationSec, setDurationSec] = useState<number | null>(null)
  const [coverMediaId, setCoverMediaId] = useState<string | null>(null)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [embeddedCoverFile, setEmbeddedCoverFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [lrcText, setLrcText] = useState('')

  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [parsingMeta, setParsingMeta] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')

  // Existing track inline editor states
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editArtist, setEditArtist] = useState('')
  const [editAlbum, setEditAlbum] = useState('')
  const [editLrcText, setEditLrcText] = useState('')
  const [editCoverMediaId, setEditCoverMediaId] = useState<string | null>(null)
  const [editCoverUrl, setEditCoverUrl] = useState<string | null>(null)
  const [uploadingEditCover, setUploadingEditCover] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null)

  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const lrcFileInputRef = useRef<HTMLInputElement | null>(null)
  const editCoverInputRef = useRef<HTMLInputElement | null>(null)
  const editLrcFileInputRef = useRef<HTMLInputElement | null>(null)

  // Track object URLs created by embedded cover extraction so we revoke them cleanly
  const blobUrlRef = useRef<string | null>(null)
  // Remember values auto-populated from previous audio selection so selecting a new file refreshes them cleanly
  const autoPopulatedRef = useRef<{
    title: string
    artist: string
    album: string
    lrcText: string
  }>({ title: '', artist: '', album: '', lrcText: '' })

  const revokeActiveBlobUrl = useCallback(() => {
    if (blobUrlRef.current && typeof URL !== 'undefined') {
      try {
        URL.revokeObjectURL(blobUrlRef.current)
      } catch {
        // Ignore revoke errors.
      }
      blobUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      revokeActiveBlobUrl()
    }
  }, [revokeActiveBlobUrl])

  const busy =
    uploadingAudio ||
    parsingMeta ||
    uploadingCover ||
    creating ||
    savingEdit ||
    uploadingEditCover

  useEffect(() => {
    if (!open) return
    setFormError('')
    setEditingId(null)
  }, [open])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, busy, onClose])

  const uploadCoverImageFile = useCallback(
    async (rawFile: File, target: 'create' | 'edit', fromPaste = false) => {
      const normalizedFile = normalizeClipboardImageFile(rawFile)
      if (target === 'edit') {
        setUploadingEditCover(true)
        try {
          const [uploaded] = await uploadBlogMedia([normalizedFile])
          if (uploaded) {
            setEditCoverMediaId(uploaded.id)
            setEditCoverUrl(uploaded.thumbUrl || uploaded.url)
            showToast('success', fromPaste ? '已粘贴并更新封面' : '封面已上传')
          }
        } catch (err) {
          showToast('error', getErrorMessage(err, '封面上传失败'))
        } finally {
          setUploadingEditCover(false)
        }
        return
      }

      setUploadingCover(true)
      setFormError('')
      try {
        const [uploaded] = await uploadBlogMedia([normalizedFile])
        if (uploaded) {
          revokeActiveBlobUrl()
          setEmbeddedCoverFile(null)
          setCoverMediaId(uploaded.id)
          setCoverPreviewUrl(uploaded.thumbUrl || uploaded.url)
          showToast('success', fromPaste ? '已粘贴并上传专辑封面' : '封面已上传')
        }
      } catch (err) {
        const msg = getErrorMessage(err, '封面上传失败')
        setFormError(msg)
        showToast('error', msg)
      } finally {
        setUploadingCover(false)
      }
    },
    [revokeActiveBlobUrl]
  )

  // Clipboard Ctrl+V image / GIF cover paste listener
  useEffect(() => {
    if (!open || typeof document === 'undefined') return

    const onPaste = (event: ClipboardEvent) => {
      if (busy) return
      const clipboard = event.clipboardData
      if (!clipboard) return

      let pastedImage: File | null = null
      if (clipboard.items && clipboard.items.length > 0) {
        for (let i = 0; i < clipboard.items.length; i += 1) {
          const item = clipboard.items[i]
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            pastedImage = item.getAsFile()
            if (pastedImage) break
          }
        }
      }
      if (!pastedImage && clipboard.files && clipboard.files.length > 0) {
        for (let i = 0; i < clipboard.files.length; i += 1) {
          const candidate = clipboard.files[i]
          if (candidate.type.startsWith('image/')) {
            pastedImage = candidate
            break
          }
        }
      }

      if (!pastedImage) return
      event.preventDefault()
      void uploadCoverImageFile(pastedImage, editingId ? 'edit' : 'create', true)
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [open, busy, editingId, uploadCoverImageFile])

  const resetAddForm = () => {
    revokeActiveBlobUrl()
    setAudioMediaId('')
    setAudioFilename('')
    setDurationSec(null)
    setCoverMediaId(null)
    setCoverPreviewUrl(null)
    setEmbeddedCoverFile(null)
    setTitle('')
    setArtist('')
    setAlbum('')
    setLrcText('')
    setFormError('')
    autoPopulatedRef.current = { title: '', artist: '', album: '', lrcText: '' }
  }

  const handleAudioFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadingAudio(true)
    setParsingMeta(true)
    setFormError('')

    const inferred = parseFilenameMeta(file.name)

    // Start browser-side ID3 / Vorbis / MP4 tag & embedded cover extraction immediately
    const metaPromise = extractAudioMetadata(file)
      .then((extracted) => {
        const prevAuto = autoPopulatedRef.current

        const nextTitle = extracted.title || inferred.title || '未命名单曲'
        setTitle((prev) => {
          if (!prev.trim() || prev === prevAuto.title) {
            autoPopulatedRef.current.title = nextTitle
            return nextTitle
          }
          return prev
        })

        const nextArtist = extracted.artist || inferred.artist
        if (nextArtist) {
          setArtist((prev) => {
            if (!prev.trim() || prev === prevAuto.artist) {
              autoPopulatedRef.current.artist = nextArtist
              return nextArtist
            }
            return prev
          })
        }

        if (extracted.album) {
          setAlbum((prev) => {
            if (!prev.trim() || prev === prevAuto.album) {
              autoPopulatedRef.current.album = extracted.album
              return extracted.album
            }
            return prev
          })
        }

        if (extracted.lrcText) {
          setLrcText((prev) => {
            if (!prev.trim() || prev === prevAuto.lrcText) {
              autoPopulatedRef.current.lrcText = extracted.lrcText
              return extracted.lrcText
            }
            return prev
          })
        }

        if (extracted.durationSec) {
          setDurationSec(extracted.durationSec)
        }

        // Apply embedded album cover preview if user hasn't uploaded a custom cover
        if (extracted.coverFile && extracted.coverPreviewUrl) {
          setCoverMediaId((currentCustomId) => {
            if (currentCustomId) {
              if (typeof URL !== 'undefined') {
                try {
                  URL.revokeObjectURL(extracted.coverPreviewUrl!)
                } catch {
                  // Ignore revoke errors.
                }
              }
              return currentCustomId
            }
            revokeActiveBlobUrl()
            blobUrlRef.current = extracted.coverPreviewUrl
            setEmbeddedCoverFile(extracted.coverFile)
            setCoverPreviewUrl(extracted.coverPreviewUrl)
            return null
          })
        } else if (extracted.coverPreviewUrl && typeof URL !== 'undefined') {
          try {
            URL.revokeObjectURL(extracted.coverPreviewUrl)
          } catch {
            // Ignore revoke errors.
          }
        }

        return extracted
      })
      .finally(() => {
        setParsingMeta(false)
      })

    try {
      const [uploaded, detectedDuration, extracted] = await Promise.all([
        uploadBlogFile(file, 'audio'),
        probeLocalAudioDuration(file),
        metaPromise
      ])
      setAudioMediaId(uploaded.id)
      setAudioFilename(file.name)
      setDurationSec(extracted.durationSec ?? detectedDuration)
      showToast(
        'success',
        extracted.coverFile ? '音频已上传，已自动提取内嵌封面与标签' : '音频已上传至 R2'
      )
    } catch (err) {
      const msg = getErrorMessage(err, '音频上传失败')
      setFormError(msg)
      showToast('error', msg)
    } finally {
      setUploadingAudio(false)
    }
  }

  const handleCoverFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await uploadCoverImageFile(file, 'create', false)
  }

  const handleImportLrcFile = async (
    event: ChangeEvent<HTMLInputElement>,
    target: 'create' | 'edit'
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      if (target === 'create') {
        setLrcText(text)
      } else {
        setEditLrcText(text)
      }
      const lineCount = parseLrc(text).length
      showToast('success', lineCount > 0 ? `已导入 ${lineCount} 行同步歌词` : '歌词文件已读取')
    } catch {
      showToast('error', '读取 .lrc 文件失败')
    }
  }

  const handleCreateTrack = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!audioMediaId) {
      setFormError('请先上传音频文件')
      return
    }
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setFormError('请填写歌曲标题')
      return
    }

    setCreating(true)
    setFormError('')
    try {
      let resolvedCoverMediaId = coverMediaId
      if (!resolvedCoverMediaId && embeddedCoverFile) {
        const [uploadedEmbedded] = await uploadBlogMedia([embeddedCoverFile])
        if (uploadedEmbedded) {
          resolvedCoverMediaId = uploadedEmbedded.id
        }
      }

      const nextSortOrder =
        tracks.length > 0 ? Math.max(...tracks.map((item) => item.sortOrder)) + 1 : 0
      await createBlogMusicTrack({
        title: cleanTitle,
        artist: artist.trim(),
        album: album.trim(),
        audioMediaId,
        coverMediaId: resolvedCoverMediaId,
        lrcText: lrcText.trim(),
        durationSec,
        sortOrder: nextSortOrder
      })
      await onTracksChanged()
      resetAddForm()
      showToast('success', '已添加到博客歌单')
    } catch (err) {
      const msg = getErrorMessage(err, '创建歌曲失败')
      setFormError(msg)
      showToast('error', msg)
    } finally {
      setCreating(false)
    }
  }

  const startEditTrack = (track: BlogMusicTrack) => {
    setEditingId(track.id)
    setEditTitle(track.title)
    setEditArtist(track.artist)
    setEditAlbum(track.album)
    setEditLrcText(track.lrcText)
    setEditCoverMediaId(track.coverMediaId)
    setEditCoverUrl(track.coverUrl)
  }

  const handleEditCoverChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await uploadCoverImageFile(file, 'edit', false)
  }

  const handleSaveEdit = async (trackId: string) => {
    if (!editTitle.trim() || savingEdit) return
    setSavingEdit(true)
    try {
      await updateBlogMusicTrack(trackId, {
        title: editTitle.trim(),
        artist: editArtist.trim(),
        album: editAlbum.trim(),
        coverMediaId: editCoverMediaId,
        lrcText: editLrcText.trim()
      })
      await onTracksChanged()
      setEditingId(null)
      showToast('success', '歌曲信息已更新')
    } catch (err) {
      showToast('error', getErrorMessage(err, '保存修改失败'))
    } finally {
      setSavingEdit(false)
    }
  }

  const handleMoveTrack = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= tracks.length || busyTrackId) return

    const current = tracks[index]
    const neighbor = tracks[targetIndex]
    setBusyTrackId(current.id)
    try {
      const reordered = [...tracks]
      reordered[index] = neighbor
      reordered[targetIndex] = current
      await Promise.all(
        reordered.map((item, idx) =>
          item.sortOrder !== idx
            ? updateBlogMusicTrack(item.id, { sortOrder: idx })
            : Promise.resolve(item)
        )
      )
      await onTracksChanged()
    } catch (err) {
      showToast('error', getErrorMessage(err, '调整排序失败'))
    } finally {
      setBusyTrackId(null)
    }
  }

  const handleDeleteTrack = async (track: BlogMusicTrack) => {
    if (busyTrackId) return
    if (!window.confirm(`确定要从歌单删除「${track.title}」吗？`)) return

    setBusyTrackId(track.id)
    try {
      await deleteBlogMusicTrack(track.id)
      if (editingId === track.id) setEditingId(null)
      await onTracksChanged()
      showToast('success', '歌曲已删除')
    } catch (err) {
      showToast('error', getErrorMessage(err, '删除歌曲失败'))
    } finally {
      setBusyTrackId(null)
    }
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="blog-root blog-modal-backdrop"
      data-blog-theme={blogTheme}
      style={{ minHeight: 0, zIndex: 1030 }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose()
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="管理博客歌单"
        className="blog-p2-manager-modal"
      >
        <header className="blog-modal-header">
          <h2
            className="blog-modal-title"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <AppIcon name="music" size={17} />
            <span>管理博客歌单</span>
            <span className="blog-floor-count">{tracks.length}</span>
          </h2>
          <button
            type="button"
            className="blog-btn blog-btn-icon"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <AppIcon name="close" size={16} />
          </button>
        </header>

        <div className="blog-modal-body">
          {/* Add New Track Form */}
          <form className="blog-p2-manager-form" onSubmit={(e) => void handleCreateTrack(e)}>
            <div
              className="blog-p2-manager-section-title"
              style={{ justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AppIcon name="plus" size={14} />
                <span>上传新单曲（R2 原生音频流 + 自动提取内嵌封面/标签）</span>
              </span>
              <span className="blog-paste-hint">支持 Ctrl+V 粘贴图片/GIF</span>
            </div>

            <div className="blog-p2-manager-upload-row">
              <div className="blog-p2-manager-cover-slot">
                {coverPreviewUrl ? (
                  <img src={coverPreviewUrl} alt="封面预览" />
                ) : (
                  <AppIcon name="music" size={22} />
                )}
              </div>

              <div className="blog-p2-manager-upload-actions">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="blog-btn blog-btn-subtle blog-btn-sm"
                    disabled={uploadingAudio || creating}
                    onClick={() => audioInputRef.current?.click()}
                  >
                    <AppIcon name="upload" size={14} />
                    <span>
                      {uploadingAudio
                        ? '上传音频中…'
                        : audioMediaId
                          ? '重新选择音频'
                          : '上传音频 *'}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="blog-btn blog-btn-subtle blog-btn-sm"
                    disabled={uploadingCover || creating}
                    onClick={() => coverInputRef.current?.click()}
                  >
                    <AppIcon name="image" size={14} />
                    <span>{uploadingCover ? '上传封面中…' : '上传封面'}</span>
                  </button>

                  {coverPreviewUrl && (
                    <button
                      type="button"
                      className="blog-btn blog-btn-ghost blog-btn-sm"
                      disabled={creating}
                      onClick={() => {
                        revokeActiveBlobUrl()
                        setEmbeddedCoverFile(null)
                        setCoverMediaId(null)
                        setCoverPreviewUrl(null)
                      }}
                    >
                      清除封面
                    </button>
                  )}
                </div>

                {parsingMeta ? (
                  <span className="blog-audio-meta-status">
                    <AppIcon name="sparkles" size={13} />
                    <span>正在解析歌曲封面与标签…</span>
                  </span>
                ) : (
                  <span className="blog-field-hint">
                    {audioFilename
                      ? `已就绪：${audioFilename}${durationSec ? ` (${formatAudioTime(durationSec)})` : ''}${
                          embeddedCoverFile && !coverMediaId ? ' · 已提取内嵌专辑封面' : ''
                        }`
                      : '支持 MP3 / M4A / WAV / OGG / FLAC / WebM（最大 40 MB），封面支持 PNG / JPG / WebP / GIF'}
                  </span>
                )}
              </div>

              <input
                ref={audioInputRef}
                type="file"
                accept=".mp3,.m4a,.wav,.ogg,.flac,.webm,audio/*"
                hidden
                onChange={(e) => void handleAudioFileChange(e)}
              />
              <input
                ref={coverInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => void handleCoverFileChange(e)}
              />
            </div>

            <div className="blog-composer-grid">
              <label className="blog-field">
                <span className="blog-field-label">歌曲标题 *</span>
                <input
                  type="text"
                  className="blog-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="上传音频后自动填充"
                />
              </label>

              <label className="blog-field">
                <span className="blog-field-label">歌手 / 创作者</span>
                <input
                  type="text"
                  className="blog-input"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="例如：坂本龙一"
                />
              </label>
            </div>

            <label className="blog-field">
              <span className="blog-field-label">所属专辑（选填）</span>
              <input
                type="text"
                className="blog-input"
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                placeholder="例如：Merry Christmas Mr. Lawrence"
              />
            </label>

            <div className="blog-field">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8
                }}
              >
                <span className="blog-field-label">LRC 同步歌词（选填）</span>
                <button
                  type="button"
                  className="blog-btn blog-btn-ghost blog-btn-sm"
                  disabled={creating}
                  onClick={() => lrcFileInputRef.current?.click()}
                >
                  <AppIcon name="upload" size={13} />
                  <span>导入 .lrc 文件</span>
                </button>
                <input
                  ref={lrcFileInputRef}
                  type="file"
                  accept=".lrc,.txt,text/plain"
                  hidden
                  onChange={(e) => void handleImportLrcFile(e, 'create')}
                />
              </div>
              <textarea
                className="blog-textarea"
                rows={4}
                value={lrcText}
                onChange={(e) => setLrcText(e.target.value)}
                placeholder={
                  '支持粘贴标准 LRC 时间轴，例如：\n[00:12.30] 第一句歌词\n[00:18.65] 第二句歌词'
                }
                style={{ fontFamily: 'var(--blog-font-mono)', fontSize: 12.5, minHeight: 88 }}
              />
            </div>

            {formError && (
              <div className="blog-p2-inline-alert" role="alert">
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {(audioMediaId || title || artist || album || lrcText || coverPreviewUrl) && (
                <button
                  type="button"
                  className="blog-btn blog-btn-ghost blog-btn-sm"
                  disabled={busy}
                  onClick={resetAddForm}
                >
                  清空表单
                </button>
              )}
              <button
                type="submit"
                className="blog-btn blog-btn-primary blog-btn-sm"
                disabled={busy || !audioMediaId}
              >
                <AppIcon name="plus" size={14} />
                <span>{creating ? '保存中…' : '加入歌单'}</span>
              </button>
            </div>
          </form>

          {/* Existing Playlist Tracks */}
          <div className="blog-field">
            <span className="blog-field-label">当前歌单曲目（{tracks.length} 首）</span>

            {tracks.length === 0 ? (
              <div className="blog-p2-empty-hint">
                歌单还是空的，上传第一首歌后访客即可在全站左下角边听边逛。
              </div>
            ) : (
              <div className="blog-p2-track-list">
                {tracks.map((track, idx) => {
                  const isCurrent =
                    currentTrack?.trackId === track.id ||
                    currentTrack?.audioUrl === track.audioUrl
                  const activePlaying = isCurrent && isPlaying
                  const isEditing = editingId === track.id
                  const rowBusy = busyTrackId === track.id

                  return (
                    <div
                      key={track.id}
                      className={`blog-p2-track-item-wrap${isCurrent ? ' is-current' : ''}`}
                    >
                      <div className={`blog-p2-track-row${isCurrent ? ' is-active' : ''}`}>
                        <button
                          type="button"
                          className="blog-p2-track-play-btn"
                          onClick={() => {
                            if (isCurrent) onTogglePlay()
                            else onPlayPreview(track)
                          }}
                          title={activePlaying ? '暂停预览' : '播放预览'}
                          aria-label={activePlaying ? '暂停预览' : '播放预览'}
                        >
                          {track.coverUrl ? (
                            <img src={track.coverUrl} alt={track.title} />
                          ) : (
                            <span className="blog-p2-track-index">{idx + 1}</span>
                          )}
                          <span className="blog-p2-track-play-overlay">
                            <AppIcon name={activePlaying ? 'pause' : 'play'} size={13} />
                          </span>
                        </button>

                        <div className="blog-p2-track-meta">
                          <div className="blog-p2-track-name">
                            <span>{track.title}</span>
                            {track.lrcText.trim() && (
                              <span className="blog-p2-lrc-tag">LRC</span>
                            )}
                          </div>
                          <div className="blog-p2-track-sub">
                            {track.artist || '未知歌手'}
                            {track.album ? ` · ${track.album}` : ''}
                            {track.durationSec ? ` · ${formatAudioTime(track.durationSec)}` : ''}
                          </div>
                        </div>

                        <div className="blog-p2-track-actions">
                          <button
                            type="button"
                            className="blog-btn blog-btn-icon blog-btn-sm"
                            disabled={idx === 0 || Boolean(busyTrackId)}
                            onClick={() => void handleMoveTrack(idx, -1)}
                            title="上移"
                            aria-label="上移"
                          >
                            <AppIcon name="arrowUp" size={14} />
                          </button>
                          <button
                            type="button"
                            className="blog-btn blog-btn-icon blog-btn-sm"
                            disabled={idx === tracks.length - 1 || Boolean(busyTrackId)}
                            onClick={() => void handleMoveTrack(idx, 1)}
                            title="下移"
                            aria-label="下移"
                          >
                            <AppIcon name="chevronDown" size={14} />
                          </button>
                          <button
                            type="button"
                            className="blog-btn blog-btn-icon blog-btn-sm"
                            disabled={rowBusy}
                            onClick={() => (isEditing ? setEditingId(null) : startEditTrack(track))}
                            title="编辑信息与歌词"
                            aria-label="编辑信息与歌词"
                          >
                            <AppIcon name="edit" size={14} />
                          </button>
                          <button
                            type="button"
                            className="blog-btn blog-btn-icon blog-btn-sm blog-btn-danger"
                            disabled={rowBusy}
                            onClick={() => void handleDeleteTrack(track)}
                            title="删除"
                            aria-label="删除"
                          >
                            <AppIcon name="trash" size={14} />
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="blog-p2-track-edit-box">
                          <div className="blog-composer-grid">
                            <label className="blog-field">
                              <span className="blog-field-label">标题 *</span>
                              <input
                                type="text"
                                className="blog-input"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                              />
                            </label>
                            <label className="blog-field">
                              <span className="blog-field-label">歌手</span>
                              <input
                                type="text"
                                className="blog-input"
                                value={editArtist}
                                onChange={(e) => setEditArtist(e.target.value)}
                              />
                            </label>
                          </div>

                          <div className="blog-composer-grid" style={{ alignItems: 'end' }}>
                            <label className="blog-field">
                              <span className="blog-field-label">专辑</span>
                              <input
                                type="text"
                                className="blog-input"
                                value={editAlbum}
                                onChange={(e) => setEditAlbum(e.target.value)}
                              />
                            </label>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                flexWrap: 'wrap'
                              }}
                            >
                              <button
                                type="button"
                                className="blog-btn blog-btn-subtle blog-btn-sm"
                                disabled={uploadingEditCover}
                                onClick={() => editCoverInputRef.current?.click()}
                              >
                                <AppIcon name="image" size={13} />
                                <span>{uploadingEditCover ? '上传中…' : '更换封面'}</span>
                              </button>
                              {editCoverUrl && (
                                <button
                                  type="button"
                                  className="blog-btn blog-btn-ghost blog-btn-sm"
                                  onClick={() => {
                                    setEditCoverMediaId(null)
                                    setEditCoverUrl(null)
                                  }}
                                >
                                  移除封面
                                </button>
                              )}
                              <span className="blog-paste-hint">支持 Ctrl+V</span>
                              <input
                                ref={editCoverInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                hidden
                                onChange={(e) => void handleEditCoverChange(e)}
                              />
                            </div>
                          </div>

                          <div className="blog-field">
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                              }}
                            >
                              <span className="blog-field-label">LRC 歌词</span>
                              <button
                                type="button"
                                className="blog-btn blog-btn-ghost blog-btn-sm"
                                onClick={() => editLrcFileInputRef.current?.click()}
                              >
                                <AppIcon name="upload" size={12} />
                                <span>导入 .lrc</span>
                              </button>
                              <input
                                ref={editLrcFileInputRef}
                                type="file"
                                accept=".lrc,.txt,text/plain"
                                hidden
                                onChange={(e) => void handleImportLrcFile(e, 'edit')}
                              />
                            </div>
                            <textarea
                              className="blog-textarea"
                              rows={4}
                              value={editLrcText}
                              onChange={(e) => setEditLrcText(e.target.value)}
                              style={{ fontFamily: 'var(--blog-font-mono)', fontSize: 12 }}
                            />
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <button
                              type="button"
                              className="blog-btn blog-btn-ghost blog-btn-sm"
                              disabled={savingEdit}
                              onClick={() => setEditingId(null)}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="blog-btn blog-btn-primary blog-btn-sm"
                              disabled={savingEdit || !editTitle.trim()}
                              onClick={() => void handleSaveEdit(track.id)}
                            >
                              <AppIcon name="check" size={13} />
                              <span>{savingEdit ? '保存中…' : '保存修改'}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="blog-modal-footer">
          <span className="blog-field-hint">页面切换时播放器持续不断流</span>
          <button
            type="button"
            className="blog-btn blog-btn-subtle"
            disabled={busy}
            onClick={onClose}
          >
            完成
          </button>
        </footer>
      </section>
    </div>,
    document.body
  )
}

/* --------------------------------------------------------------------------
   Global Music Provider
   -------------------------------------------------------------------------- */

export function BlogMusicProvider({
  isOwner,
  hasBottomBar = false,
  desktopRailActive = false,
  initialTracks,
  deferInitialFetch = false,
  children
}: {
  isOwner: boolean
  hasBottomBar?: boolean
  desktopRailActive?: boolean
  initialTracks?: BlogMusicTrack[]
  deferInitialFetch?: boolean
  children: ReactNode
}) {
  const [tracks, setTracks] = useState<BlogMusicTrack[]>(() =>
    Array.isArray(initialTracks) ? initialTracks : []
  )
  const [loading, setLoading] = useState<boolean>(() => !Array.isArray(initialTracks))
  const [currentTrack, setCurrentTrack] = useState<BlogPostMusic | null>(() =>
    Array.isArray(initialTracks) && initialTracks.length > 0
      ? trackToPostMusic(initialTracks[0])
      : null
  )
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolumeState] = useState<number>(() => readInitialVolume())
  const [ambientMode, setAmbientModeState] = useState<BlogAmbientMode>(() => readAmbientMode())
  const [palette, setPalette] = useState<BlogAmbientPalette | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [immersionOpen, setImmersionOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const freqDataRef = useRef<AnalyserByteArray | null>(null)
  const timeDataRef = useRef<AnalyserByteArray | null>(null)
  const frameAnalyzerRef = useRef<AudioFrameAnalyzer | null>(null)
  const lastFrameAtRef = useRef(0)
  const corsBlockedUrlsRef = useRef<Set<string>>(new Set())
  const audioGraphFailedRef = useRef(false)
  const lrcBoxRef = useRef<HTMLDivElement | null>(null)
  const activeLrcLineRef = useRef<HTMLButtonElement | null>(null)
  const pendingAutoPlayRef = useRef(false)
  const userInitiatedRef = useRef(false)
  const hydratedInitialRef = useRef<boolean>(Array.isArray(initialTracks))
  const manualRefreshCountRef = useRef(0)
  const durationRef = useRef(0)
  durationRef.current = duration
  const lastNonZeroVolumeRef = useRef<number>(volume > 0 ? volume : DEFAULT_BLOG_VOLUME)

  useEffect(() => {
    return () => {
      const ctx = audioCtxRef.current
      audioCtxRef.current = null
      analyserRef.current = null
      sourceNodeRef.current = null
      freqDataRef.current = null
      timeDataRef.current = null
      if (ctx && ctx.state !== 'closed') {
        void ctx.close().catch(() => {
          // Ignore AudioContext close errors on unmount.
        })
      }
    }
  }, [])

  /** Must be invoked synchronously inside user gestures (play / track click) for autoplay policies. */
  const resumeAudioContext = useCallback(() => {
    const ctx = audioCtxRef.current
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        // Audio playback itself must never fail if WebAudio resume is blocked.
      })
    }
  }, [])

  // Browsers may (re)suspend the context (autoplay policy, iOS interruptions, device switches):
  // resume on the next genuine user gesture while music is playing so analysis never silently dies.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onGesture = () => {
      const ctx = audioCtxRef.current
      const audio = audioRef.current
      if (ctx && ctx.state === 'suspended' && audio && !audio.paused) {
        void ctx.resume().catch(() => {
          // Ignore resume rejections; the next gesture retries.
        })
      }
    }
    document.addEventListener('pointerdown', onGesture, { capture: true, passive: true })
    document.addEventListener('keydown', onGesture, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onGesture, { capture: true })
      document.removeEventListener('keydown', onGesture, { capture: true })
    }
  }, [])

  const ensureAudioAnalyser = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audioGraphFailedRef.current || typeof window === 'undefined') return

    if (audioCtxRef.current) {
      resumeAudioContext()
      return
    }
    if (sourceNodeRef.current) return

    const activeSrc = audio.currentSrc || audio.getAttribute('src') || audio.src || ''
    if (!activeSrc) return

    // A MediaElementSource fed by a non-CORS cross-origin response outputs pure silence
    // (tainted media) — only build the graph once the element is provably capturable.
    const canCapture = isSameOriginAudioUrl(activeSrc) || audio.crossOrigin === 'anonymous'
    if (!canCapture) return

    try {
      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtxCtor) return

      const ctx = new AudioCtxCtor()
      const analyser = ctx.createAnalyser()
      // 2048-point FFT (~21.5 Hz bins @ 44.1 kHz) — enough resolution for real kick / bass /
      // vocal / cymbal separation (the old 128-point FFT lumped 0–1.7 kHz into "bass").
      analyser.fftSize = AUDIO_ANALYSER_FFT_SIZE
      analyser.smoothingTimeConstant = AUDIO_ANALYSER_SMOOTHING
      analyser.maxDecibels = AUDIO_ANALYSER_MAX_DB
      analyser.minDecibels = AUDIO_ANALYSER_MIN_DB

      const source = ctx.createMediaElementSource(audio)
      source.connect(analyser)
      analyser.connect(ctx.destination)

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {
          // Ignore suspended state errors; gesture listener retries.
        })
      }

      audioCtxRef.current = ctx
      analyserRef.current = analyser
      sourceNodeRef.current = source
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount) as AnalyserByteArray
      timeDataRef.current = new Uint8Array(analyser.fftSize) as AnalyserByteArray
      frameAnalyzerRef.current?.reset()
    } catch {
      audioGraphFailedRef.current = true
    }
  }, [resumeAudioContext])

  const getAudioFrame = useCallback((): AudioAnalysisFrame => {
    const engine = frameAnalyzerRef.current ?? (frameAnalyzerRef.current = new AudioFrameAnalyzer())
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const last = lastFrameAtRef.current
    // Several consumers inside one RAF tick share one analysed frame (envelopes advance once).
    if (last > 0 && now - last < 4) return engine.frame
    const dt = last > 0 ? (now - last) / 1000 : 1 / 60
    lastFrameAtRef.current = now

    const audio = audioRef.current
    const ctx = audioCtxRef.current
    const analyser = analyserRef.current
    const freqData = freqDataRef.current
    const timeData = timeDataRef.current
    const sampleRate = ctx?.sampleRate ?? 48000

    if (
      !audio ||
      audio.paused ||
      audio.ended ||
      audio.muted ||
      audio.volume <= 0 ||
      !ctx ||
      ctx.state !== 'running' ||
      !analyser ||
      !freqData ||
      !timeData
    ) {
      return engine.process(null, null, sampleRate, dt)
    }

    const activeSrc = audio.currentSrc || audio.getAttribute('src') || audio.src || ''
    if (!activeSrc || (!isSameOriginAudioUrl(activeSrc) && audio.crossOrigin !== 'anonymous')) {
      return engine.process(null, null, sampleRate, dt)
    }

    try {
      analyser.getByteFrequencyData(freqData)
      analyser.getByteTimeDomainData(timeData)
      return engine.process(freqData, timeData, sampleRate, dt, audio.volume)
    } catch {
      return engine.process(null, null, sampleRate, dt)
    }
  }, [])

  const getAudioEnergy = useCallback((): AudioEnergy => {
    const frame = getAudioFrame()
    return { bass: frame.bass, mid: frame.mid, level: frame.level }
  }, [getAudioFrame])

  const showFloatingUi =
    tracks.length > 0 || currentTrack !== null || drawerOpen || immersionOpen || managerOpen
  const blogTheme = useSyncedBlogTheme(showFloatingUi)

  // Extract WCAG-safe cover palette whenever currentTrack?.coverUrl changes
  const activeCoverUrl = currentTrack?.coverUrl || null
  useEffect(() => {
    if (!activeCoverUrl) {
      setPalette(null)
      return
    }
    let cancelled = false
    void extractCoverPalette(activeCoverUrl).then((extracted) => {
      if (!cancelled) {
        setPalette(extracted)
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeCoverUrl])

  // Sync audio.volume on mount and whenever volume changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
    }
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume
    }
  }, [volume])

  const setVolume = useCallback((rawVol: number) => {
    const safe = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : DEFAULT_BLOG_VOLUME
    const rounded = Math.round(safe * 100) / 100
    setVolumeState(rounded)
    persistVolume(rounded)
    if (rounded > 0) {
      lastNonZeroVolumeRef.current = rounded
      setMuted(false)
      if (audioRef.current) {
        audioRef.current.volume = rounded
        audioRef.current.muted = false
      }
    } else if (audioRef.current) {
      audioRef.current.volume = 0
    }
  }, [])

  const setAmbientMode = useCallback((mode: BlogAmbientMode) => {
    setAmbientModeState(mode)
    saveAmbientMode(mode)
  }, [])

  const openImmersion = useCallback(() => {
    setDrawerOpen(false)
    setImmersionOpen(true)
  }, [])

  const closeImmersion = useCallback(() => {
    setImmersionOpen(false)
  }, [])

  const fetchAndApplyTracks = useCallback(async (isManual: boolean) => {
    if (isManual) {
      manualRefreshCountRef.current += 1
    }
    hydratedInitialRef.current = true
    try {
      const res = await fetchBlogMusicTracks()
      const nextTracks = Array.isArray(res.tracks) ? res.tracks : []
      setTracks(nextTracks)

      setCurrentTrack((prev) => {
        if (!prev) {
          return nextTracks.length > 0 ? trackToPostMusic(nextTracks[0]) : null
        }
        if (prev.trackId) {
          const matched = nextTracks.find((item) => item.id === prev.trackId)
          if (matched) {
            return trackToPostMusic(matched)
          }
          if (audioRef.current) {
            audioRef.current.pause()
          }
          setIsPlaying(false)
          return nextTracks.length > 0 ? trackToPostMusic(nextTracks[0]) : null
        }
        return prev
      })
    } catch {
      // Fail silently on background bootstrap so visitor pages never error out.
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshTracks = useCallback(async () => {
    await fetchAndApplyTracks(true)
  }, [fetchAndApplyTracks])

  useEffect(() => {
    if (Array.isArray(initialTracks)) {
      if (manualRefreshCountRef.current === 0) {
        hydratedInitialRef.current = true
        setTracks(initialTracks)
        setCurrentTrack((prev) => {
          if (prev) return prev
          return initialTracks.length > 0 ? trackToPostMusic(initialTracks[0]) : null
        })
        setLoading(false)
      }
      return
    }
    if (deferInitialFetch || hydratedInitialRef.current) {
      return
    }
    void fetchAndApplyTracks(false)
  }, [initialTracks, deferInitialFetch, fetchAndApplyTracks])

  // Enrich standalone Moment music card tracks with playlist LRC/cover if matching audioUrl or trackId
  const resolveTrackWithLibrary = useCallback(
    (incoming: BlogPostMusic): BlogPostMusic => {
      const match = tracks.find(
        (t) =>
          (incoming.trackId && t.id === incoming.trackId) || t.audioUrl === incoming.audioUrl
      )
      if (!match) return incoming
      return {
        trackId: incoming.trackId || match.id,
        title: incoming.title || match.title,
        artist: incoming.artist || match.artist,
        coverUrl: incoming.coverUrl ?? match.coverUrl,
        audioUrl: incoming.audioUrl || match.audioUrl,
        lrc: incoming.lrc || match.lrcText || undefined
      }
    },
    [tracks]
  )

  const playTrack = useCallback(
    (incoming: BlogPostMusic) => {
      if (!incoming.audioUrl) return
      userInitiatedRef.current = true
      resumeAudioContext()
      const enriched = resolveTrackWithLibrary(incoming)
      const audio = audioRef.current

      const isSameSource =
        currentTrack?.audioUrl === enriched.audioUrl && Boolean(audio?.getAttribute('src'))

      setCurrentTrack(enriched)

      if (audio && isSameSource) {
        audio.muted = muted
        audio.volume = volume
        void audio.play().catch(() => {
          setIsPlaying(false)
        })
        return
      }

      pendingAutoPlayRef.current = true
      setCurrentTime(0)
      setDuration(0)
    },
    [currentTrack?.audioUrl, muted, resolveTrackWithLibrary, resumeAudioContext, volume]
  )

  // Sync <audio src> when currentTrack.audioUrl changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!currentTrack?.audioUrl) {
      audio.pause()
      audio.removeAttribute('src')
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      return
    }

    const currentAttrSrc = audio.getAttribute('src') || ''
    if (currentAttrSrc !== currentTrack.audioUrl) {
      // crossorigin MUST be set before src: once a MediaElementSource owns this element, any
      // non-CORS response would be tainted and the analyser (and speakers) would get silence.
      // Same-origin /api/blog/media is unaffected; CORS-enabled CDNs now visualise too. Hosts
      // that reject CORS fall back once (see onError) while no audio graph exists yet.
      if (corsBlockedUrlsRef.current.has(currentTrack.audioUrl) && !sourceNodeRef.current) {
        audio.removeAttribute('crossorigin')
      } else {
        audio.crossOrigin = 'anonymous'
      }
      audio.src = currentTrack.audioUrl
      audio.muted = muted
      audio.volume = volume
      audio.load()
    }

    if (pendingAutoPlayRef.current) {
      pendingAutoPlayRef.current = false
      void audio.play().catch(() => {
        setIsPlaying(false)
      })
    }
  }, [currentTrack?.audioUrl, muted, volume])

  const togglePlay = useCallback(() => {
    userInitiatedRef.current = true
    const audio = audioRef.current
    if (!currentTrack) {
      if (tracks.length > 0) {
        playTrack(trackToPostMusic(tracks[0]))
      }
      return
    }
    if (!audio) return
    if (audio.paused) {
      resumeAudioContext()
      void audio.play().catch(() => {
        setIsPlaying(false)
        showToast('error', '无法播放当前音频')
      })
    } else {
      audio.pause()
    }
  }, [currentTrack, playTrack, resumeAudioContext, tracks])

  const toggleMute = useCallback(() => {
    if (volume === 0) {
      const restored = lastNonZeroVolumeRef.current || DEFAULT_BLOG_VOLUME
      setVolume(restored)
      return
    }
    setMuted((prev) => {
      const next = !prev
      if (audioRef.current) {
        audioRef.current.muted = next
      }
      return next
    })
  }, [setVolume, volume])

  const findCurrentPlaylistIndex = useCallback((): number => {
    if (!currentTrack || tracks.length === 0) return -1
    return tracks.findIndex(
      (item) =>
        (currentTrack.trackId && item.id === currentTrack.trackId) ||
        item.audioUrl === currentTrack.audioUrl
    )
  }, [currentTrack, tracks])

  const nextTrack = useCallback(() => {
    userInitiatedRef.current = true
    if (tracks.length === 0) {
      if (audioRef.current && currentTrack) {
        audioRef.current.currentTime = 0
        void audioRef.current.play().catch(() => setIsPlaying(false))
      }
      return
    }
    const idx = findCurrentPlaylistIndex()
    const nextIdx = idx >= 0 ? (idx + 1) % tracks.length : 0
    playTrack(trackToPostMusic(tracks[nextIdx]))
  }, [currentTrack, findCurrentPlaylistIndex, playTrack, tracks])

  const prevTrack = useCallback(() => {
    userInitiatedRef.current = true
    const audio = audioRef.current
    if (audio && audio.currentTime > 3 && tracks.length <= 1) {
      audio.currentTime = 0
      setCurrentTime(0)
      return
    }
    if (tracks.length === 0) {
      if (audio) {
        audio.currentTime = 0
        setCurrentTime(0)
      }
      return
    }
    const idx = findCurrentPlaylistIndex()
    const prevIdx = idx >= 0 ? (idx - 1 + tracks.length) % tracks.length : 0
    playTrack(trackToPostMusic(tracks[prevIdx]))
  }, [findCurrentPlaylistIndex, playTrack, tracks])

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current
    const maxDur = durationRef.current > 0 ? durationRef.current : audio?.duration || 0
    const clamped = Math.max(0, maxDur > 0 ? Math.min(seconds, maxDur) : seconds)
    if (audio) {
      audio.currentTime = clamped
    }
    setCurrentTime(clamped)
  }, [])

  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const openManager = useCallback(() => {
    if (!isOwner) return
    setManagerOpen(true)
  }, [isOwner])

  const parsedLyrics = useMemo(() => parseLrc(currentTrack?.lrc || ''), [currentTrack?.lrc])

  const activeLyricIndex = useMemo(() => {
    if (parsedLyrics.length === 0) return -1
    const targetTime = currentTime + 0.08
    let lo = 0
    let hi = parsedLyrics.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (parsedLyrics[mid].time <= targetTime) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans
  }, [parsedLyrics, currentTime])

  const currentLyricLine = activeLyricIndex >= 0 ? parsedLyrics[activeLyricIndex].text : ''

  // Keep active lyric centered inside .blog-p2-lrc-box when drawer is open
  useEffect(() => {
    if (!drawerOpen) return
    const box = lrcBoxRef.current
    const activeEl = activeLrcLineRef.current
    if (!box || !activeEl) return
    const targetScrollTop =
      activeEl.offsetTop - box.clientHeight / 2 + activeEl.clientHeight / 2
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: reducedMotion ? 'auto' : 'smooth'
    })
  }, [activeLyricIndex, drawerOpen])

  // Close drawer on Escape
  useEffect(() => {
    if (!drawerOpen || managerOpen || immersionOpen || typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDrawerOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen, managerOpen, immersionOpen])

  const stableContextValue = useMemo<BlogMusicActionsContextValue>(
    () => ({
      tracks,
      loading,
      currentTrack,
      isPlaying,
      muted,
      volume,
      setVolume,
      ambientMode,
      setAmbientMode,
      palette,
      getAudioEnergy,
      getAudioFrame,
      immersionOpen,
      openImmersion,
      closeImmersion,
      refreshTracks,
      playTrack,
      togglePlay,
      toggleMute,
      nextTrack,
      prevTrack,
      seekTo,
      openDrawer,
      openManager
    }),
    [
      tracks,
      loading,
      currentTrack,
      isPlaying,
      muted,
      volume,
      setVolume,
      ambientMode,
      setAmbientMode,
      palette,
      getAudioEnergy,
      getAudioFrame,
      immersionOpen,
      openImmersion,
      closeImmersion,
      refreshTracks,
      playTrack,
      togglePlay,
      toggleMute,
      nextTrack,
      prevTrack,
      seekTo,
      openDrawer,
      openManager
    ]
  )

  const progressContextValue = useMemo<BlogMusicProgressValue>(
    () => ({
      currentTime,
      duration,
      currentLyricLine
    }),
    [currentTime, duration, currentLyricLine]
  )

  const displayTrack =
    currentTrack || (tracks.length > 0 ? trackToPostMusic(tracks[0]) : null)
  const showPill = Boolean(displayTrack)
  const effectiveDuration =
    duration > 0
      ? duration
      : tracks.find((t) => t.id === displayTrack?.trackId)?.durationSec || 0

  // Sync dynamic cover accent variables onto floating portals when ambient is active
  const portalAmbientVars = useMemo<CSSProperties | undefined>(() => {
    if (!isPlaying || ambientMode === 'minimal' || !palette) return undefined
    const isDark = blogTheme === 'dark'
    return {
      '--blog-link': isDark ? palette.accentDark : palette.accentLight,
      '--blog-link-hover': isDark ? palette.accentDarkHover : palette.accentLightHover,
      '--blog-link-soft': isDark ? palette.accentDarkSoft : palette.accentLightSoft,
      '--blog-link-rgb': isDark ? palette.accentDarkRgb : palette.accentLightRgb
    } as CSSProperties
  }, [isPlaying, ambientMode, palette, blogTheme])

  const displayVol = muted ? 0 : volume
  const volPercent = Math.round(displayVol * 100)

  return (
    <BlogMusicContext.Provider value={stableContextValue}>
      <BlogMusicProgressContext.Provider value={progressContextValue}>
        {children}

        {/* Persistent Global Audio Element — never unmounts across SPA blog routes */}
        <audio
          ref={audioRef}
          preload="metadata"
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setDuration(d)
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setDuration(d)
          }}
          onPlay={() => {
            setIsPlaying(true)
            ensureAudioAnalyser()
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            if (tracks.length > 0) {
              nextTrack()
            } else {
              setIsPlaying(false)
            }
          }}
          onError={(e) => {
            const el = e.currentTarget
            const failedSrc = el.getAttribute('src') || ''
            // One-shot CORS fallback: a cross-origin host without Access-Control-Allow-Origin
            // rejects crossorigin="anonymous". Retry plain (no visualiser) only while no audio
            // graph exists — after that a tainted element would play pure silence.
            if (
              failedSrc &&
              el.crossOrigin === 'anonymous' &&
              !isSameOriginAudioUrl(failedSrc) &&
              !sourceNodeRef.current &&
              !corsBlockedUrlsRef.current.has(failedSrc)
            ) {
              corsBlockedUrlsRef.current.add(failedSrc)
              el.removeAttribute('crossorigin')
              el.src = failedSrc
              el.load()
              if (userInitiatedRef.current) {
                void el.play().catch(() => setIsPlaying(false))
              }
              return
            }
            setIsPlaying(false)
            if (userInitiatedRef.current) {
              showToast('error', '音频播放失败，请稍后重试')
            }
          }}
        />

        {/* Floating Mini Music Pill (bottom-left) */}
        {showPill &&
          displayTrack &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              className="blog-root blog-p2-floating-scope"
              data-blog-theme={blogTheme}
              style={portalAmbientVars}
            >
              <div
                className={`blog-p2-music-pill${isPlaying ? ' is-playing' : ''}${
                  hasBottomBar ? ' has-bottom-bar' : ''
                }${desktopRailActive ? ' is-desktop-rail-active' : ''}`}
                role="region"
                aria-label="全局音乐播放器"
              >
                <button
                  type="button"
                  className={`blog-p2-music-disc${isPlaying ? ' is-playing' : ''}`}
                  onClick={openImmersion}
                  title="打开全屏沉浸歌词舞台"
                  aria-label="打开全屏沉浸歌词舞台"
                >
                  {displayTrack.coverUrl ? (
                    <img src={displayTrack.coverUrl} alt={displayTrack.title} />
                  ) : (
                    <AppIcon name="music" size={16} />
                  )}
                </button>

                <button
                  type="button"
                  className="blog-p2-music-pill-body"
                  onClick={openDrawer}
                  title="点击查看同步歌词与歌单"
                >
                  <span className="blog-p2-music-pill-title">
                    {displayTrack.title}
                    {displayTrack.artist ? ` · ${displayTrack.artist}` : ''}
                  </span>
                  <span className="blog-p2-music-pill-lyric">
                    {currentLyricLine || (isPlaying ? '正在播放…' : '点击展开歌词与歌单')}
                  </span>
                </button>

                <div className="blog-p2-music-pill-controls">
                  <button
                    type="button"
                    className="blog-p2-music-pill-btn is-primary"
                    onClick={togglePlay}
                    title={isPlaying ? '暂停' : '播放'}
                    aria-label={isPlaying ? '暂停' : '播放'}
                  >
                    <AppIcon name={isPlaying ? 'pause' : 'play'} size={13} />
                  </button>
                  <button
                    type="button"
                    className="blog-p2-music-pill-btn"
                    onClick={openDrawer}
                    title="展开歌单抽屉"
                    aria-label="展开歌单抽屉"
                  >
                    <AppIcon name="list" size={14} />
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* Music & Synchronized LRC Lyrics Drawer */}
        {drawerOpen &&
          displayTrack &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              className="blog-root blog-modal-backdrop blog-p2-drawer-backdrop"
              data-blog-theme={blogTheme}
              style={{ minHeight: 0, zIndex: 1015, ...portalAmbientVars }}
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setDrawerOpen(false)
              }}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-label="音乐与歌词"
                className="blog-p2-music-drawer"
              >
                <header className="blog-p2-drawer-header">
                  <div className="blog-p2-drawer-now">
                    <button
                      type="button"
                      className={`blog-p2-music-disc is-large${isPlaying ? ' is-playing' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onClick={openImmersion}
                      title="进入全屏沉浸歌词"
                      aria-label="进入全屏沉浸歌词"
                    >
                      {displayTrack.coverUrl ? (
                        <img src={displayTrack.coverUrl} alt={displayTrack.title} />
                      ) : (
                        <AppIcon name="music" size={22} />
                      )}
                    </button>
                    <div className="blog-p2-drawer-meta">
                      <h2 className="blog-p2-drawer-title">{displayTrack.title}</h2>
                      <p className="blog-p2-drawer-artist">
                        {displayTrack.artist || '未知歌手'}
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="blog-btn blog-btn-subtle blog-btn-sm"
                      onClick={openImmersion}
                      title="打开全屏沉浸歌词舞台"
                    >
                      <AppIcon name="sparkles" size={13} />
                      <span>沉浸舞台</span>
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        className="blog-btn blog-btn-subtle blog-btn-sm"
                        onClick={() => setManagerOpen(true)}
                      >
                        <AppIcon name="settings" size={13} />
                        <span>管理歌单</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="blog-btn blog-btn-icon blog-btn-sm"
                      onClick={() => setDrawerOpen(false)}
                      aria-label="收起播放器"
                    >
                      <AppIcon name="close" size={15} />
                    </button>
                  </div>
                </header>

                {/* Progress, Transport & Sleek Volume Slider */}
                <div className="blog-p2-drawer-controls-wrap">
                  <div className="blog-p2-progress-row">
                    <span className="blog-p2-time-mono">{formatAudioTime(currentTime)}</span>
                    <input
                      type="range"
                      className="blog-p2-seek-slider"
                      min={0}
                      max={effectiveDuration > 0 ? effectiveDuration : 100}
                      step={0.1}
                      value={effectiveDuration > 0 ? Math.min(currentTime, effectiveDuration) : 0}
                      disabled={effectiveDuration <= 0}
                      onChange={(e) => seekTo(Number(e.target.value))}
                      aria-label="播放进度"
                    />
                    <span className="blog-p2-time-mono">{formatAudioTime(effectiveDuration)}</span>
                  </div>

                  <div className="blog-p2-transport-row">
                    <span className="blog-p2-time-mono" style={{ minWidth: 42 }}>
                      {ambientMode === 'waves'
                        ? '声波'
                        : ambientMode === 'silk'
                          ? '极光'
                          : '极简'}
                    </span>

                    <div className="blog-p2-transport-main">
                      <button
                        type="button"
                        className="blog-btn blog-btn-icon"
                        onClick={prevTrack}
                        title="上一首"
                        aria-label="上一首"
                      >
                        <AppIcon name="skipBack" size={16} />
                      </button>
                      <button
                        type="button"
                        className="blog-p2-play-fab"
                        onClick={togglePlay}
                        title={isPlaying ? '暂停' : '播放'}
                        aria-label={isPlaying ? '暂停' : '播放'}
                      >
                        <AppIcon name={isPlaying ? 'pause' : 'play'} size={18} />
                      </button>
                      <button
                        type="button"
                        className="blog-btn blog-btn-icon"
                        onClick={nextTrack}
                        title="下一首"
                        aria-label="下一首"
                      >
                        <AppIcon name="skipForward" size={16} />
                      </button>
                    </div>

                    <span
                      className="blog-p2-time-mono"
                      style={{ minWidth: 42, textAlign: 'right' }}
                    >
                      {tracks.length > 0 ? `${tracks.length} 首` : '单曲'}
                    </span>
                  </div>

                  <div className="blog-volume-row">
                    <button
                      type="button"
                      className="blog-volume-mute-btn"
                      onClick={toggleMute}
                      title={muted || volume === 0 ? '取消静音' : '静音'}
                      aria-label={muted || volume === 0 ? '取消静音' : '静音'}
                    >
                      <AppIcon name={muted || volume === 0 ? 'volumeOff' : 'volume'} size={15} />
                    </button>
                    <input
                      type="range"
                      className="blog-volume-slider"
                      min={0}
                      max={1}
                      step={0.01}
                      value={displayVol}
                      style={{ '--vol-pct': `${volPercent}%` } as CSSProperties}
                      onChange={(e) => setVolume(Number(e.target.value))}
                      aria-label="音量调节"
                    />
                    <span className="blog-volume-pct">{volPercent}%</span>
                  </div>
                </div>

                {/* Synchronized Scrolling LRC Panel */}
                <div ref={lrcBoxRef} className="blog-p2-lrc-box" aria-label="同步歌词">
                  {parsedLyrics.length === 0 ? (
                    <div className="blog-p2-lrc-empty">
                      <AppIcon name="music" size={20} />
                      <span>纯音乐或暂无 LRC 同步歌词</span>
                    </div>
                  ) : (
                    parsedLyrics.map((line, idx) => {
                      const isActive = idx === activeLyricIndex
                      return (
                        <button
                          key={`${line.time}-${idx}`}
                          ref={isActive ? activeLrcLineRef : null}
                          type="button"
                          className={`blog-p2-lrc-line${isActive ? ' is-active' : ''}`}
                          onClick={() => {
                            seekTo(line.time)
                            if (!isPlaying) togglePlay()
                          }}
                        >
                          {line.text}
                        </button>
                      )
                    })
                  )}
                </div>

                {/* Playlist Track List */}
                {tracks.length > 0 && (
                  <div className="blog-p2-drawer-playlist">
                    <div className="blog-p2-drawer-playlist-head">
                      <span>播放列表</span>
                      <span className="blog-p2-time-mono">{tracks.length} TRACKS</span>
                    </div>
                    <div className="blog-p2-track-list">
                      {tracks.map((item, idx) => {
                        const active =
                          displayTrack.trackId === item.id ||
                          displayTrack.audioUrl === item.audioUrl
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`blog-p2-track-row is-clickable${active ? ' is-active' : ''}`}
                            onClick={() => {
                              if (active) togglePlay()
                              else playTrack(trackToPostMusic(item))
                            }}
                          >
                            <span className="blog-p2-track-num">
                              {active && isPlaying ? '♪' : String(idx + 1).padStart(2, '0')}
                            </span>
                            <span className="blog-p2-track-row-title">{item.title}</span>
                            <span className="blog-p2-track-row-artist">
                              {item.artist || '未知歌手'}
                            </span>
                            {item.durationSec ? (
                              <span className="blog-p2-time-mono">
                                {formatAudioTime(item.durationSec)}
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </section>
            </div>,
            document.body
          )}

        {/* Apple Music Fullscreen Immersion Stage */}
        {immersionOpen && displayTrack && (
          <BlogMusicImmersionModal
            open={immersionOpen}
            managerOpen={managerOpen}
            isOwner={isOwner}
            track={displayTrack}
            tracks={tracks}
            isPlaying={isPlaying}
            muted={muted}
            volume={volume}
            currentTime={currentTime}
            effectiveDuration={effectiveDuration}
            parsedLyrics={parsedLyrics}
            activeLyricIndex={activeLyricIndex}
            ambientMode={ambientMode}
            palette={palette}
            onClose={closeImmersion}
            onSetAmbientMode={setAmbientMode}
            onTogglePlay={togglePlay}
            onPrev={prevTrack}
            onNext={nextTrack}
            onSeek={seekTo}
            onSetVolume={setVolume}
            onToggleMute={toggleMute}
            onPlayTrack={(track) => playTrack(trackToPostMusic(track))}
            onOpenManager={openManager}
          />
        )}

        {/* Owner Playlist Manager Modal */}
        {isOwner && (
          <BlogMusicManagerModal
            open={managerOpen}
            blogTheme={blogTheme}
            tracks={tracks}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onClose={() => setManagerOpen(false)}
            onPlayPreview={(track) => playTrack(trackToPostMusic(track))}
            onTogglePlay={togglePlay}
            onTracksChanged={refreshTracks}
          />
        )}
      </BlogMusicProgressContext.Provider>
    </BlogMusicContext.Provider>
  )
}
