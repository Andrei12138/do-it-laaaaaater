import type {
  BlogAmbientEffectId,
  BlogCatalogItem,
  BlogCatalogSection,
  BlogComment,
  BlogFriend,
  BlogMediaKind,
  BlogMusicTrack,
  BlogPageData,
  BlogTrackVisualConfig
} from '../src/blog-types'
import { ApiError, type Env } from './types'

type Row = Record<string, unknown>

export interface Phase2AuthContext {
  currentUser: { id: string; email: string } | null
  owner: { id: string; email: string } | null
  isOwner: boolean
}

export interface Phase2SharedHelpers {
  json: (data: unknown, status?: number, headers?: Record<string, string>) => Response
  readJson: (request: Request) => Promise<Record<string, unknown>>
  requireOwner: (auth: Phase2AuthContext) => { id: string; email: string }
  verifyMediaOwnership: (env: Env, ownerId: string, mediaId: string | null) => Promise<string | null>
  blogMediaUrl: (mediaId: string, variant?: 'original' | 'thumb') => string
  sanitizeWebsiteUrl: (input: unknown) => string
  loadOwnerSettingsRow: (env: Env, ownerId: string) => Promise<Row | null>
  defaultNickname: string
  checkCommentRateLimit: (ip: string) => void
  scheduleMediaCleanup: (ownerId: string, candidateIds: Array<string | null | undefined>) => void
  extractBlogMediaIdsFromText: (text: unknown) => string[]
  extractMediaIdFromBlogUrl: (rawUrl: unknown) => string | null
}

export interface ByteRange {
  start: number
  end: number
  length: number
}

export interface ResolvedMediaSpec {
  mimeType: string
  ext: string
}

export const MAX_AUDIO_BYTES = 40 * 1024 * 1024
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
export const MAX_LYRIC_BYTES = 2 * 1024 * 1024

const PAGE_SLUG_PATTERN = /^[a-z0-9-]{1,40}$/

const AUDIO_MIME_MAP: Record<string, ResolvedMediaSpec> = {
  'audio/mpeg': { mimeType: 'audio/mpeg', ext: 'mp3' },
  'audio/mp3': { mimeType: 'audio/mpeg', ext: 'mp3' },
  'audio/mp4': { mimeType: 'audio/mp4', ext: 'm4a' },
  'audio/x-m4a': { mimeType: 'audio/mp4', ext: 'm4a' },
  'audio/aac': { mimeType: 'audio/aac', ext: 'aac' },
  'audio/ogg': { mimeType: 'audio/ogg', ext: 'ogg' },
  'audio/wav': { mimeType: 'audio/wav', ext: 'wav' },
  'audio/x-wav': { mimeType: 'audio/wav', ext: 'wav' },
  'audio/wave': { mimeType: 'audio/wav', ext: 'wav' },
  'audio/webm': { mimeType: 'audio/webm', ext: 'webm' },
  'audio/flac': { mimeType: 'audio/flac', ext: 'flac' },
  'audio/x-flac': { mimeType: 'audio/flac', ext: 'flac' }
}

const AUDIO_EXT_MAP: Record<string, ResolvedMediaSpec> = {
  mp3: { mimeType: 'audio/mpeg', ext: 'mp3' },
  m4a: { mimeType: 'audio/mp4', ext: 'm4a' },
  aac: { mimeType: 'audio/aac', ext: 'aac' },
  ogg: { mimeType: 'audio/ogg', ext: 'ogg' },
  wav: { mimeType: 'audio/wav', ext: 'wav' },
  flac: { mimeType: 'audio/flac', ext: 'flac' },
  webm: { mimeType: 'audio/webm', ext: 'webm' }
}

const VIDEO_MIME_MAP: Record<string, ResolvedMediaSpec> = {
  'video/mp4': { mimeType: 'video/mp4', ext: 'mp4' },
  'video/quicktime': { mimeType: 'video/quicktime', ext: 'mov' },
  'video/webm': { mimeType: 'video/webm', ext: 'webm' }
}

const VIDEO_EXT_MAP: Record<string, ResolvedMediaSpec> = {
  mp4: { mimeType: 'video/mp4', ext: 'mp4' },
  mov: { mimeType: 'video/quicktime', ext: 'mov' },
  webm: { mimeType: 'video/webm', ext: 'webm' }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function extractFileExtension(fileName: string | null | undefined): string {
  if (!fileName) return ''
  const match = /\.([a-zA-Z0-9]{1,12})$/.exec(fileName.trim())
  return match ? match[1].toLowerCase() : ''
}

function normalizeMimeHeader(rawMime: string | null | undefined): string {
  if (!rawMime) return ''
  return rawMime.split(';')[0].trim().toLowerCase()
}

export function parseByteRange(header: string | null | undefined, totalSize: number): ByteRange | null {
  if (!header || !Number.isInteger(totalSize) || totalSize <= 0) return null
  const trimmed = header.trim()
  const unitMatch = /^bytes=(.+)$/i.exec(trimmed)
  if (!unitMatch) return null

  const spec = unitMatch[1].trim()
  if (!spec || spec.includes(',')) return null

  const rangeMatch = /^(\d*)-(\d*)$/.exec(spec)
  if (!rangeMatch) return null

  const [, startStr, endStr] = rangeMatch
  if (!startStr && !endStr) return null

  if (!startStr && endStr) {
    const suffixLength = Number(endStr)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    const start = suffixLength >= totalSize ? 0 : totalSize - suffixLength
    const end = totalSize - 1
    return { start, end, length: end - start + 1 }
  }

  const start = Number(startStr)
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) return null

  if (!endStr) {
    const end = totalSize - 1
    return { start, end, length: end - start + 1 }
  }

  const rawEnd = Number(endStr)
  if (!Number.isSafeInteger(rawEnd) || rawEnd < start) return null

  const end = Math.min(rawEnd, totalSize - 1)
  return { start, end, length: end - start + 1 }
}

