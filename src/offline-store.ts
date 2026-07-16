import { useSyncExternalStore } from 'react'
import { ApiRequestError } from './api-error'
import { filterLibraryItems } from './offline-query'
import type {
  AppPreferences,
  AuthStatus,
  BulkItemChanges,
  Category,
  ImageAsset,
  ItemFilters,
  LibraryItem
} from './types'

const DB_NAME = 'do-it-laaaaaater-offline-v1'
const DB_VERSION = 1
const AUTH_KEY = 'do-it-laaaaaater.offline-auth.v1'
const OFFLINE_ASSET_PREFIX = 'offline-asset:'

type QueueState = 'pending' | 'failed'

type SerializedBody =
  | { kind: 'none' }
  | { kind: 'json'; value: Record<string, unknown> }
  | { kind: 'form'; entries: SerializedFormEntry[] }

interface SerializedFormEntry {
  name: string
  value: string | Blob
  fileName?: string
}

interface OfflineMutation {
  id: string
  userKey: string
  path: string
  method: string
  body: SerializedBody
  createdAt: number
  attempts: number
  state: QueueState
  lastError: string
  errorStatus?: number
  conflict?: boolean
}

interface OfflineSnapshotRecord {
  userKey: string
  items: LibraryItem[]
  categories: Category[]
  preferences: AppPreferences
  updatedAt: number
  itemsSyncedAt: number
  categoriesSyncedAt: number
  preferencesSyncedAt: number
}

interface OfflineBlobRecord {
  key: string
  userKey: string
  assetId: string
  variant: 'thumb' | 'original'
  blob: Blob
  size: number
  updatedAt: number
}

export interface OfflineQueueSummary {
  id: string
  label: string
  createdAt: number
  state: QueueState
  lastError: string
  conflict: boolean
}

export interface OfflineRuntimeState {
  online: boolean
  pendingCount: number
  failedCount: number
  syncing: boolean
  lastSyncedAt: number | null
  cacheUpdatedAt: number | null
  storageBytes: number
  warning: string
  cachePhase: 'idle' | 'running' | 'paused' | 'error'
  cacheCompleted: number
  cacheTotal: number
  cacheFailed: number
  storageUsage: number
  storageQuota: number
}

type RemoteSender = <T>(path: string, options?: RequestInit) => Promise<T>

let activeUserKey = ''
let databasePromise: Promise<IDBDatabase> | null = null
let sender: RemoteSender | null = null
let flushing = false
let initialized = false
let cacheWorkerRunning = false
let cachePaused = false
let cacheQueue: CacheTask[] = []
let failedCacheTasks: CacheTask[] = []
const queuedCacheKeys = new Set<string>()
const blobUrls = new Map<string, string>()
const listeners = new Set<() => void>()
let runtimeState: OfflineRuntimeState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pendingCount: 0,
  failedCount: 0,
  syncing: false,
  lastSyncedAt: null,
  cacheUpdatedAt: null,
  storageBytes: 0,
  warning: '',
  cachePhase: 'idle',
  cacheCompleted: 0,
  cacheTotal: 0,
  cacheFailed: 0,
  storageUsage: 0,
  storageQuota: 0
}

interface CacheTask {
  key: string
  userKey: string
  asset: ImageAsset
  variant: 'thumb' | 'original'
}

function publish(patch: Partial<OfflineRuntimeState>) {
  runtimeState = { ...runtimeState, ...patch }
  listeners.forEach((listener) => listener())
}

export function useOfflineRuntime() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => runtimeState,
    () => runtimeState
  )
}

function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('当前浏览器不支持离线存储'))
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('snapshots')) {
        database.createObjectStore('snapshots', { keyPath: 'userKey' })
      }
      if (!database.objectStoreNames.contains('queue')) {
        const store = database.createObjectStore('queue', { keyPath: 'id' })
        store.createIndex('userKey', 'userKey')
      }
      if (!database.objectStoreNames.contains('blobs')) {
        const store = database.createObjectStore('blobs', { keyPath: 'key' })
        store.createIndex('userKey', 'userKey')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开离线存储'))
    request.onblocked = () => reject(new Error('离线存储正在被旧页面占用，请关闭其他页面后重试'))
  })
  return databasePromise
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('离线存储操作失败'))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('离线存储事务已取消'))
    transaction.onerror = () => reject(transaction.error || new Error('离线存储事务失败'))
  })
}

function emptySnapshot(userKey: string): OfflineSnapshotRecord {
  return {
    userKey,
    items: [],
    categories: [],
    preferences: { quickSaveCategoryId: null },
    updatedAt: 0,
    itemsSyncedAt: 0,
    categoriesSyncedAt: 0,
    preferencesSyncedAt: 0
  }
}

async function readSnapshot(userKey = activeUserKey) {
  if (!userKey) throw new Error('尚未确定离线账户')
  const database = await openDatabase()
  const transaction = database.transaction('snapshots', 'readonly')
  const record = await requestResult(transaction.objectStore('snapshots').get(userKey)) as OfflineSnapshotRecord | undefined
  return record || emptySnapshot(userKey)
}

async function writeSnapshot(record: OfflineSnapshotRecord) {
  record.updatedAt = Date.now()
  const database = await openDatabase()
  const transaction = database.transaction('snapshots', 'readwrite')
  transaction.objectStore('snapshots').put(record)
  await transactionDone(transaction)
  publish({ cacheUpdatedAt: record.updatedAt })
}

function blobKey(userKey: string, assetId: string, variant: 'thumb' | 'original') {
  return `${userKey}:${assetId}:${variant}`
}

async function writeBlob(userKey: string, assetId: string, variant: 'thumb' | 'original', blob: Blob) {
  const key = blobKey(userKey, assetId, variant)
  const previousUrl = blobUrls.get(key)
  if (previousUrl) {
    URL.revokeObjectURL(previousUrl)
    blobUrls.delete(key)
  }
  const database = await openDatabase()
  const transaction = database.transaction('blobs', 'readwrite')
  const record: OfflineBlobRecord = {
    key,
    userKey,
    assetId,
    variant,
    blob,
    size: blob.size,
    updatedAt: Date.now()
  }
  transaction.objectStore('blobs').put(record)
  await transactionDone(transaction)
}

async function readBlob(userKey: string, assetId: string, variant: 'thumb' | 'original') {
  const database = await openDatabase()
  const transaction = database.transaction('blobs', 'readonly')
  return await requestResult(transaction.objectStore('blobs').get(blobKey(userKey, assetId, variant))) as OfflineBlobRecord | undefined
}

