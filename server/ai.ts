import { Router } from 'express'
import type { AppContext } from './db.js'
import { aiAdviceText, aiCategorizeText, aiSummarizeText } from './ai-lib.js'

// 本地 Express 版 AI 端点（Vercel 线上版见 api/ai/*.ts）
export function createAiRouter(_context: AppContext): Router {
  const router = Router()

  router.post('/summarize', async (req, res) => {
    const { text, title } = (req.body || {}) as { text?: string; title?: string }
    try {
      const summary = await aiSummarizeText({ title, text: text || '' })
      res.json({ summary })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI 调用失败'
      res.status(500).json({ error: msg })
    }
  })

  router.post('/categorize', async (req, res) => {
    const { text, categories } = (req.body || {}) as { text?: string; categories?: string[] }
    try {
      const category = await aiCategorizeText({ text: text || '', categories })
      res.json({ category })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI 调用失败'
      res.status(500).json({ error: msg })
    }
  })

  router.post('/advice', async (req, res) => {
    const { text } = (req.body || {}) as { text?: string }
    try {
      const advice = await aiAdviceText({ text: text || '' })
      res.json({ advice })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI 调用失败'
      res.status(500).json({ error: msg })
    }
  })

  return router
}
