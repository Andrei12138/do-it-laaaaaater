import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { formatArticleDateTime, toggleBlogPostLike } from '../../blog-api'
import { formatMomentText, renderArticleMarkdown, type TocHeading } from '../../blog-markdown'
import { useOptionalBlogMusic } from '../../blog-music'
import type {
  BlogComment,
  BlogPostDetail,
  BlogPostMetadata,
  BlogPostType,
  BlogProfile
} from '../../blog-types'
import { AppIcon } from '../AppIcon'
import { showToast } from '../Toast'
import { BlogCommentSection } from './BlogCommentSection'
import { BlogImageGrid } from './BlogImageGrid'
import { BlogMusicCard } from './BlogMusicCard'
import { BlogUnlockCard } from './BlogUnlockCard'
import { BlogVideoCard } from './BlogVideoCard'

const EMPTY_TOC_HEADINGS: TocHeading[] = []

export interface BlogArticleViewProps {
  post: BlogPostDetail
  profile: BlogProfile
  isOwner: boolean
  darkMode: boolean
  onToggleDarkMode: () => void
  onBack: () => void
  onOpenPost: (type: BlogPostType, shortId: string) => void
  onFilterTag: (tag: string) => void
  onEditPost: (post: BlogPostDetail) => void
  onPostUpdated: (post: BlogPostDetail) => void
  onOpenLightbox: (images: Array<{ url: string; alt?: string }>, index: number) => void
  tocInRail?: boolean
  onTocStateChange?: (headings: TocHeading[], activeId: string) => void
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy execCommand fallback.
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

function getSafeExternalUrl(raw: string): string {
  const cleaned = (raw || '').trim()
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  return '#'
}

function getHostnameLabel(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./i, '')
  } catch {
    return raw
  }
}

function getAuthorMonogram(name: string): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'B'
  return Array.from(trimmed)[0]?.toUpperCase() || 'B'
}

