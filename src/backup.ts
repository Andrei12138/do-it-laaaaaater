import { strFromU8, strToU8, unzipSync, Zip, zipSync, ZipPassThrough } from 'fflate'
import { api, jsonRequest } from './api'
import type { AppPreferences, Category, ImageAsset, LibraryItem } from './types'

export const BACKUP_FORMAT = 'do-it-laaaaaater-backup'
export const BACKUP_VERSION = 2
export type BackupManifestVersion = 1 | typeof BACKUP_VERSION

export interface BackupAsset {
  id: string
  role: ImageAsset['role']
  originalName: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  sortOrder: number
  path: string | null
}

export interface BackupItem {
  id: string
  kind: LibraryItem['kind']
  title: string
  url: string | null
  status: LibraryItem['status']
  categoryName: string | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
  isStarred: boolean
  plannedFor: string | null
  trashedAt: number | null
  assets: BackupAsset[]
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: BackupManifestVersion
  exportedAt: string
  timeZone: 'Asia/Shanghai'
  includeOriginals: boolean
  preferences: { quickSaveCategoryName: string | null }
  categories: Array<{ id: string; name: string; color: string; sortOrder: number }>
  items: BackupItem[]
}

export interface ValidatedBackup {
  manifest: BackupManifest
  images: Map<string, File>
  totalBytes: number
}

export interface BackupProgress {
  phase: 'reading' | 'writing' | 'validating' | 'restoring'
  completed: number
  total: number
  message: string
}

