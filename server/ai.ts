import { Router } from 'express'
import type { AppContext } from './db.js'

// ── AI 辅助功能：摘要 / 分类 / 处理建议 ─────────────────────────────
// 云端部署时在 Vercel Environment Variables 配置 GEMINI_API_KEY
//（或复用 GOOGLE_API_KEY）。本地开发时从 .env 读取。

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat'

// 优先 DeepSeek（国内直连、云端 Vercel 也可用），没有 key 时回退 Gemini
async function callLLM(prompt: string): Promise<string> {
  const deepseekKey = process.env.DEEPSEEK_API_KEY
  if (deepseekKey) {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepseekKey}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 800,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`DeepSeek 调用失败: ${res.status} ${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data?.choices?.[0]?.message?.content?.trim?.() || ''
  }

  // 回退：Gemini
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!geminiKey) throw new Error('未配置 DEEPSEEK_API_KEY（或 GEMINI_API_KEY / GOOGLE_API_KEY）')
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
      }),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gemini 调用失败: ${res.status} ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim?.() || ''
}

export function createAiRouter(_context: AppContext): Router {
  const router = Router()

  // POST /api/ai/summarize  { title?, text } -> { summary }
  router.post('/summarize', async (req, res) => {
    const { text, title } = (req.body || {}) as { text?: string; title?: string }
    const content = [title, text].filter(Boolean).join('\n')
    if (!content) return res.status(400).json({ error: '缺少文本' })
    try {
      const prompt =
        '你是 Do It Laaaaaater 的 AI 助手。请为以下内容生成一段简洁的中文摘要（150 字以内），' +
        '突出要点，不要客套。内容：\n\n' +
        content.slice(0, 6000)
      const summary = await callLLM(prompt)
      res.json({ summary })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI 调用失败'
      res.status(500).json({ error: msg })
    }
  })

  // POST /api/ai/categorize  { text, categories? } -> { category }
  router.post('/categorize', async (req, res) => {
    const { text, categories } = (req.body || {}) as { text?: string; categories?: string[] }
    if (!text) return res.status(400).json({ error: '缺少文本' })
    try {
      const list =
        Array.isArray(categories) && categories.length
          ? categories.join('、')
          : '工作、技术、资讯、灵感、生活、其他'
      const prompt =
        `请判断以下内容最适合归入哪个分类（可选分类：${list}）。` +
        '只回答一个分类名，不要解释、不要加标点：\n\n' +
        text.slice(0, 3000)
      const raw = await callLLM(prompt)
      const category = raw.replace(/[【】「」"'。.、]/g, '').trim()
      res.json({ category })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI 调用失败'
      res.status(500).json({ error: msg })
    }
  })

  // POST /api/ai/advice  { text } -> { advice }
  router.post('/advice', async (req, res) => {
    const { text } = (req.body || {}) as { text?: string }
    if (!text) return res.status(400).json({ error: '缺少文本' })
    try {
      const prompt =
        '你是稍后读应用的 AI 助理。以下是一条待处理的收藏，请用一句话给出处理建议' +
        '（例如：值得精读 / 快速扫过即可 / 可归档 / 建议转存），并简述理由：\n\n' +
        text.slice(0, 4000)
      const advice = await callLLM(prompt)
      res.json({ advice })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI 调用失败'
      res.status(500).json({ error: msg })
    }
  })

  return router
}
