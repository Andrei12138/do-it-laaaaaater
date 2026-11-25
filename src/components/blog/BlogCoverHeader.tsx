import type { BlogPostType, BlogProfile } from '../../blog-types'
import { AppIcon } from '../AppIcon'

export interface BlogCoverHeaderProps {
  profile: BlogProfile
  isOwner: boolean
  embedded: boolean
  activeRoute: 'feed' | 'archives'
  searchOpen: boolean
  typeFilter: 'all' | 'moment' | 'article'
  onTypeFilterChange: (type: 'all' | 'moment' | 'article') => void
  onToggleSearch: () => void
  onNavigateFeed: () => void
  onNavigateArchives: () => void
  onOpenCompose: (type?: BlogPostType) => void
  onOpenSettings: () => void
  onOpenLogin: () => void
  onBackToWorkspace?: () => void
}

function getMonogram(name: string): string {
  const trimmed = name.trim()
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : 'B'
}

export function BlogCoverHeader({
  profile,
  isOwner,
  embedded,
  activeRoute,
  searchOpen,
  typeFilter,
  onTypeFilterChange,
  onToggleSearch,
  onNavigateFeed,
  onNavigateArchives,
  onOpenCompose,
  onOpenSettings,
  onOpenLogin,
  onBackToWorkspace
}: BlogCoverHeaderProps) {
  const displayName = profile.nickname || profile.siteName || '个人博客'
  const { stats } = profile

  const handleSelectType = (nextType: 'all' | 'moment' | 'article') => {
    onTypeFilterChange(nextType)
    if (activeRoute !== 'feed') {
      onNavigateFeed()
    }
  }

  return (
    <header>
      <div className="blog-cover">
        <div className="blog-cover-media">
          {profile.coverUrl ? (
            <img
              className="blog-cover-img"
              src={profile.coverUrl}
              alt={`${displayName} 封面`}
            />
          ) : (
            <div
              aria-hidden="true"
              style={{
                width: '100%',
                height: '100%',
                background:
                  'radial-gradient(circle at 82% 24%, rgba(129, 140, 248, 0.34), transparent 44%), radial-gradient(circle at 18% 82%, rgba(77, 73, 252, 0.38), transparent 52%), linear-gradient(135deg, #161822 0%, #23263d 52%, #3b38c9 100%)',
                position: 'relative'
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage:
                    'linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px)',
                  backgroundSize: '28px 28px',
                  maskImage: 'linear-gradient(180deg, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.15) 100%)',
                  WebkitMaskImage:
                    'linear-gradient(180deg, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.15) 100%)'
                }}
              />
            </div>
          )}
          <div className="blog-cover-scrim" aria-hidden="true" />
        </div>

        <div className="blog-top-overlay">
          <div className="blog-top-left">
            {!embedded && isOwner && onBackToWorkspace && (
              <button
                type="button"
                className="blog-top-pill"
                onClick={onBackToWorkspace}
              >
                <AppIcon name="arrowLeft" size={14} />
                <span>工作台</span>
              </button>
            )}
            {activeRoute === 'archives' && (
              <button
                type="button"
                className="blog-top-pill"
                onClick={onNavigateFeed}
              >
                <AppIcon name="arrowLeft" size={14} />
                <span>朋友圈</span>
              </button>
            )}
          </div>

          <div className="blog-top-right">
            <button
              type="button"
              className={searchOpen ? 'blog-top-icon-btn is-active' : 'blog-top-icon-btn'}
              onClick={onToggleSearch}
              title="搜索与筛选"
              aria-label="搜索与筛选"
              aria-pressed={searchOpen}
            >
              <AppIcon name="search" size={16} />
            </button>

            <button
              type="button"
              className={activeRoute === 'archives' ? 'blog-top-icon-btn is-active' : 'blog-top-icon-btn'}
              onClick={onNavigateArchives}
              title="个人相册"
              aria-label="个人相册"
              aria-current={activeRoute === 'archives' ? 'page' : undefined}
            >
              <AppIcon name="album" size={16} />
            </button>

            <a
              className="blog-top-icon-btn"
              href="/api/blog/feed.xml"
              target="_blank"
              rel="noopener noreferrer"
              title="RSS 订阅"
              aria-label="RSS 订阅"
            >
              <AppIcon name="rss" size={16} />
            </a>

            {isOwner ? (
              <>
                <button
                  type="button"
                  className="blog-top-icon-btn"
                  onClick={() => onOpenCompose('moment')}
                  title="发布动态"
                  aria-label="发布动态"
                >
                  <AppIcon name="plus" size={17} />
                </button>
                <button
                  type="button"
                  className="blog-top-icon-btn"
                  onClick={onOpenSettings}
                  title="博客设置"
                  aria-label="博客设置"
                >
                  <AppIcon name="settings" size={16} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="blog-top-icon-btn"
                onClick={onOpenLogin}
                title="博主登录"
                aria-label="博主登录"
              >
                <AppIcon name="user" size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="blog-profile-seam">
          <a
            href="/archives"
            className="blog-profile-link"
            onClick={(event) => {
              event.preventDefault()
              onNavigateArchives()
            }}
            aria-label={`进入 ${displayName} 的个人相册`}
          >
            <span className="blog-profile-name">{displayName}</span>
            <span className="blog-profile-avatar">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt={displayName} />
              ) : (
                getMonogram(displayName)
              )}
            </span>
          </a>
        </div>
      </div>

      <div className="blog-profile-bio-bar">
        <nav className="blog-profile-nav" aria-label="动态与文章筛选">
          <button
            type="button"
            className={
              activeRoute === 'feed' && typeFilter === 'all'
                ? 'blog-profile-nav-pill is-active'
                : 'blog-profile-nav-pill'
            }
            onClick={() => handleSelectType('all')}
          >
            全部 {stats.totalPosts}
          </button>
          <button
            type="button"
            className={
              activeRoute === 'feed' && typeFilter === 'moment'
                ? 'blog-profile-nav-pill is-active'
                : 'blog-profile-nav-pill'
            }
            onClick={() => handleSelectType('moment')}
          >
            动态 {stats.momentCount}
          </button>
          <button
            type="button"
            className={
              activeRoute === 'feed' && typeFilter === 'article'
                ? 'blog-profile-nav-pill is-active'
                : 'blog-profile-nav-pill'
            }
            onClick={() => handleSelectType('article')}
          >
            文章 {stats.articleCount}
          </button>
          <button
            type="button"
            className={
              activeRoute === 'archives'
                ? 'blog-profile-nav-pill is-active'
                : 'blog-profile-nav-pill'
            }
            onClick={onNavigateArchives}
          >
            相册
          </button>
        </nav>

        {profile.bio && <p className="blog-profile-bio">{profile.bio}</p>}
      </div>
    </header>
  )
}