export interface RestoreReport {
  added: number
  skipped: number
  failed: Array<{ title: string; error: string }>
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGES_PER_GROUP = 30
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function extensionFor(mimeType: string) {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return 'jpg'
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'asset'
}

function imagePath(itemId: string, asset: ImageAsset) {
  return `images/${safeSegment(itemId)}/${safeSegment(asset.id)}.${extensionFor(asset.mimeType)}`
}

function filenameTimestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '00'
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`
}

function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError')
}

async function loadManifest(includeOriginals: boolean) {
  const [categories, items, preferences] = await Promise.all([
    api<Category[]>('/api/categories'),
    api<LibraryItem[]>('/api/items?status=all&sort=newest&trash=all'),
    api<AppPreferences>('/api/preferences')
  ])
  const quickCategory = categories.find((category) => category.id === preferences.quickSaveCategoryId)
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    timeZone: 'Asia/Shanghai',
    includeOriginals,
    preferences: { quickSaveCategoryName: quickCategory?.name || null },
    categories: categories.map((category, index) => ({ ...category, sortOrder: index })),
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      url: item.url,
      status: item.status,
      categoryName: item.category?.name || null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
      isStarred: item.isStarred,
      plannedFor: item.plannedFor,
      trashedAt: item.trashedAt,
      assets: item.assets.map((asset) => ({
        id: asset.id,
        role: asset.role,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        size: asset.size,
        width: asset.width,
        height: asset.height,
        sortOrder: asset.sortOrder,
        path: includeOriginals ? imagePath(item.id, asset) : null
      }))
    }))
  }
  const assetSources = new Map<string, ImageAsset>()
  if (includeOriginals) {
    items.forEach((item) => item.assets.forEach((asset) => assetSources.set(imagePath(item.id, asset), asset)))
  }
  return { manifest, assetSources }
}

async function fetchOriginal(asset: ImageAsset, signal?: AbortSignal) {
  const response = await fetch(asset.originalUrl, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error('无法读取原图：' + asset.originalName)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('原图大小不符合限制：' + asset.originalName)
  return bytes
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Uint8Array) => Promise<void>
      close: () => Promise<void>
      abort?: () => Promise<void>
    }>
  }>
}

async function streamArchive(
  filename: string,
  manifest: BackupManifest,
  assets: Map<string, ImageAsset>,
  onProgress?: (progress: BackupProgress) => void,
  signal?: AbortSignal
) {
  const picker = (window as SavePickerWindow).showSaveFilePicker
  if (!picker) return false
  const handle = await picker({
    suggestedName: filename,
    types: [{ description: 'Do It Laaaaaater 备份', accept: { 'application/zip': ['.zip'] } }]
  })
  const writable = await handle.createWritable()
  let writeChain = Promise.resolve()
  let complete!: () => void
  let fail!: (error: unknown) => void
  const finished = new Promise<void>((resolve, reject) => {
    complete = resolve
    fail = reject
  })
  const archive = new Zip((error, chunk, final) => {
    if (error) {
      fail(error)
      return
    }
    const stableChunk = chunk.slice()
    writeChain = writeChain.then(() => writable.write(stableChunk))
    if (final) {
      writeChain.then(() => writable.close()).then(complete, fail)
    }
  })
  try {
    const manifestEntry = new ZipPassThrough('manifest.json')
    archive.add(manifestEntry)
    manifestEntry.push(strToU8(JSON.stringify(manifest, null, 2)), true)
    let completed = 0
    for (const [path, asset] of assets) {
      assertNotCancelled(signal)
      onProgress?.({ phase: 'reading', completed, total: assets.size, message: '正在读取原图：' + asset.originalName })
      const bytes = await fetchOriginal(asset, signal)
      const entry = new ZipPassThrough(path)
      archive.add(entry)
      entry.push(bytes, true)
      completed += 1
      onProgress?.({ phase: 'writing', completed, total: assets.size, message: `正在写入备份（${completed}/${assets.size}）` })
    }
    archive.end()
    await finished
    return true
  } catch (error) {
    try {
      await writable.abort?.()
    } catch {
      // The original error is more useful than an abort cleanup failure.
    }
    throw error
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export async function exportBackup({
  includeOriginals = true,
  preferStreaming = true,
  onProgress,
  signal
}: {
  includeOriginals?: boolean
  preferStreaming?: boolean
  onProgress?: (progress: BackupProgress) => void
  signal?: AbortSignal
} = {}) {
  assertNotCancelled(signal)
  const { manifest, assetSources } = await loadManifest(includeOriginals)
  const filename = `do-it-laaaaaater-backup-${filenameTimestamp()}.zip`
  const estimatedBytes = strToU8(JSON.stringify(manifest)).length + [...assetSources.values()].reduce((sum, asset) => sum + asset.size, 0)
  if (estimatedBytes > MAX_ARCHIVE_BYTES) throw new Error('预计备份超过 4 GB，请先分批整理图片。')
  if (preferStreaming && (window as SavePickerWindow).showSaveFilePicker) {
    const saved = await streamArchive(filename, manifest, assetSources, onProgress, signal)
    if (saved) return { filename, manifest, estimatedBytes, streamed: true }
  }

  const entries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2))
  }
  let completed = 0
  for (const [path, asset] of assetSources) {
    assertNotCancelled(signal)
    onProgress?.({ phase: 'reading', completed, total: assetSources.size, message: '正在读取原图：' + asset.originalName })
    entries[path] = await fetchOriginal(asset, signal)
    completed += 1
  }
  onProgress?.({ phase: 'writing', completed, total: assetSources.size, message: '正在生成 ZIP 文件…' })
  const archive = zipSync(entries, { level: 0 })
  downloadBlob(new Blob([archive as BlobPart], { type: 'application/zip' }), filename)
  return { filename, manifest, estimatedBytes, streamed: false }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('manifest.json 格式不正确')
  return value as Record<string, unknown>
}

function cleanArchivePath(path: string) {
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[a-z]:/i.test(path)) return false
  const segments = path.split('/')
  return segments.every((segment) => segment && segment !== '.' && segment !== '..')
}

function imageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mimeType === 'image/webp') {
    return bytes.length >= 12 && strFromU8(bytes.subarray(0, 4)) === 'RIFF' && strFromU8(bytes.subarray(8, 12)) === 'WEBP'
  }
  return false
}

function finiteTimestamp(value: unknown, field: string) {
  const result = Number(value)
  if (!Number.isFinite(result) || result < 0 || result > Date.now() + 24 * 60 * 60 * 1000) throw new Error(field + ' 时间无效')
  return result
}

function validateManifest(raw: unknown): BackupManifest {
  const root = objectValue(raw)
  const sourceVersion = Number(root.version)
  if (root.format !== BACKUP_FORMAT || (sourceVersion !== 1 && sourceVersion !== BACKUP_VERSION)) {
    throw new Error('这不是受支持的 Do It Laaaaaater 备份版本')
  }
  if (!Array.isArray(root.categories) || root.categories.length > 10_000) throw new Error('类别清单无效')
  if (!Array.isArray(root.items) || root.items.length > 100_000) throw new Error('条目清单无效')
  const categories = root.categories.map((value, index) => {
    const entry = objectValue(value)
    const name = String(entry.name || '').replace(/\s+/g, ' ').trim()
    const color = String(entry.color || '')
    if (!name || name.length > 40 || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('第 ' + (index + 1) + ' 个类别无效')
    return { id: String(entry.id || ''), name, color, sortOrder: Number(entry.sortOrder || index) }
  })
  const categoryNames = new Set(categories.map((category) => category.name.toLocaleLowerCase('zh-CN')))
  const items = root.items.map((value, index): BackupItem => {
    const entry = objectValue(value)
    const kind = entry.kind
    const status = entry.status
    const title = String(entry.title || '').trim()
    if (kind !== 'link' && kind !== 'text' && kind !== 'image_group') throw new Error('第 ' + (index + 1) + ' 个条目类型无效')
    if (status !== 'pending' && status !== 'completed') throw new Error('第 ' + (index + 1) + ' 个条目状态无效')
    if (!title || title.length > 300) throw new Error('第 ' + (index + 1) + ' 个条目标题无效')
    const url = entry.url === null || entry.url === undefined ? null : String(entry.url)
    if (kind === 'link') {
      try {
        const parsed = new URL(url || '')
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
      } catch {
        throw new Error('第 ' + (index + 1) + ' 个网页地址无效')
      }
    }
    const categoryName = entry.categoryName ? String(entry.categoryName) : null
    if (categoryName && !categoryNames.has(categoryName.toLocaleLowerCase('zh-CN'))) throw new Error('条目引用了不存在的类别：' + categoryName)
    const plannedFor = entry.plannedFor ? String(entry.plannedFor) : null
    if (plannedFor && !/^\d{4}-\d{2}-\d{2}$/.test(plannedFor)) throw new Error('条目计划日期无效：' + title)
    const trashedAt = sourceVersion >= 2 && entry.trashedAt !== null && entry.trashedAt !== undefined
      ? finiteTimestamp(entry.trashedAt, title)
      : null
    if (!Array.isArray(entry.assets)) throw new Error('条目图片清单无效：' + title)
    if (entry.assets.length > MAX_IMAGES_PER_GROUP + 1) throw new Error('条目图片数量超出限制：' + title)
    const assets = entry.assets.map((assetValue): BackupAsset => {
      const asset = objectValue(assetValue)
      const role = asset.role
      const mimeType = String(asset.mimeType || '')
      const size = Number(asset.size)
      const path = asset.path === null || asset.path === undefined ? null : String(asset.path)
      if (role !== 'web_cover' && role !== 'attachment' && role !== 'gallery') throw new Error('图片角色无效：' + title)
      if (!ALLOWED_MIME_TYPES.has(mimeType) || !Number.isFinite(size) || size < 1 || size > MAX_IMAGE_BYTES) throw new Error('图片资料无效：' + title)
      if (path && !cleanArchivePath(path)) throw new Error('备份中包含危险图片路径')
      return {
        id: String(asset.id || ''),
        role,
        originalName: String(asset.originalName || 'image'),
        mimeType,
        size,
        width: asset.width === null ? null : Number(asset.width),
        height: asset.height === null ? null : Number(asset.height),
        sortOrder: Number(asset.sortOrder || 0),
        path
      }
    })
    const webCoverCount = assets.filter((asset) => asset.role === 'web_cover').length
    const manualCount = assets.filter((asset) => asset.role !== 'web_cover').length
    if (webCoverCount > 1 || manualCount > MAX_IMAGES_PER_GROUP) throw new Error('条目图片数量超出限制：' + title)
    if (kind === 'image_group' && assets.some((asset) => asset.role !== 'gallery')) throw new Error('图片组角色无效：' + title)
    if (kind === 'text' && assets.length) throw new Error('文本条目不能包含图片：' + title)
    if (kind === 'link' && assets.some((asset) => asset.role === 'gallery')) throw new Error('网页图片角色无效：' + title)
    return {
      id: String(entry.id || ''),
      kind,
      title,
      url,
      status,
      categoryName,
      createdAt: finiteTimestamp(entry.createdAt, title),
      updatedAt: finiteTimestamp(entry.updatedAt, title),
      completedAt: entry.completedAt === null || entry.completedAt === undefined ? null : finiteTimestamp(entry.completedAt, title),
      isStarred: Boolean(entry.isStarred),
      plannedFor,
      trashedAt,
      assets
    }
  })
  const preferences = objectValue(root.preferences || {})
  const quickSaveCategoryName = preferences.quickSaveCategoryName ? String(preferences.quickSaveCategoryName) : null
  if (quickSaveCategoryName && !categoryNames.has(quickSaveCategoryName.toLocaleLowerCase('zh-CN'))) {
    throw new Error('默认类别在类别清单中不存在')
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: String(root.exportedAt || ''),
    timeZone: 'Asia/Shanghai',
    includeOriginals: Boolean(root.includeOriginals),
    preferences: { quickSaveCategoryName },
    categories,
    items
  }
}

export async function validateBackupFile(file: File, onProgress?: (progress: BackupProgress) => void) {
  if (!file.name.toLocaleLowerCase().endsWith('.zip')) throw new Error('请选择 .zip 备份文件')
  if (!file.size || file.size > MAX_ARCHIVE_BYTES) throw new Error('备份文件大小无效或超过 4 GB')
  onProgress?.({ phase: 'validating', completed: 0, total: 1, message: '正在检查备份结构…' })
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error('ZIP 文件损坏或无法读取')
  }
  const names = Object.keys(archive)
  if (!names.includes('manifest.json')) throw new Error('备份缺少 manifest.json')
  if (names.some((name) => !cleanArchivePath(name))) throw new Error('ZIP 中包含危险路径')
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(archive['manifest.json']))
  } catch {
    throw new Error('manifest.json 无法解析')
  }
  const manifest = validateManifest(parsed)
  const declared = new Map<string, BackupAsset>()
  manifest.items.forEach((item) => item.assets.forEach((asset) => {
    if (asset.path) {
      if (declared.has(asset.path)) throw new Error('多个图片记录使用了同一路径：' + asset.path)
      declared.set(asset.path, asset)
    }
  }))
  const extraFiles = names.filter((name) => name !== 'manifest.json' && !declared.has(name))
  if (extraFiles.length) throw new Error('ZIP 中存在清单未声明的文件：' + extraFiles[0])
  const images = new Map<string, File>()
  let totalBytes = 0
  let completed = 0
  for (const [path, asset] of declared) {
    const bytes = archive[path]
    if (!bytes) throw new Error('备份缺少原图：' + asset.originalName)
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !imageSignature(bytes, asset.mimeType)) {
      throw new Error('原图类型或大小不符合清单：' + asset.originalName)
    }
    totalBytes += bytes.length
    if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('解压后的图片总量超过 4 GB')
    images.set(path, new File([bytes as BlobPart], asset.originalName, { type: asset.mimeType }))
    completed += 1
    onProgress?.({ phase: 'validating', completed, total: declared.size, message: `正在检查原图（${completed}/${declared.size}）` })
  }
  onProgress?.({ phase: 'validating', completed: 1, total: 1, message: '备份检查完成' })
  return { manifest, images, totalBytes } satisfies ValidatedBackup
}

export async function restoreBackup(
  backup: ValidatedBackup,
  mode: 'merge' | 'replace',
  options: {
    onProgress?: (progress: BackupProgress) => void
    signal?: AbortSignal
  } = {}
) {
  assertNotCancelled(options.signal)
  if (mode === 'replace') await jsonRequest('/api/backup/clear', 'POST', { confirmed: true })
  let categories = await api<Category[]>('/api/categories')
  const categoryByName = new Map(categories.map((category) => [category.name.toLocaleLowerCase('zh-CN'), category]))
  for (const backupCategory of backup.manifest.categories.sort((left, right) => left.sortOrder - right.sortOrder)) {
    assertNotCancelled(options.signal)
    const key = backupCategory.name.toLocaleLowerCase('zh-CN')
    if (!categoryByName.has(key)) {
      const created = await jsonRequest<Category>('/api/categories', 'POST', {
        name: backupCategory.name,
        color: backupCategory.color
      })
      categoryByName.set(key, created)
    }
  }
  categories = [...categoryByName.values()]
  const report: RestoreReport = { added: 0, skipped: 0, failed: [] }
  const total = backup.manifest.items.length
  for (let index = 0; index < backup.manifest.items.length; index += 1) {
    assertNotCancelled(options.signal)
    const item = backup.manifest.items[index]
    options.onProgress?.({ phase: 'restoring', completed: index, total, message: `正在恢复：${item.title}` })
    try {
      const categoryId = item.categoryName
        ? categoryByName.get(item.categoryName.toLocaleLowerCase('zh-CN'))?.id || null
        : null
      const form = new FormData()
      form.set('item', JSON.stringify(item))
      form.set('categoryId', categoryId || '')
      for (const asset of item.assets) {
        if (!asset.path) continue
        const file = backup.images.get(asset.path)
        if (!file) throw new Error('缺少原图：' + asset.originalName)
        form.append('images', file, asset.originalName)
      }
      const result = await api<{ status: 'added' | 'skipped'; reason?: string }>('/api/backup/item', {
        method: 'POST',
        body: form,
        signal: options.signal
      })
      if (result.status === 'added') report.added += 1
      else report.skipped += 1
    } catch (error) {
      report.failed.push({ title: item.title, error: error instanceof Error ? error.message : '恢复失败' })
    }
  }
  const defaultCategory = backup.manifest.preferences.quickSaveCategoryName
    ? categoryByName.get(backup.manifest.preferences.quickSaveCategoryName.toLocaleLowerCase('zh-CN'))
    : null
  await jsonRequest('/api/preferences', 'PATCH', { quickSaveCategoryId: defaultCategory?.id || null })
  options.onProgress?.({ phase: 'restoring', completed: total, total, message: '恢复处理完成' })
  return report
}
