import type {
  BlogAdjacentPost,
  BlogArchiveItem,
  BlogBootstrap,
  BlogCatalogItem,
  BlogComment,
  BlogFriend,
  BlogImageItem,
  BlogImportedItemDraft,
  BlogLikeEntry,
  BlogLinkCard,
  BlogMediaUpload,
  BlogMusicTrack,
  BlogPostDetail,
  BlogPostSummary,
  BlogPostType,
  BlogPostsResponse,
  BlogProfile,
  BlogVisibility
} from '../src/blog-types'
import {
  handleBlogPhase2Api,
  inferAudioMimeAndExt,
  inferVideoMimeAndExt,
  isValidPageSlug,
  MAX_AUDIO_BYTES,
  MAX_LYRIC_BYTES,
  MAX_VIDEO_BYTES,
  parseByteRange,
  serializeCatalogItem,
  serializeFriend,
  serializeMusicTrack,
  validateCatalogSection,
  validateMediaKind,
  validatePageSlug,
  type ByteRange,
  type ResolvedMediaSpec
} from './blog-phase2'
import { detectImageMime, fetchPageMetadata } from './metadata'
import { hashPassword, hashToken, parseCookie, verifyPassword } from './security'
import { ALLOWED_IMAGE_TYPES, ApiError, MAX_IMAGE_BYTES, SESSION_COOKIE, type Env } from './types'

export {
  inferAudioMimeAndExt,
  inferVideoMimeAndExt,
  isValidPageSlug,
  MAX_AUDIO_BYTES,
  MAX_LYRIC_BYTES,
  MAX_VIDEO_BYTES,
  parseByteRange,
  validateCatalogSection,
  validateMediaKind,
  validatePageSlug,
  type ByteRange,
  type ResolvedMediaSpec
}

type Row = Record<string, unknown>

interface AuthContext {
  currentUser: { id: string; email: string } | null
  owner: { id: string; email: string } | null
  isOwner: boolean
}

const SHORT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const VISITOR_HEADER_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/
const UNLOCK_COOKIE_MAX_AGE = 7 * 24 * 60 * 60
const UNLOCK_RATE_LIMIT = 10
const UNLOCK_RATE_WINDOW_MS = 15 * 60 * 1000
const COMMENT_RATE_LIMIT = 15
const COMMENT_RATE_WINDOW_MS = 5 * 60 * 1000
const LIKE_RATE_LIMIT = 30
const LIKE_RATE_WINDOW_MS = 5 * 60 * 1000
const DEFAULT_GC_MIN_AGE_MS = 24 * 60 * 60 * 1000
const MAX_MEDIA_UPLOAD_BATCH = 20
const MAX_IMPORT_IMAGES = 9

export const MEDIA_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': 'sandbox'
}

const DEFAULT_SETTINGS = {
  siteName: '朋友圈博客',
  nickname: '博主',
  bio: '记录日常灵感、阅读摘录与长文思考',
  footerText: '',
  allowComments: true
} as const

const unlockAttempts = new Map<string, { count: number; resetAt: number }>()
const commentAttempts = new Map<string, { count: number; resetAt: number }>()
const likeAttempts = new Map<string, { count: number; resetAt: number }>()

function isNullBodyStatus(status: number): boolean {
  return status === 101 || status === 204 || status === 205 || status === 304
}

export function applyGlobalSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  if (!headers.has('x-content-type-options')) {
    headers.set('x-content-type-options', 'nosniff')
  }
  if (!headers.has('x-frame-options')) {
    headers.set('x-frame-options', 'DENY')
  }
  if (!headers.has('referrer-policy')) {
    headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  }
  return new Response(isNullBodyStatus(response.status) ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      ...headers
    }
  })
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function cleanOriginalName(value: string): string {
  const name = value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim()
  return (name || 'image').slice(0, 180)
}

export function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/gif') return 'gif'
  return 'webp'
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(400, '提交的内容格式无效')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, '提交的内容格式无效')
  }
}

function chunkIds<T>(items: T[], size = 80): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

async function deleteR2Keys(env: Env, keys: string[]) {
  const unique = [...new Set(keys.filter(Boolean))]
  if (!unique.length) return
  for (let i = 0; i < unique.length; i += 500) {
    await env.IMAGES.delete(unique.slice(i, i + 500))
  }
}

function pruneExpiredRateLimits(store: Map<string, { count: number; resetAt: number }>, now: number) {
  if (store.size < 500) return
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) store.delete(key)
  }
}

function checkRateLimit(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  limit: number,
  message: string
) {
  const now = Date.now()
  const entry = store.get(key)
  if (entry && entry.resetAt > now && entry.count >= limit) {
    throw new ApiError(429, message)
  }
  if (entry && entry.resetAt <= now) store.delete(key)
}

function recordRateLimitHit(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  windowMs: number
) {
  const now = Date.now()
  pruneExpiredRateLimits(store, now)
  const current = store.get(key)
  store.set(key, {
    count: current && current.resetAt > now ? current.count + 1 : 1,
    resetAt: current && current.resetAt > now ? current.resetAt : now + windowMs
  })
}

// --- Pure exported helpers ---

export function generateShortId(length = 8): string {
  const safeLength = Math.max(4, Math.min(32, Math.floor(length)))
  const bytes = crypto.getRandomValues(new Uint8Array(safeLength))
  let out = ''
  for (let i = 0; i < safeLength; i += 1) {
    out += SHORT_ID_ALPHABET[bytes[i] % SHORT_ID_ALPHABET.length]
  }
  return out
}

export function blogMediaUrl(mediaId: string, variant: 'original' | 'thumb' = 'original'): string {
  const base = `/api/blog/media/${encodeURIComponent(mediaId)}`
  return variant === 'thumb' ? `${base}?variant=thumb` : base
}

export function unlockCookieName(shortId: string): string {
  return `blog_unlock_${shortId}`
}

export async function expectedUnlockToken(postId: string, passwordHash: string): Promise<string> {
  return hashToken(`${postId}:${passwordHash}`)
}

export function buildUnlockCookie(shortId: string, token: string, requestUrl: URL): string {
  const secure = requestUrl.protocol === 'https:' ? '; Secure' : ''
  return `${unlockCookieName(shortId)}=${encodeURIComponent(token)}; Path=/api/blog/; HttpOnly; SameSite=Lax; Max-Age=${UNLOCK_COOKIE_MAX_AGE}${secure}`
}

export function sanitizeVisitorHeader(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return VISITOR_HEADER_PATTERN.test(trimmed) ? trimmed : null
}

export async function resolveVisitorKey(
  request: Request,
  isOwner: boolean,
  ownerId: string | null
): Promise<string> {
  if (isOwner && ownerId) {
    return `owner:${ownerId}`
  }
  const ip = (request.headers.get('cf-connecting-ip') || 'local').trim() || 'local'
  const headerVisitor = sanitizeVisitorHeader(request.headers.get('x-blog-visitor'))
  const seed = headerVisitor
    ? `${headerVisitor}:${ip}`
    : `ipua:${ip}:${request.headers.get('user-agent') || ''}`
  const hashed = await hashToken(seed)
  return `visitor:${hashed}`
}

export function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function sanitizeOgText(input: unknown, maxLength = 200): string {
  const cleaned = String(input || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function toAbsoluteMetaUrl(rawUrl: unknown, origin: string): string | null {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return null
  try {
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
      return new URL(trimmed, origin).toString()
    }
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

export type BlogHtmlRouteMatch =
  | { kind: 'home' }
  | { kind: 'archives' }
  | { kind: 'about' }
  | { kind: 'equipment' }
  | { kind: 'labs' }
  | { kind: 'friends' }
  | { kind: 'article'; shortId: string }
  | { kind: 'moment'; shortId: string }
  | { kind: 'blog_other' }

export function matchBlogHtmlRoute(pathname: string): BlogHtmlRouteMatch | null {
  const clean = pathname === '/' ? '/' : pathname.replace(/\/+$/, '') || '/'
  if (clean === '/' || clean === '/blog') return { kind: 'home' }
  const normalized = clean.startsWith('/blog/') ? clean.slice('/blog'.length) : clean
  if (normalized === '/archives') return { kind: 'archives' }
  if (normalized === '/about') return { kind: 'about' }
  if (normalized === '/equipment') return { kind: 'equipment' }
  if (normalized === '/labs') return { kind: 'labs' }
  if (normalized === '/friends') return { kind: 'friends' }

  const articleMatch = normalized.match(/^\/articles\/([^/]+)$/)
  if (articleMatch) {
    try {
      return { kind: 'article', shortId: decodeURIComponent(articleMatch[1]) }
    } catch {
      return { kind: 'article', shortId: articleMatch[1] }
    }
  }

  const momentMatch = normalized.match(/^\/moments\/([^/]+)$/)
  if (momentMatch) {
    try {
      return { kind: 'moment', shortId: decodeURIComponent(momentMatch[1]) }
    } catch {
      return { kind: 'moment', shortId: momentMatch[1] }
    }
  }

  if (clean.startsWith('/blog/')) return { kind: 'blog_other' }
  return null
}

export interface BlogOgMeta {
  siteName: string
  title: string
  description: string
  image: string | null
  url: string
  type: 'website' | 'article'
  rssTitle: string
  rssHref: string
}

export function buildBlogOgMeta(options: {
  origin: string
  pathname: string
  route: BlogHtmlRouteMatch
  siteName?: string | null
  siteBio?: string | null
  siteImage?: string | null
  aboutPage?: { title?: string | null; subtitle?: string | null; content?: string | null; coverUrl?: string | null } | null
  post?: {
    type: BlogPostType
    title?: string | null
    excerpt?: string | null
    content?: string | null
    imageUrl?: string | null
    visibility: BlogVisibility
  } | null
}): BlogOgMeta {
  const origin = options.origin.replace(/\/+$/, '')
  const siteName = sanitizeOgText(options.siteName, 60) || DEFAULT_SETTINGS.siteName
  const siteBio = sanitizeOgText(options.siteBio, 200) || DEFAULT_SETTINGS.bio
  const siteImage = toAbsoluteMetaUrl(options.siteImage, origin)
  const canonicalUrl = `${origin}${options.pathname.startsWith('/') ? options.pathname : `/${options.pathname}`}`

  const genericSiteMeta = (): BlogOgMeta => ({
    siteName,
    title: siteName,
    description: siteBio,
    image: siteImage,
    url: canonicalUrl,
    type: 'website',
    rssTitle: `${siteName} RSS`,
    rssHref: '/api/blog/feed.xml'
  })

  switch (options.route.kind) {
    case 'home':
    case 'blog_other':
      return genericSiteMeta()
    case 'archives':
      return { ...genericSiteMeta(), title: sanitizeOgText(`归档 · ${siteName}`, 120) }
    case 'equipment':
      return { ...genericSiteMeta(), title: sanitizeOgText(`我的装备 · ${siteName}`, 120) }
    case 'labs':
      return { ...genericSiteMeta(), title: sanitizeOgText(`实验室 · ${siteName}`, 120) }
    case 'friends':
      return { ...genericSiteMeta(), title: sanitizeOgText(`友人帐 · ${siteName}`, 120) }
    case 'about': {
      const pageTitle = sanitizeOgText(options.aboutPage?.title, 60) || '关于我'
      const pageDesc =
        sanitizeOgText(
          buildExcerpt(String(options.aboutPage?.content || ''), options.aboutPage?.subtitle, 160),
          200
        ) || siteBio
      const pageImg = toAbsoluteMetaUrl(options.aboutPage?.coverUrl, origin) || siteImage
      return {
        ...genericSiteMeta(),
        title: sanitizeOgText(`${pageTitle} · ${siteName}`, 120),
        description: pageDesc,
        image: pageImg
      }
    }
    case 'article':
    case 'moment': {
      const post = options.post
      // Strict privacy guarantee: private or password-protected (or missing) posts emit ONLY generic site meta
      if (!post || post.visibility !== 'public') {
        return genericSiteMeta()
      }
      const fallbackHeading =
        buildExcerpt(String(post.content || ''), post.excerpt, 48) ||
        (post.type === 'article' ? '无题文章' : '动态')
      const postTitle = sanitizeOgText(post.title, 80) || sanitizeOgText(fallbackHeading, 80)
      const postDesc =
        sanitizeOgText(buildExcerpt(String(post.content || ''), post.excerpt, 160), 200) || siteBio
      const postImage = toAbsoluteMetaUrl(post.imageUrl, origin) || siteImage
      return {
        siteName,
        title: sanitizeOgText(`${postTitle} · ${siteName}`, 120),
        description: postDesc,
        image: postImage,
        url: canonicalUrl,
        type: 'article',
        rssTitle: `${siteName} RSS`,
        rssHref: '/api/blog/feed.xml'
      }
    }
  }
}

export function renderBlogOgHeadHtml(meta: BlogOgMeta): string {
  const twitterCard = meta.image ? 'summary_large_image' : 'summary'
  const lines = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`,
    `<meta property="og:type" content="${escapeHtml(meta.type)}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}" />` : '',
    `<meta name="twitter:card" content="${twitterCard}" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    meta.image ? `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />` : '',
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(meta.rssTitle)}" href="${escapeHtml(meta.rssHref)}" />`
  ]
  return lines.filter(Boolean).join('\n    ')
}

export function extractMediaIdFromBlogUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  const match = /\/api\/blog\/media\/([^/?#\s"')<>\\]+)/.exec(trimmed)
  if (!match || !match[1]) return null
  let id: string
  try {
    id = decodeURIComponent(match[1]).trim()
  } catch {
    id = match[1].trim()
  }
  if (!id || id === 'gc') return null
  return id
}

export function extractBlogMediaIdsFromText(text: unknown): string[] {
  if (typeof text !== 'string' || !text.includes('/api/blog/media/')) return []
  const ids = new Set<string>()
  const regex = /\/api\/blog\/media\/([^/?#\s"')<>\\]+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (!match[1]) continue
    let id: string
    try {
      id = decodeURIComponent(match[1]).trim()
    } catch {
      id = match[1].trim()
    }
    if (id && id !== 'gc') {
      ids.add(id)
    }
  }
  return [...ids]
}

export function escapeXml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function sanitizeWebsiteUrl(input: unknown): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    if (!parsed.hostname) return ''
    return parsed.toString().slice(0, 500)
  } catch {
    return ''
  }
}

export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of input) {
    const cleaned = String(item || '')
      .trim()
      .replace(/^#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 32)
    if (!cleaned) continue
    const dedupeKey = cleaned.toLocaleLowerCase('zh-CN')
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    result.push(cleaned)
    if (result.length >= 20) break
  }
  return result
}

export function stripMarkdownForPreview(markdown: string): string {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildExcerpt(content: string, explicitExcerpt?: unknown, maxLength = 160): string {
  const explicit = String(explicitExcerpt || '').replace(/\s+/g, ' ').trim()
  const source = explicit || stripMarkdownForPreview(content)
  if (!source) return ''
  if (source.length <= maxLength) return source
  return `${source.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function buildRssFeed(options: {
  origin: string
  profile: Pick<BlogProfile, 'siteName' | 'nickname' | 'bio'>
  posts: Array<{
    shortId: string
    type: BlogPostType
    title: string
    excerpt: string
    content: string
    category: string
    tags: string[]
    publishedAt: number
  }>
}): string {
  const origin = options.origin.replace(/\/+$/, '')
  const blogLink = `${origin}/`
  const feedLink = `${origin}/api/blog/feed.xml`
  const latestPub = options.posts[0]?.publishedAt || Date.now()

  const itemsXml = options.posts
    .map((post) => {
      const segment = post.type === 'article' ? 'articles' : 'moments'
      const itemLink = `${origin}/${segment}/${encodeURIComponent(post.shortId)}`
      const title =
        post.title.trim() ||
        buildExcerpt(post.content, post.excerpt, 48) ||
        (post.type === 'article' ? '无题文章' : '动态')
      const description = buildExcerpt(post.content, post.excerpt, 320) || title
      const categories = [post.category, ...post.tags]
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index)
        .map((value) => `      <category>${escapeXml(value)}</category>`)
        .join('\n')

      return [
        '    <item>',
        `      <title>${escapeXml(title)}</title>`,
        `      <link>${escapeXml(itemLink)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(itemLink)}</guid>`,
        `      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(description)}</description>`,
        categories,
        '    </item>'
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(options.profile.siteName || DEFAULT_SETTINGS.siteName)}</title>`,
    `    <link>${escapeXml(blogLink)}</link>`,
    `    <description>${escapeXml(options.profile.bio || DEFAULT_SETTINGS.bio)}</description>`,
    '    <language>zh-CN</language>',
    `    <atom:link href="${escapeXml(feedLink)}" rel="self" type="application/rss+xml" />`,
    `    <lastBuildDate>${new Date(latestPub).toUTCString()}</lastBuildDate>`,
    itemsXml,
    '  </channel>',
    '</rss>'
  ]
    .filter(Boolean)
    .join('\n')
}

