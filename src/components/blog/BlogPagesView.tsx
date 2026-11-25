import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent
} from 'react'
import { createPortal } from 'react-dom'
import {
  createBlogCatalogItem,
  createBlogFriend,
  createBlogPageComment,
  deleteBlogCatalogItem,
  deleteBlogFriend,
  deleteBlogPageComment,
  fetchBlogCatalog,
  fetchBlogFriends,
  fetchBlogPage,
  formatArticleDateTime,
  formatRelativeTime,
  readVisitorProfile,
  saveVisitorProfile,
  updateBlogCatalogItem,
  updateBlogFriend,
  updateBlogPage,
  uploadBlogMedia
} from '../../blog-api'
import { renderArticleMarkdown } from '../../blog-markdown'
import { useOptionalBlogMusic } from '../../blog-music'
import type {
  BlogCatalogItem,
  BlogCatalogSection,
  BlogComment,
  BlogFriend,
  BlogPageData,
  BlogProfile
} from '../../blog-types'
import { AppIcon } from '../AppIcon'
import { showToast } from '../Toast'

export interface BlogPagesViewProps {
  section: 'about' | 'equipment' | 'labs' | 'friends'
  profile: BlogProfile
  isOwner: boolean
  onBack: () => void
  onOpenLightbox: (images: Array<{ url: string; alt?: string }>, index: number) => void
}

interface ReplyTarget {
  parentId: string
  replyToId: string
  replyToName: string
}

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '🔥', '✨', '👏'] as const
const EQUIP_TAG_SUGGESTIONS = ['主力', '推荐', '便携', '服役中'] as const
const LAB_TAG_SUGGESTIONS = ['在线', '开源', '实验', '原型'] as const

function getErrorMessage(err: unknown, fallback = '操作失败，请稍后重试'): string {
  if (err instanceof Error && err.message) return err.message
  return fallback
}

function detectBlogTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const theme = document.querySelector<HTMLElement>('.blog-root')?.getAttribute('data-blog-theme')
  return theme === 'dark' ? 'dark' : 'light'
}

function getSafeExternalUrl(raw: string): string | null {
  const cleaned = (raw || '').trim()
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  return null
}

function getDomainBadge(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./i, '')
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0] || 'website'
  }
}

function getMonogram(name: string, fallback = 'B'): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return fallback
  return Array.from(trimmed)[0]?.toUpperCase() || fallback
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy textarea copy.
    }
  }
  if (typeof document === 'undefined') return false
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

function shuffleArray<T>(list: T[]): T[] {
  if (list.length <= 1) return [...list]
  const next = [...list]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
  }
  // Ensure order visibly changes when 2+ items exist
  const unchanged = next.every((item, idx) => item === list[idx])
  if (unchanged) {
    const first = next.shift()!
    next.push(first)
  }
  return next
}

/* --------------------------------------------------------------------------
   Standalone About Page Guestbook / Comment Board
   -------------------------------------------------------------------------- */

