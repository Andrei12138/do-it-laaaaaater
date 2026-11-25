import { Fragment, useMemo } from 'react'
import { groupArchivesByDate } from '../../blog-api'
import type { BlogArchiveItem, BlogProfile } from '../../blog-types'
import { AppIcon } from '../AppIcon'

export interface BlogArchivesViewProps {
  items: BlogArchiveItem[]
  loading: boolean
  profile: BlogProfile
  onBack: () => void
  onOpenArticle: (shortId: string) => void
  onOpenMoment: (shortId: string) => void
}

function getMiniCollageClass(count: number): string {
  if (count <= 1) return 'count-1'
  if (count === 2) return 'count-2'
  if (count === 3) return 'count-3'
  if (count === 4) return 'count-4'
  if (count === 5) return 'count-5'
  if (count === 6) return 'count-6'
  return 'count-many'
}

export function BlogArchivesView({
  items,
  loading,
  profile,
  onBack,
  onOpenArticle,
  onOpenMoment
}: BlogArchivesViewProps) {
  const groups = useMemo(() => groupArchivesByDate(items), [items])
  const ownerName = profile.nickname || profile.siteName || '个人'

  const renderArchiveItem = (item: BlogArchiveItem) => {
    const isArticle = item.type === 'article'
    const href = isArticle
      ? `/blog/articles/${encodeURIComponent(item.shortId)}`
      : `/blog/moments/${encodeURIComponent(item.shortId)}`

    const handleOpen = (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
      if (isArticle) onOpenArticle(item.shortId)
      else onOpenMoment(item.shortId)
    }

    if (item.locked) {
      return (
        <a href={href} className="blog-archive-card" onClick={handleOpen}>
          <div
            className="blog-mini-collage count-1"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--blog-surface-subtle)',
              color: 'var(--blog-warning)'
            }}
          >
            <AppIcon name="lock" size={22} />
          </div>
          <div className="blog-archive-card-body">
            <div className="blog-archive-card-title">加密内容</div>
            <div className="blog-archive-card-meta">点击输入密码解锁</div>
          </div>
        </a>
      )
    }

    if (isArticle) {
      return (
        <a href={href} className="blog-archive-card" onClick={handleOpen}>
          {item.coverUrl ? (
            <div className="blog-mini-collage count-1">
              <img src={item.coverUrl} alt={item.title || '文章封面'} loading="lazy" />
            </div>
          ) : (
            <div
              className="blog-mini-collage count-1"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--blog-link-soft)',
                color: 'var(--blog-link)'
              }}
            >
              <AppIcon name="book" size={22} />
            </div>
          )}
          <div className="blog-archive-card-body">
            <div className="blog-archive-card-meta">
              <span className="blog-badge-category">文章</span>
              {item.visibility === 'private' && <span className="blog-badge-private">私密</span>}
              {item.isPinned && <span className="blog-badge-pin">置顶</span>}
            </div>
            <div className="blog-archive-card-title">{item.title || '无标题文章'}</div>
            {item.excerpt && <div className="blog-archive-card-preview">{item.excerpt}</div>}
          </div>
        </a>
      )
    }

    if (item.images.length > 0) {
      const thumbs = item.images.slice(0, 9)
      return (
        <a href={href} className="blog-archive-card" onClick={handleOpen}>
          <div className={`blog-mini-collage ${getMiniCollageClass(thumbs.length)}`}>
            {thumbs.map((img, idx) => (
              <img
                key={img.mediaId || `${img.url}-${idx}`}
                src={img.thumbUrl || img.url}
                alt={img.alt || ''}
                loading="lazy"
              />
            ))}
          </div>
          <div className="blog-archive-card-body">
            <div
              className="blog-archive-card-preview"
              style={{ WebkitLineClamp: 2 }}
            >
              {item.contentPreview || '分享图片'}
            </div>
            <div className="blog-archive-card-meta">
              <span>共 {item.images.length} 张</span>
              {item.visibility === 'private' && <span className="blog-badge-private">私密</span>}
            </div>
          </div>
        </a>
      )
    }

    return (
      <a href={href} className="blog-archive-card" onClick={handleOpen}>
        <div
          className="blog-archive-card-body"
          style={{
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'var(--blog-surface-subtle)',
            border: '1px solid var(--blog-divider)'
          }}
        >
          <div className="blog-archive-card-preview">{item.contentPreview || '无文字动态'}</div>
          {(item.visibility === 'private' || item.isPinned) && (
            <div className="blog-archive-card-meta">
              {item.isPinned && <span className="blog-badge-pin">置顶</span>}
              {item.visibility === 'private' && <span className="blog-badge-private">私密</span>}
            </div>
          )}
        </div>
      </a>
    )
  }

  let previousYear: number | null = null

  return (
    <section aria-label={`${ownerName}的个人相册`}>
      <div className="blog-sticky-bar">
        <button type="button" className="blog-sticky-back" onClick={onBack}>
          <AppIcon name="arrowLeft" size={16} />
          <span>返回朋友圈</span>
        </button>
        <div className="blog-sticky-title">个人相册</div>
        <div className="blog-sticky-actions">
          <span className="blog-floor-count">{items.length} 条</span>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="blog-empty">
          <div className="blog-empty-icon">
            <AppIcon name="album" size={22} />
          </div>
          <p className="blog-empty-title">正在整理相册时间轴…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="blog-empty">
          <div className="blog-empty-icon">
            <AppIcon name="album" size={22} />
          </div>
          <h3 className="blog-empty-title">还没有归档内容</h3>
          <p className="blog-empty-desc">发布的动态与文章会按日期收纳在个人相册中。</p>
        </div>
      ) : (
        <>
          <div className="blog-archives-list">
            {groups.map((group) => {
              const showYearHeading = group.year !== previousYear
              previousYear = group.year
              return (
                <Fragment key={group.key}>
                  {showYearHeading && <h2 className="blog-archive-year">{group.year}年</h2>}
                  {group.items.map((item, itemIdx) => (
                    <div key={item.id} className="blog-archive-row">
                      <div className="blog-archive-date">
                        {itemIdx === 0 && (
                          group.specialLabel ? (
                            <span className="blog-archive-special">{group.specialLabel}</span>
                          ) : (
                            <>
                              <span className="blog-archive-day">{group.dayLabel}</span>
                              <span className="blog-archive-month">{group.monthLabel}</span>
                            </>
                          )
                        )}
                        {item.locationName && (
                          <span className="blog-archive-loc" title={item.locationName}>
                            {item.locationName}
                          </span>
                        )}
                      </div>
                      {renderArchiveItem(item)}
                    </div>
                  ))}
                </Fragment>
              )
            })}
          </div>

          <div className="blog-load-more">
            <span className="blog-load-more-end">— 已经到底了 —</span>
          </div>
        </>
      )}
    </section>
  )
}