async function removeAssetBlobs(userKey: string, assetId: string) {
  const database = await openDatabase()
  const transaction = database.transaction('blobs', 'readwrite')
  for (const variant of ['thumb', 'original'] as const) {
    const key = blobKey(userKey, assetId, variant)
    transaction.objectStore('blobs').delete(key)
    const url = blobUrls.get(key)
    if (url) URL.revokeObjectURL(url)
    blobUrls.delete(key)
  }
  await transactionDone(transaction)
}

async function hydratedAssetUrl(userKey: string, asset: ImageAsset, variant: 'thumb' | 'original') {
  const original = variant === 'thumb' ? asset.thumbUrl : asset.originalUrl
  const cached = await readBlob(userKey, asset.id, variant)
  if (!cached) return original.startsWith(OFFLINE_ASSET_PREFIX) ? '' : original
  const key = blobKey(userKey, asset.id, variant)
  const current = blobUrls.get(key)
  if (current) return current
  const url = URL.createObjectURL(cached.blob)
  blobUrls.set(key, url)
  return url
}

async function hydrateItem(userKey: string, item: LibraryItem): Promise<LibraryItem> {
  const assets = await Promise.all(item.assets.map(async (asset) => ({
    ...asset,
    thumbUrl: await hydratedAssetUrl(userKey, asset, 'thumb'),
    originalUrl: await hydratedAssetUrl(userKey, asset, 'original')
  })))
  return { ...item, assets }
}

async function hydrateItems(userKey: string, items: LibraryItem[]) {
  return Promise.all(items.map((item) => hydrateItem(userKey, item)))
}

function canonicalAsset(asset: ImageAsset): ImageAsset {
  return {
    ...asset,
    thumbUrl: asset.thumbUrl.startsWith('blob:') ? OFFLINE_ASSET_PREFIX + asset.id + ':thumb' : asset.thumbUrl,
    originalUrl: asset.originalUrl.startsWith('blob:') ? OFFLINE_ASSET_PREFIX + asset.id + ':original' : asset.originalUrl
  }
}

function canonicalItem(item: LibraryItem): LibraryItem {
  return { ...item, assets: item.assets.map(canonicalAsset) }
}

function rememberAuth(status: AuthStatus) {
  try {
    if (status.authenticated && status.user?.email) {
      localStorage.setItem(AUTH_KEY, JSON.stringify(status))
      configureOfflineUser(status.user.email)
    } else if (!status.authenticated) {
      localStorage.removeItem(AUTH_KEY)
    }
  } catch {
    // IndexedDB data remains usable in the current page when localStorage is disabled.
  }
}

function cachedAuth() {
  try {
    const value = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null') as AuthStatus | null
    if (value?.authenticated && value.user?.email) configureOfflineUser(value.user.email)
    return value
  } catch {
    return null
  }
}

export function configureOfflineUser(email: string) {
  const next = email.trim().toLocaleLowerCase('en-US')
  if (!next || next === activeUserKey) return
  cacheQueue = []
  failedCacheTasks = []
  queuedCacheKeys.clear()
  activeUserKey = next
  publish({ cachePhase: 'idle', cacheCompleted: 0, cacheTotal: 0, cacheFailed: 0 })
  void refreshRuntimeCounts()
}

