import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import {
  DEFAULT_CATEGORIES,
  createContext,
  runTransaction,
  type AppContext
} from './db.js'
import { fetchImage, fetchPageMetadata, normalizeUrl } from './metadata.js'
import {
  ensureCategory,
  getItem,
  listItems,
  removeUnusedTags,
  serializeItem,
  syncItemTags
} from './library.js'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_ITEM,
  insertPreparedAsset,
  prepareImage,
  prepareMemoAsset,
  removeMemoAssets,
  removePreparedAsset,
  removePreparedAssets,
  type PreparedAsset
} from './storage.js'
import {
  createSessionToken,
  hashPassword,
  hashToken,
  normalizeEmail,
  validatePassword,
  verifyPassword
} from './security.js'

const SESSION_COOKIE = 'dil_session'
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000
const RowSchema = z.object({}).passthrough()
const BackupAssetSchema = z.object({
  role: z.enum(['web_cover', 'attachment', 'gallery']),
  originalName: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  sortOrder: z.number().int().min(0).max(MAX_IMAGES_PER_ITEM),
  path: z.string().min(1).max(500).nullable()
}).passthrough()
const BackupItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['link', 'text', 'image_group']),
  title: z.string().min(1).max(300),
  url: z.string().max(4096).nullable(),
  status: z.enum(['pending', 'completed']),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
  completedAt: z.number().int().min(0).nullable(),
  isStarred: z.boolean(),
  plannedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  trashedAt: z.number().int().min(0).nullable().optional(),
  assets: z.array(BackupAssetSchema).max(MAX_IMAGES_PER_ITEM + 1)
}).passthrough()
type Row = Record<string, unknown>
type UserRequest = Request & { userId?: string; userEmail?: string }
const MEMO_FILE_ID = /^[a-zA-Z0-9_-]{1,128}$/
const MAX_MEMO_SCENE_BYTES = 12 * 1024 * 1024

class ApiError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

function asRow(value: unknown): Row {
  return RowSchema.parse(value)
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    return value.split(/[,，]/).map((part) => part.trim()).filter(Boolean)
  }
  return []
}

function requiredTitle(value: unknown, fallback = '') {
  const title = String(value || fallback).replace(/\s+/g, ' ').trim()
  if (!title) throw new ApiError(400, '请填写标题')
  if (title.length > 300) throw new ApiError(400, '标题不能超过 300 个字符')
  return title
}

function optionalCategory(value: unknown) {
  const category = String(value || '').trim()
  return category || null
}

function routeId(req: Request) {
  const value = req.params.id
  return Array.isArray(value) ? value[0] : value
}

function categoryColor(value: unknown) {
  const color = String(value || '').trim()
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ApiError(400, '请选择有效的类别颜色')
  return color.toLowerCase()
}

function memoBackground(value: unknown) {
  if (value === 'solid' || value === 'grid' || value === 'dots' || value === 'lines') return value
  throw new ApiError(400, '画布背景无效')
}

function memoColorMode(value: unknown) {
  if (value === 'light' || value === 'dark') return value
  throw new ApiError(400, '画布昼夜模式无效')
}

function memoFileIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 10_000) throw new ApiError(400, '画布图片清单无效')
  const ids = value.map(String)
  if (new Set(ids).size !== ids.length || ids.some((id) => !MEMO_FILE_ID.test(id))) {
    throw new ApiError(400, '画布图片清单无效')
  }
  return ids
}

function memoSceneJson(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, '画布内容无效')
  const scene = value as Record<string, unknown>
  if (!Array.isArray(scene.elements) || scene.elements.length > 100_000) throw new ApiError(400, '画布元素过多或格式无效')
  if (!scene.appState || typeof scene.appState !== 'object' || Array.isArray(scene.appState)) {
    throw new ApiError(400, '画布视图设置无效')
  }
  const serialized = JSON.stringify({ elements: scene.elements, appState: scene.appState })
  if (Buffer.byteLength(serialized, 'utf8') > MAX_MEMO_SCENE_BYTES) throw new ApiError(400, '画布内容超过 12 MB 限制')
  return serialized
}

function memoCanvasSnapshot(context: AppContext, userId: string) {
  const row = context.db.prepare(
    'SELECT scene_json,background,color_mode,updated_at FROM memo_canvas WHERE user_id=?'
  ).get(userId) as Row | undefined
  const assets = context.db.prepare(
    'SELECT file_id,mime_type,size,created_at FROM memo_assets WHERE user_id=? ORDER BY created_at'
  ).all(userId) as Row[]
  let scene: { elements: unknown[]; appState: Record<string, unknown> } = { elements: [], appState: {} }
  if (row?.scene_json) {
    try {
      const parsed = JSON.parse(String(row.scene_json)) as typeof scene
      if (Array.isArray(parsed.elements) && parsed.appState && typeof parsed.appState === 'object') scene = parsed
    } catch {
      // A damaged local row must not prevent the user from opening the rest of the app.
    }
  }
  return {
    scene,
    background: row?.background || 'solid',
    colorMode: row?.color_mode || 'light',
    updatedAt: row?.updated_at ? Number(row.updated_at) : 0,
    assets: assets.map((asset) => ({
      fileId: String(asset.file_id),
      mimeType: String(asset.mime_type),
      size: Number(asset.size),
      createdAt: Number(asset.created_at),
      url: `/api/memo-assets/${encodeURIComponent(String(asset.file_id))}`
    }))
  }
}

function clientUuid(value: unknown) {
  const parsed = z.string().uuid().safeParse(String(value || '').trim())
  return parsed.success ? parsed.data : randomUUID()
}

function clientAssetIds(value: unknown, count: number) {
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== count) return Array.from({ length: count }, () => randomUUID())
    return parsed.map((entry) => clientUuid(entry))
  } catch {
    return Array.from({ length: count }, () => randomUUID())
  }
}

function clientCreatedAt(value: unknown) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()
}

function setSession(context: AppContext, res: Response, userId: string) {
  const token = createSessionToken()
  const now = Date.now()
  context.db.prepare(
    'INSERT INTO sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)'
  ).run(hashToken(token), userId, now + SESSION_DURATION, now)
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    maxAge: SESSION_DURATION,
    path: '/'
  })
}

function clearSession(context: AppContext, req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (token) context.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(hashToken(token))
  res.clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'strict' })
}

function currentUser(context: AppContext, req: Request) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return null
  const row = context.db.prepare(
    'SELECT u.id,u.email,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?'
  ).get(hashToken(token)) as Row | undefined
  if (!row) return null
  if (Number(row.expires_at) <= Date.now()) {
    context.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(hashToken(token))
    return null
  }
  return { id: String(row.id), email: String(row.email) }
}