export function inferAudioMimeAndExt(
  rawMime: string | null | undefined,
  fileName?: string | null
): ResolvedMediaSpec | null {
  const mime = normalizeMimeHeader(rawMime)
  if (mime && AUDIO_MIME_MAP[mime]) {
    return AUDIO_MIME_MAP[mime]
  }
  if (!mime || mime === 'application/octet-stream') {
    const ext = extractFileExtension(fileName)
    if (ext && AUDIO_EXT_MAP[ext]) {
      return AUDIO_EXT_MAP[ext]
    }
  }
  return null
}

export function inferVideoMimeAndExt(
  rawMime: string | null | undefined,
  fileName?: string | null
): ResolvedMediaSpec | null {
  const mime = normalizeMimeHeader(rawMime)
  if (mime && VIDEO_MIME_MAP[mime]) {
    return VIDEO_MIME_MAP[mime]
  }
  if (!mime || mime === 'application/octet-stream') {
    const ext = extractFileExtension(fileName)
    if (ext && VIDEO_EXT_MAP[ext]) {
      return VIDEO_EXT_MAP[ext]
    }
  }
  return null
}

export function validateMediaKind(raw: unknown): Exclude<BlogMediaKind, 'file'> {
  if (raw === 'file') {
    throw new ApiError(400, '不支持该文件类型')
  }
  if (raw === 'image' || raw === 'audio' || raw === 'video' || raw === 'lyric') {
    return raw
  }
  throw new ApiError(400, '不支持该文件类型')
}

export function isValidPageSlug(slug: string): boolean {
  return PAGE_SLUG_PATTERN.test(slug)
}

export function validatePageSlug(raw: unknown): string {
  const slug = typeof raw === 'string' ? raw.trim() : ''
  if (!isValidPageSlug(slug)) {
    throw new ApiError(400, '页面路径标识无效')
  }
  return slug
}

export function validateCatalogSection(raw: unknown): BlogCatalogSection {
  if (raw === 'equipment' || raw === 'labs') return raw
  throw new ApiError(400, '目录分区必须是 equipment 或 labs')
}

function sanitizeSafeAssetOrHttpUrl(raw: unknown, sanitizeWebsiteUrl: (v: unknown) => string): string {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed.slice(0, 1000)
  }
  return sanitizeWebsiteUrl(trimmed)
}

function defaultPageMeta(slug: string): { title: string; subtitle: string } {
  if (slug === 'about') {
    return {
      title: '关于我',
      subtitle: '数字花园与个人简介'
    }
  }
  return {
    title: slug,
    subtitle: ''
  }
}

const VISUAL_CONFIG_NUMERIC_BOUNDS: ReadonlyArray<
  readonly [Exclude<keyof BlogTrackVisualConfig, 'effect'>, number, number]
> = [
  ['sensitivity', 0.2, 2.5],
  ['bassGain', 0, 2.0],
  ['midGain', 0, 2.0],
  ['trebleGain', 0, 2.0],
  ['beatBoost', 0, 2.0],
  ['smoothing', 0.1, 0.9],
  ['speed', 0.1, 2.5],
  ['intensity', 0.1, 2.0],
  ['scale', 0.3, 2.2],
  ['audioReactivity', 0, 2.0],
  ['opacity', 0.15, 1.0]
]

const VALID_AMBIENT_EFFECTS = new Set<BlogAmbientEffectId>([
  'threads',
  'iridescence',
  'liquid-chrome',
  'aurora',
  'light-rays',
  'prism',
  'color-bends',
  'mesh-gradient',
  'warp',
  'liquid-metal',
  'god-rays',
  'neuro-noise',
  'metaballs',
  'grain-gradient',
  'smoke-ring'
])

function finiteVisualNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function clampBound(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function sanitizeTrackVisualConfig(input: unknown): Partial<BlogTrackVisualConfig> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }
  const obj = input as Record<string, unknown>
  const result: Partial<BlogTrackVisualConfig> = {}

  for (const [key, min, max] of VISUAL_CONFIG_NUMERIC_BOUNDS) {
    if (!hasOwn(obj, key)) continue
    const num = finiteVisualNumber(obj[key])
    if (num === null) continue
    result[key] = clampBound(num, min, max)
  }

  if (hasOwn(obj, 'effect')) {
    const rawEffect = obj.effect
    if (typeof rawEffect === 'string' && VALID_AMBIENT_EFFECTS.has(rawEffect as BlogAmbientEffectId)) {
      result.effect = rawEffect as BlogAmbientEffectId
    }
  }

  // Graceful migration for legacy pre-v10 D1 records (silkSpeed/silkWarp/silkSoftness/waveStyle...)
  if (result.speed === undefined && hasOwn(obj, 'silkSpeed')) {
    const legacy = finiteVisualNumber(obj.silkSpeed)
    if (legacy !== null) result.speed = clampBound(legacy, 0.1, 2.5)
  }
  if (result.intensity === undefined && hasOwn(obj, 'silkWarp')) {
    const legacy = finiteVisualNumber(obj.silkWarp)
    if (legacy !== null) result.intensity = clampBound(legacy, 0.1, 2.0)
  }
  if (result.scale === undefined && hasOwn(obj, 'waveScale')) {
    const legacy = finiteVisualNumber(obj.waveScale)
    if (legacy !== null) result.scale = clampBound(legacy, 0.3, 2.2)
  }
  if (result.opacity === undefined) {
    const legacyOpacity = finiteVisualNumber(obj.silkOpacity) ?? finiteVisualNumber(obj.waveOpacity)
    if (legacyOpacity !== null) result.opacity = clampBound(legacyOpacity, 0.15, 1.0)
  }
  if (result.effect === undefined) {
    const legacySoftness = hasOwn(obj, 'silkSoftness') ? finiteVisualNumber(obj.silkSoftness) : null
    if (legacySoftness !== null && legacySoftness <= 0.35) {
      result.effect = 'liquid-metal'
    } else if (hasOwn(obj, 'waveStyle') && typeof obj.waveStyle === 'string') {
      result.effect = 'threads'
    }
  }

  return result
}

