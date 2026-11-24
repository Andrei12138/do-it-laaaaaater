export interface Env {
  DB: D1Database
  IMAGES: R2Bucket
  ASSETS: Fetcher
}

export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const DEFAULT_CATEGORIES = [
  { name: '工作', color: '#2563eb' },
  { name: '技术', color: '#7c3aed' },
  { name: '资讯', color: '#0891b2' },
  { name: '灵感', color: '#d97706' },
  { name: '生活', color: '#16a34a' },
  { name: '其他', color: '#64748b' }
] as const

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGES_PER_ITEM = 30
export const MAX_MEMO_SCENE_BYTES = 12 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
export const SESSION_COOKIE = 'dil_session'
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
