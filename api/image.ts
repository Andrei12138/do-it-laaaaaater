import { fileTypeFromBuffer } from 'file-type'
import { fetchImage } from '../server/metadata.js'
import { HttpError, requireVercelUser } from '../server/vercel-auth.js'
import type { VercelRequest, VercelResponse } from '../server/vercel-types.js'

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: '操作方式不支持' })
    return
  }
  try {
    await requireVercelUser(req)
    const value = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url
    const buffer = await fetchImage(String(value || ''))
    const detected = await fileTypeFromBuffer(buffer)
    if (!detected || !ALLOWED_TYPES.has(detected.mime)) throw new Error('封面格式不支持')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.setHeader('Content-Type', detected.mime)
    res.setHeader('Content-Length', String(buffer.length))
    res.status(200).send(buffer)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 422
    const message = error instanceof Error ? error.message : '无法读取网页封面'
    res.status(status).json({ error: message })
  }
}