function parseTrackVisualConfigJson(raw: unknown): Partial<BlogTrackVisualConfig> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return sanitizeTrackVisualConfig(raw)
  }
  if (typeof raw !== 'string') return {}
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '{}') return {}
  try {
    return sanitizeTrackVisualConfig(JSON.parse(trimmed))
  } catch {
    return {}
  }
}

export function serializeMusicTrack(
  row: Row,
  blogMediaUrl: (mediaId: string, variant?: 'original' | 'thumb') => string
): BlogMusicTrack {
  const audioMediaId = String(row.audio_media_id)
  const coverMediaId = row.cover_media_id ? String(row.cover_media_id) : null
  return {
    id: String(row.id),
    title: String(row.title || ''),
    artist: String(row.artist || ''),
    album: String(row.album || ''),
    audioMediaId,
    audioUrl: blogMediaUrl(audioMediaId),
    coverMediaId,
    coverUrl: coverMediaId ? blogMediaUrl(coverMediaId) : null,
    lrcText: String(row.lrc_text || ''),
    durationSec:
      row.duration_sec !== null && row.duration_sec !== undefined ? Number(row.duration_sec) : null,
    sortOrder: Number(row.sort_order || 0),
    visualConfig: parseTrackVisualConfigJson(row.visual_config_json),
    createdAt: Number(row.created_at)
  }
}

function serializePageComment(row: Row, slug: string): BlogComment {
  return {
    id: String(row.id),
    postId: `page:${slug}`,
    parentId: row.parent_id ? String(row.parent_id) : null,
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    replyToName: row.reply_to_name ? String(row.reply_to_name) : null,
    authorName: String(row.author_name || '访客'),
    authorWebsite: String(row.author_website || ''),
    isOwner: Boolean(Number(row.is_owner || 0)),
    content: String(row.content || ''),
    likeCount: Number(row.like_count || 0),
    likedByMe: false,
    createdAt: Number(row.created_at)
  }
}

async function loadPageData(
  env: Env,
  ownerId: string | null,
  slug: string,
  blogMediaUrl: (mediaId: string, variant?: 'original' | 'thumb') => string
): Promise<BlogPageData> {
  const defaults = defaultPageMeta(slug)
  if (!ownerId) {
    return {
      slug,
      title: defaults.title,
      subtitle: defaults.subtitle,
      content: '',
      coverMediaId: null,
      coverUrl: null,
      allowComments: true,
      updatedAt: 0,
      comments: []
    }
  }

  const [pageRow, commentsRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM blog_pages WHERE user_id = ? AND slug = ?')
      .bind(ownerId, slug)
      .first<Row>(),
    env.DB.prepare(
      'SELECT * FROM blog_page_comments WHERE user_id = ? AND page_slug = ? ORDER BY created_at ASC'
    )
      .bind(ownerId, slug)
      .all<Row>()
  ])

  const comments = commentsRes.results.map((r) => serializePageComment(r, slug))

  if (!pageRow) {
    return {
      slug,
      title: defaults.title,
      subtitle: defaults.subtitle,
      content: '',
      coverMediaId: null,
      coverUrl: null,
      allowComments: true,
      updatedAt: 0,
      comments
    }
  }

  const coverMediaId = pageRow.cover_media_id ? String(pageRow.cover_media_id) : null
  return {
    slug,
    title: String(pageRow.title || defaults.title),
    subtitle: pageRow.subtitle !== null && pageRow.subtitle !== undefined ? String(pageRow.subtitle) : '',
    content: String(pageRow.content || ''),
    coverMediaId,
    coverUrl: coverMediaId ? blogMediaUrl(coverMediaId) : null,
    allowComments: pageRow.allow_comments === undefined ? true : Boolean(Number(pageRow.allow_comments)),
    updatedAt: Number(pageRow.updated_at || 0),
    comments
  }
}

