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

const IMAGE_MODEL_PATTERN = /(image|flux|dall[-_]?e|imagen|midjourney|\bmj\b|ideogram|recraft|seedream|kolors|cogview|sdxl|stable[-_]?diffusion|nano[-_]?banana|krea|wanx|jimeng|doubao.*seed|gemini.*image|gpt-image|grok-2-image)/i

function normalizeBaseV1Url(rawUrl: string): URL {
  const trimmed = rawUrl.trim().replace(/\/+$/, '')
  if (!trimmed) throw new ApiError(400, '请先填写生图 API 地址')
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    throw new ApiError(400, '生图 API 地址格式无效')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ApiError(400, '生图 API 仅支持 http/https 地址')
  }
  let path = parsed.pathname.replace(/\/+$/, '')
  path = path
    .replace(/\/images\/generations$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '')
  if (!path.endsWith('/v1')) {
    path = `${path}/v1`
  }
  parsed.pathname = path
  return parsed
}

function resolveGenerationsEndpoint(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '')
  if (!trimmed) throw new ApiError(400, '请先在账号设置中填写生图 API 地址')
  if (/\/images\/generations$/i.test(trimmed)) {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return parsed.toString()
  }
  const base = normalizeBaseV1Url(rawUrl)
  base.pathname = `${base.pathname}/images/generations`
  return base.toString()
}

function resolveChatEndpoint(rawUrl: string): string {
  const base = normalizeBaseV1Url(rawUrl)
  base.pathname = `${base.pathname}/chat/completions`
  return base.toString()
}

function resolveModelsEndpoint(rawUrl: string): string {
  const base = normalizeBaseV1Url(rawUrl)
  base.pathname = `${base.pathname}/models`
  return base.toString()
}

export interface AiModelOption {
  id: string
  isImageLikely: boolean
}

export async function listAiModels(apiUrl: string, apiKey: string): Promise<AiModelOption[]> {
  if (!apiKey.trim()) throw new ApiError(400, '请先填写或保存生图 API Key')
  const endpoint = resolveModelsEndpoint(apiUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey.trim()}`,
        accept: 'application/json'
      }
    })
  } catch (error) {
    throw new ApiError(
      502,
      error instanceof Error && error.name === 'AbortError' ? '获取模型列表超时，请稍后重试' : '无法连接到 API 地址获取模型列表'
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const errJson = (await response.json()) as { error?: { message?: string } | string; message?: string }
      if (typeof errJson?.error === 'string') detail = errJson.error
      else if (errJson?.error?.message) detail = errJson.error.message
      else if (errJson?.message) detail = errJson.message
    } catch {
      // ignore non-json body
    }
    throw new ApiError(502, `获取模型列表失败：${detail.slice(0, 140)}`)
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string; name?: string }>
    models?: Array<{ id?: string; name?: string }>
  }
  const rawList = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : []
  const seen = new Set<string>()
  const options: AiModelOption[] = []
  for (const entry of rawList) {
    const id = String(entry?.id || entry?.name || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    options.push({ id, isImageLikely: IMAGE_MODEL_PATTERN.test(id) })
  }
  options.sort((a, b) => {
    if (a.isImageLikely !== b.isImageLikely) return a.isImageLikely ? -1 : 1
    return a.id.localeCompare(b.id)
  })
  return options
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

async function tryChatImageFallback(
  config: AiImageConfig,
  model: string,
  prompt: string
): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | null> {
  const endpoint = resolveChatEndpoint(config.apiUrl)
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
        messages: [{ role: 'user', content: `Generate a square cover image based on this art direction:\n${prompt}` }]
      })
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) return null
  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown
        images?: Array<{ image_url?: { url?: string }; url?: string; b64_json?: string }>
      }
    }>
  }
  const msg = data.choices?.[0]?.message
  if (!msg) return null

  const firstImg = msg.images?.[0]
  if (firstImg?.b64_json) {
    const bytes = decodeBase64(firstImg.b64_json)
    const mimeType = detectImageMime(bytes)
    if (mimeType) return { bytes, mimeType }
  }
  const imgObjUrl = firstImg?.image_url?.url || firstImg?.url
  if (imgObjUrl) {
    if (imgObjUrl.startsWith('data:image/')) {
      const bytes = decodeBase64(imgObjUrl)
      const mimeType = detectImageMime(bytes)
      if (mimeType) return { bytes, mimeType }
    } else if (/^https?:\/\//i.test(imgObjUrl)) {
      return await fetchImage(imgObjUrl)
    }
  }

  const content = typeof msg.content === 'string'
    ? msg.content
    : Array.isArray(msg.content)
      ? JSON.stringify(msg.content)
      : ''

  const dataUrlMatch = content.match(/data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+/i)
  if (dataUrlMatch) {
    const bytes = decodeBase64(dataUrlMatch[0])
    const mimeType = detectImageMime(bytes)
    if (mimeType) return { bytes, mimeType }
  }
  const mdImgMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i)
  if (mdImgMatch?.[1]) {
    return await fetchImage(mdImgMatch[1])
  }
  const urlMatch = content.match(/https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|webp)(?:\?[^\s"'<>)]*)?/i)
  if (urlMatch?.[0]) {
    return await fetchImage(urlMatch[0])
  }
  return null
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
    // Fallback to /chat/completions for chat-based image models (e.g. gemini-image / nano-banana on relays)
    if (response.status === 400 || response.status === 404 || response.status === 405 || response.status === 422 || response.status === 500) {
      const chatResult = await tryChatImageFallback(config, model, prompt).catch(() => null)
      if (chatResult) return chatResult
    }
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
