const HTML_LIMIT = 2 * 1024 * 1024
const IMAGE_LIMIT = 10 * 1024 * 1024
const FETCH_TIMEOUT_MS = 6500
const USER_AGENT = 'Mozilla/5.0 (compatible; DoItLaaaaaater/2.0; reading list)'

export interface PageMetadata {
  url: string
  normalizedUrl: string
  title: string
  siteName: string
  coverUrl: string
}

export function normalizeUrl(input: string): string {
  const value = input.trim()
  if (
    (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) ||
    /^(javascript|data|file|mailto|ftp|blob):/i.test(value)
  ) {
    throw new Error('只支持 http 或 https 网页地址')
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : 'https://' + value
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http 或 https 网页地址')
  }
  url.hash = ''
  url.hostname = url.hostname.toLowerCase()
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = ''
  }
  return url.toString()
}

function isIpv4(input: string): boolean {
  const parts = input.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

export function isPrivateAddress(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').toLowerCase()
  if (isIpv4(clean)) return isPrivateV4(clean)
  if (clean.includes(':')) {
    return (
      clean === '::' ||
      clean === '::1' ||
      clean.startsWith('fc') ||
      clean.startsWith('fd') ||
      clean.startsWith('fe8') ||
      clean.startsWith('fe9') ||
      clean.startsWith('fea') ||
      clean.startsWith('feb') ||
      clean.startsWith('::ffff:127.') ||
      clean.startsWith('::ffff:10.') ||
      clean.startsWith('::ffff:192.168.') ||
      clean.startsWith('::ffff:169.254.') ||
      clean.startsWith('::ffff:0.')
    )
  }
  return true
}

function assertSafeUrl(input: string) {
  const url = new URL(input)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '0.0.0.0'
  ) {
    throw new Error('不能自动读取本机或内网地址')
  }
  if (isIpv4(hostname) || hostname.includes(':')) {
    if (isPrivateAddress(hostname)) throw new Error('不能自动读取本机或内网地址')
  }
}

async function safeFetch(input: string, accept: string, maxBytes: number) {
  let current = normalizeUrl(input)
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    assertSafeUrl(current)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept, 'user-agent': USER_AGENT }
      })
    } finally {
      clearTimeout(timer)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('网页跳转地址无效')
      current = new URL(location, current).toString()
      continue
    }
    if (!response.ok) throw new Error('网页返回了 ' + response.status)
    const length = Number(response.headers.get('content-length') || 0)
    if (length > maxBytes) throw new Error('网页内容过大')
    const reader = response.body?.getReader()
    if (!reader) return { response, bytes: new Uint8Array(0), finalUrl: current }
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('网页内容过大')
      }
      chunks.push(value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { response, bytes: merged, finalUrl: current }
  }
  throw new Error('网页跳转次数过多')
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
}

function cleanText(value: string | undefined): string {
  return decodeHtmlEntities(value || '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function extractMetaTags(html: string): Map<string, string> {
  const map = new Map<string, string>()
  const metaRegex = /<meta\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = metaRegex.exec(html)) !== null) {
    const tag = match[0]
    const keyMatch = tag.match(/\b(?:property|name)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    const contentMatch = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    if (!keyMatch || !contentMatch) continue
    const key = (keyMatch[1] || keyMatch[2] || keyMatch[3] || '').toLowerCase()
    const content = contentMatch[1] ?? contentMatch[2] ?? contentMatch[3] ?? ''
    if (key && content && !map.has(key)) map.set(key, content)
  }
  return map
}

export function parsePageMetadata(html: string, pageUrl: string): PageMetadata {
  const meta = extractMetaTags(html)
  const findMeta = (...keys: string[]) => {
    for (const key of keys) {
      const value = meta.get(key.toLowerCase())
      if (value) return cleanText(value)
    }
    return ''
  }
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const title = cleanText(findMeta('og:title', 'twitter:title') || (titleMatch ? titleMatch[1] : ''))
  const siteName = cleanText(findMeta('og:site_name'))
  const rawCover = findMeta('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src')
  let coverUrl = ''
  if (rawCover) {
    try {
      const parsed = new URL(rawCover, pageUrl)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') coverUrl = parsed.toString()
    } catch {
      coverUrl = ''
    }
  }
  const normalizedUrl = normalizeUrl(pageUrl)
  return { url: normalizedUrl, normalizedUrl, title, siteName, coverUrl }
}

export function detectImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  return null
}

export async function fetchPageMetadata(input: string): Promise<PageMetadata> {
  const normalized = normalizeUrl(input)
  const result = await safeFetch(
    normalized,
    'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
    HTML_LIMIT
  )
  const contentType = result.response.headers.get('content-type') || ''
  if (!/html|xhtml|text\/plain/i.test(contentType)) throw new Error('该地址不是可读取的网页')
  const html = new TextDecoder('utf-8', { fatal: false }).decode(result.bytes)
  return parsePageMetadata(html, result.finalUrl)
}

export async function fetchImage(
  input: string
): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' }> {
  const result = await safeFetch(input, 'image/png,image/jpeg,image/webp,image/gif,image/*;q=0.5', IMAGE_LIMIT)
  const mimeType = detectImageMime(result.bytes)
  if (!mimeType) throw new Error('封面格式不支持')
  return { bytes: result.bytes, mimeType }
}
