import type { User } from '@supabase/supabase-js'
import { ApiRequestError } from '../api-error'
import type { AuthStatus, Category, ImageAsset, LibraryItem } from '../types'
import { requireSupabase } from './supabase'

const BUCKET = 'library-images'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGES_PER_ITEM = 30
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

type ItemKind = 'link' | 'text' | 'image_group'
type AssetRole = 'web_cover' | 'attachment' | 'gallery'

interface CloudAssetRow {
  id: string
  item_id: string
  user_id: string
  role: AssetRole
  original_name: string
  original_path: string
  thumb_path: string
  mime_type: string
  size: number
  width: number | null
  height: number | null
  sort_order: number
  created_at: string
}

interface CloudItemRow {
  id: string
  user_id: string
  kind: ItemKind
  title: string
  url: string | null
  normalized_url: string | null
  status: 'pending' | 'completed'
  category_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  category?: Category | Category[] | null
  assets?: CloudAssetRow[] | null
}

function apiError(status: number, message: string, details?: unknown): never {
  throw new ApiRequestError(status, message, details)
}

function messageFrom(error: unknown, fallback = '操作失败，请稍后重试') {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '')
    if (message.includes('unique') || message.includes('duplicate')) return '内容已经存在'
    if (message.includes('唯一账号') || message.includes('claim_first_owner')) return '账号已经创建，不能再次注册'
    return message || fallback
  }
  return fallback
}

function parseJsonBody(options: RequestInit) {
  if (!options.body || typeof options.body !== 'string') return {} as Record<string, unknown>
  try {
    return JSON.parse(options.body) as Record<string, unknown>
  } catch {
    apiError(400, '提交的内容格式无效')
  }
}

function requiredTitle(value: unknown, fallback = '') {
  const title = String(value || fallback).replace(/\s+/g, ' ').trim()
  if (!title) apiError(400, '请填写标题')
  if (title.length > 300) apiError(400, '标题不能超过 300 个字符')
  return title
}

function cleanOriginalName(value: string) {
  const name = value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim()
  return (name || 'image').slice(0, 180)
}

function normalizeWebUrl(input: string) {
  const value = input.trim()
  if (
    (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) ||
    /^(javascript|data|file|mailto|ftp|blob):/i.test(value)
  ) apiError(400, '只支持 http 或 https 网页地址')
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') apiError(400, '只支持 http 或 https 网页地址')
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = ''
    }
    return url.toString()
  } catch (error) {
    if (error instanceof ApiRequestError) throw error
    apiError(400, '网址无效')
  }
}

async function currentUser(): Promise<User> {
  const client = requireSupabase()
  const { data, error } = await client.auth.getSession()
  if (error || !data.session?.user) apiError(401, '请先登录')
  return data.session.user
}

async function authorizedFetch(path: string, options: RequestInit = {}) {
  const client = requireSupabase()
  const { data } = await client.auth.getSession()
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  if (data.session?.access_token) headers.set('authorization', 'Bearer ' + data.session.access_token)
  return fetch(path, { ...options, headers, credentials: 'same-origin' })
}

async function callServer<T>(path: string, options: RequestInit = {}) {
  const response = await authorizedFetch(path, options)
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) apiError(response.status, body?.error || '操作失败，请稍后重试', body?.details)
  return body as T
}

function extensionFor(mimeType: string) {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpg'
  return 'webp'
}

async function makeThumbnail(file: Blob) {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    apiError(400, '图片内容无法读取')
  }
  const width = bitmap.width
  const height = bitmap.height
  if (!width || !height || width * height > 100_000_000) {
    bitmap.close()
    apiError(400, '图片尺寸过大')
  }
  const scale = Math.min(1, 720 / width, 720 / height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    apiError(500, '浏览器无法处理图片')
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
  if (!thumb) apiError(500, '无法生成图片预览')
  return { thumb, width, height }
}

async function removeStorage(paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return
  await requireSupabase().storage.from(BUCKET).remove(unique)
}

