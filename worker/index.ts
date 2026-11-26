import { generateAiPosterCover, listAiModels, maskApiKey } from './ai-cover'
import {
  applyGlobalSecurityHeaders,
  collectReferencedBlogMediaIds,
  handleBlogApi,
  matchBlogHtmlRoute,
  MEDIA_SECURITY_HEADERS,
  renderBlogOgHeadHtml,
  resolveBlogOgMeta,
  runBlogMediaGc
} from './blog'
import { detectImageMime, fetchImage, fetchPageMetadata, normalizeUrl } from './metadata'
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionToken,
  hashPassword,
  hashToken,
  isValidEmail,
  normalizeEmail,
  parseCookie,
  validatePassword,
  verifyPassword
} from './security'
import {
  ALLOWED_IMAGE_TYPES,
  ApiError,
  DEFAULT_CATEGORIES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_ITEM,
  SESSION_COOKIE,
  SESSION_DURATION_MS,
  type Env
} from './types'

type Row = Record<string, unknown>
type ItemKind = 'link' | 'text' | 'image_group'
type AssetRole = 'web_cover' | 'attachment' | 'gallery'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024

const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const lastTrashPurge = new Map<string, number>()

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
  return value === null || value === undefined ? null : Number(value)
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

function requiredTitle(value: unknown, fallback = ''): string {
  const title = String(value || fallback).replace(/\s+/g, ' ').trim()
  if (!title) throw new ApiError(400, '请填写标题')
  if (title.length > 300) throw new ApiError(400, '标题不能超过 300 个字符')
  return title
}

function optionalCategory(value: unknown): string | null {
  const id = String(value || '').trim()
  return id || null
}

function categoryColor(value: unknown): string {
  const color = String(value || '').trim()
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ApiError(400, '请选择有效的类别颜色')
  return color.toLowerCase()
}

function clientUuid(value: unknown): string {
  const id = String(value || '').trim()
  return UUID_PATTERN.test(id) ? id : crypto.randomUUID()
}

function clientAssetIds(value: unknown, count: number): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== count) {
      return Array.from({ length: count }, () => crypto.randomUUID())
    }
    return parsed.map((entry) => clientUuid(entry))
  } catch {
    return Array.from({ length: count }, () => crypto.randomUUID())
  }
}

function clientCreatedAt(value: unknown): number {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()
}

function validPlannedFor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const plannedFor = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedFor)) throw new ApiError(400, '计划日期无效')
  return plannedFor
}

function cleanOriginalName(value: string): string {
  const name = value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim()
  return (name || 'image').slice(0, 180)
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/gif') return 'gif'
  return 'webp'
}

function chinaDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp))
}

function checkLoginLimit(ip: string, email: string) {
  const key = `${ip}:${email}`
  const entry = loginAttempts.get(key)
  const now = Date.now()
  if (entry && entry.resetAt > now && entry.count >= 5) {
    throw new ApiError(429, '尝试次数过多，请 15 分钟后再试')
  }
  if (entry && entry.resetAt <= now) loginAttempts.delete(key)
}

function recordLoginFailure(ip: string, email: string) {
  const key = `${ip}:${email}`
  const current = loginAttempts.get(key)
  loginAttempts.set(key, {
    count: current && current.resetAt > Date.now() ? current.count + 1 : 1,
    resetAt: Date.now() + 15 * 60 * 1000
  })
}

async function createSession(env: Env, userId: string, requestUrl: URL): Promise<string> {
  const token = createSessionToken()
  const now = Date.now()
  const idHash = await hashToken(token)
  await env.DB.prepare(
    'INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(idHash, userId, now + SESSION_DURATION_MS, now).run()
  return buildSessionCookie(token, requestUrl)
}

async function clearSession(env: Env, request: Request, requestUrl: URL): Promise<string> {
  const token = parseCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (token) {
    const idHash = await hashToken(token)
    await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(idHash).run()
  }
  return buildClearSessionCookie(requestUrl)
}

async function currentUser(env: Env, request: Request): Promise<{ id: string; email: string } | null> {
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

async function requireUser(env: Env, request: Request): Promise<{ id: string; email: string }> {
  const user = await currentUser(env, request)
  if (!user) throw new ApiError(401, '请先登录')
  return user
}

async function ensureCategory(env: Env, userId: string, categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null
  const row = await env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
    .bind(categoryId, userId).first<Row>()
  if (!row) throw new ApiError(400, '所选类别不存在')
  return categoryId
}

function serializeAsset(asset: Row) {
  const id = String(asset.id)
  return {
    id,
    role: String(asset.role) as AssetRole,
    originalName: String(asset.original_name),
    mimeType: String(asset.mime_type),
    size: Number(asset.size),
    width: numberOrNull(asset.width),
    height: numberOrNull(asset.height),
    sortOrder: Number(asset.sort_order),
    thumbUrl: `/api/assets/${encodeURIComponent(id)}?variant=thumb`,
    originalUrl: `/api/assets/${encodeURIComponent(id)}?variant=original`
  }
}

function assembleItem(
  row: Row,
  categoryMap: Map<string, { id: string; name: string; color: string }>,
  assetsByItem: Map<string, Row[]>
) {
  const id = String(row.id)
  const catId = row.category_id ? String(row.category_id) : null
  const assets = (assetsByItem.get(id) || []).slice().sort((a, b) => {
    const roleOrder = (r: string) => (r === 'web_cover' ? 0 : r === 'gallery' ? 1 : 2)
    return (
      roleOrder(String(a.role)) - roleOrder(String(b.role)) ||
      Number(a.sort_order) - Number(b.sort_order) ||
      Number(a.created_at) - Number(b.created_at)
    )
  })
  return {
    id,
    kind: String(row.kind) as ItemKind,
    title: String(row.title),
    url: row.url ? String(row.url) : null,
    status: String(row.status) as 'pending' | 'completed',
    category: catId ? categoryMap.get(catId) || null : null,
    assets: assets.map(serializeAsset),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: numberOrNull(row.completed_at),
    isStarred: Boolean(Number(row.is_starred || 0)),
    plannedFor: row.planned_for ? String(row.planned_for) : null,
    trashedAt: numberOrNull(row.trashed_at)
  }
}

async function getItem(env: Env, userId: string, itemId: string) {
  const [itemRes, catRes, assetRes] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, userId),
    env.DB.prepare('SELECT id, name, color FROM categories WHERE user_id = ?').bind(userId),
    env.DB.prepare('SELECT * FROM assets WHERE item_id = ? AND user_id = ?').bind(itemId, userId)
  ])
  const row = (itemRes.results as Row[])[0]
  if (!row) return null
  const catMap = new Map<string, { id: string; name: string; color: string }>()
  for (const cat of catRes.results as Row[]) {
    catMap.set(String(cat.id), { id: String(cat.id), name: String(cat.name), color: String(cat.color) })
  }
  const assetsByItem = new Map<string, Row[]>([[itemId, assetRes.results as Row[]]])
  return assembleItem(row, catMap, assetsByItem)
}

async function listItems(env: Env, userId: string, params: URLSearchParams) {
  const [itemsRes, catRes, assetRes] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC, id DESC').bind(userId),
    env.DB.prepare('SELECT id, name, color FROM categories WHERE user_id = ?').bind(userId),
    env.DB.prepare('SELECT * FROM assets WHERE user_id = ?').bind(userId)
  ])
  const catMap = new Map<string, { id: string; name: string; color: string }>()
  for (const cat of catRes.results as Row[]) {
    catMap.set(String(cat.id), { id: String(cat.id), name: String(cat.name), color: String(cat.color) })
  }
  const assetsByItem = new Map<string, Row[]>()
  for (const asset of assetRes.results as Row[]) {
    const itemId = String(asset.item_id)
    const list = assetsByItem.get(itemId)
    if (list) list.push(asset)
    else assetsByItem.set(itemId, [asset])
  }

  const trash = params.get('trash') || 'active'
  const status = params.get('status')
  const kind = params.get('kind')
  const category = params.get('category')
  const date = params.get('date')
  const priority = params.get('priority')
  const needle = (params.get('q') || '').trim().toLocaleLowerCase('zh-CN')
  const sort = params.get('sort') || 'smart'
  const today = chinaDate(Date.now())

  const filtered = (itemsRes.results as Row[]).filter((row) => {
    const trashed = row.trashed_at !== null && row.trashed_at !== undefined
    if (trash === 'active' && trashed) return false
    if (trash === 'only' && !trashed) return false
    if ((status === 'pending' || status === 'completed') && row.status !== status) return false
    if ((kind === 'link' || kind === 'text' || kind === 'image_group') && row.kind !== kind) return false
    if (category === 'uncategorized' && row.category_id) return false
    if (category && category !== 'uncategorized' && String(row.category_id || '') !== category) return false
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && chinaDate(Number(row.created_at)) !== date) return false
    if (priority === 'planned' && !row.planned_for) return false
    if (priority === 'starred' && !Number(row.is_starred || 0)) return false
    if (needle) {
      const cat = row.category_id ? catMap.get(String(row.category_id)) : null
      const assets = assetsByItem.get(String(row.id)) || []
      const haystacks = [
        String(row.title || ''),
        String(row.url || ''),
        cat?.name || '',
        ...assets.map((a) => String(a.original_name || ''))
      ]
      if (!haystacks.some((val) => val.toLocaleLowerCase('zh-CN').includes(needle))) return false
    }
    return true
  })

  filtered.sort((left, right) => {
    const lCreated = Number(left.created_at)
    const rCreated = Number(right.created_at)
    if (sort === 'oldest') return lCreated - rCreated
    if (sort === 'recently_completed') {
      return Number(right.completed_at || 0) - Number(left.completed_at || 0) || rCreated - lCreated
    }
    if (sort === 'planned_date') {
      const lPlan = left.planned_for ? String(left.planned_for) : '9999-12-31'
      const rPlan = right.planned_for ? String(right.planned_for) : '9999-12-31'
      return lPlan.localeCompare(rPlan) || rCreated - lCreated
    }
    if (sort === 'newest') return rCreated - lCreated
    const rank = (r: Row) => {
      const p = r.planned_for ? String(r.planned_for) : null
      if (p && p < today) return 0
      if (p === today) return 1
      if (Number(r.is_starred || 0)) return 2
      return 3
    }
    const diff = rank(left) - rank(right)
    if (diff) return diff
    if (rank(left) <= 1) return lCreated - rCreated
    return rCreated - lCreated
  })

  return filtered.map((row) => assembleItem(row, catMap, assetsByItem))
}

