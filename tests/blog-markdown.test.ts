import { describe, expect, it } from 'vitest'
import { formatArticleDateTime, formatRelativeTime, groupArchivesByDate } from '../src/blog-api'
import { formatMomentText, generateExcerpt, renderArticleMarkdown } from '../src/blog-markdown'
import type { BlogArchiveItem } from '../src/blog-types'

function makeArchiveItem(shortId: string, publishedAt: number): BlogArchiveItem {
  return {
    id: `id-${shortId}`,
    shortId,
    type: 'moment',
    title: '',
    excerpt: '',
    contentPreview: `Moment ${shortId}`,
    coverUrl: null,
    images: [],
    locationName: '',
    visibility: 'public',
    locked: false,
    isPinned: false,
    publishedAt
  }
}

describe('blog-markdown: headings & TOC extraction', () => {
  it('extracts h2 and h3 with deterministic IDs for Chinese, English, and duplicate headings', () => {
    const md = [
      '# 文章主标题',
      '## 项目背景',
      '### Core Architecture',
      '## 项目背景',
      '### **核心** `Pipeline`',
      '#### 四级小节'
    ].join('\n')

    const res = renderArticleMarkdown(md)
    expect(res.headings).toEqual([
      { id: 'h-1', level: 2, text: '项目背景' },
      { id: 'h-2', level: 3, text: 'Core Architecture' },
      { id: 'h-3', level: 2, text: '项目背景' },
      { id: 'h-4', level: 3, text: '核心 Pipeline' }
    ])
    expect(res.html).toContain('<h1>文章主标题</h1>')
    expect(res.html).toContain('<h2 id="h-1">项目背景</h2>')
    expect(res.html).toContain('<h3 id="h-2">Core Architecture</h3>')
    expect(res.html).toContain('<h2 id="h-3">项目背景</h2>')
    expect(res.html).toContain('<h3 id="h-4"><strong>核心</strong> <code>Pipeline</code></h3>')
    expect(res.html).toContain('<h4>四级小节</h4>')
  })
})

describe('blog-markdown: XSS sanitization', () => {
  it('escapes raw HTML tags such as script, img onerror, and iframe', () => {
    const md = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '<iframe src="https://evil.example/embed"></iframe>'
    ].join('\n\n')

    const { html } = renderArticleMarkdown(md)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img ')
    expect(html).not.toContain('<iframe')
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;iframe src=&quot;https://evil.example/embed&quot;&gt;&lt;/iframe&gt;')
  })

  it('rejects javascript: and data: links and images while allowing safe URLs', () => {
    const md = [
      '[点我](javascript:alert(1))',
      '[混合大小写](JaVaScRiPt:alert(2))',
      '[数据链接](data:text/html,<script>alert(3)</script>)',
      '[站内链接](/blog/abc)',
      '[锚点](#h-1)',
      '![恶意图](javascript:alert(4))',
      '![安全媒体](/api/blog/media/img-1)',
      '![远程图片](https://cdn.example.com/photo.jpg)'
    ].join('\n\n')

    const { html } = renderArticleMarkdown(md)
    expect(html.toLowerCase()).not.toContain('javascript:')
    expect(html.toLowerCase()).not.toContain('href="data:')
    expect(html).toContain('<p>点我</p>')
    expect(html).toContain('<p>混合大小写</p>')
    expect(html).toContain('<p>数据链接</p>')
    expect(html).toContain('<a href="/blog/abc">站内链接</a>')
    expect(html).toContain('<a href="#h-1">锚点</a>')
    expect(html).toContain('<p>恶意图</p>')
    expect(html).toContain(
      '<figure class="blog-md-figure"><img src="/api/blog/media/img-1" alt="安全媒体" loading="lazy" data-lightbox-src="/api/blog/media/img-1" /><figcaption>安全媒体</figcaption></figure>'
    )
    expect(html).toContain(
      '<figure class="blog-md-figure"><img src="https://cdn.example.com/photo.jpg" alt="远程图片" loading="lazy" data-lightbox-src="https://cdn.example.com/photo.jpg" /><figcaption>远程图片</figcaption></figure>'
    )
  })
})

