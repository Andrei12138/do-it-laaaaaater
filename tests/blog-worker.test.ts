import { describe, expect, it } from 'vitest'
import type { BlogBootstrap, BlogMediaUpload, BlogPageData, BlogProfile } from '../src/blog-types'
import {
  blogMediaUrl,
  buildBlogOgMeta,
  buildExcerpt,
  buildRssFeed,
  buildUnlockCookie,
  escapeHtml,
  escapeXml,
  expectedUnlockToken,
  extensionFor,
  extractBlogMediaIdsFromPostRow,
  extractBlogMediaIdsFromText,
  extractMediaIdFromBlogUrl,
  generateShortId,
  handleBlogApi,
  loadBlogProfile,
  matchBlogHtmlRoute,
  normalizeTags,
  renderBlogOgHeadHtml,
  resolveVisitorKey,
  sanitizeOgText,
  sanitizeVisitorHeader,
  sanitizeWebsiteUrl,
  stripMarkdownForPreview,
  toAbsoluteMetaUrl,
  unlockCookieName
} from '../worker/blog'
import { detectImageMime } from '../worker/metadata'
import { hashToken } from '../worker/security'
import { ALLOWED_IMAGE_TYPES, SESSION_COOKIE, type Env } from '../worker/types'

describe('朋友圈博客 Worker 辅助模块', () => {
  it('生成指定长度且仅包含字母数字的 shortId', () => {
    const id = generateShortId()
    expect(id).toHaveLength(8)
    expect(/^[a-zA-Z0-9]{8}$/.test(id)).toBe(true)

    const id12 = generateShortId(12)
    expect(id12).toHaveLength(12)
    expect(/^[a-zA-Z0-9]{12}$/.test(id12)).toBe(true)

    const sample = new Set(Array.from({ length: 50 }, () => generateShortId(8)))
    expect(sample.size).toBe(50)
  })

  it('正确转义 XML 特殊字符并生成有效 RSS 2.0 Feed', () => {
    expect(escapeXml(`Tom & Jerry <"1"> 'ok'`)).toBe('Tom &amp; Jerry &lt;&quot;1&quot;&gt; &apos;ok&apos;')

    const xml = buildRssFeed({
      origin: 'https://blog.example.com/',
      profile: {
        siteName: '我的 <朋友圈> & 博客',
        nickname: '测试博主',
        bio: '记录 "日常" 与思考'
      },
      posts: [
        {
          shortId: 'AbCd1234',
          type: 'article',
          title: '第一篇 <长文>',
          excerpt: '摘要 & 说明',
          content: '# 标题\n正文内容',
          category: '技术',
          tags: ['Cloudflare', 'D1'],
          publishedAt: Date.UTC(2026, 4, 1, 8, 0, 0)
        },
        {
          shortId: 'Mm998877',
          type: 'moment',
          title: '',
          excerpt: '',
          content: '今天阳光很好，写了一段 **Markdown** 动态。',
          category: '生活',
          tags: ['日常'],
          publishedAt: Date.UTC(2026, 4, 2, 9, 30, 0)
        }
      ]
    })

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<title>我的 &lt;朋友圈&gt; &amp; 博客</title>')
    expect(xml).toContain('<link>https://blog.example.com/articles/AbCd1234</link>')
    expect(xml).toContain('<link>https://blog.example.com/moments/Mm998877</link>')
    expect(xml).toContain('<title>第一篇 &lt;长文&gt;</title>')
    expect(xml).toContain('<description>摘要 &amp; 说明</description>')
    expect(xml).toContain('<category>Cloudflare</category>')
    expect(xml).toContain('今天阳光很好，写了一段 Markdown 动态。')
  })

  it('规范化访客网址并拒绝不安全协议', () => {
    expect(sanitizeWebsiteUrl('https://example.com/about?x=1')).toBe('https://example.com/about?x=1')
    expect(sanitizeWebsiteUrl('  http://sub.example.org  ')).toBe('http://sub.example.org/')
    expect(sanitizeWebsiteUrl('javascript:alert(1)')).toBe('')
    expect(sanitizeWebsiteUrl('data:text/html,<h1>hi</h1>')).toBe('')
    expect(sanitizeWebsiteUrl('ftp://files.example.com')).toBe('')
    expect(sanitizeWebsiteUrl('not-a-valid-url')).toBe('')
    expect(sanitizeWebsiteUrl('')).toBe('')
  })

  it('规范化标签列表并自动去重、去除前导 # 与空白', () => {
    expect(normalizeTags([' #技术 ', '技术', '  前端  ', '', '##React', 'react', '随笔'])).toEqual([
      '技术',
      '前端',
      'React',
      '随笔'
    ])
    expect(normalizeTags('not-an-array')).toEqual([])
  })

  it('正确清理 Markdown 并截断摘要', () => {
    const plain = stripMarkdownForPreview('# 标题\n> 引用一段 [链接](https://a.com) 和 `代码` ![图](img.png)')
    expect(plain).toBe('标题 引用一段 链接 和 代码 图')

    expect(buildExcerpt('这是很长的一段内容'.repeat(30), '', 20)).toHaveLength(20)
    expect(buildExcerpt('这是很长的一段内容'.repeat(30), '', 20).endsWith('…')).toBe(true)
    expect(buildExcerpt('正文', '  自定义摘要  ', 50)).toBe('自定义摘要')
  })

  it('生成密码解锁 Cookie 并在密码哈希变化时立即失效', async () => {
    const token1 = await expectedUnlockToken('post-1', 'pbkdf2$100000$salt1$key1')
    const token2 = await expectedUnlockToken('post-1', 'pbkdf2$100000$salt2$key2')
    expect(token1).toHaveLength(64)
    expect(token1).not.toBe(token2)

    expect(unlockCookieName('Ab12Cd34')).toBe('blog_unlock_Ab12Cd34')
    const cookie = buildUnlockCookie('Ab12Cd34', token1, new URL('https://blog.example.com/api/blog/posts/Ab12Cd34/unlock'))
    expect(cookie).toContain('blog_unlock_Ab12Cd34=')
    expect(cookie).toContain('Path=/api/blog/')
    expect(cookie).not.toContain('Path=/;')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=604800')

    const httpCookie = buildUnlockCookie('Ab12Cd34', token1, new URL('http://127.0.0.1:8787/api/blog/posts/Ab12Cd34/unlock'))
    expect(httpCookie).toContain('Path=/api/blog/')
    expect(httpCookie).not.toContain('Secure')
  })

  it('正确解析博主与绑定 IP 的访客标识键', async () => {
    expect(sanitizeVisitorHeader('visitor_1234-ABCD')).toBe('visitor_1234-ABCD')
    expect(sanitizeVisitorHeader('short')).toBeNull()
    expect(sanitizeVisitorHeader('bad value with spaces!!')).toBeNull()

    const ownerReq = new Request('https://example.com/api/blog/posts/abc/like')
    expect(await resolveVisitorKey(ownerReq, true, 'owner-uuid')).toBe('owner:owner-uuid')

    const headerReq1 = new Request('https://example.com/api/blog/posts/abc/like', {
      headers: { 'x-blog-visitor': 'visitor_token_123456', 'cf-connecting-ip': '203.0.113.10' }
    })
    const headerReq2 = new Request('https://example.com/api/blog/posts/abc/like', {
      headers: { 'x-blog-visitor': 'visitor_token_123456', 'cf-connecting-ip': '203.0.113.10' }
    })
    const spoofedIpReq = new Request('https://example.com/api/blog/posts/abc/like', {
      headers: { 'x-blog-visitor': 'visitor_token_123456', 'cf-connecting-ip': '198.51.100.99' }
    })
    const key1 = await resolveVisitorKey(headerReq1, false, 'owner-uuid')
    const key2 = await resolveVisitorKey(headerReq2, false, 'owner-uuid')
    const spoofedKey = await resolveVisitorKey(spoofedIpReq, false, 'owner-uuid')

    expect(key1).toBe(key2)
    expect(key1).toBe(`visitor:${await hashToken('visitor_token_123456:203.0.113.10')}`)
    expect(spoofedKey).not.toBe(key1)

    const fallbackReq = new Request('https://example.com/api/blog/posts/abc/like', {
      headers: { 'cf-connecting-ip': '203.0.113.10', 'user-agent': 'TestBrowser/1.0' }
    })
    const fallbackKey = await resolveVisitorKey(fallbackReq, false, 'owner-uuid')
    expect(fallbackKey.startsWith('visitor:')).toBe(true)
    expect(fallbackKey).not.toBe(key1)
  })

  it('从 Markdown 正文、媒体 URL 与博文 JSON 字段中准确提取媒体 ID', () => {
    expect(extractMediaIdFromBlogUrl('/api/blog/media/media-123')).toBe('media-123')
    expect(extractMediaIdFromBlogUrl('/api/blog/media/media-456?variant=thumb')).toBe('media-456')
    expect(extractMediaIdFromBlogUrl('https://blog.example.com/api/blog/media/id%2D789#hash')).toBe('id-789')
    expect(extractMediaIdFromBlogUrl('/api/blog/media/gc')).toBeNull()
    expect(extractMediaIdFromBlogUrl('https://cdn.example.com/other.png')).toBeNull()

    const md = [
      '# 旅行记录',
      '![封面](/api/blog/media/md-img-1)',
      '内联缩略图 <img src="/api/blog/media/md-img-2?variant=thumb" alt="x" />',
      '完整域名引用 [试听](https://blog.example.com/api/blog/media/md-audio-1)',
      '重复图片 ![重复](/api/blog/media/md-img-1) 与接口路径 /api/blog/media/gc'
    ].join('\n')
    expect(extractBlogMediaIdsFromText(md)).toEqual(['md-img-1', 'md-img-2', 'md-audio-1'])

    const postIds = extractBlogMediaIdsFromPostRow({
      cover_media_id: 'cover-1',
      cover_url: '/api/blog/media/cover-1',
      images_json: JSON.stringify([
        {
          mediaId: 'img-1',
          url: '/api/blog/media/img-1',
          liveVideoMediaId: 'live-1',
          liveVideoUrl: '/api/blog/media/live-1'
        },
        {
          url: '/api/blog/media/img-from-url-only?variant=thumb'
        }
      ]),
      metadata_json: JSON.stringify({
        video: { source: 'upload', mediaId: 'vid-meta-1', coverUrl: '/api/blog/media/vid-cover-1' },
        music: {
          title: 'Song',
          artist: 'Artist',
          audioUrl: '/api/blog/media/music-aud-1',
          coverUrl: '/api/blog/media/music-cov-1'
        }
      }),
      link_card_json: JSON.stringify({
        url: 'https://example.com',
        title: 'Card',
        image: '/api/blog/media/link-cover-1'
      }),
      content: '正文中还有一张 ![插图](/api/blog/media/inline-md-9)'
    })

    expect(new Set(postIds)).toEqual(
      new Set([
        'cover-1',
        'img-1',
        'live-1',
        'img-from-url-only',
        'vid-meta-1',
        'vid-cover-1',
        'music-aud-1',
        'music-cov-1',
        'link-cover-1',
        'inline-md-9'
      ])
    )
  })

  it('构建并净化公开页面 OG / Twitter / RSS 元标签，且严禁泄露私密或加密文章信息', () => {
    expect(matchBlogHtmlRoute('/')).toEqual({ kind: 'home' })
    expect(matchBlogHtmlRoute('/articles/AbCd1234')).toEqual({ kind: 'article', shortId: 'AbCd1234' })
    expect(matchBlogHtmlRoute('/blog/moments/XyZ987')).toEqual({ kind: 'moment', shortId: 'XyZ987' })
    expect(matchBlogHtmlRoute('/about')).toEqual({ kind: 'about' })
    expect(matchBlogHtmlRoute('/app')).toBeNull()
    expect(matchBlogHtmlRoute('/sw.js')).toBeNull()

    expect(sanitizeOgText('  Hello\n\u0000World  ', 50)).toBe('Hello World')
    expect(toAbsoluteMetaUrl('/api/blog/media/pic-1', 'https://blog.example.com')).toBe(
      'https://blog.example.com/api/blog/media/pic-1'
    )
    expect(toAbsoluteMetaUrl('javascript:alert(1)', 'https://blog.example.com')).toBeNull()
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')

    const publicMeta = buildBlogOgMeta({
      origin: 'https://blog.example.com',
      pathname: '/articles/AbCd1234',
      route: { kind: 'article', shortId: 'AbCd1234' },
      siteName: '数字花园',
      siteBio: '站点简介',
      siteImage: '/api/blog/media/site-cover',
      post: {
        type: 'article',
        title: '深入 <Workers> & 性能优化',
        excerpt: '这是一段摘要',
        content: '正文内容',
        imageUrl: '/api/blog/media/post-cover',
        visibility: 'public'
      }
    })
    expect(publicMeta.type).toBe('article')
    expect(publicMeta.title).toBe('深入 <Workers> & 性能优化 · 数字花园')
    expect(publicMeta.image).toBe('https://blog.example.com/api/blog/media/post-cover')

    const headHtml = renderBlogOgHeadHtml(publicMeta)
    expect(headHtml).toContain('<title>深入 &lt;Workers&gt; &amp; 性能优化 · 数字花园</title>')
    expect(headHtml).toContain('<meta property="og:image" content="https://blog.example.com/api/blog/media/post-cover" />')
    expect(headHtml).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(headHtml).toContain('<link rel="alternate" type="application/rss+xml" title="数字花园 RSS" href="/api/blog/feed.xml" />')

    for (const secretVis of ['private', 'password'] as const) {
      const gatedMeta = buildBlogOgMeta({
        origin: 'https://blog.example.com',
        pathname: '/articles/Secret99',
        route: { kind: 'article', shortId: 'Secret99' },
        siteName: '数字花园',
        siteBio: '公开站点简介',
        siteImage: '/api/blog/media/site-cover',
        post: {
          type: 'article',
          title: '绝密日记标题',
          excerpt: '绝密摘要',
          content: '绝密正文',
          imageUrl: '/api/blog/media/secret-photo',
          visibility: secretVis
        }
      })
      expect(gatedMeta.type).toBe('website')
      expect(gatedMeta.title).toBe('数字花园')
      expect(gatedMeta.description).toBe('公开站点简介')
      expect(gatedMeta.image).toBe('https://blog.example.com/api/blog/media/site-cover')
      expect(JSON.stringify(gatedMeta)).not.toContain('绝密')
      expect(JSON.stringify(gatedMeta)).not.toContain('secret-photo')
    }
  })

  it('构造规范的媒体地址', () => {
    expect(blogMediaUrl('media-1')).toBe('/api/blog/media/media-1')
    expect(blogMediaUrl('media-1', 'thumb')).toBe('/api/blog/media/media-1?variant=thumb')
  })

  it('识别 GIF87a / GIF89a 魔数并拒绝伪造文件头，同时支持 extensionFor(image/gif)', () => {
    const gif87a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00])
    const gif89a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00])
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
    ])

    expect(detectImageMime(gif87a)).toBe('image/gif')
    expect(detectImageMime(gif89a)).toBe('image/gif')
    expect(detectImageMime(pngBytes)).toBe('image/png')
    expect(detectImageMime(jpegBytes)).toBe('image/jpeg')
    expect(detectImageMime(webpBytes)).toBe('image/webp')

    // 拒绝伪造或截断的 GIF 头与 HTML/SVG 载荷
    expect(detectImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x38, 0x61]))).toBeNull() // GIF88a
    expect(detectImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x62]))).toBeNull() // GIF89b
    expect(detectImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBeNull() // 仅 5 字节
    expect(detectImageMime(new TextEncoder().encode('gif89a_lowercase'))).toBeNull()
    expect(detectImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(detectImageMime(new TextEncoder().encode('<html><script>alert(1)</script></html>'))).toBeNull()

    expect(ALLOWED_IMAGE_TYPES.has('image/gif')).toBe(true)
    expect(extensionFor('image/gif')).toBe('gif')
    expect(extensionFor('image/png')).toBe('png')
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('image/webp')).toBe('webp')
  })
})

