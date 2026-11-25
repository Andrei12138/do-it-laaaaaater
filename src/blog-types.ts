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

export interface BlogBootstrap {
  configured: boolean
  isOwner: boolean
  ownerEmail: string | null
  profile: BlogProfile
  categories: Array<{ name: string; count: number }>
  tags: Array<{ name: string; count: number }>
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