describe('blog-markdown: fenced code blocks', () => {
  it('renders macOS code frame with language label, copy button, line numbers, and escaped code', () => {
    const md = [
      '```tsx',
      'const el = <div className="hi">{a & b}</div>',
      'export default el',
      '```'
    ].join('\n')

    const { html } = renderArticleMarkdown(md)
    expect(html).toContain('<div class="blog-code-block" data-lang="tsx">')
    expect(html).toContain('<div class="blog-code-header">')
    expect(html).toContain('<span class="blog-code-lang">tsx</span>')
    expect(html).toContain('<button type="button" class="blog-code-copy" data-code-copy>复制</button>')
    expect(html).toContain('<div class="blog-code-lines" aria-hidden="true"><span>1</span><span>2</span></div>')
    expect(html).toContain(
      '<pre><code class="language-tsx">const el = &lt;div className=&quot;hi&quot;&gt;{a &amp; b}&lt;/div&gt;\nexport default el</code></pre>'
    )
  })
})

describe('blog-markdown: GFM tables, blockquotes, lists, task lists, and inline formatting', () => {
  it('renders GFM tables with alignments and inline formatting', () => {
    const md = [
      '| 项目 | 状态 | 耗时 |',
      '|:---|:---:|---:|',
      '| **Markdown** | `OK` | 12ms |',
      '| 表格支持 | ~~旧版~~ | 8ms |'
    ].join('\n')

    const { html } = renderArticleMarkdown(md)
    expect(html).toContain('<div class="blog-table-wrap"><table>')
    expect(html).toContain('<th style="text-align:left">项目</th>')
    expect(html).toContain('<th style="text-align:center">状态</th>')
    expect(html).toContain('<th style="text-align:right">耗时</th>')
    expect(html).toContain('<td style="text-align:left"><strong>Markdown</strong></td>')
    expect(html).toContain('<td style="text-align:center"><code>OK</code></td>')
    expect(html).toContain('<td style="text-align:center"><del>旧版</del></td>')
  })

  it('merges multi-line blockquotes and renders ordered, unordered, and task lists', () => {
    const md = [
      '> 第一行引用',
      '> 第二行引用',
      '',
      '- [x] 完成渲染器',
      '- [ ] 编写文档',
      '',
      '1. 第一步 *准备*',
      '2. 第二步 https://example.com/guide',
      '',
      '---'
    ].join('\n')

    const { html } = renderArticleMarkdown(md)
    expect(html).toContain('<blockquote><p>第一行引用<br />第二行引用</p></blockquote>')
    expect(html).toContain('<ul class="blog-task-list">')
    expect(html).toContain('<input type="checkbox" disabled checked /><span>完成渲染器</span>')
    expect(html).toContain('<input type="checkbox" disabled /><span>编写文档</span>')
    expect(html).toContain('<ol><li>第一步 <em>准备</em></li>')
    expect(html).toContain(
      '<li>第二步 <a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">https://example.com/guide</a></li></ol>'
    )
    expect(html).toContain('<hr />')
  })
})