async function uploadAsset(input: {
  userId: string
  itemId: string
  file: File
  role: AssetRole
  sortOrder: number
}) {
  const client = requireSupabase()
  const { file } = input
  if (!ALLOWED_TYPES.has(file.type)) apiError(400, '只支持 PNG、JPEG 和 WebP 图片')
  if (!file.size) apiError(400, '图片内容为空')
  if (file.size > MAX_IMAGE_BYTES) apiError(400, '单张图片不能超过 20 MB')

  const assetId = crypto.randomUUID()
  const originalPath = `${input.userId}/${assetId}/original.${extensionFor(file.type)}`
  const thumbPath = `${input.userId}/${assetId}/thumb.webp`
  const { thumb, width, height } = await makeThumbnail(file)

  const originalUpload = await client.storage.from(BUCKET).upload(originalPath, file, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false
  })
  if (originalUpload.error) apiError(400, messageFrom(originalUpload.error, '原图上传失败'))

  const thumbUpload = await client.storage.from(BUCKET).upload(thumbPath, thumb, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false
  })
  if (thumbUpload.error) {
    await removeStorage([originalPath])
    apiError(400, messageFrom(thumbUpload.error, '预览图上传失败'))
  }

  const row = {
    id: assetId,
    item_id: input.itemId,
    user_id: input.userId,
    role: input.role,
    original_name: cleanOriginalName(file.name),
    original_path: originalPath,
    thumb_path: thumbPath,
    mime_type: file.type,
    size: file.size,
    width,
    height,
    sort_order: input.sortOrder
  }
  const inserted = await client.from('assets').insert(row).select('*').single()
  if (inserted.error) {
    await removeStorage([originalPath, thumbPath])
    apiError(400, messageFrom(inserted.error, '图片记录保存失败'))
  }
  return inserted.data as CloudAssetRow
}

async function signedUrlMap(rows: CloudItemRow[]) {
  const paths = [...new Set(rows.flatMap((row) => (row.assets || []).flatMap((asset) => [
    asset.original_path,
    asset.thumb_path
  ])))]
  const map = new Map<string, string>()
  if (!paths.length) return map
  const result = await requireSupabase().storage.from(BUCKET).createSignedUrls(paths, 60 * 60)
  if (result.error) apiError(500, '暂时无法读取图片')
  for (const entry of result.data || []) {
    if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl)
  }
  return map
}

function dateValue(value: string) {
  return new Date(value).getTime()
}

async function serializeRows(rows: CloudItemRow[]): Promise<LibraryItem[]> {
  const urls = await signedUrlMap(rows)
  return rows.map((row) => {
    const rawCategory = Array.isArray(row.category) ? row.category[0] : row.category
    const assets = [...(row.assets || [])].sort((left, right) => {
      const roleOrder = (role: AssetRole) => role === 'web_cover' ? 0 : role === 'gallery' ? 1 : 2
      return roleOrder(left.role) - roleOrder(right.role) || left.sort_order - right.sort_order ||
        dateValue(left.created_at) - dateValue(right.created_at)
    })
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      url: row.url,
      status: row.status,
      category: rawCategory ? { id: rawCategory.id, name: rawCategory.name, color: rawCategory.color } : null,
      assets: assets.map((asset): ImageAsset => ({
        id: asset.id,
        role: asset.role,
        originalName: asset.original_name,
        mimeType: asset.mime_type,
        size: Number(asset.size),
        width: asset.width,
        height: asset.height,
        sortOrder: asset.sort_order,
        thumbUrl: urls.get(asset.thumb_path) || '',
        originalUrl: urls.get(asset.original_path) || ''
      })),
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
      completedAt: row.completed_at ? dateValue(row.completed_at) : null
    }
  })
}

const ITEM_SELECT = [
  'id,user_id,kind,title,url,normalized_url,status,category_id,created_at,updated_at,completed_at',
  'category:categories(id,name,color)',
  'assets(id,item_id,user_id,role,original_name,original_path,thumb_path,mime_type,size,width,height,sort_order,created_at)'
].join(',')

async function loadItemRows(userId: string, itemId?: string) {
  let query = requireSupabase()
    .from('items')
    .select(ITEM_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (itemId) query = query.eq('id', itemId)
  const result = await query
  if (result.error) apiError(500, messageFrom(result.error, '无法读取内容'))
  return (result.data || []) as unknown as CloudItemRow[]
}

async function getItem(userId: string, itemId: string) {
  const rows = await loadItemRows(userId, itemId)
  if (!rows.length) apiError(404, '条目不存在')
  return (await serializeRows(rows))[0]
}

function chinaDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value))
}