async function allQueueEntries(userKey = activeUserKey) {
  if (!userKey) return []
  const database = await openDatabase()
  const transaction = database.transaction('queue', 'readonly')
  const index = transaction.objectStore('queue').index('userKey')
  const entries = await requestResult(index.getAll(userKey)) as OfflineMutation[]
  return entries.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

async function allBlobRecords(userKey = activeUserKey) {
  if (!userKey) return []
  const database = await openDatabase()
  const transaction = database.transaction('blobs', 'readonly')
  return await requestResult(transaction.objectStore('blobs').index('userKey').getAll(userKey)) as OfflineBlobRecord[]
}

async function refreshRuntimeCounts() {
  if (!activeUserKey) return
  try {
    const [entries, snapshot, bytes, estimate] = await Promise.all([
      allQueueEntries(),
      readSnapshot(),
      offlineStorageBytes(),
      navigator.storage?.estimate?.().catch(() => ({})) || Promise.resolve({})
    ])
    const storageEstimate = estimate as StorageEstimate
    const usage = Number(storageEstimate.usage || 0)
    const quota = Number(storageEstimate.quota || 0)
    const remaining = Math.max(0, quota - usage)
    const storageWarning = quota && (remaining < 50 * 1024 * 1024 || usage / quota > 0.95)
      ? '浏览器可用空间不足，图片后台缓存已暂停。清理缓存或设备空间后可继续。'
      : ''
    if (storageWarning) cachePaused = true
    publish({
      pendingCount: entries.filter((entry) => entry.state === 'pending').length,
      failedCount: entries.filter((entry) => entry.state === 'failed').length,
      cacheUpdatedAt: snapshot.updatedAt || null,
      storageBytes: bytes,
      storageUsage: usage,
      storageQuota: quota,
      cachePhase: storageWarning ? 'paused' : runtimeState.cachePhase,
      warning: storageWarning || runtimeState.warning
    })
  } catch (error) {
    publish({ warning: error instanceof Error ? error.message : '无法读取离线存储' })
  }
}

async function putQueueEntry(entry: OfflineMutation) {
  const database = await openDatabase()
  const transaction = database.transaction('queue', 'readwrite')
  transaction.objectStore('queue').put(entry)
  await transactionDone(transaction)
}

async function deleteQueueEntries(ids: string[]) {
  if (!ids.length) return
  const database = await openDatabase()
  const transaction = database.transaction('queue', 'readwrite')
  ids.forEach((id) => transaction.objectStore('queue').delete(id))
  await transactionDone(transaction)
}

function requestMethod(options: RequestInit) {
  return String(options.method || 'GET').toUpperCase()
}

function serializeBody(body: BodyInit | null | undefined): SerializedBody {
  if (!body) return { kind: 'none' }
  if (typeof body === 'string') {
    try {
      return { kind: 'json', value: JSON.parse(body) as Record<string, unknown> }
    } catch {
      throw new ApiRequestError(400, '提交的内容格式无效')
    }
  }
  if (body instanceof FormData) {
    const entries: SerializedFormEntry[] = []
    body.forEach((value, name) => {
      entries.push({
        name,
        value,
        fileName: value instanceof File ? value.name : undefined
      })
    })
    return { kind: 'form', entries }
  }
  throw new ApiRequestError(400, '此操作无法在断网时排队')
}

function deserializeBody(body: SerializedBody): BodyInit | undefined {
  if (body.kind === 'none') return undefined
  if (body.kind === 'json') return JSON.stringify(body.value)
  const form = new FormData()
  body.entries.forEach((entry) => {
    if (entry.value instanceof Blob) form.append(entry.name, entry.value, entry.fileName || 'image')
    else form.append(entry.name, entry.value)
  })
  return form
}

function jsonField(body: SerializedBody, name: string) {
  return body.kind === 'json' ? body.value[name] : undefined
}

function formStrings(body: SerializedBody, name: string) {
  if (body.kind !== 'form') return []
  return body.entries.filter((entry) => entry.name === name && typeof entry.value === 'string')
    .map((entry) => entry.value as string)
}

function formString(body: SerializedBody, name: string) {
  return formStrings(body, name)[0] || ''
}

function formFiles(body: SerializedBody, name = 'images') {
  if (body.kind !== 'form') return []
  return body.entries.filter((entry) => entry.name === name && entry.value instanceof Blob)
}

function setBodyField(body: SerializedBody, name: string, value: unknown) {
  if (body.kind === 'json') {
    body.value[name] = value
    return
  }
  if (body.kind === 'form') {
    body.entries = body.entries.filter((entry) => entry.name !== name)
    body.entries.push({ name, value: String(value) })
  }
}

function prepareMutation(path: string, method: string, options: RequestInit) {
  const body = serializeBody(options.body)
  const now = Date.now()
  if (path === '/api/categories' && method === 'POST') setBodyField(body, 'id', crypto.randomUUID())
  if ((path === '/api/items/text' || path === '/api/items/link' || path === '/api/items/image-group') && method === 'POST') {
    setBodyField(body, 'id', crypto.randomUUID())
    setBodyField(body, 'createdAt', now)
    if (body.kind === 'form') {
      setBodyField(body, 'assetIds', JSON.stringify(formFiles(body).map(() => crypto.randomUUID())))
    }
  }
  if (/^\/api\/items\/[0-9a-f-]+\/assets$/i.test(path) && method === 'POST' && body.kind === 'form') {
    setBodyField(body, 'assetIds', JSON.stringify(formFiles(body).map(() => crypto.randomUUID())))
  }
  return { body, now }
}

function bodyRecord(body: SerializedBody) {
  return body.kind === 'json' ? body.value : {} as Record<string, unknown>
}

function bodyId(body: SerializedBody) {
  return String(body.kind === 'json' ? body.value.id || '' : formString(body, 'id'))
}

function assetIds(body: SerializedBody) {
  try {
    const value = formString(body, 'assetIds')
    const parsed = JSON.parse(value || '[]') as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function categoryFor(snapshot: OfflineSnapshotRecord, categoryId: unknown) {
  const id = String(categoryId || '')
  return snapshot.categories.find((category) => category.id === id) || null
}

function normalizedUrl(value: string) {
  try {
    const result = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : 'https://' + value.trim())
    result.hash = ''
    return result.toString()
  } catch {
    throw new ApiRequestError(400, '网址无效')
  }
}

function patchLocalItem(snapshot: OfflineSnapshotRecord, item: LibraryItem, changes: Record<string, unknown>) {
  const status = changes.status === 'completed' || changes.status === 'pending' ? changes.status : item.status
  const categoryChanged = Object.prototype.hasOwnProperty.call(changes, 'categoryId')
  return {
    ...item,
    title: Object.prototype.hasOwnProperty.call(changes, 'title') ? String(changes.title || item.title) : item.title,
    url: item.kind === 'link' && Object.prototype.hasOwnProperty.call(changes, 'url')
      ? normalizedUrl(String(changes.url || item.url || ''))
      : item.url,
    status,
    category: categoryChanged ? categoryFor(snapshot, changes.categoryId) : item.category,
    isStarred: Object.prototype.hasOwnProperty.call(changes, 'isStarred') ? Boolean(changes.isStarred) : item.isStarred,
    plannedFor: status === 'completed'
      ? null
      : (Object.prototype.hasOwnProperty.call(changes, 'plannedFor') ? String(changes.plannedFor || '') || null : item.plannedFor),
    completedAt: status === 'completed' ? (item.completedAt || Date.now()) : null,
    updatedAt: Date.now()
  } satisfies LibraryItem
}

async function localThumbnail(blob: Blob) {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 720 / bitmap.width, 720 / bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return blob
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((thumb) => resolve(thumb || blob), 'image/webp', 0.82)
    })
  } catch {
    return blob
  }
}

async function localAssets(userKey: string, body: SerializedBody, role: ImageAsset['role'], startOrder = 0) {
  const files = formFiles(body)
  const ids = assetIds(body)
  return await Promise.all(files.map(async (entry, index) => {
    const id = ids[index] || crypto.randomUUID()
    const blob = entry.value as Blob
    const thumb = await localThumbnail(blob)
    await Promise.all([
      writeBlob(userKey, id, 'original', blob),
      writeBlob(userKey, id, 'thumb', thumb)
    ])
    return {
      id,
      role,
      originalName: entry.fileName || 'image',
      mimeType: blob.type || 'image/jpeg',
      size: blob.size,
      width: null,
      height: null,
      sortOrder: startOrder + index,
      thumbUrl: OFFLINE_ASSET_PREFIX + id + ':thumb',
      originalUrl: OFFLINE_ASSET_PREFIX + id + ':original'
    } satisfies ImageAsset
  }))
}