describe('blog-markdown: word count, reading minutes, generateExcerpt, formatMomentText', () => {
  it('counts CJK characters and Latin words accurately and computes readingMinutes', () => {
    const shortRes = renderArticleMarkdown('你好世界 Hello world 2026')
    expect(shortRes.wordCount).toBe(7)
    expect(shortRes.readingMinutes).toBe(1)

    const longText = '字'.repeat(641)
    const longRes = renderArticleMarkdown(longText)
    expect(longRes.wordCount).toBe(641)
    expect(longRes.readingMinutes).toBe(3)
  })

  it('strips markdown syntax cleanly in generateExcerpt and respects maxLength', () => {
    const md = [
      '# 标题一',
      '',
      '> 这是一段**加粗**的[链接文字](https://example.com)和 `inline` 代码。',
      '',
      '```js',
      'console.log("should not pollute excerpt")',
      '```',
      '',
      '- [x] 清单项一'
    ].join('\n')

    expect(generateExcerpt(md, 140)).toBe('标题一 这是一段加粗的链接文字和 inline 代码。 清单项一')
    const truncated = generateExcerpt(md, 12)
    expect(truncated.length).toBeLessThanOrEqual(12)
    expect(truncated.endsWith('…')).toBe(true)
  })

  it('parses moment text into safe text, link, and tag segments', () => {
    const segments = formatMomentText('刚读完一篇好文章 https://example.com/post#intro，推荐给 #前端 #读书笔记 朋友！')
    expect(segments).toEqual([
      { type: 'text', value: '刚读完一篇好文章 ' },
      { type: 'link', value: 'https://example.com/post#intro', href: 'https://example.com/post#intro' },
      { type: 'text', value: '，推荐给 ' },
      { type: 'tag', value: '#前端' },
      { type: 'text', value: ' ' },
      { type: 'tag', value: '#读书笔记' },
      { type: 'text', value: ' 朋友！' }
    ])
  })
})

describe('blog-api: CST date formatting and archive grouping', () => {
  it('formats relative time accurately in Asia/Shanghai', () => {
    const now = Date.parse('2026-11-25T10:00:00+08:00')
    expect(formatRelativeTime(now - 30 * 1000, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 15 * 60 * 1000, now)).toBe('15分钟前')
    expect(formatRelativeTime(now - 5 * 60 * 60 * 1000, now)).toBe('5小时前')
    expect(formatRelativeTime(Date.parse('2026-11-24T08:30:00+08:00'), now)).toBe('昨天')
    expect(formatRelativeTime(Date.parse('2026-11-23T09:00:00+08:00'), now)).toBe('2天前')
    expect(formatRelativeTime(Date.parse('2026-11-20T23:30:00+08:00'), now)).toBe('2026年11月20日')
    // Cross-UTC-date check: 2026-11-20T18:30:00Z is 2026-11-21 02:30 in Asia/Shanghai
    expect(formatRelativeTime(Date.parse('2026-11-20T18:30:00Z'), now)).toBe('2026年11月21日')
  })

  it('formats article datetime in Asia/Shanghai', () => {
    // 2026-03-04T20:05:00Z => 2026-03-05 04:05 CST
    expect(formatArticleDateTime(Date.parse('2026-03-04T20:05:00Z'))).toBe('2026年3月5日 04:05')
  })

  it('groups consecutive archive items by today, yesterday, and YYYY-M-D in CST', () => {
    const now = Date.parse('2026-11-25T12:00:00+08:00')
    const items: BlogArchiveItem[] = [
      makeArchiveItem('a', Date.parse('2026-11-25T09:00:00+08:00')),
      makeArchiveItem('b', Date.parse('2026-11-24T17:00:00Z')), // 2026-11-25 01:00 CST (still today)
      makeArchiveItem('c', Date.parse('2026-11-24T22:00:00+08:00')),
      makeArchiveItem('d', Date.parse('2026-11-20T08:00:00+08:00')),
      makeArchiveItem('e', Date.parse('2026-11-20T01:00:00+08:00'))
    ]

    const groups = groupArchivesByDate(items, now)
    expect(groups).toHaveLength(3)
    expect(groups[0]).toMatchObject({
      key: 'today',
      year: 2026,
      dayLabel: '25',
      monthLabel: '11月',
      specialLabel: '今天'
    })
    expect(groups[0].items.map((x) => x.shortId)).toEqual(['a', 'b'])

    expect(groups[1]).toMatchObject({
      key: 'yesterday',
      year: 2026,
      dayLabel: '24',
      monthLabel: '11月',
      specialLabel: '昨天'
    })
    expect(groups[1].items.map((x) => x.shortId)).toEqual(['c'])

    expect(groups[2]).toMatchObject({
      key: '2026-11-20',
      year: 2026,
      dayLabel: '20',
      monthLabel: '11月',
      specialLabel: null
    })
    expect(groups[2].items.map((x) => x.shortId)).toEqual(['d', 'e'])
  })
})
