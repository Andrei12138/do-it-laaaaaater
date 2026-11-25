import { ApiRequestError } from './api-error'
import { enrichFormDataWithThumbs } from './image-thumb'
import type {
  BlogArchiveItem,
  BlogBootstrap,
  BlogComment,
  BlogImportedItemDraft,
  BlogLikeEntry,
  BlogLinkCard,
  BlogMediaUpload,
  BlogPostDetail,
  BlogPostInput,
  BlogPostsResponse,
  BlogProfile,
  BlogSettingsInput
} from './blog-types'

export { ApiRequestError } from './api-error'

const BLOG_VISITOR_ID_KEY = 'do-it-laaaaaater.blog.visitor-id.v1'
const BLOG_VISITOR_PROFILE_KEY = 'do-it-laaaaaater.blog.visitor-profile.v1'
const CST_TIME_ZONE = 'Asia/Shanghai'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

let memoryVisitorId: string | null = null

export interface BlogVisitorProfile {
  authorName: string
  authorEmail: string
  authorWebsite: string
}

export interface FetchBlogPostsParams {
  type?: 'all' | 'moment' | 'article'
  q?: string
  tag?: string
  category?: string
  visibility?: string
  page?: number
  limit?: number
}

export interface CreateBlogCommentPayload {
  content: string
  authorName?: string
  authorEmail?: string
  authorWebsite?: string
  parentId?: string | null
  replyToId?: string | null
  replyToName?: string | null
}

export interface BlogArchiveDateGroup {
  key: string
  year: number
  dayLabel: string
  monthLabel: string
  specialLabel: '今天' | '昨天' | null
  items: BlogArchiveItem[]
}

function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage
    }
  } catch {
    // Ignore storage access failures in restricted environments.
  }
  return null
}

function generateVisitorId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const length = 24
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(length)
    globalThis.crypto.getRandomValues(bytes)
    let id = ''
    for (let i = 0; i < length; i += 1) {
      id += alphabet[bytes[i] % alphabet.length]
    }
    return `v_${id}`
  }
  let fallback = 'v_'
  for (let i = 0; i < length; i += 1) {
    fallback += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return fallback
}

export function getBlogVisitorId(): string {
  const storage = getStorage()
  if (storage) {
    try {
      const existing = storage.getItem(BLOG_VISITOR_ID_KEY)?.trim()
      if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) {
        memoryVisitorId = existing
        return existing
      }
    } catch {
      // Fall back to in-memory visitor ID.
    }
  }

  if (memoryVisitorId) return memoryVisitorId

  const created = generateVisitorId()
  memoryVisitorId = created
  if (storage) {
    try {
      storage.setItem(BLOG_VISITOR_ID_KEY, created)
    } catch {
      // Ignore quota / private browsing errors.
    }
  }
  return created
}

export function readVisitorProfile(): BlogVisitorProfile {
  const empty: BlogVisitorProfile = {
    authorName: '',
    authorEmail: '',
    authorWebsite: ''
  }
  const storage = getStorage()
  if (!storage) return empty
  try {
    const raw = storage.getItem(BLOG_VISITOR_PROFILE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<BlogVisitorProfile> | null
    if (!parsed || typeof parsed !== 'object') return empty
    return {
      authorName: typeof parsed.authorName === 'string' ? parsed.authorName.trim() : '',
      authorEmail: typeof parsed.authorEmail === 'string' ? parsed.authorEmail.trim() : '',
      authorWebsite: typeof parsed.authorWebsite === 'string' ? parsed.authorWebsite.trim() : ''
    }
  } catch {
    return empty
  }
}

export function saveVisitorProfile(profile: Partial<BlogVisitorProfile>): BlogVisitorProfile {
  const current = readVisitorProfile()
  const next: BlogVisitorProfile = {
    authorName: profile.authorName !== undefined ? profile.authorName.trim() : current.authorName,
    authorEmail: profile.authorEmail !== undefined ? profile.authorEmail.trim() : current.authorEmail,
    authorWebsite: profile.authorWebsite !== undefined ? profile.authorWebsite.trim() : current.authorWebsite
  }
  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(BLOG_VISITOR_PROFILE_KEY, JSON.stringify(next))
    } catch {
      // Ignore storage write errors.
    }
  }
  return next
}