function createWorkerGifAndSettingsTestEnv() {
  const r2Store = new Map<string, { bytes: Uint8Array; contentType: string; etag: string }>()
  const mediaRows = new Map<string, Record<string, unknown>>()
  const pageRows = new Map<string, Record<string, unknown>>()
  const settingsRows = new Map<string, Record<string, unknown>>()
  const owner = { id: 'owner-gif-1', email: 'owner@example.com' }
  let sessionHash = ''

  const images = {
    async put(key: string, value: ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string } }) {
      const bytes =
        value instanceof Uint8Array
          ? value.slice()
          : ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
            : new Uint8Array(value).slice()
      r2Store.set(key, {
        bytes,
        contentType: options?.httpMetadata?.contentType || 'application/octet-stream',
        etag: `"etag-${key}"`
      })
    },
    async head(key: string) {
      const item = r2Store.get(key)
      return item ? { key, size: item.bytes.byteLength, httpEtag: item.etag } : null
    },
    async get(key: string) {
      const item = r2Store.get(key)
      if (!item) return null
      return {
        key,
        size: item.bytes.byteLength,
        httpEtag: item.etag,
        body: item.bytes,
        async arrayBuffer() {
          return item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength)
        }
      }
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) r2Store.delete(k)
    }
  }

  function makeStatement(sql: string, bound: unknown[] = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    return {
      bind(...args: unknown[]) {
        return makeStatement(sql, args)
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        if (normalized.includes('FROM sessions s JOIN users u')) {
          return bound[0] === sessionHash
            ? ({ id: owner.id, email: owner.email, expires_at: Date.now() + 86400_000 } as unknown as T)
            : null
        }
        if (normalized.startsWith('SELECT id, email FROM users') || normalized.startsWith('SELECT id FROM users')) {
          return { id: owner.id, email: owner.email } as unknown as T
        }
        if (normalized.includes('FROM blog_settings WHERE user_id = ?')) {
          return (settingsRows.get(String(bound[0])) as unknown as T) || null
        }
        if (normalized.includes('FROM blog_pages WHERE user_id = ? AND slug = ?')) {
          return (pageRows.get(`${bound[0]}:${bound[1]}`) as unknown as T) || null
        }
        if (normalized.includes("FROM blog_pages WHERE user_id = ? AND slug = 'about'")) {
          return (pageRows.get(`${bound[0]}:about`) as unknown as T) || null
        }
        if (normalized.includes('FROM blog_media WHERE id = ? AND user_id = ?')) {
          const row = mediaRows.get(String(bound[0]))
          return row && row.user_id === bound[1] ? (row as unknown as T) : null
        }
        if (normalized.includes('FROM blog_media WHERE id = ?')) {
          return (mediaRows.get(String(bound[0])) as unknown as T) || null
        }
        if (normalized.includes('COUNT(*)') && normalized.includes('FROM blog_comments')) {
          return { count: 0 } as unknown as T
        }
        return null
      },
      async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
        if (normalized.includes('FROM blog_pages WHERE user_id = ?')) {
          return { results: [...pageRows.values()].filter((r) => r.user_id === bound[0]) as unknown as T[] }
        }
        return { results: [] }
      },
      async run() {
        if (normalized.startsWith('INSERT INTO blog_media')) {
          if (normalized.includes("'image', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?")) {
            const [id, userId, originalName, storageKey, thumbKey, mimeType, thumbMime, size, width, height, createdAt] = bound
            mediaRows.set(String(id), {
              id,
              user_id: userId,
              kind: 'image',
              original_name: originalName,
              storage_key: storageKey,
              thumb_key: thumbKey,
              mime_type: mimeType,
              thumb_mime_type: thumbMime,
              size,
              width,
              height,
              paired_media_id: null,
              created_at: createdAt
            })
          } else {
            const [id, userId, kind, originalName, storageKey, thumbKey, mimeType, thumbMime, size, width, height, pairedMediaId, createdAt] = bound
            mediaRows.set(String(id), {
              id,
              user_id: userId,
              kind,
              original_name: originalName,
              storage_key: storageKey,
              thumb_key: thumbKey,
              mime_type: mimeType,
              thumb_mime_type: thumbMime,
              size,
              width,
              height,
              paired_media_id: pairedMediaId,
              created_at: createdAt
            })
          }
          return { success: true }
        }
        if (normalized.startsWith('INSERT INTO blog_settings')) {
          const [userId, siteName, nickname, bio, avatarMediaId, coverMediaId, footerText, allowComments, extensionsJson, updatedAt] = bound
          settingsRows.set(String(userId), {
            user_id: userId,
            site_name: siteName,
            nickname: nickname,
            bio,
            avatar_media_id: avatarMediaId,
            cover_media_id: coverMediaId,
            footer_text: footerText,
            allow_comments: allowComments,
            extensions_json: extensionsJson,
            updated_at: updatedAt
          })
          return { success: true }
        }
        if (normalized.startsWith('INSERT INTO blog_pages')) {
          const [slug, userId, title, subtitle, content, coverMediaId, allowComments, updatedAt] = bound
          pageRows.set(`${userId}:${slug}`, {
            slug,
            user_id: userId,
            title,
            subtitle,
            content,
            cover_media_id: coverMediaId,
            allow_comments: allowComments,
            updated_at: updatedAt
          })
          return { success: true }
        }
        return { success: true }
      }
    }
  }

  const db = {
    prepare(sql: string) {
      return makeStatement(sql)
    },
    async batch(statements: Array<{ all: () => Promise<{ results: unknown[] }>; run: () => Promise<unknown> }>) {
      const out = []
      for (const stmt of statements) {
        await stmt.run()
        out.push(await stmt.all())
      }
      return out
    }
  }

  const ctx = {
    waitUntil() {},
    passThroughOnException() {}
  } as unknown as ExecutionContext

  return {
    env: { DB: db, IMAGES: images, ASSETS: { async fetch() { return new Response('ok') } } } as unknown as Env,
    ctx,
    r2Store,
    mediaRows,
    pageRows,
    ownerId: owner.id,
    async ownerCookie() {
      const rawToken = 'test-gif-session-token'
      sessionHash = await hashToken(rawToken)
      return `${SESSION_COOKIE}=${rawToken}`
    }
  }
}