async function deleteR2Keys(env: Env, keys: string[]) {
  const unique = [...new Set(keys.filter(Boolean))]
  if (!unique.length) return
  for (let i = 0; i < unique.length; i += 500) {
    await env.IMAGES.delete(unique.slice(i, i + 500))
  }
}

function chunkIds<T>(items: T[], size = 80): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

async function permanentlyDeleteItems(env: Env, userId: string, itemIds: string[]): Promise<number> {
  const ids = [...new Set(itemIds)].filter(Boolean)
  if (!ids.length) return 0
  const owned: string[] = []
  for (const batch of chunkIds(ids)) {
    const placeholders = batch.map(() => '?').join(',')
    const ownedRes = await env.DB.prepare(
      `SELECT id FROM items WHERE user_id = ? AND id IN (${placeholders})`
    ).bind(userId, ...batch).all<Row>()
    owned.push(...ownedRes.results.map((r) => String(r.id)))
  }
  if (!owned.length) return 0

  const keys: string[] = []
  for (const batch of chunkIds(owned)) {
    const ph = batch.map(() => '?').join(',')
    const assetsRes = await env.DB.prepare(
      `SELECT original_key, thumb_key FROM assets WHERE user_id = ? AND item_id IN (${ph})`
    ).bind(userId, ...batch).all<Row>()
    keys.push(...assetsRes.results.flatMap((a) => [String(a.original_key || ''), String(a.thumb_key || '')]))
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM assets WHERE user_id = ? AND item_id IN (${ph})`).bind(userId, ...batch),
      env.DB.prepare(`DELETE FROM items WHERE user_id = ? AND id IN (${ph})`).bind(userId, ...batch)
    ])
  }

  await deleteR2Keys(env, keys)
  return owned.length
}

async function purgeExpiredTrash(env: Env, userId: string) {
  const now = Date.now()
  const last = lastTrashPurge.get(userId) || 0
  if (now - last < 10 * 60 * 1000) return
  lastTrashPurge.set(userId, now)
  const cutoff = now - TRASH_RETENTION_MS
  const expired = await env.DB.prepare(
    'SELECT id FROM items WHERE user_id = ? AND trashed_at IS NOT NULL AND trashed_at <= ?'
  ).bind(userId, cutoff).all<Row>()
  if (expired.results.length) {
    await permanentlyDeleteItems(env, userId, expired.results.map((r) => String(r.id)))
  }
}

interface ImageDimension {
  width?: number | null
  height?: number | null
}

function parseImageMeta(raw: FormDataEntryValue | null): ImageDimension[] {
  if (!raw || typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

interface StoredAssetRecord {
  id: string
  itemId: string
  userId: string
  role: AssetRole
  originalName: string
  originalKey: string
  thumbKey: string
  mimeType: string
  thumbMimeType: string
  size: number
  width: number | null
  height: number | null
  sortOrder: number
  createdAt: number
}

async function uploadImageToR2(
  env: Env,
  input: {
    assetId: string
    itemId: string
    userId: string
    role: AssetRole
    sortOrder: number
    file: File
    thumbFile?: File | null
    width?: number | null
    height?: number | null
  }
): Promise<StoredAssetRecord> {
  if (!input.file.size) throw new ApiError(400, '图片内容为空')
  if (input.file.size > MAX_IMAGE_BYTES) throw new ApiError(400, '单张图片不能超过 20 MB')
  const bytes = new Uint8Array(await input.file.arrayBuffer())
  const detectedMime = detectImageMime(bytes)
  if (!detectedMime || !ALLOWED_IMAGE_TYPES.has(detectedMime)) {
    throw new ApiError(400, '只支持 PNG、JPEG、WebP 和 GIF 图片')
  }

  const ext = extensionFor(detectedMime)
  const originalKey = `library/${input.userId}/${input.assetId}/original.${ext}`
  let thumbKey = originalKey
  let thumbMimeType = detectedMime

  const uploads: Promise<unknown>[] = [
    env.IMAGES.put(originalKey, bytes, {
      httpMetadata: { contentType: detectedMime, cacheControl: 'private, max-age=31536000, immutable' }
    })
  ]

  if (detectedMime !== 'image/gif' && input.thumbFile && input.thumbFile.size > 0 && input.thumbFile.size <= 5 * 1024 * 1024) {
    const thumbBytes = new Uint8Array(await input.thumbFile.arrayBuffer())
    const detectedThumb = detectImageMime(thumbBytes)
    if (detectedThumb) {
      thumbKey = `library/${input.userId}/${input.assetId}/thumb.${extensionFor(detectedThumb)}`
      thumbMimeType = detectedThumb
      uploads.push(
        env.IMAGES.put(thumbKey, thumbBytes, {
          httpMetadata: { contentType: detectedThumb, cacheControl: 'private, max-age=31536000, immutable' }
        })
      )
    }
  }

  await Promise.all(uploads)

  return {
    id: input.assetId,
    itemId: input.itemId,
    userId: input.userId,
    role: input.role,
    originalName: cleanOriginalName(input.file.name || 'image'),
    originalKey,
    thumbKey,
    mimeType: detectedMime,
    thumbMimeType,
    size: bytes.byteLength,
    width: typeof input.width === 'number' && Number.isFinite(input.width) ? Math.round(input.width) : null,
    height: typeof input.height === 'number' && Number.isFinite(input.height) ? Math.round(input.height) : null,
    sortOrder: input.sortOrder,
    createdAt: Date.now()
  }
}

function insertAssetStatement(env: Env, asset: StoredAssetRecord) {
  return env.DB.prepare(
    'INSERT INTO assets (id, item_id, user_id, role, original_name, original_key, thumb_key, mime_type, thumb_mime_type, size, width, height, sort_order, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    asset.id,
    asset.itemId,
    asset.userId,
    asset.role,
    asset.originalName,
    asset.originalKey,
    asset.thumbKey,
    asset.mimeType,
    asset.thumbMimeType,
    asset.size,
    asset.width,
    asset.height,
    asset.sortOrder,
    asset.createdAt
  )
}

function assertItemVersion(raw: Row, body?: Record<string, unknown> | FormData) {
  if (!body) return
  const rawVal = body instanceof FormData ? body.get('baseUpdatedAt') : body.baseUpdatedAt
  if (rawVal === null || rawVal === undefined || rawVal === '') return
  const expected = Number(rawVal)
  if (!Number.isFinite(expected)) return
  if (Number(raw.updated_at) !== expected) {
    throw new ApiError(409, '云端条目已在其他设备更新，请选择保留云端或使用本机版本', { conflict: true })
  }
}

function itemChangesAlreadyApplied(raw: Row, body: Record<string, unknown>): boolean {
  let compared = 0
  const nullable = (value: unknown) => String(value || '') || null
  const boolVal = (value: unknown) => Boolean(Number(value) || value === true)
  const compare = (key: string, current: unknown, norm: (v: unknown) => unknown = (v) => v) => {
    if (!hasOwn(body, key)) return true
    compared += 1
    return norm(current) === norm(body[key])
  }
  return (
    compare('title', raw.title, String) &&
    compare('url', raw.url, nullable) &&
    compare('status', raw.status, String) &&
    compare('categoryId', raw.category_id, nullable) &&
    compare('isStarred', raw.is_starred, boolVal) &&
    compare('plannedFor', raw.planned_for, nullable) &&
    compared > 0
  )
}

async function buildPatchStatement(
  env: Env,
  userId: string,
  raw: Row,
  body: Record<string, unknown>,
  validatedCategoryId?: string | null
) {
  const fields: string[] = []
  const values: Array<string | number | null> = []

  if (hasOwn(body, 'title')) {
    fields.push('title = ?')
    values.push(requiredTitle(body.title, String(raw.title)))
  }
  if (hasOwn(body, 'categoryId')) {
    fields.push('category_id = ?')
    values.push(
      validatedCategoryId !== undefined
        ? validatedCategoryId
        : await ensureCategory(env, userId, optionalCategory(body.categoryId))
    )
  }
  if (hasOwn(body, 'isStarred')) {
    if (typeof body.isStarred !== 'boolean') throw new ApiError(400, '星标状态无效')
    fields.push('is_starred = ?')
    values.push(body.isStarred ? 1 : 0)
  }
  if (hasOwn(body, 'plannedFor')) {
    fields.push('planned_for = ?')
    values.push(validPlannedFor(body.plannedFor))
  }
  if (hasOwn(body, 'status')) {
    if (body.status !== 'pending' && body.status !== 'completed') throw new ApiError(400, '条目状态无效')
    const nextStatus = body.status
    fields.push('status = ?', 'completed_at = ?')
    values.push(
      nextStatus,
      nextStatus === 'completed'
        ? (String(raw.status) === 'completed' && raw.completed_at ? Number(raw.completed_at) : Date.now())
        : null
    )
    if (nextStatus === 'completed') fields.push('planned_for = NULL')
  }
  if (!fields.length) return null
  fields.push('updated_at = ?')
  values.push(Date.now(), String(raw.id), userId)
  return env.DB.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values)
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const origin = request.headers.get('origin')
    if (origin) {
      try {
        if (new URL(origin).host !== url.host) {
          return json({ error: '请求来源无效' }, 403)
        }
      } catch {
        return json({ error: '请求来源无效' }, 403)
      }
    }
  }

  if (path === '/api/health' && method === 'GET') {
    return json({ ok: true })
  }

  // --- AUTH ---
  if (path === '/api/auth/status' && method === 'GET') {
    const [countRes, user] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<Row>(),
      currentUser(env, request)
    ])
    ctx.waitUntil(env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()).run())
    return json({
      setupRequired: Number(countRes?.count || 0) === 0,
      authenticated: Boolean(user),
      user: user ? { email: user.email } : null
    })
  }

  if (path === '/api/auth/setup' && method === 'POST') {
    const existing = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<Row>()
    if (Number(existing?.count || 0) > 0) throw new ApiError(409, '账号已经创建，不能再次注册')
    const body = await readJson(request)
    const email = normalizeEmail(String(body.email || ''))
    if (!isValidEmail(email)) throw new ApiError(400, '请输入有效的邮箱地址')
    const password = String(body.password || '')
    const passwordError = validatePassword(password)
    if (passwordError) throw new ApiError(400, passwordError)

    const passwordHash = await hashPassword(password)
    const userId = crypto.randomUUID()
    const now = Date.now()
    const statements: D1PreparedStatement[] = [
      env.DB.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .bind(userId, email, passwordHash, now)
    ]
    let defaultCategoryId: string | null = null
    DEFAULT_CATEGORIES.forEach((cat, index) => {
      const catId = crypto.randomUUID()
      statements.push(
        env.DB.prepare('INSERT INTO categories (id, user_id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(catId, userId, cat.name, cat.color, index, now)
      )
      if (cat.name === '其他') defaultCategoryId = catId
    })
    statements.push(
      env.DB.prepare('INSERT INTO user_preferences (user_id, quick_save_category_id, updated_at) VALUES (?, ?, ?)')
        .bind(userId, defaultCategoryId, now)
    )
    await env.DB.batch(statements)
    const cookie = await createSession(env, userId, url)
    return json({ email }, 201, { 'set-cookie': cookie })
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readJson(request)
    const email = normalizeEmail(String(body.email || ''))
    const password = String(body.password || '')
    const ip = request.headers.get('cf-connecting-ip') || 'local'
    checkLoginLimit(ip, email)
    const user = await env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
      .bind(email).first<Row>()
    if (!user || !(await verifyPassword(password, String(user.password_hash)))) {
      recordLoginFailure(ip, email)
      throw new ApiError(401, '邮箱或密码不正确')
    }
    loginAttempts.delete(`${ip}:${email}`)
    await clearSession(env, request, url)
    const cookie = await createSession(env, String(user.id), url)
    return json({ email: String(user.email) }, 200, { 'set-cookie': cookie })
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const cookie = await clearSession(env, request, url)
    return json({ ok: true }, 200, { 'set-cookie': cookie })
  }

  if (path === '/api/auth/change-password' && method === 'POST') {
    const user = await requireUser(env, request)
    const body = await readJson(request)
    const currentPassword = String(body.currentPassword || '')
    const newPassword = String(body.newPassword || '')
    const err = validatePassword(newPassword)
    if (err) throw new ApiError(400, err)
    const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<Row>()
    if (!row || !(await verifyPassword(currentPassword, String(row.password_hash)))) {
      throw new ApiError(401, '当前密码不正确')
    }
    const nextHash = await hashPassword(newPassword)
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(nextHash, user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id)
    ])
    const cookie = await createSession(env, user.id, url)
    return json({ ok: true }, 200, { 'set-cookie': cookie })
  }

  if (path === '/api/blog' || path.startsWith('/api/blog/')) {
    return handleBlogApi(request, env, ctx)
  }

  // All routes below require authentication
  const user = await requireUser(env, request)

  // --- METADATA ---
  if (path === '/api/metadata' && method === 'POST') {
    const body = await readJson(request)
    try {
      const metadata = await fetchPageMetadata(String(body.url || ''))
      return json(metadata)
    } catch (error) {
      throw new ApiError(422, error instanceof Error ? error.message : '无法读取网页信息')
    }
  }

  // --- CATEGORIES ---
  if (path === '/api/categories' && method === 'GET') {
    const res = await env.DB.prepare(
      'SELECT id, name, color, sort_order, cover_prompt FROM categories WHERE user_id = ? ORDER BY sort_order, name COLLATE NOCASE'
    ).bind(user.id).all<Row>()
    return json(res.results.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      color: String(r.color),
      sort_order: Number(r.sort_order || 0),
      coverPrompt: r.cover_prompt ? String(r.cover_prompt) : ''
    })))
  }

  if (path === '/api/categories' && method === 'POST') {
    const body = await readJson(request)
    const name = requiredTitle(body.name).slice(0, 40)
    const color = categoryColor(body.color || '#64748b')
    const coverPrompt = String(body.coverPrompt || '').trim().slice(0, 600) || null
    const id = clientUuid(body.id)
    const existing = await env.DB.prepare('SELECT id, name, color, sort_order, cover_prompt FROM categories WHERE id = ? AND user_id = ?')
      .bind(id, user.id).first<Row>()
    if (existing) {
      return json({
        id: String(existing.id),
        name: String(existing.name),
        color: String(existing.color),
        sort_order: Number(existing.sort_order || 0),
        coverPrompt: existing.cover_prompt ? String(existing.cover_prompt) : ''
      })
    }
    const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM categories WHERE user_id = ?')
      .bind(user.id).first<Row>()
    const nextSortOrder = Number(maxRow?.value ?? -1) + 1
    try {
      await env.DB.prepare(
        'INSERT INTO categories (id, user_id, name, color, sort_order, cover_prompt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, user.id, name, color, nextSortOrder, coverPrompt, Date.now()).run()
    } catch {
      throw new ApiError(409, '已经存在同名类别')
    }
    return json({ id, name, color, sort_order: nextSortOrder, coverPrompt: coverPrompt || '' }, 201)
  }

  const categoryMatch = path.match(/^\/api\/categories\/([^/]+)$/)
  if (categoryMatch) {
    const catId = decodeURIComponent(categoryMatch[1])
    if (method === 'PUT') {
      const body = await readJson(request)
      const name = requiredTitle(body.name).slice(0, 40)
      const color = categoryColor(body.color)
      const hasPrompt = hasOwn(body, 'coverPrompt')
      const coverPrompt = hasPrompt ? (String(body.coverPrompt || '').trim().slice(0, 600) || null) : undefined
      try {
        const result = hasPrompt
          ? await env.DB.prepare('UPDATE categories SET name = ?, color = ?, cover_prompt = ? WHERE id = ? AND user_id = ?')
              .bind(name, color, coverPrompt, catId, user.id).run()
          : await env.DB.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ? AND user_id = ?')
              .bind(name, color, catId, user.id).run()
        if (!result.meta.changes) throw new ApiError(404, '类别不存在')
      } catch (error) {
        if (error instanceof ApiError) throw error
        throw new ApiError(409, '已经存在同名类别')
      }
      const updatedCat = await env.DB.prepare('SELECT id, name, color, sort_order, cover_prompt FROM categories WHERE id = ? AND user_id = ?')
        .bind(catId, user.id).first<Row>()
      return json(updatedCat ? {
        id: String(updatedCat.id),
        name: String(updatedCat.name),
        color: String(updatedCat.color),
        sort_order: Number(updatedCat.sort_order || 0),
        coverPrompt: updatedCat.cover_prompt ? String(updatedCat.cover_prompt) : ''
      } : { id: catId, name, color })
    }
    if (method === 'DELETE') {
      const result = await env.DB.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?')
        .bind(catId, user.id).run()
      if (!result.meta.changes) throw new ApiError(404, '类别不存在')
      return json({ ok: true })
    }
  }

  // --- AI MODELS ---
  if (path === '/api/ai/models' && method === 'POST') {
    const body = await readJson(request)
    const prefs = await env.DB.prepare(
      'SELECT ai_image_api_url, ai_image_api_key FROM user_preferences WHERE user_id = ?'
    ).bind(user.id).first<Row>()
    const apiUrl = String(body.apiUrl || '').trim() || (prefs?.ai_image_api_url ? String(prefs.ai_image_api_url) : '')
    const apiKey = String(body.apiKey || '').trim() || (prefs?.ai_image_api_key ? String(prefs.ai_image_api_key) : '')
    const models = await listAiModels(apiUrl, apiKey)
    return json({ models })
  }

  // --- PREFERENCES ---
  if (path === '/api/preferences' && method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT quick_save_category_id, ai_image_api_url, ai_image_api_key, ai_image_model, ai_cover_auto, ai_cover_style FROM user_preferences WHERE user_id = ?'
    ).bind(user.id).first<Row>()
    const rawKey = row?.ai_image_api_key ? String(row.ai_image_api_key) : ''
    return json({
      quickSaveCategoryId: row?.quick_save_category_id ? String(row.quick_save_category_id) : null,
      aiImageApiUrl: row?.ai_image_api_url ? String(row.ai_image_api_url) : '',
      aiImageApiKeySet: Boolean(rawKey),
      aiImageApiKeyHint: maskApiKey(rawKey),
      aiImageModel: row?.ai_image_model ? String(row.ai_image_model) : '',
      aiCoverAuto: Boolean(Number(row?.ai_cover_auto || 0)),
      aiCoverStyle: row?.ai_cover_style ? String(row.ai_cover_style) : ''
    })
  }

  if (path === '/api/preferences' && method === 'PATCH') {
    const body = await readJson(request)
    const current = await env.DB.prepare(
      'SELECT quick_save_category_id, ai_image_api_url, ai_image_api_key, ai_image_model, ai_cover_auto, ai_cover_style FROM user_preferences WHERE user_id = ?'
    ).bind(user.id).first<Row>()

    const categoryId = hasOwn(body, 'quickSaveCategoryId')
      ? await ensureCategory(env, user.id, optionalCategory(body.quickSaveCategoryId))
      : (current?.quick_save_category_id ? String(current.quick_save_category_id) : null)

    const aiImageApiUrl = hasOwn(body, 'aiImageApiUrl')
      ? String(body.aiImageApiUrl || '').trim().slice(0, 500) || null
      : (current?.ai_image_api_url ? String(current.ai_image_api_url) : null)

    let aiImageApiKey = current?.ai_image_api_key ? String(current.ai_image_api_key) : null
    if (body.clearAiImageApiKey === true) {
      aiImageApiKey = null
    } else if (hasOwn(body, 'aiImageApiKey') && String(body.aiImageApiKey || '').trim()) {
      aiImageApiKey = String(body.aiImageApiKey).trim().slice(0, 500)
    }

    const aiImageModel = hasOwn(body, 'aiImageModel')
      ? String(body.aiImageModel || '').trim().slice(0, 120) || null
      : (current?.ai_image_model ? String(current.ai_image_model) : null)

    const aiCoverAuto = hasOwn(body, 'aiCoverAuto')
      ? (body.aiCoverAuto ? 1 : 0)
      : Number(current?.ai_cover_auto || 0)

    const aiCoverStyle = hasOwn(body, 'aiCoverStyle')
      ? String(body.aiCoverStyle || '').trim().slice(0, 1000) || null
      : (current?.ai_cover_style ? String(current.ai_cover_style) : null)

    await env.DB.prepare(
      'INSERT INTO user_preferences (user_id, quick_save_category_id, ai_image_api_url, ai_image_api_key, ai_image_model, ai_cover_auto, ai_cover_style, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET ' +
      'quick_save_category_id = excluded.quick_save_category_id, ' +
      'ai_image_api_url = excluded.ai_image_api_url, ' +
      'ai_image_api_key = excluded.ai_image_api_key, ' +
      'ai_image_model = excluded.ai_image_model, ' +
      'ai_cover_auto = excluded.ai_cover_auto, ' +
      'ai_cover_style = excluded.ai_cover_style, ' +
      'updated_at = excluded.updated_at'
    ).bind(user.id, categoryId, aiImageApiUrl, aiImageApiKey, aiImageModel, aiCoverAuto, aiCoverStyle, Date.now()).run()

    return json({
      quickSaveCategoryId: categoryId,
      aiImageApiUrl: aiImageApiUrl || '',
      aiImageApiKeySet: Boolean(aiImageApiKey),
      aiImageApiKeyHint: maskApiKey(aiImageApiKey),
      aiImageModel: aiImageModel || '',
      aiCoverAuto: Boolean(aiCoverAuto),
      aiCoverStyle: aiCoverStyle || ''
    })
  }

  // --- STORAGE USAGE ---
  if (path === '/api/storage/usage' && method === 'GET') {
    const [assetsSumRow, blogMediaRes, memoSumRow, memoCanvasRow, referencedMediaIds] =
      await Promise.all([
        env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM assets WHERE user_id = ?')
          .bind(user.id)
          .first<Row>(),
        env.DB.prepare('SELECT id, size FROM blog_media WHERE user_id = ?')
          .bind(user.id)
          .all<Row>(),
        env.DB.prepare(
          'SELECT COALESCE(SUM(size), 0) AS total, COUNT(*) AS count FROM memo_assets WHERE user_id = ?'
        )
          .bind(user.id)
          .first<Row>(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM memo_canvas WHERE user_id = ?')
          .bind(user.id)
          .first<Row>(),
        collectReferencedBlogMediaIds(env, user.id)
      ])

    const libraryAssetsBytes = Number(assetsSumRow?.total || 0)
    const memoAssetsBytes = Number(memoSumRow?.total || 0)
    const legacyMemoCount =
      Number(memoSumRow?.count || 0) + Number(memoCanvasRow?.count || 0)

    let blogMediaBytes = 0
    let orphanBlogMediaCount = 0
    let orphanBlogMediaBytes = 0

    for (const row of blogMediaRes.results) {
      const size = Number(row.size || 0)
      blogMediaBytes += size
      if (!referencedMediaIds.has(String(row.id || ''))) {
        orphanBlogMediaCount += 1
        orphanBlogMediaBytes += size
      }
    }

    const totalBytes = libraryAssetsBytes + blogMediaBytes + memoAssetsBytes

    return json({
      libraryAssetsBytes,
      blogMediaBytes,
      memoAssetsBytes,
      totalBytes,
      quotaBytes: STORAGE_QUOTA_BYTES,
      orphanBlogMediaCount,
      orphanBlogMediaBytes,
      legacyMemoCount
    })
  }

  // --- BACKUP ---
  if (path === '/api/backup/clear' && method === 'POST') {
    const body = await readJson(request)
    if (body.confirmed !== true) throw new ApiError(400, '完整覆盖需要明确确认')
    const [assetsRes, memoAssetsRes] = await env.DB.batch([
      env.DB.prepare('SELECT original_key, thumb_key FROM assets WHERE user_id = ?').bind(user.id),
      env.DB.prepare('SELECT storage_key FROM memo_assets WHERE user_id = ?').bind(user.id)
    ])
    await env.DB.batch([
      env.DB.prepare('DELETE FROM assets WHERE user_id = ?').bind(user.id),
      env.DB.prepare('DELETE FROM items WHERE user_id = ?').bind(user.id),
      env.DB.prepare('DELETE FROM categories WHERE user_id = ?').bind(user.id),
      env.DB.prepare('DELETE FROM memo_canvas WHERE user_id = ?').bind(user.id),
      env.DB.prepare('DELETE FROM memo_assets WHERE user_id = ?').bind(user.id),
      env.DB.prepare('UPDATE user_preferences SET quick_save_category_id = NULL, updated_at = ? WHERE user_id = ?')
        .bind(Date.now(), user.id)
    ])
    const keys = [
      ...(assetsRes.results as Row[]).flatMap((a) => [String(a.original_key || ''), String(a.thumb_key || '')]),
      ...(memoAssetsRes.results as Row[]).map((m) => String(m.storage_key || '')),
      `memo/${user.id}/scene.json`
    ]
    ctx.waitUntil(deleteR2Keys(env, keys))
    return json({ cleared: true })
  }

  if (path === '/api/backup/item' && method === 'POST') {
    const form = await request.formData()
    let item: Record<string, unknown>
    try {
      item = JSON.parse(String(form.get('item') || ''))
    } catch {
      throw new ApiError(400, '备份条目格式无效')
    }
    const itemId = String(item.id || '')
    if (!UUID_PATTERN.test(itemId)) throw new ApiError(400, '备份条目 ID 无效')
    const kind = item.kind as ItemKind
    if (kind !== 'link' && kind !== 'text' && kind !== 'image_group') throw new ApiError(400, '备份条目类型无效')
    const status = item.status === 'completed' ? 'completed' : item.status === 'pending' ? 'pending' : null
    if (!status) throw new ApiError(400, '备份条目状态无效')
    const title = requiredTitle(item.title)
    const createdAt = Number(item.createdAt)
    const updatedAt = Number(item.updatedAt)
    const completedAt = item.completedAt === null || item.completedAt === undefined ? null : Number(item.completedAt)
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) throw new ApiError(400, '备份条目时间无效')
    if (createdAt > Date.now() + 24 * 60 * 60 * 1000 || updatedAt > Date.now() + 24 * 60 * 60 * 1000) {
      throw new ApiError(400, '备份条目时间无效')
    }

    const existing = await env.DB.prepare('SELECT id FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
    if (existing) return json({ status: 'skipped', reason: '备份 ID 已存在' })

    let normalizedUrl: string | null = null
    if (kind === 'link') {
      try {
        normalizedUrl = normalizeUrl(String(item.url || ''))
      } catch {
        throw new ApiError(400, '备份中的网页地址无效')
      }
      const dup = await env.DB.prepare(
        "SELECT id FROM items WHERE user_id = ? AND kind = 'link' AND normalized_url = ?"
      ).bind(user.id, normalizedUrl).first<Row>()
      if (dup) return json({ status: 'skipped', reason: '网址已存在', existingId: String(dup.id) })
    }

    const categoryId = await ensureCategory(env, user.id, optionalCategory(form.get('categoryId')))
    const rawAssets = Array.isArray(item.assets) ? (item.assets as Array<Record<string, unknown>>) : []
    const files = form.getAll('images').filter((v): v is File => v instanceof File)
    const thumbs = form.getAll('thumbs').filter((v): v is File => v instanceof File)
    const meta = parseImageMeta(form.get('imageMeta'))
    const fileAssets = rawAssets.filter((a) => Boolean(a.path))

    if (files.length !== fileAssets.length) throw new ApiError(400, '备份图片数量与清单不一致')
    if (kind === 'image_group' && !files.length) {
      return json({ status: 'skipped', reason: '备份未包含图片组原图' })
    }

    const uploaded: StoredAssetRecord[] = []
    try {
      await Promise.all(
        files.map((file, index) => {
          const assetDef = fileAssets[index]
          return uploadImageToR2(env, {
            assetId: crypto.randomUUID(),
            itemId,
            userId: user.id,
            role: String(assetDef.role || 'gallery') as AssetRole,
            sortOrder: Number(assetDef.sortOrder ?? index),
            file: new File([file], String(assetDef.originalName || file.name || 'image'), { type: file.type }),
            thumbFile: thumbs[index] || null,
            width: meta[index]?.width ?? null,
            height: meta[index]?.height ?? null
          }).then((record) => {
            uploaded.push(record)
            return record
          })
        })
      )
      const statements: D1PreparedStatement[] = [
        env.DB.prepare(
          'INSERT INTO items (id, user_id, kind, title, url, normalized_url, status, category_id, created_at, updated_at, completed_at, is_starred, planned_for, trashed_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          itemId,
          user.id,
          kind,
          title,
          normalizedUrl,
          normalizedUrl,
          status,
          categoryId,
          createdAt,
          updatedAt,
          status === 'completed' ? (completedAt || updatedAt) : null,
          item.isStarred ? 1 : 0,
          status === 'completed' ? null : validPlannedFor(item.plannedFor),
          item.trashedAt ? Date.now() : null
        ),
        ...uploaded.map((asset) => insertAssetStatement(env, asset))
      ]
      await env.DB.batch(statements)
    } catch (error) {
      await deleteR2Keys(env, uploaded.flatMap((a) => [a.originalKey, a.thumbKey]))
      throw error
    }
    return json({ status: 'added' }, 201)
  }

  // --- ITEMS ---
  if (path === '/api/items' && method === 'GET') {
    ctx.waitUntil(purgeExpiredTrash(env, user.id))
    return json(await listItems(env, user.id, url.searchParams))
  }

  if (path === '/api/items/text' && method === 'POST') {
    const body = await readJson(request)
    const itemId = clientUuid(body.id)
    const existing = await env.DB.prepare('SELECT id FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
    if (existing) return json(await getItem(env, user.id, itemId))
    const categoryId = await ensureCategory(env, user.id, optionalCategory(body.categoryId))
    const title = requiredTitle(body.title)
    const createdAt = clientCreatedAt(body.createdAt)
    await env.DB.prepare(
      "INSERT INTO items (id, user_id, kind, title, url, normalized_url, status, category_id, created_at, updated_at, completed_at) VALUES (?, ?, 'text', ?, NULL, NULL, 'pending', ?, ?, ?, NULL)"
    ).bind(itemId, user.id, title, categoryId, createdAt, createdAt).run()
    return json(await getItem(env, user.id, itemId), 201)
  }

  if (path === '/api/items/link' && method === 'POST') {
    const form = await request.formData()
    const itemId = clientUuid(form.get('id'))
    const existing = await env.DB.prepare('SELECT id FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
    if (existing) return json(await getItem(env, user.id, itemId))

    let normalizedUrl: string
    try {
      normalizedUrl = normalizeUrl(String(form.get('url') || ''))
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : '网址无效')
    }
    const dup = await env.DB.prepare(
      "SELECT id, trashed_at FROM items WHERE user_id = ? AND kind = 'link' AND normalized_url = ?"
    ).bind(user.id, normalizedUrl).first<Row>()
    if (dup) {
      throw new ApiError(409, dup.trashed_at ? '这个网页在回收站中' : '这个网页已经保存过了', {
        existingId: String(dup.id),
        trashed: Boolean(dup.trashed_at)
      })
    }

    const categoryId = await ensureCategory(env, user.id, optionalCategory(form.get('categoryId')))
    const fallback = new URL(normalizedUrl).hostname
    const title = requiredTitle(form.get('title'), fallback)
    const files = form.getAll('images').filter((v): v is File => v instanceof File)
    const thumbs = form.getAll('thumbs').filter((v): v is File => v instanceof File)
    const meta = parseImageMeta(form.get('imageMeta'))
    if (files.length > MAX_IMAGES_PER_ITEM) throw new ApiError(400, '每个条目最多保存 30 张图片')
    const assetIds = clientAssetIds(form.get('assetIds'), files.length)
    const createdAt = clientCreatedAt(form.get('createdAt'))

    const uploaded: StoredAssetRecord[] = []
    try {
      if (files.length) {
        const res = await Promise.all(
          files.map((file, idx) =>
            uploadImageToR2(env, {
              assetId: assetIds[idx],
              itemId,
              userId: user.id,
              role: 'attachment',
              sortOrder: idx,
              file,
              thumbFile: thumbs[idx] || null,
              width: meta[idx]?.width ?? null,
              height: meta[idx]?.height ?? null
            })
          )
        )
        uploaded.push(...res)
      }

      const coverUrl = String(form.get('coverUrl') || '').trim()
      if (coverUrl) {
        try {
          const cover = await fetchImage(coverUrl)
          const coverAssetId = crypto.randomUUID()
          const coverKey = `library/${user.id}/${coverAssetId}/original.${extensionFor(cover.mimeType)}`
          await env.IMAGES.put(coverKey, cover.bytes, {
            httpMetadata: { contentType: cover.mimeType, cacheControl: 'private, max-age=31536000, immutable' }
          })
          uploaded.push({
            id: coverAssetId,
            itemId,
            userId: user.id,
            role: 'web_cover',
            originalName: 'web-cover',
            originalKey: coverKey,
            thumbKey: coverKey,
            mimeType: cover.mimeType,
            thumbMimeType: cover.mimeType,
            size: cover.bytes.byteLength,
            width: null,
            height: null,
            sortOrder: 0,
            createdAt: Date.now()
          })
        } catch {
          // Unreadable cover never blocks saving the link.
        }
      }

      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO items (id, user_id, kind, title, url, normalized_url, status, category_id, created_at, updated_at, completed_at) VALUES (?, ?, 'link', ?, ?, ?, 'pending', ?, ?, ?, NULL)"
        ).bind(itemId, user.id, title, normalizedUrl, normalizedUrl, categoryId, createdAt, createdAt),
        ...uploaded.map((asset) => insertAssetStatement(env, asset))
      ])
    } catch (error) {
      await deleteR2Keys(env, uploaded.flatMap((a) => [a.originalKey, a.thumbKey]))
      throw error
    }
    return json(await getItem(env, user.id, itemId), 201)
  }

  if (path === '/api/items/image-group' && method === 'POST') {
    const form = await request.formData()
    const itemId = clientUuid(form.get('id'))
    const existing = await env.DB.prepare('SELECT id FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
    if (existing) return json(await getItem(env, user.id, itemId))
    const files = form.getAll('images').filter((v): v is File => v instanceof File)
    const thumbs = form.getAll('thumbs').filter((v): v is File => v instanceof File)
    const meta = parseImageMeta(form.get('imageMeta'))
    if (!files.length) throw new ApiError(400, '请至少添加一张图片')
    if (files.length > MAX_IMAGES_PER_ITEM) throw new ApiError(400, '每个条目最多保存 30 张图片')
    const categoryId = await ensureCategory(env, user.id, optionalCategory(form.get('categoryId')))
    const title = requiredTitle(form.get('title'), '图片组')
    const assetIds = clientAssetIds(form.get('assetIds'), files.length)
    const createdAt = clientCreatedAt(form.get('createdAt'))

    const uploaded: StoredAssetRecord[] = []
    try {
      const res = await Promise.all(
        files.map((file, idx) =>
          uploadImageToR2(env, {
            assetId: assetIds[idx],
            itemId,
            userId: user.id,
            role: 'gallery',
            sortOrder: idx,
            file,
            thumbFile: thumbs[idx] || null,
            width: meta[idx]?.width ?? null,
            height: meta[idx]?.height ?? null
          })
        )
      )
      uploaded.push(...res)
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO items (id, user_id, kind, title, url, normalized_url, status, category_id, created_at, updated_at, completed_at) VALUES (?, ?, 'image_group', ?, NULL, NULL, 'pending', ?, ?, ?, NULL)"
        ).bind(itemId, user.id, title, categoryId, createdAt, createdAt),
        ...uploaded.map((asset) => insertAssetStatement(env, asset))
      ])
    } catch (error) {
      await deleteR2Keys(env, uploaded.flatMap((a) => [a.originalKey, a.thumbKey]))
      throw error
    }
    return json(await getItem(env, user.id, itemId), 201)
  }

  if (path === '/api/items/bulk' && method === 'POST') {
    const body = await readJson(request)
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))].slice(0, 500) : []
    if (!ids.length) throw new ApiError(400, '请选择至少一个条目')
    const ownedRows: Row[] = []
    for (const batch of chunkIds(ids)) {
      const ph = batch.map(() => '?').join(',')
      const ownedRes = await env.DB.prepare(
        `SELECT * FROM items WHERE user_id = ? AND id IN (${ph})`
      ).bind(user.id, ...batch).all<Row>()
      ownedRows.push(...ownedRes.results)
    }
    const ownedIds = ownedRows.map((r) => String(r.id))

    if (body.permanentDelete === true) {
      const trashed = ownedRows.filter((r) => Boolean(r.trashed_at)).map((r) => String(r.id))
      const deleted = await permanentlyDeleteItems(env, user.id, trashed)
      return json({ updated: 0, deleted, succeededIds: trashed, failed: [] })
    }
    if (body.delete === true || body.restore === true) {
      if (!ownedIds.length) return json({ updated: 0, deleted: 0, succeededIds: ids, failed: [] })
      const trashedAt = body.restore === true ? null : Date.now()
      const now = Date.now()
      const stmts = chunkIds(ownedIds).map((batch) => {
        const ph = batch.map(() => '?').join(',')
        return env.DB.prepare(
          `UPDATE items SET trashed_at = ?, updated_at = ? WHERE user_id = ? AND id IN (${ph})`
        ).bind(trashedAt, now, user.id, ...batch)
      })
      await env.DB.batch(stmts)
      return json({
        updated: body.restore === true ? ownedIds.length : 0,
        deleted: body.delete === true ? ownedIds.length : 0,
        succeededIds: ownedIds,
        failed: []
      })
    }
    if (ownedIds.length !== ids.length) throw new ApiError(404, '部分条目不存在')
    const changes = body.changes && typeof body.changes === 'object' ? (body.changes as Record<string, unknown>) : {}
    let validatedCategoryId: string | null | undefined = undefined
    if (hasOwn(changes, 'categoryId')) {
      validatedCategoryId = await ensureCategory(env, user.id, optionalCategory(changes.categoryId))
    }
    const statements: D1PreparedStatement[] = []
    for (const raw of ownedRows) {
      const stmt = await buildPatchStatement(env, user.id, raw, changes, validatedCategoryId)
      if (stmt) statements.push(stmt)
    }
    if (statements.length) await env.DB.batch(statements)
    return json({ updated: ownedIds.length, deleted: 0, succeededIds: ownedIds, failed: [] })
  }

  if (path === '/api/items/trash/empty' && method === 'POST') {
    const body = await readJson(request)
    if (body.confirmed !== true) throw new ApiError(400, '清空回收站需要明确确认')
    const trashed = await env.DB.prepare(
      'SELECT id FROM items WHERE user_id = ? AND trashed_at IS NOT NULL'
    ).bind(user.id).all<Row>()
    const deleted = await permanentlyDeleteItems(env, user.id, trashed.results.map((r) => String(r.id)))
    return json({ deleted })
  }

  const restoreMatch = path.match(/^\/api\/items\/([^/]+)\/restore$/)
  if (restoreMatch && method === 'POST') {
    const itemId = decodeURIComponent(restoreMatch[1])
    const res = await env.DB.prepare(
      'UPDATE items SET trashed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?'
    ).bind(Date.now(), itemId, user.id).run()
    if (!res.meta.changes) throw new ApiError(404, '条目不存在')
    return json(await getItem(env, user.id, itemId))
  }

  const permanentMatch = path.match(/^\/api\/items\/([^/]+)\/permanent$/)
  if (permanentMatch && method === 'DELETE') {
    const itemId = decodeURIComponent(permanentMatch[1])
    const raw = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
    if (!raw) throw new ApiError(404, '条目不存在')
    if (!raw.trashed_at) throw new ApiError(400, '请先把条目移到回收站')
    assertItemVersion(raw, await readJson(request))
    await permanentlyDeleteItems(env, user.id, [itemId])
    return json({ ok: true })
  }

  const generateCoverMatch = path.match(/^\/api\/items\/([^/]+)\/generate-cover$/)
  if (generateCoverMatch && method === 'POST') {
    const itemId = decodeURIComponent(generateCoverMatch[1])
    const [raw, prefs] = await Promise.all([
      env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>(),
      env.DB.prepare(
        'SELECT ai_image_api_url, ai_image_api_key, ai_image_model, ai_cover_style FROM user_preferences WHERE user_id = ?'
      ).bind(user.id).first<Row>()
    ])
    if (!raw) throw new ApiError(404, '条目不存在')
    const apiUrl = prefs?.ai_image_api_url ? String(prefs.ai_image_api_url) : ''
    const apiKey = prefs?.ai_image_api_key ? String(prefs.ai_image_api_key) : ''
    const model = prefs?.ai_image_model ? String(prefs.ai_image_model) : ''
    const style = prefs?.ai_cover_style ? String(prefs.ai_cover_style) : ''
    if (!apiUrl || !apiKey) {
      throw new ApiError(400, '请先在账号设置中配置生图 API 地址与 API Key')
    }
    let categoryName: string | null = null
    let categoryPrompt: string | null = null
    if (raw.category_id) {
      const catRow = await env.DB.prepare('SELECT name, cover_prompt FROM categories WHERE id = ? AND user_id = ?')
        .bind(String(raw.category_id), user.id).first<Row>()
      categoryName = catRow?.name ? String(catRow.name) : null
      categoryPrompt = catRow?.cover_prompt ? String(catRow.cover_prompt) : null
    }
    const generated = await generateAiPosterCover(
      { apiUrl, apiKey, model, style },
      { title: String(raw.title), url: raw.url ? String(raw.url) : null, categoryName, categoryPrompt }
    )
    const previous = await env.DB.prepare(
      "SELECT original_key, thumb_key FROM assets WHERE item_id = ? AND user_id = ? AND role = 'web_cover'"
    ).bind(itemId, user.id).all<Row>()
    const coverAssetId = crypto.randomUUID()
    const coverKey = `library/${user.id}/${coverAssetId}/original.${extensionFor(generated.mimeType)}`
    await env.IMAGES.put(coverKey, generated.bytes, {
      httpMetadata: { contentType: generated.mimeType, cacheControl: 'private, max-age=31536000, immutable' }
    })
    const record: StoredAssetRecord = {
      id: coverAssetId,
      itemId,
      userId: user.id,
      role: 'web_cover',
      originalName: 'ai-poster-cover',
      originalKey: coverKey,
      thumbKey: coverKey,
      mimeType: generated.mimeType,
      thumbMimeType: generated.mimeType,
      size: generated.bytes.byteLength,
      width: null,
      height: null,
      sortOrder: 0,
      createdAt: Date.now()
    }
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM assets WHERE item_id = ? AND user_id = ? AND role = 'web_cover'").bind(itemId, user.id),
        insertAssetStatement(env, record),
        env.DB.prepare('UPDATE items SET updated_at = ? WHERE id = ? AND user_id = ?').bind(Date.now(), itemId, user.id)
      ])
    } catch (error) {
      await deleteR2Keys(env, [coverKey])
      throw error
    }
    ctx.waitUntil(deleteR2Keys(env, previous.results.flatMap((a) => [String(a.original_key || ''), String(a.thumb_key || '')])))
    return json(await getItem(env, user.id, itemId))
  }

  const coverMatch = path.match(/^\/api\/items\/([^/]+)\/cover$/)
  if (coverMatch && method === 'POST') {
    const itemId = decodeURIComponent(coverMatch[1])
    const raw = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
    if (!raw || String(raw.kind) !== 'link') throw new ApiError(404, '网页条目不存在')
    const body = await readJson(request)
    const coverUrl = String(body.coverUrl || '').trim()
    if (!coverUrl) throw new ApiError(400, '封面地址无效')
    let cover: { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' }
    try {
      cover = await fetchImage(coverUrl)
    } catch {
      throw new ApiError(422, '网页封面无法读取')
    }
    const previous = await env.DB.prepare(
      "SELECT original_key, thumb_key FROM assets WHERE item_id = ? AND user_id = ? AND role = 'web_cover'"
    ).bind(itemId, user.id).all<Row>()
    const coverAssetId = crypto.randomUUID()
    const coverKey = `library/${user.id}/${coverAssetId}/original.${extensionFor(cover.mimeType)}`
    await env.IMAGES.put(coverKey, cover.bytes, {
      httpMetadata: { contentType: cover.mimeType, cacheControl: 'private, max-age=31536000, immutable' }
    })
    const record: StoredAssetRecord = {
      id: coverAssetId,
      itemId,
      userId: user.id,
      role: 'web_cover',
      originalName: 'web-cover',
      originalKey: coverKey,
      thumbKey: coverKey,
      mimeType: cover.mimeType,
      thumbMimeType: cover.mimeType,
      size: cover.bytes.byteLength,
      width: null,
      height: null,
      sortOrder: 0,
      createdAt: Date.now()
    }
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM assets WHERE item_id = ? AND user_id = ? AND role = 'web_cover'").bind(itemId, user.id),
        insertAssetStatement(env, record),
        env.DB.prepare('UPDATE items SET updated_at = ? WHERE id = ? AND user_id = ?').bind(Date.now(), itemId, user.id)
      ])
    } catch (error) {
      await deleteR2Keys(env, [coverKey])
      throw error
    }
    ctx.waitUntil(deleteR2Keys(env, previous.results.flatMap((a) => [String(a.original_key || ''), String(a.thumb_key || '')])))
    return json(await getItem(env, user.id, itemId))
  }

  const assetOrderMatch = path.match(/^\/api\/items\/([^/]+)\/assets\/order$/)
  if (assetOrderMatch && method === 'PUT') {
    const itemId = decodeURIComponent(assetOrderMatch[1])
    const raw = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
    if (!raw) throw new ApiError(404, '条目不存在')
    const body = await readJson(request)
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
    const currentRes = await env.DB.prepare(
      "SELECT id FROM assets WHERE item_id = ? AND user_id = ? AND role <> 'web_cover' ORDER BY sort_order"
    ).bind(itemId, user.id).all<Row>()
    const current = currentRes.results.map((r) => String(r.id))
    if (ids.length === current.length && ids.every((id, idx) => id === current[idx])) {
      return json(await getItem(env, user.id, itemId))
    }
    assertItemVersion(raw, body)
    if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) {
      throw new ApiError(400, '图片顺序无效')
    }
    await env.DB.batch([
      ...ids.map((id, idx) =>
        env.DB.prepare('UPDATE assets SET sort_order = ? WHERE id = ? AND item_id = ? AND user_id = ?')
          .bind(idx, id, itemId, user.id)
      ),
      env.DB.prepare('UPDATE items SET updated_at = ? WHERE id = ? AND user_id = ?').bind(Date.now(), itemId, user.id)
    ])
    return json(await getItem(env, user.id, itemId))
  }

  const itemAssetsMatch = path.match(/^\/api\/items\/([^/]+)\/assets$/)
  if (itemAssetsMatch && method === 'POST') {
    const itemId = decodeURIComponent(itemAssetsMatch[1])
    const raw = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
    if (!raw) throw new ApiError(404, '条目不存在')
    if (String(raw.kind) === 'text') throw new ApiError(400, '文本条目不能添加图片')
    const form = await request.formData()
    const files = form.getAll('images').filter((v): v is File => v instanceof File)
    const thumbs = form.getAll('thumbs').filter((v): v is File => v instanceof File)
    const meta = parseImageMeta(form.get('imageMeta'))
    if (!files.length) throw new ApiError(400, '请选择图片')
    const requestedAssetIds = clientAssetIds(form.get('assetIds'), files.length)
    const currentAssetsRes = await env.DB.prepare(
      'SELECT id, role, sort_order FROM assets WHERE item_id = ? AND user_id = ?'
    ).bind(itemId, user.id).all<Row>()
    const existingIds = new Set(currentAssetsRes.results.map((r) => String(r.id)))
    if (requestedAssetIds.every((id) => existingIds.has(id))) {
      return json(await getItem(env, user.id, itemId))
    }
    assertItemVersion(raw, form)
    const nonCover = currentAssetsRes.results.filter((r) => r.role !== 'web_cover')
    const missingIndices = requestedAssetIds
      .map((id, idx) => ({ id, idx }))
      .filter((entry) => !existingIds.has(entry.id))
    if (nonCover.length + missingIndices.length > MAX_IMAGES_PER_ITEM) {
      throw new ApiError(400, '每个条目最多保存 30 张图片')
    }
    const startOrder = nonCover.reduce((max, r) => Math.max(max, Number(r.sort_order)), -1) + 1
    const role: AssetRole = String(raw.kind) === 'link' ? 'attachment' : 'gallery'
    const uploaded: StoredAssetRecord[] = []
    try {
      const res = await Promise.all(
        missingIndices.map(({ id, idx }, offset) =>
          uploadImageToR2(env, {
            assetId: id,
            itemId,
            userId: user.id,
            role,
            sortOrder: startOrder + offset,
            file: files[idx],
            thumbFile: thumbs[idx] || null,
            width: meta[idx]?.width ?? null,
            height: meta[idx]?.height ?? null
          })
        )
      )
      uploaded.push(...res)
      await env.DB.batch([
        ...uploaded.map((asset) => insertAssetStatement(env, asset)),
        env.DB.prepare('UPDATE items SET updated_at = ? WHERE id = ? AND user_id = ?').bind(Date.now(), itemId, user.id)
      ])
    } catch (error) {
      await deleteR2Keys(env, uploaded.flatMap((a) => [a.originalKey, a.thumbKey]))
      throw error
    }
    return json(await getItem(env, user.id, itemId), 201)
  }

  const itemMatch = path.match(/^\/api\/items\/([^/]+)$/)
  if (itemMatch) {
    const itemId = decodeURIComponent(itemMatch[1])
    if (method === 'GET') {
      const item = await getItem(env, user.id, itemId)
      if (!item) throw new ApiError(404, '条目不存在')
      return json(item)
    }
    if (method === 'DELETE') {
      const raw = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
      if (!raw) throw new ApiError(404, '条目不存在')
      assertItemVersion(raw, await readJson(request))
      if (!raw.trashed_at) {
        const now = Date.now()
        await env.DB.prepare('UPDATE items SET trashed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .bind(now, now, itemId, user.id).run()
      }
      return json({ ok: true, item: await getItem(env, user.id, itemId) })
    }
    if (method === 'PATCH') {
      const raw = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
      if (!raw) throw new ApiError(404, '条目不存在')
      const body = await readJson(request)
      if (itemChangesAlreadyApplied(raw, body)) return json(await getItem(env, user.id, itemId))
      assertItemVersion(raw, body)
      const stmt = await buildPatchStatement(env, user.id, raw, body)
      if (stmt) await stmt.run()
      return json(await getItem(env, user.id, itemId))
    }
    if (method === 'PUT') {
      const raw = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first<Row>()
      if (!raw) throw new ApiError(404, '条目不存在')
      const body = await readJson(request)
      if (itemChangesAlreadyApplied(raw, body)) return json(await getItem(env, user.id, itemId))
      assertItemVersion(raw, body)
      const title = requiredTitle(body.title, String(raw.title))
      const categoryId = await ensureCategory(env, user.id, optionalCategory(body.categoryId))
      const status = body.status === 'completed' ? 'completed' : 'pending'
      let linkUrl = raw.url ? String(raw.url) : null
      let normalizedUrl = raw.normalized_url ? String(raw.normalized_url) : null
      if (String(raw.kind) === 'link') {
        try {
          normalizedUrl = normalizeUrl(String(body.url || raw.url || ''))
          linkUrl = normalizedUrl
        } catch (error) {
          throw new ApiError(400, error instanceof Error ? error.message : '网址无效')
        }
        const dup = await env.DB.prepare(
          "SELECT id FROM items WHERE user_id = ? AND kind = 'link' AND normalized_url = ? AND id <> ?"
        ).bind(user.id, normalizedUrl, itemId).first<Row>()
        if (dup) throw new ApiError(409, '这个网页已经保存过了', { existingId: String(dup.id) })
      }
      const completedAt = status === 'completed'
        ? (String(raw.status) === 'completed' && raw.completed_at ? Number(raw.completed_at) : Date.now())
        : null
      if (hasOwn(body, 'isStarred') && typeof body.isStarred !== 'boolean') {
        throw new ApiError(400, '星标状态无效')
      }
      await env.DB.prepare(
        'UPDATE items SET title = ?, url = ?, normalized_url = ?, status = ?, category_id = ?, updated_at = ?, completed_at = ?, is_starred = ?, planned_for = ? WHERE id = ? AND user_id = ?'
      ).bind(
        title,
        linkUrl,
        normalizedUrl,
        status,
        categoryId,
        Date.now(),
        completedAt,
        hasOwn(body, 'isStarred') ? (body.isStarred ? 1 : 0) : Number(raw.is_starred || 0),
        status === 'completed'
          ? null
          : (hasOwn(body, 'plannedFor') ? validPlannedFor(body.plannedFor) : (raw.planned_for ? String(raw.planned_for) : null)),
        itemId,
        user.id
      ).run()
      return json(await getItem(env, user.id, itemId))
    }
  }

  // --- ASSETS ---
  const assetMatch = path.match(/^\/api\/assets\/([^/]+)$/)
  if (assetMatch) {
    const assetId = decodeURIComponent(assetMatch[1])
    if (method === 'GET') {
      const row = await env.DB.prepare(
        'SELECT original_key, thumb_key, mime_type, thumb_mime_type FROM assets WHERE id = ? AND user_id = ?'
      ).bind(assetId, user.id).first<Row>()
      if (!row) throw new ApiError(404, '图片不存在')
      const original = url.searchParams.get('variant') === 'original'
      const key = String(original ? row.original_key : row.thumb_key)
      const contentType = String(original ? row.mime_type : (row.thumb_mime_type || row.mime_type))
      const obj = await env.IMAGES.get(key, { onlyIf: request.headers })
      if (!obj) throw new ApiError(404, '图片文件不存在')
      const etag = obj.httpEtag
      if (!('body' in obj)) {
        return new Response(null, {
          status: 304,
          headers: {
            etag,
            'cache-control': 'private, max-age=31536000, immutable',
            ...MEDIA_SECURITY_HEADERS
          }
        })
      }
      return new Response(obj.body, {
        headers: {
          'content-type': contentType,
          'cache-control': 'private, max-age=31536000, immutable',
          'content-disposition': 'inline',
          etag,
          ...MEDIA_SECURITY_HEADERS
        }
      })
    }
    if (method === 'DELETE') {
      const asset = await env.DB.prepare(
        'SELECT a.*, i.kind, i.updated_at AS item_updated_at FROM assets a JOIN items i ON i.id = a.item_id WHERE a.id = ? AND a.user_id = ? AND i.user_id = ?'
      ).bind(assetId, user.id, user.id).first<Row>()
      if (!asset) throw new ApiError(404, '图片不存在')
      assertItemVersion({ updated_at: asset.item_updated_at }, await readJson(request))
      if (String(asset.role) === 'web_cover') throw new ApiError(400, '网页封面不能在这里删除')
      if (String(asset.kind) === 'image_group') {
        const count = await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM assets WHERE item_id = ? AND role = 'gallery'"
        ).bind(String(asset.item_id)).first<Row>()
        if (Number(count?.count || 0) <= 1) throw new ApiError(400, '图片组至少需要保留一张图片')
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM assets WHERE id = ? AND user_id = ?').bind(assetId, user.id),
        env.DB.prepare('UPDATE items SET updated_at = ? WHERE id = ? AND user_id = ?').bind(Date.now(), String(asset.item_id), user.id)
      ])
      ctx.waitUntil(deleteR2Keys(env, [String(asset.original_key || ''), String(asset.thumb_key || '')]))
      return json(await getItem(env, user.id, String(asset.item_id)))
    }
  }

  return json({ error: '功能不存在' }, 404)
}

async function injectBlogHtmlMeta(
  assetResponse: Response,
  env: Env,
  requestUrl: URL,
  method: string
): Promise<Response> {
  let headHtml: string
  try {
    const meta = await resolveBlogOgMeta(env, requestUrl)
    headHtml = renderBlogOgHeadHtml(meta)
  } catch {
    return assetResponse
  }

  if (typeof HTMLRewriter !== 'undefined') {
    return new HTMLRewriter()
      .on('title', {
        element(el) {
          el.remove()
        }
      })
      .on('head', {
        element(el) {
          el.append(`\n    ${headHtml}\n  `, { html: true })
        }
      })
      .transform(assetResponse)
  }

  // Fallback for non-Workerd test runtimes (e.g. Node Vitest)
  const headers = new Headers(assetResponse.headers)
  headers.delete('content-length')
  headers.delete('etag')
  if (method === 'HEAD') {
    return new Response(null, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers
    })
  }
  const rawHtml = await assetResponse.text()
  const withoutTitle = rawHtml.replace(/<title>[\s\S]*?<\/title>/i, '')
  const transformed = withoutTitle.includes('</head>')
    ? withoutTitle.replace('</head>', `  ${headHtml}\n  </head>`)
    : `${headHtml}\n${withoutTitle}`
  return new Response(transformed, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    if (url.pathname.startsWith('/api/')) {
      try {
        return applyGlobalSecurityHeaders(await handleApi(request, env, ctx))
      } catch (error) {
        if (error instanceof ApiError) {
          return applyGlobalSecurityHeaders(
            json({ error: error.message, details: error.details }, error.status)
          )
        }
        const message = error instanceof Error ? error.message : '操作失败，请稍后重试'
        console.error(error)
        return applyGlobalSecurityHeaders(json({ error: message }, 500))
      }
    }

    if (url.pathname.startsWith('/assets/')) {
      const assetRes = await env.ASSETS.fetch(request)
      const contentType = (assetRes.headers.get('content-type') || '').toLowerCase()
      if (contentType.includes('text/html')) {
        return applyGlobalSecurityHeaders(
          new Response('Asset Not Found', {
            status: 404,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              'cache-control': 'no-store'
            }
          })
        )
      }
      return applyGlobalSecurityHeaders(assetRes)
    }

    if ((method === 'GET' || method === 'HEAD') && matchBlogHtmlRoute(url.pathname) !== null) {
      const htmlRes = await env.ASSETS.fetch(request)
      const contentType = (htmlRes.headers.get('content-type') || '').toLowerCase()
      if (htmlRes.status === 200 && contentType.includes('text/html')) {
        const rewritten = await injectBlogHtmlMeta(htmlRes, env, url, method)
        return applyGlobalSecurityHeaders(rewritten)
      }
      return applyGlobalSecurityHeaders(htmlRes)
    }

    return applyGlobalSecurityHeaders(await env.ASSETS.fetch(request))
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const job = (async () => {
      await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()).run()
      const usersRes = await env.DB.prepare('SELECT id FROM users').all<Row>()
      for (const userRow of usersRes.results) {
        if (!userRow.id) continue
        await runBlogMediaGc(env, String(userRow.id), { minAgeMs: 24 * 60 * 60 * 1000 })
      }
    })()
    ctx.waitUntil(job)
    await job
  }
}