async function applyLocalMutation(snapshot: OfflineSnapshotRecord, mutation: Pick<OfflineMutation, 'path' | 'method' | 'body'>) {
  const { path, method, body } = mutation
  const record = bodyRecord(body)
  if (path === '/api/categories' && method === 'POST') {
    const category: Category = {
      id: bodyId(body),
      name: String(record.name || '').trim().slice(0, 40),
      color: String(record.color || '#64748b').toLowerCase(),
      sort_order: snapshot.categories.length
    }
    if (!category.name) throw new ApiRequestError(400, '请填写类别名称')
    snapshot.categories.push(category)
    return category
  }
  const categoryMatch = path.match(/^\/api\/categories\/([0-9a-f-]+)$/i)
  if (categoryMatch && method === 'PUT') {
    const category = snapshot.categories.find((entry) => entry.id === categoryMatch[1])
    if (!category) throw new ApiRequestError(404, '类别不存在')
    category.name = String(record.name || category.name).trim().slice(0, 40)
    category.color = String(record.color || category.color).toLowerCase()
    snapshot.items = snapshot.items.map((item) => item.category?.id === category.id ? { ...item, category: { ...category } } : item)
    return { ...category }
  }
  if (categoryMatch && method === 'DELETE') {
    snapshot.categories = snapshot.categories.filter((entry) => entry.id !== categoryMatch[1])
    snapshot.items = snapshot.items.map((item) => item.category?.id === categoryMatch[1] ? { ...item, category: null } : item)
    if (snapshot.preferences.quickSaveCategoryId === categoryMatch[1]) snapshot.preferences.quickSaveCategoryId = null
    return { ok: true }
  }
  if (path === '/api/preferences' && method === 'PATCH') {
    snapshot.preferences = { quickSaveCategoryId: String(record.quickSaveCategoryId || '') || null }
    return { ...snapshot.preferences }
  }
  if (path === '/api/items/text' && method === 'POST') {
    const createdAt = Number(record.createdAt || Date.now())
    const item: LibraryItem = {
      id: bodyId(body),
      kind: 'text',
      title: String(record.title || '').trim(),
      url: null,
      status: 'pending',
      category: categoryFor(snapshot, record.categoryId),
      assets: [],
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      isStarred: false,
      plannedFor: null,
      trashedAt: null
    }
    if (!item.title) throw new ApiRequestError(400, '请填写标题')
    snapshot.items.unshift(item)
    return item
  }
  if ((path === '/api/items/link' || path === '/api/items/image-group') && method === 'POST') {
    const kind = path.endsWith('/link') ? 'link' : 'image_group'
    const url = kind === 'link' ? normalizedUrl(formString(body, 'url')) : null
    if (url && snapshot.items.some((item) => item.kind === 'link' && item.url === url)) {
      const duplicate = snapshot.items.find((item) => item.kind === 'link' && item.url === url)
      throw new ApiRequestError(409, duplicate?.trashedAt ? '这个网页在回收站中' : '这个网页已经保存过了', {
        existingId: duplicate?.id,
        trashed: Boolean(duplicate?.trashedAt)
      })
    }
    const role = kind === 'link' ? 'attachment' : 'gallery'
    const assets = await localAssets(snapshot.userKey, body, role)
    if (kind === 'image_group' && !assets.length) throw new ApiRequestError(400, '请至少添加一张图片')
    const createdAt = Number(formString(body, 'createdAt') || Date.now())
    const item: LibraryItem = {
      id: bodyId(body),
      kind,
      title: formString(body, 'title').trim() || (kind === 'link' ? new URL(url as string).hostname : '图片组'),
      url,
      status: 'pending',
      category: categoryFor(snapshot, formString(body, 'categoryId')),
      assets,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      isStarred: false,
      plannedFor: null,
      trashedAt: null
    }
    snapshot.items.unshift(item)
    return item
  }
  if (path === '/api/items/bulk' && method === 'POST') {
    const ids = Array.isArray(record.ids) ? record.ids.map(String) : []
    if (record.permanentDelete === true) {
      const removed = snapshot.items.filter((item) => ids.includes(item.id) && item.trashedAt)
      snapshot.items = snapshot.items.filter((item) => !removed.some((entry) => entry.id === item.id))
      await Promise.all(removed.flatMap((item) => item.assets.map((asset) => removeAssetBlobs(snapshot.userKey, asset.id))))
      return { updated: 0, deleted: removed.length, succeededIds: removed.map((item) => item.id), failed: [] }
    }
    if (record.delete === true || record.restore === true) {
      const trashedAt = record.restore === true ? null : Date.now()
      snapshot.items = snapshot.items.map((item) => ids.includes(item.id) ? {
        ...item,
        trashedAt,
        updatedAt: Date.now()
      } : item)
      return {
        updated: record.restore === true ? ids.length : 0,
        deleted: record.delete === true ? ids.length : 0,
        succeededIds: ids,
        failed: []
      }
    }
    const changes = record.changes && typeof record.changes === 'object' ? record.changes as Record<string, unknown> : {}
    snapshot.items = snapshot.items.map((item) => ids.includes(item.id) ? patchLocalItem(snapshot, item, changes) : item)
    return { updated: ids.length, deleted: 0, succeededIds: ids, failed: [] }
  }
  const assetOrderMatch = path.match(/^\/api\/items\/([0-9a-f-]+)\/assets\/order$/i)
  if (assetOrderMatch && method === 'PUT') {
    const item = snapshot.items.find((entry) => entry.id === assetOrderMatch[1])
    if (!item) throw new ApiRequestError(404, '条目不存在')
    const ids = Array.isArray(record.ids) ? record.ids.map(String) : []
    const covers = item.assets.filter((asset) => asset.role === 'web_cover')
    const manual = item.assets.filter((asset) => asset.role !== 'web_cover')
    item.assets = [...covers, ...ids.map((id, index) => ({ ...manual.find((asset) => asset.id === id) as ImageAsset, sortOrder: index }))]
    item.updatedAt = Date.now()
    return item
  }
  const assetAddMatch = path.match(/^\/api\/items\/([0-9a-f-]+)\/assets$/i)
  if (assetAddMatch && method === 'POST') {
    const item = snapshot.items.find((entry) => entry.id === assetAddMatch[1])
    if (!item) throw new ApiRequestError(404, '条目不存在')
    const manual = item.assets.filter((asset) => asset.role !== 'web_cover')
    const added = await localAssets(snapshot.userKey, body, item.kind === 'link' ? 'attachment' : 'gallery', manual.length)
    item.assets = [...item.assets, ...added]
    item.updatedAt = Date.now()
    return item
  }
  const assetDeleteMatch = path.match(/^\/api\/assets\/([0-9a-f-]+)$/i)
  if (assetDeleteMatch && method === 'DELETE') {
    const item = snapshot.items.find((entry) => entry.assets.some((asset) => asset.id === assetDeleteMatch[1]))
    if (!item) throw new ApiRequestError(404, '图片不存在')
    const manual = item.assets.filter((asset) => asset.role !== 'web_cover')
    if (item.kind === 'image_group' && manual.length <= 1) throw new ApiRequestError(400, '图片组至少需要保留一张图片')
    item.assets = item.assets.filter((asset) => asset.id !== assetDeleteMatch[1])
    item.updatedAt = Date.now()
    await removeAssetBlobs(snapshot.userKey, assetDeleteMatch[1])
    return item
  }
  if (path === '/api/items/trash/empty' && method === 'POST') {
    const removed = snapshot.items.filter((item) => item.trashedAt)
    snapshot.items = snapshot.items.filter((item) => !item.trashedAt)
    await Promise.all(removed.flatMap((item) => item.assets.map((asset) => removeAssetBlobs(snapshot.userKey, asset.id))))
    return { deleted: removed.length }
  }
  const restoreMatch = path.match(/^\/api\/items\/([0-9a-f-]+)\/restore$/i)
  if (restoreMatch && method === 'POST') {
    const item = snapshot.items.find((entry) => entry.id === restoreMatch[1])
    if (!item) throw new ApiRequestError(404, '条目不存在')
    item.trashedAt = null
    item.updatedAt = Date.now()
    return item
  }
  const permanentMatch = path.match(/^\/api\/items\/([0-9a-f-]+)\/permanent$/i)
  if (permanentMatch && method === 'DELETE') {
    const item = snapshot.items.find((entry) => entry.id === permanentMatch[1])
    if (!item) throw new ApiRequestError(404, '条目不存在')
    if (!item.trashedAt) throw new ApiRequestError(400, '请先把条目移到回收站')
    snapshot.items = snapshot.items.filter((entry) => entry.id !== permanentMatch[1])
    await Promise.all(item.assets.map((asset) => removeAssetBlobs(snapshot.userKey, asset.id)))
    return { ok: true }
  }
  const itemMatch = path.match(/^\/api\/items\/([0-9a-f-]+)$/i)
  if (itemMatch && method === 'DELETE') {
    const item = snapshot.items.find((entry) => entry.id === itemMatch[1])
    if (item) {
      item.trashedAt = item.trashedAt || Date.now()
      item.updatedAt = Date.now()
    }
    return { ok: true, item }
  }
  if (itemMatch && (method === 'PUT' || method === 'PATCH')) {
    const index = snapshot.items.findIndex((entry) => entry.id === itemMatch[1])
    if (index < 0) throw new ApiRequestError(404, '条目不存在')
    snapshot.items[index] = patchLocalItem(snapshot, snapshot.items[index], record)
    return snapshot.items[index]
  }
  throw new ApiRequestError(400, '此操作暂不支持断网排队')
}

