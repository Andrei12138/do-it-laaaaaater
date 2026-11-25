import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction
} from 'react'
import { errorMessage } from '../../api-error'
import {
  deleteBlogPost,
  fetchBlogArchives,
  fetchBlogBootstrap,
  fetchBlogPost,
  fetchBlogPosts,
  importLibraryItemToBlog,
  updateBlogPost
} from '../../blog-api'
import '../../blog.css'
import '../../blog-phase2.css'
import '../../blog-bento.css'
import type { TocHeading } from '../../blog-markdown'
import { BlogMusicProvider, useBlogMusicActions } from '../../blog-music'
import type {
  BlogArchiveItem,
  BlogBootstrap,
  BlogImportedItemDraft,
  BlogPostDetail,
  BlogPostSummary,
  BlogPostType,
  BlogProfile
} from '../../blog-types'
import { AppIcon, BrandMark } from '../AppIcon'
import { showToast } from '../Toast'
import { BlogArchivesView } from './BlogArchivesView'
import { BlogArticleView } from './BlogArticleView'
import { BlogCoverHeader } from './BlogCoverHeader'
import { BlogLightbox, type BlogLightboxImage } from './BlogLightbox'
import { BlogMomentCard } from './BlogMomentCard'
import { BlogLeftRail, BlogRightRail, readBlogSidebarConfig } from './BlogSideRails'

const BlogComposerModal = lazy(() =>
  import('./BlogComposerModal').then((module) => ({ default: module.BlogComposerModal }))
)

const BlogSettingsModal = lazy(() =>
  import('./BlogSettingsModal').then((module) => ({ default: module.BlogSettingsModal }))
)

const BlogPagesView = lazy(() =>
  import('./BlogPagesView').then((module) => ({ default: module.BlogPagesView }))
)

export interface BlogAppProps {
  path: string
  embedded?: boolean
  pendingImportItemId?: string | null
  onConsumePendingImport?: () => void
  onNavigate: (path: string) => void
  onRequestLogin: () => void
  onBackToWorkspace?: () => void
  onSwitchWorkspaceTab?: (tab: 'list' | 'plan') => void
}

type BlogRoute =
  | { kind: 'feed' }
  | { kind: 'archives' }
  | { kind: 'about' }
  | { kind: 'equipment' }
  | { kind: 'labs' }
  | { kind: 'friends' }
  | { kind: 'article'; shortId: string }
  | { kind: 'moment'; shortId: string }

const BLOG_THEME_STORAGE_KEY = 'do-it-laaaaaater.blog.theme.v1'
const DESKTOP_RAIL_MEDIA_QUERY = '(min-width: 1240px)'
const FEED_PAGE_SIZE = 15

const DEFAULT_PROFILE: BlogProfile = {
  siteName: '个人博客',
  nickname: '个人博客',
  bio: '',
  avatarMediaId: null,
  avatarUrl: null,
  coverMediaId: null,
  coverUrl: null,
  footerText: '',
  allowComments: true,
  extensions: {},
  stats: {
    totalPosts: 0,
    momentCount: 0,
    articleCount: 0,
    commentCount: 0
  }
}

function readInitialDarkMode(): boolean {
  try {
    const stored = globalThis.localStorage?.getItem(BLOG_THEME_STORAGE_KEY)
    if (stored === 'dark') return true
    if (stored === 'light') return false
  } catch {
    // Ignore storage access errors.
  }
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches)
  } catch {
    return false
  }
}

function readIsDesktopRail(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(DESKTOP_RAIL_MEDIA_QUERY).matches
}

function getScrollBehavior(): ScrollBehavior {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return 'auto'
  }
  return 'smooth'
}

function safeDecodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function parseBlogRoute(rawPath: string): BlogRoute {
  const withoutQuery = (rawPath.split('?')[0] || '/').replace(/\/+$/, '') || '/'
  const clean =
    withoutQuery === '/blog'
      ? '/'
      : withoutQuery.startsWith('/blog/')
        ? withoutQuery.slice('/blog'.length)
        : withoutQuery
  if (clean === '/archives') {
    return { kind: 'archives' }
  }
  if (clean === '/about') {
    return { kind: 'about' }
  }
  if (clean === '/equipment') {
    return { kind: 'equipment' }
  }
  if (clean === '/labs') {
    return { kind: 'labs' }
  }
  if (clean === '/friends') {
    return { kind: 'friends' }
  }
  const articleMatch = /^\/articles\/([^/]+)$/.exec(clean)
  if (articleMatch && articleMatch[1]) {
    return { kind: 'article', shortId: safeDecodeSegment(articleMatch[1]) }
  }
  const momentMatch = /^\/moments\/([^/]+)$/.exec(clean)
  if (momentMatch && momentMatch[1]) {
    return { kind: 'moment', shortId: safeDecodeSegment(momentMatch[1]) }
  }
  return { kind: 'feed' }
}

interface BlogAppInnerProps extends BlogAppProps {
  route: BlogRoute
  bootstrap: BlogBootstrap | null
  bootstrapSettled: boolean
  ownerReauthVersion: number
  isDesktopRail: boolean
  setBootstrap: Dispatch<SetStateAction<BlogBootstrap | null>>
  refreshBootstrap: () => Promise<void>
  isOwner: boolean
  sidebarConfig: ReturnType<typeof readBlogSidebarConfig>
}

