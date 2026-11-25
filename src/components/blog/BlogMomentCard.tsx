import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  createBlogComment,
  deleteBlogComment,
  formatRelativeTime,
  readVisitorProfile,
  saveVisitorProfile,
  toggleBlogPostLike
} from '../../blog-api'
import { formatMomentText } from '../../blog-markdown'
import type { BlogComment, BlogPostSummary, BlogProfile } from '../../blog-types'
import { AppIcon } from '../AppIcon'
import { showToast } from '../Toast'
import { BlogImageGrid } from './BlogImageGrid'

export interface BlogMomentCardProps {
  post: BlogPostSummary
  profile: BlogProfile
  isOwner: boolean
  index?: number
  onOpenArticle: (shortId: string) => void
  onOpenMoment: (shortId: string) => void
  onFilterTag: (tag: string) => void
  onOpenLightbox: (images: Array<{ url: string; alt?: string }>, index: number) => void
  onPostUpdated: (post: BlogPostSummary) => void
  onEditPost: (post: BlogPostSummary) => void
  onDeletePost: (post: BlogPostSummary) => void
  onTogglePin: (post: BlogPostSummary) => void
}

interface ReplyTarget {
  parentId: string
  replyToId: string
  replyToName: string
}

function getMonogram(name: string): string {
  const trimmed = name.trim()
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : 'B'
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

export function BlogMomentCard({
  post,
  profile,
  isOwner,
  index,
  onOpenArticle,
  onOpenMoment,
  onFilterTag,
  onOpenLightbox,
  onPostUpdated,
  onEditPost,
  onDeletePost,
  onTogglePin
}: BlogMomentCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [liking, setLiking] = useState(false)
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentsExpanded, setCommentsExpanded] = useState(false)
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null)
  const [commentText, setCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)

  const initialVisitor = useMemo(() => readVisitorProfile(), [])
  const [guestName, setGuestName] = useState(initialVisitor.authorName)
  const [guestEmail, setGuestEmail] = useState(initialVisitor.authorEmail)
  const [guestWebsite, setGuestWebsite] = useState(initialVisitor.authorWebsite)

  const actionRef = useRef<HTMLDivElement | null>(null)
  const commentInputRef = useRef<HTMLInputElement | null>(null)

  const authorDisplayName = profile.nickname || profile.siteName || '博主'
  const canComment = profile.allowComments || isOwner

  const needsCollapse = useMemo(() => {
    if (post.type !== 'moment' || post.locked) return false
    return post.content.length > 180 || post.content.split('\n').length > 6
  }, [post.type, post.locked, post.content])

  const momentSegments = useMemo(() => {
    if (post.type !== 'moment' || post.locked) return []
    return formatMomentText(post.content)
  }, [post.type, post.locked, post.content])

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (actionRef.current && !actionRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (commentOpen) {
      commentInputRef.current?.focus()
    }
  }, [commentOpen, replyTarget])

  const openDetail = () => {
    if (post.type === 'article') onOpenArticle(post.shortId)
    else onOpenMoment(post.shortId)
  }

  const handleToggleLike = async () => {
    if (liking || post.locked) return
    setLiking(true)
    setMenuOpen(false)
    try {
      const visitorName = isOwner ? authorDisplayName : readVisitorProfile().authorName
      const res = await toggleBlogPostLike(post.shortId, visitorName || undefined)
      onPostUpdated({
        ...post,
        likedByMe: res.liked,
        likeCount: res.likeCount,
        likes: res.likes
      })
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '点赞操作失败')
    } finally {
      setLiking(false)
    }
  }

  const handleOpenCommentBox = (target: ReplyTarget | null = null) => {
    if (!canComment || post.locked) return
    if (!isOwner) {
      const saved = readVisitorProfile()
      if (!guestName && saved.authorName) setGuestName(saved.authorName)
      if (!guestEmail && saved.authorEmail) setGuestEmail(saved.authorEmail)
      if (!guestWebsite && saved.authorWebsite) setGuestWebsite(saved.authorWebsite)
    }
    setReplyTarget(target)
    setCommentOpen(true)
    setMenuOpen(false)
  }

  const handleCommentRowClick = (comment: BlogComment) => {
    if (!canComment) return
    handleOpenCommentBox({
      parentId: comment.parentId || comment.id,
      replyToId: comment.id,
      replyToName: comment.authorName || '访客'
    })
  }

  const handleSubmitComment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = commentText.trim()
    if (!trimmed || submittingComment) return
    setSubmittingComment(true)
    try {
      if (!isOwner) {
        saveVisitorProfile({
          authorName: guestName,
          authorEmail: guestEmail,
          authorWebsite: guestWebsite
        })
      }
      const created = await createBlogComment(post.shortId, {
        content: trimmed,
        authorName: isOwner ? undefined : guestName.trim() || undefined,
        authorEmail: isOwner ? undefined : guestEmail.trim() || undefined,
        authorWebsite: isOwner ? undefined : guestWebsite.trim() || undefined,
        parentId: replyTarget ? replyTarget.parentId : null,
        replyToId: replyTarget ? replyTarget.replyToId : null,
        replyToName: replyTarget ? replyTarget.replyToName : null
      })
      onPostUpdated({
        ...post,
        comments: [...post.comments, created],
        commentCount: post.commentCount + 1
      })
      setCommentText('')
      setReplyTarget(null)
      setCommentOpen(false)
      showToast('success', '评论已发布')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '评论发送失败')
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!isOwner || deletingCommentId) return
    setDeletingCommentId(commentId)
    try {
      await deleteBlogComment(commentId)
      onPostUpdated({
        ...post,
        comments: post.comments.filter((item) => item.id !== commentId),
        commentCount: Math.max(0, post.commentCount - 1)
      })
      showToast('success', '评论已删除')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '删除评论失败')
    } finally {
      setDeletingCommentId(null)
    }
  }

  const uniqueLikeNames = useMemo(() => {
    const seen = new Set<string>()
    const names: string[] = []
    for (const like of post.likes) {
      const cleaned = like.authorName.trim()
      if (!cleaned || seen.has(cleaned)) continue
      seen.add(cleaned)
      names.push(cleaned)
    }
    return names
  }, [post.likes])

  const hasLikes = post.likes.length > 0 || post.likeCount > 0
  const hasComments = post.comments.length > 0
  const showInteractionBox = !post.locked && (hasLikes || hasComments || commentOpen)

  const shouldTruncateComments = post.comments.length >= 5 && !commentsExpanded
  const visibleComments = shouldTruncateComments ? post.comments.slice(0, 4) : post.comments

  const detailHref =
    post.type === 'article'
      ? `/articles/${encodeURIComponent(post.shortId)}`
      : `/moments/${encodeURIComponent(post.shortId)}`

  const hasBadges =
    post.isPinned ||
    post.visibility === 'private' ||
    post.visibility === 'password' ||
    Boolean(post.category)

  const hasActionMenu = !post.locked || isOwner

  return (
    <article
      className="blog-moment-card"
      style={index !== undefined ? { animationDelay: `${Math.min(index, 8) * 35}ms` } : undefined}
    >
      <div className="blog-moment-avatar" aria-hidden="true">
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt={authorDisplayName} />
        ) : (
          getMonogram(authorDisplayName)
        )}
      </div>

      <div className="blog-moment-body">
        <div className="blog-moment-header">
          <span className="blog-moment-author">{authorDisplayName}</span>
          {hasBadges && (
            <div className="blog-moment-badges">
              {post.isPinned && (
                <span className="blog-badge-pin">
                  <AppIcon name="pin" size={11} />
                  置顶
                </span>
              )}
              {post.visibility === 'private' && (
                <span className="blog-badge-private">
                  <AppIcon name="eyeOff" size={11} />
                  私密
                </span>
              )}
              {post.visibility === 'password' && (
                <span className="blog-badge-locked">
                  <AppIcon name="lock" size={11} />
                  加密
                </span>
              )}
              {post.category && <span className="blog-badge-category">{post.category}</span>}
            </div>
          )}
        </div>

        {post.locked ? (
          <a
            href={detailHref}
            className="blog-share-card"
            onClick={(event) => {
              event.preventDefault()
              openDetail()
            }}
          >
            <div className="blog-share-thumb">
              <AppIcon name="lock" size={24} />
            </div>
            <div className="blog-share-info">
              <div className="blog-share-title">
                {post.title || (post.type === 'article' ? '加密文章' : '加密动态')}
              </div>
              <div className="blog-share-excerpt">该内容已加密，点击输入密码解锁</div>
            </div>
          </a>
        ) : post.type === 'article' ? (
          <a
            href={detailHref}
            className="blog-share-card"
            onClick={(event) => {
              event.preventDefault()
              onOpenArticle(post.shortId)
            }}
          >
            <div className="blog-share-thumb">
              {post.coverUrl ? (
                <img src={post.coverUrl} alt={post.title || '文章封面'} loading="lazy" />
              ) : (
                <AppIcon name="book" size={26} />
              )}
            </div>
            <div className="blog-share-info">
              <div className="blog-share-title">{post.title || '无标题文章'}</div>
              {post.excerpt && <div className="blog-share-excerpt">{post.excerpt}</div>}
            </div>
          </a>
        ) : (
          <>
            {post.content.trim() && (
              <>
                <div
                  className={
                    needsCollapse && !expanded
                      ? 'blog-moment-text is-collapsed'
                      : 'blog-moment-text'
                  }
                >
                  {momentSegments.map((seg, segIdx) => {
                    if (seg.type === 'link') {
                      const href = seg.href || seg.value
                      return (
                        <a
                          key={segIdx}
                          className="blog-inline-link"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {seg.value}
                        </a>
                      )
                    }
                    if (seg.type === 'tag') {
                      const cleanTag = seg.value.replace(/^#/, '')
                      return (
                        <button
                          key={segIdx}
                          type="button"
                          className="blog-inline-tag"
                          onClick={() => onFilterTag(cleanTag)}
                        >
                          {seg.value}
                        </button>
                      )
                    }
                    return <Fragment key={segIdx}>{seg.value}</Fragment>
                  })}
                </div>
                {needsCollapse && (
                  <button
                    type="button"
                    className="blog-expand-btn"
                    onClick={() => setExpanded((prev) => !prev)}
                  >
                    {expanded ? '收起' : '展开'}
                  </button>
                )}
              </>
            )}

            {post.images.length > 0 && (
              <BlogImageGrid images={post.images} onOpenLightbox={onOpenLightbox} />
            )}

            {post.linkCard && (
              <a
                href={post.linkCard.url}
                target="_blank"
                rel="noopener noreferrer"
                className="blog-share-card"
              >
                <div className="blog-share-thumb">
                  {post.linkCard.image ? (
                    <img src={post.linkCard.image} alt={post.linkCard.title} loading="lazy" />
                  ) : (
                    <AppIcon name="link" size={22} />
                  )}
                </div>
                <div className="blog-share-info">
                  <div className="blog-share-title">{post.linkCard.title || post.linkCard.url}</div>
                  {post.linkCard.description && (
                    <div className="blog-share-excerpt">{post.linkCard.description}</div>
                  )}
                  <div className="blog-share-domain">
                    {post.linkCard.siteName || extractHostname(post.linkCard.url)}
                  </div>
                </div>
              </a>
            )}
          </>
        )}

        {!post.locked && post.tags.length > 0 && (
          <div className="blog-moment-tags">
            {post.tags.map((tag) => {
              const clean = tag.replace(/^#/, '')
              return (
                <button
                  key={tag}
                  type="button"
                  className="blog-moment-tag"
                  onClick={() => onFilterTag(clean)}
                >
                  #{clean}
                </button>
              )
            })}
          </div>
        )}

        {!post.locked && post.locationName && (
          <div className="blog-moment-location">
            <AppIcon name="mapPin" size={12} />
            <span>{post.locationName}</span>
          </div>
        )}

        <div className="blog-moment-meta-row" ref={actionRef}>
          <div className="blog-moment-meta">
            <button
              type="button"
              onClick={openDetail}
              style={{
                border: 0,
                background: 'transparent',
                padding: 0,
                color: 'inherit',
                font: 'inherit',
                letterSpacing: 'inherit',
                cursor: 'pointer'
              }}
            >
              {formatRelativeTime(post.publishedAt)}
            </button>
            {post.type === 'article' ? (
              <span>· 来自 文章</span>
            ) : post.sourceLabel ? (
              <span>· {post.sourceLabel}</span>
            ) : null}
          </div>

          {hasActionMenu && (
            <button
              type="button"
              className="blog-action-trigger"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="互动与管理菜单"
            >
              <span className="blog-action-dot" aria-hidden="true" />
              <span className="blog-action-dot" aria-hidden="true" />
            </button>
          )}

          {hasActionMenu && menuOpen && (
            <div className="blog-action-popover" role="menu">
              {!post.locked && (
                <button
                  type="button"
                  role="menuitem"
                  className={post.likedByMe ? 'is-liked' : undefined}
                  disabled={liking}
                  onClick={handleToggleLike}
                >
                  <AppIcon name={post.likedByMe ? 'heartFilled' : 'heart'} size={14} />
                  <span>{post.likedByMe ? '取消' : '赞'}</span>
                </button>
              )}

              {!post.locked && canComment && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleOpenCommentBox(null)}
                >
                  <AppIcon name="comment" size={14} />
                  <span>评论</span>
                </button>
              )}

              {isOwner && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      onTogglePin(post)
                    }}
                  >
                    <AppIcon name="pin" size={14} />
                    <span>{post.isPinned ? '取消置顶' : '置顶'}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      onEditPost(post)
                    }}
                  >
                    <AppIcon name="edit" size={14} />
                    <span>编辑</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => {
                      setMenuOpen(false)
                      onDeletePost(post)
                    }}
                  >
                    <AppIcon name="trash" size={14} />
                    <span>删除</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {showInteractionBox && (
          <div className="blog-interaction-box">
            {hasLikes && (
              <div className="blog-likes-row">
                <span className={post.likedByMe ? 'blog-likes-icon is-liked' : 'blog-likes-icon'}>
                  <AppIcon name={post.likedByMe ? 'heartFilled' : 'heart'} size={13} />
                </span>
                <div>
                  {uniqueLikeNames.length > 0 ? (
                    <>
                      <span className="blog-likes-names">
                        {uniqueLikeNames.slice(0, 5).join('、')}
                      </span>
                      {(post.likeCount > 5 ||
                        uniqueLikeNames.length > 5 ||
                        post.likeCount > uniqueLikeNames.length) && (
                        <span>
                          {' '}
                          等 {Math.max(post.likeCount, uniqueLikeNames.length)} 人觉得很赞
                        </span>
                      )}
                    </>
                  ) : (
                    <span>
                      {post.likeCount > 1 ? `${post.likeCount} 位访客觉得很赞` : '访客觉得很赞'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {hasLikes && (hasComments || commentOpen) && (
              <div className="blog-interaction-divider" />
            )}

            {hasComments && (
              <div className="blog-comments-list">
                {visibleComments.map((comment) => (
                  <div
                    key={comment.id}
                    className="blog-comment-inline"
                    role={canComment ? 'button' : undefined}
                    tabIndex={canComment ? 0 : undefined}
                    onClick={() => handleCommentRowClick(comment)}
                    onKeyDown={(event) => {
                      if (!canComment) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleCommentRowClick(comment)
                      }
                    }}
                  >
                    <span className="blog-comment-author">{comment.authorName || '访客'}</span>
                    {comment.isOwner && <span className="blog-owner-pill">博主</span>}
                    {comment.replyToName && (
                      <>
                        <span className="blog-comment-reply-label">回复</span>
                        <span className="blog-comment-author">{comment.replyToName}</span>
                      </>
                    )}
                    <span>: {comment.content}</span>
                    {isOwner && (
                      <button
                        type="button"
                        className="blog-comment-delete"
                        disabled={deletingCommentId === comment.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleDeleteComment(comment.id)
                        }}
                      >
                        {deletingCommentId === comment.id ? '删除中' : '删除'}
                      </button>
                    )}
                  </div>
                ))}

                {post.comments.length >= 5 && (
                  <div>
                    <button
                      type="button"
                      className="blog-expand-btn"
                      onClick={() => setCommentsExpanded((prev) => !prev)}
                    >
                      {commentsExpanded
                        ? '收起评论'
                        : `展开全部 ${post.comments.length} 条评论`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {commentOpen && canComment && (
              <form className="blog-comment-inline-form" onSubmit={handleSubmitComment}>
                {replyTarget && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      color: 'var(--blog-text-muted)'
                    }}
                  >
                    <span>正在回复 {replyTarget.replyToName}</span>
                    <button
                      type="button"
                      className="blog-filter-reset"
                      onClick={() => setReplyTarget(null)}
                    >
                      取消回复
                    </button>
                  </div>
                )}

                {!isOwner && (
                  <div className="blog-comment-guest-row">
                    <input
                      type="text"
                      placeholder="昵称（选填）"
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      maxLength={32}
                    />
                    <input
                      type="email"
                      placeholder="邮箱（选填）"
                      value={guestEmail}
                      onChange={(event) => setGuestEmail(event.target.value)}
                      maxLength={80}
                    />
                    <input
                      type="url"
                      placeholder="主页（选填）"
                      value={guestWebsite}
                      onChange={(event) => setGuestWebsite(event.target.value)}
                      maxLength={120}
                    />
                  </div>
                )}

                <div className="blog-comment-submit-row">
                  <input
                    ref={commentInputRef}
                    type="text"
                    placeholder={
                      replyTarget ? `回复 ${replyTarget.replyToName}...` : '写下你的评论...'
                    }
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && !commentText.trim()) {
                        setCommentOpen(false)
                        setReplyTarget(null)
                      }
                    }}
                    maxLength={1000}
                  />
                  <button
                    type="submit"
                    className="blog-comment-send-btn"
                    disabled={submittingComment || !commentText.trim()}
                  >
                    {submittingComment ? '发送中' : '发送'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