function queueLabel(entry: Pick<OfflineMutation, 'path' | 'method'>) {
  if (entry.path === '/api/categories') return '新增类别'
  if (entry.path.startsWith('/api/categories/')) return entry.method === 'DELETE' ? '删除类别' : '修改类别'
  if (entry.path === '/api/preferences') return '更新默认类别'
  if (entry.path === '/api/items/link') return '保存网页'
  if (entry.path === '/api/items/text') return '保存文本'
  if (entry.path === '/api/items/image-group') return '保存图片组'
  if (entry.path === '/api/items/bulk') return '批量修改条目'
  if (entry.path === '/api/items/trash/empty') return '清空回收站'
  if (entry.path.endsWith('/restore')) return '恢复条目'
  if (entry.path.endsWith('/permanent')) return '彻底删除条目'
  if (entry.path.includes('/assets/order')) return '调整图片顺序'
  if (entry.path.endsWith('/assets')) return '添加图片'
  if (entry.path.startsWith('/api/assets/')) return '删除图片'
  if (entry.path.startsWith('/api/items/')) return entry.method === 'DELETE' ? '删除条目' : '修改条目'
  return '同步本地修改'
}

function referencesItem(entry: OfflineMutation, itemId: string) {
  if (entry.path.includes(itemId)) return true
  if (entry.body.kind === 'json') {
    if (String(entry.body.value.id || '') === itemId) return true
    if (String(entry.body.value.itemId || '') === itemId) return true
    if (Array.isArray(entry.body.value.ids) && entry.body.value.ids.map(String).includes(itemId)) return true
  }
  return false
}

function referencesCategory(entry: OfflineMutation, categoryId: string) {
  if (entry.path === '/api/categories' && bodyId(entry.body) === categoryId) return true
  return entry.path === `/api/categories/${categoryId}`
}

async function addOrCompactQueue(entry: OfflineMutation) {
  const entries = await allQueueEntries(entry.userKey)
  if (entry.method === 'PATCH' && entry.body.kind === 'json') {
    const existing = [...entries].reverse().find((candidate) => (
      candidate.state === 'pending' && candidate.method === 'PATCH' && candidate.path === entry.path && candidate.body.kind === 'json'
    ))
    if (existing && existing.body.kind === 'json') {
      const originalBase = existing.body.value.baseUpdatedAt
      existing.body.value = { ...existing.body.value, ...entry.body.value }
      if (originalBase !== undefined) existing.body.value.baseUpdatedAt = originalBase
      existing.createdAt = entry.createdAt
      await putQueueEntry(existing)
      return
    }
  }
  await putQueueEntry(entry)
}

export function isOfflineReadable(path: string, method: string) {
  if (method !== 'GET') return false
  const pathname = new URL(path, location.origin).pathname
  return pathname === '/api/auth/status' || pathname === '/api/categories' || pathname === '/api/preferences' || pathname.startsWith('/api/items')
}

export function isOfflineQueueable(path: string, method: string) {
  const pathname = new URL(path, location.origin).pathname
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/backup/') || pathname === '/api/metadata') return false
  if (pathname.endsWith('/cover')) return false
  return pathname === '/api/categories' || pathname.startsWith('/api/categories/') || pathname === '/api/preferences' ||
    pathname === '/api/items/link' || pathname === '/api/items/text' || pathname === '/api/items/image-group' ||
    pathname === '/api/items/bulk' || pathname.startsWith('/api/items/') || pathname.startsWith('/api/assets/')
}