function authRequired(context: AppContext) {
  return (req: UserRequest, res: Response, next: NextFunction) => {
    const user = currentUser(context, req)
    if (!user) {
      res.status(401).json({ error: '请先登录' })
      return
    }
    req.userId = user.id
    req.userEmail = user.email
    next()
  }
}

async function prepareFiles(
  context: AppContext,
  files: Express.Multer.File[],
  itemId: string,
  userId: string,
  role: 'attachment' | 'gallery',
  startOrder: number,
  assetIds: string[] = []
) {
  const prepared: PreparedAsset[] = []
  try {
    for (let index = 0; index < files.length; index += 1) {
      const assetId = assetIds[index] || randomUUID()
      const existing = context.db.prepare(
        'SELECT id FROM assets WHERE id=? AND item_id=? AND user_id=?'
      ).get(assetId, itemId, userId)
      if (existing) continue
      prepared.push(await prepareImage(context, {
        id: assetId,
        buffer: files[index].buffer,
        originalName: files[index].originalname,
        itemId,
        userId,
        role,
        sortOrder: startOrder + index
      }))
    }
    return prepared
  } catch (error) {
    await removePreparedAssets(context, prepared)
    throw new ApiError(400, error instanceof Error ? error.message : '图片处理失败')
  }
}

function findRawItem(context: AppContext, userId: string, itemId: string) {
  return context.db.prepare('SELECT * FROM items WHERE id=? AND user_id=?').get(itemId, userId) as Row | undefined
}

function assertItemVersion(context: AppContext, userId: string, itemId: string, body?: Record<string, unknown>) {
  if (!body || !hasOwn(body, 'baseUpdatedAt')) return
  const raw = findRawItem(context, userId, itemId)
  if (!raw) throw new ApiError(404, '条目不存在')
  if (Number(body.baseUpdatedAt) !== Number(raw.updated_at)) {
    throw new ApiError(409, '云端条目已在其他设备更新，请选择保留云端或使用本机版本', {
      conflict: true,
      current: getItem(context, userId, itemId)
    })
  }
}

function itemChangesAlreadyApplied(raw: Row, body: Record<string, unknown>) {
  let compared = 0
  const compare = (key: string, current: unknown, normalize: (value: unknown) => unknown = (value) => value) => {
    if (!hasOwn(body, key)) return true
    compared += 1
    return normalize(current) === normalize(body[key])
  }
  const nullable = (value: unknown) => String(value || '') || null
  const boolean = (value: unknown) => Boolean(Number(value) || value === true)
  return compare('title', raw.title, String) &&
    compare('url', raw.url, nullable) &&
    compare('status', raw.status, String) &&
    compare('categoryId', raw.category_id, nullable) &&
    compare('isStarred', raw.is_starred, boolean) &&
    compare('plannedFor', raw.planned_for, nullable) && compared > 0
}

function insertItem(context: AppContext, input: {
  id: string
  userId: string
  kind: 'link' | 'text' | 'image_group'
  title: string
  url: string | null
  normalizedUrl: string | null
  categoryId: string | null
  createdAt: number
}) {
  context.db.prepare(
    'INSERT INTO items (id,user_id,kind,title,url,normalized_url,status,category_id,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,' +
      "'pending',?,?,?,NULL)"
  ).run(
    input.id,
    input.userId,
    input.kind,
    input.title,
    input.url,
    input.normalizedUrl,
    input.categoryId,
    input.createdAt,
    input.createdAt
  )
}

function validPlannedFor(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const plannedFor = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedFor)) throw new ApiError(400, '计划日期无效')
  return plannedFor
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function getPreferences(context: AppContext, userId: string) {
  const row = context.db.prepare(
    'SELECT quick_save_category_id FROM user_preferences WHERE user_id=?'
  ).get(userId) as Row | undefined
  return { quickSaveCategoryId: row?.quick_save_category_id ? String(row.quick_save_category_id) : null }
}

function parseBackupItem(value: unknown) {
  try {
    return BackupItemSchema.parse(JSON.parse(String(value || '')))
  } catch {
    throw new ApiError(400, '备份条目格式无效')
  }
}

function patchItem(context: AppContext, userId: string, itemId: string, body: Record<string, unknown>) {
  const raw = findRawItem(context, userId, itemId)
  if (!raw) throw new ApiError(404, '条目不存在')
  const fields: string[] = []
  const values: Array<string | number | null> = []
  let nextStatus = String(raw.status)

  if (hasOwn(body, 'title')) {
    fields.push('title=?')
    values.push(requiredTitle(body.title, String(raw.title)))
  }
  if (hasOwn(body, 'categoryId')) {
    fields.push('category_id=?')
    values.push(ensureCategory(context, userId, optionalCategory(body.categoryId)))
  }
  if (hasOwn(body, 'isStarred')) {
    if (typeof body.isStarred !== 'boolean') throw new ApiError(400, '星标状态无效')
    fields.push('is_starred=?')
    values.push(body.isStarred ? 1 : 0)
  }
  if (hasOwn(body, 'plannedFor')) {
    fields.push('planned_for=?')
    values.push(validPlannedFor(body.plannedFor))
  }
  if (hasOwn(body, 'status')) {
    if (body.status !== 'pending' && body.status !== 'completed') throw new ApiError(400, '条目状态无效')
    nextStatus = body.status
    fields.push('status=?', 'completed_at=?')
    values.push(
      nextStatus,
      nextStatus === 'completed'
        ? (String(raw.status) === 'completed' && raw.completed_at ? Number(raw.completed_at) : Date.now())
        : null
    )
    if (nextStatus === 'completed') {
      fields.push('planned_for=NULL')
    }
  }
  if (!fields.length) return getItem(context, userId, itemId)
  fields.push('updated_at=?')
  values.push(Date.now(), itemId, userId)
  context.db.prepare(`UPDATE items SET ${fields.join(',')} WHERE id=? AND user_id=?`).run(...values)
  return getItem(context, userId, itemId)
}

async function permanentlyDeleteItems(context: AppContext, userId: string, itemIds: string[]) {
  const ids = [...new Set(itemIds)].filter(Boolean)
  if (!ids.length) return 0
  const placeholders = ids.map(() => '?').join(',')
  const owned = context.db.prepare(
    `SELECT id FROM items WHERE user_id=? AND id IN (${placeholders})`
  ).all(userId, ...ids).map((row) => String((row as Row).id))
  if (!owned.length) return 0
  const ownedPlaceholders = owned.map(() => '?').join(',')
  const assets = context.db.prepare(
    `SELECT file_name AS fileName,thumb_name AS thumbName FROM assets WHERE user_id=? AND item_id IN (${ownedPlaceholders})`
  ).all(userId, ...owned) as Array<{ fileName: string; thumbName: string }>
  runTransaction(context.db, () => {
    context.db.prepare(`DELETE FROM items WHERE user_id=? AND id IN (${ownedPlaceholders})`).run(userId, ...owned)
    removeUnusedTags(context, userId)
  })
  await removePreparedAssets(context, assets)
  return owned.length
}

