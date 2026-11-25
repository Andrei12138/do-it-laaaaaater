export type BlogPostType = 'moment' | 'article'
export type BlogVisibility = 'public' | 'private' | 'password'
export type BlogMediaKind = 'image' | 'video' | 'audio' | 'lyric' | 'file'

export interface BlogImageItem {
  mediaId?: string
  url: string
  thumbUrl?: string
  width?: number | null
  height?: number | null
  alt?: string
  liveVideoMediaId?: string
  liveVideoUrl?: string
}

export interface BlogPostMusic {
  trackId?: string
  title: string
  artist: string
  coverUrl?: string | null
  audioUrl: string
  lrc?: string
}

export interface BlogPostVideo {
  source: 'upload' | 'bilibili' | 'youtube' | 'url'
  mediaId?: string
  url: string
  embedUrl?: string
  coverUrl?: string | null
  title?: string
  platform?: string
}

export interface BlogPostMetadata extends Record<string, unknown> {
  music?: BlogPostMusic | null
  video?: BlogPostVideo | null
}

export interface BlogLinkCard {
  url: string
  title: string
  description?: string
  image?: string
  siteName?: string
}

export interface BlogProfile {
  siteName: string
  nickname: string
  bio: string
  avatarMediaId: string | null
  avatarUrl: string | null
  coverMediaId: string | null
  coverUrl: string | null
  footerText: string
  allowComments: boolean
  extensions: Record<string, unknown>
  stats: {
    totalPosts: number
    momentCount: number
    articleCount: number
    commentCount: number
  }
}

export interface BlogRailSummary {
  aboutSubtitle: string
  aboutExcerpt: string
  recentAlbumPhotos: Array<{
    url: string
    thumbUrl: string
    alt: string
    postShortId: string
  }>
  equipment: BlogCatalogItem[]
  labs: BlogCatalogItem[]
  friends: BlogFriend[]
}

export interface BlogBootstrap {
  configured: boolean
  isOwner: boolean
  ownerEmail: string | null
  profile: BlogProfile
  categories: Array<{ name: string; count: number }>
  tags: Array<{ name: string; count: number }>
  initialPosts?: BlogPostsResponse
  tracks?: BlogMusicTrack[]
  railSummary?: BlogRailSummary
}

export interface StorageUsageSnapshot {
  libraryAssetsBytes: number
  blogMediaBytes: number
  memoAssetsBytes: number
  totalBytes: number
  quotaBytes: number
  orphanBlogMediaCount: number
  orphanBlogMediaBytes: number
  legacyMemoCount: number
}

export interface BlogMediaGcResult {
  deletedCount: number
  freedBytes: number
  legacyMemoDeletedCount: number
  legacyMemoFreedBytes: number
}

export interface BlogLikeEntry {
  id: string
  authorName: string
  isOwner: boolean
  createdAt: number
}

export interface BlogComment {
  id: string
  postId: string
  parentId: string | null
  replyToId: string | null
  replyToName: string | null
  authorName: string
  authorWebsite: string
  isOwner: boolean
  content: string
  likeCount: number
  likedByMe: boolean
  createdAt: number
}

export interface BlogPostSummary {
  id: string
  shortId: string
  type: BlogPostType
  title: string
  excerpt: string
  content: string
  coverMediaId: string | null
  coverUrl: string | null
  category: string
  tags: string[]
  images: BlogImageItem[]
  linkCard: BlogLinkCard | null
  locationName: string
  sourceLabel: string
  sourceItemId: string | null
  metadata: Record<string, unknown>
  visibility: BlogVisibility
  locked: boolean
  isPinned: boolean
  viewCount: number
  likeCount: number
  likedByMe: boolean
  likes: BlogLikeEntry[]
  commentCount: number
  comments: BlogComment[]
  createdAt: number
  updatedAt: number
  publishedAt: number
}

export interface BlogAdjacentPost {
  shortId: string
  type: BlogPostType
  title: string
  publishedAt: number
}

export interface BlogPostDetail extends BlogPostSummary {
  prev: BlogAdjacentPost | null
  next: BlogAdjacentPost | null
}

export interface BlogPostsResponse {
  posts: BlogPostSummary[]
  total: number
  hasMore: boolean
  page: number
  limit: number
}

export interface BlogArchiveItem {
  id: string
  shortId: string
  type: BlogPostType
  title: string
  excerpt: string
  contentPreview: string
  coverUrl: string | null
  images: BlogImageItem[]
  locationName: string
  visibility: BlogVisibility
  locked: boolean
  isPinned: boolean
  publishedAt: number
}

export interface BlogMediaUpload {
  id: string
  kind: BlogMediaKind
  originalName: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  url: string
  thumbUrl: string
}

export interface BlogPostInput {
  type: BlogPostType
  title?: string
  excerpt?: string
  content: string
  coverMediaId?: string | null
  coverUrl?: string | null
  category?: string
  tags?: string[]
  images?: BlogImageItem[]
  linkCard?: BlogLinkCard | null
  locationName?: string
  sourceLabel?: string
  sourceItemId?: string | null
  metadata?: Record<string, unknown>
  visibility?: BlogVisibility
  password?: string
  isPinned?: boolean
  publishedAt?: number
}

export interface BlogSettingsInput {
  siteName?: string
  nickname?: string
  bio?: string
  avatarMediaId?: string | null
  coverMediaId?: string | null
  footerText?: string
  allowComments?: boolean
  extensions?: Record<string, unknown>
}

export interface BlogImportedItemDraft {
  type: BlogPostType
  title: string
  content: string
  linkCard: BlogLinkCard | null
  images: BlogImageItem[]
  coverMediaId: string | null
  coverUrl: string | null
  category: string
  sourceLabel: string
  sourceItemId: string
}

export interface BlogMusicTrack {
  id: string
  title: string
  artist: string
  album: string
  audioMediaId: string
  audioUrl: string
  coverMediaId: string | null
  coverUrl: string | null
  lrcText: string
  durationSec: number | null
  sortOrder: number
  createdAt: number
}

export interface BlogMusicTrackInput {
  title: string
  artist?: string
  album?: string
  audioMediaId: string
  coverMediaId?: string | null
  lrcText?: string
  durationSec?: number | null
  sortOrder?: number
}

export interface BlogPageData {
  slug: string
  title: string
  subtitle: string
  content: string
  coverMediaId: string | null
  coverUrl: string | null
  allowComments: boolean
  updatedAt: number
  comments: BlogComment[]
}

export interface BlogPageInput {
  title: string
  subtitle?: string
  content: string
  coverMediaId?: string | null
  allowComments?: boolean
}

export type BlogCatalogSection = 'equipment' | 'labs'

export interface BlogCatalogItem {
  id: string
  section: BlogCatalogSection
  category: string
  title: string
  subtitle: string
  description: string
  imageMediaId: string | null
  imageUrl: string | null
  linkUrl: string
  tag: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface BlogCatalogItemInput {
  section: BlogCatalogSection
  category?: string
  title: string
  subtitle?: string
  description?: string
  imageMediaId?: string | null
  imageUrl?: string | null
  linkUrl?: string
  tag?: string
  sortOrder?: number
}

export interface BlogFriend {
  id: string
  name: string
  url: string
  avatarMediaId: string | null
  avatarUrl: string
  description: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface BlogFriendInput {
  name: string
  url: string
  avatarMediaId?: string | null
  avatarUrl?: string
  description?: string
  sortOrder?: number
}