function filterRows(rows: CloudItemRow[], params: URLSearchParams) {
  const status = params.get('status')
  const kind = params.get('kind')
  const category = params.get('category')
  const date = params.get('date')
  const needle = (params.get('q') || '').trim().toLocaleLowerCase('zh-CN')
  return rows.filter((row) => {
    if ((status === 'pending' || status === 'completed') && row.status !== status) return false
    if ((kind === 'link' || kind === 'text' || kind === 'image_group') && row.kind !== kind) return false
    if (category === 'uncategorized' && row.category_id) return false
    if (category && category !== 'uncategorized' && row.category_id !== category) return false
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && chinaDate(row.created_at) !== date) return false
    if (needle) {
      const rawCategory = Array.isArray(row.category) ? row.category[0] : row.category
      const values = [
        row.title,
        row.url || '',
        rawCategory?.name || '',
        ...(row.assets || []).map((asset) => asset.original_name)
      ]
      if (!values.some((value) => value.toLocaleLowerCase('zh-CN').includes(needle))) return false
    }
    return true
  })
}

async function ensureCategory(userId: string, categoryId: unknown) {
  const id = String(categoryId || '').trim()
  if (!id) return null
  const result = await requireSupabase().from('categories').select('id').eq('id', id).eq('user_id', userId).maybeSingle()
  if (result.error || !result.data) apiError(400, '所选类别不存在')
  return id
}

function filesFrom(form: FormData) {
  return form.getAll('images').filter((value): value is File => value instanceof File)
}

async function removeAssetRows(rows: CloudAssetRow[]) {
  if (!rows.length) return
  const client = requireSupabase()
  await client.from('assets').delete().in('id', rows.map((row) => row.id))
  await removeStorage(rows.flatMap((row) => [row.original_path, row.thumb_path]))
}

async function deleteItem(userId: string, itemId: string) {
  const client = requireSupabase()
  const assetsResult = await client.from('assets').select('*').eq('item_id', itemId).eq('user_id', userId)
  if (assetsResult.error) apiError(500, '无法读取条目图片')
  const deleted = await client.from('items').delete().eq('id', itemId).eq('user_id', userId).select('id').maybeSingle()
  if (deleted.error || !deleted.data) apiError(404, '条目不存在')
  await removeStorage(((assetsResult.data || []) as CloudAssetRow[]).flatMap((row) => [row.original_path, row.thumb_path]))
}

async function insertItem(input: {
  userId: string
  kind: ItemKind
  title: string
  url: string | null
  normalizedUrl: string | null
  categoryId: string | null
}) {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const result = await requireSupabase().from('items').insert({
    id,
    user_id: input.userId,
    kind: input.kind,
    title: input.title,
    url: input.url,
    normalized_url: input.normalizedUrl,
    status: 'pending',
    category_id: input.categoryId,
    created_at: now,
    updated_at: now
  }).select('id').single()
  if (result.error) {
    if (result.error.code === '23505') apiError(409, '这个网页已经保存过了')
    apiError(400, messageFrom(result.error, '条目保存失败'))
  }
  return id
}

async function uploadFiles(input: {
  userId: string
  itemId: string
  files: File[]
  role: 'attachment' | 'gallery'
  startOrder?: number
}) {
  if (input.files.length > MAX_IMAGES_PER_ITEM) apiError(400, '每个条目最多保存 30 张图片')
  const uploaded: CloudAssetRow[] = []
  try {
    for (let index = 0; index < input.files.length; index += 1) {
      uploaded.push(await uploadAsset({
        userId: input.userId,
        itemId: input.itemId,
        file: input.files[index],
        role: input.role,
        sortOrder: (input.startOrder || 0) + index
      }))
    }
    return uploaded
  } catch (error) {
    await removeAssetRows(uploaded)
    throw error
  }
}

async function maybeUploadCover(userId: string, itemId: string, coverUrl: string) {
  if (!coverUrl) return
  try {
    const response = await authorizedFetch('/api/image?url=' + encodeURIComponent(coverUrl))
    if (!response.ok) return
    const blob = await response.blob()
    if (!ALLOWED_TYPES.has(blob.type) || blob.size > 10 * 1024 * 1024) return
    const file = new File([blob], 'web-cover.' + extensionFor(blob.type), { type: blob.type })
    await uploadAsset({ userId, itemId, file, role: 'web_cover', sortOrder: 0 })
  } catch {
    // An unreadable cover never blocks saving the link.
  }
}

async function authStatus(): Promise<AuthStatus> {
  const client = requireSupabase()
  const [sessionResult, setupResult] = await Promise.all([
    client.auth.getSession(),
    client.rpc('is_setup_required')
  ])
  if (setupResult.error) apiError(503, 'Supabase 尚未完成初始化')
  const user = sessionResult.data.session?.user
  return {
    setupRequired: Boolean(setupResult.data),
    authenticated: Boolean(user),
    user: user?.email ? { email: user.email } : null
  }
}

