import { createClient } from '@supabase/supabase-js'
import type { VercelRequest } from './vercel-types.js'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function connection() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!url || !key) throw new HttpError(503, '云端连接尚未配置')
  return { url, key }
}

export async function requireVercelUser(req: VercelRequest) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new HttpError(401, '请先登录')
  const { url, key } = connection()
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const result = await client.auth.getUser(token)
  if (result.error || !result.data.user) throw new HttpError(401, '登录已经失效，请重新登录')
  return result.data.user
}
