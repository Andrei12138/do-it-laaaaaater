import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { errorMessage } from '../../api-error'
import {
  fetchStorageUsage,
  runBlogMediaGc,
  updateBlogSettings,
  uploadBlogMedia
} from '../../blog-api'
import type { BlogProfile, StorageUsageSnapshot } from '../../blog-types'
import { AppIcon } from '../AppIcon'
import { showToast } from '../Toast'
import {
  BLOG_SIDEBAR_WIDGET_LABELS,
  readBlogSidebarConfig,
  type BlogSidebarWidgetId
} from './BlogSideRails'

const SIDEBAR_WIDGET_ORDER: readonly BlogSidebarWidgetId[] = [
  'about',
  'album',
  'music',
  'equipment',
  'labs',
  'friends'
]

export interface BlogSettingsModalProps {
  open: boolean
  profile: BlogProfile
  onClose: () => void
  onSaved: (profile: BlogProfile) => void
}

const DEFAULT_R2_QUOTA_BYTES = 10 * 1024 * 1024 * 1024

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb >= 10 ? kb.toFixed(0) : kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb >= 100 ? mb.toFixed(0) : mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

function detectBlogTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const theme = document.querySelector<HTMLElement>('.blog-root')?.getAttribute('data-blog-theme')
  return theme === 'dark' ? 'dark' : 'light'
}

