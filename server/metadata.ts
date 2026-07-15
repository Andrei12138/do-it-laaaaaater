import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import * as cheerio from 'cheerio'

const HTML_LIMIT = 2 * 1024 * 1024
const IMAGE_LIMIT = 10 * 1024 * 1024
const FETCH_TIMEOUT_MS = 6500
const USER_AGENT = 'Mozilla/5.0 (compatible; DoItLaaaaaater/1.0; local reading list)'

export interface PageMetadata {
  url: string
  normalizedUrl: string
  title: string
  siteName: string
  coverUrl: string
}

export function normalizeUrl(input: string) {
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

function isPrivateV4(ip: string) {
  const parts = ip.split('.').map(Number)
  const [a, b] = parts
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

export function isPrivateAddress(ip: string) {
  const version = isIP(ip)
  if (version === 4) return isPrivateV4(ip)
  if (version === 6) {
    const value = ip.toLowerCase()
    return (
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe8') ||
      value.startsWith('fe9') ||
      value.startsWith('fea') ||
      value.startsWith('feb') ||
      value.startsWith('::ffff:127.') ||
      value.startsWith('::ffff:10.') ||
      value.startsWith('::ffff:192.168.')
    )
  }
  return true
}

async function assertSafeUrl(input: string) {
  const url = new URL(input)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '0.0.0.0'
  ) {
    throw new Error('不能自动读取本机或内网地址')
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('不能自动读取本机或内网地址')
    return
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('不能自动读取本机或内网地址')
  }
}

async function safeFetch(input: string, accept: string, maxBytes: number) {
  let current = normalizeUrl(input)
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertSafeUrl(current)
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
    if (!reader) return { response, buffer: Buffer.alloc(0), finalUrl: current }
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('网页内容过大')
      }
      chunks.push(Buffer.from(value))
    }
    return { response, buffer: Buffer.concat(chunks), finalUrl: current }
  }
  throw new Error('网页跳转次数过多')
}

function cleanText(value: string | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

export function parsePageMetadata(html: string, pageUrl: string): PageMetadata {
  const $ = cheerio.load(html)
  const findMeta = (...keys: string[]) => {
    for (const key of keys) {
      const selector = 'meta[property="' + key + '"], meta[name="' + key + '"]'
      const value = $(selector).first().attr('content')
      if (value) return cleanText(value)
    }
    return ''
  }
  const title = cleanText(findMeta('og:title', 'twitter:title') || $('title').first().text())
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

export async function fetchPageMetadata(input: string): Promise<PageMetadata> {
  const normalized = normalizeUrl(input)
  const result = await safeFetch(
    normalized,
    'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
    HTML_LIMIT
  )
  const contentType = result.response.headers.get('content-type') || ''
  if (!/html|xhtml|text\/plain/i.test(contentType)) throw new Error('该地址不是可读取的网页')
  return parsePageMetadata(result.buffer.toString('utf8'), result.finalUrl)
}

export async function fetchImage(input: string) {
  const result = await safeFetch(input, 'image/png,image/jpeg,image/webp,image/*;q=0.5', IMAGE_LIMIT)
  const contentType = result.response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) throw new Error('封面地址不是图片')
  return result.buffer
}