export async function readOfflineApi<T>(path: string): Promise<T> {
  const url = new URL(path, location.origin)
  if (url.pathname === '/api/auth/status') {
    const auth = cachedAuth()
    if (!auth) throw new ApiRequestError(503, '首次登录需要联网；当前没有可用的离线账户')
    publish({ online: false })
    return auth as T
  }
  const snapshot = await readSnapshot()
  if (!snapshot.updatedAt) throw new ApiRequestError(503, '还没有完成过在线同步，暂时没有可用的离线内容')
  publish({ online: false, cacheUpdatedAt: snapshot.updatedAt })
  if (url.pathname === '/api/categories') {
    if (!snapshot.categoriesSyncedAt) throw new ApiRequestError(503, '类别尚未完成过在线同步')
    return snapshot.categories.map((entry) => ({ ...entry })) as T
  }
  if (url.pathname === '/api/preferences') {
    if (!snapshot.preferencesSyncedAt) throw new ApiRequestError(503, '偏好设置尚未完成过在线同步')
    return { ...snapshot.preferences } as T
  }
  if (url.pathname === '/api/items') {
    if (!snapshot.itemsSyncedAt) throw new ApiRequestError(503, '清单尚未完成过在线同步')
    const filters: ItemFilters = {
      status: (url.searchParams.get('status') as ItemFilters['status']) || 'all',
      kind: (url.searchParams.get('kind') as ItemFilters['kind']) || 'all',
      category: url.searchParams.get('category') || '',
      date: url.searchParams.get('date') || '',
      q: url.searchParams.get('q') || '',
      priority: (url.searchParams.get('priority') as ItemFilters['priority']) || 'all',
      sort: (url.searchParams.get('sort') as ItemFilters['sort']) || 'newest',
      trash: (url.searchParams.get('trash') as ItemFilters['trash']) || 'active'
    }
    return await hydrateItems(snapshot.userKey, filterLibraryItems(snapshot.items, filters)) as T
  }
  const itemMatch = url.pathname.match(/^\/api\/items\/([0-9a-f-]+)$/i)
  if (itemMatch) {
    const item = snapshot.items.find((entry) => entry.id === itemMatch[1])
    if (!item) throw new ApiRequestError(404, '条目不存在')
    return await hydrateItem(snapshot.userKey, item) as T
  }
  throw new ApiRequestError(404, '离线缓存中没有这项内容')
}

export async function enqueueOfflineApi<T>(path: string, options: RequestInit): Promise<T> {
  if (!activeUserKey) throw new ApiRequestError(503, '无法确定当前账户，暂时不能保存离线修改')
  const method = requestMethod(options)
  const url = new URL(path, location.origin)
  const prepared = prepareMutation(url.pathname, method, options)
  const mutation: OfflineMutation = {
    id: crypto.randomUUID(),
    userKey: activeUserKey,
    path: url.pathname + url.search,
    method,
    body: prepared.body,
    createdAt: prepared.now,
    attempts: 0,
    state: 'pending',
    lastError: ''
  }
  const snapshot = await readSnapshot()
  const versionedItemMatch = mutation.path.match(/^\/api\/items\/([0-9a-f-]+)(?:\/assets(?:\/order)?)?$/i)
  let versionedItem = versionedItemMatch
    ? snapshot.items.find((entry) => entry.id === versionedItemMatch[1])
    : undefined
  if (!versionedItem && mutation.path.startsWith('/api/assets/')) {
    const assetId = mutation.path.split('/').pop()
    versionedItem = snapshot.items.find((entry) => entry.assets.some((asset) => asset.id === assetId))
  }
  if (versionedItem && ['PUT', 'PATCH', 'DELETE', 'POST'].includes(method)) {
    if (mutation.body.kind === 'none') mutation.body = { kind: 'json', value: {} }
    setBodyField(mutation.body, 'baseUpdatedAt', versionedItem.updatedAt)
    setBodyField(mutation.body, 'itemId', versionedItem.id)
  }
  const result = await applyLocalMutation(snapshot, mutation)

  await addOrCompactQueue(mutation)
  await writeSnapshot(snapshot)
  await refreshRuntimeCounts()
  publish({ online: false })
  if (result && typeof result === 'object' && 'assets' in result) {
    return await hydrateItem(activeUserKey, result as LibraryItem) as T
  }
  return result as T
}

function replaceItem(snapshot: OfflineSnapshotRecord, item: LibraryItem) {
  const canonical = canonicalItem(item)
  const index = snapshot.items.findIndex((entry) => entry.id === canonical.id)
  if (index >= 0) snapshot.items[index] = canonical
  else snapshot.items.unshift(canonical)
}

async function fetchAndStoreAsset(userKey: string, asset: ImageAsset, variant: 'thumb' | 'original') {
  if (await readBlob(userKey, asset.id, variant)) return
  const url = variant === 'thumb' ? asset.thumbUrl : asset.originalUrl
  if (!url || url.startsWith(OFFLINE_ASSET_PREFIX) || url.startsWith('blob:')) return
  const response = await fetch(url, { credentials: url.startsWith(location.origin) || url.startsWith('/') ? 'same-origin' : 'omit' })
  if (!response.ok) throw new Error('图片缓存失败')
  const blob = await response.blob()
  if (!blob.size) throw new Error('图片缓存内容为空')
  await writeBlob(userKey, asset.id, variant, blob)
}

function cacheTaskKey(userKey: string, asset: ImageAsset, variant: 'thumb' | 'original') {
  return `${userKey}:${asset.id}:${variant}`
}

function queueAssetCaching(userKey: string, items: LibraryItem[]) {
  const startsFresh = !cacheWorkerRunning && !cacheQueue.length && runtimeState.cachePhase === 'idle'
  if (startsFresh) publish({ cacheCompleted: 0, cacheTotal: 0, cacheFailed: failedCacheTasks.length })
  const assets = items.flatMap((item) => item.assets)
  const tasks: CacheTask[] = [
    ...assets.map((asset) => ({ key: cacheTaskKey(userKey, asset, 'thumb'), userKey, asset, variant: 'thumb' as const })),
    ...assets.map((asset) => ({ key: cacheTaskKey(userKey, asset, 'original'), userKey, asset, variant: 'original' as const }))
  ]
  tasks.forEach((task) => {
    if (queuedCacheKeys.has(task.key)) return
    queuedCacheKeys.add(task.key)
    cacheQueue.push(task)
  })
  publish({
    cacheTotal: runtimeState.cacheCompleted + cacheQueue.length,
    cachePhase: cachePaused ? 'paused' : (cacheQueue.length ? 'running' : runtimeState.cachePhase)
  })
  if (!cachePaused) void runCacheWorker()
}