describe('GIF 动图保留与 aboutSubtitle 同步集成测试', () => {
  it('POST /api/blog/media 上传 GIF (批量 images 与单文件 kind=image) 均保留原图动图作为缩略图，不替换为静态 WebP', async () => {
    const { env, ctx, r2Store, mediaRows, ownerCookie } = createWorkerGifAndSettingsTestEnv()
    const cookie = await ownerCookie()

    const gif89aBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x10, 0x00, 0x3b])
    const gif87aBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x08, 0x00, 0x08, 0x00, 0x3b])
    const staticWebpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
    ])

    // 1. 批量 images 上传 GIF，即使附带了静态 WebP thumbs，也必须保留 thumb_key = storage_key & image/gif
    const batchForm = new FormData()
    batchForm.append('images', new File([gif89aBytes], 'dance.gif', { type: 'image/gif' }))
    batchForm.append('thumbs', new File([staticWebpBytes], 'dance-thumb.webp', { type: 'image/webp' }))
    batchForm.append('imageMeta', JSON.stringify([{ width: 320, height: 240 }]))

    const batchRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/media', {
        method: 'POST',
        headers: { cookie },
        body: batchForm
      }),
      env,
      ctx
    )
    expect(batchRes.status).toBe(201)
    const batchData = (await batchRes.json()) as { media: BlogMediaUpload[] }
    expect(batchData.media).toHaveLength(1)
    expect(batchData.media[0].mimeType).toBe('image/gif')

    const batchRow = mediaRows.get(batchData.media[0].id)!
    expect(String(batchRow.storage_key).endsWith('/original.gif')).toBe(true)
    expect(batchRow.thumb_key).toBe(batchRow.storage_key)
    expect(batchRow.thumb_mime_type).toBe('image/gif')
    expect([...r2Store.keys()].some((k) => k.includes('thumb.webp'))).toBe(false)

    // 请求 ?variant=thumb 应直接返回完整 GIF 动图字节与 image/gif Content-Type
    const thumbRes = await handleBlogApi(
      new Request(`https://blog.example.com${batchData.media[0].thumbUrl}`, {
        headers: { cookie }
      }),
      env,
      ctx
    )
    expect(thumbRes.status).toBe(200)
    expect(thumbRes.headers.get('content-type')).toBe('image/gif')
    expect(new Uint8Array(await thumbRes.arrayBuffer())).toEqual(gif89aBytes)

    // 2. 单文件 file + kind=image 上传 GIF87a，同样保留动图缩略图
    const singleForm = new FormData()
    singleForm.append('file', new File([gif87aBytes], 'retro.gif', { type: 'image/gif' }))
    singleForm.append('kind', 'image')
    singleForm.append('thumbs', new File([staticWebpBytes], 'retro-thumb.webp', { type: 'image/webp' }))

    const singleRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/media', {
        method: 'POST',
        headers: { cookie },
        body: singleForm
      }),
      env,
      ctx
    )
    expect(singleRes.status).toBe(201)
    const singleData = (await singleRes.json()) as { media: BlogMediaUpload[] }
    const singleRow = mediaRows.get(singleData.media[0].id)!
    expect(String(singleRow.storage_key).endsWith('/original.gif')).toBe(true)
    expect(singleRow.thumb_key).toBe(singleRow.storage_key)
    expect(singleRow.thumb_mime_type).toBe('image/gif')

    // 3. 伪造 .gif 扩展名的非图片文件被魔数校验拒绝
    const fakeForm = new FormData()
    fakeForm.append('images', new File(['<script>alert(1)</script>'], 'evil.gif', { type: 'image/gif' }))
    const fakeRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/media', {
        method: 'POST',
        headers: { cookie },
        body: fakeForm
      }),
      env,
      ctx
    ).catch((err) => err)
    expect(fakeRes).toMatchObject({ status: 400 })
  })

  it('aboutSubtitle 默认回退并在 PUT/PATCH /api/blog/settings 时双向同步至 blog_pages (slug=about)', async () => {
    const { env, ctx, pageRows, ownerId, ownerCookie } = createWorkerGifAndSettingsTestEnv()
    const cookie = await ownerCookie()

    // 1. 初始未创建 about 页面时，loadBlogProfile 与 bootstrap 默认返回「数字花园与个人简介」
    const initialProfile = await loadBlogProfile(env, ownerId)
    expect(initialProfile.aboutSubtitle).toBe('数字花园与个人简介')

    const boot1Res = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/bootstrap'),
      env,
      ctx
    )
    const boot1 = (await boot1Res.json()) as BlogBootstrap
    expect(boot1.profile.aboutSubtitle).toBe('数字花园与个人简介')

    // 2. 在博客设置中修改 aboutSubtitle（此时 blog_pages 尚无记录），自动以合理默认值创建并同步
    const patch1Res = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/settings', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          nickname: '林间博主',
          aboutSubtitle: '  独立开发与胶片摄影手记  '
        })
      }),
      env,
      ctx
    )
    expect(patch1Res.status).toBe(200)
    const patchedProfile1 = (await patch1Res.json()) as BlogProfile
    expect(patchedProfile1.nickname).toBe('林间博主')
    expect(patchedProfile1.aboutSubtitle).toBe('独立开发与胶片摄影手记')

    const aboutPageRes1 = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/pages/about'),
      env,
      ctx
    )
    const aboutPage1 = (await aboutPageRes1.json()) as BlogPageData
    expect(aboutPage1.title).toBe('关于我')
    expect(aboutPage1.subtitle).toBe('独立开发与胶片摄影手记')
    expect(aboutPage1.allowComments).toBe(true)

    const fullBootRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/bootstrap?full=1'),
      env,
      ctx
    )
    const fullBoot = (await fullBootRes.json()) as BlogBootstrap
    expect(fullBoot.profile.aboutSubtitle).toBe('独立开发与胶片摄影手记')
    expect(fullBoot.railSummary?.aboutSubtitle).toBe('独立开发与胶片摄影手记')

    // 3. 若 /about 页面已有自定义标题、正文、封面与留言开关，更新 aboutSubtitle 必须完整保留且截断到 120 字符
    pageRows.set(`${ownerId}:about`, {
      slug: 'about',
      user_id: ownerId,
      title: '关于我的故事',
      subtitle: '旧副标题',
      content: '# 欢迎光临\n这是我的自传正文。',
      cover_media_id: 'cover-media-99',
      allow_comments: 0,
      updated_at: 1000
    })

    const longSubtitle = '旅途与代码'.repeat(30) // 150 chars -> 120 chars
    const put2Res = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/settings', {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          siteName: '山月小筑',
          aboutSubtitle: longSubtitle
        })
      }),
      env,
      ctx
    )
    expect(put2Res.status).toBe(200)
    const putProfile2 = (await put2Res.json()) as BlogProfile
    expect(putProfile2.aboutSubtitle).toHaveLength(120)
    expect(putProfile2.aboutSubtitle).toBe(longSubtitle.slice(0, 120))

    const preservedRow = pageRows.get(`${ownerId}:about`)!
    expect(preservedRow.title).toBe('关于我的故事')
    expect(preservedRow.content).toBe('# 欢迎光临\n这是我的自传正文。')
    expect(preservedRow.cover_media_id).toBe('cover-media-99')
    expect(preservedRow.allow_comments).toBe(0)
    expect(preservedRow.subtitle).toBe(longSubtitle.slice(0, 120))

    // 4. 未传入 aboutSubtitle 时，PATCH /api/blog/settings 不会改动已有的 about 副标题
    const patch3Res = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/settings', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ footerText: '© 2026' })
      }),
      env,
      ctx
    )
    const patchProfile3 = (await patch3Res.json()) as BlogProfile
    expect(patchProfile3.aboutSubtitle).toBe(longSubtitle.slice(0, 120))
  })
})