export function BlogApp(props: BlogAppProps) {
  const { path, embedded = false } = props
  const route = useMemo(() => parseBlogRoute(path), [path])
  const [bootstrap, setBootstrap] = useState<BlogBootstrap | null>(null)
  const [bootstrapSettled, setBootstrapSettled] = useState(false)
  const [ownerReauthVersion, setOwnerReauthVersion] = useState(0)
  const [isDesktopRail, setIsDesktopRail] = useState<boolean>(readIsDesktopRail)

  const embeddedRef = useRef(embedded)
  embeddedRef.current = embedded
  const prevEmbeddedRef = useRef(embedded)

  const refreshBootstrap = useCallback(async (full = false) => {
    try {
      const data = await fetchBlogBootstrap(full ? { full: true } : undefined)
      setBootstrap((prev) =>
        prev
          ? {
              ...data,
              initialPosts: data.initialPosts ?? prev.initialPosts,
              tracks: data.tracks ?? prev.tracks,
              railSummary: data.railSummary ?? prev.railSummary
            }
          : data
      )
      return data
    } catch {
      // Non-fatal: feed/detail requests carry their own error states.
      return null
    } finally {
      setBootstrapSettled(true)
    }
  }, [])

  // Initial mount: call fetchBlogBootstrap({ full: true }) ONCE (no `embedded` dep!)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const data = await refreshBootstrap(true)
      if (cancelled) return
      if (data && embeddedRef.current && !data.isOwner) {
        const upgraded = await refreshBootstrap(true)
        if (!cancelled && upgraded?.isOwner) {
          setOwnerReauthVersion((v) => v + 1)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshBootstrap])

  // Only refetch bootstrap/feed when `embedded` transitions false -> true AND `bootstrap.isOwner` was false
  useEffect(() => {
    const wasEmbedded = prevEmbeddedRef.current
    prevEmbeddedRef.current = embedded
    if (!wasEmbedded && embedded && bootstrap !== null && !bootstrap.isOwner) {
      void (async () => {
        await refreshBootstrap(true)
        setOwnerReauthVersion((v) => v + 1)
      })()
    }
  }, [embedded, bootstrap, refreshBootstrap])

  // Track desktop (>= 1240px) rail viewport breakpoint
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(DESKTOP_RAIL_MEDIA_QUERY)
    const onChange = (event: MediaQueryListEvent) => {
      setIsDesktopRail(event.matches)
    }
    setIsDesktopRail(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const profile = bootstrap?.profile ?? DEFAULT_PROFILE
  const sidebarConfig = useMemo(
    () => readBlogSidebarConfig(profile.extensions),
    [profile.extensions]
  )
  const musicInRightRail = isDesktopRail && !sidebarConfig.hiddenWidgets.includes('music')
  const isOwner = bootstrap ? bootstrap.isOwner : Boolean(embedded)
  const isDetailRoute = route.kind === 'article' || route.kind === 'moment'

  const handleRefreshBootstrap = useCallback(async () => {
    await refreshBootstrap(false)
  }, [refreshBootstrap])

  return (
    <BlogMusicProvider
      isOwner={isOwner}
      hasBottomBar={isDetailRoute}
      desktopRailActive={musicInRightRail}
      initialTracks={bootstrap?.tracks}
      deferInitialFetch={!bootstrapSettled}
    >
      <BlogAppInner
        {...props}
        route={route}
        bootstrap={bootstrap}
        bootstrapSettled={bootstrapSettled}
        ownerReauthVersion={ownerReauthVersion}
        isDesktopRail={isDesktopRail}
        setBootstrap={setBootstrap}
        refreshBootstrap={handleRefreshBootstrap}
        isOwner={isOwner}
        sidebarConfig={sidebarConfig}
      />
    </BlogMusicProvider>
  )
}

function BlogAppInner({
  embedded = false,
  pendingImportItemId,
  onConsumePendingImport,
  onNavigate,
  onRequestLogin,
  onBackToWorkspace,
  onSwitchWorkspaceTab,
  route,
  bootstrap,
  bootstrapSettled,
  ownerReauthVersion,
  isDesktopRail,
  setBootstrap,
  refreshBootstrap,
  isOwner,
  sidebarConfig
}: BlogAppInnerProps) {
  // Subscribe ONLY to stable music state/actions so audio.ontimeupdate never re-renders BlogApp or feed cards
  const music = useBlogMusicActions()

  const [darkMode, setDarkMode] = useState<boolean>(readInitialDarkMode)

  // Search & filter state for feed
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'moment' | 'article'>('all')
  const [activeTag, setActiveTag] = useState('')
  const [activeCategory, setActiveCategory] = useState('')

  // Feed pagination state
  const [posts, setPosts] = useState<BlogPostSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [feedLoading, setFeedLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [feedError, setFeedError] = useState('')
  const [feedRefreshTick, setFeedRefreshTick] = useState(0)

  // Archives state
  const [archiveItems, setArchiveItems] = useState<BlogArchiveItem[]>([])
  const [archivesLoading, setArchivesLoading] = useState(false)
  const [archivesRefreshTick, setArchivesRefreshTick] = useState(0)

  // Detail state
  const [detailPost, setDetailPost] = useState<BlogPostDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailRefreshTick, setDetailRefreshTick] = useState(0)

  // Owner modals & shared lightbox
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerInitialType, setComposerInitialType] = useState<BlogPostType>('moment')
  const [editingPost, setEditingPost] = useState<BlogPostSummary | null>(null)
  const [importedDraft, setImportedDraft] = useState<BlogImportedItemDraft | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lightbox, setLightbox] = useState<{ images: BlogLightboxImage[]; index: number } | null>(null)

  // Scroll state for floating dock
  const [showBackToTop, setShowBackToTop] = useState(false)

  // Bento side rails state (refresh tick & article TOC)
  const [railRefreshTick, setRailRefreshTick] = useState(0)
  const [articleToc, setArticleToc] = useState<{ headings: TocHeading[]; activeId: string }>({
    headings: [],
    activeId: ''
  })

  const feedReqIdRef = useRef(0)
  const hydratedInitialPostsRef = useRef(false)
  const prevOwnerReauthVersionRef = useRef(ownerReauthVersion)
  const searchInputElRef = useRef<HTMLInputElement | null>(null)
  const prevRouteKindRef = useRef<BlogRoute['kind']>(route.kind)

  useEffect(() => {
    const prevKind = prevRouteKindRef.current
    prevRouteKindRef.current = route.kind
    if (
      prevKind !== route.kind &&
      (prevKind === 'about' ||
        prevKind === 'equipment' ||
        prevKind === 'labs' ||
        prevKind === 'friends')
    ) {
      setRailRefreshTick((t) => t + 1)
    }
  }, [route.kind])

  // Follow system prefers-color-scheme changes if user has not manually chosen a theme yet
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => {
      try {
        if (globalThis.localStorage?.getItem(BLOG_THEME_STORAGE_KEY) !== null) return
      } catch {
        // Ignore storage errors.
      }
      setDarkMode(event.matches)
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Sync <meta name="theme-color"> with darkMode and restore '#ffffff' on unmount
  useEffect(() => {
    if (typeof document === 'undefined') return
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) return
    meta.setAttribute('content', darkMode ? '#111113' : '#ffffff')
    return () => {
      meta.setAttribute('content', '#ffffff')
    }
  }, [darkMode])

  const handleTocStateChange = useCallback((headings: TocHeading[], activeId: string) => {
    setArticleToc((prev) =>
      prev.headings === headings && prev.activeId === activeId ? prev : { headings, activeId }
    )
  }, [])

  const handleJumpHeading = useCallback((id: string) => {
    if (typeof document === 'undefined') return
    const target = document.getElementById(id)
    if (target) {
      target.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' })
      setArticleToc((prev) => (prev.activeId === id ? prev : { ...prev, activeId: id }))
    }
  }, [])

  const profile = bootstrap?.profile ?? DEFAULT_PROFILE
  const existingCategories = useMemo(
    () => (bootstrap?.categories ?? []).map((item) => item.name).filter(Boolean),
    [bootstrap]
  )

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev
      try {
        globalThis.localStorage?.setItem(BLOG_THEME_STORAGE_KEY, next ? 'dark' : 'light')
      } catch {
        // Ignore storage write failures.
      }
      return next
    })
  }, [])

  // Debounce search input
  useEffect(() => {
    const trimmed = searchInput.trim()
    if (!trimmed) {
      setDebouncedQuery('')
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(trimmed)
    }, 260)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  // Focus search input when drawer opens
  useEffect(() => {
    if (searchOpen && route.kind === 'feed') {
      const timer = window.setTimeout(() => {
        searchInputElRef.current?.focus()
      }, 40)
      return () => window.clearTimeout(timer)
    }
  }, [searchOpen, route.kind])

  // Track scroll position for Back-to-Top button
  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 280)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Restore original document.title when leaving BlogApp
  useEffect(() => {
    const previousTitle = document.title
    return () => {
      document.title = previousTitle
    }
  }, [])

  // Dynamic document.title per route
  useEffect(() => {
    const siteTitle = profile.siteName || profile.nickname || '个人博客'
    if ((route.kind === 'article' || route.kind === 'moment') && detailPost && detailPost.shortId === route.shortId) {
      const postLabel =
        detailPost.title?.trim() ||
        (detailPost.locked ? '加密内容' : detailPost.excerpt?.trim().slice(0, 28)) ||
        '动态详情'
      document.title = `${postLabel} · ${siteTitle}`
    } else if (route.kind === 'archives') {
      document.title = `个人相册 · ${siteTitle}`
    } else if (route.kind === 'about') {
      document.title = `关于 · ${siteTitle}`
    } else if (route.kind === 'equipment') {
      document.title = `装备清单 · ${siteTitle}`
    } else if (route.kind === 'labs') {
      document.title = `实验室 · ${siteTitle}`
    } else if (route.kind === 'friends') {
      document.title = `友情链接 · ${siteTitle}`
    } else {
      document.title = siteTitle
    }
  }, [route, detailPost, profile.siteName, profile.nickname])

  const isDefaultFeedQuery =
    typeFilter === 'all' && !debouncedQuery && !activeTag && !activeCategory

  // Hydrate initial feed directly from `bootstrap.initialPosts` (zero-waterfall on `/`)
  useEffect(() => {
    if (!bootstrapSettled) return
    if (hydratedInitialPostsRef.current) return
    hydratedInitialPostsRef.current = true

    if (bootstrap?.initialPosts && isDefaultFeedQuery && feedRefreshTick === 0) {
      ++feedReqIdRef.current
      setPosts(bootstrap.initialPosts.posts)
      setHasMore(bootstrap.initialPosts.hasMore)
      setPage(bootstrap.initialPosts.page || 1)
      setFeedError('')
      setFeedLoading(false)
      return
    }

    if (isDefaultFeedQuery && feedRefreshTick === 0) {
      setFeedRefreshTick((t) => t + 1)
    }
  }, [bootstrapSettled, bootstrap?.initialPosts, isDefaultFeedQuery, feedRefreshTick])

  // Refresh active data ONLY when a guest session transitioned into owner (`ownerReauthVersion` bumped)
  useEffect(() => {
    if (prevOwnerReauthVersionRef.current === ownerReauthVersion) return
    prevOwnerReauthVersionRef.current = ownerReauthVersion

    if (bootstrap?.initialPosts && isDefaultFeedQuery) {
      ++feedReqIdRef.current
      setPosts(bootstrap.initialPosts.posts)
      setHasMore(bootstrap.initialPosts.hasMore)
      setPage(bootstrap.initialPosts.page || 1)
      setFeedError('')
      setFeedLoading(false)
    } else {
      setFeedRefreshTick((t) => t + 1)
    }
    setArchivesRefreshTick((t) => t + 1)
    setDetailRefreshTick((t) => t + 1)
  }, [ownerReauthVersion, bootstrap?.initialPosts, isDefaultFeedQuery])

  // Load feed page 1 whenever filters or refresh tick change (NO `embedded` dep!)
  useEffect(() => {
    if (
      typeFilter === 'all' &&
      !debouncedQuery &&
      !activeTag &&
      !activeCategory &&
      feedRefreshTick === 0 &&
      !hydratedInitialPostsRef.current
    ) {
      return
    }

    hydratedInitialPostsRef.current = true
    const reqId = ++feedReqIdRef.current
    setFeedLoading(true)
    setFeedError('')

    void (async () => {
      try {
        const res = await fetchBlogPosts({
          type: typeFilter,
          q: debouncedQuery || undefined,
          tag: activeTag || undefined,
          category: activeCategory || undefined,
          page: 1,
          limit: FEED_PAGE_SIZE
        })
        if (reqId !== feedReqIdRef.current) return
        setPosts(res.posts)
        setHasMore(res.hasMore)
        setPage(1)
      } catch (err) {
        if (reqId !== feedReqIdRef.current) return
        setFeedError(errorMessage(err))
      } finally {
        if (reqId === feedReqIdRef.current) {
          setFeedLoading(false)
        }
      }
    })()
  }, [typeFilter, debouncedQuery, activeTag, activeCategory, feedRefreshTick])

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const nextPage = page + 1
    const reqId = feedReqIdRef.current
    setLoadingMore(true)
    try {
      const res = await fetchBlogPosts({
        type: typeFilter,
        q: debouncedQuery || undefined,
        tag: activeTag || undefined,
        category: activeCategory || undefined,
        page: nextPage,
        limit: FEED_PAGE_SIZE
      })
      if (reqId !== feedReqIdRef.current) return
      setPosts((prev) => {
        const seen = new Set(prev.map((item) => item.id))
        const appended = res.posts.filter((item) => !seen.has(item.id))
        return [...prev, ...appended]
      })
      setHasMore(res.hasMore)
      setPage(nextPage)
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, page, typeFilter, debouncedQuery, activeTag, activeCategory])

  // Load archives when visiting /archives (NO `embedded` dep!)
  useEffect(() => {
    if (route.kind !== 'archives') return
    let cancelled = false
    setArchivesLoading(true)
    void (async () => {
      try {
        const res = await fetchBlogArchives()
        if (cancelled) return
        setArchiveItems(res.items)
      } catch (err) {
        if (cancelled) return
        showToast('error', errorMessage(err))
      } finally {
        if (!cancelled) setArchivesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [route.kind, archivesRefreshTick])

  // Load post detail when visiting /articles/:shortId or /moments/:shortId (NO `embedded` dep!)
  const activeDetailShortId = route.kind === 'article' || route.kind === 'moment' ? route.shortId : null
  useEffect(() => {
    if (!activeDetailShortId) return
    let cancelled = false
    setDetailLoading(true)
    setDetailError('')
    void (async () => {
      try {
        const detail = await fetchBlogPost(activeDetailShortId)
        if (cancelled) return
        setDetailPost(detail)
        setPosts((prev) =>
          prev.map((item) =>
            item.id === detail.id || item.shortId === detail.shortId ? { ...detail } : item
          )
        )
      } catch (err) {
        if (cancelled) return
        setDetailError(errorMessage(err))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeDetailShortId, detailRefreshTick])

  // Auto-import library item into composer when pendingImportItemId is passed
  useEffect(() => {
    if (!pendingImportItemId) return
    let cancelled = false
    const itemId = pendingImportItemId
    void (async () => {
      try {
        const draft = await importLibraryItemToBlog(itemId)
        if (cancelled) return
        onConsumePendingImport?.()
        setEditingPost(null)
        setImportedDraft(draft)
        setComposerInitialType(draft.type)
        setComposerOpen(true)
      } catch (err) {
        if (cancelled) return
        onConsumePendingImport?.()
        showToast('error', errorMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pendingImportItemId, onConsumePendingImport])

  const handleOpenCompose = useCallback((type: BlogPostType = 'moment') => {
    setEditingPost(null)
    setImportedDraft(null)
    setComposerInitialType(type)
    setComposerOpen(true)
  }, [])

  const handleEditPost = useCallback(
    (post: BlogPostSummary) => {
      const resolved = detailPost && detailPost.id === post.id ? detailPost : post
      setImportedDraft(null)
      setEditingPost(resolved)
      setComposerInitialType(resolved.type)
      setComposerOpen(true)
    },
    [detailPost]
  )

  const handleCloseComposer = useCallback(() => {
    setComposerOpen(false)
    setEditingPost(null)
    setImportedDraft(null)
  }, [])

  const handleComposerSaved = useCallback(
    (savedPost: BlogPostDetail, isNew: boolean) => {
      setComposerOpen(false)
      setEditingPost(null)
      setImportedDraft(null)

      void refreshBootstrap()
      setFeedRefreshTick((t) => t + 1)
      setArchivesRefreshTick((t) => t + 1)
      setRailRefreshTick((t) => t + 1)

      if (detailPost && (detailPost.id === savedPost.id || detailPost.shortId === savedPost.shortId)) {
        setDetailPost(savedPost)
      }

      if (isNew && route.kind !== 'feed') {
        if (savedPost.type === 'article') {
          onNavigate(`/articles/${encodeURIComponent(savedPost.shortId)}`)
        } else {
          onNavigate('/')
        }
      }
    },
    [detailPost, onNavigate, refreshBootstrap, route.kind]
  )

  const handleSummaryPostUpdated = useCallback((updated: BlogPostSummary) => {
    setPosts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    setDetailPost((prev) =>
      prev && prev.id === updated.id
        ? {
            ...prev,
            ...updated
          }
        : prev
    )
  }, [])

  const handleDetailPostUpdated = useCallback((updated: BlogPostDetail) => {
    setDetailPost(updated)
    setPosts((prev) =>
      prev.map((item) => (item.id === updated.id || item.shortId === updated.shortId ? { ...updated } : item))
    )
  }, [])

  const handleTogglePin = useCallback(
    async (post: BlogPostSummary) => {
      try {
        const updated = await updateBlogPost(post.shortId, { isPinned: !post.isPinned })
        showToast('success', updated.isPinned ? '已置顶' : '已取消置顶')
        setFeedRefreshTick((t) => t + 1)
        setArchivesRefreshTick((t) => t + 1)
        setRailRefreshTick((t) => t + 1)
        setDetailPost((prev) => (prev && prev.id === updated.id ? updated : prev))
      } catch (err) {
        showToast('error', errorMessage(err))
      }
    },
    []
  )

  const handleDeletePost = useCallback(
    async (post: BlogPostSummary) => {
      const label = post.type === 'article' ? '文章' : '动态'
      if (!window.confirm(`确定要删除这条${label}吗？删除后无法恢复。`)) return
      try {
        await deleteBlogPost(post.shortId)
        setPosts((prev) => prev.filter((item) => item.id !== post.id))
        setArchiveItems((prev) => prev.filter((item) => item.id !== post.id))
        setRailRefreshTick((t) => t + 1)
        void refreshBootstrap()
        showToast('success', `${label}已删除`)
        if (
          (route.kind === 'article' || route.kind === 'moment') &&
          route.shortId === post.shortId
        ) {
          onNavigate('/')
        }
      } catch (err) {
        showToast('error', errorMessage(err))
      }
    },
    [onNavigate, refreshBootstrap, route]
  )

  const handleFilterTag = useCallback(
    (tag: string) => {
      const cleaned = tag.trim()
      if (!cleaned) return
      if (route.kind === 'feed' && activeTag === cleaned) {
        setActiveTag('')
        return
      }
      setActiveTag(cleaned)
      setSearchOpen(true)
      if (route.kind !== 'feed') {
        onNavigate('/')
      }
    },
    [activeTag, onNavigate, route.kind]
  )

  const handleResetFilters = useCallback(() => {
    setSearchInput('')
    setDebouncedQuery('')
    setTypeFilter('all')
    setActiveTag('')
    setActiveCategory('')
  }, [])

  const handleOpenLightbox = useCallback((images: BlogLightboxImage[], index: number) => {
    if (!images.length) return
    setLightbox({ images, index })
  }, [])

  const handleWorkspaceBack = useCallback(() => {
    if (onBackToWorkspace) {
      onBackToWorkspace()
    } else if (onSwitchWorkspaceTab) {
      onSwitchWorkspaceTab('list')
    }
  }, [onBackToWorkspace, onSwitchWorkspaceTab])

  const handleWorkspaceTab = useCallback(
    (tab: 'list' | 'plan') => {
      if (onSwitchWorkspaceTab) {
        onSwitchWorkspaceTab(tab)
      } else if (onBackToWorkspace) {
        onBackToWorkspace()
      }
    },
    [onSwitchWorkspaceTab, onBackToWorkspace]
  )

  const hasActiveFilters = Boolean(
    searchInput.trim() || debouncedQuery || typeFilter !== 'all' || activeTag || activeCategory
  )

  const embeddedHeaderStyle: CSSProperties | undefined = darkMode
    ? ({
        background: 'rgba(17, 17, 19, 0.92)',
        borderBottomColor: 'rgba(255, 255, 255, 0.09)',
        '--bg-surface': '#1a1a1e',
        '--bg-subtle': '#26262e',
        '--bg-mist': '#32323c',
        '--text-primary': '#f4f4f5',
        '--text-muted': '#a1a1aa',
        '--border-subtle': 'rgba(255, 255, 255, 0.12)'
      } as CSSProperties)
    : undefined

  const isDetailRoute = route.kind === 'article' || route.kind === 'moment'

  return (
    <>
      {embedded && (
        <header
          className="fig-header blog-embedded-header"
          data-blog-theme={darkMode ? 'dark' : 'light'}
          style={embeddedHeaderStyle}
        >
          <div className="fig-header-inner">
            <div className="fig-header-left">
              <button
                type="button"
                className="fig-brand"
                onClick={handleWorkspaceBack}
                title="返回稍后阅读工作台"
              >
                <BrandMark size={22} />
                <span className="fig-brand-name">Do It Laaaaaater</span>
              </button>

              <nav className="fig-nav-tabs" aria-label="主视图">
                <button
                  type="button"
                  className="fig-nav-tab"
                  onClick={() => handleWorkspaceTab('list')}
                >
                  清单
                </button>
                <button
                  type="button"
                  className="fig-nav-tab"
                  onClick={() => handleWorkspaceTab('plan')}
                >
                  计划
                </button>
                <button
                  type="button"
                  className="fig-nav-tab is-active"
                  aria-current="page"
                  onClick={() => onNavigate('/')}
                >
                  博客
                </button>
              </nav>
            </div>

            <div className="fig-header-right">
              {(onBackToWorkspace || onSwitchWorkspaceTab) && (
                <button
                  type="button"
                  className="btn btn-text btn-sm"
                  onClick={handleWorkspaceBack}
                >
                  <AppIcon name="arrowLeft" size={14} />
                  <span>工作台</span>
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleOpenCompose(route.kind === 'article' ? 'article' : 'moment')}
              >
                <AppIcon name="edit" size={15} />
                <span>写博客</span>
              </button>
            </div>
          </div>
        </header>
      )}

      <div
        className={embedded ? 'blog-root is-embedded' : 'blog-root'}
        data-blog-theme={darkMode ? 'dark' : 'light'}
      >
        <div className="blog-bento-stage">
          {isDesktopRail && (
            <BlogLeftRail
              profile={profile}
              isOwner={isOwner}
              activeRoute={route.kind}
              hiddenWidgets={sidebarConfig.hiddenWidgets}
              refreshTick={railRefreshTick}
              initialSummary={bootstrap?.railSummary ?? null}
              summaryLoading={!bootstrapSettled}
              onNavigate={onNavigate}
              onOpenLightbox={handleOpenLightbox}
              onOpenCompose={handleOpenCompose}
              articleHeadings={route.kind === 'article' ? articleToc.headings : undefined}
              activeHeadingId={route.kind === 'article' ? articleToc.activeId : undefined}
              onJumpHeading={handleJumpHeading}
            />
          )}
          <main className="blog-shell">
            {!isDetailRoute && (
              <BlogCoverHeader
                profile={profile}
                isOwner={isOwner}
                embedded={embedded}
                activeRoute={route.kind}
                searchOpen={searchOpen}
                typeFilter={typeFilter}
                onTypeFilterChange={setTypeFilter}
                onToggleSearch={() => {
                  if (route.kind !== 'feed') {
                    setSearchOpen(true)
                    onNavigate('/')
                  } else {
                    setSearchOpen((prev) => !prev)
                  }
                }}
                onNavigateFeed={() => onNavigate('/')}
                onNavigateArchives={() => {
                  setSearchOpen(false)
                  onNavigate('/archives')
                }}
                onNavigatePage={(section) => {
                  setSearchOpen(false)
                  onNavigate(`/${section}`)
                }}
                onOpenMusic={() =>
                  music.tracks.length > 0 || music.currentTrack
                    ? music.openDrawer()
                    : music.openManager()
                }
                musicPlaying={music.isPlaying}
                hasMusic={music.tracks.length > 0 || Boolean(music.currentTrack)}
                onOpenCompose={(type) => handleOpenCompose(type ?? 'moment')}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenLogin={onRequestLogin}
                onBackToWorkspace={onBackToWorkspace}
              />
            )}

            {route.kind === 'feed' && (searchOpen || activeTag || activeCategory || debouncedQuery) && (
              <section className="blog-search-drawer" aria-label="搜索与筛选">
                <div className="blog-search-row">
                  <div className="blog-search-input-wrap">
                    <span className="blog-search-icon" aria-hidden="true">
                      <AppIcon name="search" size={15} />
                    </span>
                    <input
                      ref={searchInputElRef}
                      type="search"
                      className="blog-search-input"
                      placeholder="搜索动态、文章标题、正文或标签…"
                      aria-label="搜索博客内容"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          if (searchInput) setSearchInput('')
                          else setSearchOpen(false)
                        }
                      }}
                    />
                    {searchInput && (
                      <button
                        type="button"
                        className="blog-search-clear"
                        aria-label="清空搜索词"
                        onClick={() => setSearchInput('')}
                      >
                        <AppIcon name="close" size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="blog-filter-chips">
                  <button
                    type="button"
                    className={typeFilter === 'all' ? 'blog-filter-chip is-active' : 'blog-filter-chip'}
                    onClick={() => setTypeFilter('all')}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    className={typeFilter === 'moment' ? 'blog-filter-chip is-active' : 'blog-filter-chip'}
                    onClick={() => setTypeFilter('moment')}
                  >
                    动态
                  </button>
                  <button
                    type="button"
                    className={typeFilter === 'article' ? 'blog-filter-chip is-active' : 'blog-filter-chip'}
                    onClick={() => setTypeFilter('article')}
                  >
                    文章
                  </button>

                  {(bootstrap?.categories ?? []).map((cat) => (
                    <button
                      key={cat.name}
                      type="button"
                      className={
                        activeCategory === cat.name ? 'blog-filter-chip is-active' : 'blog-filter-chip'
                      }
                      onClick={() =>
                        setActiveCategory((prev) => (prev === cat.name ? '' : cat.name))
                      }
                    >
                      <span>{cat.name}</span>
                    </button>
                  ))}

                  {activeCategory &&
                    !(bootstrap?.categories ?? []).some((cat) => cat.name === activeCategory) && (
                      <button
                        type="button"
                        className="blog-filter-chip is-active"
                        onClick={() => setActiveCategory('')}
                      >
                        <span>分类：{activeCategory}</span>
                        <AppIcon name="close" size={11} />
                      </button>
                    )}

                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="blog-filter-reset"
                      onClick={handleResetFilters}
                    >
                      清除筛选
                    </button>
                  )}
                </div>

                {((bootstrap?.tags.length ?? 0) > 0 || Boolean(activeTag)) && (
                  <div className="blog-tag-chips">
                    {(bootstrap?.tags ?? []).map((tagItem) => (
                      <button
                        key={tagItem.name}
                        type="button"
                        className={
                          activeTag === tagItem.name ? 'blog-tag-chip is-active' : 'blog-tag-chip'
                        }
                        onClick={() =>
                          setActiveTag((prev) => (prev === tagItem.name ? '' : tagItem.name))
                        }
                      >
                        <span>#{tagItem.name}</span>
                        <span>{tagItem.count}</span>
                      </button>
                    ))}
                    {activeTag &&
                      !(bootstrap?.tags ?? []).some((tagItem) => tagItem.name === activeTag) && (
                        <button
                          type="button"
                          className="blog-tag-chip is-active"
                          onClick={() => setActiveTag('')}
                        >
                          <span>#{activeTag}</span>
                          <AppIcon name="close" size={11} />
                        </button>
                      )}
                  </div>
                )}
              </section>
            )}

            {route.kind === 'feed' && (
              <>
                {feedLoading && posts.length === 0 ? (
                  <div className="blog-empty">
                    <div className="blog-empty-icon">
                      <AppIcon name="book" size={22} />
                    </div>
                    <p className="blog-empty-title">正在加载动态与文章…</p>
                  </div>
                ) : feedError && posts.length === 0 ? (
                  <div className="blog-empty" role="alert">
                    <div className="blog-empty-icon">
                      <AppIcon name="offline" size={22} />
                    </div>
                    <h3 className="blog-empty-title">加载失败</h3>
                    <p className="blog-empty-desc">{feedError}</p>
                    <button
                      type="button"
                      className="blog-btn blog-btn-subtle"
                      onClick={() => setFeedRefreshTick((t) => t + 1)}
                    >
                      重试
                    </button>
                  </div>
                ) : posts.length === 0 ? (
                  <div className="blog-empty">
                    <div className="blog-empty-icon">
                      <AppIcon name={hasActiveFilters ? 'search' : 'sparkles'} size={22} />
                    </div>
                    {hasActiveFilters ? (
                      <>
                        <h3 className="blog-empty-title">没有找到匹配的内容</h3>
                        <p className="blog-empty-desc">试试更换搜索词，或清除当前筛选条件。</p>
                        <button
                          type="button"
                          className="blog-btn blog-btn-subtle"
                          onClick={handleResetFilters}
                        >
                          清除筛选
                        </button>
                      </>
                    ) : (
                      <>
                        <h3 className="blog-empty-title">还没有发布任何内容</h3>
                        <p className="blog-empty-desc">
                          {isOwner
                            ? '在这里像发朋友圈一样记录日常片段、配图与灵感，或写下深度长文。'
                            : '博主还没有发布公开内容，稍后再来看看吧。'}
                        </p>
                        {isOwner && (
                          <div style={{ display: 'inline-flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                            <button
                              type="button"
                              className="blog-btn blog-btn-primary"
                              onClick={() => handleOpenCompose('moment')}
                            >
                              <AppIcon name="plus" size={15} />
                              <span>发第一条动态</span>
                            </button>
                            <button
                              type="button"
                              className="blog-btn blog-btn-ghost"
                              onClick={() => handleOpenCompose('article')}
                            >
                              <AppIcon name="edit" size={14} />
                              <span>写长文章</span>
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="blog-feed">
                      {posts.map((post, idx) => (
                        <BlogMomentCard
                          key={post.id}
                          post={post}
                          profile={profile}
                          isOwner={isOwner}
                          index={idx}
                          onOpenArticle={(shortId) =>
                            onNavigate(`/articles/${encodeURIComponent(shortId)}`)
                          }
                          onOpenMoment={(shortId) =>
                            onNavigate(`/moments/${encodeURIComponent(shortId)}`)
                          }
                          onFilterTag={handleFilterTag}
                          onOpenLightbox={handleOpenLightbox}
                          onPostUpdated={handleSummaryPostUpdated}
                          onEditPost={handleEditPost}
                          onDeletePost={(target) => void handleDeletePost(target)}
                          onTogglePin={(target) => void handleTogglePin(target)}
                        />
                      ))}
                    </div>

                    <div className="blog-load-more">
                      {hasMore ? (
                        <button
                          type="button"
                          className="blog-load-more-btn"
                          disabled={loadingMore}
                          onClick={() => void handleLoadMore()}
                        >
                          {loadingMore ? '加载中…' : '加载更多'}
                        </button>
                      ) : (
                        <span className="blog-load-more-end">— 已经到底了 —</span>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {route.kind === 'archives' && (
              <BlogArchivesView
                items={archiveItems}
                loading={archivesLoading}
                profile={profile}
                onBack={() => onNavigate('/')}
                onOpenArticle={(shortId) =>
                  onNavigate(`/articles/${encodeURIComponent(shortId)}`)
                }
                onOpenMoment={(shortId) =>
                  onNavigate(`/moments/${encodeURIComponent(shortId)}`)
                }
              />
            )}

            {(route.kind === 'about' ||
              route.kind === 'equipment' ||
              route.kind === 'labs' ||
              route.kind === 'friends') && (
              <Suspense
                fallback={
                  <div className="blog-empty">
                    <div className="spinner" aria-label="加载中" />
                  </div>
                }
              >
                <BlogPagesView
                  section={route.kind}
                  profile={profile}
                  isOwner={isOwner}
                  onBack={() => onNavigate('/')}
                  onOpenLightbox={handleOpenLightbox}
                />
              </Suspense>
            )}

            {isDetailRoute && (
              <>
                {detailLoading && (!detailPost || detailPost.shortId !== route.shortId) ? (
                  <>
                    <div className="blog-sticky-bar">
                      <button
                        type="button"
                        className="blog-sticky-back"
                        onClick={() => onNavigate('/')}
                      >
                        <AppIcon name="arrowLeft" size={16} />
                        <span>朋友圈</span>
                      </button>
                      <div className="blog-sticky-title">正在加载…</div>
                      <div className="blog-sticky-actions" />
                    </div>
                    <div className="blog-empty">
                      <div className="blog-empty-icon">
                        <AppIcon name="book" size={22} />
                      </div>
                      <p className="blog-empty-title">正在读取内容…</p>
                    </div>
                  </>
                ) : detailError && (!detailPost || detailPost.shortId !== route.shortId) ? (
                  <>
                    <div className="blog-sticky-bar">
                      <button
                        type="button"
                        className="blog-sticky-back"
                        onClick={() => onNavigate('/')}
                      >
                        <AppIcon name="arrowLeft" size={16} />
                        <span>朋友圈</span>
                      </button>
                      <div className="blog-sticky-title">无法打开内容</div>
                      <div className="blog-sticky-actions" />
                    </div>
                    <div className="blog-empty" role="alert">
                      <div className="blog-empty-icon">
                        <AppIcon name="offline" size={22} />
                      </div>
                      <h3 className="blog-empty-title">内容不存在或暂无访问权限</h3>
                      <p className="blog-empty-desc">{detailError}</p>
                      <div style={{ display: 'inline-flex', gap: '8px', marginTop: '4px' }}>
                        <button
                          type="button"
                          className="blog-btn blog-btn-subtle"
                          onClick={() => onNavigate('/')}
                        >
                          返回朋友圈
                        </button>
                        <button
                          type="button"
                          className="blog-btn blog-btn-ghost"
                          onClick={() => setDetailRefreshTick((t) => t + 1)}
                        >
                          重试
                        </button>
                      </div>
                    </div>
                  </>
                ) : detailPost && detailPost.shortId === route.shortId ? (
                  <BlogArticleView
                    post={detailPost}
                    profile={profile}
                    isOwner={isOwner}
                    darkMode={darkMode}
                    onToggleDarkMode={toggleDarkMode}
                    onBack={() => onNavigate('/')}
                    onOpenPost={(type, shortId) =>
                      onNavigate(
                        type === 'article'
                          ? `/articles/${encodeURIComponent(shortId)}`
                          : `/moments/${encodeURIComponent(shortId)}`
                      )
                    }
                    onFilterTag={handleFilterTag}
                    onEditPost={(post) => handleEditPost(post)}
                    onPostUpdated={handleDetailPostUpdated}
                    onOpenLightbox={handleOpenLightbox}
                    tocInRail={isDesktopRail}
                    onTocStateChange={handleTocStateChange}
                  />
                ) : null}
              </>
            )}
          </main>
          {isDesktopRail && (
            <BlogRightRail
              profile={profile}
              isOwner={isOwner}
              activeRoute={route.kind}
              hiddenWidgets={sidebarConfig.hiddenWidgets}
              refreshTick={railRefreshTick}
              initialSummary={bootstrap?.railSummary ?? null}
              summaryLoading={!bootstrapSettled}
              onNavigate={onNavigate}
              onOpenLightbox={handleOpenLightbox}
              onOpenCompose={handleOpenCompose}
            />
          )}
        </div>

        <footer className="blog-footer">
          <div>
            {profile.footerText?.trim()
              ? profile.footerText
              : `© ${new Date().getFullYear()} ${profile.nickname || profile.siteName || 'Do It Laaaaaater'}`}
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
            <a href="/api/blog/feed.xml" target="_blank" rel="noopener noreferrer">
              <AppIcon name="rss" size={12} style={{ marginRight: '4px', verticalAlign: '-1px' }} />
              RSS 订阅
            </a>
            {!isOwner && (
              <button
                type="button"
                onClick={onRequestLogin}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  color: 'inherit',
                  fontSize: 'inherit',
                  cursor: 'pointer'
                }}
              >
                博主登录
              </button>
            )}
          </div>
        </footer>

        <div
          className={
            isDetailRoute ? 'blog-floating-dock has-bottom-bar' : 'blog-floating-dock'
          }
          aria-label="博客快捷操作"
        >
          {isOwner && (
            <button
              type="button"
              className="blog-dock-btn is-primary"
              onClick={() => handleOpenCompose(route.kind === 'article' ? 'article' : 'moment')}
              title="写动态 / 写文章"
              aria-label="写动态或文章"
            >
              <AppIcon name="plus" size={20} />
            </button>
          )}

          <button
            type="button"
            className="blog-dock-btn"
            onClick={toggleDarkMode}
            title={darkMode ? '切换浅色模式' : '切换深色模式'}
            aria-label={darkMode ? '切换浅色模式' : '切换深色模式'}
          >
            <AppIcon name={darkMode ? 'sun' : 'moon'} size={18} />
          </button>

          {showBackToTop && (
            <button
              type="button"
              className="blog-dock-btn"
              onClick={() => window.scrollTo({ top: 0, behavior: getScrollBehavior() })}
              title="回到顶部"
              aria-label="回到顶部"
            >
              <AppIcon name="arrowUp" size={18} />
            </button>
          )}
        </div>

        {composerOpen && (
          <Suspense fallback={null}>
            <BlogComposerModal
              open={composerOpen}
              initialType={composerInitialType}
              editingPost={editingPost}
              importedDraft={importedDraft}
              existingCategories={existingCategories}
              onClose={handleCloseComposer}
              onSaved={handleComposerSaved}
            />
          </Suspense>
        )}

        {settingsOpen && (
          <Suspense fallback={null}>
            <BlogSettingsModal
              open={settingsOpen}
              profile={profile}
              onClose={() => setSettingsOpen(false)}
              onSaved={(nextProfile) => {
                setBootstrap((prev) => (prev ? { ...prev, profile: nextProfile } : prev))
                setRailRefreshTick((t) => t + 1)
                void refreshBootstrap()
                setSettingsOpen(false)
              }}
            />
          </Suspense>
        )}

        {lightbox && (
          <BlogLightbox
            images={lightbox.images}
            index={lightbox.index}
            onClose={() => setLightbox(null)}
          />
        )}
      </div>
    </>
  )
}