async function handleAuth(path: string, method: string, options: RequestInit) {
  const client = requireSupabase()
  if (path === '/api/auth/status' && method === 'GET') return authStatus()
  const body = parseJsonBody(options)
  if (path === '/api/auth/setup' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const result = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin }
    })
    if (result.error) apiError(409, messageFrom(result.error, '账号创建失败'))
    return { email, confirmationRequired: !result.data.session }
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const result = await client.auth.signInWithPassword({
      email: String(body.email || '').trim().toLowerCase(),
      password: String(body.password || '')
    })
    if (result.error) apiError(401, '邮箱或密码不正确')
    return { email: result.data.user.email || '' }
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    await client.auth.signOut()
    return { ok: true }
  }
  if (path === '/api/auth/change-password' && method === 'POST') {
    const user = await currentUser()
    const currentPassword = String(body.currentPassword || '')
    const newPassword = String(body.newPassword || '')
    if (newPassword.length < 10) apiError(400, '密码至少需要 10 个字符')
    if (!user.email) apiError(400, '账号邮箱无效')
    const verified = await client.auth.signInWithPassword({ email: user.email, password: currentPassword })
    if (verified.error) apiError(401, '当前密码不正确')
    const updated = await client.auth.updateUser({ password: newPassword })
    if (updated.error) apiError(400, messageFrom(updated.error, '密码修改失败'))
    return { ok: true }
  }
  if (path === '/api/auth/request-reset' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase()
    const result = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    if (result.error) apiError(400, messageFrom(result.error, '重置邮件发送失败'))
    return { ok: true }
  }
  if (path === '/api/auth/complete-reset' && method === 'POST') {
    const password = String(body.password || '')
    if (password.length < 10) apiError(400, '密码至少需要 10 个字符')
    const result = await client.auth.updateUser({ password })
    if (result.error) apiError(400, messageFrom(result.error, '密码重置失败'))
    return { ok: true }
  }
  apiError(404, '功能不存在')
}

async function handleCategories(path: string, method: string, options: RequestInit) {
  const client = requireSupabase()
  const user = await currentUser()
  if (path === '/api/categories' && method === 'GET') {
    const result = await client.from('categories').select('id,name,color,sort_order').eq('user_id', user.id)
      .order('sort_order').order('name')
    if (result.error) apiError(500, '无法读取类别')
    return result.data as Category[]
  }
  if (path === '/api/categories' && method === 'POST') {
    const body = parseJsonBody(options)
    const name = requiredTitle(body.name).slice(0, 40)
    const color = String(body.color || '#64748b').toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(color)) apiError(400, '请选择有效的类别颜色')
    const maxResult = await client.from('categories').select('sort_order').eq('user_id', user.id)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle()
    const inserted = await client.from('categories').insert({
      user_id: user.id,
      name,
      color,
      sort_order: Number(maxResult.data?.sort_order ?? -1) + 1
    }).select('id,name,color,sort_order').single()
    if (inserted.error) apiError(inserted.error.code === '23505' ? 409 : 400, '已经存在同名类别')
    return inserted.data
  }
  const match = path.match(/^\/api\/categories\/([0-9a-f-]+)$/i)
  if (!match) apiError(404, '类别不存在')
  if (method === 'PUT') {
    const body = parseJsonBody(options)
    const name = requiredTitle(body.name).slice(0, 40)
    const color = String(body.color || '').toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(color)) apiError(400, '请选择有效的类别颜色')
    const updated = await client.from('categories').update({ name, color }).eq('id', match[1]).eq('user_id', user.id)
      .select('id,name,color,sort_order').maybeSingle()
    if (updated.error) apiError(updated.error.code === '23505' ? 409 : 400, '已经存在同名类别')
    if (!updated.data) apiError(404, '类别不存在')
    return updated.data
  }
  if (method === 'DELETE') {
    const deleted = await client.from('categories').delete().eq('id', match[1]).eq('user_id', user.id)
      .select('id').maybeSingle()
    if (deleted.error || !deleted.data) apiError(404, '类别不存在')
    return { ok: true }
  }
  apiError(405, '操作方式不支持')
}

