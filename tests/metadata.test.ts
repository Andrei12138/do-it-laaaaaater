import { describe, expect, it } from 'vitest'
import { isPrivateAddress, normalizeUrl, parsePageMetadata } from '../server/metadata.js'

describe('网页地址与信息解析', () => {
  it('规范化地址并保留有意义的查询参数', () => {
    expect(normalizeUrl('Example.COM:443/article?q=1#part')).toBe('https://example.com/article?q=1')
    expect(normalizeUrl('http://Example.com:80/')).toBe('http://example.com/')
  })

  it('拒绝非网页协议', () => {
    expect(() => normalizeUrl('file:///c:/secret.txt')).toThrow('只支持')
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow('只支持')
  })

  it('优先读取开放图谱标题和相对封面', () => {
    const result = parsePageMetadata(
      [
        '<html><head>',
        '<title>普通标题</title>',
        '<meta property="og:title" content="推荐标题">',
        '<meta property="og:site_name" content="示例站点">',
        '<meta property="og:image" content="/cover.png">',
        '</head></html>'
      ].join(''),
      'https://example.com/article'
    )
    expect(result.title).toBe('推荐标题')
    expect(result.siteName).toBe('示例站点')
    expect(result.coverUrl).toBe('https://example.com/cover.png')
  })

  it('识别常见内网地址', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('192.168.1.2')).toBe(true)
    expect(isPrivateAddress('10.1.2.3')).toBe(true)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('::1')).toBe(true)
  })
})