export function BlogArticleView({
  post,
  profile,
  isOwner,
  darkMode,
  onToggleDarkMode,
  onBack,
  onOpenPost,
  onFilterTag,
  onEditPost,
  onPostUpdated,
  onOpenLightbox,
  tocInRail = false,
  onTocStateChange
}: BlogArticleViewProps) {
  const [activeHeadingId, setActiveHeadingId] = useState<string>('')
  const [liking, setLiking] = useState(false)
  const [commentFocusSignal, setCommentFocusSignal] = useState(0)

  const articleContentRef = useRef<HTMLDivElement | null>(null)
  const copyTimersRef = useRef<Map<HTMLButtonElement, number>>(new Map())
  const onTocStateChangeRef = useRef(onTocStateChange)
  onTocStateChangeRef.current = onTocStateChange

  const isArticle = post.type === 'article'
  const headerTitle = post.title || '动态详情'
  const musicCtx = useOptionalBlogMusic()
  const meta = (post.metadata || {}) as BlogPostMetadata

  const rendered = useMemo(() => {
    if (post.locked || !isArticle) return null
    return renderArticleMarkdown(post.content)
  }, [post.locked, isArticle, post.content])

  const renderedHeadings = rendered ? rendered.headings : EMPTY_TOC_HEADINGS

  const momentSegments = useMemo(() => {
    if (post.locked || isArticle) return []
    return formatMomentText(post.content)
  }, [post.locked, isArticle, post.content])

  // Clean up any pending code-copy reset timers on unmount
  useEffect(() => {
    const timers = copyTimersRef.current
    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId))
      timers.clear()
    }
  }, [])

  // Track active TOC heading on scroll
  useEffect(() => {
    const headings = rendered?.headings ?? []
    if (headings.length < 2) {
      setActiveHeadingId('')
      return
    }

    setActiveHeadingId(headings[0].id)

    const updateActiveHeading = () => {
      let currentId = headings[0].id
      for (const heading of headings) {
        const el = document.getElementById(heading.id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= 110) {
          currentId = heading.id
        } else {
          break
        }
      }
      setActiveHeadingId(currentId)
    }

    updateActiveHeading()
    window.addEventListener('scroll', updateActiveHeading, { passive: true })
    return () => {
      window.removeEventListener('scroll', updateActiveHeading)
    }
  }, [rendered, post.id])

  // Sync TOC headings & active heading ID to parent shell rail
  useEffect(() => {
    onTocStateChangeRef.current?.(renderedHeadings, activeHeadingId)
  }, [renderedHeadings, activeHeadingId])

  useEffect(() => {
    return () => {
      onTocStateChangeRef.current?.(EMPTY_TOC_HEADINGS, '')
    }
  }, [])

  const handleCopyShareUrl = async () => {
    const ok = await copyTextToClipboard(window.location.href)
    if (ok) {
      showToast('success', '链接已复制')
    } else {
      showToast('error', '复制链接失败')
    }
  }

  const handleBottomShare = async () => {
    const url = window.location.href
    const shareTitle = post.title || profile.siteName || '分享内容'
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: shareTitle,
          text: post.excerpt || undefined,
          url
        })
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        // Fall back to copying link if Web Share fails.
      }
    }
    await handleCopyShareUrl()
  }

  const handleToggleLike = async () => {
    if (liking) return
    setLiking(true)
    try {
      const res = await toggleBlogPostLike(post.shortId)
      onPostUpdated({
        ...post,
        likedByMe: res.liked,
        likeCount: res.likeCount,
        likes: res.likes
      })
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : '操作失败，请稍后重试'
      showToast('error', message)
    } finally {
      setLiking(false)
    }
  }

  const handleCommentsChange = (nextComments: BlogComment[]) => {
    onPostUpdated({
      ...post,
      comments: nextComments,
      commentCount: nextComments.length
    })
  }

  const handleTocClick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const target = document.getElementById(id)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveHeadingId(id)
    }
  }

  const handleArticleContentClick = async (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (!target) return

    const copyBtn = target.closest<HTMLButtonElement>('[data-code-copy]')
    if (copyBtn) {
      const block = copyBtn.closest('.blog-code-block')
      const codeEl = block?.querySelector('pre code')
      const codeText = codeEl?.textContent ?? ''
      const copied = await copyTextToClipboard(codeText)
      if (!copied) {
        showToast('error', '复制代码失败')
        return
      }

      const prevTimer = copyTimersRef.current.get(copyBtn)
      if (prevTimer !== undefined) {
        window.clearTimeout(prevTimer)
      }
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
    if (imgEl && articleContentRef.current) {
      const allImgs = Array.from(
        articleContentRef.current.querySelectorAll<HTMLImageElement>('img[data-lightbox-src]')
      )
      const images = allImgs.map((el) => ({
        url: el.getAttribute('data-lightbox-src') || el.src,
        alt: el.alt || undefined
      }))
      const index = Math.max(0, allImgs.indexOf(imgEl))
      onOpenLightbox(images, index)
    }
  }

  const stickyTopBar = (
    <header className="blog-sticky-bar">
      <button type="button" className="blog-sticky-back" onClick={onBack}>
        <AppIcon name="arrowLeft" size={16} />
        <span>返回</span>
      </button>

      <div className="blog-sticky-title" title={headerTitle}>
        {headerTitle}
      </div>

      <div className="blog-sticky-actions">
        {musicCtx?.currentTrack && (
          <div
            className={`blog-p2-article-music${musicCtx.isPlaying ? ' is-playing' : ''}`}
            role="group"
            aria-label="当前播放音乐"
            onClick={() => musicCtx.openDrawer()}
            title={`${musicCtx.currentTrack.title} · 点击展开歌词与歌单`}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                musicCtx.togglePlay()
              }}
              aria-label={musicCtx.isPlaying ? '暂停播放' : '继续播放'}
              style={{
                border: 0,
                background: 'transparent',
                padding: 2,
                color: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
              <AppIcon name={musicCtx.isPlaying ? 'pause' : 'play'} size={12} />
            </button>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
            >
              {(musicCtx.isPlaying && musicCtx.currentLyricLine) || musicCtx.currentTrack.title}
            </span>
          </div>
        )}
        {isOwner && (
          <button
            type="button"
            className="blog-sticky-icon-btn"
            onClick={() => onEditPost(post)}
            title="编辑"
            aria-label="编辑"
          >
            <AppIcon name="edit" size={16} />
          </button>
        )}
        <button
          type="button"
          className="blog-sticky-icon-btn"
          onClick={() => void handleCopyShareUrl()}
          title="复制链接"
          aria-label="复制链接"
        >
          <AppIcon name="share" size={16} />
        </button>
        <button
          type="button"
          className="blog-sticky-icon-btn"
          onClick={onToggleDarkMode}
          title={darkMode ? '切换浅色模式' : '切换深色模式'}
          aria-label={darkMode ? '切换浅色模式' : '切换深色模式'}
        >
          <AppIcon name={darkMode ? 'sun' : 'moon'} size={16} />
        </button>
      </div>
    </header>
  )

  if (post.locked) {
    return (
      <>
        {stickyTopBar}
        <div className="blog-article">
          <BlogUnlockCard
            shortId={post.shortId}
            title={post.title || '加密内容'}
            onUnlocked={onPostUpdated}
            onBack={onBack}
          />
        </div>
      </>
    )
  }

  const visibilityBadge =
    post.visibility === 'private' ? (
      <span className="blog-badge-private">
        <AppIcon name="lock" size={11} />
        <span>仅自己可见</span>
      </span>
    ) : post.visibility === 'password' ? (
      <span className="blog-badge-locked">
        <AppIcon name="lock" size={11} />
        <span>密码访问</span>
      </span>
    ) : null

  return (
    <>
      {stickyTopBar}

      {!tocInRail && isArticle && rendered && rendered.headings.length >= 2 && (
        <aside className="blog-toc" aria-label="文章目录">
          <div className="blog-toc-title">目录</div>
          <ul className="blog-toc-list">
            {rendered.headings.map((heading) => (
              <li key={heading.id} className="blog-toc-item">
                <a
                  href={`#${heading.id}`}
                  data-level={heading.level}
                  className={`blog-toc-link${heading.level === 3 ? ' is-sub' : ''}${
                    activeHeadingId === heading.id ? ' is-active' : ''
                  }`}
                  onClick={(e) => handleTocClick(e, heading.id)}
                  title={heading.text}
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <article className="blog-article">
        {isArticle && rendered ? (
          <>
            {post.category && (
              <div className="blog-article-category">
                <AppIcon name="folder" size={12} />
                <span>{post.category}</span>
              </div>
            )}

            <h1 className="blog-article-title">{post.title}</h1>

            <div className="blog-article-meta">
              <span className="blog-article-meta-badge">原创</span>
              {visibilityBadge}
              <span className="blog-article-meta-author">{profile.nickname}</span>
              <span className="blog-article-meta-mono">
                {formatArticleDateTime(post.publishedAt)}
              </span>
              <span className="blog-article-meta-mono">{rendered.wordCount} 字</span>
              <span className="blog-article-meta-mono">约 {rendered.readingMinutes} 分钟</span>
              <span className="blog-article-meta-mono">阅读 {post.viewCount}</span>
            </div>

            {post.coverUrl && (
              <img
                src={post.coverUrl}
                alt={post.title || '文章封面'}
                className="blog-article-cover"
                style={{ cursor: 'zoom-in' }}
                onClick={() =>
                  onOpenLightbox([{ url: post.coverUrl!, alt: post.title || '文章封面' }], 0)
                }
              />
            )}

            {(meta.video || meta.music) && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  marginBottom: 22
                }}
              >
                {meta.video && <BlogVideoCard video={meta.video} />}
                {meta.music && <BlogMusicCard music={meta.music} />}
              </div>
            )}

            <div
              ref={articleContentRef}
              className="blog-article-content"
              dangerouslySetInnerHTML={{ __html: rendered.html }}
              onClick={(e) => void handleArticleContentClick(e)}
            />

            {post.tags.length > 0 && (
              <div className="blog-moment-tags" style={{ marginTop: 24 }}>
                {post.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="blog-moment-tag"
                    onClick={() => onFilterTag(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}

            {(post.prev || post.next) && (
              <nav className="blog-adjacent-nav" aria-label="相邻文章导航">
                {post.prev ? (
                  <a
                    href={`#post-${post.prev.shortId}`}
                    className="blog-adjacent-card"
                    onClick={(e) => {
                      e.preventDefault()
                      onOpenPost(post.prev!.type, post.prev!.shortId)
                    }}
                  >
                    <span className="blog-adjacent-label">← 上一篇</span>
                    <span className="blog-adjacent-title">{post.prev.title || '无标题'}</span>
                  </a>
                ) : (
                  <div />
                )}

                {post.next && (
                  <a
                    href={`#post-${post.next.shortId}`}
                    className="blog-adjacent-card is-next"
                    onClick={(e) => {
                      e.preventDefault()
                      onOpenPost(post.next!.type, post.next!.shortId)
                    }}
                  >
                    <span className="blog-adjacent-label">下一篇 →</span>
                    <span className="blog-adjacent-title">{post.next.title || '无标题'}</span>
                  </a>
                )}
              </nav>
            )}
          </>
        ) : (
          <>
            <div className="blog-article-meta" style={{ marginBottom: 14 }}>
              <span className="blog-article-meta-author">{profile.nickname}</span>
              {post.isPinned && (
                <span className="blog-badge-pin">
                  <AppIcon name="pin" size={11} />
                  <span>置顶</span>
                </span>
              )}
              {visibilityBadge}
              <span className="blog-article-meta-mono">
                {formatArticleDateTime(post.publishedAt)}
              </span>
              <span className="blog-article-meta-mono">阅读 {post.viewCount}</span>
            </div>

            {post.content && (
              <div className="blog-moment-text" style={{ fontSize: 16, lineHeight: 1.75 }}>
                {momentSegments.map((segment, index) => {
                  if (segment.type === 'link' && segment.href) {
                    return (
                      <a
                        key={index}
                        className="blog-inline-link"
                        href={segment.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {segment.value}
                      </a>
                    )
                  }
                  if (segment.type === 'tag') {
                    const tagName = segment.value.replace(/^#/, '')
                    return (
                      <button
                        key={index}
                        type="button"
                        className="blog-inline-tag"
                        onClick={() => onFilterTag(tagName)}
                      >
                        {segment.value}
                      </button>
                    )
                  }
                  return <span key={index}>{segment.value}</span>
                })}
              </div>
            )}

            {post.images.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <BlogImageGrid images={post.images} onOpenLightbox={onOpenLightbox} />
              </div>
            )}

            {meta.video && (
              <div style={{ marginTop: 14 }}>
                <BlogVideoCard video={meta.video} />
              </div>
            )}

            {meta.music && (
              <div style={{ marginTop: 14 }}>
                <BlogMusicCard music={meta.music} />
              </div>
            )}

            {post.linkCard && (
              <a
                className="blog-share-card"
                href={getSafeExternalUrl(post.linkCard.url)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ maxWidth: '100%', marginTop: 14 }}
              >
                <div className="blog-share-thumb">
                  {post.linkCard.image ? (
                    <img
                      src={post.linkCard.image}
                      alt={post.linkCard.title || '链接封面'}
                      loading="lazy"
                    />
                  ) : (
                    <AppIcon name="link" size={22} />
                  )}
                </div>
                <div className="blog-share-info">
                  <div className="blog-share-title">
                    {post.linkCard.title || post.linkCard.url}
                  </div>
                  {post.linkCard.description && (
                    <div className="blog-share-excerpt">{post.linkCard.description}</div>
                  )}
                  <div className="blog-share-domain">
                    {post.linkCard.siteName || getHostnameLabel(post.linkCard.url)}
                  </div>
                </div>
              </a>
            )}

            {post.locationName && (
              <div className="blog-moment-location" style={{ marginTop: 14 }}>
                <AppIcon name="mapPin" size={13} />
                <span>{post.locationName}</span>
              </div>
            )}

            {post.tags.length > 0 && (
              <div className="blog-moment-tags" style={{ marginTop: 14 }}>
                {post.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="blog-moment-tag"
                    onClick={() => onFilterTag(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}

            {(post.prev || post.next) && (
              <nav className="blog-adjacent-nav" aria-label="相邻内容导航">
                {post.prev ? (
                  <a
                    href={`#post-${post.prev.shortId}`}
                    className="blog-adjacent-card"
                    onClick={(e) => {
                      e.preventDefault()
                      onOpenPost(post.prev!.type, post.prev!.shortId)
                    }}
                  >
                    <span className="blog-adjacent-label">← 上一篇</span>
                    <span className="blog-adjacent-title">{post.prev.title || '动态详情'}</span>
                  </a>
                ) : (
                  <div />
                )}

                {post.next && (
                  <a
                    href={`#post-${post.next.shortId}`}
                    className="blog-adjacent-card is-next"
                    onClick={(e) => {
                      e.preventDefault()
                      onOpenPost(post.next!.type, post.next!.shortId)
                    }}
                  >
                    <span className="blog-adjacent-label">下一篇 →</span>
                    <span className="blog-adjacent-title">{post.next.title || '动态详情'}</span>
                  </a>
                )}
              </nav>
            )}
          </>
        )}

        <BlogCommentSection
          postId={post.id}
          shortId={post.shortId}
          comments={post.comments}
          allowComments={profile.allowComments}
          isOwner={isOwner}
          ownerNickname={profile.nickname}
          focusSignal={commentFocusSignal}
          onCommentsChange={handleCommentsChange}
        />
      </article>

      <footer className="blog-article-bottom-bar">
        <div className="blog-bottom-author">
          <div className="blog-bottom-author-avatar" aria-hidden="true">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={profile.nickname} />
            ) : (
              getAuthorMonogram(profile.nickname)
            )}
          </div>
          <span className="blog-bottom-author-name">{profile.nickname}</span>
        </div>

        <div className="blog-bottom-actions">
          <button
            type="button"
            className={`blog-bottom-action-btn${post.likedByMe ? ' is-liked' : ''}`}
            onClick={() => void handleToggleLike()}
            disabled={liking}
            aria-pressed={post.likedByMe}
          >
            <AppIcon name={post.likedByMe ? 'heartFilled' : 'heart'} size={15} />
            <span>{post.likeCount > 0 ? post.likeCount : '赞'}</span>
          </button>

          <button
            type="button"
            className="blog-bottom-action-btn"
            onClick={() => void handleBottomShare()}
            aria-label="分享"
          >
            <AppIcon name="share" size={15} />
            <span>分享</span>
          </button>

          <button
            type="button"
            className="blog-bottom-action-btn"
            onClick={() => setCommentFocusSignal((n) => n + 1)}
          >
            <AppIcon name="comment" size={15} />
            <span>写留言{post.commentCount > 0 ? ` ${post.commentCount}` : ''}</span>
          </button>
        </div>
      </footer>
    </>
  )
}
