import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'
import type { AppContext } from './db.js'

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGES_PER_ITEM = 30
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface PreparedAsset {
  id: string
  itemId: string
  userId: string
  role: 'web_cover' | 'attachment' | 'gallery'
  originalName: string
  fileName: string
  thumbName: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  sortOrder: number
  createdAt: number
}

function cleanOriginalName(value: string) {
  const name = path.basename(value || 'image').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim()
  return (name || 'image').slice(0, 180)
}

export async function prepareImage(
  context: AppContext,
  input: {
    buffer: Buffer
    originalName: string
    itemId: string
    userId: string
    role: PreparedAsset['role']
    sortOrder: number
    maxBytes?: number
  }
): Promise<PreparedAsset> {
  const maxBytes = input.maxBytes || MAX_IMAGE_BYTES
  if (!input.buffer.length) throw new Error('图片内容为空')
  if (input.buffer.length > maxBytes) throw new Error('单张图片不能超过 20 MB')

  const detected = await fileTypeFromBuffer(input.buffer)
  if (!detected || !ALLOWED_TYPES.has(detected.mime)) {
    throw new Error('只支持 PNG、JPEG 和 WebP 图片')
  }

  const id = randomUUID()
  const fileName = id + '.' + detected.ext
  const thumbName = id + '.webp'
  const originalPath = path.join(context.originalsDir, fileName)
  const thumbPath = path.join(context.thumbsDir, thumbName)
  const image = sharp(input.buffer, { limitInputPixels: 100_000_000 })
  const metadata = await image.metadata()

  try {
    await writeFile(originalPath, input.buffer)
    await sharp(input.buffer, { limitInputPixels: 100_000_000 })
      .rotate()
      .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(thumbPath)
  } catch (error) {
    await Promise.allSettled([unlink(originalPath), unlink(thumbPath)])
    throw error
  }

  return {
    id,
    itemId: input.itemId,
    userId: input.userId,
    role: input.role,
    originalName: cleanOriginalName(input.originalName),
    fileName,
    thumbName,
    mimeType: detected.mime,
    size: input.buffer.length,
    width: metadata.width || null,
    height: metadata.height || null,
    sortOrder: input.sortOrder,
    createdAt: Date.now()
  }
}

export async function removePreparedAsset(context: AppContext, asset: Pick<PreparedAsset, 'fileName' | 'thumbName'>) {
  await Promise.allSettled([
    unlink(path.join(context.originalsDir, path.basename(asset.fileName))),
    unlink(path.join(context.thumbsDir, path.basename(asset.thumbName)))
  ])
}

export async function removePreparedAssets(
  context: AppContext,
  assets: Array<Pick<PreparedAsset, 'fileName' | 'thumbName'>>
) {
  await Promise.all(assets.map((asset) => removePreparedAsset(context, asset)))
}

export function insertPreparedAsset(context: AppContext, asset: PreparedAsset) {
  context.db.prepare(
    'INSERT INTO assets (id,item_id,user_id,role,original_name,file_name,thumb_name,mime_type,size,width,height,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    asset.id,
    asset.itemId,
    asset.userId,
    asset.role,
    asset.originalName,
    asset.fileName,
    asset.thumbName,
    asset.mimeType,
    asset.size,
    asset.width,
    asset.height,
    asset.sortOrder,
    asset.createdAt
  )
}