async function runCacheWorker() {
  if (cacheWorkerRunning || cachePaused || !cacheQueue.length) return
  cacheWorkerRunning = true
  publish({ cachePhase: 'running' })
  try {
    while (cacheQueue.length && !cachePaused) {
      const task = cacheQueue.shift() as CacheTask
      try {
        await fetchAndStoreAsset(task.userKey, task.asset, task.variant)
      } catch (error) {
        failedCacheTasks.push(task)
        const message = error instanceof DOMException && error.name === 'QuotaExceededError'
          ? '浏览器空间不足，图片后台缓存已暂停。'
          : runtimeState.warning
        if (error instanceof DOMException && error.name === 'QuotaExceededError') cachePaused = true
        publish({ warning: message })
      } finally {
        queuedCacheKeys.delete(task.key)
        publish({
          cacheCompleted: runtimeState.cacheCompleted + 1,
          cacheFailed: failedCacheTasks.length,
          cachePhase: cachePaused ? 'paused' : 'running'
        })
      }
    }
  } finally {
    cacheWorkerRunning = false
    await refreshRuntimeCounts()
    publish({
      cachePhase: cachePaused ? 'paused' : failedCacheTasks.length ? 'error' : 'idle',
      cacheTotal: Math.max(runtimeState.cacheTotal, runtimeState.cacheCompleted)
    })
  }
}

export function pauseOfflineImageCache() {
  cachePaused = true
  try { localStorage.setItem('do-it-laaaaaater.cache-paused.v1', '1') } catch { /* ignore */ }
  publish({ cachePhase: 'paused' })
}

export function resumeOfflineImageCache() {
  cachePaused = false
  try { localStorage.removeItem('do-it-laaaaaater.cache-paused.v1') } catch { /* ignore */ }
  publish({ cachePhase: cacheQueue.length ? 'running' : failedCacheTasks.length ? 'error' : 'idle', warning: '' })
  void runCacheWorker()
}

export function retryOfflineImageCache() {
  const tasks = failedCacheTasks
  failedCacheTasks = []
  tasks.forEach((task) => {
    if (queuedCacheKeys.has(task.key)) return
    queuedCacheKeys.add(task.key)
    cacheQueue.push(task)
  })
  cachePaused = false
  publish({
    cacheFailed: 0,
    cacheCompleted: 0,
    cacheTotal: cacheQueue.length,
    cachePhase: cacheQueue.length ? 'running' : 'idle',
    warning: ''
  })
  void runCacheWorker()
}

