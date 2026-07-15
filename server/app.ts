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
type Row = Record<string, unknown>
type UserRequest = Request & { userId?: string; userEmail?: string }

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
  startOrder: number
) {
  const prepared: PreparedAsset[] = []
  try {
    for (let index = 0; index < files.length; index += 1) {
      prepared.push(await prepareImage(context, {
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
  app.use(express.json({ limit: '1mb' }))
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
      DEFAULT_CATEGORIES.forEach((category, index) => {
        context.db.prepare(
          'INSERT INTO categories (id,user_id,name,color,sort_order,created_at) VALUES (?,?,?,?,?,?)'
        ).run(randomUUID(), userId, category.name, category.color, index, now)
      })
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

  app.post('/api/categories', authRequired(context), (req: UserRequest, res) => {
    const name = requiredTitle(req.body.name).slice(0, 40)
    const color = categoryColor(req.body.color || '#64748b')
    const max = context.db.prepare('SELECT COALESCE(MAX(sort_order),-1) AS value FROM categories WHERE user_id=?').get(
      req.userId as string
    ) as Row
    const id = randomUUID()
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

  app.get('/api/items', authRequired(context), (req: UserRequest, res) => {
    const queryValue = (value: unknown) => typeof value === 'string' ? value : undefined
    res.json(listItems(context, req.userId as string, {
      status: queryValue(req.query.status),
      kind: queryValue(req.query.kind),
      category: queryValue(req.query.category),
      tag: queryValue(req.query.tag),
      date: queryValue(req.query.date),
      q: queryValue(req.query.q)
    }))
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
      let normalizedUrl: string
      try {
        normalizedUrl = normalizeUrl(String(req.body.url || ''))
      } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : '网址无效')
      }
      const duplicate = context.db.prepare(
        "SELECT id FROM items WHERE user_id=? AND kind='link' AND normalized_url=?"
      ).get(userId, normalizedUrl) as Row | undefined
      if (duplicate) throw new ApiError(409, '这个网页已经保存过了', { existingId: String(duplicate.id) })

      const categoryId = ensureCategory(context, userId, optionalCategory(req.body.categoryId))
      const fallback = new URL(normalizedUrl).hostname
      const title = requiredTitle(req.body.title, fallback)
      const itemId = randomUUID()
      const files = (req.files || []) as Express.Multer.File[]
      const prepared = await prepareFiles(context, files, itemId, userId, 'attachment', 0)
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
            createdAt: Date.now()
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
      const files = (req.files || []) as Express.Multer.File[]
      if (!files.length) throw new ApiError(400, '请至少添加一张图片')
      const categoryId = ensureCategory(context, userId, optionalCategory(req.body.categoryId))
      const title = requiredTitle(req.body.title, '图片组')
      const itemId = randomUUID()
      const prepared = await prepareFiles(context, files, itemId, userId, 'gallery', 0)
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
            createdAt: Date.now()
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
    const categoryId = ensureCategory(context, userId, optionalCategory(req.body.categoryId))
    const title = requiredTitle(req.body.title)
    const itemId = randomUUID()
    runTransaction(context.db, () => {
      insertItem(context, {
        id: itemId,
        userId,
        kind: 'text',
        title,
        url: null,
        normalizedUrl: null,
        categoryId,
        createdAt: Date.now()
      })
      syncItemTags(context, userId, itemId, [])
    })
    res.status(201).json(getItem(context, userId, itemId))
  })

  app.put('/api/items/:id', authRequired(context), (req: UserRequest, res) => {
    const userId = req.userId as string
    const raw = findRawItem(context, userId, routeId(req))
    if (!raw) throw new ApiError(404, '条目不存在')
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
    runTransaction(context.db, () => {
      context.db.prepare(
        'UPDATE items SET title=?,url=?,normalized_url=?,status=?,category_id=?,updated_at=?,completed_at=? WHERE id=? AND user_id=?'
      ).run(
        title,
        url,
        normalizedUrl,
        status,
        categoryId,
        Date.now(),
        completedAt,
        routeId(req),
        userId
      )
      syncItemTags(context, userId, routeId(req), parseTags(req.body.tags))
    })
    res.json(getItem(context, userId, routeId(req)))
  })

  app.delete('/api/items/:id', authRequired(context), async (req: UserRequest, res) => {
    const userId = req.userId as string
    const raw = findRawItem(context, userId, routeId(req))
    if (!raw) throw new ApiError(404, '条目不存在')
    const assets = context.db.prepare(
      'SELECT file_name AS fileName,thumb_name AS thumbName FROM assets WHERE item_id=? AND user_id=?'
    ).all(routeId(req), userId) as Array<{ fileName: string; thumbName: string }>
    runTransaction(context.db, () => {
      context.db.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(routeId(req), userId)
      removeUnusedTags(context, userId)
    })
    await removePreparedAssets(context, assets.map((asset) => ({
      fileName: asset.fileName,
      thumbName: asset.thumbName
    })))
    res.json({ ok: true })
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
      const current = context.db.prepare(
        "SELECT COUNT(*) AS count,COALESCE(MAX(sort_order),-1) AS maxOrder FROM assets WHERE item_id=? AND role<>'web_cover'"
      ).get(routeId(req)) as Row
      if (Number(current.count) + files.length > MAX_IMAGES_PER_ITEM) {
        throw new ApiError(400, '每个条目最多保存 30 张图片')
      }
      const role = String(raw.kind) === 'link' ? 'attachment' : 'gallery'
      const prepared = await prepareFiles(
        context,
        files,
        routeId(req),
        userId,
        role,
        Number(current.maxOrder) + 1
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
    if (String(asset.role) === 'web_cover') throw new ApiError(400, '网页封面不能在这里删除')
    if (String(asset.kind) === 'image_group') {
      const count = context.db.prepare(
        "SELECT COUNT(*) AS count FROM assets WHERE item_id=? AND role='gallery'"
      ).get(String(asset.item_id)) as Row
      if (Number(count.count) <= 1) throw new ApiError(400, '图片组至少需要保留一张图片')
    }
    context.db.prepare('DELETE FROM assets WHERE id=? AND user_id=?').run(routeId(req), userId)
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