export function BlogSettingsModal({ open, profile, onClose, onSaved }: BlogSettingsModalProps) {
  const [blogTheme, setBlogTheme] = useState<'light' | 'dark'>('light')

  const [siteName, setSiteName] = useState(profile.siteName || '')
  const [nickname, setNickname] = useState(profile.nickname || '')
  const [bio, setBio] = useState(profile.bio || '')
  const [footerText, setFooterText] = useState(profile.footerText || '')
  const [allowComments, setAllowComments] = useState(Boolean(profile.allowComments))
  const [hiddenWidgets, setHiddenWidgets] = useState<BlogSidebarWidgetId[]>(
    () => readBlogSidebarConfig(profile.extensions).hiddenWidgets
  )

  const [coverMediaId, setCoverMediaId] = useState<string | null>(profile.coverMediaId ?? null)
  const [coverUrl, setCoverUrl] = useState<string | null>(profile.coverUrl ?? null)
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(profile.avatarMediaId ?? null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl ?? null)

  const [saving, setSaving] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [copiedRss, setCopiedRss] = useState(false)
  const [error, setError] = useState('')

  const [storageUsage, setStorageUsage] = useState<StorageUsageSnapshot | null>(null)
  const [loadingStorage, setLoadingStorage] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [runningGc, setRunningGc] = useState(false)
  const [includeRecentGc, setIncludeRecentGc] = useState(false)

  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const busy = saving || uploadingCover || uploadingAvatar || runningGc

  const loadStorageUsage = useCallback(async () => {
    setLoadingStorage(true)
    setStorageError('')
    try {
      const snapshot = await fetchStorageUsage()
      setStorageUsage(snapshot)
    } catch (err) {
      setStorageError(errorMessage(err))
    } finally {
      setLoadingStorage(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setBlogTheme(detectBlogTheme())
    setSiteName(profile.siteName || '')
    setNickname(profile.nickname || '')
    setBio(profile.bio || '')
    setFooterText(profile.footerText || '')
    setAllowComments(Boolean(profile.allowComments))
    setHiddenWidgets(readBlogSidebarConfig(profile.extensions).hiddenWidgets)
    setCoverMediaId(profile.coverMediaId ?? null)
    setCoverUrl(profile.coverUrl ?? null)
    setAvatarMediaId(profile.avatarMediaId ?? null)
    setAvatarUrl(profile.avatarUrl ?? null)
    setCopiedRss(false)
    setIncludeRecentGc(false)
    setError('')
    void loadStorageUsage()
  }, [open, profile, loadStorageUsage])

  useEffect(() => {
    if (!open) return
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

  const handleUploadCover = useCallback(async (file: File) => {
    setUploadingCover(true)
    setError('')
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        setCoverMediaId(uploaded.id)
        setCoverUrl(uploaded.url)
        showToast('success', '封面图片已上传')
      }
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      showToast('error', msg)
    } finally {
      setUploadingCover(false)
    }
  }, [])

  const handleUploadAvatar = useCallback(async (file: File) => {
    setUploadingAvatar(true)
    setError('')
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        setAvatarMediaId(uploaded.id)
        setAvatarUrl(uploaded.url)
        showToast('success', '头像已上传')
      }
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      showToast('error', msg)
    } finally {
      setUploadingAvatar(false)
    }
  }, [])

  const rssUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/api/blog/feed.xml`
      : '/api/blog/feed.xml'

  const handleCopyRss = useCallback(async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(rssUrl)
      } else {
        const input = document.createElement('input')
        input.value = rssUrl
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
      }
      setCopiedRss(true)
      showToast('success', '已复制 RSS 订阅地址')
      window.setTimeout(() => setCopiedRss(false), 1800)
    } catch {
      showToast('error', '复制失败，请手动选中复制')
    }
  }, [rssUrl])

  const toggleSidebarWidget = useCallback((widgetId: BlogSidebarWidgetId) => {
    setHiddenWidgets((prev) =>
      prev.includes(widgetId) ? prev.filter((item) => item !== widgetId) : [...prev, widgetId]
    )
  }, [])

  const handleRunMediaGc = useCallback(async () => {
    if (runningGc) return
    if (
      includeRecentGc &&
      !window.confirm(
        '已勾选「包含近期未引用上传」：若其他页面有刚上传但尚未发布的图片/音视频，也会一并清理。确定继续吗？'
      )
    ) {
      return
    }
    setRunningGc(true)
    setStorageError('')
    try {
      const hasLegacyMemo = Boolean(storageUsage && storageUsage.legacyMemoCount > 0)
      const res = await runBlogMediaGc({
        includeRecent: includeRecentGc,
        includeLegacyMemo: hasLegacyMemo
      })
      const totalDeleted = (res.deletedCount || 0) + (res.legacyMemoDeletedCount || 0)
      const totalFreed = (res.freedBytes || 0) + (res.legacyMemoFreedBytes || 0)
      if (totalDeleted > 0 || totalFreed > 0) {
        showToast(
          'success',
          `清理完成，回收 ${totalDeleted} 个文件 · 释放 ${formatBytes(totalFreed)}`
        )
      } else {
        showToast('info', '未发现可清理的孤儿媒体')
      }
      setIncludeRecentGc(false)
      await loadStorageUsage()
    } catch (err) {
      const msg = errorMessage(err)
      setStorageError(msg)
      showToast('error', msg)
    } finally {
      setRunningGc(false)
    }
  }, [runningGc, includeRecentGc, storageUsage, loadStorageUsage])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')
    setSaving(true)
    try {
      const existingExtensions =
        profile.extensions && typeof profile.extensions === 'object' ? profile.extensions : {}
      const existingSidebar =
        existingExtensions.sidebar &&
        typeof existingExtensions.sidebar === 'object' &&
        !Array.isArray(existingExtensions.sidebar)
          ? (existingExtensions.sidebar as Record<string, unknown>)
          : {}

      const updated = await updateBlogSettings({
        siteName: siteName.trim(),
        nickname: nickname.trim(),
        bio: bio.trim(),
        footerText: footerText.trim(),
        avatarMediaId,
        coverMediaId,
        allowComments,
        extensions: {
          ...existingExtensions,
          sidebar: {
            ...existingSidebar,
            hiddenWidgets
          }
        }
      })
      showToast('success', '博客设置已保存')
      onSaved(updated)
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      showToast('error', msg)
    } finally {
      setSaving(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const avatarFallbackChar = (nickname.trim() || siteName.trim() || '博').slice(0, 1).toUpperCase()

  return createPortal(
    <div
      className="blog-root blog-modal-backdrop"
      data-blog-theme={blogTheme}
      style={{
        minHeight: 0,
        zIndex: 1000
      }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose()
        }
      }}
    >
      <section role="dialog" aria-modal="true" aria-label="博客主页设置" className="blog-settings-modal">
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'inherit', flex: 1 }}
        >
          <header className="blog-modal-header">
            <h2 className="blog-modal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <AppIcon name="settings" size={17} />
              <span>博客主页设置</span>
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
            {/* Cover Banner */}
            <div className="blog-field">
              <span className="blog-field-label">主页封面图</span>
              <div className="blog-settings-cover-preview">
                {coverUrl ? (
                  <img src={coverUrl} alt="封面预览" />
                ) : (
                  <span style={{ color: 'rgba(255, 255, 255, 0.78)', fontSize: 12.5 }}>
                    当前使用默认渐变封面
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="blog-btn blog-btn-subtle blog-btn-sm"
                  disabled={uploadingCover}
                  onClick={() => coverInputRef.current?.click()}
                >
                  <AppIcon name="upload" size={14} />
                  <span>{uploadingCover ? '上传中…' : '上传封面'}</span>
                </button>
                <button
                  type="button"
                  className="blog-btn blog-btn-ghost blog-btn-sm"
                  disabled={uploadingCover || (!coverUrl && !coverMediaId)}
                  onClick={() => {
                    setCoverMediaId(null)
                    setCoverUrl(null)
                  }}
                >
                  清除封面
                </button>
                <span className="blog-field-hint">建议横向高清图片，支持 PNG / JPG / WebP</span>
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void handleUploadCover(file)
                }}
              />
            </div>

            {/* Avatar */}
            <div className="blog-field">
              <span className="blog-field-label">博主头像</span>
              <div className="blog-settings-avatar-row">
                <div className="blog-settings-avatar-preview">
                  {avatarUrl ? <img src={avatarUrl} alt="头像预览" /> : avatarFallbackChar}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      className="blog-btn blog-btn-subtle blog-btn-sm"
                      disabled={uploadingAvatar}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <AppIcon name="upload" size={14} />
                      <span>{uploadingAvatar ? '上传中…' : '上传头像'}</span>
                    </button>
                    <button
                      type="button"
                      className="blog-btn blog-btn-ghost blog-btn-sm"
                      disabled={uploadingAvatar || (!avatarUrl && !avatarMediaId)}
                      onClick={() => {
                        setAvatarMediaId(null)
                        setAvatarUrl(null)
                      }}
                    >
                      清除头像
                    </button>
                  </div>
                  <span className="blog-field-hint">显示在封面右下角与每条动态左侧</span>
                </div>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void handleUploadAvatar(file)
                }}
              />
            </div>

            {/* Profile Texts */}
            <div className="blog-composer-grid">
              <label className="blog-field">
                <span className="blog-field-label">博客标题</span>
                <input
                  type="text"
                  className="blog-input"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="例如：我的生活与思考"
                />
              </label>

              <label className="blog-field">
                <span className="blog-field-label">展示昵称</span>
                <input
                  type="text"
                  className="blog-input"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="显示在封面与动态旁"
                />
              </label>
            </div>

            <label className="blog-field">
              <span className="blog-field-label">个性签名</span>
              <textarea
                className="blog-textarea"
                rows={2}
                style={{ minHeight: 68 }}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="写一句简短的个人简介或近况…"
              />
            </label>

            <label className="blog-field">
              <span className="blog-field-label">页脚文案</span>
              <input
                type="text"
                className="blog-input"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="例如：记录生活与阅读 · Powered by Do It Laaaaaater"
              />
            </label>

            {/* Allow Comments Switch */}
            <div className="blog-switch-row">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="blog-field-label" style={{ color: 'var(--blog-text)' }}>
                  允许访客发表留言
                </span>
                <span className="blog-field-hint">关闭后仅展示历史留言，访客无法提交新评论</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={allowComments}
                aria-label="允许访客发表留言"
                className={`blog-switch${allowComments ? ' is-checked' : ''}`}
                onClick={() => setAllowComments((prev) => !prev)}
              />
            </div>

            {/* RSS Subscription URL Box */}
            <div className="blog-field">
              <span className="blog-field-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <AppIcon name="rss" size={13} />
                <span>RSS 订阅地址</span>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text"
                  className="blog-input"
                  readOnly
                  value={rssUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ fontFamily: 'var(--blog-font-mono)', fontSize: 12.5 }}
                />
                <button type="button" className="blog-btn blog-btn-subtle" onClick={() => void handleCopyRss()}>
                  <AppIcon name={copiedRss ? 'check' : 'copy'} size={14} />
                  <span>{copiedRss ? '已复制' : '复制'}</span>
                </button>
              </div>
            </div>

            {/* Desktop Left/Right Bento Sidebar Widgets */}
            <div className="blog-field">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span className="blog-field-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <AppIcon name="sidebar" size={13} />
                  <span>桌面左右侧栏模块</span>
                </span>
                <span className="blog-field-hint">宽屏（≥1240px）展示三栏 Bento 卡片</span>
              </div>

              <div className="blog-settings-widgets" role="group" aria-label="桌面左右侧栏模块开关">
                {SIDEBAR_WIDGET_ORDER.map((widgetId) => {
                  const meta = BLOG_SIDEBAR_WIDGET_LABELS[widgetId]
                  const visible = !hiddenWidgets.includes(widgetId)
                  return (
                    <div key={widgetId} className="blog-settings-widget-item">
                      <div className="blog-settings-widget-info">
                        <span className="blog-settings-widget-name">{meta.label}</span>
                        <span className="blog-settings-widget-side">
                          {meta.side === 'left' ? '左栏' : '右栏'}
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={visible}
                        aria-label={`显示${meta.label}模块`}
                        className={`blog-switch${visible ? ' is-checked' : ''}`}
                        onClick={() => toggleSidebarWidget(widgetId)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* R2 Storage Usage & One-Click GC Panel */}
            <div className="blog-field">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span className="blog-field-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <AppIcon name="cpu" size={13} />
                  <span>R2 存储空间与清理</span>
                </span>
                <button
                  type="button"
                  className="blog-filter-reset"
                  disabled={loadingStorage || runningGc}
                  onClick={() => void loadStorageUsage()}
                >
                  {loadingStorage ? '统计中…' : '刷新统计'}
                </button>
              </div>

              <div className="blog-storage-card">
                {storageUsage ? (
                  <>
                    {(() => {
                      const quota =
                        storageUsage.quotaBytes > 0 ? storageUsage.quotaBytes : DEFAULT_R2_QUOTA_BYTES
                      const rawPct = (storageUsage.totalBytes / quota) * 100
                      const fillWidth =
                        storageUsage.totalBytes > 0 ? Math.min(100, Math.max(1.2, rawPct)) : 0
                      const toneClass =
                        rawPct > 90 ? ' is-danger' : rawPct > 75 ? ' is-warning' : ''
                      return (
                        <>
                          <div className="blog-storage-head">
                            <span className="blog-storage-usage-label">
                              已用 <strong>{formatBytes(storageUsage.totalBytes)}</strong> / 10 GB
                            </span>
                            <span className="blog-storage-usage-mono">
                              {rawPct < 0.01 && storageUsage.totalBytes > 0
                                ? '< 0.01%'
                                : `${rawPct.toFixed(rawPct >= 10 ? 1 : 2)}%`}
                            </span>
                          </div>
                          <div
                            className="blog-storage-bar"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.min(100, Math.round(rawPct))}
                            aria-label="R2 存储空间占用"
                          >
                            <div
                              className={`blog-storage-bar-fill${toneClass}`}
                              style={{ width: `${fillWidth}%` }}
                            />
                          </div>
                        </>
                      )
                    })()}

                    <div className="blog-storage-breakdown">
                      <div className="blog-storage-stat">
                        <span className="blog-storage-stat-label">稍后阅读图库</span>
                        <span className="blog-storage-stat-val">
                          {formatBytes(storageUsage.libraryAssetsBytes)}
                        </span>
                      </div>
                      <div className="blog-storage-stat">
                        <span className="blog-storage-stat-label">博客媒体</span>
                        <span className="blog-storage-stat-val">
                          {formatBytes(storageUsage.blogMediaBytes)}
                        </span>
                      </div>
                      <div className="blog-storage-stat">
                        <span className="blog-storage-stat-label">可回收孤儿媒体</span>
                        <span className="blog-storage-stat-val is-accent">
                          {storageUsage.orphanBlogMediaCount} 个 ·{' '}
                          {formatBytes(storageUsage.orphanBlogMediaBytes)}
                        </span>
                      </div>
                      {storageUsage.legacyMemoCount > 0 && (
                        <div className="blog-storage-stat">
                          <span className="blog-storage-stat-label">已废弃画布残留</span>
                          <span className="blog-storage-stat-val is-warning">
                            {storageUsage.legacyMemoCount} 项 ·{' '}
                            {formatBytes(storageUsage.memoAssetsBytes)}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="blog-storage-actions">
                      <label className="blog-storage-recent-opt">
                        <input
                          type="checkbox"
                          checked={includeRecentGc}
                          disabled={runningGc}
                          onChange={(e) => setIncludeRecentGc(e.target.checked)}
                        />
                        <span>同时清理近期未关联上传</span>
                      </label>
                      <button
                        type="button"
                        className="blog-btn blog-btn-subtle blog-btn-sm"
                        disabled={runningGc || loadingStorage}
                        onClick={() => void handleRunMediaGc()}
                      >
                        <AppIcon name="trash" size={13} />
                        <span>{runningGc ? '正在清理…' : '清理孤儿媒体'}</span>
                      </button>
                    </div>
                  </>
                ) : loadingStorage ? (
                  <div className="blog-field-hint" style={{ textAlign: 'center', padding: '10px 0' }}>
                    正在读取 R2 存储空间用量…
                  </div>
                ) : (
                  <div className="blog-field-hint" style={{ textAlign: 'center', padding: '8px 0' }}>
                    {storageError || '暂无法获取存储统计'}
                  </div>
                )}

                {storageError && storageUsage && (
                  <div className="blog-unlock-error" role="alert" style={{ textAlign: 'left' }}>
                    {storageError}
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'var(--blog-danger-soft)',
                  color: 'var(--blog-danger)',
                  fontSize: 13
                }}
              >
                {error}
              </div>
            )}
          </div>

          <footer className="blog-modal-footer">
            <span className="blog-field-hint">保存后立即同步到公开博客主页</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="blog-btn blog-btn-ghost" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button type="submit" className="blog-btn blog-btn-primary" disabled={busy}>
                <AppIcon name="check" size={14} />
                <span>{saving ? '保存中…' : '保存设置'}</span>
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}