async function purgeExpiredTrash(context: AppContext, userId: string) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const expired = context.db.prepare(
    'SELECT id FROM items WHERE user_id=? AND trashed_at IS NOT NULL AND trashed_at<=?'
  ).all(userId, cutoff).map((row) => String((row as Row).id))
  return permanentlyDeleteItems(context, userId, expired)
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function loginKey(req: Request, email: string) {
  return (req.ip || 'local') + ':' + email
}

function checkLoginLimit(req: Request, email: string) {
  const key = loginKey(req, email)
  const entry = loginAttempts.get(key)
  const now = Date.now()
  if (entry && entry.resetAt > now && entry.count >= 5) {
    throw new ApiError(429, '尝试次数过多，请 15 分钟后再试')
  }
  if (entry && entry.resetAt <= now) loginAttempts.delete(key)
}

function recordLoginFailure(req: Request, email: string) {
  const key = loginKey(req, email)
  const current = loginAttempts.get(key)
  loginAttempts.set(key, {
    count: current && current.resetAt > Date.now() ? current.count + 1 : 1,
    resetAt: Date.now() + 15 * 60 * 1000
  })
}

export function createApp(context = createContext()) {
  const app = express()
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_ITEM }
  })

  app.disable('x-powered-by')
  app.set('trust proxy', false)
  app.use(express.json({ limit: '12mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))
  app.use(cookieParser())

  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin')
      const host = req.get('host')
      if (origin) {
        try {
          if (new URL(origin).host !== host) {
            res.status(403).json({ error: '请求来源无效' })
            return
          }
        } catch {
          res.status(403).json({ error: '请求来源无效' })
          return
        }
      }
    }
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/auth/status', (req, res) => {
    context.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now())
    const count = Number((context.db.prepare('SELECT COUNT(*) AS count FROM users').get() as Row).count)
    const user = currentUser(context, req)
    res.json({
      setupRequired: count === 0,
      authenticated: Boolean(user),
      user: user ? { email: user.email } : null
    })
  })

  app.post('/api/auth/setup', async (req, res) => {
    const existing = Number((context.db.prepare('SELECT COUNT(*) AS count FROM users').get() as Row).count)
    if (existing > 0) throw new ApiError(409, '账号已经创建，不能再次注册')
    const email = normalizeEmail(String(req.body.email || ''))
    if (!z.string().email().safeParse(email).success) throw new ApiError(400, '请输入有效的邮箱地址')
    const password = String(req.body.password || '')
    const passwordError = validatePassword(password)
    if (passwordError) throw new ApiError(400, passwordError)
    const passwordHash = await hashPassword(password)
    const userId = randomUUID()
    const now = Date.now()
    runTransaction(context.db, () => {
      const recheck = Number((context.db.prepare('SELECT COUNT(*) AS count FROM users').get() as Row).count)
      if (recheck > 0) throw new ApiError(409, '账号已经创建')
      context.db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(
        userId,
        email,
        passwordHash,
        now
      )
      let defaultCategoryId: string | null = null
      DEFAULT_CATEGORIES.forEach((category, index) => {
        const categoryId = randomUUID()
        context.db.prepare(
          'INSERT INTO categories (id,user_id,name,color,sort_order,created_at) VALUES (?,?,?,?,?,?)'
        ).run(categoryId, userId, category.name, category.color, index, now)
        if (category.name === '其他') defaultCategoryId = categoryId
      })
      context.db.prepare(
        'INSERT INTO user_preferences (user_id,quick_save_category_id,updated_at) VALUES (?,?,?)'
      ).run(userId, defaultCategoryId, now)
    })
    setSession(context, res, userId)
    res.status(201).json({ email })
  })

  app.post('/api/auth/login', async (req, res) => {
    const email = normalizeEmail(String(req.body.email || ''))
    const password = String(req.body.password || '')
    checkLoginLimit(req, email)
    const user = context.db.prepare('SELECT id,email,password_hash FROM users WHERE email=?').get(email) as Row | undefined
    if (!user || !(await verifyPassword(password, String(user.password_hash)))) {
      recordLoginFailure(req, email)
      throw new ApiError(401, '邮箱或密码不正确')
    }
    loginAttempts.delete(loginKey(req, email))
    clearSession(context, req, res)
    setSession(context, res, String(user.id))
    res.json({ email: String(user.email) })
  })

  app.post('/api/auth/logout', (req, res) => {
    clearSession(context, req, res)
    res.json({ ok: true })
  })

  app.post('/api/auth/change-password', authRequired(context), async (req: UserRequest, res) => {
    const currentPassword = String(req.body.currentPassword || '')
    const newPassword = String(req.body.newPassword || '')
    const error = validatePassword(newPassword)
    if (error) throw new ApiError(400, error)
    const user = context.db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.userId as string) as Row
    if (!(await verifyPassword(currentPassword, String(user.password_hash)))) {
      throw new ApiError(401, '当前密码不正确')
    }
    const passwordHash = await hashPassword(newPassword)
    runTransaction(context.db, () => {
      context.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, req.userId as string)
      context.db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.userId as string)
    })
    setSession(context, res, req.userId as string)
    res.json({ ok: true })
  })

  app.post('/api/metadata', authRequired(context), async (req, res) => {
    try {
      const metadata = await fetchPageMetadata(String(req.body.url || ''))
      res.json(metadata)
    } catch (error) {
      throw new ApiError(422, error instanceof Error ? error.message : '无法读取网页信息')
    }
  })

  app.get('/api/categories', authRequired(context), (req: UserRequest, res) => {
    const rows = context.db.prepare(
      'SELECT id,name,color,sort_order FROM categories WHERE user_id=? ORDER BY sort_order,name COLLATE NOCASE'
    ).all(req.userId as string)
    res.json(rows)
  })

  app.get('/api/preferences', authRequired(context), (req: UserRequest, res) => {
    res.json(getPreferences(context, req.userId as string))
  })

  app.patch('/api/preferences', authRequired(context), (req: UserRequest, res) => {
    const userId = req.userId as string
    const categoryId = ensureCategory(context, userId, optionalCategory(req.body.quickSaveCategoryId))
    context.db.prepare(
      'INSERT INTO user_preferences (user_id,quick_save_category_id,updated_at) VALUES (?,?,?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET quick_save_category_id=excluded.quick_save_category_id,updated_at=excluded.updated_at'
    ).run(userId, categoryId, Date.now())
    res.json(getPreferences(context, userId))
  })

  app.get('/api/memo-canvas', authRequired(context), (req: UserRequest, res) => {
    res.json(memoCanvasSnapshot(context, req.userId as string))
  })

  app.put('/api/memo-canvas', authRequired(context), async (req: UserRequest, res) => {
    const userId = req.userId as string
    const sceneJson = memoSceneJson(req.body.scene)
    const background = memoBackground(req.body.background)
    const colorMode = memoColorMode(req.body.colorMode)
    const fileIds = memoFileIds(req.body.fileIds)
    const storedIds = context.db.prepare(
      'SELECT file_id FROM memo_assets WHERE user_id=?'
    ).all(userId).map((row) => String((row as Row).file_id))
    const missing = fileIds.filter((id) => !storedIds.includes(id))
    if (missing.length) throw new ApiError(400, '画布图片尚未上传完成')
    const stale = storedIds.filter((id) => !fileIds.includes(id))
    const staleRows = stale.length
      ? context.db.prepare(
          `SELECT file_name AS fileName FROM memo_assets WHERE user_id=? AND file_id IN (${stale.map(() => '?').join(',')})`
        ).all(userId, ...stale) as Array<{ fileName: string }>
      : []
    const updatedAt = Date.now()
    runTransaction(context.db, () => {
      context.db.prepare(
        'INSERT INTO memo_canvas (user_id,scene_json,background,color_mode,updated_at) VALUES (?,?,?,?,?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET scene_json=excluded.scene_json,background=excluded.background,color_mode=excluded.color_mode,updated_at=excluded.updated_at'
      ).run(userId, sceneJson, background, colorMode, updatedAt)
      if (stale.length) {
        context.db.prepare(
          `DELETE FROM memo_assets WHERE user_id=? AND file_id IN (${stale.map(() => '?').join(',')})`
        ).run(userId, ...stale)
      }
    })
    await removeMemoAssets(context, staleRows)
    res.json(memoCanvasSnapshot(context, userId))
  })

  app.post(
    '/api/memo-assets',
    authRequired(context),
    upload.single('file'),
    async (req: UserRequest, res) => {
      const userId = req.userId as string
      const fileId = String(req.body.fileId || '')
      if (!MEMO_FILE_ID.test(fileId)) throw new ApiError(400, '画布图片编号无效')
      const existing = context.db.prepare(
        'SELECT file_id,mime_type,size,created_at FROM memo_assets WHERE user_id=? AND file_id=?'
      ).get(userId, fileId) as Row | undefined
      if (existing) {
        res.json({
          fileId,
          mimeType: String(existing.mime_type),
          size: Number(existing.size),
          createdAt: Number(existing.created_at),
          url: `/api/memo-assets/${encodeURIComponent(fileId)}`
        })
        return
      }
      const file = req.file
      if (!file) throw new ApiError(400, '请选择画布图片')
      const prepared = await prepareMemoAsset(context, {
        fileId,
        userId,
        buffer: file.buffer,
        createdAt: Number(req.body.createdAt)
      })
      try {
        context.db.prepare(
          'INSERT INTO memo_assets (file_id,user_id,file_name,mime_type,size,created_at) VALUES (?,?,?,?,?,?)'
        ).run(
          prepared.fileId,
          prepared.userId,
          prepared.fileName,
          prepared.mimeType,
          prepared.size,
          prepared.createdAt
        )
      } catch (error) {
        await removeMemoAssets(context, [{ fileName: prepared.fileName }])
        throw error
      }
      res.status(201).json({
        fileId,
        mimeType: prepared.mimeType,
        size: prepared.size,
        createdAt: prepared.createdAt,
        url: `/api/memo-assets/${encodeURIComponent(fileId)}`
      })
    }
  )

  app.get('/api/memo-assets/:id', authRequired(context), (req: UserRequest, res) => {
    const fileId = routeId(req)
    const row = context.db.prepare(
      'SELECT file_name,mime_type FROM memo_assets WHERE user_id=? AND file_id=?'
    ).get(req.userId as string, fileId) as Row | undefined
    if (!row) throw new ApiError(404, '画布图片不存在')
    const filePath = path.join(context.memoAssetsDir, path.basename(String(row.file_name)))
    if (!existsSync(filePath)) throw new ApiError(404, '画布图片文件不存在')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.type(String(row.mime_type))
    res.setHeader('Content-Disposition', 'inline')
    res.sendFile(filePath)
  })

  app.post('/api/backup/clear', authRequired(context), async (req: UserRequest, res) => {
    if (req.body.confirmed !== true) throw new ApiError(400, '完整覆盖需要明确确认')
    const userId = req.userId as string
    const assets = context.db.prepare(
      'SELECT file_name AS fileName,thumb_name AS thumbName FROM assets WHERE user_id=?'
    ).all(userId) as Array<{ fileName: string; thumbName: string }>
    const memoAssets = context.db.prepare(
      'SELECT file_name AS fileName FROM memo_assets WHERE user_id=?'
    ).all(userId) as Array<{ fileName: string }>
    runTransaction(context.db, () => {
      context.db.prepare('DELETE FROM items WHERE user_id=?').run(userId)
      context.db.prepare('DELETE FROM categories WHERE user_id=?').run(userId)
      context.db.prepare('DELETE FROM memo_canvas WHERE user_id=?').run(userId)
      context.db.prepare('DELETE FROM memo_assets WHERE user_id=?').run(userId)
      context.db.prepare('UPDATE user_preferences SET quick_save_category_id=NULL,updated_at=? WHERE user_id=?')
        .run(Date.now(), userId)
      removeUnusedTags(context, userId)
    })
    await removePreparedAssets(context, assets)
    await removeMemoAssets(context, memoAssets)
    res.json({ cleared: true })
  })

  app.post(
    '/api/backup/item',
    authRequired(context),
    upload.array('images', MAX_IMAGES_PER_ITEM + 1),
    async (req: UserRequest, res) => {
      const userId = req.userId as string
      const item = parseBackupItem(req.body.item)
      if (item.createdAt > Date.now() + 24 * 60 * 60 * 1000 || item.updatedAt > Date.now() + 24 * 60 * 60 * 1000) {
        throw new ApiError(400, '备份条目时间无效')
      }
      if (findRawItem(context, userId, item.id)) {
        res.json({ status: 'skipped', reason: '备份 ID 已存在' })
        return
      }
      let normalizedUrl: string | null = null
      if (item.kind === 'link') {
        try {
          normalizedUrl = normalizeUrl(String(item.url || ''))
        } catch {
          throw new ApiError(400, '备份中的网页地址无效')
        }
        const duplicate = context.db.prepare(
          "SELECT id FROM items WHERE user_id=? AND kind='link' AND normalized_url=?"
        ).get(userId, normalizedUrl) as Row | undefined
        if (duplicate) {
          res.json({ status: 'skipped', reason: '网址已存在', existingId: String(duplicate.id) })
          return
        }
      }
      const categoryId = ensureCategory(context, userId, optionalCategory(req.body.categoryId))
      const files = (req.files || []) as Express.Multer.File[]
      const fileAssets = item.assets.filter((asset) => asset.path)
      const webCoverCount = item.assets.filter((asset) => asset.role === 'web_cover').length
      const manualCount = item.assets.filter((asset) => asset.role !== 'web_cover').length
      if (webCoverCount > 1 || manualCount > MAX_IMAGES_PER_ITEM) throw new ApiError(400, '备份图片数量超出限制')
      if (item.kind === 'image_group' && item.assets.some((asset) => asset.role !== 'gallery')) throw new ApiError(400, '图片组清单角色无效')
      if (item.kind === 'text' && item.assets.length) throw new ApiError(400, '文本条目不能包含图片')
      if (item.kind === 'link' && item.assets.some((asset) => asset.role === 'gallery')) throw new ApiError(400, '网页图片清单角色无效')
      if (files.length !== fileAssets.length) throw new ApiError(400, '备份图片数量与清单不一致')
      if (item.kind === 'image_group' && !files.length) {
        res.json({ status: 'skipped', reason: '备份未包含图片组原图' })
        return
      }
      const prepared: PreparedAsset[] = []
      try {
        for (let index = 0; index < files.length; index += 1) {
          const asset = fileAssets[index]
          const next = await prepareImage(context, {
            buffer: files[index].buffer,
            originalName: asset.originalName,
            itemId: item.id,
            userId,
            role: asset.role,
            sortOrder: asset.sortOrder
          })
          if (next.mimeType !== asset.mimeType) {
            await removePreparedAsset(context, next)
            throw new ApiError(400, '图片类型与备份清单不一致')
          }
          prepared.push(next)
        }
        runTransaction(context.db, () => {
          context.db.prepare(
          'INSERT INTO items (id,user_id,kind,title,url,normalized_url,status,category_id,created_at,updated_at,completed_at,is_starred,planned_for,trashed_at) ' +
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
          ).run(
            item.id,
            userId,
            item.kind,
            requiredTitle(item.title),
            normalizedUrl,
            normalizedUrl,
            item.status,
            categoryId,
            item.createdAt,
            item.updatedAt,
            item.status === 'completed' ? (item.completedAt || item.updatedAt) : null,
            item.isStarred ? 1 : 0,
            item.status === 'completed' ? null : validPlannedFor(item.plannedFor),
            item.trashedAt ? Date.now() : null
          )
          prepared.forEach((asset) => insertPreparedAsset(context, asset))
        })
      } catch (error) {
        await removePreparedAssets(context, prepared)
        throw error
      }
      res.status(201).json({ status: 'added' })
    }
  )

  app.post('/api/categories', authRequired(context), (req: UserRequest, res) => {
    const name = requiredTitle(req.body.name).slice(0, 40)
    const color = categoryColor(req.body.color || '#64748b')
    const max = context.db.prepare('SELECT COALESCE(MAX(sort_order),-1) AS value FROM categories WHERE user_id=?').get(
      req.userId as string
    ) as Row
    const id = clientUuid(req.body.id)
    const existing = context.db.prepare(
      'SELECT id,name,color,sort_order FROM categories WHERE id=? AND user_id=?'
    ).get(id, req.userId as string)
    if (existing) {
      res.json(existing)
      return
    }
    try {
      context.db.prepare(
        'INSERT INTO categories (id,user_id,name,color,sort_order,created_at) VALUES (?,?,?,?,?,?)'
      ).run(id, req.userId as string, name, color, Number(max.value) + 1, Date.now())
    } catch {
      throw new ApiError(409, '已经存在同名类别')
    }
    res.status(201).json({ id, name, color })
  })

  app.put('/api/categories/:id', authRequired(context), (req: UserRequest, res) => {
    const name = requiredTitle(req.body.name).slice(0, 40)
    const color = categoryColor(req.body.color)
    try {
      const result = context.db.prepare(
        'UPDATE categories SET name=?,color=? WHERE id=? AND user_id=?'
      ).run(name, color, routeId(req), req.userId as string)
      if (!result.changes) throw new ApiError(404, '类别不存在')
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(409, '已经存在同名类别')
    }
    res.json({ id: routeId(req), name, color })
  })

  app.delete('/api/categories/:id', authRequired(context), (req: UserRequest, res) => {
    const result = context.db.prepare('DELETE FROM categories WHERE id=? AND user_id=?').run(
      routeId(req),
      req.userId as string
    )
    if (!result.changes) throw new ApiError(404, '类别不存在')
    res.json({ ok: true })
  })

  app.get('/api/tags', authRequired(context), (req: UserRequest, res) => {
    const rows = context.db.prepare(
      'SELECT id,name FROM tags WHERE user_id=? ORDER BY name COLLATE NOCASE'
    ).all(req.userId as string)
    res.json(rows)
  })

  app.get('/api/items', authRequired(context), async (req: UserRequest, res) => {
    const queryValue = (value: unknown) => typeof value === 'string' ? value : undefined
    await purgeExpiredTrash(context, req.userId as string)
    res.json(listItems(context, req.userId as string, {
      status: queryValue(req.query.status),
      kind: queryValue(req.query.kind),
      category: queryValue(req.query.category),
      tag: queryValue(req.query.tag),
      date: queryValue(req.query.date),
      q: queryValue(req.query.q),
      priority: queryValue(req.query.priority),
      sort: queryValue(req.query.sort),
      trash: queryValue(req.query.trash)
    }))
  })

  app.post('/api/items/bulk', authRequired(context), async (req: UserRequest, res) => {
    const userId = req.userId as string
    const ids: string[] = Array.isArray(req.body.ids)
      ? [...new Set<string>((req.body.ids as unknown[]).map((value) => String(value)))].slice(0, 500)
      : []
    if (!ids.length) throw new ApiError(400, '请选择至少一个条目')
    const owned = ids.filter((id) => findRawItem(context, userId, id))
    if (req.body.permanentDelete === true) {
      const trashed = owned.filter((id) => Boolean((findRawItem(context, userId, id) as Row | undefined)?.trashed_at))
      const deleted = await permanentlyDeleteItems(context, userId, trashed)
      res.json({ updated: 0, deleted, succeededIds: trashed, failed: [] })
      return
    }
    if (req.body.delete === true || req.body.restore === true) {
      if (!owned.length) {
        res.json({ updated: 0, deleted: 0, succeededIds: ids, failed: [] })
        return
      }
      const placeholders = owned.map(() => '?').join(',')
      const trashedAt = req.body.restore === true ? null : Date.now()
      context.db.prepare(
        `UPDATE items SET trashed_at=?,updated_at=? WHERE user_id=? AND id IN (${placeholders})`
      ).run(trashedAt, Date.now(), userId, ...owned)
      res.json({ updated: req.body.restore === true ? owned.length : 0, deleted: req.body.delete === true ? owned.length : 0, succeededIds: owned, failed: [] })
      return
    }
    if (owned.length !== ids.length) throw new ApiError(404, '部分条目不存在')
    const changes = req.body.changes && typeof req.body.changes === 'object'
      ? req.body.changes as Record<string, unknown>
      : {}
    runTransaction(context.db, () => {
      owned.forEach((id) => patchItem(context, userId, id, changes))
    })
    res.json({ updated: owned.length, deleted: 0, succeededIds: owned, failed: [] })
  })

  app.get('/api/items/:id', authRequired(context), (req: UserRequest, res) => {
    const item = getItem(context, req.userId as string, routeId(req))
    if (!item) throw new ApiError(404, '条目不存在')
    res.json(item)
  })

  app.post(
    '/api/items/link',
    authRequired(context),
    upload.array('images', MAX_IMAGES_PER_ITEM),
    async (req: UserRequest, res) => {
      const userId = req.userId as string
      const itemId = clientUuid(req.body.id)
      const existingById = findRawItem(context, userId, itemId)
      if (existingById) {
        res.json(getItem(context, userId, itemId))
        return
      }
      let normalizedUrl: string
      try {
        normalizedUrl = normalizeUrl(String(req.body.url || ''))
      } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : '网址无效')
      }
      const duplicate = context.db.prepare(
        "SELECT id,trashed_at FROM items WHERE user_id=? AND kind='link' AND normalized_url=?"
      ).get(userId, normalizedUrl) as Row | undefined
      if (duplicate) throw new ApiError(409, duplicate.trashed_at ? '这个网页在回收站中' : '这个网页已经保存过了', {
        existingId: String(duplicate.id),
        trashed: Boolean(duplicate.trashed_at)
      })

      const categoryId = ensureCategory(context, userId, optionalCategory(req.body.categoryId))
      const fallback = new URL(normalizedUrl).hostname
      const title = requiredTitle(req.body.title, fallback)
      const files = (req.files || []) as Express.Multer.File[]
      const prepared = await prepareFiles(
        context, files, itemId, userId, 'attachment', 0, clientAssetIds(req.body.assetIds, files.length)
      )
      try {
        runTransaction(context.db, () => {
          insertItem(context, {
            id: itemId,
            userId,
            kind: 'link',
            title,
            url: normalizedUrl,
            normalizedUrl,
            categoryId,
            createdAt: clientCreatedAt(req.body.createdAt)
          })
          prepared.forEach((asset) => insertPreparedAsset(context, asset))
          syncItemTags(context, userId, itemId, parseTags(req.body.tags))
        })
      } catch (error) {
        await removePreparedAssets(context, prepared)
        throw error
      }

      const coverUrl = String(req.body.coverUrl || '').trim()
      if (coverUrl) {
        try {
          const coverBuffer = await fetchImage(coverUrl)
          const cover = await prepareImage(context, {
            buffer: coverBuffer,
            originalName: 'web-cover',
            itemId,
            userId,
            role: 'web_cover',
            sortOrder: 0,
            maxBytes: 10 * 1024 * 1024
          })
          insertPreparedAsset(context, cover)
        } catch {
          // A missing or unreadable cover never blocks saving the link.
        }
      }
      res.status(201).json(getItem(context, userId, itemId))
    }
  )

  app.post(
    '/api/items/image-group',
    authRequired(context),
    upload.array('images', MAX_IMAGES_PER_ITEM),
    async (req: UserRequest, res) => {
      const userId = req.userId as string
      const itemId = clientUuid(req.body.id)
      const existingById = findRawItem(context, userId, itemId)
      if (existingById) {
        res.json(getItem(context, userId, itemId))
        return
      }
      const files = (req.files || []) as Express.Multer.File[]
      if (!files.length) throw new ApiError(400, '请至少添加一张图片')
      const categoryId = ensureCategory(context, userId, optionalCategory(req.body.categoryId))
      const title = requiredTitle(req.body.title, '图片组')
      const prepared = await prepareFiles(
        context, files, itemId, userId, 'gallery', 0, clientAssetIds(req.body.assetIds, files.length)
      )
      try {
        runTransaction(context.db, () => {
          insertItem(context, {
            id: itemId,
            userId,
            kind: 'image_group',
            title,
            url: null,
            normalizedUrl: null,
            categoryId,
            createdAt: clientCreatedAt(req.body.createdAt)
          })
          prepared.forEach((asset) => insertPreparedAsset(context, asset))
          syncItemTags(context, userId, itemId, parseTags(req.body.tags))
        })
      } catch (error) {
        await removePreparedAssets(context, prepared)
        throw error
      }
      res.status(201).json(getItem(context, userId, itemId))
    }
  )

  app.post('/api/items/text', authRequired(context), (req: UserRequest, res) => {
    const userId = req.userId as string
    const itemId = clientUuid(req.body.id)
    const existingById = findRawItem(context, userId, itemId)
    if (existingById) {
      res.json(getItem(context, userId, itemId))
      return
    }
    const categoryId = ensureCategory(context, userId, optionalCategory(req.body.categoryId))
    const title = requiredTitle(req.body.title)
    runTransaction(context.db, () => {
      insertItem(context, {
        id: itemId,
        userId,
        kind: 'text',
        title,
        url: null,
        normalizedUrl: null,
        categoryId,
        createdAt: clientCreatedAt(req.body.createdAt)
      })
      syncItemTags(context, userId, itemId, [])
    })
    res.status(201).json(getItem(context, userId, itemId))
  })

  app.put('/api/items/:id', authRequired(context), (req: UserRequest, res) => {
    const userId = req.userId as string
    const raw = findRawItem(context, userId, routeId(req))
    if (!raw) throw new ApiError(404, '条目不存在')
    if (itemChangesAlreadyApplied(raw, req.body as Record<string, unknown>)) {
      res.json(getItem(context, userId, routeId(req)))
      return
    }
    assertItemVersion(context, userId, routeId(req), req.body as Record<string, unknown>)
    const title = requiredTitle(req.body.title, String(raw.title))
    const categoryId = ensureCategory(context, userId, optionalCategory(req.body.categoryId))
    const status = req.body.status === 'completed' ? 'completed' : 'pending'
    let url = raw.url ? String(raw.url) : null
    let normalizedUrl = raw.normalized_url ? String(raw.normalized_url) : null
    if (String(raw.kind) === 'link') {
      try {
        normalizedUrl = normalizeUrl(String(req.body.url || raw.url || ''))
        url = normalizedUrl
      } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : '网址无效')
      }
      const duplicate = context.db.prepare(
        "SELECT id FROM items WHERE user_id=? AND kind='link' AND normalized_url=? AND id<>?"
      ).get(userId, normalizedUrl, routeId(req)) as Row | undefined
      if (duplicate) throw new ApiError(409, '这个网页已经保存过了', { existingId: String(duplicate.id) })
    }
    const completedAt: number | null = status === 'completed'
      ? (String(raw.status) === 'completed' && raw.completed_at ? Number(raw.completed_at) : Date.now())
      : null
    if (hasOwn(req.body, 'isStarred') && typeof req.body.isStarred !== 'boolean') {
      throw new ApiError(400, '星标状态无效')
    }
    runTransaction(context.db, () => {
      context.db.prepare(
        'UPDATE items SET title=?,url=?,normalized_url=?,status=?,category_id=?,updated_at=?,completed_at=?,is_starred=?,planned_for=? WHERE id=? AND user_id=?'
      ).run(
        title,
        url,
        normalizedUrl,
        status,
        categoryId,
        Date.now(),
        completedAt,
        hasOwn(req.body, 'isStarred') ? (req.body.isStarred ? 1 : 0) : Number(raw.is_starred || 0),
        status === 'completed'
          ? null
          : (hasOwn(req.body, 'plannedFor')
              ? validPlannedFor(req.body.plannedFor)
              : (raw.planned_for ? String(raw.planned_for) : null)),
        routeId(req),
        userId
      )
      syncItemTags(context, userId, routeId(req), parseTags(req.body.tags))
    })
    res.json(getItem(context, userId, routeId(req)))
  })

  app.patch('/api/items/:id', authRequired(context), (req: UserRequest, res) => {
    const raw = findRawItem(context, req.userId as string, routeId(req))
    if (!raw) throw new ApiError(404, '条目不存在')
    if (itemChangesAlreadyApplied(raw, req.body as Record<string, unknown>)) {
      res.json(getItem(context, req.userId as string, routeId(req)))
      return
    }
    assertItemVersion(context, req.userId as string, routeId(req), req.body as Record<string, unknown>)
    res.json(patchItem(context, req.userId as string, routeId(req), req.body as Record<string, unknown>))
  })

  app.post('/api/items/:id/cover', authRequired(context), async (req: UserRequest, res) => {
    const userId = req.userId as string
    const raw = findRawItem(context, userId, routeId(req))
    if (!raw || String(raw.kind) !== 'link') throw new ApiError(404, '网页条目不存在')
    const coverUrl = String(req.body.coverUrl || '').trim()
    if (!coverUrl) throw new ApiError(400, '封面地址无效')
    let prepared: PreparedAsset
    try {
      prepared = await prepareImage(context, {
        buffer: await fetchImage(coverUrl),
        originalName: 'web-cover',
        itemId: routeId(req),
        userId,
        role: 'web_cover',
        sortOrder: 0,
        maxBytes: 10 * 1024 * 1024
      })
    } catch {
      throw new ApiError(422, '网页封面无法读取')
    }
    const previous = context.db.prepare(
      "SELECT file_name AS fileName,thumb_name AS thumbName FROM assets WHERE item_id=? AND user_id=? AND role='web_cover'"
    ).all(routeId(req), userId) as Array<{ fileName: string; thumbName: string }>
    try {
      runTransaction(context.db, () => {
        context.db.prepare("DELETE FROM assets WHERE item_id=? AND user_id=? AND role='web_cover'").run(routeId(req), userId)
        insertPreparedAsset(context, prepared)
        context.db.prepare('UPDATE items SET updated_at=? WHERE id=? AND user_id=?').run(Date.now(), routeId(req), userId)
      })
    } catch (error) {
      await removePreparedAsset(context, prepared)
      throw error
    }
    await removePreparedAssets(context, previous)
    res.json(getItem(context, userId, routeId(req)))
  })

  app.post('/api/items/trash/empty', authRequired(context), async (req: UserRequest, res) => {
    if (req.body.confirmed !== true) throw new ApiError(400, '清空回收站需要明确确认')
    const userId = req.userId as string
    const ids = context.db.prepare(
      'SELECT id FROM items WHERE user_id=? AND trashed_at IS NOT NULL'
    ).all(userId).map((row) => String((row as Row).id))
    const deleted = await permanentlyDeleteItems(context, userId, ids)
    res.json({ deleted })
  })

  app.post('/api/items/:id/restore', authRequired(context), (req: UserRequest, res) => {
    const userId = req.userId as string
    const raw = findRawItem(context, userId, routeId(req))
    if (!raw) throw new ApiError(404, '条目不存在')
    context.db.prepare(
      'UPDATE items SET trashed_at=NULL,updated_at=? WHERE id=? AND user_id=?'
    ).run(Date.now(), routeId(req), userId)
    res.json(getItem(context, userId, routeId(req)))
  })

  app.delete('/api/items/:id/permanent', authRequired(context), async (req: UserRequest, res) => {
    const userId = req.userId as string
    const raw = findRawItem(context, userId, routeId(req))
    if (!raw) throw new ApiError(404, '条目不存在')
    if (!raw.trashed_at) throw new ApiError(400, '请先把条目移到回收站')
    assertItemVersion(context, userId, routeId(req), req.body as Record<string, unknown>)
    await permanentlyDeleteItems(context, userId, [routeId(req)])
    res.json({ ok: true })
  })

  app.delete('/api/items/:id', authRequired(context), async (req: UserRequest, res) => {
    const userId = req.userId as string
    const raw = findRawItem(context, userId, routeId(req))
    if (!raw) throw new ApiError(404, '条目不存在')
    assertItemVersion(context, userId, routeId(req), req.body as Record<string, unknown>)
    if (!raw.trashed_at) {
      context.db.prepare('UPDATE items SET trashed_at=?,updated_at=? WHERE id=? AND user_id=?')
        .run(Date.now(), Date.now(), routeId(req), userId)
    }
    res.json({ ok: true, item: getItem(context, userId, routeId(req)) })
  })

  app.post(
    '/api/items/:id/assets',
    authRequired(context),
    upload.array('images', MAX_IMAGES_PER_ITEM),
    async (req: UserRequest, res) => {
      const userId = req.userId as string
      const raw = findRawItem(context, userId, routeId(req))
      if (!raw) throw new ApiError(404, '条目不存在')
      if (String(raw.kind) === 'text') throw new ApiError(400, '文本条目不能添加图片')
      const files = (req.files || []) as Express.Multer.File[]
      if (!files.length) throw new ApiError(400, '请选择图片')
      const requestedAssetIds = clientAssetIds(req.body.assetIds, files.length)
      const alreadyStored = requestedAssetIds.every((id) => context.db.prepare(
        'SELECT id FROM assets WHERE id=? AND item_id=? AND user_id=?'
      ).get(id, routeId(req), userId))
      if (alreadyStored) {
        res.json(getItem(context, userId, routeId(req)))
        return
      }
      assertItemVersion(context, userId, routeId(req), req.body as Record<string, unknown>)
      const current = context.db.prepare(
        "SELECT COUNT(*) AS count,COALESCE(MAX(sort_order),-1) AS maxOrder FROM assets WHERE item_id=? AND role<>'web_cover'"
      ).get(routeId(req)) as Row
      const missingCount = requestedAssetIds.filter((id) => !context.db.prepare(
        'SELECT id FROM assets WHERE id=? AND item_id=? AND user_id=?'
      ).get(id, routeId(req), userId)).length
      if (Number(current.count) + missingCount > MAX_IMAGES_PER_ITEM) {
        throw new ApiError(400, '每个条目最多保存 30 张图片')
      }
      const role = String(raw.kind) === 'link' ? 'attachment' : 'gallery'
      const prepared = await prepareFiles(
        context,
        files,
        routeId(req),
        userId,
        role,
        Number(current.maxOrder) + 1,
        requestedAssetIds
      )
      try {
        runTransaction(context.db, () => {
          prepared.forEach((asset) => insertPreparedAsset(context, asset))
          context.db.prepare('UPDATE items SET updated_at=? WHERE id=?').run(Date.now(), routeId(req))
        })
      } catch (error) {
        await removePreparedAssets(context, prepared)
        throw error
      }
      res.status(201).json(getItem(context, userId, routeId(req)))
    }
  )

  app.put('/api/items/:id/assets/order', authRequired(context), (req: UserRequest, res) => {
    const userId = req.userId as string
    const raw = findRawItem(context, userId, routeId(req))
    if (!raw) throw new ApiError(404, '条目不存在')
    const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids.map(String) : []
    const current: string[] = context.db.prepare(
      "SELECT id FROM assets WHERE item_id=? AND user_id=? AND role<>'web_cover' ORDER BY sort_order"
    ).all(routeId(req), userId).map((row) => String((row as Row).id))
    if (ids.length === current.length && ids.every((id, index) => id === current[index])) {
      res.json(getItem(context, userId, routeId(req)))
      return
    }
    assertItemVersion(context, userId, routeId(req), req.body as Record<string, unknown>)
    if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) {
      throw new ApiError(400, '图片顺序无效')
    }
    runTransaction(context.db, () => {
      ids.forEach((id, index) => {
        context.db.prepare('UPDATE assets SET sort_order=? WHERE id=? AND item_id=? AND user_id=?').run(
          index,
          id,
          routeId(req),
          userId
        )
      })
      context.db.prepare('UPDATE items SET updated_at=? WHERE id=?').run(Date.now(), routeId(req))
    })
    res.json(getItem(context, userId, routeId(req)))
  })

  app.delete('/api/assets/:id', authRequired(context), async (req: UserRequest, res) => {
    const userId = req.userId as string
    const asset = context.db.prepare(
      'SELECT a.*,i.kind FROM assets a JOIN items i ON i.id=a.item_id WHERE a.id=? AND a.user_id=? AND i.user_id=?'
    ).get(routeId(req), userId, userId) as Row | undefined
    if (!asset) throw new ApiError(404, '图片不存在')
    assertItemVersion(context, userId, String(asset.item_id), req.body as Record<string, unknown>)
    if (String(asset.role) === 'web_cover') throw new ApiError(400, '网页封面不能在这里删除')
    if (String(asset.kind) === 'image_group') {
      const count = context.db.prepare(
        "SELECT COUNT(*) AS count FROM assets WHERE item_id=? AND role='gallery'"
      ).get(String(asset.item_id)) as Row
      if (Number(count.count) <= 1) throw new ApiError(400, '图片组至少需要保留一张图片')
    }
    context.db.prepare('DELETE FROM assets WHERE id=? AND user_id=?').run(routeId(req), userId)
    context.db.prepare('UPDATE items SET updated_at=? WHERE id=? AND user_id=?').run(Date.now(), String(asset.item_id), userId)
    await removePreparedAsset(context, {
      fileName: String(asset.file_name),
      thumbName: String(asset.thumb_name)
    })
    res.json(getItem(context, userId, String(asset.item_id)))
  })

  app.get('/api/assets/:id', authRequired(context), (req: UserRequest, res) => {
    const row = context.db.prepare(
      'SELECT file_name,thumb_name,mime_type,original_name FROM assets WHERE id=? AND user_id=?'
    ).get(routeId(req), req.userId as string) as Row | undefined
    if (!row) throw new ApiError(404, '图片不存在')
    const original = req.query.variant === 'original'
    const fileName = path.basename(String(original ? row.file_name : row.thumb_name))
    const filePath = path.join(original ? context.originalsDir : context.thumbsDir, fileName)
    if (!existsSync(filePath)) throw new ApiError(404, '图片文件不存在')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.type(original ? String(row.mime_type) : 'image/webp')
    res.setHeader('Content-Disposition', 'inline')
    res.sendFile(filePath)
  })

  const distPath = path.join(process.cwd(), 'dist')
  if (existsSync(distPath)) {
    app.use(express.static(distPath, { index: false, maxAge: '1h' }))
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        res.sendFile(path.join(distPath, 'index.html'))
      } else {
        next()
      }
    })
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? '单张图片不能超过 20 MB'
        : error.code === 'LIMIT_FILE_COUNT'
          ? '每个条目最多保存 30 张图片'
          : '图片上传失败'
      res.status(400).json({ error: message })
      return
    }
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message, details: error.details })
      return
    }
    const message = error instanceof Error ? error.message : '操作失败'
    if (process.env.NODE_ENV !== 'test') console.error(error)
    res.status(500).json({ error: message })
  })

  return app
}

export type AppInstance = ReturnType<typeof createApp>
