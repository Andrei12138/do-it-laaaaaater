import { detectImageMime, fetchImage } from './metadata'
import { ApiError } from './types'

export interface AiImageConfig {
  apiUrl: string
  apiKey: string
  model: string
  style?: string | null
}

const DEFAULT_STYLE_DIRECTION =
  'Modern editorial design poster and vinyl album cover artwork in Figma gallery aesthetic. Bold geometric composition, tactile collage or Swiss graphic art, crisp lighting, rich color contrast, museum-grade visual metaphor for the topic. Strictly NO readable text, NO letters, NO watermarks, NO UI chrome.'

function resolveGenerationsEndpoint(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '')
  if (!trimmed) throw new ApiError(400, '请先在账号设置中填写生图 API 地址')
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    throw new ApiError(400, '生图 API 地址格式无效')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ApiError(400, '生图 API 仅支持 http/https 地址')
  }
  const path = parsed.pathname.replace(/\/+$/, '')
  if (path.endsWith('/images/generations') || path.endsWith('/generations')) {
    return parsed.toString()
  }
  if (path.endsWith('/v1')) {
    parsed.pathname = `${path}/images/generations`
    return parsed.toString()
  }
  parsed.pathname = `${path}/v1/images/generations`
  return parsed.toString()
}

export function buildPosterPrompt(input: {
  title: string
  url?: string | null
  categoryName?: string | null
  categoryPrompt?: string | null
  customStyle?: string | null
}): string {
  let host = ''
  if (input.url) {
    try {
      host = new URL(input.url).hostname.replace(/^www\./, '')
    } catch {
      host = ''
    }
  }
  const topicParts = [
    `Subject: ${input.title.slice(0, 140)}`,
    input.categoryName ? `Theme category: ${input.categoryName}` : '',
    host ? `Source context: ${host}` : ''
  ].filter(Boolean)
  const baseStyle = (input.customStyle || '').trim() || DEFAULT_STYLE_DIRECTION
  const catStyle = (input.categoryPrompt || '').trim()
  return [
    baseStyle,
    catStyle ? `Category-specific visual style & mood: ${catStyle}` : '',
    `${topicParts.join('. ')}.`
  ].filter(Boolean).join('\n')
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:image\/[a-z+]+;base64,/i, '').replace(/\s+/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function generateAiPosterCover(
  config: AiImageConfig,
  item: { title: string; url?: string | null; categoryName?: string | null; categoryPrompt?: string | null }
): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }> {
  if (!config.apiKey.trim()) throw new ApiError(400, '请先在账号设置中填写生图 API Key')
  const endpoint = resolveGenerationsEndpoint(config.apiUrl)
  const model = config.model.trim() || 'gpt-image-1'
  const prompt = buildPosterPrompt({
    title: item.title,
    url: item.url,
    categoryName: item.categoryName,
    categoryPrompt: item.categoryPrompt,
    customStyle: config.style
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 55_000)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: '1024x1024'
      })
    })
  } catch (error) {
    throw new ApiError(502, error instanceof Error && error.name === 'AbortError' ? '生图接口超时，请稍后重试' : '无法连接到生图 API')
  } finally {
    clearTimeout(timer)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const errJson = (await response.json()) as { error?: { message?: string } | string; message?: string }
      if (typeof errJson?.error === 'string') detail = errJson.error
      else if (errJson?.error?.message) detail = errJson.error.message
      else if (errJson?.message) detail = errJson.message
    } catch {
      // ignore non-json error body
    }
    throw new ApiError(502, `生图接口返回错误：${detail.slice(0, 160)}`)
  }

  // Some providers return raw image bytes directly
  if (contentType.startsWith('image/')) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    const mimeType = detectImageMime(bytes)
    if (!mimeType) throw new ApiError(502, '生图返回的图片格式不支持')
    return { bytes, mimeType }
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>
    images?: Array<{ b64_json?: string; url?: string }>
  }
  const entry = payload.data?.[0] || payload.images?.[0]
  if (!entry) throw new ApiError(502, '生图接口未返回图片数据')

  if (entry.b64_json) {
    const bytes = decodeBase64(entry.b64_json)
    const mimeType = detectImageMime(bytes)
    if (!mimeType) throw new ApiError(502, '生图返回的 Base64 图片格式不支持')
    return { bytes, mimeType }
  }

  if (entry.url) {
    return await fetchImage(entry.url)
  }

  throw new ApiError(502, '生图接口未返回可用的图片地址或数据')
}

export function maskApiKey(key: string | null | undefined): string {
  const clean = (key || '').trim()
  if (!clean) return ''
  if (clean.length <= 8) return '••••'
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`
}