export async function rememberSuccessfulApi(path: string, options: RequestInit, result: unknown) {
  const method = requestMethod(options)
  const url = new URL(path, location.origin)
  if (url.pathname === '/api/auth/status' && method === 'GET') {
    rememberAuth(result as AuthStatus)
    return
  }
  if (!activeUserKey) return
  if (url.pathname === '/api/auth/logout' && method === 'POST') {
    await clearOfflineUserData(activeUserKey)
    try { localStorage.removeItem(AUTH_KEY) } catch { /* ignore */ }
    return
  }
  if (!isOfflineReadable(path, method) && !isOfflineQueueable(path, method)) return
  const snapshot = await readSnapshot()
  if (url.pathname === '/api/categories' && method === 'GET') {
    const queued = await allQueueEntries()
    const deleted = new Set(queued.flatMap((entry) => {
      const match = entry.method === 'DELETE' ? entry.path.match(/^\/api\/categories\/([0-9a-f-]+)$/i) : null
      return match ? [match[1]] : []
    }))
    const merged = (result as Category[]).filter((entry) => !deleted.has(entry.id)).map((entry) => ({ ...entry }))
    snapshot.categories.forEach((localCategory) => {
      if (deleted.has(localCategory.id) || !queued.some((entry) => referencesCategory(entry, localCategory.id))) return
      const index = merged.findIndex((entry) => entry.id === localCategory.id)
      if (index >= 0) merged[index] = localCategory
      else merged.push(localCategory)
    })
    snapshot.categories = merged
    snapshot.categoriesSyncedAt = Date.now()
  }
  else if (url.pathname === '/api/preferences' && (method === 'GET' || method === 'PATCH')) {
    const queuedPreference = method === 'GET' && (await allQueueEntries()).some((entry) => entry.path === '/api/preferences')
    if (!queuedPreference) snapshot.preferences = { ...(result as AppPreferences) }
    snapshot.preferencesSyncedAt = Date.now()
  }
  else if (url.pathname === '/api/items' && method === 'GET') {
    const items = (result as LibraryItem[]).map(canonicalItem)
    const isCompleteList = (!url.searchParams.get('status') || url.searchParams.get('status') === 'all') &&
      !url.searchParams.get('kind') && !url.searchParams.get('category') && !url.searchParams.get('date') &&
      !url.searchParams.get('q') && !url.searchParams.get('priority') && url.searchParams.get('trash') === 'all'
    if (isCompleteList) {
      const queued = await allQueueEntries()
      const merged = [...items]
      snapshot.items.forEach((localItem) => {
        if (!queued.some((entry) => referencesItem(entry, localItem.id))) return
        const index = merged.findIndex((item) => item.id === localItem.id)
        if (index >= 0) merged[index] = localItem
        else merged.push(localItem)
      })
      snapshot.items = merged
      snapshot.itemsSyncedAt = Date.now()
    }
    else items.forEach((item) => replaceItem(snapshot, item))
  } else if (result && typeof result === 'object' && 'id' in result && 'kind' in result) {
    replaceItem(snapshot, result as LibraryItem)
  } else if (url.pathname === '/api/categories' && method === 'POST') {
    const category = result as Category
    snapshot.categories = [...snapshot.categories.filter((entry) => entry.id !== category.id), { ...category }]
  } else {
    try {
      await applyLocalMutation(snapshot, { path: url.pathname, method, body: serializeBody(options.body) })
    } catch {
      // A subsequent complete library refresh remains the source of truth.
    }
  }
  await writeSnapshot(snapshot)
  const itemsToCache = url.pathname === '/api/items' && method === 'GET'
    ? result as LibraryItem[]
    : (result && typeof result === 'object' && 'assets' in result ? [result as LibraryItem] : [])
  if (itemsToCache.length) queueAssetCaching(activeUserKey, itemsToCache)
  publish({
    online: true,
    lastSyncedAt: Date.now(),
    warning: runtimeState.warning
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '同步失败'
}

function isRetryable(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (error instanceof ApiRequestError) return error.status >= 500 || error.status === 408 || error.status === 429
  return error instanceof TypeError || /fetch|network|网络|连接/i.test(errorMessage(error))
}

export async function flushOfflineQueue() {
  if (flushing || !sender || !activeUserKey || !navigator.onLine) return
  flushing = true
  publish({ syncing: true, online: true })
  try {
    const entries = await allQueueEntries()
    for (const entry of entries) {
      if (entry.state === 'failed') break
      try {
        const options: RequestInit = { method: entry.method, body: deserializeBody(entry.body) }
        const result = await sender(entry.path, options)
        await rememberSuccessfulApi(entry.path, options, result)
        if (result && typeof result === 'object' && 'id' in result && 'updatedAt' in result) {
          const item = result as LibraryItem
          const laterEntries = await allQueueEntries()
          await Promise.all(laterEntries.filter((candidate) => candidate.id !== entry.id && referencesItem(candidate, item.id)).map(async (candidate) => {
            if (candidate.body.kind === 'none') candidate.body = { kind: 'json', value: {} }
            setBodyField(candidate.body, 'baseUpdatedAt', item.updatedAt)
            setBodyField(candidate.body, 'itemId', item.id)
            await putQueueEntry(candidate)
          }))
        }
        await deleteQueueEntries([entry.id])
        await refreshRuntimeCounts()
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404 && entry.method === 'DELETE') {
          await deleteQueueEntries([entry.id])
          await refreshRuntimeCounts()
          continue
        }
        entry.attempts += 1
        entry.lastError = errorMessage(error)
        entry.errorStatus = error instanceof ApiRequestError ? error.status : undefined
        entry.conflict = error instanceof ApiRequestError && Boolean((error.details as { conflict?: boolean } | undefined)?.conflict)
        if (!isRetryable(error)) entry.state = 'failed'
        await putQueueEntry(entry)
        publish({ online: navigator.onLine, warning: entry.state === 'failed' ? entry.lastError : '' })
        break
      }
    }
    const remaining = await allQueueEntries()
    if (!remaining.length) {
      publish({ lastSyncedAt: Date.now(), warning: '' })
      window.dispatchEvent(new CustomEvent('offline-sync-complete'))
    }
  } finally {
    flushing = false
    publish({ syncing: false })
    await refreshRuntimeCounts()
  }
}

export function initializeOfflineRuntime(remoteSender: RemoteSender) {
  sender = remoteSender
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try { cachePaused = localStorage.getItem('do-it-laaaaaater.cache-paused.v1') === '1' } catch { cachePaused = false }
  if (cachePaused) publish({ cachePhase: 'paused' })
  const auth = cachedAuth()
  if (auth?.user?.email) configureOfflineUser(auth.user.email)
  window.addEventListener('online', () => {
    publish({ online: true })
    void flushOfflineQueue()
  })
  window.addEventListener('offline', () => publish({ online: false }))
  if (navigator.onLine) window.setTimeout(() => void flushOfflineQueue(), 0)
}

export async function retryFailedOfflineQueue() {
  const entries = await allQueueEntries()
  await Promise.all(entries.filter((entry) => entry.state === 'failed').map(async (entry) => {
    entry.state = 'pending'
    entry.lastError = ''
    entry.errorStatus = undefined
    entry.conflict = false
    await putQueueEntry(entry)
  }))
  await refreshRuntimeCounts()
  await flushOfflineQueue()
}

export async function discardFailedOfflineQueue() {
  const entries = await allQueueEntries()
  await deleteQueueEntries(entries.filter((entry) => entry.state === 'failed').map((entry) => entry.id))
  await refreshRuntimeCounts()
}

export async function getOfflineQueueSummaries(): Promise<OfflineQueueSummary[]> {
  return (await allQueueEntries()).map((entry) => ({
    id: entry.id,
    label: queueLabel(entry),
    createdAt: entry.createdAt,
    state: entry.state,
    lastError: entry.lastError,
    conflict: Boolean(entry.conflict)
  }))
}

export async function forceOfflineMutation(id: string) {
  const entry = (await allQueueEntries()).find((candidate) => candidate.id === id)
  if (!entry || entry.state !== 'failed') return
  if (entry.body.kind === 'json') delete entry.body.value.baseUpdatedAt
  if (entry.body.kind === 'form') entry.body.entries = entry.body.entries.filter((field) => field.name !== 'baseUpdatedAt')
  entry.state = 'pending'
  entry.lastError = ''
  entry.errorStatus = undefined
  entry.conflict = false
  await putQueueEntry(entry)
  await refreshRuntimeCounts()
  await flushOfflineQueue()
}

export async function offlineStorageBytes() {
  if (!activeUserKey) return 0
  const records = await allBlobRecords(activeUserKey)
  return records.reduce((sum, record) => sum + record.size, 0)
}

export async function clearOfflineImages() {
  if (!activeUserKey) return
  cacheQueue = []
  failedCacheTasks = []
  queuedCacheKeys.clear()
  const records = await allBlobRecords(activeUserKey)
  const database = await openDatabase()
  const transaction = database.transaction('blobs', 'readwrite')
  const store = transaction.objectStore('blobs')
  records.forEach((record) => {
    store.delete(record.key)
    const url = blobUrls.get(record.key)
    if (url) URL.revokeObjectURL(url)
    blobUrls.delete(record.key)
  })
  await transactionDone(transaction)
  publish({ cachePhase: 'idle', cacheCompleted: 0, cacheTotal: 0, cacheFailed: 0, warning: '' })
  await refreshRuntimeCounts()
}

export async function clearOfflineUserData(userKey = activeUserKey) {
  if (!userKey) return
  const [entries, records] = await Promise.all([allQueueEntries(userKey), allBlobRecords(userKey)])
  const database = await openDatabase()
  const transaction = database.transaction(['snapshots', 'queue', 'blobs'], 'readwrite')
  transaction.objectStore('snapshots').delete(userKey)
  const queueStore = transaction.objectStore('queue')
  const blobStore = transaction.objectStore('blobs')
  entries.forEach((entry) => queueStore.delete(entry.id))
  records.forEach((record) => {
    blobStore.delete(record.key)
    const url = blobUrls.get(record.key)
    if (url) URL.revokeObjectURL(url)
    blobUrls.delete(record.key)
  })
  await transactionDone(transaction)
  if (userKey === activeUserKey) {
    activeUserKey = ''
    publish({ pendingCount: 0, failedCount: 0, cacheUpdatedAt: null, storageBytes: 0 })
  }
}