export function serializeCatalogItem(
  row: Row,
  blogMediaUrl: (mediaId: string, variant?: 'original' | 'thumb') => string
): BlogCatalogItem {
  const imageMediaId = row.image_media_id ? String(row.image_media_id) : null
  const explicitImageUrl = row.image_url ? String(row.image_url).trim() : ''
  return {
    id: String(row.id),
    section: String(row.section) as BlogCatalogSection,
    category: String(row.category || '默认'),
    title: String(row.title || ''),
    subtitle: String(row.subtitle || ''),
    description: String(row.description || ''),
    imageMediaId,
    imageUrl: explicitImageUrl || (imageMediaId ? blogMediaUrl(imageMediaId) : null),
    linkUrl: String(row.link_url || ''),
    tag: String(row.tag || ''),
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

export function serializeFriend(
  row: Row,
  blogMediaUrl: (mediaId: string, variant?: 'original' | 'thumb') => string
): BlogFriend {
  const avatarMediaId = row.avatar_media_id ? String(row.avatar_media_id) : null
  const explicitAvatarUrl = String(row.avatar_url || '').trim()
  return {
    id: String(row.id),
    name: String(row.name || ''),
    url: String(row.url || ''),
    avatarMediaId,
    avatarUrl: explicitAvatarUrl || (avatarMediaId ? blogMediaUrl(avatarMediaId) : ''),
    description: String(row.description || ''),
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

export async function handleBlogPhase2Api(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  auth: Phase2AuthContext,
  helpers: Phase2SharedHelpers
): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()
  const {
    json,
    readJson,
    requireOwner,
    verifyMediaOwnership,
    blogMediaUrl,
    sanitizeWebsiteUrl,
    loadOwnerSettingsRow,
    defaultNickname,
    checkCommentRateLimit,
    scheduleMediaCleanup,
    extractBlogMediaIdsFromText,
    extractMediaIdFromBlogUrl
  } = helpers

  // --- 1. Music Tracks ---
  if (path === '/api/blog/music/tracks' && method === 'GET') {
    if (!auth.owner) return json({ tracks: [] as BlogMusicTrack[] })
    const res = await env.DB.prepare(
      'SELECT id, user_id, title, artist, album, audio_media_id, cover_media_id, lrc_text, duration_sec, sort_order, visual_config_json, created_at FROM blog_music_tracks WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC'
    )
      .bind(auth.owner.id)
      .all<Row>()
    return json({ tracks: res.results.map((r) => serializeMusicTrack(r, blogMediaUrl)) })
  }

  if (path === '/api/blog/music/tracks' && method === 'POST') {
    const owner = requireOwner(auth)
    const body = await readJson(request)
    const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!title) throw new ApiError(400, '请输入歌曲名称')

    const rawAudioMediaId = typeof body.audioMediaId === 'string' ? body.audioMediaId.trim() : ''
    if (!rawAudioMediaId) throw new ApiError(400, '请先上传音频文件')
    const audioMediaId = await verifyMediaOwnership(env, owner.id, rawAudioMediaId)
    if (!audioMediaId) throw new ApiError(400, '请先上传音频文件')

    const artist = String(body.artist || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const album = String(body.album || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const coverMediaId = await verifyMediaOwnership(
      env,
      owner.id,
      typeof body.coverMediaId === 'string' ? body.coverMediaId : null
    )
    const lrcText = String(body.lrcText || '').slice(0, 100_000)
    const durationRaw = numberOrNull(body.durationSec)
    const durationSec = durationRaw !== null && durationRaw >= 0 ? Math.round(durationRaw) : null
    const sortRaw = numberOrNull(body.sortOrder)
    const sortOrder = sortRaw !== null ? Math.round(sortRaw) : 0
    const visualConfigJson = JSON.stringify(sanitizeTrackVisualConfig(body.visualConfig))

    const id = crypto.randomUUID()
    const createdAt = Date.now()

    await env.DB.prepare(
      'INSERT INTO blog_music_tracks (id, user_id, title, artist, album, audio_media_id, cover_media_id, lrc_text, duration_sec, sort_order, visual_config_json, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        id,
        owner.id,
        title,
        artist,
        album,
        audioMediaId,
        coverMediaId,
        lrcText,
        durationSec,
        sortOrder,
        visualConfigJson,
        createdAt
      )
      .run()

    const created = await env.DB.prepare(
      'SELECT * FROM blog_music_tracks WHERE id = ? AND user_id = ?'
    )
      .bind(id, owner.id)
      .first<Row>()
    if (!created) throw new ApiError(500, '添加歌曲失败')
    return json(serializeMusicTrack(created, blogMediaUrl), 201)
  }

  const trackItemMatch = path.match(/^\/api\/blog\/music\/tracks\/([^/]+)$/)
  if (trackItemMatch) {
    const trackId = decodeURIComponent(trackItemMatch[1])

    if (method === 'PATCH') {
      const owner = requireOwner(auth)
      const existing = await env.DB.prepare(
        'SELECT * FROM blog_music_tracks WHERE id = ? AND user_id = ?'
      )
        .bind(trackId, owner.id)
        .first<Row>()
      if (!existing) throw new ApiError(404, '曲目不存在')

      const body = await readJson(request)
      const fields: string[] = []
      const values: Array<string | number | null> = []

      if (hasOwn(body, 'title')) {
        const nextTitle = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 200)
        if (!nextTitle) throw new ApiError(400, '请输入歌曲名称')
        fields.push('title = ?')
        values.push(nextTitle)
      }
      if (hasOwn(body, 'artist')) {
        fields.push('artist = ?')
        values.push(String(body.artist || '').replace(/\s+/g, ' ').trim().slice(0, 120))
      }
      if (hasOwn(body, 'album')) {
        fields.push('album = ?')
        values.push(String(body.album || '').replace(/\s+/g, ' ').trim().slice(0, 120))
      }
      if (hasOwn(body, 'audioMediaId')) {
        const rawAudio = typeof body.audioMediaId === 'string' ? body.audioMediaId.trim() : ''
        if (!rawAudio) throw new ApiError(400, '音频文件不能为空')
        const nextAudio = await verifyMediaOwnership(env, owner.id, rawAudio)
        fields.push('audio_media_id = ?')
        values.push(nextAudio)
      }
      if (hasOwn(body, 'coverMediaId')) {
        const nextCover = await verifyMediaOwnership(
          env,
          owner.id,
          typeof body.coverMediaId === 'string' ? body.coverMediaId : null
        )
        fields.push('cover_media_id = ?')
        values.push(nextCover)
      }
      if (hasOwn(body, 'lrcText')) {
        fields.push('lrc_text = ?')
        values.push(String(body.lrcText || '').slice(0, 100_000))
      }
      if (hasOwn(body, 'durationSec')) {
        const dur = numberOrNull(body.durationSec)
        fields.push('duration_sec = ?')
        values.push(dur !== null && dur >= 0 ? Math.round(dur) : null)
      }
      if (hasOwn(body, 'sortOrder')) {
        const sort = numberOrNull(body.sortOrder)
        fields.push('sort_order = ?')
        values.push(sort !== null ? Math.round(sort) : 0)
      }
      if (hasOwn(body, 'visualConfig')) {
        fields.push('visual_config_json = ?')
        values.push(JSON.stringify(sanitizeTrackVisualConfig(body.visualConfig)))
      }

      if (fields.length) {
        values.push(trackId, owner.id)
        await env.DB.prepare(
          `UPDATE blog_music_tracks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
        )
          .bind(...values)
          .run()
      }

      const updated = await env.DB.prepare(
        'SELECT * FROM blog_music_tracks WHERE id = ? AND user_id = ?'
      )
        .bind(trackId, owner.id)
        .first<Row>()
      if (!updated) throw new ApiError(404, '曲目不存在')

      const nextIds = new Set(
        [
          updated.audio_media_id ? String(updated.audio_media_id) : '',
          updated.cover_media_id ? String(updated.cover_media_id) : ''
        ].filter(Boolean)
      )
      const removedIds = [
        existing.audio_media_id ? String(existing.audio_media_id) : '',
        existing.cover_media_id ? String(existing.cover_media_id) : ''
      ].filter((id) => id && !nextIds.has(id))
      if (removedIds.length) {
        scheduleMediaCleanup(owner.id, removedIds)
      }

      return json(serializeMusicTrack(updated, blogMediaUrl))
    }

    if (method === 'DELETE') {
      const owner = requireOwner(auth)
      const existing = await env.DB.prepare(
        'SELECT id, audio_media_id, cover_media_id FROM blog_music_tracks WHERE id = ? AND user_id = ?'
      )
        .bind(trackId, owner.id)
        .first<Row>()
      if (!existing) throw new ApiError(404, '曲目不存在')
      await env.DB.prepare('DELETE FROM blog_music_tracks WHERE id = ? AND user_id = ?')
        .bind(trackId, owner.id)
        .run()
      scheduleMediaCleanup(owner.id, [
        existing.audio_media_id ? String(existing.audio_media_id) : null,
        existing.cover_media_id ? String(existing.cover_media_id) : null
      ])
      return json({ ok: true })
    }
  }

  // --- 2. Standalone Pages & Page Comments ---
  const pageCommentsMatch = path.match(/^\/api\/blog\/pages\/([^/]+)\/comments$/)
  if (pageCommentsMatch && method === 'POST') {
    const slug = validatePageSlug(decodeURIComponent(pageCommentsMatch[1]))
    if (!auth.owner) throw new ApiError(404, '页面不存在')

    const [pageRow, settingsRow] = await Promise.all([
      env.DB.prepare('SELECT allow_comments FROM blog_pages WHERE user_id = ? AND slug = ?')
        .bind(auth.owner.id, slug)
        .first<Row>(),
      loadOwnerSettingsRow(env, auth.owner.id)
    ])

    const pageAllow =
      pageRow?.allow_comments === undefined ? true : Boolean(Number(pageRow.allow_comments))
    const globalAllow =
      settingsRow?.allow_comments === undefined ? true : Boolean(Number(settingsRow.allow_comments))

    if (!auth.isOwner && (!pageAllow || !globalAllow)) {
      throw new ApiError(403, '该页面已关闭留言功能')
    }

    if (!auth.isOwner) {
      const ip = request.headers.get('cf-connecting-ip') || 'local'
      checkCommentRateLimit(ip)
    }

    const body = await readJson(request)
    const content = String(body.content || '').trim()
    if (!content) throw new ApiError(400, '请输入留言内容')
    if (content.length > 2000) throw new ApiError(400, '留言内容不能超过 2000 字')

    const authorName = auth.isOwner
      ? String(settingsRow?.nickname || defaultNickname)
      : String(body.authorName || '').replace(/\s+/g, ' ').trim().slice(0, 32) || '访客'
    const authorEmail = auth.isOwner
      ? auth.owner.email
      : String(body.authorEmail || '').trim().slice(0, 120)
    const rawWebsite = String(body.authorWebsite || '').trim()
    const authorWebsite = sanitizeWebsiteUrl(rawWebsite)
    if (rawWebsite && !authorWebsite) {
      throw new ApiError(400, '个人网址格式无效，请使用 http:// 或 https://')
    }

    let parentId: string | null = null
    if (typeof body.parentId === 'string' && body.parentId.trim()) {
      const parentRow = await env.DB.prepare(
        'SELECT id, parent_id FROM blog_page_comments WHERE id = ? AND user_id = ? AND page_slug = ?'
      )
        .bind(body.parentId.trim(), auth.owner.id, slug)
        .first<Row>()
      if (!parentRow) throw new ApiError(400, '回复的留言不存在')
      parentId = parentRow.parent_id ? String(parentRow.parent_id) : String(parentRow.id)
    }

    let replyToId: string | null = null
    let replyToName: string | null = null
    if (typeof body.replyToId === 'string' && body.replyToId.trim()) {
      const targetRow = await env.DB.prepare(
        'SELECT id, author_name, parent_id FROM blog_page_comments WHERE id = ? AND user_id = ? AND page_slug = ?'
      )
        .bind(body.replyToId.trim(), auth.owner.id, slug)
        .first<Row>()
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
      'INSERT INTO blog_page_comments (id, user_id, page_slug, parent_id, reply_to_id, reply_to_name, author_name, author_email, author_website, is_owner, content, like_count, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)'
    )
      .bind(
        commentId,
        auth.owner.id,
        slug,
        parentId,
        replyToId,
        replyToName,
        authorName,
        authorEmail,
        authorWebsite,
        auth.isOwner ? 1 : 0,
        content,
        createdAt
      )
      .run()

    const created: BlogComment = {
      id: commentId,
      postId: `page:${slug}`,
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

  const pageMatch = path.match(/^\/api\/blog\/pages\/([^/]+)$/)
  if (pageMatch) {
    const slug = validatePageSlug(decodeURIComponent(pageMatch[1]))

    if (method === 'GET') {
      const data = await loadPageData(env, auth.owner?.id || null, slug, blogMediaUrl)
      return json(data)
    }

    if (method === 'PUT') {
      const owner = requireOwner(auth)
      const body = await readJson(request)
      const existing = await env.DB.prepare(
        'SELECT * FROM blog_pages WHERE user_id = ? AND slug = ?'
      )
        .bind(owner.id, slug)
        .first<Row>()

      const defaults = defaultPageMeta(slug)
      const title = hasOwn(body, 'title')
        ? String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || defaults.title
        : String(existing?.title || defaults.title)
      const subtitle = hasOwn(body, 'subtitle')
        ? String(body.subtitle || '').replace(/\s+/g, ' ').trim().slice(0, 200)
        : existing?.subtitle !== undefined && existing?.subtitle !== null
          ? String(existing.subtitle)
          : defaults.subtitle
      const content = hasOwn(body, 'content')
        ? String(body.content || '').slice(0, 200_000)
        : String(existing?.content || '')
      const coverMediaId = hasOwn(body, 'coverMediaId')
        ? await verifyMediaOwnership(
            env,
            owner.id,
            typeof body.coverMediaId === 'string' ? body.coverMediaId : null
          )
        : existing?.cover_media_id
          ? String(existing.cover_media_id)
          : null
      const allowComments = hasOwn(body, 'allowComments')
        ? Boolean(body.allowComments)
        : existing?.allow_comments === undefined
          ? true
          : Boolean(Number(existing.allow_comments))
      const updatedAt = Date.now()

      await env.DB.prepare(
        'INSERT INTO blog_pages (slug, user_id, title, subtitle, content, cover_media_id, allow_comments, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(user_id, slug) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle, content = excluded.content, cover_media_id = excluded.cover_media_id, allow_comments = excluded.allow_comments, updated_at = excluded.updated_at'
      )
        .bind(
          slug,
          owner.id,
          title,
          subtitle,
          content,
          coverMediaId,
          allowComments ? 1 : 0,
          updatedAt
        )
        .run()

      if (existing) {
        const nextIds = new Set(
          [coverMediaId || '', ...extractBlogMediaIdsFromText(content)].filter(Boolean)
        )
        const removedIds = [
          existing.cover_media_id ? String(existing.cover_media_id) : '',
          ...extractBlogMediaIdsFromText(existing.content)
        ].filter((id) => id && !nextIds.has(id))
        if (removedIds.length) {
          scheduleMediaCleanup(owner.id, removedIds)
        }
      }

      return json(await loadPageData(env, owner.id, slug, blogMediaUrl))
    }
  }

  const pageCommentDeleteMatch = path.match(/^\/api\/blog\/page-comments\/([^/]+)$/)
  if (pageCommentDeleteMatch && method === 'DELETE') {
    const owner = requireOwner(auth)
    const commentId = decodeURIComponent(pageCommentDeleteMatch[1])
    const existing = await env.DB.prepare(
      'SELECT id FROM blog_page_comments WHERE id = ? AND user_id = ?'
    )
      .bind(commentId, owner.id)
      .first<Row>()
    if (!existing) throw new ApiError(404, '留言不存在')
    await env.DB.prepare('DELETE FROM blog_page_comments WHERE id = ? AND user_id = ?')
      .bind(commentId, owner.id)
      .run()
    return json({ ok: true })
  }

  // --- 3. Catalog (/equipment & /labs) ---
  if (path === '/api/blog/catalog' && method === 'POST') {
    const owner = requireOwner(auth)
    const body = await readJson(request)
    const section = validateCatalogSection(body.section)
    const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!title) throw new ApiError(400, '请输入名称')

    const category =
      String(body.category || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '默认'
    const subtitle = String(body.subtitle || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const description = String(body.description || '').trim().slice(0, 5000)
    const imageMediaId = await verifyMediaOwnership(
      env,
      owner.id,
      typeof body.imageMediaId === 'string' ? body.imageMediaId : null
    )
    const explicitImageUrl = sanitizeSafeAssetOrHttpUrl(body.imageUrl, sanitizeWebsiteUrl)
    const imageUrl = explicitImageUrl || (imageMediaId ? blogMediaUrl(imageMediaId) : null)

    const rawLinkUrl = String(body.linkUrl || '').trim()
    const linkUrl = sanitizeSafeAssetOrHttpUrl(rawLinkUrl, sanitizeWebsiteUrl)
    if (rawLinkUrl && !linkUrl) {
      throw new ApiError(400, '链接地址格式无效，请使用 http://、https:// 或站内相对路径')
    }

    const tag = String(body.tag || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const sortRaw = numberOrNull(body.sortOrder)
    const sortOrder = sortRaw !== null ? Math.round(sortRaw) : 0
    const id = crypto.randomUUID()
    const now = Date.now()

    await env.DB.prepare(
      'INSERT INTO blog_catalog_items (id, user_id, section, category, title, subtitle, description, image_media_id, image_url, link_url, tag, sort_order, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        id,
        owner.id,
        section,
        category,
        title,
        subtitle,
        description,
        imageMediaId,
        imageUrl,
        linkUrl,
        tag,
        sortOrder,
        now,
        now
      )
      .run()

    const created = await env.DB.prepare(
      'SELECT * FROM blog_catalog_items WHERE id = ? AND user_id = ?'
    )
      .bind(id, owner.id)
      .first<Row>()
    if (!created) throw new ApiError(500, '创建条目失败')
    return json(serializeCatalogItem(created, blogMediaUrl), 201)
  }

  const catalogMatch = path.match(/^\/api\/blog\/catalog\/([^/]+)$/)
  if (catalogMatch) {
    const param = decodeURIComponent(catalogMatch[1])

    if (method === 'GET') {
      const section = validateCatalogSection(param)
      if (!auth.owner) return json({ items: [] as BlogCatalogItem[] })
      const res = await env.DB.prepare(
        'SELECT * FROM blog_catalog_items WHERE user_id = ? AND section = ? ORDER BY sort_order ASC, created_at DESC'
      )
        .bind(auth.owner.id, section)
        .all<Row>()
      return json({ items: res.results.map((r) => serializeCatalogItem(r, blogMediaUrl)) })
    }

    if (method === 'PATCH') {
      const owner = requireOwner(auth)
      const existing = await env.DB.prepare(
        'SELECT * FROM blog_catalog_items WHERE id = ? AND user_id = ?'
      )
        .bind(param, owner.id)
        .first<Row>()
      if (!existing) throw new ApiError(404, '条目不存在')

      const body = await readJson(request)
      const fields: string[] = []
      const values: Array<string | number | null> = []

      if (hasOwn(body, 'section')) {
        fields.push('section = ?')
        values.push(validateCatalogSection(body.section))
      }
      if (hasOwn(body, 'category')) {
        fields.push('category = ?')
        values.push(
          String(body.category || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '默认'
        )
      }
      if (hasOwn(body, 'title')) {
        const nextTitle = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 160)
        if (!nextTitle) throw new ApiError(400, '请输入名称')
        fields.push('title = ?')
        values.push(nextTitle)
      }
      if (hasOwn(body, 'subtitle')) {
        fields.push('subtitle = ?')
        values.push(String(body.subtitle || '').replace(/\s+/g, ' ').trim().slice(0, 200))
      }
      if (hasOwn(body, 'description')) {
        fields.push('description = ?')
        values.push(String(body.description || '').trim().slice(0, 5000))
      }
      if (hasOwn(body, 'imageMediaId')) {
        const nextImageMediaId = await verifyMediaOwnership(
          env,
          owner.id,
          typeof body.imageMediaId === 'string' ? body.imageMediaId : null
        )
        fields.push('image_media_id = ?')
        values.push(nextImageMediaId)
        if (!hasOwn(body, 'imageUrl')) {
          fields.push('image_url = ?')
          values.push(nextImageMediaId ? blogMediaUrl(nextImageMediaId) : null)
        }
      }
      if (hasOwn(body, 'imageUrl')) {
        const rawImageUrl = String(body.imageUrl || '').trim()
        const safeImageUrl = sanitizeSafeAssetOrHttpUrl(rawImageUrl, sanitizeWebsiteUrl)
        if (rawImageUrl && !safeImageUrl) {
          throw new ApiError(400, '图片地址格式无效')
        }
        fields.push('image_url = ?')
        values.push(safeImageUrl || null)
      }
      if (hasOwn(body, 'linkUrl')) {
        const rawLinkUrl = String(body.linkUrl || '').trim()
        const safeLinkUrl = sanitizeSafeAssetOrHttpUrl(rawLinkUrl, sanitizeWebsiteUrl)
        if (rawLinkUrl && !safeLinkUrl) {
          throw new ApiError(400, '链接地址格式无效，请使用 http://、https:// 或站内相对路径')
        }
        fields.push('link_url = ?')
        values.push(safeLinkUrl)
      }
      if (hasOwn(body, 'tag')) {
        fields.push('tag = ?')
        values.push(String(body.tag || '').replace(/\s+/g, ' ').trim().slice(0, 40))
      }
      if (hasOwn(body, 'sortOrder')) {
        const sort = numberOrNull(body.sortOrder)
        fields.push('sort_order = ?')
        values.push(sort !== null ? Math.round(sort) : 0)
      }

      if (fields.length) {
        fields.push('updated_at = ?')
        values.push(Date.now(), param, owner.id)
        await env.DB.prepare(
          `UPDATE blog_catalog_items SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
        )
          .bind(...values)
          .run()
      }

      const updated = await env.DB.prepare(
        'SELECT * FROM blog_catalog_items WHERE id = ? AND user_id = ?'
      )
        .bind(param, owner.id)
        .first<Row>()
      if (!updated) throw new ApiError(404, '条目不存在')

      const nextIds = new Set(
        [
          updated.image_media_id ? String(updated.image_media_id) : '',
          extractMediaIdFromBlogUrl(updated.image_url) || ''
        ].filter(Boolean)
      )
      const removedIds = [
        existing.image_media_id ? String(existing.image_media_id) : '',
        extractMediaIdFromBlogUrl(existing.image_url) || ''
      ].filter((id) => id && !nextIds.has(id))
      if (removedIds.length) {
        scheduleMediaCleanup(owner.id, removedIds)
      }

      return json(serializeCatalogItem(updated, blogMediaUrl))
    }

    if (method === 'DELETE') {
      const owner = requireOwner(auth)
      const existing = await env.DB.prepare(
        'SELECT id, image_media_id, image_url FROM blog_catalog_items WHERE id = ? AND user_id = ?'
      )
        .bind(param, owner.id)
        .first<Row>()
      if (!existing) throw new ApiError(404, '条目不存在')
      await env.DB.prepare('DELETE FROM blog_catalog_items WHERE id = ? AND user_id = ?')
        .bind(param, owner.id)
        .run()
      scheduleMediaCleanup(owner.id, [
        existing.image_media_id ? String(existing.image_media_id) : null,
        extractMediaIdFromBlogUrl(existing.image_url)
      ])
      return json({ ok: true })
    }
  }

  // --- 4. Friend Links (/friends) ---
  if (path === '/api/blog/friends' && method === 'GET') {
    if (!auth.owner) return json({ friends: [] as BlogFriend[] })
    const res = await env.DB.prepare(
      'SELECT * FROM blog_friends WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC'
    )
      .bind(auth.owner.id)
      .all<Row>()
    return json({ friends: res.results.map((r) => serializeFriend(r, blogMediaUrl)) })
  }

  if (path === '/api/blog/friends' && method === 'POST') {
    const owner = requireOwner(auth)
    const body = await readJson(request)
    const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!name) throw new ApiError(400, '请输入友链名称')

    const friendUrl = sanitizeWebsiteUrl(body.url)
    if (!friendUrl) throw new ApiError(400, '请输入有效的 http:// 或 https:// 友链地址')

    const avatarMediaId = await verifyMediaOwnership(
      env,
      owner.id,
      typeof body.avatarMediaId === 'string' ? body.avatarMediaId : null
    )
    const rawAvatarUrl = String(body.avatarUrl || '').trim()
    const explicitAvatarUrl = sanitizeSafeAssetOrHttpUrl(rawAvatarUrl, sanitizeWebsiteUrl)
    if (rawAvatarUrl && !explicitAvatarUrl) {
      throw new ApiError(400, '头像地址格式无效')
    }
    const avatarUrl = explicitAvatarUrl || (avatarMediaId ? blogMediaUrl(avatarMediaId) : '')

    const description = String(body.description || '').trim().slice(0, 500)
    const sortRaw = numberOrNull(body.sortOrder)
    const sortOrder = sortRaw !== null ? Math.round(sortRaw) : 0
    const id = crypto.randomUUID()
    const now = Date.now()

    await env.DB.prepare(
      'INSERT INTO blog_friends (id, user_id, name, url, avatar_url, avatar_media_id, description, sort_order, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        id,
        owner.id,
        name,
        friendUrl,
        avatarUrl,
        avatarMediaId,
        description,
        sortOrder,
        now,
        now
      )
      .run()

    const created = await env.DB.prepare(
      'SELECT * FROM blog_friends WHERE id = ? AND user_id = ?'
    )
      .bind(id, owner.id)
      .first<Row>()
    if (!created) throw new ApiError(500, '添加友链失败')
    return json(serializeFriend(created, blogMediaUrl), 201)
  }

  const friendMatch = path.match(/^\/api\/blog\/friends\/([^/]+)$/)
  if (friendMatch) {
    const friendId = decodeURIComponent(friendMatch[1])

    if (method === 'PATCH') {
      const owner = requireOwner(auth)
      const existing = await env.DB.prepare(
        'SELECT * FROM blog_friends WHERE id = ? AND user_id = ?'
      )
        .bind(friendId, owner.id)
        .first<Row>()
      if (!existing) throw new ApiError(404, '友链不存在')

      const body = await readJson(request)
      const fields: string[] = []
      const values: Array<string | number | null> = []

      if (hasOwn(body, 'name')) {
        const nextName = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        if (!nextName) throw new ApiError(400, '请输入友链名称')
        fields.push('name = ?')
        values.push(nextName)
      }
      if (hasOwn(body, 'url')) {
        const nextUrl = sanitizeWebsiteUrl(body.url)
        if (!nextUrl) throw new ApiError(400, '请输入有效的 http:// 或 https:// 友链地址')
        fields.push('url = ?')
        values.push(nextUrl)
      }
      if (hasOwn(body, 'avatarMediaId')) {
        const nextAvatarMediaId = await verifyMediaOwnership(
          env,
          owner.id,
          typeof body.avatarMediaId === 'string' ? body.avatarMediaId : null
        )
        fields.push('avatar_media_id = ?')
        values.push(nextAvatarMediaId)
        if (!hasOwn(body, 'avatarUrl')) {
          fields.push('avatar_url = ?')
          values.push(nextAvatarMediaId ? blogMediaUrl(nextAvatarMediaId) : '')
        }
      }
      if (hasOwn(body, 'avatarUrl')) {
        const rawAvatarUrl = String(body.avatarUrl || '').trim()
        const safeAvatarUrl = sanitizeSafeAssetOrHttpUrl(rawAvatarUrl, sanitizeWebsiteUrl)
        if (rawAvatarUrl && !safeAvatarUrl) {
          throw new ApiError(400, '头像地址格式无效')
        }
        fields.push('avatar_url = ?')
        values.push(safeAvatarUrl)
      }
      if (hasOwn(body, 'description')) {
        fields.push('description = ?')
        values.push(String(body.description || '').trim().slice(0, 500))
      }
      if (hasOwn(body, 'sortOrder')) {
        const sort = numberOrNull(body.sortOrder)
        fields.push('sort_order = ?')
        values.push(sort !== null ? Math.round(sort) : 0)
      }

      if (fields.length) {
        fields.push('updated_at = ?')
        values.push(Date.now(), friendId, owner.id)
        await env.DB.prepare(
          `UPDATE blog_friends SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
        )
          .bind(...values)
          .run()
      }

      const updated = await env.DB.prepare(
        'SELECT * FROM blog_friends WHERE id = ? AND user_id = ?'
      )
        .bind(friendId, owner.id)
        .first<Row>()
      if (!updated) throw new ApiError(404, '友链不存在')

      const nextIds = new Set(
        [
          updated.avatar_media_id ? String(updated.avatar_media_id) : '',
          extractMediaIdFromBlogUrl(updated.avatar_url) || ''
        ].filter(Boolean)
      )
      const removedIds = [
        existing.avatar_media_id ? String(existing.avatar_media_id) : '',
        extractMediaIdFromBlogUrl(existing.avatar_url) || ''
      ].filter((id) => id && !nextIds.has(id))
      if (removedIds.length) {
        scheduleMediaCleanup(owner.id, removedIds)
      }

      return json(serializeFriend(updated, blogMediaUrl))
    }

    if (method === 'DELETE') {
      const owner = requireOwner(auth)
      const existing = await env.DB.prepare(
        'SELECT id, avatar_media_id, avatar_url FROM blog_friends WHERE id = ? AND user_id = ?'
      )
        .bind(friendId, owner.id)
        .first<Row>()
      if (!existing) throw new ApiError(404, '友链不存在')
      await env.DB.prepare('DELETE FROM blog_friends WHERE id = ? AND user_id = ?')
        .bind(friendId, owner.id)
        .run()
      scheduleMediaCleanup(owner.id, [
        existing.avatar_media_id ? String(existing.avatar_media_id) : null,
        extractMediaIdFromBlogUrl(existing.avatar_url)
      ])
      return json({ ok: true })
    }
  }

  return null
}