export async function blogRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has('X-Blog-Visitor')) {
    headers.set('X-Blog-Visitor', getBlogVisitorId())
  }

  let body = options.body
  if (body instanceof FormData) {
    body = await enrichFormDataWithThumbs(body)
  } else if (body !== undefined && body !== null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(path, {
    ...options,
    body,
    headers,
    credentials: 'same-origin'
  })

  const contentType = response.headers.get('content-type') || ''
  let parsed: unknown = null
  if (contentType.includes('application/json')) {
    try {
      parsed = await response.json()
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    const errorPayload = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    const message =
      (typeof errorPayload?.error === 'string' && errorPayload.error) ||
      (typeof errorPayload?.message === 'string' && errorPayload.message) ||
      '操作失败，请稍后重试'
    throw new ApiRequestError(response.status, message, errorPayload?.details)
  }

  return parsed as T
}

function blogJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  return blogRequest<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

export function fetchBlogBootstrap(): Promise<BlogBootstrap> {
  return blogRequest<BlogBootstrap>('/api/blog/bootstrap')
}

export function fetchBlogPosts(params: FetchBlogPostsParams = {}): Promise<BlogPostsResponse> {
  const query = new URLSearchParams()
  if (params.type && params.type !== 'all') query.set('type', params.type)
  if (params.q && params.q.trim()) query.set('q', params.q.trim())
  if (params.tag && params.tag.trim()) query.set('tag', params.tag.trim())
  if (params.category && params.category.trim()) query.set('category', params.category.trim())
  if (params.visibility && params.visibility.trim()) query.set('visibility', params.visibility.trim())
  if (typeof params.page === 'number' && Number.isFinite(params.page) && params.page > 0) {
    query.set('page', String(Math.floor(params.page)))
  }
  if (typeof params.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
    query.set('limit', String(Math.floor(params.limit)))
  }
  const qs = query.toString()
  return blogRequest<BlogPostsResponse>(qs ? `/api/blog/posts?${qs}` : '/api/blog/posts')
}

export function fetchBlogPost(shortId: string): Promise<BlogPostDetail> {
  return blogRequest<BlogPostDetail>(`/api/blog/posts/${encodeURIComponent(shortId)}`)
}

export function unlockBlogPost(shortId: string, password: string): Promise<BlogPostDetail> {
  return blogJson<BlogPostDetail>(`/api/blog/posts/${encodeURIComponent(shortId)}/unlock`, 'POST', { password })
}

export function fetchBlogArchives(): Promise<{ items: BlogArchiveItem[] }> {
  return blogRequest<{ items: BlogArchiveItem[] }>('/api/blog/archives')
}

export function toggleBlogPostLike(
  shortId: string,
  authorName?: string
): Promise<{ liked: boolean; likeCount: number; likes: BlogLikeEntry[] }> {
  const resolvedName = authorName !== undefined ? authorName.trim() : readVisitorProfile().authorName
  return blogJson<{ liked: boolean; likeCount: number; likes: BlogLikeEntry[] }>(
    `/api/blog/posts/${encodeURIComponent(shortId)}/like`,
    'POST',
    resolvedName ? { authorName: resolvedName } : {}
  )
}

export function createBlogComment(shortId: string, payload: CreateBlogCommentPayload): Promise<BlogComment> {
  return blogJson<BlogComment>(`/api/blog/posts/${encodeURIComponent(shortId)}/comments`, 'POST', payload)
}

export function toggleBlogCommentLike(commentId: string): Promise<{ liked: boolean; likeCount: number }> {
  return blogJson<{ liked: boolean; likeCount: number }>(
    `/api/blog/comments/${encodeURIComponent(commentId)}/like`,
    'POST'
  )
}

export function deleteBlogComment(commentId: string): Promise<{ ok: true }> {
  return blogRequest<{ ok: true }>(`/api/blog/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' })
}

export function createBlogPost(input: BlogPostInput): Promise<BlogPostDetail> {
  return blogJson<BlogPostDetail>('/api/blog/posts', 'POST', input)
}

export function updateBlogPost(shortId: string, input: Partial<BlogPostInput>): Promise<BlogPostDetail> {
  return blogJson<BlogPostDetail>(`/api/blog/posts/${encodeURIComponent(shortId)}`, 'PATCH', input)
}

export function deleteBlogPost(shortId: string): Promise<{ ok: true }> {
  return blogRequest<{ ok: true }>(`/api/blog/posts/${encodeURIComponent(shortId)}`, { method: 'DELETE' })
}

export function updateBlogSettings(input: BlogSettingsInput): Promise<BlogProfile> {
  return blogJson<BlogProfile>('/api/blog/settings', 'PATCH', input)
}

export async function uploadBlogMedia(files: File[]): Promise<BlogMediaUpload[]> {
  const form = new FormData()
  for (const file of files) {
    form.append('images', file)
  }
  const res = await blogRequest<{ media: BlogMediaUpload[] }>('/api/blog/media', {
    method: 'POST',
    body: form
  })
  return res.media
}

export function fetchBlogUrlPreview(url: string): Promise<BlogLinkCard> {
  return blogJson<BlogLinkCard>('/api/blog/url-preview', 'POST', { url })
}

export function importLibraryItemToBlog(itemId: string): Promise<BlogImportedItemDraft> {
  return blogJson<BlogImportedItemDraft>(`/api/blog/import-item/${encodeURIComponent(itemId)}`, 'POST')
}

interface CstParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const cstPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

function getCstParts(timestamp: number): CstParts {
  const parts = cstPartsFormatter.formatToParts(new Date(timestamp))
  let year = 1970
  let month = 1
  let day = 1
  let hour = 0
  let minute = 0
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value)
    else if (part.type === 'month') month = Number(part.value)
    else if (part.type === 'day') day = Number(part.value)
    else if (part.type === 'hour') hour = Number(part.value) % 24
    else if (part.type === 'minute') minute = Number(part.value)
  }
  return { year, month, day, hour, minute }
}

function cstDayNumber(parts: Pick<CstParts, 'year' | 'month' | 'day'>): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS)
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const tsParts = getCstParts(timestamp)
  const diffMs = now - timestamp

  if (diffMs < 0) {
    if (Math.abs(diffMs) < MINUTE_MS) return '刚刚'
    return `${tsParts.year}年${tsParts.month}月${tsParts.day}日`
  }

  if (diffMs < MINUTE_MS) return '刚刚'
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}分钟前`
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}小时前`

  const nowParts = getCstParts(now)
  const dayDiff = cstDayNumber(nowParts) - cstDayNumber(tsParts)
  if (dayDiff === 1) return '昨天'
  if (dayDiff > 1 && dayDiff < 3) return `${dayDiff}天前`

  return `${tsParts.year}年${tsParts.month}月${tsParts.day}日`
}

export function formatArticleDateTime(timestamp: number): string {
  const parts = getCstParts(timestamp)
  const hh = String(parts.hour).padStart(2, '0')
  const mm = String(parts.minute).padStart(2, '0')
  return `${parts.year}年${parts.month}月${parts.day}日 ${hh}:${mm}`
}

export function groupArchivesByDate(items: BlogArchiveItem[], now = Date.now()): BlogArchiveDateGroup[] {
  if (!items.length) return []
  const todayDayNum = cstDayNumber(getCstParts(now))
  const groups: BlogArchiveDateGroup[] = []

  for (const item of items) {
    const parts = getCstParts(item.publishedAt)
    const dayDiff = todayDayNum - cstDayNumber(parts)

    let key: string
    let specialLabel: '今天' | '昨天' | null = null
    if (dayDiff === 0) {
      key = 'today'
      specialLabel = '今天'
    } else if (dayDiff === 1) {
      key = 'yesterday'
      specialLabel = '昨天'
    } else {
      key = `${parts.year}-${parts.month}-${parts.day}`
    }

    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.items.push(item)
      continue
    }

    groups.push({
      key,
      year: parts.year,
      dayLabel: String(parts.day).padStart(2, '0'),
      monthLabel: `${parts.month}月`,
      specialLabel,
      items: [item]
    })
  }

  return groups
}