async function createLink(options: RequestInit) {
  const client = requireSupabase()
  const user = await currentUser()
  if (!(options.body instanceof FormData)) apiError(400, '提交内容无效')
  const form = options.body
  const normalizedUrl = normalizeWebUrl(String(form.get('url') || ''))
  const duplicate = await client.from('items').select('id').eq('user_id', user.id).eq('kind', 'link')
    .eq('normalized_url', normalizedUrl).maybeSingle()
  if (duplicate.data) apiError(409, '这个网页已经保存过了', { existingId: duplicate.data.id })
  const categoryId = await ensureCategory(user.id, form.get('categoryId'))
  const title = requiredTitle(form.get('title'), new URL(normalizedUrl).hostname)
  const itemId = await insertItem({
    userId: user.id,
    kind: 'link',
    title,
    url: normalizedUrl,
    normalizedUrl,
    categoryId
  })
  try {
    const files = filesFrom(form)
    await uploadFiles({ userId: user.id, itemId, files, role: 'attachment' })
    await maybeUploadCover(user.id, itemId, String(form.get('coverUrl') || '').trim())
    return getItem(user.id, itemId)
  } catch (error) {
    await deleteItem(user.id, itemId).catch(() => undefined)
    throw error
  }
}

async function createImageGroup(options: RequestInit) {
  const user = await currentUser()
  if (!(options.body instanceof FormData)) apiError(400, '提交内容无效')
  const form = options.body
  const files = filesFrom(form)
  if (!files.length) apiError(400, '请至少添加一张图片')
  const categoryId = await ensureCategory(user.id, form.get('categoryId'))
  const itemId = await insertItem({
    userId: user.id,
    kind: 'image_group',
    title: requiredTitle(form.get('title'), '图片组'),
    url: null,
    normalizedUrl: null,
    categoryId
  })
  try {
    await uploadFiles({ userId: user.id, itemId, files, role: 'gallery' })
    return getItem(user.id, itemId)
  } catch (error) {
    await deleteItem(user.id, itemId).catch(() => undefined)
    throw error
  }
}

async function handleItems(url: URL, method: string, options: RequestInit) {
  const client = requireSupabase()
  const user = await currentUser()
  const path = url.pathname
  if (path === '/api/items' && method === 'GET') {
    const rows = filterRows(await loadItemRows(user.id), url.searchParams)
    return serializeRows(rows)
  }
  if (path === '/api/items/link' && method === 'POST') return createLink(options)
  if (path === '/api/items/image-group' && method === 'POST') return createImageGroup(options)
  if (path === '/api/items/text' && method === 'POST') {
    const body = parseJsonBody(options)
    const itemId = await insertItem({
      userId: user.id,
      kind: 'text',
      title: requiredTitle(body.title),
      url: null,
      normalizedUrl: null,
      categoryId: await ensureCategory(user.id, body.categoryId)
    })
    return getItem(user.id, itemId)
  }

  const assetOrderMatch = path.match(/^\/api\/items\/([0-9a-f-]+)\/assets\/order$/i)
  if (assetOrderMatch && method === 'PUT') {
    const itemId = assetOrderMatch[1]
    await getItem(user.id, itemId)
    const body = parseJsonBody(options)
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
    const current = await client.from('assets').select('id').eq('item_id', itemId).eq('user_id', user.id)
      .neq('role', 'web_cover').order('sort_order')
    if (current.error) apiError(500, '无法读取图片顺序')
    const currentIds = (current.data || []).map((row) => row.id)
    if (ids.length !== currentIds.length || new Set(ids).size !== ids.length || ids.some((id) => !currentIds.includes(id))) {
      apiError(400, '图片顺序无效')
    }
    for (let index = 0; index < ids.length; index += 1) {
      const result = await client.from('assets').update({ sort_order: index }).eq('id', ids[index])
        .eq('item_id', itemId).eq('user_id', user.id)
      if (result.error) apiError(500, '图片顺序保存失败')
    }
    await client.from('items').update({ updated_at: new Date().toISOString() }).eq('id', itemId).eq('user_id', user.id)
    return getItem(user.id, itemId)
  }

  const assetsMatch = path.match(/^\/api\/items\/([0-9a-f-]+)\/assets$/i)
  if (assetsMatch && method === 'POST') {
    const itemId = assetsMatch[1]
    const itemRows = await loadItemRows(user.id, itemId)
    if (!itemRows.length) apiError(404, '条目不存在')
    const item = itemRows[0]
    if (item.kind === 'text') apiError(400, '文本条目不能添加图片')
    if (!(options.body instanceof FormData)) apiError(400, '提交内容无效')
    const files = filesFrom(options.body)
    if (!files.length) apiError(400, '请选择图片')
    const current = (item.assets || []).filter((asset) => asset.role !== 'web_cover')
    if (current.length + files.length > MAX_IMAGES_PER_ITEM) apiError(400, '每个条目最多保存 30 张图片')
    const startOrder = current.reduce((max, asset) => Math.max(max, asset.sort_order), -1) + 1
    await uploadFiles({
      userId: user.id,
      itemId,
      files,
      role: item.kind === 'link' ? 'attachment' : 'gallery',
      startOrder
    })
    await client.from('items').update({ updated_at: new Date().toISOString() }).eq('id', itemId).eq('user_id', user.id)
    return getItem(user.id, itemId)
  }

  const itemMatch = path.match(/^\/api\/items\/([0-9a-f-]+)$/i)
  if (!itemMatch) apiError(404, '条目不存在')
  const itemId = itemMatch[1]
  if (method === 'GET') return getItem(user.id, itemId)
  if (method === 'DELETE') {
    await deleteItem(user.id, itemId)
    return { ok: true }
  }
  if (method === 'PUT') {
    const rows = await loadItemRows(user.id, itemId)
    if (!rows.length) apiError(404, '条目不存在')
    const raw = rows[0]
    const body = parseJsonBody(options)
    const status = body.status === 'completed' ? 'completed' : 'pending'
    let normalizedUrl = raw.normalized_url
    let linkUrl = raw.url
    if (raw.kind === 'link') {
      normalizedUrl = normalizeWebUrl(String(body.url || raw.url || ''))
      linkUrl = normalizedUrl
      const duplicate = await client.from('items').select('id').eq('user_id', user.id).eq('kind', 'link')
        .eq('normalized_url', normalizedUrl).neq('id', itemId).maybeSingle()
      if (duplicate.data) apiError(409, '这个网页已经保存过了', { existingId: duplicate.data.id })
    }
    const completedAt = status === 'completed'
      ? (raw.status === 'completed' && raw.completed_at ? raw.completed_at : new Date().toISOString())
      : null
    const updated = await client.from('items').update({
      title: requiredTitle(body.title, raw.title),
      url: linkUrl,
      normalized_url: normalizedUrl,
      status,
      category_id: await ensureCategory(user.id, body.categoryId),
      updated_at: new Date().toISOString(),
      completed_at: completedAt
    }).eq('id', itemId).eq('user_id', user.id).select('id').maybeSingle()
    if (updated.error || !updated.data) apiError(404, '条目不存在')
    return getItem(user.id, itemId)
  }
  apiError(405, '操作方式不支持')
}

