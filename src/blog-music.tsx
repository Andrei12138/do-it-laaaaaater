import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import {
  createBlogMusicTrack,
  deleteBlogMusicTrack,
  fetchBlogMusicTracks,
  updateBlogMusicTrack,
  uploadBlogFile,
  uploadBlogMedia
} from './blog-api'
import type { BlogMusicTrack, BlogPostMusic } from './blog-types'
import { AppIcon } from './components/AppIcon'
import { showToast } from './components/Toast'

export interface LrcLine {
  time: number
  text: string
}

export interface BlogMusicContextValue {
  tracks: BlogMusicTrack[]
  loading: boolean
  currentTrack: BlogPostMusic | null
  isPlaying: boolean
  currentTime: number
  duration: number
  muted: boolean
  currentLyricLine: string
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

const BlogMusicContext = createContext<BlogMusicContextValue | null>(null)

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

export function useOptionalBlogMusic(): BlogMusicContextValue | null {
  return useContext(BlogMusicContext)
}

export function useBlogMusic(): BlogMusicContextValue {
  const ctx = useContext(BlogMusicContext)
  if (!ctx) {
    throw new Error('useBlogMusic must be used within a BlogMusicProvider')
  }
  return ctx
}

function getErrorMessage(err: unknown, fallback = '操作失败，请稍后重试'): string {
  if (err instanceof Error && err.message) return err.message
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
    } catch {
      // Ignore storage access errors.
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
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [lrcText, setLrcText] = useState('')

  const [uploadingAudio, setUploadingAudio] = useState(false)
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

  const busy = uploadingAudio || uploadingCover || creating || savingEdit || uploadingEditCover

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

  const resetAddForm = () => {
    setAudioMediaId('')
    setAudioFilename('')
    setDurationSec(null)
    setCoverMediaId(null)
    setCoverPreviewUrl(null)
    setTitle('')
    setArtist('')
    setAlbum('')
    setLrcText('')
    setFormError('')
  }

  const handleAudioFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadingAudio(true)
    setFormError('')
    try {
      const [uploaded, detectedDuration] = await Promise.all([
        uploadBlogFile(file, 'audio'),
        probeLocalAudioDuration(file)
      ])
      setAudioMediaId(uploaded.id)
      setAudioFilename(file.name)
      setDurationSec(detectedDuration)

      const inferred = parseFilenameMeta(file.name)
      setTitle((prev) => (prev.trim() ? prev : inferred.title || '未命名单曲'))
      if (inferred.artist) {
        setArtist((prev) => (prev.trim() ? prev : inferred.artist))
      }
      showToast('success', '音频已上传至 R2')
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

    setUploadingCover(true)
    setFormError('')
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        setCoverMediaId(uploaded.id)
        setCoverPreviewUrl(uploaded.thumbUrl || uploaded.url)
        showToast('success', '封面已上传')
      }
    } catch (err) {
      const msg = getErrorMessage(err, '封面上传失败')
      setFormError(msg)
      showToast('error', msg)
    } finally {
      setUploadingCover(false)
    }
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
      const nextSortOrder =
        tracks.length > 0 ? Math.max(...tracks.map((item) => item.sortOrder)) + 1 : 0
      await createBlogMusicTrack({
        title: cleanTitle,
        artist: artist.trim(),
        album: album.trim(),
        audioMediaId,
        coverMediaId,
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

    setUploadingEditCover(true)
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        setEditCoverMediaId(uploaded.id)
        setEditCoverUrl(uploaded.thumbUrl || uploaded.url)
        showToast('success', '封面已上传')
      }
    } catch (err) {
      showToast('error', getErrorMessage(err, '封面上传失败'))
    } finally {
      setUploadingEditCover(false)
    }
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
          item.sortOrder !== idx ? updateBlogMusicTrack(item.id, { sortOrder: idx }) : Promise.resolve(item)
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
          <h2 className="blog-modal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
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
            <div className="blog-p2-manager-section-title">
              <AppIcon name="plus" size={14} />
              <span>上传新单曲（R2 原生音频流 + LRC 同步歌词）</span>
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
                      {uploadingAudio ? '上传音频中…' : audioMediaId ? '重新选择音频' : '上传音频 *'}
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
                        setCoverMediaId(null)
                        setCoverPreviewUrl(null)
                      }}
                    >
                      清除封面
                    </button>
                  )}
                </div>

                <span className="blog-field-hint">
                  {audioFilename
                    ? `已就绪：${audioFilename}${durationSec ? ` (${formatAudioTime(durationSec)})` : ''}`
                    : '支持 MP3 / M4A / WAV / OGG / FLAC / WebM，单文件最大 40 MB'}
                </span>
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
                accept="image/png,image/jpeg,image/webp"
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
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
                placeholder={'支持粘贴标准 LRC 时间轴，例如：\n[00:12.30] 第一句歌词\n[00:18.65] 第二句歌词'}
                style={{ fontFamily: 'var(--blog-font-mono)', fontSize: 12.5, minHeight: 88 }}
              />
            </div>

            {formError && (
              <div className="blog-p2-inline-alert" role="alert">
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {(audioMediaId || title || artist || album || lrcText) && (
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
                    currentTrack?.trackId === track.id || currentTrack?.audioUrl === track.audioUrl
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
                              <input
                                ref={editCoverInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                hidden
                                onChange={(e) => void handleEditCoverChange(e)}
                              />
                            </div>
                          </div>

                          <div className="blog-field">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
          <button type="button" className="blog-btn blog-btn-subtle" disabled={busy} onClick={onClose}>
            完成
          </button>
        </footer>
      </section>
    </div>,
    document.body
  )
}

export function BlogMusicProvider({
  isOwner,
  hasBottomBar = false,
  children
}: {
  isOwner: boolean
  hasBottomBar?: boolean
  children: ReactNode
}) {
  const [tracks, setTracks] = useState<BlogMusicTrack[]>([])
  const [loading, setLoading] = useState(true)
  const [currentTrack, setCurrentTrack] = useState<BlogPostMusic | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lrcBoxRef = useRef<HTMLDivElement | null>(null)
  const activeLrcLineRef = useRef<HTMLButtonElement | null>(null)
  const pendingAutoPlayRef = useRef(false)
  const userInitiatedRef = useRef(false)

  const showFloatingUi = tracks.length > 0 || currentTrack !== null || drawerOpen || managerOpen
  const blogTheme = useSyncedBlogTheme(showFloatingUi)

  const refreshTracks = useCallback(async () => {
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
          // Current playlist track was deleted
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

  useEffect(() => {
    void refreshTracks()
  }, [refreshTracks])

  // Enrich standalone Moment music card tracks with playlist LRC/cover if matching audioUrl or trackId
  const resolveTrackWithLibrary = useCallback(
    (incoming: BlogPostMusic): BlogPostMusic => {
      const match = tracks.find(
        (t) => (incoming.trackId && t.id === incoming.trackId) || t.audioUrl === incoming.audioUrl
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
      const enriched = resolveTrackWithLibrary(incoming)
      const audio = audioRef.current

      const isSameSource =
        currentTrack?.audioUrl === enriched.audioUrl && Boolean(audio?.getAttribute('src'))

      setCurrentTrack(enriched)

      if (audio && isSameSource) {
        audio.muted = muted
        void audio.play().catch(() => {
          setIsPlaying(false)
        })
        return
      }

      pendingAutoPlayRef.current = true
      setCurrentTime(0)
      setDuration(0)
    },
    [currentTrack?.audioUrl, muted, resolveTrackWithLibrary]
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
      audio.src = currentTrack.audioUrl
      audio.muted = muted
      audio.load()
    }

    if (pendingAutoPlayRef.current) {
      pendingAutoPlayRef.current = false
      void audio.play().catch(() => {
        setIsPlaying(false)
      })
    }
  }, [currentTrack?.audioUrl, muted])

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
      void audio.play().catch(() => {
        setIsPlaying(false)
        showToast('error', '无法播放当前音频')
      })
    } else {
      audio.pause()
    }
  }, [currentTrack, playTrack, tracks])

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      if (audioRef.current) {
        audioRef.current.muted = next
      }
      return next
    })
  }, [])

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

  const seekTo = useCallback(
    (seconds: number) => {
      const audio = audioRef.current
      const maxDur = duration > 0 ? duration : audio?.duration || 0
      const clamped = Math.max(0, maxDur > 0 ? Math.min(seconds, maxDur) : seconds)
      if (audio) {
        audio.currentTime = clamped
      }
      setCurrentTime(clamped)
    },
    [duration]
  )

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

  // Keep active lyric centered smoothly inside .blog-p2-lrc-box when drawer is open
  useEffect(() => {
    if (!drawerOpen) return
    const box = lrcBoxRef.current
    const activeEl = activeLrcLineRef.current
    if (!box || !activeEl) return
    const targetScrollTop =
      activeEl.offsetTop - box.clientHeight / 2 + activeEl.clientHeight / 2
    box.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth'
    })
  }, [activeLyricIndex, drawerOpen])

  // Close drawer on Escape
  useEffect(() => {
    if (!drawerOpen || managerOpen || typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDrawerOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen, managerOpen])

  const contextValue = useMemo<BlogMusicContextValue>(
    () => ({
      tracks,
      loading,
      currentTrack,
      isPlaying,
      currentTime,
      duration,
      muted,
      currentLyricLine,
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
      currentTime,
      duration,
      muted,
      currentLyricLine,
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

  const displayTrack =
    currentTrack || (tracks.length > 0 ? trackToPostMusic(tracks[0]) : null)
  const showPill = Boolean(displayTrack)
  const effectiveDuration =
    duration > 0
      ? duration
      : tracks.find((t) => t.id === displayTrack?.trackId)?.durationSec || 0

  return (
    <BlogMusicContext.Provider value={contextValue}>
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
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          if (tracks.length > 0) {
            nextTrack()
          } else {
            setIsPlaying(false)
          }
        }}
        onError={() => {
          setIsPlaying(false)
          if (userInitiatedRef.current) {
            showToast('error', '音频播放失败，请稍后重试')
          }
        }}
      />

      {/* Floating Mini Music Pill (bottom-left) */}
      {showPill && displayTrack && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="blog-root blog-p2-floating-scope"
            data-blog-theme={blogTheme}
          >
            <div
              className={`blog-p2-music-pill${isPlaying ? ' is-playing' : ''}${hasBottomBar ? ' has-bottom-bar' : ''}`}
              role="region"
              aria-label="全局音乐播放器"
            >
              <button
                type="button"
                className={`blog-p2-music-disc${isPlaying ? ' is-playing' : ''}`}
                onClick={openDrawer}
                title="展开歌词与歌单"
                aria-label="展开歌词与歌单"
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
      {drawerOpen && displayTrack && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="blog-root blog-modal-backdrop blog-p2-drawer-backdrop"
            data-blog-theme={blogTheme}
            style={{ minHeight: 0, zIndex: 1015 }}
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
                  <div className={`blog-p2-music-disc is-large${isPlaying ? ' is-playing' : ''}`}>
                    {displayTrack.coverUrl ? (
                      <img src={displayTrack.coverUrl} alt={displayTrack.title} />
                    ) : (
                      <AppIcon name="music" size={22} />
                    )}
                  </div>
                  <div className="blog-p2-drawer-meta">
                    <h2 className="blog-p2-drawer-title">{displayTrack.title}</h2>
                    <p className="blog-p2-drawer-artist">
                      {displayTrack.artist || '未知歌手'}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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

              {/* Progress & Playback Controls */}
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
                  <button
                    type="button"
                    className="blog-btn blog-btn-icon blog-btn-sm"
                    onClick={toggleMute}
                    title={muted ? '取消静音' : '静音'}
                    aria-label={muted ? '取消静音' : '静音'}
                  >
                    <AppIcon name={muted ? 'volumeOff' : 'volume'} size={15} />
                  </button>

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

                  <span className="blog-p2-time-mono" style={{ minWidth: 34, textAlign: 'right' }}>
                    {tracks.length > 0 ? `${tracks.length} 首` : '单曲'}
                  </span>
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
                        displayTrack.trackId === item.id || displayTrack.audioUrl === item.audioUrl
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
    </BlogMusicContext.Provider>
  )
}
