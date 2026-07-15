import { fetchPageMetadata } from '../server/metadata.js'
import { HttpError, requireVercelUser } from '../server/vercel-auth.js'
import type { VercelRequest, VercelResponse } from '../server/vercel-types.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: '操作方式不支持' })
    return
  }
  try {
    await requireVercelUser(req)
    const url = String(req.body?.url || '')
    const result = await fetchPageMetadata(url)
    res.setHeader('Cache-Control', 'private, no-store')
    res.status(200).json(result)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 422
    const message = error instanceof Error ? error.message : '无法读取网页信息'
    res.status(status).json({ error: message })
  }
}
