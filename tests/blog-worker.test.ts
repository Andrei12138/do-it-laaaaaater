import { describe, expect, it } from 'vitest'
import {
  blogMediaUrl,
  buildExcerpt,
  buildRssFeed,
  buildUnlockCookie,
  escapeXml,
  expectedUnlockToken,
  generateShortId,
  normalizeTags,
  resolveVisitorKey,
  sanitizeVisitorHeader,
  sanitizeWebsiteUrl,
  stripMarkdownForPreview,
  unlockCookieName
} from '../worker/blog'

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
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=604800')

    const httpCookie = buildUnlockCookie('Ab12Cd34', token1, new URL('http://127.0.0.1:8787/api/blog/posts/Ab12Cd34/unlock'))
    expect(httpCookie).not.toContain('Secure')
  })

  it('正确解析博主与访客标识键', async () => {
    expect(sanitizeVisitorHeader('visitor_1234-ABCD')).toBe('visitor_1234-ABCD')
    expect(sanitizeVisitorHeader('short')).toBeNull()
    expect(sanitizeVisitorHeader('bad value with spaces!!')).toBeNull()

    const ownerReq = new Request('https://example.com/api/blog/posts/abc/like')
    expect(await resolveVisitorKey(ownerReq, true, 'owner-uuid')).toBe('owner:owner-uuid')

    const headerReq1 = new Request('https://example.com/api/blog/posts/abc/like', {
      headers: { 'x-blog-visitor': 'visitor_token_123456' }
    })
    const headerReq2 = new Request('https://example.com/api/blog/posts/abc/like', {
      headers: { 'x-blog-visitor': 'visitor_token_123456' }
    })
    const key1 = await resolveVisitorKey(headerReq1, false, 'owner-uuid')
    const key2 = await resolveVisitorKey(headerReq2, false, 'owner-uuid')
    expect(key1).toBe(key2)
    expect(key1.startsWith('visitor:')).toBe(true)

    const fallbackReq = new Request('https://example.com/api/blog/posts/abc/like', {
      headers: { 'cf-connecting-ip': '203.0.113.10', 'user-agent': 'TestBrowser/1.0' }
    })
    const fallbackKey = await resolveVisitorKey(fallbackReq, false, 'owner-uuid')
    expect(fallbackKey.startsWith('visitor:')).toBe(true)
    expect(fallbackKey).not.toBe(key1)
  })

  it('构造规范的媒体地址', () => {
    expect(blogMediaUrl('media-1')).toBe('/api/blog/media/media-1')
    expect(blogMediaUrl('media-1', 'thumb')).toBe('/api/blog/media/media-1?variant=thumb')
  })
})
