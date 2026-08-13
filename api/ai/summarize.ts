import { aiSummarizeText } from '../../server/ai-lib.js'
import { HttpError, requireVercelUser } from '../../server/vercel-auth.js'
import type { VercelRequest, VercelResponse } from '../../server/vercel-types.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: '操作方式不支持' })
    return
  }
  try {
    await requireVercelUser(req)
    const { text, title } = (req.body || {}) as { text?: string; title?: string }
    const summary = await aiSummarizeText({ title, text: text || '' })
    res.setHeader('Cache-Control', 'private, no-store')
    res.status(200).json({ summary })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : 'AI 调用失败'
    res.status(status).json({ error: message })
  }
}
