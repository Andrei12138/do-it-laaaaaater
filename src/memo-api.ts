import { api, jsonRequest } from './api'
import type {
  MemoBackground,
  MemoCanvasAsset,
  MemoCanvasScene,
  MemoCanvasSnapshot,
  MemoColorMode
} from './types'

const MAX_MEMO_IMAGE_BYTES = 20 * 1024 * 1024
const MEMO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface MemoBinaryFile {
  id: string
  mimeType: string
  dataURL: string
  created: number
  lastRetrieved?: number
}

export function emptyMemoCanvas(): MemoCanvasSnapshot {
  return {
    scene: { elements: [], appState: {} },
    background: 'solid',
    colorMode: 'light',
    updatedAt: 0,
    assets: []
  }
}

function readAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('无法读取画布图片'))
    reader.readAsDataURL(blob)
  })
}

export async function loadMemoBinaryFiles(assets: MemoCanvasAsset[]) {
  const files: Record<string, MemoBinaryFile> = {}
  await Promise.all(assets.map(async (asset) => {
    const response = await fetch(asset.url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('画布中的一张图片暂时无法读取')
    const blob = await response.blob()
    if (!blob.size || blob.size > MAX_MEMO_IMAGE_BYTES || !MEMO_MIME_TYPES.has(blob.type)) {
      throw new Error('画布图片的类型或大小无效')
    }
    files[asset.fileId] = {
      id: asset.fileId,
      mimeType: asset.mimeType,
      dataURL: await readAsDataUrl(blob),
      created: asset.createdAt,
      lastRetrieved: Date.now()
    }
  }))
  return files
}

export async function fetchMemoCanvas() {
  return api<MemoCanvasSnapshot>('/api/memo-canvas')
}

export async function uploadMemoAsset(file: MemoBinaryFile) {
  const response = await fetch(file.dataURL)
  const blob = await response.blob()
  if (!blob.size || blob.size > MAX_MEMO_IMAGE_BYTES || !MEMO_MIME_TYPES.has(blob.type)) {
    throw new Error('画布图片只支持 PNG、JPEG、WebP，且单张不能超过 20 MB')
  }
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const form = new FormData()
  form.set('fileId', file.id)
  form.set('createdAt', String(file.created))
  form.set('file', new File([blob], `memo-${file.id}.${extension}`, { type: blob.type }))
  return api<MemoCanvasAsset>('/api/memo-assets', { method: 'POST', body: form })
}

export async function saveMemoCanvas(input: {
  scene: MemoCanvasScene
  background: MemoBackground
  colorMode: MemoColorMode
  fileIds: string[]
  updatedAt: number
}) {
  return jsonRequest<MemoCanvasSnapshot>('/api/memo-canvas', 'PUT', input)
}
