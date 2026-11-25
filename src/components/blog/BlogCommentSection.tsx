import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import {
  createBlogComment,
  deleteBlogComment,
  formatRelativeTime,
  readVisitorProfile,
  saveVisitorProfile,
  toggleBlogCommentLike
} from '../../blog-api'
import type { BlogComment } from '../../blog-types'
import { AppIcon } from '../AppIcon'
import { showToast } from '../Toast'

export interface BlogCommentSectionProps {
  postId: string
  shortId: string
  comments: BlogComment[]
  allowComments: boolean
  isOwner: boolean
  ownerNickname: string
  focusSignal?: number
  onCommentsChange: (nextComments: BlogComment[]) => void
}

interface ReplyTarget {
  parentId: string
  replyToId: string
  replyToName: string
}

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '🔥', '✨', '👏'] as const

function getMonogram(name: string): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return '?'
  const first = Array.from(trimmed)[0]
  return first ? first.toUpperCase() : '?'
}

function getSafeWebsiteUrl(raw: string): string | null {
  const cleaned = (raw || '').trim()
  if (!cleaned) return null
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  return null
}

function AuthorName({ comment }: { comment: BlogComment }) {
  const safeUrl = getSafeWebsiteUrl(comment.authorWebsite)
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

export function BlogCommentSection({
  postId,
  shortId,
  comments,
  allowComments,
  isOwner,
  ownerNickname,
  focusSignal,
  onCommentsChange
}: BlogCommentSectionProps) {
  const initialVisitor = useMemo(() => readVisitorProfile(), [])

  const [composerExpanded, setComposerExpanded] = useState(false)
  const [content, setContent] = useState('')
  const [authorName, setAuthorName] = useState(initialVisitor.authorName)
  const [authorEmail, setAuthorEmail] = useState(initialVisitor.authorEmail)
  const [authorWebsite, setAuthorWebsite] = useState(initialVisitor.authorWebsite)
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({})
  const [likingIds, setLikingIds] = useState<Record<string, boolean>>({})
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({})

  const sectionRef = useRef<HTMLElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const canComment = allowComments || isOwner

  // Reset composer state when switching posts
  useEffect(() => {
    setComposerExpanded(false)
    setContent('')
    setReplyTarget(null)
    setError(null)
    setExpandedThreads({})
  }, [postId])

  const focusComposer = (scroll = true) => {
    setComposerExpanded(true)
    window.requestAnimationFrame(() => {
      if (scroll) {
        const anchor = composerRef.current || sectionRef.current
        anchor?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      textareaRef.current?.focus()
    })
  }

  // Expand & focus composer whenever focusSignal increments > 0
  useEffect(() => {
    if (!focusSignal || focusSignal <= 0) return
    if (!canComment) {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    focusComposer(true)
  }, [focusSignal, canComment])

  // Group comments into root comments + child replies (orphan fallback as root)
  const threads = useMemo(() => {
    const byId = new Map<string, BlogComment>()
    for (const comment of comments) {
      byId.set(comment.id, comment)
    }

    const findRootId = (comment: BlogComment): string | null => {
      if (!comment.parentId) return null
      const visited = new Set<string>([comment.id])
      let current = byId.get(comment.parentId)
      while (current) {
        if (visited.has(current.id)) return null
        visited.add(current.id)
        if (!current.parentId) return current.id
        current = byId.get(current.parentId)
      }
      return null
    }

    const roots: BlogComment[] = []
    const repliesMap = new Map<string, BlogComment[]>()

    for (const comment of comments) {
      const rootId = findRootId(comment)
      if (!rootId) {
        roots.push(comment)
      } else {
        const list = repliesMap.get(rootId)
        if (list) list.push(comment)
        else repliesMap.set(rootId, [comment])
      }
    }

    return roots.map((root) => ({
      root,
      replies: repliesMap.get(root.id) ?? []
    }))
  }, [comments])

  const persistVisitorProfile = () => {
    if (isOwner) return
    saveVisitorProfile({ authorName, authorEmail, authorWebsite })
  }

  const handleInsertEmoji = (emoji: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setContent((prev) => prev + emoji)
      return
    }
    const start = textarea.selectionStart ?? content.length
    const end = textarea.selectionEnd ?? content.length
    const nextValue = content.slice(0, start) + emoji + content.slice(end)
    setContent(nextValue)
    if (error) setError(null)
    window.requestAnimationFrame(() => {
      textarea.focus()
      const caret = start + emoji.length
      textarea.setSelectionRange(caret, caret)
    })
  }

  const handleReplyClick = (root: BlogComment, target: BlogComment) => {
    if (!canComment) return
    setReplyTarget({
      parentId: root.id,
      replyToId: target.id,
      replyToName: target.authorName
    })
    setError(null)
    focusComposer(true)
  }

  const submitComment = async () => {
    if (submitting || !canComment) return
    const trimmedContent = content.trim()
    if (!trimmedContent) {
      setError('请输入留言内容')
      textareaRef.current?.focus()
      return
    }

    if (!isOwner && !authorName.trim()) {
      setError('请填写昵称')
      return
    }

    if (!isOwner) {
      persistVisitorProfile()
    }

    setSubmitting(true)
    setError(null)
    try {
      const created = await createBlogComment(shortId, {
        content: trimmedContent,
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
      if (replyTarget) {
        setExpandedThreads((prev) => ({ ...prev, [replyTarget.parentId]: true }))
      }
      setContent('')
      setReplyTarget(null)
      showToast('success', '留言已发表')
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : '发表留言失败，请稍后重试'
      setError(message)
      showToast('error', message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void submitComment()
  }

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void submitComment()
    }
  }

  const handleToggleLike = async (comment: BlogComment) => {
    if (likingIds[comment.id]) return
    setLikingIds((prev) => ({ ...prev, [comment.id]: true }))
    try {
      const res = await toggleBlogCommentLike(comment.id)
      onCommentsChange(
        comments.map((item) =>
          item.id === comment.id
            ? { ...item, likedByMe: res.liked, likeCount: res.likeCount }
            : item
        )
      )
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : '点赞失败'
      showToast('error', message)
    } finally {
      setLikingIds((prev) => {
        const next = { ...prev }
        delete next[comment.id]
        return next
      })
    }
  }

  const handleDeleteComment = async (comment: BlogComment, hasReplies = false) => {
    if (!isOwner || deletingIds[comment.id]) return
    const promptText = hasReplies
      ? '确定要删除这条留言及其所有回复吗？'
      : '确定要删除这条留言吗？'
    if (!window.confirm(promptText)) return

    setDeletingIds((prev) => ({ ...prev, [comment.id]: true }))
    try {
      await deleteBlogComment(comment.id)
      const removedIds = new Set<string>([comment.id])
      for (const item of comments) {
        if (item.parentId === comment.id || item.replyToId === comment.id) {
          removedIds.add(item.id)
        }
      }
      onCommentsChange(comments.filter((item) => !removedIds.has(item.id)))
      if (replyTarget && (removedIds.has(replyTarget.parentId) || removedIds.has(replyTarget.replyToId))) {
        setReplyTarget(null)
      }
      showToast('success', '留言已删除')
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : '删除留言失败'
      showToast('error', message)
    } finally {
      setDeletingIds((prev) => {
        const next = { ...prev }
        delete next[comment.id]
        return next
      })
    }
  }

  return (
    <section
      ref={sectionRef}
      className="blog-floor-comments"
      data-post-id={postId}
      aria-label="精选留言"
    >
      <div className="blog-floor-header">
        <h2 className="blog-floor-title">
          <span>精选留言</span>
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
          博主已关闭此内容的访客留言
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
              <span style={{ fontSize: 13.5 }}>写下你的想法或留言…</span>
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
            <form className="blog-floor-composer" onSubmit={handleFormSubmit}>
              {replyTarget && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: 'var(--blog-link-soft)',
                    color: 'var(--blog-link)',
                    fontSize: 12.5
                  }}
                >
                  <span>回复 @{replyTarget.replyToName}</span>
                  <button
                    type="button"
                    className="blog-floor-action-btn"
                    onClick={() => setReplyTarget(null)}
                    aria-label="取消回复"
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
                    onBlur={persistVisitorProfile}
                    disabled={submitting}
                    aria-label="昵称"
                    required
                  />
                  <input
                    type="email"
                    placeholder="邮箱 (选填)"
                    value={authorEmail}
                    onChange={(e) => setAuthorEmail(e.target.value)}
                    onBlur={persistVisitorProfile}
                    disabled={submitting}
                    aria-label="邮箱"
                  />
                  <input
                    type="url"
                    placeholder="网址 (选填)"
                    value={authorWebsite}
                    onChange={(e) => setAuthorWebsite(e.target.value)}
                    onBlur={persistVisitorProfile}
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
                onKeyDown={handleTextareaKeyDown}
                placeholder={
                  replyTarget
                    ? `回复 @${replyTarget.replyToName}…`
                    : '写下你的留言…（Ctrl/Cmd + Enter 快捷发送）'
                }
                disabled={submitting}
                style={{ minHeight: 84 }}
              />

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 4
                }}
                aria-label="快捷表情"
              >
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="blog-floor-action-btn"
                    onClick={() => handleInsertEmoji(emoji)}
                    disabled={submitting}
                    aria-label={`插入表情 ${emoji}`}
                    style={{
                      fontSize: 15,
                      padding: '3px 6px',
                      lineHeight: 1.2
                    }}
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
                    onClick={() => {
                      setComposerExpanded(false)
                      setReplyTarget(null)
                      setError(null)
                    }}
                    disabled={submitting}
                  >
                    收起
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
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
        <div
          className="blog-field-hint"
          style={{ textAlign: 'center', padding: '18px 0 6px' }}
        >
          {canComment ? '还没有留言，来抢沙发吧' : '暂无留言'}
        </div>
      ) : (
        <div>
          {threads.map(({ root, replies }) => {
            const isCollapsible = replies.length > 2
            const isRepliesOpen = !isCollapsible || Boolean(expandedThreads[root.id])

            return (
              <div key={root.id} className="blog-floor-thread">
                <div
                  className={`blog-floor-avatar${root.isOwner ? ' is-owner' : ''}`}
                  aria-hidden="true"
                >
                  {getMonogram(root.authorName)}
                </div>

                <div className="blog-floor-main">
                  <div className="blog-floor-meta">
                    <div className="blog-floor-author-line">
                      <AuthorName comment={root} />
                    </div>
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
                        onClick={() => handleReplyClick(root, root)}
                      >
                        <AppIcon name="comment" size={13} />
                        <span>回复</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className={`blog-floor-action-btn${root.likedByMe ? ' is-liked' : ''}`}
                      onClick={() => void handleToggleLike(root)}
                      disabled={Boolean(likingIds[root.id])}
                      aria-pressed={root.likedByMe}
                    >
                      <AppIcon name={root.likedByMe ? 'heartFilled' : 'heart'} size={13} />
                      <span>{root.likeCount > 0 ? root.likeCount : '赞'}</span>
                    </button>

                    {isOwner && (
                      <button
                        type="button"
                        className="blog-floor-action-btn is-danger"
                        onClick={() => void handleDeleteComment(root, replies.length > 0)}
                        disabled={Boolean(deletingIds[root.id])}
                      >
                        <AppIcon name="trash" size={13} />
                        <span>删除</span>
                      </button>
                    )}
                  </div>

                  {replies.length > 0 && (
                    <>
                      {isRepliesOpen && (
                        <div className="blog-floor-replies">
                          {replies.map((reply) => {
                            const showReplyTo = Boolean(
                              reply.replyToName && (!reply.replyToId || reply.replyToId !== root.id)
                            )
                            return (
                              <div key={reply.id} className="blog-floor-reply-item">
                                <div>
                                  <AuthorName comment={reply} />
                                  {showReplyTo && (
                                    <span className="blog-comment-reply-label">
                                      回复 @{reply.replyToName}
                                    </span>
                                  )}
                                  <span style={{ color: 'var(--blog-text-muted)', marginRight: 4 }}>
                                    ：
                                  </span>
                                  <span style={{ whiteSpace: 'pre-wrap' }}>{reply.content}</span>
                                </div>

                                <div className="blog-floor-actions" style={{ marginTop: 4 }}>
                                  <span>{formatRelativeTime(reply.createdAt)}</span>

                                  {canComment && (
                                    <button
                                      type="button"
                                      className="blog-floor-action-btn"
                                      onClick={() => handleReplyClick(root, reply)}
                                    >
                                      回复
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    className={`blog-floor-action-btn${reply.likedByMe ? ' is-liked' : ''}`}
                                    onClick={() => void handleToggleLike(reply)}
                                    disabled={Boolean(likingIds[reply.id])}
                                    aria-pressed={reply.likedByMe}
                                  >
                                    <AppIcon
                                      name={reply.likedByMe ? 'heartFilled' : 'heart'}
                                      size={12}
                                    />
                                    <span>{reply.likeCount > 0 ? reply.likeCount : '赞'}</span>
                                  </button>

                                  {isOwner && (
                                    <button
                                      type="button"
                                      className="blog-floor-action-btn is-danger"
                                      onClick={() => void handleDeleteComment(reply)}
                                      disabled={Boolean(deletingIds[reply.id])}
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

                      {isCollapsible && (
                        <button
                          type="button"
                          className="blog-floor-reply-toggle"
                          onClick={() =>
                            setExpandedThreads((prev) => ({
                              ...prev,
                              [root.id]: !prev[root.id]
                            }))
                          }
                        >
                          <AppIcon name={isRepliesOpen ? 'arrowUp' : 'chevronDown'} size={13} />
                          <span>
                            {isRepliesOpen ? '收起回复' : `展开 ${replies.length} 条回复`}
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