function AboutPageCommentBoard({
  slug,
  comments,
  allowComments,
  isOwner,
  ownerNickname,
  onCommentsChange
}: {
  slug: string
  comments: BlogComment[]
  allowComments: boolean
  isOwner: boolean
  ownerNickname: string
  onCommentsChange: (next: BlogComment[]) => void
}) {
  const initialVisitor = useMemo(() => readVisitorProfile(), [])
  const [composerExpanded, setComposerExpanded] = useState(false)
  const [content, setContent] = useState('')
  const [authorName, setAuthorName] = useState(initialVisitor.authorName)
  const [authorEmail, setAuthorEmail] = useState(initialVisitor.authorEmail)
  const [authorWebsite, setAuthorWebsite] = useState(initialVisitor.authorWebsite)
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({})

  const composerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const canComment = allowComments || isOwner

  const threads = useMemo(() => {
    const byId = new Map<string, BlogComment>()
    for (const c of comments) byId.set(c.id, c)

    const findRootId = (comment: BlogComment): string | null => {
      if (!comment.parentId) return null
      const visited = new Set<string>([comment.id])
      let cur = byId.get(comment.parentId)
      while (cur) {
        if (visited.has(cur.id)) return null
        visited.add(cur.id)
        if (!cur.parentId) return cur.id
        cur = byId.get(cur.parentId)
      }
      return null
    }

    const roots: BlogComment[] = []
    const repliesMap = new Map<string, BlogComment[]>()
    for (const c of comments) {
      const rootId = findRootId(c)
      if (!rootId) roots.push(c)
      else {
        const list = repliesMap.get(rootId)
        if (list) list.push(c)
        else repliesMap.set(rootId, [c])
      }
    }
    return roots.map((root) => ({ root, replies: repliesMap.get(root.id) ?? [] }))
  }, [comments])

  const focusComposer = (scroll = false) => {
    setComposerExpanded(true)
    window.requestAnimationFrame(() => {
      if (scroll) {
        composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      textareaRef.current?.focus()
    })
  }

  const persistVisitor = () => {
    if (isOwner) return
    saveVisitorProfile({ authorName, authorEmail, authorWebsite })
  }

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (submitting || !canComment) return

    const trimmed = content.trim()
    if (!trimmed) {
      setError('请输入留言内容')
      textareaRef.current?.focus()
      return
    }
    if (!isOwner && !authorName.trim()) {
      setError('请填写昵称')
      return
    }
    if (!isOwner) persistVisitor()

    setSubmitting(true)
    setError(null)
    try {
      const created = await createBlogPageComment(slug, {
        content: trimmed,
        ...(isOwner
          ? {}
          : {
              authorName: authorName.trim(),
              authorEmail: authorEmail.trim() || undefined,
              authorWebsite: authorWebsite.trim() || undefined
            }),
        ...(replyTarget
          ? {
              parentId: replyTarget.parentId,
              replyToId: replyTarget.replyToId,
              replyToName: replyTarget.replyToName
            }
          : {})
      })
      onCommentsChange([...comments, created])
      setContent('')
      setReplyTarget(null)
      showToast('success', '留言已发表')
    } catch (err) {
      const msg = getErrorMessage(err, '发表留言失败')
      setError(msg)
      showToast('error', msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSubmit()
    }
  }

  const handleDelete = async (comment: BlogComment, hasReplies = false) => {
    if (!isOwner || deletingIds[comment.id]) return
    const msg = hasReplies ? '确定删除这条留言及其回复吗？' : '确定删除这条留言吗？'
    if (!window.confirm(msg)) return

    setDeletingIds((prev) => ({ ...prev, [comment.id]: true }))
    try {
      await deleteBlogPageComment(comment.id)
      const removed = new Set<string>([comment.id])
      for (const item of comments) {
        if (item.parentId === comment.id || item.replyToId === comment.id) {
          removed.add(item.id)
        }
      }
      onCommentsChange(comments.filter((item) => !removed.has(item.id)))
      showToast('success', '留言已删除')
    } catch (err) {
      showToast('error', getErrorMessage(err, '删除留言失败'))
    } finally {
      setDeletingIds((prev) => {
        const next = { ...prev }
        delete next[comment.id]
        return next
      })
    }
  }

  const renderAuthor = (comment: BlogComment) => {
    const safeUrl = getSafeExternalUrl(comment.authorWebsite)
    return (
      <>
        {safeUrl ? (
          <a
            className="blog-comment-author"
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {comment.authorName}
          </a>
        ) : (
          <span className="blog-comment-author">{comment.authorName}</span>
        )}
        {comment.isOwner && <span className="blog-owner-pill">博主</span>}
      </>
    )
  }

  return (
    <section className="blog-floor-comments" aria-label="关于页留言板">
      <div className="blog-floor-header">
        <h2 className="blog-floor-title">
          <span>留言板</span>
          <span className="blog-floor-count">{comments.length}</span>
        </h2>

        {canComment && !composerExpanded && (
          <button
            type="button"
            className="blog-btn blog-btn-subtle blog-btn-sm"
            onClick={() => focusComposer(false)}
          >
            <AppIcon name="edit" size={13} />
            <span>写留言</span>
          </button>
        )}
      </div>

      {!canComment ? (
        <p className="blog-field-hint" style={{ margin: '0 0 18px' }}>
          博主已关闭此页面的访客留言
        </p>
      ) : (
        <div ref={composerRef}>
          {!composerExpanded ? (
            <div
              className="blog-floor-composer"
              role="button"
              tabIndex={0}
              onClick={() => focusComposer(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  focusComposer(false)
                }
              }}
              style={{
                cursor: 'text',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                color: 'var(--blog-text-muted)'
              }}
            >
              <span style={{ fontSize: 13.5 }}>打个招呼，留下你的足迹…</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: 'var(--blog-link)',
                  fontWeight: 500
                }}
              >
                <AppIcon name="comment" size={13} />
                <span>展开</span>
              </span>
            </div>
          ) : (
            <form className="blog-floor-composer" onSubmit={(e) => void handleSubmit(e)}>
              {replyTarget && (
                <div className="blog-p2-reply-banner">
                  <span>回复 @{replyTarget.replyToName}</span>
                  <button
                    type="button"
                    className="blog-floor-action-btn"
                    onClick={() => setReplyTarget(null)}
                    style={{ color: 'var(--blog-link)' }}
                  >
                    <AppIcon name="close" size={13} />
                    <span>取消</span>
                  </button>
                </div>
              )}

              {isOwner ? (
                <div className="blog-field-hint">
                  以博主「{ownerNickname}」身份发表留言
                  {!allowComments ? '（当前已关闭访客留言）' : ''}
                </div>
              ) : (
                <div className="blog-comment-guest-row">
                  <input
                    type="text"
                    placeholder="昵称 *"
                    value={authorName}
                    onChange={(e) => {
                      setAuthorName(e.target.value)
                      if (error) setError(null)
                    }}
                    onBlur={persistVisitor}
                    disabled={submitting}
                    aria-label="昵称"
                    required
                  />
                  <input
                    type="email"
                    placeholder="邮箱 (选填)"
                    value={authorEmail}
                    onChange={(e) => setAuthorEmail(e.target.value)}
                    onBlur={persistVisitor}
                    disabled={submitting}
                    aria-label="邮箱"
                  />
                  <input
                    type="url"
                    placeholder="网址 (选填)"
                    value={authorWebsite}
                    onChange={(e) => setAuthorWebsite(e.target.value)}
                    onBlur={persistVisitor}
                    disabled={submitting}
                    aria-label="网址"
                  />
                </div>
              )}

              <textarea
                ref={textareaRef}
                className="blog-textarea"
                rows={3}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  if (error) setError(null)
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  replyTarget
                    ? `回复 @${replyTarget.replyToName}…`
                    : '写下你的留言…（Ctrl/Cmd + Enter 快捷发送）'
                }
                disabled={submitting}
                style={{ minHeight: 84 }}
              />

              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="blog-floor-action-btn"
                    disabled={submitting}
                    onClick={() => setContent((prev) => prev + emoji)}
                    style={{ fontSize: 15, padding: '3px 6px', lineHeight: 1.2 }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {error && (
                <p className="blog-unlock-error" role="alert" style={{ textAlign: 'left' }}>
                  {error}
                </p>
              )}

              <div className="blog-floor-composer-footer">
                <span className="blog-field-hint">Ctrl/Cmd + Enter 发送</span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="blog-btn blog-btn-ghost blog-btn-sm"
                    disabled={submitting}
                    onClick={() => {
                      setComposerExpanded(false)
                      setReplyTarget(null)
                      setError(null)
                    }}
                  >
                    收起
                  </button>
                  <button
                    type="submit"
                    className="blog-btn blog-btn-primary blog-btn-sm"
                    disabled={submitting || !content.trim()}
                  >
                    <AppIcon name="send" size={13} />
                    <span>{submitting ? '发表中…' : '发表留言'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {threads.length === 0 ? (
        <div className="blog-field-hint" style={{ textAlign: 'center', padding: '18px 0 6px' }}>
          {canComment ? '还没有留言，来打个招呼吧' : '暂无留言'}
        </div>
      ) : (
        <div>
          {threads.map(({ root, replies }) => (
            <div key={root.id} className="blog-floor-thread">
              <div
                className={`blog-floor-avatar${root.isOwner ? ' is-owner' : ''}`}
                aria-hidden="true"
              >
                {getMonogram(root.authorName, '?')}
              </div>

              <div className="blog-floor-main">
                <div className="blog-floor-meta">
                  <div className="blog-floor-author-line">{renderAuthor(root)}</div>
                  <span className="blog-article-meta-mono" style={{ color: 'var(--blog-text-muted)' }}>
                    {formatRelativeTime(root.createdAt)}
                  </span>
                </div>

                <div className="blog-floor-content">{root.content}</div>

                <div className="blog-floor-actions">
                  {canComment && (
                    <button
                      type="button"
                      className="blog-floor-action-btn"
                      onClick={() => {
                        setReplyTarget({
                          parentId: root.id,
                          replyToId: root.id,
                          replyToName: root.authorName
                        })
                        focusComposer(true)
                      }}
                    >
                      <AppIcon name="comment" size={13} />
                      <span>回复</span>
                    </button>
                  )}

                  {isOwner && (
                    <button
                      type="button"
                      className="blog-floor-action-btn is-danger"
                      disabled={Boolean(deletingIds[root.id])}
                      onClick={() => void handleDelete(root, replies.length > 0)}
                    >
                      <AppIcon name="trash" size={13} />
                      <span>删除</span>
                    </button>
                  )}
                </div>

                {replies.length > 0 && (
                  <div className="blog-floor-replies">
                    {replies.map((reply) => {
                      const showReplyTo = Boolean(
                        reply.replyToName && (!reply.replyToId || reply.replyToId !== root.id)
                      )
                      return (
                        <div key={reply.id} className="blog-floor-reply-item">
                          <div>
                            {renderAuthor(reply)}
                            {showReplyTo && (
                              <span className="blog-comment-reply-label">
                                回复 @{reply.replyToName}
                              </span>
                            )}
                            <span style={{ color: 'var(--blog-text-muted)', marginRight: 4 }}>：</span>
                            <span style={{ whiteSpace: 'pre-wrap' }}>{reply.content}</span>
                          </div>

                          <div className="blog-floor-actions" style={{ marginTop: 4 }}>
                            <span>{formatRelativeTime(reply.createdAt)}</span>
                            {canComment && (
                              <button
                                type="button"
                                className="blog-floor-action-btn"
                                onClick={() => {
                                  setReplyTarget({
                                    parentId: root.id,
                                    replyToId: reply.id,
                                    replyToName: reply.authorName
                                  })
                                  focusComposer(true)
                                }}
                              >
                                回复
                              </button>
                            )}
                            {isOwner && (
                              <button
                                type="button"
                                className="blog-floor-action-btn is-danger"
                                disabled={Boolean(deletingIds[reply.id])}
                                onClick={() => void handleDelete(reply)}
                              >
                                删除
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* --------------------------------------------------------------------------
   Owner Modals: About Editor / Catalog Editor / Friend Editor
   -------------------------------------------------------------------------- */

function AboutPageEditorModal({
  open,
  page,
  onClose,
  onSaved
}: {
  open: boolean
  page: BlogPageData
  onClose: () => void
  onSaved: (updated: BlogPageData) => void
}) {
  const [blogTheme, setBlogTheme] = useState<'light' | 'dark'>('light')
  const [title, setTitle] = useState(page.title || '关于我')
  const [subtitle, setSubtitle] = useState(page.subtitle || '')
  const [content, setContent] = useState(page.content || '')
  const [coverMediaId, setCoverMediaId] = useState<string | null>(page.coverMediaId)
  const [coverUrl, setCoverUrl] = useState<string | null>(page.coverUrl)
  const [allowComments, setAllowComments] = useState(page.allowComments)
  const [previewMode, setPreviewMode] = useState<'write' | 'split' | 'preview'>('split')
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingInline, setUploadingInline] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const inlineImgInputRef = useRef<HTMLInputElement | null>(null)
  const busy = uploadingCover || uploadingInline || saving

  const isDirty = useMemo(() => {
    return (
      title !== (page.title || '关于我') ||
      subtitle !== (page.subtitle || '') ||
      content !== (page.content || '') ||
      (coverMediaId ?? null) !== (page.coverMediaId ?? null) ||
      (coverUrl ?? null) !== (page.coverUrl ?? null) ||
      allowComments !== Boolean(page.allowComments)
    )
  }, [title, subtitle, content, coverMediaId, coverUrl, allowComments, page])

  const attemptClose = useCallback(() => {
    if (busy) return
    if (isDirty && !window.confirm('当前关于页修改尚未保存，确定关闭吗？')) {
      return
    }
    onClose()
  }, [busy, isDirty, onClose])

  useEffect(() => {
    if (!open) return
    setBlogTheme(detectBlogTheme())
    setTitle(page.title || '关于我')
    setSubtitle(page.subtitle || '')
    setContent(page.content || '')
    setCoverMediaId(page.coverMediaId)
    setCoverUrl(page.coverUrl)
    setAllowComments(page.allowComments)
    setError('')
  }, [open, page])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        attemptClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, busy, attemptClose])

  useEffect(() => {
    if (!open || !isDirty || typeof window === 'undefined') return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [open, isDirty])

  const renderedPreview = useMemo(() => renderArticleMarkdown(content), [content])

  const handleUploadCover = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingCover(true)
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        setCoverMediaId(uploaded.id)
        setCoverUrl(uploaded.url)
        showToast('success', '关于页横幅已上传')
      }
    } catch (err) {
      showToast('error', getErrorMessage(err, '封面上传失败'))
    } finally {
      setUploadingCover(false)
    }
  }

  const handleInsertImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingInline(true)
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        const mdImage = `\n![${file.name.replace(/\.[^.]+$/, '')}](${uploaded.url})\n`
        setContent((prev) => `${prev}${mdImage}`)
        showToast('success', '图片已插入正文')
      }
    } catch (err) {
      showToast('error', getErrorMessage(err, '图片上传失败'))
    } finally {
      setUploadingInline(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const cleanTitle = title.trim() || '关于我'
    setSaving(true)
    setError('')
    try {
      const updated = await updateBlogPage('about', {
        title: cleanTitle,
        subtitle: subtitle.trim(),
        content,
        coverMediaId,
        allowComments
      })
      onSaved(updated)
      showToast('success', '关于页已保存')
    } catch (err) {
      const msg = getErrorMessage(err, '保存失败')
      setError(msg)
      showToast('error', msg)
    } finally {
      setSaving(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="blog-root blog-modal-backdrop"
      data-blog-theme={blogTheme}
      style={{ minHeight: 0, zIndex: 1020 }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) attemptClose()
      }}
    >
      <section role="dialog" aria-modal="true" aria-label="编辑关于页" className="blog-composer-modal is-article">
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'inherit', flex: 1 }}
        >
          <header className="blog-modal-header">
            <h2 className="blog-modal-title">编辑「关于我」页面</h2>
            <button
              type="button"
              className="blog-btn blog-btn-icon"
              disabled={busy}
              onClick={attemptClose}
              aria-label="关闭"
            >
              <AppIcon name="close" size={16} />
            </button>
          </header>

          <div className="blog-modal-body">
            <div className="blog-composer-grid">
              <label className="blog-field">
                <span className="blog-field-label">页面标题 *</span>
                <input
                  type="text"
                  className="blog-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="关于我"
                  required
                />
              </label>

              <label className="blog-field">
                <span className="blog-field-label">副标题 / 一句话定位</span>
                <input
                  type="text"
                  className="blog-input"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="数字花园 · 独立开发 · 阅读与摄影"
                />
              </label>
            </div>

            <div className="blog-field">
              <span className="blog-field-label">顶部封面（选填）</span>
              {coverUrl && (
                <div className="blog-settings-cover-preview" style={{ height: 132 }}>
                  <img src={coverUrl} alt="封面预览" />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="blog-btn blog-btn-subtle blog-btn-sm"
                  disabled={uploadingCover}
                  onClick={() => coverInputRef.current?.click()}
                >
                  <AppIcon name="upload" size={13} />
                  <span>{uploadingCover ? '上传中…' : coverUrl ? '更换封面' : '上传封面'}</span>
                </button>
                {coverUrl && (
                  <button
                    type="button"
                    className="blog-btn blog-btn-ghost blog-btn-sm"
                    onClick={() => {
                      setCoverMediaId(null)
                      setCoverUrl(null)
                    }}
                  >
                    移除封面
                  </button>
                )}
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => void handleUploadCover(e)}
                />
              </div>
            </div>

            <div className="blog-field">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span className="blog-field-label">Markdown 正文</span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="blog-btn blog-btn-subtle blog-btn-sm"
                    disabled={uploadingInline}
                    onClick={() => inlineImgInputRef.current?.click()}
                  >
                    <AppIcon name="image" size={13} />
                    <span>{uploadingInline ? '上传中…' : '插入图片'}</span>
                  </button>
                  <input
                    ref={inlineImgInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => void handleInsertImage(e)}
                  />

                  <div className="blog-segmented">
                    <button
                      type="button"
                      className={`blog-segmented-btn${previewMode === 'write' ? ' is-active' : ''}`}
                      onClick={() => setPreviewMode('write')}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className={`blog-segmented-btn${previewMode === 'split' ? ' is-active' : ''}`}
                      onClick={() => setPreviewMode('split')}
                    >
                      分栏
                    </button>
                    <button
                      type="button"
                      className={`blog-segmented-btn${previewMode === 'preview' ? ' is-active' : ''}`}
                      onClick={() => setPreviewMode('preview')}
                    >
                      预览
                    </button>
                  </div>
                </div>
              </div>

              <div className={`blog-md-split${previewMode !== 'split' ? ' is-single-pane' : ''}`}>
                {previewMode !== 'preview' && (
                  <textarea
                    className="blog-md-editor"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="支持完整 GFM Markdown、表格、代码块、引用与任务列表…"
                  />
                )}
                {previewMode !== 'write' && (
                  <div
                    className="blog-md-preview blog-article-content"
                    dangerouslySetInnerHTML={{
                      __html:
                        renderedPreview.html ||
                        '<p style="color:var(--blog-text-muted)">实时预览区域…</p>'
                    }}
                  />
                )}
              </div>
            </div>

            <div className="blog-switch-row">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="blog-field-label" style={{ color: 'var(--blog-text)' }}>
                  开启关于页留言板
                </span>
                <span className="blog-field-hint">允许访客在关于页底部直接留言互动</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={allowComments}
                className={`blog-switch${allowComments ? ' is-checked' : ''}`}
                onClick={() => setAllowComments((prev) => !prev)}
              />
            </div>

            {error && (
              <div className="blog-p2-inline-alert" role="alert">
                {error}
              </div>
            )}
          </div>

          <footer className="blog-modal-footer">
            <span className="blog-field-hint">{renderedPreview.wordCount} 字</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="blog-btn blog-btn-ghost" disabled={busy} onClick={attemptClose}>
                取消
              </button>
              <button type="submit" className="blog-btn blog-btn-primary" disabled={busy}>
                <AppIcon name="check" size={14} />
                <span>{saving ? '保存中…' : '保存页面'}</span>
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}

function CatalogEditorModal({
  open,
  section,
  editingItem,
  defaultSortOrder,
  onClose,
  onSaved,
  onDeleted
}: {
  open: boolean
  section: BlogCatalogSection
  editingItem: BlogCatalogItem | null
  defaultSortOrder: number
  onClose: () => void
  onSaved: (item: BlogCatalogItem) => void
  onDeleted: (id: string) => void
}) {
  const isEquip = section === 'equipment'
  const [blogTheme, setBlogTheme] = useState<'light' | 'dark'>('light')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [tag, setTag] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [description, setDescription] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [imageMediaId, setImageMediaId] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [sortOrder, setSortOrder] = useState(0)

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const imgInputRef = useRef<HTMLInputElement | null>(null)
  const busy = uploading || saving || deleting

  useEffect(() => {
    if (!open) return
    setBlogTheme(detectBlogTheme())
    setTitle(editingItem?.title || '')
    setCategory(editingItem?.category || (isEquip ? '硬件主力' : 'Web 实验'))
    setTag(editingItem?.tag || (isEquip ? '主力' : '在线'))
    setSubtitle(editingItem?.subtitle || '')
    setDescription(editingItem?.description || '')
    setLinkUrl(editingItem?.linkUrl || '')
    setImageMediaId(editingItem?.imageMediaId ?? null)
    setImageUrl(editingItem?.imageUrl || '')
    setSortOrder(editingItem?.sortOrder ?? defaultSortOrder)
    setError('')
  }, [open, editingItem, isEquip, defaultSortOrder])

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

  const handleUploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        setImageMediaId(uploaded.id)
        setImageUrl(uploaded.url)
        showToast('success', '图片已上传')
      }
    } catch (err) {
      showToast('error', getErrorMessage(err, '上传失败'))
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!title.trim()) {
      setError('请填写名称')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        section,
        title: title.trim(),
        category: category.trim(),
        tag: tag.trim(),
        subtitle: subtitle.trim(),
        description: description.trim(),
        linkUrl: linkUrl.trim(),
        imageMediaId,
        imageUrl: imageUrl.trim() || null,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0
      }
      const saved = editingItem
        ? await updateBlogCatalogItem(editingItem.id, payload)
        : await createBlogCatalogItem(payload)
      onSaved(saved)
      showToast('success', editingItem ? '已保存修改' : '已添加条目')
    } catch (err) {
      const msg = getErrorMessage(err, '保存失败')
      setError(msg)
      showToast('error', msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editingItem || busy) return
    if (!window.confirm(`确定要删除「${editingItem.title}」吗？`)) return
    setDeleting(true)
    try {
      await deleteBlogCatalogItem(editingItem.id)
      onDeleted(editingItem.id)
      showToast('success', '已删除')
    } catch (err) {
      showToast('error', getErrorMessage(err, '删除失败'))
    } finally {
      setDeleting(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const tagSuggestions = isEquip ? EQUIP_TAG_SUGGESTIONS : LAB_TAG_SUGGESTIONS

  return createPortal(
    <div
      className="blog-root blog-modal-backdrop"
      data-blog-theme={blogTheme}
      style={{ minHeight: 0, zIndex: 1020 }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <section role="dialog" aria-modal="true" className="blog-settings-modal">
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'inherit', flex: 1 }}
        >
          <header className="blog-modal-header">
            <h2 className="blog-modal-title">
              {editingItem
                ? isEquip
                  ? '编辑装备'
                  : '编辑实验室项目'
                : isEquip
                  ? '添加新装备'
                  : '添加实验室项目'}
            </h2>
            <button type="button" className="blog-btn blog-btn-icon" disabled={busy} onClick={onClose}>
              <AppIcon name="close" size={16} />
            </button>
          </header>

          <div className="blog-modal-body">
            <div className="blog-composer-grid">
              <label className="blog-field">
                <span className="blog-field-label">{isEquip ? '装备名称 *' : '项目名称 *'}</span>
                <input
                  type="text"
                  className="blog-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isEquip ? '例如：MacBook Pro 14"' : '例如：Do It Laaaaaater'}
                  required
                />
              </label>

              <label className="blog-field">
                <span className="blog-field-label">{isEquip ? '所属分类' : '领域分类'}</span>
                <input
                  type="text"
                  className="blog-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder={isEquip ? '硬件 / 外设 / 软件 / 摄影' : 'AI 工具 / Web 应用 / 脚本'}
                />
              </label>
            </div>

            <div className="blog-composer-grid">
              <label className="blog-field">
                <span className="blog-field-label">{isEquip ? '规格参数（Mono）' : '技术栈 / 副标题'}</span>
                <input
                  type="text"
                  className="blog-input"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder={isEquip ? 'M3 Max · 64GB · 2TB' : 'React 19 · Cloudflare D1 + R2'}
                />
              </label>

              <div className="blog-field">
                <span className="blog-field-label">{isEquip ? '状态徽章' : '项目状态'}</span>
                <input
                  type="text"
                  className="blog-input"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder={isEquip ? '主力 / 推荐' : '在线 / 开源 / 实验'}
                />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {tagSuggestions.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`blog-tag-chip${tag === preset ? ' is-active' : ''}`}
                      onClick={() => setTag(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="blog-field">
              <span className="blog-field-label">{isEquip ? '使用体验与点评' : '项目简介'}</span>
              <textarea
                className="blog-textarea"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={isEquip ? '聊聊为什么喜欢它、解决了什么痛点…' : '用两三句话介绍核心功能与设计思路…'}
              />
            </label>

            <div className="blog-field">
              <span className="blog-field-label">配图 / 图标（上传至 R2 或填写图片 URL）</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="blog-p2-manager-cover-slot">
                  {imageUrl ? (
                    <img src={imageUrl} alt="预览" />
                  ) : (
                    <AppIcon name={isEquip ? 'cpu' : 'flask'} size={20} />
                  )}
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="blog-btn blog-btn-subtle blog-btn-sm"
                      disabled={uploading}
                      onClick={() => imgInputRef.current?.click()}
                    >
                      <AppIcon name="upload" size={13} />
                      <span>{uploading ? '上传中…' : '上传图片'}</span>
                    </button>
                    {imageUrl && (
                      <button
                        type="button"
                        className="blog-btn blog-btn-ghost blog-btn-sm"
                        onClick={() => {
                          setImageMediaId(null)
                          setImageUrl('')
                        }}
                      >
                        清除
                      </button>
                    )}
                  </div>
                  <input
                    type="url"
                    className="blog-input"
                    value={imageUrl}
                    onChange={(e) => {
                      setImageUrl(e.target.value)
                      setImageMediaId(null)
                    }}
                    placeholder="或粘贴 https:// 图片地址"
                  />
                </div>
                <input
                  ref={imgInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => void handleUploadImage(e)}
                />
              </div>
            </div>

            <div className="blog-composer-grid">
              <label className="blog-field">
                <span className="blog-field-label">{isEquip ? '详情 / 购买外链（选填）' : '体验 / 仓库地址'}</span>
                <input
                  type="url"
                  className="blog-input"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                />
              </label>

              <label className="blog-field">
                <span className="blog-field-label">排序权重（越小越靠前）</span>
                <input
                  type="number"
                  className="blog-input"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                />
              </label>
            </div>

            {error && (
              <div className="blog-p2-inline-alert" role="alert">
                {error}
              </div>
            )}
          </div>

          <footer className="blog-modal-footer">
            <div>
              {editingItem && (
                <button
                  type="button"
                  className="blog-btn blog-btn-danger blog-btn-sm"
                  disabled={busy}
                  onClick={() => void handleDelete()}
                >
                  <AppIcon name="trash" size={14} />
                  <span>{deleting ? '删除中…' : '删除'}</span>
                </button>
              )}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="blog-btn blog-btn-ghost" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button type="submit" className="blog-btn blog-btn-primary" disabled={busy}>
                <AppIcon name="check" size={14} />
                <span>{saving ? '保存中…' : '保存'}</span>
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}

function FriendEditorModal({
  open,
  editingFriend,
  defaultSortOrder,
  onClose,
  onSaved,
  onDeleted
}: {
  open: boolean
  editingFriend: BlogFriend | null
  defaultSortOrder: number
  onClose: () => void
  onSaved: (friend: BlogFriend) => void
  onDeleted: (id: string) => void
}) {
  const [blogTheme, setBlogTheme] = useState<'light' | 'dark'>('light')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [sortOrder, setSortOrder] = useState(0)

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const busy = uploading || saving || deleting

  useEffect(() => {
    if (!open) return
    setBlogTheme(detectBlogTheme())
    setName(editingFriend?.name || '')
    setUrl(editingFriend?.url || '')
    setDescription(editingFriend?.description || '')
    setAvatarMediaId(editingFriend?.avatarMediaId ?? null)
    setAvatarUrl(editingFriend?.avatarUrl || '')
    setSortOrder(editingFriend?.sortOrder ?? defaultSortOrder)
    setError('')
  }, [open, editingFriend, defaultSortOrder])

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

  const handleUploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        setAvatarMediaId(uploaded.id)
        setAvatarUrl(uploaded.url)
        showToast('success', '头像已上传')
      }
    } catch (err) {
      showToast('error', getErrorMessage(err, '头像上传失败'))
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!name.trim()) {
      setError('请填写站点或朋友名称')
      return
    }
    const cleanUrl = url.trim()
    if (!/^https?:\/\//i.test(cleanUrl)) {
      setError('请填写以 http:// 或 https:// 开头的完整网址')
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        name: name.trim(),
        url: cleanUrl,
        description: description.trim(),
        avatarMediaId,
        avatarUrl: avatarUrl.trim(),
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0
      }
      const saved = editingFriend
        ? await updateBlogFriend(editingFriend.id, payload)
        : await createBlogFriend(payload)
      onSaved(saved)
      showToast('success', editingFriend ? '友链已更新' : '友链已添加')
    } catch (err) {
      const msg = getErrorMessage(err, '保存友链失败')
      setError(msg)
      showToast('error', msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editingFriend || busy) return
    if (!window.confirm(`确定要删除友链「${editingFriend.name}」吗？`)) return
    setDeleting(true)
    try {
      await deleteBlogFriend(editingFriend.id)
      onDeleted(editingFriend.id)
      showToast('success', '友链已删除')
    } catch (err) {
      showToast('error', getErrorMessage(err, '删除失败'))
    } finally {
      setDeleting(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="blog-root blog-modal-backdrop"
      data-blog-theme={blogTheme}
      style={{ minHeight: 0, zIndex: 1020 }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <section role="dialog" aria-modal="true" className="blog-settings-modal">
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'inherit', flex: 1 }}
        >
          <header className="blog-modal-header">
            <h2 className="blog-modal-title">{editingFriend ? '编辑友链' : '添加友链'}</h2>
            <button type="button" className="blog-btn blog-btn-icon" disabled={busy} onClick={onClose}>
              <AppIcon name="close" size={16} />
            </button>
          </header>

          <div className="blog-modal-body">
            <div className="blog-field">
              <span className="blog-field-label">头像（上传至 R2 或粘贴头像 URL）</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="blog-p2-friend-avatar is-preview">
                  {avatarUrl ? <img src={avatarUrl} alt="头像预览" /> : getMonogram(name, '友')}
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="blog-btn blog-btn-subtle blog-btn-sm"
                      disabled={uploading}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <AppIcon name="upload" size={13} />
                      <span>{uploading ? '上传中…' : '上传头像'}</span>
                    </button>
                    {avatarUrl && (
                      <button
                        type="button"
                        className="blog-btn blog-btn-ghost blog-btn-sm"
                        onClick={() => {
                          setAvatarMediaId(null)
                          setAvatarUrl('')
                        }}
                      >
                        清除
                      </button>
                    )}
                  </div>
                  <input
                    type="url"
                    className="blog-input"
                    value={avatarUrl}
                    onChange={(e) => {
                      setAvatarUrl(e.target.value)
                      setAvatarMediaId(null)
                    }}
                    placeholder="或粘贴 https:// 头像图片地址"
                  />
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => void handleUploadAvatar(e)}
                />
              </div>
            </div>

            <div className="blog-composer-grid">
              <label className="blog-field">
                <span className="blog-field-label">站点 / 朋友名称 *</span>
                <input
                  type="text"
                  className="blog-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：Anthony Fu"
                  required
                />
              </label>

              <label className="blog-field">
                <span className="blog-field-label">站点链接 *</span>
                <input
                  type="url"
                  className="blog-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                />
              </label>
            </div>

            <label className="blog-field">
              <span className="blog-field-label">一句话简介（选填）</span>
              <textarea
                className="blog-textarea"
                rows={2}
                style={{ minHeight: 68 }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="记录设计、工程与生活的朋友…"
              />
            </label>

            <label className="blog-field">
              <span className="blog-field-label">排序权重（越小越靠前）</span>
              <input
                type="number"
                className="blog-input"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              />
            </label>

            {error && (
              <div className="blog-p2-inline-alert" role="alert">
                {error}
              </div>
            )}
          </div>

          <footer className="blog-modal-footer">
            <div>
              {editingFriend && (
                <button
                  type="button"
                  className="blog-btn blog-btn-danger blog-btn-sm"
                  disabled={busy}
                  onClick={() => void handleDelete()}
                >
                  <AppIcon name="trash" size={14} />
                  <span>{deleting ? '删除中…' : '删除'}</span>
                </button>
              )}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="blog-btn blog-btn-ghost" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button type="submit" className="blog-btn blog-btn-primary" disabled={busy}>
                <AppIcon name="check" size={14} />
                <span>{saving ? '保存中…' : '保存友链'}</span>
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}

/* --------------------------------------------------------------------------
   Main Standalone Pages View (/blog/about, /equipment, /labs, /friends)
   -------------------------------------------------------------------------- */

export function BlogPagesView({
  section,
  profile,
  isOwner,
  onBack,
  onOpenLightbox
}: BlogPagesViewProps) {
  const musicCtx = useOptionalBlogMusic()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Section data states
  const [aboutPage, setAboutPage] = useState<BlogPageData | null>(null)
  const [catalogItems, setCatalogItems] = useState<BlogCatalogItem[]>([])
  const [friends, setFriends] = useState<BlogFriend[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('all')

  // Owner modals
  const [aboutEditorOpen, setAboutEditorOpen] = useState(false)
  const [catalogModalOpen, setCatalogModalOpen] = useState(false)
  const [editingCatalogItem, setEditingCatalogItem] = useState<BlogCatalogItem | null>(null)
  const [friendModalOpen, setFriendModalOpen] = useState(false)
  const [editingFriend, setEditingFriend] = useState<BlogFriend | null>(null)

  const markdownRef = useRef<HTMLDivElement | null>(null)
  const copyTimersRef = useRef<Map<HTMLButtonElement, number>>(new Map())

  useEffect(() => {
    const timers = copyTimersRef.current
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      timers.clear()
    }
  }, [])

  const loadSectionData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setActiveCategory('all')
    try {
      if (section === 'about') {
        const page = await fetchBlogPage('about')
        setAboutPage(page)
      } else if (section === 'equipment' || section === 'labs') {
        const res = await fetchBlogCatalog(section)
        setCatalogItems(res.items || [])
      } else if (section === 'friends') {
        const res = await fetchBlogFriends()
        setFriends(res.friends || [])
      }
    } catch (err) {
      setLoadError(getErrorMessage(err, '加载页面失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }, [section])

  useEffect(() => {
    void loadSectionData()
  }, [loadSectionData])

  const renderedAbout = useMemo(() => {
    if (section !== 'about' || !aboutPage?.content) return null
    return renderArticleMarkdown(aboutPage.content)
  }, [section, aboutPage?.content])

  const discoveredCategories = useMemo(() => {
    const seen = new Set<string>()
    for (const item of catalogItems) {
      const cat = (item.category || '').trim()
      if (cat) seen.add(cat)
    }
    return Array.from(seen)
  }, [catalogItems])

  const filteredCatalogItems = useMemo(() => {
    if (activeCategory === 'all') return catalogItems
    return catalogItems.filter((item) => (item.category || '').trim() === activeCategory)
  }, [catalogItems, activeCategory])

  const handleMarkdownClick = async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    const copyBtn = target.closest<HTMLButtonElement>('[data-code-copy]')
    if (copyBtn) {
      const block = copyBtn.closest('.blog-code-block')
      const codeText = block?.querySelector('pre code')?.textContent ?? ''
      const ok = await copyTextToClipboard(codeText)
      if (!ok) {
        showToast('error', '复制代码失败')
        return
      }
      const prev = copyTimersRef.current.get(copyBtn)
      if (prev !== undefined) window.clearTimeout(prev)
      copyBtn.textContent = '已复制'
      copyBtn.classList.add('is-copied')
      const timerId = window.setTimeout(() => {
        copyBtn.textContent = '复制'
        copyBtn.classList.remove('is-copied')
        copyTimersRef.current.delete(copyBtn)
      }, 2000)
      copyTimersRef.current.set(copyBtn, timerId)
      return
    }

    const imgEl = target.closest<HTMLImageElement>('img[data-lightbox-src]')
    if (imgEl && markdownRef.current) {
      const allImgs = Array.from(
        markdownRef.current.querySelectorAll<HTMLImageElement>('img[data-lightbox-src]')
      )
      const images = allImgs.map((el) => ({
        url: el.getAttribute('data-lightbox-src') || el.src,
        alt: el.alt || undefined
      }))
      onOpenLightbox(images, Math.max(0, allImgs.indexOf(imgEl)))
    }
  }

  const handleShuffleFriends = () => {
    setFriends((prev) => shuffleArray(prev))
  }

  const pageTitle =
    section === 'about'
      ? aboutPage?.title || '关于我'
      : section === 'equipment'
        ? '我的装备'
        : section === 'labs'
          ? '实验室'
          : '友人帐'

  const handlePrimaryOwnerAction = () => {
    if (section === 'about') {
      if (!aboutPage) {
        setAboutPage({
          slug: 'about',
          title: '关于我',
          subtitle: '数字花园与个人简介',
          content: '',
          coverMediaId: null,
          coverUrl: null,
          allowComments: true,
          updatedAt: 0,
          comments: []
        })
      }
      setAboutEditorOpen(true)
    } else if (section === 'equipment' || section === 'labs') {
      setEditingCatalogItem(null)
      setCatalogModalOpen(true)
    } else {
      setEditingFriend(null)
      setFriendModalOpen(true)
    }
  }

  return (
    <>
      <header className="blog-sticky-bar">
        <button type="button" className="blog-sticky-back" onClick={onBack}>
          <AppIcon name="arrowLeft" size={16} />
          <span>返回朋友圈</span>
        </button>

        <div className="blog-sticky-title" title={pageTitle}>
          {pageTitle}
        </div>

        <div className="blog-sticky-actions">
          {musicCtx?.currentTrack && (
            <button
              type="button"
              className={`blog-p2-article-music${musicCtx.isPlaying ? ' is-playing' : ''}`}
              onClick={musicCtx.openDrawer}
              title="打开播放器与歌词"
            >
              <AppIcon name={musicCtx.isPlaying ? 'pause' : 'music'} size={12} />
              <span>{musicCtx.currentLyricLine || musicCtx.currentTrack.title}</span>
            </button>
          )}

          {isOwner && (
            <button
              type="button"
              className="blog-btn blog-btn-primary blog-btn-sm"
              onClick={handlePrimaryOwnerAction}
            >
              <AppIcon name={section === 'about' ? 'edit' : 'plus'} size={13} />
              <span>{section === 'about' ? '编辑页面' : '添加'}</span>
            </button>
          )}
        </div>
      </header>

      <div className="blog-p2-page">
        {loading ? (
          <div className="blog-empty">
            <span className="blog-field-hint">正在加载 {pageTitle}…</span>
          </div>
        ) : loadError ? (
          <div className="blog-empty">
            <div className="blog-empty-icon">
              <AppIcon name="offline" size={20} />
            </div>
            <p className="blog-empty-title">加载失败</p>
            <p className="blog-empty-desc">{loadError}</p>
            <button
              type="button"
              className="blog-btn blog-btn-subtle blog-btn-sm"
              onClick={() => void loadSectionData()}
            >
              重试
            </button>
          </div>
        ) : section === 'about' && aboutPage ? (
          <>
            {aboutPage.coverUrl && (
              <img
                src={aboutPage.coverUrl}
                alt={aboutPage.title || '关于封面'}
                className="blog-article-cover"
                style={{ marginTop: 0, cursor: 'zoom-in' }}
                onClick={() =>
                  onOpenLightbox([{ url: aboutPage.coverUrl!, alt: aboutPage.title }], 0)
                }
              />
            )}

            <div className="blog-p2-page-hero">
              <div className="blog-p2-about-identity">
                <div className="blog-p2-about-avatar">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={profile.nickname} />
                  ) : (
                    getMonogram(profile.nickname || profile.siteName)
                  )}
                </div>
                <div>
                  <h1 className="blog-p2-page-title">{aboutPage.title || '关于我'}</h1>
                  {(aboutPage.subtitle || profile.bio) && (
                    <p className="blog-p2-page-subtitle">{aboutPage.subtitle || profile.bio}</p>
                  )}
                  {aboutPage.updatedAt > 0 && (
                    <span className="blog-article-meta-mono" style={{ color: 'var(--blog-text-muted)' }}>
                      最近更新：{formatArticleDateTime(aboutPage.updatedAt)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {renderedAbout && aboutPage.content.trim() ? (
              <div
                ref={markdownRef}
                className="blog-article-content"
                dangerouslySetInnerHTML={{ __html: renderedAbout.html }}
                onClick={(e) => void handleMarkdownClick(e)}
              />
            ) : (
              <div className="blog-empty" style={{ padding: '36px 16px' }}>
                <div className="blog-empty-icon">
                  <AppIcon name="user" size={20} />
                </div>
                <p className="blog-empty-title">关于页暂未填写正文</p>
                <p className="blog-empty-desc">
                  {isOwner
                    ? '用 Markdown 写下你的自我介绍、技术栈、兴趣爱好与联系方式吧。'
                    : '博主正在整理个人介绍，欢迎在下方留言板打个招呼。'}
                </p>
                {isOwner && (
                  <button
                    type="button"
                    className="blog-btn blog-btn-primary blog-btn-sm"
                    onClick={() => setAboutEditorOpen(true)}
                  >
                    <AppIcon name="edit" size={13} />
                    <span>撰写关于页</span>
                  </button>
                )}
              </div>
            )}

            <AboutPageCommentBoard
              slug="about"
              comments={aboutPage.comments || []}
              allowComments={aboutPage.allowComments}
              isOwner={isOwner}
              ownerNickname={profile.nickname || profile.siteName || '博主'}
              onCommentsChange={(nextComments) =>
                setAboutPage((prev) => (prev ? { ...prev, comments: nextComments } : prev))
              }
            />
          </>
        ) : section === 'equipment' ? (
          <>
            <div className="blog-p2-page-hero">
              <div>
                <h1 className="blog-p2-page-title">我的装备</h1>
                <p className="blog-p2-page-subtitle">
                  日常高频使用的生产力硬件、桌面外设与数字工具清单
                </p>
              </div>
              <span className="blog-article-meta-mono" style={{ color: 'var(--blog-text-muted)' }}>
                {catalogItems.length} ITEMS
              </span>
            </div>

            {discoveredCategories.length > 0 && (
              <div className="blog-p2-section-bar">
                <div className="blog-filter-chips">
                  <button
                    type="button"
                    className={`blog-filter-chip${activeCategory === 'all' ? ' is-active' : ''}`}
                    onClick={() => setActiveCategory('all')}
                  >
                    全部 {catalogItems.length}
                  </button>
                  {discoveredCategories.map((cat) => {
                    const count = catalogItems.filter((i) => (i.category || '').trim() === cat).length
                    return (
                      <button
                        key={cat}
                        type="button"
                        className={`blog-filter-chip${activeCategory === cat ? ' is-active' : ''}`}
                        onClick={() => setActiveCategory(cat)}
                      >
                        {cat} {count}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {filteredCatalogItems.length === 0 ? (
              <div className="blog-empty">
                <div className="blog-empty-icon">
                  <AppIcon name="cpu" size={22} />
                </div>
                <p className="blog-empty-title">暂无装备记录</p>
                <p className="blog-empty-desc">
                  {isOwner ? '点击右上角「+ 添加」展示你的主力电脑、键盘与利器。' : '博主还没有公开装备清单。'}
                </p>
                {isOwner && (
                  <button
                    type="button"
                    className="blog-btn blog-btn-primary blog-btn-sm"
                    onClick={handlePrimaryOwnerAction}
                  >
                    <AppIcon name="plus" size={14} />
                    <span>添加第一件装备</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="blog-p2-equip-grid">
                {filteredCatalogItems.map((item) => {
                  const safeLink = getSafeExternalUrl(item.linkUrl)
                  return (
                    <article key={item.id} className="blog-p2-equip-card">
                      <div
                        className="blog-p2-equip-thumb"
                        style={item.imageUrl ? { cursor: 'zoom-in' } : undefined}
                        onClick={() => {
                          if (item.imageUrl) {
                            onOpenLightbox([{ url: item.imageUrl, alt: item.title }], 0)
                          }
                        }}
                      >
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.title} loading="lazy" />
                        ) : (
                          <AppIcon name="cpu" size={26} />
                        )}
                      </div>

                      <div className="blog-p2-equip-body">
                        <div className="blog-p2-card-badges">
                          {item.category && (
                            <span className="blog-badge-category">{item.category}</span>
                          )}
                          {item.tag && <span className="blog-p2-tag-pill">{item.tag}</span>}
                        </div>

                        <h3 className="blog-p2-card-title">{item.title}</h3>

                        {item.subtitle && (
                          <div className="blog-p2-card-spec">{item.subtitle}</div>
                        )}

                        {item.description && (
                          <p className="blog-p2-card-desc">{item.description}</p>
                        )}

                        <div className="blog-p2-card-footer">
                          {safeLink ? (
                            <a
                              href={safeLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="blog-p2-card-link"
                            >
                              <span>查看详情</span>
                              <AppIcon name="external" size={12} />
                            </a>
                          ) : (
                            <span />
                          )}

                          {isOwner && (
                            <div className="blog-p2-owner-inline-btns">
                              <button
                                type="button"
                                className="blog-btn blog-btn-icon blog-btn-sm"
                                onClick={() => {
                                  setEditingCatalogItem(item)
                                  setCatalogModalOpen(true)
                                }}
                                title="编辑装备"
                                aria-label="编辑装备"
                              >
                                <AppIcon name="edit" size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </>
        ) : section === 'labs' ? (
          <>
            <div className="blog-p2-page-hero">
              <div>
                <h1 className="blog-p2-page-title">实验室</h1>
                <p className="blog-p2-page-subtitle">
                  开源作品、独立小工具、交互原型与灵感试验田
                </p>
              </div>
              <span className="blog-article-meta-mono" style={{ color: 'var(--blog-text-muted)' }}>
                {catalogItems.length} PROJECTS
              </span>
            </div>

            {discoveredCategories.length > 1 && (
              <div className="blog-p2-section-bar">
                <div className="blog-filter-chips">
                  <button
                    type="button"
                    className={`blog-filter-chip${activeCategory === 'all' ? ' is-active' : ''}`}
                    onClick={() => setActiveCategory('all')}
                  >
                    全部
                  </button>
                  {discoveredCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`blog-filter-chip${activeCategory === cat ? ' is-active' : ''}`}
                      onClick={() => setActiveCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filteredCatalogItems.length === 0 ? (
              <div className="blog-empty">
                <div className="blog-empty-icon">
                  <AppIcon name="flask" size={22} />
                </div>
                <p className="blog-empty-title">实验室暂无上架项目</p>
                <p className="blog-empty-desc">
                  {isOwner ? '点击右上角「+ 添加」收录你的 Side Project 或开源仓库。' : '新的实验项目正在酝酿中。'}
                </p>
                {isOwner && (
                  <button
                    type="button"
                    className="blog-btn blog-btn-primary blog-btn-sm"
                    onClick={handlePrimaryOwnerAction}
                  >
                    <AppIcon name="plus" size={14} />
                    <span>添加实验项目</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="blog-p2-labs-grid">
                {filteredCatalogItems.map((item) => {
                  const safeLink = getSafeExternalUrl(item.linkUrl)
                  return (
                    <article key={item.id} className="blog-p2-lab-card">
                      <div className="blog-p2-lab-head">
                        <div className="blog-p2-lab-icon">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.title} loading="lazy" />
                          ) : (
                            <AppIcon name="flask" size={22} />
                          )}
                        </div>

                        <div className="blog-p2-lab-title-group">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <h3 className="blog-p2-card-title" style={{ margin: 0 }}>
                              {item.title}
                            </h3>
                            {item.tag && <span className="blog-p2-tag-pill">{item.tag}</span>}
                          </div>
                          {item.subtitle && (
                            <div className="blog-p2-card-spec">{item.subtitle}</div>
                          )}
                        </div>
                      </div>

                      {item.description && (
                        <p className="blog-p2-card-desc">{item.description}</p>
                      )}

                      <div className="blog-p2-card-footer">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {item.category && (
                            <span className="blog-badge-category">{item.category}</span>
                          )}
                          {isOwner && (
                            <button
                              type="button"
                              className="blog-btn blog-btn-icon blog-btn-sm"
                              onClick={() => {
                                setEditingCatalogItem(item)
                                setCatalogModalOpen(true)
                              }}
                              title="编辑项目"
                              aria-label="编辑项目"
                            >
                              <AppIcon name="edit" size={13} />
                            </button>
                          )}
                        </div>

                        {safeLink && (
                          <a
                            href={safeLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="blog-btn blog-btn-subtle blog-btn-sm"
                          >
                            <span>立即体验 ↗</span>
                          </a>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          /* friends section */
          <>
            <div className="blog-p2-page-hero">
              <div>
                <h1 className="blog-p2-page-title">友人帐</h1>
                <p className="blog-p2-page-subtitle">
                  互联网邻里与常去串门的独立博客们
                </p>
              </div>

              {friends.length > 0 && (
                <button
                  type="button"
                  className="blog-btn blog-btn-subtle blog-btn-sm"
                  onClick={handleShuffleFriends}
                >
                  <AppIcon name="shuffle" size={14} />
                  <span>随机换序</span>
                </button>
              )}
            </div>

            {friends.length === 0 ? (
              <div className="blog-empty">
                <div className="blog-empty-icon">
                  <AppIcon name="users" size={22} />
                </div>
                <p className="blog-empty-title">还没有添加友链</p>
                <p className="blog-empty-desc">
                  {isOwner ? '点击右上角「+ 添加」连接志同道合的独立博客朋友。' : '友链列表整理中。'}
                </p>
                {isOwner && (
                  <button
                    type="button"
                    className="blog-btn blog-btn-primary blog-btn-sm"
                    onClick={handlePrimaryOwnerAction}
                  >
                    <AppIcon name="plus" size={14} />
                    <span>添加友链</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="blog-p2-friends-grid">
                {friends.map((friend) => {
                  const safeUrl = getSafeExternalUrl(friend.url) || '#'
                  return (
                    <div key={friend.id} className="blog-p2-friend-card-wrap">
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="blog-p2-friend-card"
                      >
                        <div className="blog-p2-friend-avatar">
                          {friend.avatarUrl ? (
                            <img src={friend.avatarUrl} alt={friend.name} loading="lazy" />
                          ) : (
                            getMonogram(friend.name, '友')
                          )}
                        </div>

                        <div className="blog-p2-friend-info">
                          <div className="blog-p2-friend-name-row">
                            <span className="blog-p2-friend-name">{friend.name}</span>
                            <AppIcon name="external" size={12} className="blog-p2-friend-ext" />
                          </div>

                          {friend.description && (
                            <p className="blog-p2-friend-desc">{friend.description}</p>
                          )}

                          <span className="blog-p2-friend-domain">
                            {getDomainBadge(friend.url)}
                          </span>
                        </div>
                      </a>

                      {isOwner && (
                        <button
                          type="button"
                          className="blog-p2-friend-edit-btn"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setEditingFriend(friend)
                            setFriendModalOpen(true)
                          }}
                          title="编辑友链"
                          aria-label={`编辑友链 ${friend.name}`}
                        >
                          <AppIcon name="edit" size={13} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Owner Modals */}
      {isOwner && aboutPage && (
        <AboutPageEditorModal
          open={aboutEditorOpen}
          page={aboutPage}
          onClose={() => setAboutEditorOpen(false)}
          onSaved={(updated) => {
            setAboutPage(updated)
            setAboutEditorOpen(false)
          }}
        />
      )}

      {isOwner && (section === 'equipment' || section === 'labs') && (
        <CatalogEditorModal
          open={catalogModalOpen}
          section={section}
          editingItem={editingCatalogItem}
          defaultSortOrder={catalogItems.length}
          onClose={() => {
            setCatalogModalOpen(false)
            setEditingCatalogItem(null)
          }}
          onSaved={(saved) => {
            setCatalogItems((prev) => {
              const exists = prev.some((i) => i.id === saved.id)
              const next = exists
                ? prev.map((i) => (i.id === saved.id ? saved : i))
                : [...prev, saved]
              return next.sort((a, b) => a.sortOrder - b.sortOrder || b.createdAt - a.createdAt)
            })
            setCatalogModalOpen(false)
            setEditingCatalogItem(null)
          }}
          onDeleted={(deletedId) => {
            setCatalogItems((prev) => prev.filter((i) => i.id !== deletedId))
            setCatalogModalOpen(false)
            setEditingCatalogItem(null)
          }}
        />
      )}

      {isOwner && section === 'friends' && (
        <FriendEditorModal
          open={friendModalOpen}
          editingFriend={editingFriend}
          defaultSortOrder={friends.length}
          onClose={() => {
            setFriendModalOpen(false)
            setEditingFriend(null)
          }}
          onSaved={(saved) => {
            setFriends((prev) => {
              const exists = prev.some((f) => f.id === saved.id)
              const next = exists
                ? prev.map((f) => (f.id === saved.id ? saved : f))
                : [...prev, saved]
              return next.sort((a, b) => a.sortOrder - b.sortOrder || b.createdAt - a.createdAt)
            })
            setFriendModalOpen(false)
            setEditingFriend(null)
          }}
          onDeleted={(deletedId) => {
            setFriends((prev) => prev.filter((f) => f.id !== deletedId))
            setFriendModalOpen(false)
            setEditingFriend(null)
          }}
        />
      )}
    </>
  )
}