async function handleAsset(path: string, method: string) {
  if (method !== 'DELETE') apiError(405, '操作方式不支持')
  const match = path.match(/^\/api\/assets\/([0-9a-f-]+)$/i)
  if (!match) apiError(404, '图片不存在')
  const client = requireSupabase()
  const user = await currentUser()
  const result = await client.from('assets').select('*').eq('id', match[1]).eq('user_id', user.id).maybeSingle()
  if (result.error || !result.data) apiError(404, '图片不存在')
  const asset = result.data as CloudAssetRow
  if (asset.role === 'web_cover') apiError(400, '网页封面不能在这里删除')
  const itemRows = await loadItemRows(user.id, asset.item_id)
  if (!itemRows.length) apiError(404, '条目不存在')
  if (itemRows[0].kind === 'image_group') {
    const count = (itemRows[0].assets || []).filter((entry) => entry.role === 'gallery').length
    if (count <= 1) apiError(400, '图片组至少需要保留一张图片')
  }
  const deleted = await client.from('assets').delete().eq('id', asset.id).eq('user_id', user.id)
  if (deleted.error) apiError(500, '图片删除失败')
  await removeStorage([asset.original_path, asset.thumb_path])
  return getItem(user.id, asset.item_id)
}

export async function cloudApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = new URL(path, window.location.origin)
  const method = String(options.method || 'GET').toUpperCase()
  let result: unknown
  if (url.pathname === '/api/metadata') {
    result = await callServer(url.pathname, options)
  } else if (url.pathname.startsWith('/api/auth/')) {
    result = await handleAuth(url.pathname, method, options)
  } else if (url.pathname.startsWith('/api/categories')) {
    result = await handleCategories(url.pathname, method, options)
  } else if (url.pathname.startsWith('/api/items')) {
    result = await handleItems(url, method, options)
  } else if (url.pathname.startsWith('/api/assets/')) {
    result = await handleAsset(url.pathname, method)
  } else {
    apiError(404, '功能不存在')
  }
  return result as T
}