// --- JSON & payload sanitization helpers ---

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function parsePlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function parseTagsColumn(raw: unknown): string[] {
  const parsed = safeParseJson<unknown>(raw, [])
  return normalizeTags(parsed)
}

export function sanitizeImageItems(input: unknown): BlogImageItem[] {
  if (!Array.isArray(input)) return []
  const items: BlogImageItem[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const obj = raw as Record<string, unknown>
    const mediaId = typeof obj.mediaId === 'string' && obj.mediaId.trim() ? obj.mediaId.trim().slice(0, 128) : undefined
    let url = typeof obj.url === 'string' ? obj.url.trim().slice(0, 1000) : ''
    if (!url && mediaId) url = blogMediaUrl(mediaId)
    if (!url) continue
    if (!url.startsWith('/') && !/^https?:\/\//i.test(url)) continue
    let thumbUrl = typeof obj.thumbUrl === 'string' ? obj.thumbUrl.trim().slice(0, 1000) : undefined
    if (!thumbUrl && mediaId) thumbUrl = blogMediaUrl(mediaId, 'thumb')
    if (thumbUrl && !thumbUrl.startsWith('/') && !/^https?:\/\//i.test(thumbUrl)) thumbUrl = undefined
    const alt = typeof obj.alt === 'string' ? obj.alt.trim().slice(0, 200) : undefined
    const liveVideoMediaId =
      typeof obj.liveVideoMediaId === 'string' && obj.liveVideoMediaId.trim()
        ? obj.liveVideoMediaId.trim().slice(0, 128)
        : undefined
    let liveVideoUrl =
      typeof obj.liveVideoUrl === 'string' ? obj.liveVideoUrl.trim().slice(0, 1000) : undefined
    if (!liveVideoUrl && liveVideoMediaId) {
      liveVideoUrl = blogMediaUrl(liveVideoMediaId)
    }
    if (liveVideoUrl && !liveVideoUrl.startsWith('/') && !/^https?:\/\//i.test(liveVideoUrl)) {
      liveVideoUrl = undefined
    }
    items.push({
      ...(mediaId ? { mediaId } : {}),
      url,
      ...(thumbUrl ? { thumbUrl } : {}),
      width: numberOrNull(obj.width),
      height: numberOrNull(obj.height),
      ...(alt ? { alt } : {}),
      ...(liveVideoMediaId ? { liveVideoMediaId } : {}),
      ...(liveVideoUrl ? { liveVideoUrl } : {})
    })
    if (items.length >= 30) break
  }
  return items
}

export const sanitizeImages = sanitizeImageItems

function sanitizeLinkCard(input: unknown): BlogLinkCard | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  const url = sanitizeWebsiteUrl(obj.url)
  if (!url) return null
  const title = String(obj.title || url).replace(/\s+/g, ' ').trim().slice(0, 300) || url
  const description = String(obj.description || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  const rawImage = String(obj.image || '').trim().slice(0, 1000)
  const image =
    rawImage && (rawImage.startsWith('/') || /^https?:\/\//i.test(rawImage)) ? rawImage : ''
  const siteName = String(obj.siteName || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return {
    url,
    title,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(siteName ? { siteName } : {})
  }
}

function parseImageMeta(raw: FormDataEntryValue | null): Array<{ width?: number | null; height?: number | null }> {
  if (!raw || typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function validatePostType(value: unknown): BlogPostType {
  if (value === 'moment' || value === 'article') return value
  throw new ApiError(400, '内容类型必须是 moment 或 article')
}

function validateVisibility(value: unknown): BlogVisibility {
  if (value === 'public' || value === 'private' || value === 'password') return value
  throw new ApiError(400, '可见性设置无效')
}

function resolveCoverUrl(row: Row): string | null {
  const explicit = row.cover_url ? String(row.cover_url).trim() : ''
  if (explicit) return explicit
  const mediaId = row.cover_media_id ? String(row.cover_media_id).trim() : ''
  return mediaId ? blogMediaUrl(mediaId) : null
}

// --- Auth & Owner helpers ---

async function resolveCurrentUser(env: Env, request: Request): Promise<{ id: string; email: string } | null> {
  const token = parseCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (!token) return null
  const idHash = await hashToken(token)
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?'
  ).bind(idHash).first<Row>()
  if (!row) return null
  if (Number(row.expires_at) <= Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(idHash).run()
    return null
  }
  return { id: String(row.id), email: String(row.email) }
}

async function resolveAuth(env: Env, request: Request): Promise<AuthContext> {
  const [user, ownerRow] = await Promise.all([
    resolveCurrentUser(env, request),
    env.DB.prepare('SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1').first<Row>()
  ])
  const owner = ownerRow ? { id: String(ownerRow.id), email: String(ownerRow.email) } : null
  const isOwner = Boolean(user && owner && user.id === owner.id)
  return { currentUser: user, owner, isOwner }
}

function requireOwner(auth: AuthContext): { id: string; email: string } {
  if (!auth.isOwner || !auth.owner) {
    throw new ApiError(401, '请先登录')
  }
  return auth.owner
}

async function isPostUnlocked(request: Request, post: Row, isOwner: boolean): Promise<boolean> {
  if (isOwner) return true
  if (String(post.visibility) !== 'password') return true
  const hash = post.password_hash ? String(post.password_hash) : ''
  if (!hash) return false
  const cookieVal = parseCookie(request.headers.get('cookie'), unlockCookieName(String(post.short_id)))
  if (!cookieVal) return false
  const expected = await expectedUnlockToken(String(post.id), hash)
  return constantTimeStringEqual(cookieVal, expected)
}

// --- Profile & Settings ---

export const DEFAULT_ABOUT_SUBTITLE = '数字花园与个人简介'

export function resolveAboutSubtitle(aboutRow: Row | null | undefined): string {
  const raw =
    aboutRow && aboutRow.subtitle !== null && aboutRow.subtitle !== undefined
      ? String(aboutRow.subtitle).trim()
      : ''
  return raw || DEFAULT_ABOUT_SUBTITLE
}

function buildDefaultProfile(): BlogProfile {
  return {
    siteName: DEFAULT_SETTINGS.siteName,
    nickname: DEFAULT_SETTINGS.nickname,
    bio: DEFAULT_SETTINGS.bio,
    aboutSubtitle: DEFAULT_ABOUT_SUBTITLE,
    avatarMediaId: null,
    avatarUrl: null,
    coverMediaId: null,
    coverUrl: null,
    footerText: DEFAULT_SETTINGS.footerText,
    allowComments: DEFAULT_SETTINGS.allowComments,
    extensions: {},
    stats: {
      totalPosts: 0,
      momentCount: 0,
      articleCount: 0,
      commentCount: 0
    }
  }
}

async function loadOwnerSettingsRow(env: Env, ownerId: string): Promise<Row | null> {
  return env.DB.prepare('SELECT * FROM blog_settings WHERE user_id = ?').bind(ownerId).first<Row>()
}

function mapSettingsToProfile(
  row: Row | null,
  stats: BlogProfile['stats'] = { totalPosts: 0, momentCount: 0, articleCount: 0, commentCount: 0 },
  aboutSubtitle: string = DEFAULT_ABOUT_SUBTITLE
): BlogProfile {
  if (!row) {
    return { ...buildDefaultProfile(), aboutSubtitle, stats }
  }
  const avatarMediaId = row.avatar_media_id ? String(row.avatar_media_id) : null
  const coverMediaId = row.cover_media_id ? String(row.cover_media_id) : null
  const extensions = parsePlainObject(safeParseJson<unknown>(row.extensions_json, {}))
  return {
    siteName: String(row.site_name || DEFAULT_SETTINGS.siteName),
    nickname: String(row.nickname || DEFAULT_SETTINGS.nickname),
    bio: row.bio !== null && row.bio !== undefined ? String(row.bio) : DEFAULT_SETTINGS.bio,
    aboutSubtitle,
    avatarMediaId,
    avatarUrl: avatarMediaId ? blogMediaUrl(avatarMediaId) : null,
    coverMediaId,
    coverUrl: coverMediaId ? blogMediaUrl(coverMediaId) : null,
    footerText: String(row.footer_text || ''),
    allowComments: row.allow_comments === undefined ? true : Boolean(Number(row.allow_comments)),
    extensions,
    stats
  }
}

export async function loadBlogProfile(
  env: Env,
  ownerId: string,
  stats: BlogProfile['stats'] = { totalPosts: 0, momentCount: 0, articleCount: 0, commentCount: 0 }
): Promise<BlogProfile> {
  const [settingsRow, aboutRow] = await Promise.all([
    loadOwnerSettingsRow(env, ownerId),
    env.DB.prepare('SELECT subtitle FROM blog_pages WHERE user_id = ? AND slug = ?')
      .bind(ownerId, 'about')
      .first<Row>()
  ])
  return mapSettingsToProfile(settingsRow, stats, resolveAboutSubtitle(aboutRow))
}

async function loadBlogBootstrap(env: Env, owner: { id: string; email: string }, isOwner: boolean): Promise<BlogBootstrap> {
  const visibilityClause = isOwner ? '' : "AND visibility <> 'private'"
  const commentVisibilityClause = isOwner ? '' : "AND p.visibility <> 'private'"

  const [baseProfile, postsRes, commentCountRow] = await Promise.all([
    loadBlogProfile(env, owner.id),
    env.DB.prepare(
      `SELECT type, category, tags_json FROM blog_posts WHERE user_id = ? ${visibilityClause}`
    ).bind(owner.id).all<Row>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM blog_comments c JOIN blog_posts p ON p.id = c.post_id WHERE p.user_id = ? ${commentVisibilityClause}`
    ).bind(owner.id).first<Row>()
  ])

  let momentCount = 0
  let articleCount = 0
  const categoryCounts = new Map<string, number>()
  const tagCounts = new Map<string, number>()

  for (const post of postsRes.results) {
    if (String(post.type) === 'article') articleCount += 1
    else momentCount += 1

    const category = String(post.category || '').trim()
    if (category) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1)
    }
    for (const tag of parseTagsColumn(post.tags_json)) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
    }
  }

  const stats: BlogProfile['stats'] = {
    totalPosts: postsRes.results.length,
    momentCount,
    articleCount,
    commentCount: Number(commentCountRow?.count || 0)
  }

  const categories = [...categoryCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))

  const tags = [...tagCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))

  return {
    configured: true,
    isOwner,
    ownerEmail: isOwner ? owner.email : null,
    profile: { ...baseProfile, stats },
    categories,
    tags
  }
}

// --- Post Hydration (Likes, Comments, Adjacent) ---

interface PostInteractions {
  likesByPost: Map<string, BlogLikeEntry[]>
  likedPostIds: Set<string>
  commentsByPost: Map<string, BlogComment[]>
}

async function loadPostInteractions(env: Env, postIds: string[], visitorKey: string): Promise<PostInteractions> {
  const likesByPost = new Map<string, BlogLikeEntry[]>()
  const likedPostIds = new Set<string>()
  const commentsByPost = new Map<string, BlogComment[]>()

  if (!postIds.length) {
    return { likesByPost, likedPostIds, commentsByPost }
  }

  const commentRows: Row[] = []
  for (const batch of chunkIds(postIds)) {
    const placeholders = batch.map(() => '?').join(',')
    const [likesRes, commentsRes] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, post_id, visitor_key, author_name, is_owner, created_at FROM blog_likes WHERE post_id IN (${placeholders}) ORDER BY created_at ASC`
      ).bind(...batch),
      env.DB.prepare(
        `SELECT id, post_id, parent_id, reply_to_id, reply_to_name, author_name, author_website, is_owner, content, like_count, created_at FROM blog_comments WHERE post_id IN (${placeholders}) ORDER BY created_at ASC`
      ).bind(...batch)
    ])

    for (const like of likesRes.results as Row[]) {
      const postId = String(like.post_id)
      const entry: BlogLikeEntry = {
        id: String(like.id),
        authorName: String(like.author_name),
        isOwner: Boolean(Number(like.is_owner || 0)),
        createdAt: Number(like.created_at)
      }
      const list = likesByPost.get(postId)
      if (list) list.push(entry)
      else likesByPost.set(postId, [entry])

      if (String(like.visitor_key) === visitorKey) {
        likedPostIds.add(postId)
      }
    }

    commentRows.push(...(commentsRes.results as Row[]))
  }

  const likedCommentIds = new Set<string>()
  if (commentRows.length) {
    const commentIds = commentRows.map((c) => String(c.id))
    for (const batch of chunkIds(commentIds)) {
      const placeholders = batch.map(() => '?').join(',')
      const res = await env.DB.prepare(
        `SELECT comment_id FROM blog_comment_likes WHERE visitor_key = ? AND comment_id IN (${placeholders})`
      ).bind(visitorKey, ...batch).all<Row>()
      for (const row of res.results) {
        likedCommentIds.add(String(row.comment_id))
      }
    }
  }

  for (const comment of commentRows) {
    const postId = String(comment.post_id)
    const commentId = String(comment.id)
    const entry: BlogComment = {
      id: commentId,
      postId,
      parentId: comment.parent_id ? String(comment.parent_id) : null,
      replyToId: comment.reply_to_id ? String(comment.reply_to_id) : null,
      replyToName: comment.reply_to_name ? String(comment.reply_to_name) : null,
      authorName: String(comment.author_name),
      authorWebsite: String(comment.author_website || ''),
      isOwner: Boolean(Number(comment.is_owner || 0)),
      content: String(comment.content),
      likeCount: Number(comment.like_count || 0),
      likedByMe: likedCommentIds.has(commentId),
      createdAt: Number(comment.created_at)
    }
    const list = commentsByPost.get(postId)
    if (list) list.push(entry)
    else commentsByPost.set(postId, [entry])
  }

  return { likesByPost, likedPostIds, commentsByPost }
}

function serializePostSummary(
  row: Row,
  interactions: PostInteractions,
  locked: boolean,
  viewCountOverride?: number
): BlogPostSummary {
  const id = String(row.id)
  const shortId = String(row.short_id)
  const type = String(row.type) as BlogPostType
  const visibility = String(row.visibility) as BlogVisibility
  const likes = interactions.likesByPost.get(id) || []
  const comments = interactions.commentsByPost.get(id) || []
  const tags = parseTagsColumn(row.tags_json)
  const rawTitle = String(row.title || '')

  if (locked) {
    return {
      id,
      shortId,
      type,
      title: rawTitle || '加密动态',
      excerpt: '该内容已加密，输入密码后查看',
      content: '',
      coverMediaId: null,
      coverUrl: null,
      category: String(row.category || ''),
      tags,
      images: [],
      linkCard: null,
      locationName: '',
      sourceLabel: '',
      sourceItemId: null,
      metadata: {},
      visibility,
      locked: true,
      isPinned: Boolean(Number(row.is_pinned || 0)),
      viewCount: viewCountOverride ?? Number(row.view_count || 0),
      likeCount: likes.length,
      likedByMe: interactions.likedPostIds.has(id),
      likes: [],
      commentCount: comments.length,
      comments: [],
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      publishedAt: Number(row.published_at)
    }
  }

  const images = sanitizeImageItems(safeParseJson<unknown>(row.images_json, []))
  const linkCard = sanitizeLinkCard(safeParseJson<unknown>(row.link_card_json, null))
  const metadata = parsePlainObject(safeParseJson<unknown>(row.metadata_json, {}))

  return {
    id,
    shortId,
    type,
    title: rawTitle,
    excerpt: String(row.excerpt || ''),
    content: String(row.content || ''),
    coverMediaId: row.cover_media_id ? String(row.cover_media_id) : null,
    coverUrl: resolveCoverUrl(row),
    category: String(row.category || ''),
    tags,
    images,
    linkCard,
    locationName: String(row.location_name || ''),
    sourceLabel: String(row.source_label || ''),
    sourceItemId: row.source_item_id ? String(row.source_item_id) : null,
    metadata,
    visibility,
    locked: false,
    isPinned: Boolean(Number(row.is_pinned || 0)),
    viewCount: viewCountOverride ?? Number(row.view_count || 0),
    likeCount: likes.length,
    likedByMe: interactions.likedPostIds.has(id),
    likes,
    commentCount: comments.length,
    comments,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    publishedAt: Number(row.published_at)
  }
}

async function loadAdjacentPosts(
  env: Env,
  request: Request,
  ownerId: string,
  currentRow: Row,
  isOwner: boolean
): Promise<{ prev: BlogAdjacentPost | null; next: BlogAdjacentPost | null }> {
  const currentId = String(currentRow.id)
  const currentType = String(currentRow.type) as BlogPostType
  const publishedAt = Number(currentRow.published_at || 0)
  const createdAt = Number(currentRow.created_at || 0)
  const visibilityClause = isOwner ? '' : "AND visibility <> 'private'"
  const typeClause = currentType === 'article' ? "AND type = 'article'" : ''

  const [prevRow, nextRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, short_id, type, title, excerpt, substr(content, 1, 160) AS content_head, visibility, password_hash, published_at ` +
        `FROM blog_posts WHERE user_id = ? ${visibilityClause} ${typeClause} AND id <> ? ` +
        `AND (published_at > ? OR (published_at = ? AND created_at > ?) OR (published_at = ? AND created_at = ? AND id > ?)) ` +
        `ORDER BY published_at ASC, created_at ASC, id ASC LIMIT 1`
    )
      .bind(ownerId, currentId, publishedAt, publishedAt, createdAt, publishedAt, createdAt, currentId)
      .first<Row>(),
    env.DB.prepare(
      `SELECT id, short_id, type, title, excerpt, substr(content, 1, 160) AS content_head, visibility, password_hash, published_at ` +
        `FROM blog_posts WHERE user_id = ? ${visibilityClause} ${typeClause} AND id <> ? ` +
        `AND (published_at < ? OR (published_at = ? AND created_at < ?) OR (published_at = ? AND created_at = ? AND id < ?)) ` +
        `ORDER BY published_at DESC, created_at DESC, id DESC LIMIT 1`
    )
      .bind(ownerId, currentId, publishedAt, publishedAt, createdAt, publishedAt, createdAt, currentId)
      .first<Row>()
  ])

  const toAdjacent = async (row: Row | null | undefined): Promise<BlogAdjacentPost | null> => {
    if (!row) return null
    const unlocked = await isPostUnlocked(request, row, isOwner)
    const locked = String(row.visibility) === 'password' && !unlocked
    const type = String(row.type) as BlogPostType
    const rawTitle = String(row.title || '')
    const previewContent = String(row.content_head ?? row.content ?? '')
    const title = locked
      ? rawTitle || '加密动态'
      : rawTitle || buildExcerpt(previewContent, String(row.excerpt || ''), 40) || (type === 'article' ? '无题文章' : '动态')
    return {
      shortId: String(row.short_id),
      type,
      title,
      publishedAt: Number(row.published_at)
    }
  }

  const [prev, next] = await Promise.all([toAdjacent(prevRow), toAdjacent(nextRow)])
  return { prev, next }
}

async function buildPostDetail(
  env: Env,
  request: Request,
  ownerId: string,
  row: Row,
  isOwner: boolean,
  visitorKey: string,
  forceUnlocked = false,
  viewCountOverride?: number
): Promise<BlogPostDetail> {
  const unlocked = forceUnlocked || (await isPostUnlocked(request, row, isOwner))
  const locked = String(row.visibility) === 'password' && !unlocked
  const [interactions, adjacent] = await Promise.all([
    loadPostInteractions(env, [String(row.id)], visitorKey),
    loadAdjacentPosts(env, request, ownerId, row, isOwner)
  ])
  const summary = serializePostSummary(row, interactions, locked, viewCountOverride)
  return {
    ...summary,
    prev: adjacent.prev,
    next: adjacent.next
  }
}

async function findPostByShortOrId(env: Env, ownerId: string, identifier: string): Promise<Row | null> {
  return env.DB.prepare(
    'SELECT * FROM blog_posts WHERE user_id = ? AND (short_id = ? OR id = ?) LIMIT 1'
  ).bind(ownerId, identifier, identifier).first<Row>()
}

async function generateUniqueShortId(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateShortId(8)
    const existing = await env.DB.prepare('SELECT 1 FROM blog_posts WHERE short_id = ?').bind(candidate).first<Row>()
    if (!existing) return candidate
  }
  return generateShortId(12)
}

async function verifyMediaOwnership(env: Env, ownerId: string, mediaId: string | null): Promise<string | null> {
  if (!mediaId) return null
  const clean = mediaId.trim()
  if (!clean) return null
  const row = await env.DB.prepare('SELECT id FROM blog_media WHERE id = ? AND user_id = ?')
    .bind(clean, ownerId)
    .first<Row>()
  if (!row) throw new ApiError(400, '指定的媒体文件不存在')
  return clean
}

export function extractBlogMediaIdsFromPostRow(row: Row): string[] {
  const ids = new Set<string>()
  const addId = (raw: unknown) => {
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed && trimmed !== 'gc') ids.add(trimmed)
    }
  }
  const addUrl = (raw: unknown) => {
    const extracted = extractMediaIdFromBlogUrl(raw)
    if (extracted) ids.add(extracted)
  }

  addId(row.cover_media_id)
  addUrl(row.cover_url)

  const rawImages = safeParseJson<unknown>(row.images_json, [])
  if (Array.isArray(rawImages)) {
    for (const entry of rawImages) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const img = entry as Record<string, unknown>
      addId(img.mediaId)
      addId(img.liveVideoMediaId)
      addUrl(img.url)
      addUrl(img.thumbUrl)
      addUrl(img.liveVideoUrl)
    }
  }

  const metadata = parsePlainObject(safeParseJson<unknown>(row.metadata_json, {}))
  if (metadata.video && typeof metadata.video === 'object' && !Array.isArray(metadata.video)) {
    const vid = metadata.video as Record<string, unknown>
    addId(vid.mediaId)
    addUrl(vid.url)
    addUrl(vid.coverUrl)
  }
  if (metadata.music && typeof metadata.music === 'object' && !Array.isArray(metadata.music)) {
    const mus = metadata.music as Record<string, unknown>
    addId(mus.audioMediaId)
    addId(mus.coverMediaId)
    addUrl(mus.audioUrl)
    addUrl(mus.coverUrl)
  }

  const linkCard = safeParseJson<unknown>(row.link_card_json, null)
  if (linkCard && typeof linkCard === 'object' && !Array.isArray(linkCard)) {
    addUrl((linkCard as Record<string, unknown>).image)
  }

  for (const mdId of extractBlogMediaIdsFromText(row.content)) {
    ids.add(mdId)
  }

  return [...ids]
}

export async function collectReferencedBlogMediaIds(env: Env, ownerId: string): Promise<Set<string>> {
  const referenced = new Set<string>()
  const addId = (raw: unknown) => {
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed && trimmed !== 'gc') referenced.add(trimmed)
    }
  }
  const addUrl = (raw: unknown) => {
    const id = extractMediaIdFromBlogUrl(raw)
    if (id) referenced.add(id)
  }

  const [postsRes, settingsRow, pagesRes, musicRes, catalogRes, friendsRes, mediaPairsRes] =
    await Promise.all([
      env.DB.prepare(
        "SELECT cover_media_id, cover_url, images_json, link_card_json, metadata_json, CASE WHEN content LIKE '%/api/blog/media/%' THEN content ELSE '' END AS content FROM blog_posts WHERE user_id = ?"
      )
        .bind(ownerId)
        .all<Row>(),
      loadOwnerSettingsRow(env, ownerId),
      env.DB.prepare('SELECT cover_media_id, content FROM blog_pages WHERE user_id = ?')
        .bind(ownerId)
        .all<Row>(),
      env.DB.prepare('SELECT audio_media_id, cover_media_id FROM blog_music_tracks WHERE user_id = ?')
        .bind(ownerId)
        .all<Row>(),
      env.DB.prepare('SELECT image_media_id, image_url FROM blog_catalog_items WHERE user_id = ?')
        .bind(ownerId)
        .all<Row>(),
      env.DB.prepare('SELECT avatar_media_id, avatar_url FROM blog_friends WHERE user_id = ?')
        .bind(ownerId)
        .all<Row>(),
      env.DB.prepare('SELECT id, paired_media_id FROM blog_media WHERE user_id = ? AND paired_media_id IS NOT NULL')
        .bind(ownerId)
        .all<Row>()
    ])

  for (const post of postsRes.results) {
    for (const id of extractBlogMediaIdsFromPostRow(post)) {
      referenced.add(id)
    }
  }

  if (settingsRow) {
    addId(settingsRow.avatar_media_id)
    addId(settingsRow.cover_media_id)
  }

  for (const page of pagesRes.results) {
    addId(page.cover_media_id)
    for (const id of extractBlogMediaIdsFromText(page.content)) {
      referenced.add(id)
    }
  }

  for (const track of musicRes.results) {
    addId(track.audio_media_id)
    addId(track.cover_media_id)
  }

  for (const item of catalogRes.results) {
    addId(item.image_media_id)
    addUrl(item.image_url)
  }

  for (const friend of friendsRes.results) {
    addId(friend.avatar_media_id)
    addUrl(friend.avatar_url)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const pair of mediaPairsRes.results) {
      const id = pair.id ? String(pair.id).trim() : ''
      const pairedId = pair.paired_media_id ? String(pair.paired_media_id).trim() : ''
      if (id && pairedId && referenced.has(id) && !referenced.has(pairedId)) {
        referenced.add(pairedId)
        changed = true
      }
    }
  }

  return referenced
}

function getEdgeCache(): Cache | null {
  try {
    if (typeof caches !== 'undefined' && caches && 'default' in caches) {
      return (caches as unknown as { default?: Cache }).default || null
    }
  } catch {
    // Ignore in environments without Cloudflare Cache API
  }
  return null
}

async function purgeBlogMediaEdgeCache(origin: string, mediaIds: string[]): Promise<void> {
  const edgeCache = getEdgeCache()
  if (!edgeCache || !mediaIds.length) return
  const baseOrigin = origin.replace(/\/+$/, '')
  const uniqueIds = [...new Set(mediaIds.filter(Boolean))]
  await Promise.all(
    uniqueIds.flatMap((id) => [
      edgeCache.delete(new Request(`${baseOrigin}${blogMediaUrl(id)}`, { method: 'GET' })),
      edgeCache.delete(new Request(`${baseOrigin}${blogMediaUrl(id, 'thumb')}`, { method: 'GET' }))
    ])
  )
}

export async function cleanupCandidateBlogMediaIds(
  env: Env,
  ownerId: string,
  candidateIds: string[]
): Promise<{ deletedCount: number; freedBytes: number }> {
  const initialCandidates = new Set(
    candidateIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)
  )
  if (!initialCandidates.size) {
    return { deletedCount: 0, freedBytes: 0 }
  }

  // Expand candidates with paired companions if any
  for (const batch of chunkIds([...initialCandidates])) {
    const ph = batch.map(() => '?').join(',')
    const pairedRes = await env.DB.prepare(
      `SELECT id, paired_media_id FROM blog_media WHERE user_id = ? AND (id IN (${ph}) OR paired_media_id IN (${ph}))`
    )
      .bind(ownerId, ...batch, ...batch)
      .all<Row>()
    for (const row of pairedRes.results) {
      if (row.id) initialCandidates.add(String(row.id))
      if (row.paired_media_id) initialCandidates.add(String(row.paired_media_id))
    }
  }

  const referenced = await collectReferencedBlogMediaIds(env, ownerId)
  const unreferencedCandidates = [...initialCandidates].filter((id) => !referenced.has(id))
  if (!unreferencedCandidates.length) {
    return { deletedCount: 0, freedBytes: 0 }
  }

  const rowsToDelete: Row[] = []
  for (const batch of chunkIds(unreferencedCandidates)) {
    const ph = batch.map(() => '?').join(',')
    const res = await env.DB.prepare(
      `SELECT id, storage_key, thumb_key, size FROM blog_media WHERE user_id = ? AND id IN (${ph})`
    )
      .bind(ownerId, ...batch)
      .all<Row>()
    rowsToDelete.push(...res.results)
  }

  if (!rowsToDelete.length) {
    return { deletedCount: 0, freedBytes: 0 }
  }

  const idsToDelete = rowsToDelete.map((r) => String(r.id))
  const r2Keys: string[] = []
  let freedBytes = 0
  for (const row of rowsToDelete) {
    freedBytes += Number(row.size || 0)
    if (row.storage_key) r2Keys.push(String(row.storage_key))
    if (row.thumb_key) r2Keys.push(String(row.thumb_key))
  }

  for (const batch of chunkIds(idsToDelete)) {
    const ph = batch.map(() => '?').join(',')
    await env.DB.prepare(`DELETE FROM blog_media WHERE user_id = ? AND id IN (${ph})`)
      .bind(ownerId, ...batch)
      .run()
  }

  await deleteR2Keys(env, r2Keys)
  return { deletedCount: idsToDelete.length, freedBytes }
}

export interface BlogMediaGcResult {
  deletedCount: number
  freedBytes: number
  legacyMemoDeletedCount: number
  legacyMemoFreedBytes: number
}

export async function runBlogMediaGc(
  env: Env,
  ownerId: string,
  options?: { minAgeMs?: number; includeLegacyMemo?: boolean }
): Promise<BlogMediaGcResult> {
  const minAgeMs =
    options?.minAgeMs !== undefined ? Math.max(0, Number(options.minAgeMs) || 0) : DEFAULT_GC_MIN_AGE_MS
  const now = Date.now()

  const [referenced, mediaRes] = await Promise.all([
    collectReferencedBlogMediaIds(env, ownerId),
    env.DB.prepare('SELECT id, storage_key, thumb_key, size, created_at FROM blog_media WHERE user_id = ?')
      .bind(ownerId)
      .all<Row>()
  ])

  const orphans = mediaRes.results.filter((row) => {
    const id = String(row.id || '')
    if (!id || referenced.has(id)) return false
    if (minAgeMs <= 0) return true
    return Number(row.created_at || 0) <= now - minAgeMs
  })

  let deletedCount = 0
  let freedBytes = 0
  if (orphans.length) {
    const orphanIds = orphans.map((r) => String(r.id))
    const r2Keys: string[] = []
    for (const row of orphans) {
      freedBytes += Number(row.size || 0)
      if (row.storage_key) r2Keys.push(String(row.storage_key))
      if (row.thumb_key) r2Keys.push(String(row.thumb_key))
    }

    for (const batch of chunkIds(orphanIds)) {
      const ph = batch.map(() => '?').join(',')
      await env.DB.prepare(`DELETE FROM blog_media WHERE user_id = ? AND id IN (${ph})`)
        .bind(ownerId, ...batch)
        .run()
    }
    await deleteR2Keys(env, r2Keys)
    deletedCount = orphanIds.length
  }

  let legacyMemoDeletedCount = 0
  let legacyMemoFreedBytes = 0

  if (options?.includeLegacyMemo) {
    const [canvasRow, memoAssetsRes] = await Promise.all([
      env.DB.prepare('SELECT scene_json FROM memo_canvas WHERE user_id = ?').bind(ownerId).first<Row>(),
      env.DB.prepare('SELECT file_id, storage_key, size FROM memo_assets WHERE user_id = ?')
        .bind(ownerId)
        .all<Row>()
    ])

    const defaultSceneKey = `memo/${ownerId}/scene.json`
    const extraSceneKey =
      canvasRow?.scene_json && String(canvasRow.scene_json).startsWith('r2:')
        ? String(canvasRow.scene_json).slice(3)
        : null

    let sceneBytes = 0
    try {
      const headScene = await env.IMAGES.head(extraSceneKey || defaultSceneKey)
      if (headScene && typeof headScene.size === 'number') {
        sceneBytes = headScene.size
      }
    } catch {
      // Ignore R2 head error if scene.json doesn't exist
    }

    legacyMemoDeletedCount = memoAssetsRes.results.length + (canvasRow ? 1 : 0)
    legacyMemoFreedBytes =
      memoAssetsRes.results.reduce((sum, r) => sum + Number(r.size || 0), 0) + sceneBytes

    await env.DB.batch([
      env.DB.prepare('DELETE FROM memo_assets WHERE user_id = ?').bind(ownerId),
      env.DB.prepare('DELETE FROM memo_canvas WHERE user_id = ?').bind(ownerId)
    ])

    const memoKeys = [
      ...memoAssetsRes.results.map((r) => String(r.storage_key || '')),
      defaultSceneKey,
      ...(extraSceneKey ? [extraSceneKey] : [])
    ]
    await deleteR2Keys(env, memoKeys)
  }

  return {
    deletedCount,
    freedBytes,
    legacyMemoDeletedCount,
    legacyMemoFreedBytes
  }
}

type MediaAccessScope =
  | { kind: 'public' }
  | { kind: 'password'; passwordPosts: Row[] }
  | { kind: 'private' }
  | { kind: 'unreferenced' }

async function resolveBlogMediaAccessScope(
  env: Env,
  ownerId: string,
  mediaId: string,
  pairedMediaId: string | null
): Promise<MediaAccessScope> {
  const targetIds = new Set<string>([mediaId])
  if (pairedMediaId) targetIds.add(pairedMediaId)

  const [reversePairedRes, settingsRow, pagesRes, musicRes, catalogRes, friendsRes, postsRes] =
    await Promise.all([
      env.DB.prepare('SELECT id FROM blog_media WHERE user_id = ? AND paired_media_id = ?')
        .bind(ownerId, mediaId)
        .all<Row>(),
      loadOwnerSettingsRow(env, ownerId),
      env.DB.prepare('SELECT cover_media_id, content FROM blog_pages WHERE user_id = ?')
        .bind(ownerId)
        .all<Row>(),
      env.DB.prepare('SELECT audio_media_id, cover_media_id FROM blog_music_tracks WHERE user_id = ?')
        .bind(ownerId)
        .all<Row>(),
      env.DB.prepare('SELECT image_media_id, image_url FROM blog_catalog_items WHERE user_id = ?')
        .bind(ownerId)
        .all<Row>(),
      env.DB.prepare('SELECT avatar_media_id, avatar_url FROM blog_friends WHERE user_id = ?')
        .bind(ownerId)
        .all<Row>(),
      env.DB.prepare(
        "SELECT id, short_id, visibility, password_hash, cover_media_id, cover_url, images_json, link_card_json, metadata_json, CASE WHEN content LIKE '%/api/blog/media/%' THEN content ELSE '' END AS content FROM blog_posts WHERE user_id = ?"
      )
        .bind(ownerId)
        .all<Row>()
    ])

  for (const row of reversePairedRes.results) {
    if (row.id) targetIds.add(String(row.id))
  }

  const matchesTarget = (raw: unknown): boolean =>
    typeof raw === 'string' && targetIds.has(raw.trim())
  const matchesTargetUrl = (raw: unknown): boolean => {
    const id = extractMediaIdFromBlogUrl(raw)
    return Boolean(id && targetIds.has(id))
  }

  if (
    settingsRow &&
    (matchesTarget(settingsRow.avatar_media_id) || matchesTarget(settingsRow.cover_media_id))
  ) {
    return { kind: 'public' }
  }

  for (const page of pagesRes.results) {
    if (matchesTarget(page.cover_media_id)) return { kind: 'public' }
    if (extractBlogMediaIdsFromText(page.content).some((id) => targetIds.has(id))) {
      return { kind: 'public' }
    }
  }

  for (const track of musicRes.results) {
    if (matchesTarget(track.audio_media_id) || matchesTarget(track.cover_media_id)) {
      return { kind: 'public' }
    }
  }

  for (const item of catalogRes.results) {
    if (matchesTarget(item.image_media_id) || matchesTargetUrl(item.image_url)) {
      return { kind: 'public' }
    }
  }

  for (const friend of friendsRes.results) {
    if (matchesTarget(friend.avatar_media_id) || matchesTargetUrl(friend.avatar_url)) {
      return { kind: 'public' }
    }
  }

  let hasPrivate = false
  const passwordPosts: Row[] = []

  for (const post of postsRes.results) {
    const postMediaIds = extractBlogMediaIdsFromPostRow(post)
    if (!postMediaIds.some((id) => targetIds.has(id))) continue
    const vis = String(post.visibility || 'public')
    if (vis === 'public') {
      return { kind: 'public' }
    }
    if (vis === 'password') {
      passwordPosts.push(post)
    } else if (vis === 'private') {
      hasPrivate = true
    }
  }

  if (passwordPosts.length > 0) {
    return { kind: 'password', passwordPosts }
  }
  if (hasPrivate) {
    return { kind: 'private' }
  }
  return { kind: 'unreferenced' }
}

export async function resolveBlogOgMeta(env: Env, requestUrl: URL): Promise<BlogOgMeta> {
  const route = matchBlogHtmlRoute(requestUrl.pathname) || { kind: 'home' as const }
  const ownerRow = await env.DB.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').first<Row>()
  if (!ownerRow) {
    return buildBlogOgMeta({
      origin: requestUrl.origin,
      pathname: requestUrl.pathname,
      route
    })
  }

  const ownerId = String(ownerRow.id)
  const settingsRow = await loadOwnerSettingsRow(env, ownerId)
  const profile = mapSettingsToProfile(settingsRow)
  const siteImage = profile.coverUrl || profile.avatarUrl || null

  if (route.kind === 'about') {
    const aboutRow = await env.DB.prepare(
      "SELECT title, subtitle, content, cover_media_id FROM blog_pages WHERE user_id = ? AND slug = 'about'"
    )
      .bind(ownerId)
      .first<Row>()
    return buildBlogOgMeta({
      origin: requestUrl.origin,
      pathname: requestUrl.pathname,
      route,
      siteName: profile.siteName,
      siteBio: profile.bio,
      siteImage,
      aboutPage: aboutRow
        ? {
            title: aboutRow.title ? String(aboutRow.title) : null,
            subtitle: aboutRow.subtitle ? String(aboutRow.subtitle) : null,
            content: aboutRow.content ? String(aboutRow.content) : null,
            coverUrl: aboutRow.cover_media_id ? blogMediaUrl(String(aboutRow.cover_media_id)) : null
          }
        : null
    })
  }

  if (route.kind === 'article' || route.kind === 'moment') {
    const postRow = await env.DB.prepare(
      'SELECT type, title, excerpt, content, cover_media_id, cover_url, images_json, link_card_json, visibility FROM blog_posts WHERE user_id = ? AND short_id = ? LIMIT 1'
    )
      .bind(ownerId, route.shortId)
      .first<Row>()

    if (!postRow || String(postRow.visibility) !== 'public') {
      return buildBlogOgMeta({
        origin: requestUrl.origin,
        pathname: requestUrl.pathname,
        route,
        siteName: profile.siteName,
        siteBio: profile.bio,
        siteImage,
        post: null
      })
    }

    const images = sanitizeImageItems(safeParseJson<unknown>(postRow.images_json, []))
    const linkCard = sanitizeLinkCard(safeParseJson<unknown>(postRow.link_card_json, null))
    const imageUrl = resolveCoverUrl(postRow) || images[0]?.url || linkCard?.image || null

    return buildBlogOgMeta({
      origin: requestUrl.origin,
      pathname: requestUrl.pathname,
      route,
      siteName: profile.siteName,
      siteBio: profile.bio,
      siteImage,
      post: {
        type: String(postRow.type) as BlogPostType,
        title: String(postRow.title || ''),
        excerpt: String(postRow.excerpt || ''),
        content: String(postRow.content || ''),
        imageUrl,
        visibility: 'public'
      }
    })
  }

  return buildBlogOgMeta({
    origin: requestUrl.origin,
    pathname: requestUrl.pathname,
    route,
    siteName: profile.siteName,
    siteBio: profile.bio,
    siteImage
  })
}

interface QueryBlogPostsOptions {
  page: number
  limit: number
  typeParam?: string
  visibilityParam?: string
  tagFilter?: string
  categoryFilter?: string
  queryNeedle?: string
}

async function queryBlogPostsPage(
  env: Env,
  request: Request,
  auth: AuthContext,
  opts: QueryBlogPostsOptions
): Promise<BlogPostsResponse> {
  const { page, limit } = opts
  if (!auth.owner) {
    return { posts: [], total: 0, hasMore: false, page, limit }
  }

  const typeParam = opts.typeParam || 'all'
  const visibilityParam = opts.visibilityParam || 'all'
  const tagFilter = (opts.tagFilter || '').trim()
  const categoryFilter = (opts.categoryFilter || '').trim()
  const queryNeedle = (opts.queryNeedle || '').trim().toLocaleLowerCase('zh-CN')

  const whereParts: string[] = ['user_id = ?']
  const bindings: Array<string | number> = [auth.owner.id]

  if (typeParam === 'moment' || typeParam === 'article') {
    whereParts.push('type = ?')
    bindings.push(typeParam)
  }

  if (auth.isOwner) {
    if (visibilityParam === 'public' || visibilityParam === 'private' || visibilityParam === 'password') {
      whereParts.push('visibility = ?')
      bindings.push(visibilityParam)
    }
  } else {
    whereParts.push("visibility <> 'private'")
  }

  if (categoryFilter) {
    whereParts.push('category = ?')
    bindings.push(categoryFilter)
  }

  let matchedIds: string[] = []
  const lockedById = new Map<string, boolean>()

  if (!queryNeedle) {
    // Lightweight index scan: NO content / images_json / metadata_json / link_card_json fetched
    const metaRes = await env.DB.prepare(
      `SELECT id, tags_json FROM blog_posts WHERE ${whereParts.join(' AND ')} ORDER BY is_pinned DESC, published_at DESC, created_at DESC`
    )
      .bind(...bindings)
      .all<Row>()

    const needleTag = tagFilter.toLocaleLowerCase('zh-CN')
    for (const row of metaRes.results) {
      if (needleTag) {
        const tags = parseTagsColumn(row.tags_json)
        if (!tags.some((t) => t.toLocaleLowerCase('zh-CN') === needleTag)) continue
      }
      matchedIds.push(String(row.id))
    }
  } else {
    // Fallback when q search needs content LIKE ?
    const escapedLike = `%${queryNeedle.replace(/[\\%_]/g, '\\$&')}%`
    const searchWhere = [
      ...whereParts,
      "(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(excerpt) LIKE ? ESCAPE '\\' OR LOWER(content) LIKE ? ESCAPE '\\' OR LOWER(category) LIKE ? ESCAPE '\\' OR LOWER(location_name) LIKE ? ESCAPE '\\' OR LOWER(tags_json) LIKE ? ESCAPE '\\')"
    ]
    const searchRes = await env.DB.prepare(
      `SELECT id, short_id, title, excerpt, content, category, location_name, tags_json, visibility, password_hash FROM blog_posts WHERE ${searchWhere.join(' AND ')} ORDER BY is_pinned DESC, published_at DESC, created_at DESC`
    )
      .bind(...bindings, escapedLike, escapedLike, escapedLike, escapedLike, escapedLike, escapedLike)
      .all<Row>()

    const needleTag = tagFilter.toLocaleLowerCase('zh-CN')
    for (const row of searchRes.results) {
      const tags = parseTagsColumn(row.tags_json)
      if (needleTag && !tags.some((t) => t.toLocaleLowerCase('zh-CN') === needleTag)) {
        continue
      }
      const unlocked = await isPostUnlocked(request, row, auth.isOwner)
      const locked = String(row.visibility) === 'password' && !unlocked
      lockedById.set(String(row.id), locked)

      const haystacks = locked
        ? [String(row.title || ''), String(row.category || ''), ...tags]
        : [
            String(row.title || ''),
            String(row.excerpt || ''),
            String(row.content || ''),
            String(row.category || ''),
            String(row.location_name || ''),
            ...tags
          ]
      if (haystacks.some((val) => val.toLocaleLowerCase('zh-CN').includes(queryNeedle))) {
        matchedIds.push(String(row.id))
      }
    }
  }

  const total = matchedIds.length
  const start = (page - 1) * limit
  const pageIds = matchedIds.slice(start, start + limit)

  if (!pageIds.length) {
    return { posts: [], total, hasMore: false, page, limit }
  }

  const fullRowMap = new Map<string, Row>()
  for (const batch of chunkIds(pageIds)) {
    const ph = batch.map(() => '?').join(',')
    const fullRes = await env.DB.prepare(
      `SELECT * FROM blog_posts WHERE user_id = ? AND id IN (${ph})`
    )
      .bind(auth.owner.id, ...batch)
      .all<Row>()
    for (const row of fullRes.results) {
      fullRowMap.set(String(row.id), row)
    }
  }

  const orderedPageRows = pageIds
    .map((id) => fullRowMap.get(id))
    .filter((row): row is Row => Boolean(row))

  const [visitorKey, pageEvaluated] = await Promise.all([
    resolveVisitorKey(request, auth.isOwner, auth.owner.id),
    Promise.all(
      orderedPageRows.map(async (row) => {
        const id = String(row.id)
        const cachedLocked = lockedById.get(id)
        if (cachedLocked !== undefined) {
          return { row, locked: cachedLocked }
        }
        const unlocked = await isPostUnlocked(request, row, auth.isOwner)
        return { row, locked: String(row.visibility) === 'password' && !unlocked }
      })
    )
  ])

  const interactions = await loadPostInteractions(
    env,
    orderedPageRows.map((row) => String(row.id)),
    visitorKey
  )

  const posts: BlogPostSummary[] = pageEvaluated.map(({ row, locked }) =>
    serializePostSummary(row, interactions, locked)
  )

  return {
    posts,
    total,
    hasMore: start + posts.length < total,
    page,
    limit
  }
}

export interface BlogRailSummary {
  aboutSubtitle: string
  aboutExcerpt: string
  recentAlbumPhotos: Array<{ url: string; thumbUrl: string; alt: string; postShortId: string }>
  equipment: BlogCatalogItem[]
  labs: BlogCatalogItem[]
  friends: BlogFriend[]
}

async function loadBlogRailSummary(
  env: Env,
  request: Request,
  ownerId: string,
  isOwner: boolean,
  profile: BlogProfile
): Promise<BlogRailSummary> {
  const visClause = isOwner ? '' : "AND visibility <> 'private'"
  const [aboutRow, albumPostsRes, equipmentRes, labsRes, friendsRes] = await Promise.all([
    env.DB.prepare('SELECT subtitle, content FROM blog_pages WHERE user_id = ? AND slug = ?')
      .bind(ownerId, 'about')
      .first<Row>(),
    env.DB.prepare(
      `SELECT id, short_id, title, excerpt, images_json, visibility, password_hash FROM blog_posts WHERE user_id = ? ${visClause} ORDER BY published_at DESC, created_at DESC LIMIT 50`
    )
      .bind(ownerId)
      .all<Row>(),
    env.DB.prepare(
      "SELECT * FROM blog_catalog_items WHERE user_id = ? AND section = 'equipment' ORDER BY sort_order ASC, created_at DESC LIMIT 4"
    )
      .bind(ownerId)
      .all<Row>(),
    env.DB.prepare(
      "SELECT * FROM blog_catalog_items WHERE user_id = ? AND section = 'labs' ORDER BY sort_order ASC, created_at DESC LIMIT 3"
    )
      .bind(ownerId)
      .all<Row>(),
    env.DB.prepare(
      'SELECT * FROM blog_friends WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC LIMIT 8'
    )
      .bind(ownerId)
      .all<Row>()
  ])

  const aboutSubtitle = aboutRow
    ? String(aboutRow.subtitle ?? '').trim() || profile.aboutSubtitle || profile.siteName || DEFAULT_ABOUT_SUBTITLE
    : profile.aboutSubtitle || DEFAULT_ABOUT_SUBTITLE

  let aboutExcerpt = ''
  if (aboutRow?.content && String(aboutRow.content).trim()) {
    aboutExcerpt = buildExcerpt(String(aboutRow.content), '', 110)
  }
  if (!aboutExcerpt) {
    if (profile.bio?.trim()) {
      aboutExcerpt = profile.bio.trim()
    } else {
      aboutExcerpt = isOwner ? '点击右上角详情完善「关于我」独立页面…' : '记录日常片段、阅读与思考。'
    }
  }

  const recentAlbumPhotos: Array<{ url: string; thumbUrl: string; alt: string; postShortId: string }> = []
  const seenPhotoUrls = new Set<string>()

  for (const row of albumPostsRes.results) {
    if (recentAlbumPhotos.length >= 9) break
    const unlocked = await isPostUnlocked(request, row, isOwner)
    if (String(row.visibility) === 'password' && !unlocked) continue
    const images = sanitizeImageItems(safeParseJson<unknown>(row.images_json, []))
    if (!images.length) continue
    const postShortId = String(row.short_id)
    for (const img of images) {
      const fullUrl = (img.url || '').trim()
      if (!fullUrl || seenPhotoUrls.has(fullUrl)) continue
      seenPhotoUrls.add(fullUrl)
      recentAlbumPhotos.push({
        url: fullUrl,
        thumbUrl: (img.thumbUrl || fullUrl).trim(),
        alt:
          img.alt?.trim() ||
          String(row.title || '').trim() ||
          String(row.excerpt || '').trim() ||
          '相册照片',
        postShortId
      })
      if (recentAlbumPhotos.length >= 9) break
    }
  }

  return {
    aboutSubtitle,
    aboutExcerpt,
    recentAlbumPhotos,
    equipment: equipmentRes.results.slice(0, 4).map((r) => serializeCatalogItem(r, blogMediaUrl)),
    labs: labsRes.results.slice(0, 3).map((r) => serializeCatalogItem(r, blogMediaUrl)),
    friends: friendsRes.results.slice(0, 8).map((r) => serializeFriend(r, blogMediaUrl))
  }
}

// --- Main Router ---

export async function handleBlogApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const response = await handleBlogApiInner(request, env, ctx)
  return applyGlobalSecurityHeaders(response)
}

async function handleBlogApiInner(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()

  // 9. GET /api/blog/media/:id (supports Edge Cache, Private/Password gating, HTTP Range / 206, XSS sandbox)
  const mediaItemMatch = path.match(/^\/api\/blog\/media\/([^/]+)$/)
  if (mediaItemMatch && mediaItemMatch[1] !== 'gc' && (method === 'GET' || method === 'HEAD')) {
    const mediaId = decodeURIComponent(mediaItemMatch[1])
    const wantsThumb = url.searchParams.get('variant') === 'thumb'
    const rangeHeader = request.headers.get('range')
    const edgeCache = getEdgeCache()
    const cacheKey = new Request(
      `${url.origin}/api/blog/media/${encodeURIComponent(mediaId)}${wantsThumb ? '?variant=thumb' : ''}`,
      { method: 'GET' }
    )

    // Fast public Edge Cache check BEFORE hitting D1 or R2 (only public media is ever placed in caches.default)
    if (method === 'GET' && rangeHeader === null && edgeCache) {
      const cached = await edgeCache.match(cacheKey)
      if (cached) {
        const cachedEtag = cached.headers.get('etag')
        const ifNoneMatch = request.headers.get('if-none-match')
        if (cachedEtag && ifNoneMatch && ifNoneMatch === cachedEtag) {
          return new Response(null, {
            status: 304,
            headers: {
              etag: cachedEtag,
              'accept-ranges': 'bytes',
              'cache-control': cached.headers.get('cache-control') || 'public, max-age=31536000, immutable',
              ...MEDIA_SECURITY_HEADERS
            }
          })
        }
        return cached
      }
    }

    const row = await env.DB.prepare(
      'SELECT id, user_id, storage_key, thumb_key, mime_type, thumb_mime_type, paired_media_id FROM blog_media WHERE id = ?'
    )
      .bind(mediaId)
      .first<Row>()
    if (!row) throw new ApiError(404, '媒体文件不存在')

    const ownerId = row.user_id ? String(row.user_id) : ''
    const pairedMediaId = row.paired_media_id ? String(row.paired_media_id) : null
    const scope = ownerId
      ? await resolveBlogMediaAccessScope(env, ownerId, mediaId, pairedMediaId)
      : ({ kind: 'unreferenced' } as const)

    let cacheControl = 'public, max-age=31536000, immutable'
    let canEdgeCache = false

    if (scope.kind === 'private') {
      const mediaAuth = await resolveAuth(env, request)
      if (!mediaAuth.isOwner) {
        throw new ApiError(404, '媒体文件不存在')
      }
      cacheControl = 'private, no-store'
    } else if (scope.kind === 'password') {
      const mediaAuth = await resolveAuth(env, request)
      if (!mediaAuth.isOwner) {
        const unlockedChecks = await Promise.all(
          scope.passwordPosts.map((post) => isPostUnlocked(request, post, false))
        )
        if (!unlockedChecks.some(Boolean)) {
          throw new ApiError(403, '该内容已加密，请先输入密码解锁')
        }
      }
      cacheControl = 'private, no-store'
    } else if (scope.kind === 'public') {
      cacheControl = 'public, max-age=31536000, immutable'
      canEdgeCache = true
    } else {
      cacheControl = 'private, no-store'
    }

    const hasThumb = Boolean(row.thumb_key)
    const key = String(wantsThumb && hasThumb ? row.thumb_key : row.storage_key)
    const contentType = String(
      wantsThumb && hasThumb ? row.thumb_mime_type || row.mime_type : row.mime_type
    )

    if (method === 'HEAD') {
      const headObj = await env.IMAGES.head(key)
      if (!headObj) throw new ApiError(404, '媒体文件不存在')
      return new Response(null, {
        status: 200,
        headers: {
          'content-type': contentType,
          'content-length': String(headObj.size),
          'accept-ranges': 'bytes',
          'cache-control': cacheControl,
          'content-disposition': 'inline',
          etag: headObj.httpEtag,
          ...MEDIA_SECURITY_HEADERS
        }
      })
    }

    if (rangeHeader !== null) {
      const headObj = await env.IMAGES.head(key)
      if (!headObj) throw new ApiError(404, '媒体文件不存在')

      const range = parseByteRange(rangeHeader, headObj.size)
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: {
            'content-range': `bytes */${headObj.size}`,
            'accept-ranges': 'bytes',
            'cache-control': 'no-store',
            ...MEDIA_SECURITY_HEADERS
          }
        })
      }

      const rangedObj = await env.IMAGES.get(key, {
        range: { offset: range.start, length: range.length }
      })
      if (!rangedObj || !('body' in rangedObj) || !rangedObj.body) {
        throw new ApiError(404, '媒体文件不存在')
      }

      return new Response(rangedObj.body, {
        status: 206,
        headers: {
          'content-type': contentType,
          'content-range': `bytes ${range.start}-${range.end}/${headObj.size}`,
          'content-length': String(range.length),
          'accept-ranges': 'bytes',
          'cache-control': cacheControl,
          'content-disposition': 'inline',
          etag: rangedObj.httpEtag,
          ...MEDIA_SECURITY_HEADERS
        }
      })
    }

    const obj = await env.IMAGES.get(key, { onlyIf: request.headers })
    if (!obj) throw new ApiError(404, '媒体文件不存在')

    const etag = obj.httpEtag
    if (!('body' in obj)) {
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          'accept-ranges': 'bytes',
          'cache-control': cacheControl,
          ...MEDIA_SECURITY_HEADERS
        }
      })
    }

    const mediaResponse = applyGlobalSecurityHeaders(
      new Response(obj.body, {
        status: 200,
        headers: {
          'content-type': contentType,
          ...(typeof obj.size === 'number' ? { 'content-length': String(obj.size) } : {}),
          'accept-ranges': 'bytes',
          'cache-control': cacheControl,
          'content-disposition': 'inline',
          etag,
          ...MEDIA_SECURITY_HEADERS
        }
      })
    )

    if (canEdgeCache && edgeCache) {
      ctx.waitUntil(edgeCache.put(cacheKey, mediaResponse.clone()))
    }

    return mediaResponse
  }

  const auth = await resolveAuth(env, request)

  // 1. GET /api/blog/bootstrap (public; supports ?full=1 zero-waterfall bundle)
  if (path === '/api/blog/bootstrap' && method === 'GET') {
    const wantsFull = url.searchParams.get('full') === '1'
    if (!auth.owner) {
      const defaultProfile = buildDefaultProfile()
      const payload: BlogBootstrap = {
        configured: false,
        isOwner: false,
        ownerEmail: null,
        profile: defaultProfile,
        categories: [],
        tags: []
      }
      if (!wantsFull) return json(payload)
      return json({
        ...payload,
        initialPosts: { posts: [], total: 0, hasMore: false, page: 1, limit: 15 } satisfies BlogPostsResponse,
        tracks: [] as BlogMusicTrack[],
        railSummary: {
          aboutSubtitle: '数字花园与个人简介',
          aboutExcerpt: defaultProfile.bio,
          recentAlbumPhotos: [],
          equipment: [],
          labs: [],
          friends: []
        } satisfies BlogRailSummary
      })
    }

    if (!wantsFull) {
      return json(await loadBlogBootstrap(env, auth.owner, auth.isOwner))
    }

    const [bootstrap, initialPosts, tracksRes] = await Promise.all([
      loadBlogBootstrap(env, auth.owner, auth.isOwner),
      queryBlogPostsPage(env, request, auth, { page: 1, limit: 15 }),
      env.DB.prepare(
        'SELECT * FROM blog_music_tracks WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC'
      )
        .bind(auth.owner.id)
        .all<Row>()
    ])

    const railSummary = await loadBlogRailSummary(
      env,
      request,
      auth.owner.id,
      auth.isOwner,
      bootstrap.profile
    )

    return json({
      ...bootstrap,
      initialPosts,
      tracks: tracksRes.results.map((r) => serializeMusicTrack(r, blogMediaUrl)),
      railSummary
    })
  }

  // 10. GET /api/blog/feed.xml (public)
  if (path === '/api/blog/feed.xml' && method === 'GET') {
    if (!auth.owner) {
      const xml = buildRssFeed({
        origin: url.origin,
        profile: buildDefaultProfile(),
        posts: []
      })
      return new Response(xml, {
        status: 200,
        headers: {
          'content-type': 'application/rss+xml; charset=utf-8',
          'cache-control': 'public, max-age=300'
        }
      })
    }

    const [settingsRow, postsRes] = await Promise.all([
      loadOwnerSettingsRow(env, auth.owner.id),
      env.DB.prepare(
        "SELECT short_id, type, title, excerpt, content, category, tags_json, published_at FROM blog_posts WHERE user_id = ? AND visibility = 'public' ORDER BY published_at DESC, created_at DESC LIMIT 30"
      ).bind(auth.owner.id).all<Row>()
    ])

    const profile = mapSettingsToProfile(settingsRow)
    const posts = postsRes.results.map((r) => ({
      shortId: String(r.short_id),
      type: String(r.type) as BlogPostType,
      title: String(r.title || ''),
      excerpt: String(r.excerpt || ''),
      content: String(r.content || ''),
      category: String(r.category || ''),
      tags: parseTagsColumn(r.tags_json),
      publishedAt: Number(r.published_at)
    }))

    const xml = buildRssFeed({ origin: url.origin, profile, posts })
    return new Response(xml, {
      status: 200,
      headers: {
        'content-type': 'application/rss+xml; charset=utf-8',
        'cache-control': 'public, max-age=300'
      }
    })
  }

  // 5. GET /api/blog/archives (public)
  if (path === '/api/blog/archives' && method === 'GET') {
    if (!auth.owner) return json({ items: [] as BlogArchiveItem[] })
    const visibilityClause = auth.isOwner ? '' : "AND visibility <> 'private'"
    const res = await env.DB.prepare(
      `SELECT id, short_id, type, title, excerpt, content, cover_media_id, cover_url, images_json, location_name, visibility, password_hash, is_pinned, published_at FROM blog_posts WHERE user_id = ? ${visibilityClause} ORDER BY published_at DESC, created_at DESC`
    ).bind(auth.owner.id).all<Row>()

    const items: BlogArchiveItem[] = await Promise.all(
      res.results.map(async (row) => {
        const unlocked = await isPostUnlocked(request, row, auth.isOwner)
        const locked = String(row.visibility) === 'password' && !unlocked
        const rawTitle = String(row.title || '')
        if (locked) {
          return {
            id: String(row.id),
            shortId: String(row.short_id),
            type: String(row.type) as BlogPostType,
            title: rawTitle || '加密动态',
            excerpt: '该内容已加密，输入密码后查看',
            contentPreview: '该内容已加密，输入密码后查看',
            coverUrl: null,
            images: [],
            locationName: '',
            visibility: String(row.visibility) as BlogVisibility,
            locked: true,
            isPinned: Boolean(Number(row.is_pinned || 0)),
            publishedAt: Number(row.published_at)
          }
        }
        return {
          id: String(row.id),
          shortId: String(row.short_id),
          type: String(row.type) as BlogPostType,
          title: rawTitle,
          excerpt: String(row.excerpt || ''),
          contentPreview: buildExcerpt(String(row.content || ''), '', 120),
          coverUrl: resolveCoverUrl(row),
          images: sanitizeImageItems(safeParseJson<unknown>(row.images_json, [])),
          locationName: String(row.location_name || ''),
          visibility: String(row.visibility) as BlogVisibility,
          locked: false,
          isPinned: Boolean(Number(row.is_pinned || 0)),
          publishedAt: Number(row.published_at)
        }
      })
    )

    return json({ items })
  }

  // 2. GET /api/blog/posts (public) & 11c. POST /api/blog/posts (owner)
  if (path === '/api/blog/posts' && method === 'GET') {
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const rawLimit = Number.parseInt(url.searchParams.get('limit') || '20', 10) || 20
    const limit = Math.max(1, Math.min(50, rawLimit))

    return json(
      await queryBlogPostsPage(env, request, auth, {
        page,
        limit,
        typeParam: url.searchParams.get('type') || 'all',
        visibilityParam: url.searchParams.get('visibility') || 'all',
        tagFilter: url.searchParams.get('tag') || '',
        categoryFilter: url.searchParams.get('category') || '',
        queryNeedle: url.searchParams.get('q') || ''
      })
    )
  }

  if (path === '/api/blog/posts' && method === 'POST') {
    const owner = requireOwner(auth)
    const body = await readJson(request)
    const type = validatePostType(body.type)
    const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const content = String(body.content || '').slice(0, 200_000)
    const images = sanitizeImageItems(body.images)
    const linkCard = sanitizeLinkCard(body.linkCard)
    const metadata = parsePlainObject(body.metadata)
    const metadataJson = JSON.stringify(metadata)
    if (metadataJson.length > 65_536) throw new ApiError(400, '扩展元数据过大')
    const hasMediaAttachment = Boolean(metadata.music || metadata.video)

    if (!title && !content.trim() && !images.length && !linkCard && !hasMediaAttachment) {
      throw new ApiError(400, '请输入正文内容、标题、图片或多媒体附件')
    }

    const visibility = body.visibility !== undefined ? validateVisibility(body.visibility) : 'public'
    let passwordHash: string | null = null
    if (visibility === 'password') {
      const rawPassword = String(body.password || '').trim()
      if (!rawPassword) throw new ApiError(400, '加密内容请设置访问密码')
      if (rawPassword.length > 100) throw new ApiError(400, '访问密码不能超过 100 个字符')
      passwordHash = await hashPassword(rawPassword)
    }

    const coverMediaId = await verifyMediaOwnership(
      env,
      owner.id,
      typeof body.coverMediaId === 'string' ? body.coverMediaId : null
    )
    const explicitCoverUrl = typeof body.coverUrl === 'string' ? body.coverUrl.trim().slice(0, 1000) : ''
    const coverUrl =
      explicitCoverUrl && (explicitCoverUrl.startsWith('/') || /^https?:\/\//i.test(explicitCoverUrl))
        ? explicitCoverUrl
        : coverMediaId
          ? blogMediaUrl(coverMediaId)
          : null

    const excerpt = hasOwn(body, 'excerpt')
      ? String(body.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 300)
      : type === 'article'
        ? buildExcerpt(content, '', 180)
        : ''
    const category = String(body.category || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const tags = normalizeTags(body.tags)
    const locationName = String(body.locationName || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const sourceLabel = String(body.sourceLabel || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const sourceItemId = typeof body.sourceItemId === 'string' && body.sourceItemId.trim()
      ? body.sourceItemId.trim().slice(0, 128)
      : null

    const isPinned = body.isPinned ? 1 : 0
    const now = Date.now()
    const publishedAtRaw = numberOrNull(body.publishedAt)
    const publishedAt = publishedAtRaw && publishedAtRaw > 0 ? Math.round(publishedAtRaw) : now

    const id = crypto.randomUUID()
    const shortId = await generateUniqueShortId(env)

    await env.DB.prepare(
      'INSERT INTO blog_posts (id, short_id, user_id, type, title, excerpt, content, cover_media_id, cover_url, category, tags_json, images_json, link_card_json, location_name, source_label, source_item_id, metadata_json, visibility, password_hash, is_pinned, view_count, created_at, updated_at, published_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)'
    ).bind(
      id,
      shortId,
      owner.id,
      type,
      title,
      excerpt,
      content,
      coverMediaId,
      coverUrl,
      category,
      JSON.stringify(tags),
      JSON.stringify(images),
      linkCard ? JSON.stringify(linkCard) : null,
      locationName,
      sourceLabel,
      sourceItemId,
      metadataJson,
      visibility,
      passwordHash,
      isPinned,
      now,
      now,
      publishedAt
    ).run()

    const created = await findPostByShortOrId(env, owner.id, id)
    if (!created) throw new ApiError(500, '发布失败，请重试')
    const visitorKey = await resolveVisitorKey(request, true, owner.id)
    return json(await buildPostDetail(env, request, owner.id, created, true, visitorKey, true), 201)
  }

  // 4. POST /api/blog/posts/:shortId/unlock (public)
  const unlockMatch = path.match(/^\/api\/blog\/posts\/([^/]+)\/unlock$/)
  if (unlockMatch && method === 'POST') {
    if (!auth.owner) throw new ApiError(404, '内容不存在')
    const identifier = decodeURIComponent(unlockMatch[1])
    const post = await findPostByShortOrId(env, auth.owner.id, identifier)
    if (!post || (String(post.visibility) === 'private' && !auth.isOwner)) {
      throw new ApiError(404, '内容不存在')
    }

    const ip = request.headers.get('cf-connecting-ip') || 'local'
    const rateKey = `${ip}:${String(post.short_id)}`
    checkRateLimit(unlockAttempts, rateKey, UNLOCK_RATE_LIMIT, '尝试次数过多，请 15 分钟后再试')

    const body = await readJson(request)
    const visitorKey = await resolveVisitorKey(request, auth.isOwner, auth.owner.id)

    if (String(post.visibility) !== 'password' || !post.password_hash) {
      return json(await buildPostDetail(env, request, auth.owner.id, post, auth.isOwner, visitorKey, true))
    }

    const password = String(body.password || '')
    const ok = await verifyPassword(password, String(post.password_hash))
    if (!ok) {
      recordRateLimitHit(unlockAttempts, rateKey, UNLOCK_RATE_WINDOW_MS)
      throw new ApiError(403, '访问密码不正确')
    }

    unlockAttempts.delete(rateKey)
    const token = await expectedUnlockToken(String(post.id), String(post.password_hash))
    const cookie = buildUnlockCookie(String(post.short_id), token, url)
    const detail = await buildPostDetail(env, request, auth.owner.id, post, auth.isOwner, visitorKey, true)
    return json(detail, 200, { 'set-cookie': cookie })
  }

  // 6. POST /api/blog/posts/:shortId/like (public)
  const postLikeMatch = path.match(/^\/api\/blog\/posts\/([^/]+)\/like$/)
  if (postLikeMatch && method === 'POST') {
    if (!auth.owner) throw new ApiError(404, '内容不存在')
    const identifier = decodeURIComponent(postLikeMatch[1])
    const post = await findPostByShortOrId(env, auth.owner.id, identifier)
    if (!post || (String(post.visibility) === 'private' && !auth.isOwner)) {
      throw new ApiError(404, '内容不存在')
    }

    if (!auth.isOwner) {
      const ip = request.headers.get('cf-connecting-ip') || 'local'
      checkRateLimit(likeAttempts, ip, LIKE_RATE_LIMIT, '操作过于频繁，请稍后再试')
      recordRateLimitHit(likeAttempts, ip, LIKE_RATE_WINDOW_MS)
    }

    const body = await readJson(request)
    const visitorKey = await resolveVisitorKey(request, auth.isOwner, auth.owner.id)
    const postId = String(post.id)

    const existing = await env.DB.prepare(
      'SELECT id FROM blog_likes WHERE post_id = ? AND visitor_key = ?'
    ).bind(postId, visitorKey).first<Row>()

    let liked = false
    if (existing) {
      await env.DB.prepare('DELETE FROM blog_likes WHERE id = ?').bind(String(existing.id)).run()
      liked = false
    } else {
      let authorName: string
      if (auth.isOwner) {
        const settings = await loadOwnerSettingsRow(env, auth.owner.id)
        authorName = String(settings?.nickname || DEFAULT_SETTINGS.nickname)
      } else {
        authorName = String(body.authorName || '').replace(/\s+/g, ' ').trim().slice(0, 32) || '访客'
      }
      await env.DB.prepare(
        'INSERT INTO blog_likes (id, post_id, visitor_key, author_name, is_owner, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), postId, visitorKey, authorName, auth.isOwner ? 1 : 0, Date.now()).run()
      liked = true
    }

    const likesRes = await env.DB.prepare(
      'SELECT id, author_name, is_owner, created_at FROM blog_likes WHERE post_id = ? ORDER BY created_at ASC'
    ).bind(postId).all<Row>()

    const likes: BlogLikeEntry[] = likesRes.results.map((r) => ({
      id: String(r.id),
      authorName: String(r.author_name),
      isOwner: Boolean(Number(r.is_owner || 0)),
      createdAt: Number(r.created_at)
    }))

    return json({ liked, likeCount: likes.length, likes })
  }

  // 7. POST /api/blog/posts/:shortId/comments (public)
  const postCommentsMatch = path.match(/^\/api\/blog\/posts\/([^/]+)\/comments$/)
  if (postCommentsMatch && method === 'POST') {
    if (!auth.owner) throw new ApiError(404, '内容不存在')
    const identifier = decodeURIComponent(postCommentsMatch[1])
    const post = await findPostByShortOrId(env, auth.owner.id, identifier)
    if (!post || (String(post.visibility) === 'private' && !auth.isOwner)) {
      throw new ApiError(404, '内容不存在')
    }

    const unlocked = await isPostUnlocked(request, post, auth.isOwner)
    if (String(post.visibility) === 'password' && !unlocked) {
      throw new ApiError(403, '请先输入密码解锁后再评论')
    }

    const settings = await loadOwnerSettingsRow(env, auth.owner.id)
    const allowComments = settings?.allow_comments === undefined ? true : Boolean(Number(settings.allow_comments))
    if (!auth.isOwner && !allowComments) {
      throw new ApiError(403, '博主已关闭评论功能')
    }

    if (!auth.isOwner) {
      const ip = request.headers.get('cf-connecting-ip') || 'local'
      checkRateLimit(commentAttempts, ip, COMMENT_RATE_LIMIT, '评论过于频繁，请稍后再试')
      recordRateLimitHit(commentAttempts, ip, COMMENT_RATE_WINDOW_MS)
    }

    const body = await readJson(request)
    const content = String(body.content || '').trim()
    if (!content) throw new ApiError(400, '请输入评论内容')
    if (content.length > 2000) throw new ApiError(400, '评论内容不能超过 2000 字')

    const authorName = auth.isOwner
      ? String(settings?.nickname || DEFAULT_SETTINGS.nickname)
      : String(body.authorName || '').replace(/\s+/g, ' ').trim().slice(0, 32) || '访客'
    const authorEmail = auth.isOwner
      ? auth.owner.email
      : String(body.authorEmail || '').trim().slice(0, 120)
    const authorWebsite = sanitizeWebsiteUrl(body.authorWebsite)

    const postId = String(post.id)
    let parentId: string | null = null
    if (typeof body.parentId === 'string' && body.parentId.trim()) {
      const parentRow = await env.DB.prepare(
        'SELECT id, parent_id FROM blog_comments WHERE id = ? AND post_id = ?'
      ).bind(body.parentId.trim(), postId).first<Row>()
      if (!parentRow) throw new ApiError(400, '回复的评论不存在')
      parentId = parentRow.parent_id ? String(parentRow.parent_id) : String(parentRow.id)
    }

    let replyToId: string | null = null
    let replyToName: string | null = null
    if (typeof body.replyToId === 'string' && body.replyToId.trim()) {
      const targetRow = await env.DB.prepare(
        'SELECT id, author_name, parent_id FROM blog_comments WHERE id = ? AND post_id = ?'
      ).bind(body.replyToId.trim(), postId).first<Row>()
      if (targetRow) {
        replyToId = String(targetRow.id)
        replyToName = String(targetRow.author_name)
        if (!parentId) {
          parentId = targetRow.parent_id ? String(targetRow.parent_id) : String(targetRow.id)
        }
      }
    }
    if (typeof body.replyToName === 'string' && body.replyToName.trim()) {
      replyToName = body.replyToName.replace(/\s+/g, ' ').trim().slice(0, 32)
    }

    const commentId = crypto.randomUUID()
    const createdAt = Date.now()
    await env.DB.prepare(
      'INSERT INTO blog_comments (id, post_id, parent_id, reply_to_id, reply_to_name, author_name, author_email, author_website, is_owner, content, like_count, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)'
    ).bind(
      commentId,
      postId,
      parentId,
      replyToId,
      replyToName,
      authorName,
      authorEmail,
      authorWebsite,
      auth.isOwner ? 1 : 0,
      content,
      createdAt
    ).run()

    const created: BlogComment = {
      id: commentId,
      postId,
      parentId,
      replyToId,
      replyToName,
      authorName,
      authorWebsite,
      isOwner: auth.isOwner,
      content,
      likeCount: 0,
      likedByMe: false,
      createdAt
    }
    return json(created, 201)
  }

  // 3. GET /api/blog/posts/:shortId (public), 11d. PATCH, 11e. DELETE (owner)
  const postMatch = path.match(/^\/api\/blog\/posts\/([^/]+)$/)
  if (postMatch) {
    const identifier = decodeURIComponent(postMatch[1])

    if (method === 'GET') {
      if (!auth.owner) throw new ApiError(404, '内容不存在')
      const post = await findPostByShortOrId(env, auth.owner.id, identifier)
      if (!post || (String(post.visibility) === 'private' && !auth.isOwner)) {
        throw new ApiError(404, '内容不存在')
      }

      const unlocked = await isPostUnlocked(request, post, auth.isOwner)
      const locked = String(post.visibility) === 'password' && !unlocked
      let nextViewCount = Number(post.view_count || 0)

      if (!locked && !auth.isOwner) {
        nextViewCount += 1
        ctx.waitUntil(
          env.DB.prepare('UPDATE blog_posts SET view_count = view_count + 1 WHERE id = ?')
            .bind(String(post.id))
            .run()
        )
      }

      const visitorKey = await resolveVisitorKey(request, auth.isOwner, auth.owner.id)
      const detail = await buildPostDetail(
        env,
        request,
        auth.owner.id,
        post,
        auth.isOwner,
        visitorKey,
        unlocked,
        nextViewCount
      )
      return json(detail)
    }

    if (method === 'PATCH') {
      const owner = requireOwner(auth)
      const post = await findPostByShortOrId(env, owner.id, identifier)
      if (!post) throw new ApiError(404, '内容不存在')

      const body = await readJson(request)
      const fields: string[] = []
      const values: Array<string | number | null> = []

      if (hasOwn(body, 'type')) {
        fields.push('type = ?')
        values.push(validatePostType(body.type))
      }
      if (hasOwn(body, 'title')) {
        fields.push('title = ?')
        values.push(String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 200))
      }
      if (hasOwn(body, 'excerpt')) {
        fields.push('excerpt = ?')
        values.push(String(body.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 300))
      }
      if (hasOwn(body, 'content')) {
        fields.push('content = ?')
        values.push(String(body.content || '').slice(0, 200_000))
      }
      if (hasOwn(body, 'coverMediaId')) {
        const nextCoverMediaId = await verifyMediaOwnership(
          env,
          owner.id,
          typeof body.coverMediaId === 'string' ? body.coverMediaId : null
        )
        fields.push('cover_media_id = ?')
        values.push(nextCoverMediaId)
        if (!hasOwn(body, 'coverUrl')) {
          fields.push('cover_url = ?')
          values.push(nextCoverMediaId ? blogMediaUrl(nextCoverMediaId) : null)
        }
      }
      if (hasOwn(body, 'coverUrl')) {
        const rawCoverUrl = typeof body.coverUrl === 'string' ? body.coverUrl.trim().slice(0, 1000) : ''
        const safeCoverUrl =
          rawCoverUrl && (rawCoverUrl.startsWith('/') || /^https?:\/\//i.test(rawCoverUrl))
            ? rawCoverUrl
            : null
        fields.push('cover_url = ?')
        values.push(safeCoverUrl)
      }
      if (hasOwn(body, 'category')) {
        fields.push('category = ?')
        values.push(String(body.category || '').replace(/\s+/g, ' ').trim().slice(0, 40))
      }
      if (hasOwn(body, 'tags')) {
        fields.push('tags_json = ?')
        values.push(JSON.stringify(normalizeTags(body.tags)))
      }
      if (hasOwn(body, 'images')) {
        fields.push('images_json = ?')
        values.push(JSON.stringify(sanitizeImageItems(body.images)))
      }
      if (hasOwn(body, 'linkCard')) {
        const nextLinkCard = sanitizeLinkCard(body.linkCard)
        fields.push('link_card_json = ?')
        values.push(nextLinkCard ? JSON.stringify(nextLinkCard) : null)
      }
      if (hasOwn(body, 'locationName')) {
        fields.push('location_name = ?')
        values.push(String(body.locationName || '').replace(/\s+/g, ' ').trim().slice(0, 80))
      }
      if (hasOwn(body, 'sourceLabel')) {
        fields.push('source_label = ?')
        values.push(String(body.sourceLabel || '').replace(/\s+/g, ' ').trim().slice(0, 80))
      }
      if (hasOwn(body, 'sourceItemId')) {
        fields.push('source_item_id = ?')
        values.push(
          typeof body.sourceItemId === 'string' && body.sourceItemId.trim()
            ? body.sourceItemId.trim().slice(0, 128)
            : null
        )
      }
      if (hasOwn(body, 'metadata')) {
        const metadataJson = JSON.stringify(parsePlainObject(body.metadata))
        if (metadataJson.length > 65_536) throw new ApiError(400, '扩展元数据过大')
        fields.push('metadata_json = ?')
        values.push(metadataJson)
      }
      if (hasOwn(body, 'isPinned')) {
        fields.push('is_pinned = ?')
        values.push(body.isPinned ? 1 : 0)
      }
      if (hasOwn(body, 'publishedAt')) {
        const ts = numberOrNull(body.publishedAt)
        if (!ts || ts <= 0) throw new ApiError(400, '发布时间无效')
        fields.push('published_at = ?')
        values.push(Math.round(ts))
      }

      const existingVisibility = String(post.visibility) as BlogVisibility
      const nextVisibility = hasOwn(body, 'visibility')
        ? validateVisibility(body.visibility)
        : existingVisibility

      if (hasOwn(body, 'visibility')) {
        fields.push('visibility = ?')
        values.push(nextVisibility)
      }

      if (nextVisibility === 'password') {
        const incomingPassword = hasOwn(body, 'password') ? String(body.password || '').trim() : ''
        if (incomingPassword) {
          if (incomingPassword.length > 100) throw new ApiError(400, '访问密码不能超过 100 个字符')
          fields.push('password_hash = ?')
          values.push(await hashPassword(incomingPassword))
        } else if (!post.password_hash) {
          throw new ApiError(400, '加密内容请设置访问密码')
        }
      } else if (existingVisibility === 'password' || post.password_hash) {
        fields.push('password_hash = ?')
        values.push(null)
      }

      if (fields.length) {
        fields.push('updated_at = ?')
        values.push(Date.now(), String(post.id), owner.id)
        await env.DB.prepare(
          `UPDATE blog_posts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
        ).bind(...values).run()
      }

      const updated = await findPostByShortOrId(env, owner.id, String(post.id))
      if (!updated) throw new ApiError(404, '内容不存在')

      const oldMediaIds = extractBlogMediaIdsFromPostRow(post)
      const nextMediaSet = new Set(extractBlogMediaIdsFromPostRow(updated))
      const removedMediaIds = oldMediaIds.filter((id) => !nextMediaSet.has(id))
      if (removedMediaIds.length) {
        ctx.waitUntil(cleanupCandidateBlogMediaIds(env, owner.id, removedMediaIds))
      }
      if (String(updated.visibility) !== 'public' || removedMediaIds.length) {
        ctx.waitUntil(purgeBlogMediaEdgeCache(url.origin, [...oldMediaIds, ...nextMediaSet]))
      }

      const visitorKey = await resolveVisitorKey(request, true, owner.id)
      return json(await buildPostDetail(env, request, owner.id, updated, true, visitorKey, true))
    }

    if (method === 'DELETE') {
      const owner = requireOwner(auth)
      const post = await findPostByShortOrId(env, owner.id, identifier)
      if (!post) throw new ApiError(404, '内容不存在')
      const oldMediaIds = extractBlogMediaIdsFromPostRow(post)
      await env.DB.prepare('DELETE FROM blog_posts WHERE id = ? AND user_id = ?')
        .bind(String(post.id), owner.id)
        .run()
      if (oldMediaIds.length) {
        ctx.waitUntil(
          Promise.all([
            cleanupCandidateBlogMediaIds(env, owner.id, oldMediaIds),
            purgeBlogMediaEdgeCache(url.origin, oldMediaIds)
          ])
        )
      }
      return json({ ok: true })
    }
  }

  // 8. POST /api/blog/comments/:id/like (public)
  const commentLikeMatch = path.match(/^\/api\/blog\/comments\/([^/]+)\/like$/)
  if (commentLikeMatch && method === 'POST') {
    if (!auth.owner) throw new ApiError(404, '评论不存在')
    const commentId = decodeURIComponent(commentLikeMatch[1])
    const commentRow = await env.DB.prepare(
      'SELECT c.id, p.visibility FROM blog_comments c JOIN blog_posts p ON p.id = c.post_id WHERE c.id = ? AND p.user_id = ?'
    ).bind(commentId, auth.owner.id).first<Row>()
    if (!commentRow || (String(commentRow.visibility) === 'private' && !auth.isOwner)) {
      throw new ApiError(404, '评论不存在')
    }

    if (!auth.isOwner) {
      const ip = request.headers.get('cf-connecting-ip') || 'local'
      checkRateLimit(likeAttempts, ip, LIKE_RATE_LIMIT, '操作过于频繁，请稍后再试')
      recordRateLimitHit(likeAttempts, ip, LIKE_RATE_WINDOW_MS)
    }

    const visitorKey = await resolveVisitorKey(request, auth.isOwner, auth.owner.id)
    const existing = await env.DB.prepare(
      'SELECT 1 FROM blog_comment_likes WHERE comment_id = ? AND visitor_key = ?'
    ).bind(commentId, visitorKey).first<Row>()

    let liked = false
    if (existing) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM blog_comment_likes WHERE comment_id = ? AND visitor_key = ?')
          .bind(commentId, visitorKey),
        env.DB.prepare(
          'UPDATE blog_comments SET like_count = (SELECT COUNT(*) FROM blog_comment_likes WHERE comment_id = ?) WHERE id = ?'
        ).bind(commentId, commentId)
      ])
      liked = false
    } else {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO blog_comment_likes (comment_id, visitor_key, created_at) VALUES (?, ?, ?)'
        ).bind(commentId, visitorKey, Date.now()),
        env.DB.prepare(
          'UPDATE blog_comments SET like_count = (SELECT COUNT(*) FROM blog_comment_likes WHERE comment_id = ?) WHERE id = ?'
        ).bind(commentId, commentId)
      ])
      liked = true
    }

    const updated = await env.DB.prepare('SELECT like_count FROM blog_comments WHERE id = ?')
      .bind(commentId)
      .first<Row>()
    return json({ liked, likeCount: Number(updated?.like_count || 0) })
  }

  // 11f. DELETE /api/blog/comments/:id (owner)
  const commentDeleteMatch = path.match(/^\/api\/blog\/comments\/([^/]+)$/)
  if (commentDeleteMatch && method === 'DELETE') {
    const owner = requireOwner(auth)
    const commentId = decodeURIComponent(commentDeleteMatch[1])
    const existing = await env.DB.prepare(
      'SELECT c.id FROM blog_comments c JOIN blog_posts p ON p.id = c.post_id WHERE c.id = ? AND p.user_id = ?'
    ).bind(commentId, owner.id).first<Row>()
    if (!existing) throw new ApiError(404, '评论不存在')
    await env.DB.prepare('DELETE FROM blog_comments WHERE id = ?').bind(commentId).run()
    return json({ ok: true })
  }

  // 11a. PUT / PATCH /api/blog/settings (owner)
  if (path === '/api/blog/settings' && (method === 'PUT' || method === 'PATCH')) {
    const owner = requireOwner(auth)
    const body = await readJson(request)
    const existing = await loadOwnerSettingsRow(env, owner.id)
    const current = mapSettingsToProfile(existing)

    const siteName = hasOwn(body, 'siteName')
      ? String(body.siteName || '').replace(/\s+/g, ' ').trim().slice(0, 60) || DEFAULT_SETTINGS.siteName
      : current.siteName
    const nickname = hasOwn(body, 'nickname')
      ? String(body.nickname || '').replace(/\s+/g, ' ').trim().slice(0, 40) || DEFAULT_SETTINGS.nickname
      : current.nickname
    const bio = hasOwn(body, 'bio')
      ? String(body.bio || '').trim().slice(0, 300)
      : current.bio
    const avatarMediaId = hasOwn(body, 'avatarMediaId')
      ? await verifyMediaOwnership(env, owner.id, typeof body.avatarMediaId === 'string' ? body.avatarMediaId : null)
      : current.avatarMediaId
    const coverMediaId = hasOwn(body, 'coverMediaId')
      ? await verifyMediaOwnership(env, owner.id, typeof body.coverMediaId === 'string' ? body.coverMediaId : null)
      : current.coverMediaId
    const footerText = hasOwn(body, 'footerText')
      ? String(body.footerText || '').trim().slice(0, 300)
      : current.footerText
    const allowComments = hasOwn(body, 'allowComments')
      ? Boolean(body.allowComments)
      : current.allowComments
    const extensions = hasOwn(body, 'extensions')
      ? parsePlainObject(body.extensions)
      : current.extensions
    const extensionsJson = JSON.stringify(extensions)
    if (extensionsJson.length > 65_536) throw new ApiError(400, '扩展配置过大')

    const now = Date.now()
    await env.DB.prepare(
      'INSERT INTO blog_settings (user_id, site_name, nickname, bio, avatar_media_id, cover_media_id, footer_text, allow_comments, extensions_json, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET site_name = excluded.site_name, nickname = excluded.nickname, bio = excluded.bio, avatar_media_id = excluded.avatar_media_id, cover_media_id = excluded.cover_media_id, footer_text = excluded.footer_text, allow_comments = excluded.allow_comments, extensions_json = excluded.extensions_json, updated_at = excluded.updated_at'
    ).bind(
      owner.id,
      siteName,
      nickname,
      bio,
      avatarMediaId,
      coverMediaId,
      footerText,
      allowComments ? 1 : 0,
      extensionsJson,
      now
    ).run()

    if (hasOwn(body, 'aboutSubtitle')) {
      const nextAboutSubtitle = String(body.aboutSubtitle ?? '').trim().slice(0, 120)
      const existingAbout = await env.DB.prepare(
        'SELECT * FROM blog_pages WHERE user_id = ? AND slug = ?'
      )
        .bind(owner.id, 'about')
        .first<Row>()

      const pageTitle = existingAbout?.title ? String(existingAbout.title) : '关于我'
      const pageContent =
        existingAbout?.content !== undefined && existingAbout?.content !== null
          ? String(existingAbout.content)
          : ''
      const pageCoverMediaId = existingAbout?.cover_media_id
        ? String(existingAbout.cover_media_id)
        : null
      const pageAllowComments =
        existingAbout?.allow_comments === undefined
          ? 1
          : Boolean(Number(existingAbout.allow_comments))
            ? 1
            : 0

      await env.DB.prepare(
        'INSERT INTO blog_pages (slug, user_id, title, subtitle, content, cover_media_id, allow_comments, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(user_id, slug) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle, content = excluded.content, cover_media_id = excluded.cover_media_id, allow_comments = excluded.allow_comments, updated_at = excluded.updated_at'
      )
        .bind(
          'about',
          owner.id,
          pageTitle,
          nextAboutSubtitle,
          pageContent,
          pageCoverMediaId,
          pageAllowComments,
          now
        )
        .run()
    }

    const removedSettingsMedia = [current.avatarMediaId, current.coverMediaId].filter(
      (id): id is string => Boolean(id && id !== avatarMediaId && id !== coverMediaId)
    )
    if (removedSettingsMedia.length) {
      ctx.waitUntil(cleanupCandidateBlogMediaIds(env, owner.id, removedSettingsMedia))
    }

    const bootstrap = await loadBlogBootstrap(env, owner, true)
    return json(bootstrap.profile)
  }

  // 11b-gc. POST /api/blog/media/gc (owner: clean unreferenced blog_media + optional legacy memo data)
  if (path === '/api/blog/media/gc' && method === 'POST') {
    const owner = requireOwner(auth)
    const body = await readJson(request)
    const includeRecent = Boolean(body.includeRecent)
    const includeLegacyMemo = Boolean(body.includeLegacyMemo)
    const stats = await runBlogMediaGc(env, owner.id, {
      minAgeMs: includeRecent ? 0 : DEFAULT_GC_MIN_AGE_MS,
      includeLegacyMemo
    })
    return json(stats)
  }

  // 11b. POST /api/blog/media (owner: supports multi-image batch AND single-file audio/video/image/lyric)
  if (path === '/api/blog/media' && method === 'POST') {
    const owner = requireOwner(auth)
    const form = await request.formData()
    const imageBatchFiles = form.getAll('images').filter((v): v is File => v instanceof File)
    const rawKind = typeof form.get('kind') === 'string' ? String(form.get('kind')).trim() : ''
    const rawPairedMediaId =
      typeof form.get('pairedMediaId') === 'string' ? String(form.get('pairedMediaId')).trim() : ''
    const singleFile = form.get('file')

    if (rawKind === 'file') {
      throw new ApiError(400, '不支持该文件类型')
    }

    // Phase 2 single-file upload (only image, audio, video, lyric allowed)
    if (!imageBatchFiles.length && (rawKind || rawPairedMediaId) && singleFile instanceof File) {
      const kind = validateMediaKind(rawKind)
      if (!singleFile.size) throw new ApiError(400, '上传的文件内容为空')

      const pairedMediaId = rawPairedMediaId
        ? await verifyMediaOwnership(env, owner.id, rawPairedMediaId)
        : null

      const mediaId = crypto.randomUUID()
      const now = Date.now()
      const originalName = cleanOriginalName(singleFile.name || kind)
      const uploadedKeys: string[] = []

      try {
        if (kind === 'image') {
          if (singleFile.size > MAX_IMAGE_BYTES) {
            throw new ApiError(400, '单张图片不能超过 20 MB')
          }
          const bytes = new Uint8Array(await singleFile.arrayBuffer())
          const detectedMime = detectImageMime(bytes)
          if (!detectedMime || !ALLOWED_IMAGE_TYPES.has(detectedMime)) {
            throw new ApiError(400, '只支持 PNG、JPEG、WebP 和 GIF 图片')
          }
          const ext = extensionFor(detectedMime)
          const storageKey = `blog/${owner.id}/${mediaId}/original.${ext}`
          const isGif = detectedMime === 'image/gif'
          let thumbKey: string | null = isGif ? storageKey : null
          let thumbMimeType: string | null = isGif ? 'image/gif' : null

          const puts: Promise<unknown>[] = [
            env.IMAGES.put(storageKey, bytes, {
              httpMetadata: {
                contentType: detectedMime,
                cacheControl: 'public, max-age=31536000, immutable'
              }
            })
          ]
          uploadedKeys.push(storageKey)

          const thumbs = form.getAll('thumbs').filter((v): v is File => v instanceof File)
          const meta = parseImageMeta(form.get('imageMeta'))
          const thumbFile = thumbs[0]
          if (!isGif && thumbFile && thumbFile.size > 0 && thumbFile.size <= 5 * 1024 * 1024) {
            const thumbBytes = new Uint8Array(await thumbFile.arrayBuffer())
            const detectedThumb = detectImageMime(thumbBytes)
            if (detectedThumb) {
              thumbKey = `blog/${owner.id}/${mediaId}/thumb.${extensionFor(detectedThumb)}`
              thumbMimeType = detectedThumb
              uploadedKeys.push(thumbKey)
              puts.push(
                env.IMAGES.put(thumbKey, thumbBytes, {
                  httpMetadata: {
                    contentType: detectedThumb,
                    cacheControl: 'public, max-age=31536000, immutable'
                  }
                })
              )
            }
          }

          await Promise.all(puts)

          const width =
            typeof meta[0]?.width === 'number' && Number.isFinite(meta[0].width)
              ? Math.round(meta[0].width as number)
              : null
          const height =
            typeof meta[0]?.height === 'number' && Number.isFinite(meta[0].height)
              ? Math.round(meta[0].height as number)
              : null

          await env.DB.prepare(
            'INSERT INTO blog_media (id, user_id, kind, original_name, storage_key, thumb_key, mime_type, thumb_mime_type, size, width, height, paired_media_id, created_at) ' +
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
            .bind(
              mediaId,
              owner.id,
              kind,
              originalName,
              storageKey,
              thumbKey,
              detectedMime,
              thumbMimeType,
              bytes.byteLength,
              width,
              height,
              pairedMediaId,
              now
            )
            .run()

          const uploaded: BlogMediaUpload = {
            id: mediaId,
            kind: 'image',
            originalName,
            mimeType: detectedMime,
            size: bytes.byteLength,
            width,
            height,
            url: blogMediaUrl(mediaId),
            thumbUrl: blogMediaUrl(mediaId, 'thumb')
          }
          return json({ media: [uploaded] }, 201)
        }

        let mimeType: string
        let ext: string

        if (kind === 'audio') {
          if (singleFile.size > MAX_AUDIO_BYTES) {
            throw new ApiError(400, '音频文件不能超过 40 MB')
          }
          const resolved = inferAudioMimeAndExt(singleFile.type, singleFile.name)
          if (!resolved) {
            throw new ApiError(
              400,
              '不支持的音频格式，请上传 MP3、M4A、AAC、OGG、WAV、FLAC 或 WebM 音频'
            )
          }
          mimeType = resolved.mimeType
          ext = resolved.ext
        } else if (kind === 'video') {
          if (singleFile.size > MAX_VIDEO_BYTES) {
            throw new ApiError(400, '视频文件不能超过 50 MB')
          }
          const resolved = inferVideoMimeAndExt(singleFile.type, singleFile.name)
          if (!resolved) {
            throw new ApiError(400, '不支持的视频格式，请上传 MP4、MOV 或 WebM 视频')
          }
          mimeType = resolved.mimeType
          ext = resolved.ext
        } else {
          // kind === 'lyric'
          if (singleFile.size > MAX_LYRIC_BYTES) {
            throw new ApiError(400, '歌词文件不能超过 2 MB')
          }
          mimeType = 'text/plain; charset=utf-8'
          ext = /\.txt$/i.test(singleFile.name || '') ? 'txt' : 'lrc'
        }

        const bytes = new Uint8Array(await singleFile.arrayBuffer())
        const storageKey = `blog/${owner.id}/${mediaId}/original.${ext}`
        uploadedKeys.push(storageKey)

        await env.IMAGES.put(storageKey, bytes, {
          httpMetadata: {
            contentType: mimeType,
            cacheControl: 'public, max-age=31536000, immutable'
          }
        })

        await env.DB.prepare(
          'INSERT INTO blog_media (id, user_id, kind, original_name, storage_key, thumb_key, mime_type, thumb_mime_type, size, width, height, paired_media_id, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, NULL, ?, ?)'
        )
          .bind(
            mediaId,
            owner.id,
            kind,
            originalName,
            storageKey,
            mimeType,
            bytes.byteLength,
            pairedMediaId,
            now
          )
          .run()

        const uploaded: BlogMediaUpload = {
          id: mediaId,
          kind,
          originalName,
          mimeType,
          size: bytes.byteLength,
          width: null,
          height: null,
          url: blogMediaUrl(mediaId),
          thumbUrl: ''
        }
        return json({ media: [uploaded] }, 201)
      } catch (error) {
        await deleteR2Keys(env, uploadedKeys)
        throw error
      }
    }

    let files = imageBatchFiles
    if (!files.length) {
      files = form.getAll('file').filter((v): v is File => v instanceof File)
    }
    const thumbs = form.getAll('thumbs').filter((v): v is File => v instanceof File)
    const meta = parseImageMeta(form.get('imageMeta'))

    if (!files.length) throw new ApiError(400, '请选择要上传的图片')
    if (files.length > MAX_MEDIA_UPLOAD_BATCH) {
      throw new ApiError(400, `单次最多上传 ${MAX_MEDIA_UPLOAD_BATCH} 张图片`)
    }

    const uploadedKeys: string[] = []
    const mediaList: BlogMediaUpload[] = []
    const insertStatements: D1PreparedStatement[] = []
    const now = Date.now()

    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]
        if (!file.size) throw new ApiError(400, '图片内容为空')
        if (file.size > MAX_IMAGE_BYTES) throw new ApiError(400, '单张图片不能超过 20 MB')

        const bytes = new Uint8Array(await file.arrayBuffer())
        const detectedMime = detectImageMime(bytes)
        if (!detectedMime || !ALLOWED_IMAGE_TYPES.has(detectedMime)) {
          throw new ApiError(400, '只支持 PNG、JPEG、WebP 和 GIF 图片')
        }

        const mediaId = crypto.randomUUID()
        const ext = extensionFor(detectedMime)
        const storageKey = `blog/${owner.id}/${mediaId}/original.${ext}`
        const isGif = detectedMime === 'image/gif'
        let thumbKey: string | null = isGif ? storageKey : null
        let thumbMimeType: string | null = isGif ? 'image/gif' : null

        const puts: Promise<unknown>[] = [
          env.IMAGES.put(storageKey, bytes, {
            httpMetadata: { contentType: detectedMime, cacheControl: 'public, max-age=31536000, immutable' }
          })
        ]
        uploadedKeys.push(storageKey)

        const thumbFile = thumbs[i]
        if (!isGif && thumbFile && thumbFile.size > 0 && thumbFile.size <= 5 * 1024 * 1024) {
          const thumbBytes = new Uint8Array(await thumbFile.arrayBuffer())
          const detectedThumb = detectImageMime(thumbBytes)
          if (detectedThumb) {
            const thumbExt = extensionFor(detectedThumb)
            thumbKey = `blog/${owner.id}/${mediaId}/thumb.${thumbExt}`
            thumbMimeType = detectedThumb
            uploadedKeys.push(thumbKey)
            puts.push(
              env.IMAGES.put(thumbKey, thumbBytes, {
                httpMetadata: { contentType: detectedThumb, cacheControl: 'public, max-age=31536000, immutable' }
              })
            )
          }
        }

        await Promise.all(puts)

        const originalName = cleanOriginalName(file.name || 'image')
        const width =
          typeof meta[i]?.width === 'number' && Number.isFinite(meta[i].width)
            ? Math.round(meta[i].width as number)
            : null
        const height =
          typeof meta[i]?.height === 'number' && Number.isFinite(meta[i].height)
            ? Math.round(meta[i].height as number)
            : null

        insertStatements.push(
          env.DB.prepare(
            'INSERT INTO blog_media (id, user_id, kind, original_name, storage_key, thumb_key, mime_type, thumb_mime_type, size, width, height, paired_media_id, created_at) ' +
            "VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)"
          ).bind(
            mediaId,
            owner.id,
            originalName,
            storageKey,
            thumbKey,
            detectedMime,
            thumbMimeType,
            bytes.byteLength,
            width,
            height,
            now
          )
        )

        mediaList.push({
          id: mediaId,
          kind: 'image',
          originalName,
          mimeType: detectedMime,
          size: bytes.byteLength,
          width,
          height,
          url: blogMediaUrl(mediaId),
          thumbUrl: blogMediaUrl(mediaId, 'thumb')
        })
      }

      if (insertStatements.length) {
        await env.DB.batch(insertStatements)
      }
    } catch (error) {
      await deleteR2Keys(env, uploadedKeys)
      throw error
    }

    return json({ media: mediaList }, 201)
  }

  // 11g. POST /api/blog/url-preview (owner)
  if (path === '/api/blog/url-preview' && method === 'POST') {
    requireOwner(auth)
    const body = await readJson(request)
    try {
      const metadata = await fetchPageMetadata(String(body.url || ''))
      const card: BlogLinkCard = {
        url: metadata.url,
        title: metadata.title || metadata.url,
        description: '',
        image: metadata.coverUrl,
        siteName: metadata.siteName
      }
      return json(card)
    } catch (error) {
      throw new ApiError(422, error instanceof Error ? error.message : '无法读取网页信息')
    }
  }

  // 11h. POST /api/blog/import-item/:itemId (owner)
  const importMatch = path.match(/^\/api\/blog\/import-item\/([^/]+)$/)
  if (importMatch && method === 'POST') {
    const owner = requireOwner(auth)
    const itemId = decodeURIComponent(importMatch[1])

    const [itemRes, assetsRes] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, owner.id),
      env.DB.prepare('SELECT * FROM assets WHERE item_id = ? AND user_id = ?').bind(itemId, owner.id)
    ])
    const itemRow = (itemRes.results as Row[])[0]
    if (!itemRow) throw new ApiError(404, '稍后阅读条目不存在')

    let categoryName = ''
    if (itemRow.category_id) {
      const catRow = await env.DB.prepare('SELECT name FROM categories WHERE id = ? AND user_id = ?')
        .bind(String(itemRow.category_id), owner.id)
        .first<Row>()
      categoryName = catRow?.name ? String(catRow.name) : ''
    }

    const sortedAssets = (assetsRes.results as Row[]).slice().sort((a, b) => {
      const roleOrder = (r: string) => (r === 'web_cover' ? 0 : r === 'gallery' ? 1 : 2)
      return (
        roleOrder(String(a.role)) - roleOrder(String(b.role)) ||
        Number(a.sort_order) - Number(b.sort_order) ||
        Number(a.created_at) - Number(b.created_at)
      )
    })

    const assetsToCopy = sortedAssets.slice(0, MAX_IMPORT_IMAGES)
    const uploadedKeys: string[] = []
    const insertStatements: D1PreparedStatement[] = []
    const copiedImages: Array<{ role: string; item: BlogImageItem; mediaId: string }> = []
    const now = Date.now()

    try {
      for (const asset of assetsToCopy) {
        const origKey = String(asset.original_key || '')
        if (!origKey) continue
        const origObj = await env.IMAGES.get(origKey)
        if (!origObj) continue
        const origBytes = new Uint8Array(await origObj.arrayBuffer())
        const mimeType = String(asset.mime_type || detectImageMime(origBytes) || 'image/jpeg')
        const ext = extensionFor(mimeType)

        const newMediaId = crypto.randomUUID()
        const newStorageKey = `blog/${owner.id}/${newMediaId}/original.${ext}`
        let newThumbKey: string | null = null
        let thumbMimeType: string | null = null

        const puts: Promise<unknown>[] = [
          env.IMAGES.put(newStorageKey, origBytes, {
            httpMetadata: { contentType: mimeType, cacheControl: 'public, max-age=31536000, immutable' }
          })
        ]
        uploadedKeys.push(newStorageKey)

        const srcThumbKey = asset.thumb_key ? String(asset.thumb_key) : ''
        if (srcThumbKey && srcThumbKey !== origKey) {
          const thumbObj = await env.IMAGES.get(srcThumbKey)
          if (thumbObj) {
            const thumbBytes = new Uint8Array(await thumbObj.arrayBuffer())
            const resolvedThumbMime = String(asset.thumb_mime_type || detectImageMime(thumbBytes) || 'image/webp')
            newThumbKey = `blog/${owner.id}/${newMediaId}/thumb.${extensionFor(resolvedThumbMime)}`
            thumbMimeType = resolvedThumbMime
            uploadedKeys.push(newThumbKey)
            puts.push(
              env.IMAGES.put(newThumbKey, thumbBytes, {
                httpMetadata: { contentType: resolvedThumbMime, cacheControl: 'public, max-age=31536000, immutable' }
              })
            )
          }
        }

        await Promise.all(puts)

        const originalName = cleanOriginalName(String(asset.original_name || 'imported-image'))
        const width = numberOrNull(asset.width)
        const height = numberOrNull(asset.height)

        insertStatements.push(
          env.DB.prepare(
            'INSERT INTO blog_media (id, user_id, kind, original_name, storage_key, thumb_key, mime_type, thumb_mime_type, size, width, height, paired_media_id, created_at) ' +
            "VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)"
          ).bind(
            newMediaId,
            owner.id,
            originalName,
            newStorageKey,
            newThumbKey,
            mimeType,
            thumbMimeType,
            origBytes.byteLength,
            width,
            height,
            now
          )
        )

        copiedImages.push({
          role: String(asset.role || ''),
          mediaId: newMediaId,
          item: {
            mediaId: newMediaId,
            url: blogMediaUrl(newMediaId),
            thumbUrl: blogMediaUrl(newMediaId, 'thumb'),
            width,
            height,
            alt: originalName
          }
        })
      }

      if (insertStatements.length) {
        await env.DB.batch(insertStatements)
      }
    } catch (error) {
      await deleteR2Keys(env, uploadedKeys)
      throw error
    }

    const kind = String(itemRow.kind)
    const itemTitle = String(itemRow.title || '')
    const itemUrl = itemRow.url ? String(itemRow.url) : ''
    const webCoverEntry = copiedImages.find((entry) => entry.role === 'web_cover') || null
    const nonCoverImages = copiedImages.filter((entry) => entry.role !== 'web_cover').map((entry) => entry.item)

    let linkCard: BlogLinkCard | null = null
    if (kind === 'link' && itemUrl) {
      let siteName = ''
      try {
        siteName = new URL(itemUrl).hostname.replace(/^www\./i, '')
      } catch {
        siteName = ''
      }
      linkCard = {
        url: itemUrl,
        title: itemTitle || itemUrl,
        description: '',
        ...(webCoverEntry ? { image: webCoverEntry.item.url } : {}),
        ...(siteName ? { siteName } : {})
      }
    }

    const draftImages = kind === 'link' ? nonCoverImages : copiedImages.map((entry) => entry.item)
    const primaryCover = webCoverEntry || copiedImages[0] || null

    const draft: BlogImportedItemDraft = {
      type: 'moment',
      title: itemTitle,
      content: itemTitle,
      linkCard,
      images: draftImages,
      coverMediaId: primaryCover ? primaryCover.mediaId : null,
      coverUrl: primaryCover ? primaryCover.item.url : null,
      category: categoryName,
      sourceLabel: '来自 稍后阅读',
      sourceItemId: String(itemRow.id)
    }

    return json(draft)
  }

  const phase2Response = await handleBlogPhase2Api(request, env, ctx, auth, {
    json,
    readJson,
    requireOwner,
    verifyMediaOwnership,
    blogMediaUrl,
    sanitizeWebsiteUrl,
    loadOwnerSettingsRow,
    defaultNickname: DEFAULT_SETTINGS.nickname,
    checkCommentRateLimit: (ip: string) => {
      checkRateLimit(commentAttempts, ip, COMMENT_RATE_LIMIT, '评论过于频繁，请稍后再试')
      recordRateLimitHit(commentAttempts, ip, COMMENT_RATE_WINDOW_MS)
    },
    scheduleMediaCleanup: (ownerId: string, candidateIds: Array<string | null | undefined>) => {
      const cleaned = candidateIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean)
      if (cleaned.length) {
        ctx.waitUntil(
          Promise.all([
            cleanupCandidateBlogMediaIds(env, ownerId, cleaned),
            purgeBlogMediaEdgeCache(url.origin, cleaned)
          ])
        )
      }
    },
    extractBlogMediaIdsFromText,
    extractMediaIdFromBlogUrl
  })
  if (phase2Response) return phase2Response

  return json({ error: '博客接口不存在' }, 404)
}
