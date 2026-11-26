import { describe, expect, it } from 'vitest'
import { parseVideoUrl } from '../src/blog-api'
import { parseLrc } from '../src/blog-music'
import { parseBlogRoute } from '../src/components/blog/BlogApp'
import type { BlogCatalogItem, BlogComment, BlogFriend, BlogMusicTrack, BlogPageData, BlogPostDetail } from '../src/blog-types'
import workerEntry from '../worker/index'
import {
  collectReferencedBlogMediaIds,
  handleBlogApi,
  inferAudioMimeAndExt,
  inferVideoMimeAndExt,
  isValidPageSlug,
  parseByteRange,
  sanitizeImages,
  sanitizeTrackVisualConfig,
  validateCatalogSection,
  validateMediaKind,
  validatePageSlug
} from '../worker/blog'
import { hashToken } from '../worker/security'
import { ApiError, SESSION_COOKIE, type Env } from '../worker/types'

describe('Phase 2 朋友圈博客纯函数单元测试', () => {
  describe('parseByteRange (HTTP Range 206 解析)', () => {
    it('正确解析标准区间、开放结尾区间与后缀区间', () => {
      expect(parseByteRange('bytes=0-1023', 5000)).toEqual({
        start: 0,
        end: 1023,
        length: 1024
      })
      expect(parseByteRange('bytes=0-0', 5000)).toEqual({
        start: 0,
        end: 0,
        length: 1
      })
      expect(parseByteRange('bytes=1000-', 5000)).toEqual({
        start: 1000,
        end: 4999,
        length: 4000
      })
      expect(parseByteRange('bytes=-500', 5000)).toEqual({
        start: 4500,
        end: 4999,
        length: 500
      })
      // 后缀大于文件总大小时裁剪为整个文件
      expect(parseByteRange('bytes=-99999', 5000)).toEqual({
        start: 0,
        end: 4999,
        length: 5000
      })
      // 结尾超过 totalSize - 1 时按 RFC 9110 自动钳制到末尾
      expect(parseByteRange('bytes=4000-99999', 5000)).toEqual({
        start: 4000,
        end: 4999,
        length: 1000
      })
    })

    it('安全拒绝越界、逆序、多段与格式非法的 Range 头', () => {
      expect(parseByteRange(null, 5000)).toBeNull()
      expect(parseByteRange('', 5000)).toBeNull()
      expect(parseByteRange('items=0-100', 5000)).toBeNull()
      expect(parseByteRange('bytes=-', 5000)).toBeNull()
      expect(parseByteRange('bytes=-0', 5000)).toBeNull()
      expect(parseByteRange('bytes=5000-5001', 5000)).toBeNull()
      expect(parseByteRange('bytes=5000-', 5000)).toBeNull()
      expect(parseByteRange('bytes=800-200', 5000)).toBeNull()
      expect(parseByteRange('bytes=0-10, 20-30', 5000)).toBeNull()
      expect(parseByteRange('bytes=abc-def', 5000)).toBeNull()
      expect(parseByteRange('bytes=0-0', 0)).toBeNull()
    })
  })

  describe('音频与视频 MIME 及扩展名推断', () => {
    it('支持全部受支持的音频 MIME 并在 application/octet-stream 时从扩展名推断', () => {
      expect(inferAudioMimeAndExt('audio/mpeg', 'track.mp3')).toEqual({
        mimeType: 'audio/mpeg',
        ext: 'mp3'
      })
      expect(inferAudioMimeAndExt('audio/mp3', 'track.mp3')).toEqual({
        mimeType: 'audio/mpeg',
        ext: 'mp3'
      })
      expect(inferAudioMimeAndExt('audio/mp4', 'track.m4a')).toEqual({
        mimeType: 'audio/mp4',
        ext: 'm4a'
      })
      expect(inferAudioMimeAndExt('audio/x-m4a', 'track.m4a')).toEqual({
        mimeType: 'audio/mp4',
        ext: 'm4a'
      })
      expect(inferAudioMimeAndExt('audio/aac', 'track.aac')).toEqual({
        mimeType: 'audio/aac',
        ext: 'aac'
      })
      expect(inferAudioMimeAndExt('audio/ogg; codecs=opus', 'track.ogg')).toEqual({
        mimeType: 'audio/ogg',
        ext: 'ogg'
      })
      expect(inferAudioMimeAndExt('audio/wav', 'track.wav')).toEqual({
        mimeType: 'audio/wav',
        ext: 'wav'
      })
      expect(inferAudioMimeAndExt('audio/webm;codecs=opus', 'voice.webm')).toEqual({
        mimeType: 'audio/webm',
        ext: 'webm'
      })
      expect(inferAudioMimeAndExt('audio/flac', 'lossless.flac')).toEqual({
        mimeType: 'audio/flac',
        ext: 'flac'
      })

      // 浏览器回退为 application/octet-stream 或空 MIME 时按扩展名识别
      expect(inferAudioMimeAndExt('application/octet-stream', 'demo.MP3')).toEqual({
        mimeType: 'audio/mpeg',
        ext: 'mp3'
      })
      expect(inferAudioMimeAndExt('application/octet-stream', 'voice.m4a')).toEqual({
        mimeType: 'audio/mp4',
        ext: 'm4a'
      })
      expect(inferAudioMimeAndExt('', 'album.flac')).toEqual({
        mimeType: 'audio/flac',
        ext: 'flac'
      })
      expect(inferAudioMimeAndExt('application/octet-stream', 'clip.ogg')).toEqual({
        mimeType: 'audio/ogg',
        ext: 'ogg'
      })
      expect(inferAudioMimeAndExt('application/octet-stream', 'clip.wav')).toEqual({
        mimeType: 'audio/wav',
        ext: 'wav'
      })
      expect(inferAudioMimeAndExt('application/octet-stream', 'clip.webm')).toEqual({
        mimeType: 'audio/webm',
        ext: 'webm'
      })

      // 拒绝非法类型
      expect(inferAudioMimeAndExt('text/html', 'evil.mp3')).toBeNull()
      expect(inferAudioMimeAndExt('application/octet-stream', 'payload.exe')).toBeNull()
    })

    it('支持 MP4 / QuickTime MOV / WebM 视频 MIME 与扩展名推断', () => {
      expect(inferVideoMimeAndExt('video/mp4', 'clip.mp4')).toEqual({
        mimeType: 'video/mp4',
        ext: 'mp4'
      })
      expect(inferVideoMimeAndExt('video/quicktime', 'IMG_2048.MOV')).toEqual({
        mimeType: 'video/quicktime',
        ext: 'mov'
      })
      expect(inferVideoMimeAndExt('video/webm;codecs=vp9', 'screen.webm')).toEqual({
        mimeType: 'video/webm',
        ext: 'webm'
      })
      expect(inferVideoMimeAndExt('application/octet-stream', 'IMG_9999.MOV')).toEqual({
        mimeType: 'video/quicktime',
        ext: 'mov'
      })
      expect(inferVideoMimeAndExt('', 'vlog.mp4')).toEqual({
        mimeType: 'video/mp4',
        ext: 'mp4'
      })
      expect(inferVideoMimeAndExt('application/octet-stream', 'demo.webm')).toEqual({
        mimeType: 'video/webm',
        ext: 'webm'
      })

      expect(inferVideoMimeAndExt('image/png', 'fake.mp4')).toBeNull()
      expect(inferVideoMimeAndExt('application/octet-stream', 'script.js')).toBeNull()
    })
  })

  describe('独立页面 slug 与目录 section 校验', () => {
    it('仅允许 [a-z0-9-]{1,40} 的合法 slug', () => {
      expect(isValidPageSlug('about')).toBe(true)
      expect(isValidPageSlug('now-2026')).toBe(true)
      expect(validatePageSlug('  uses-gear  ')).toBe('uses-gear')

      expect(isValidPageSlug('')).toBe(false)
      expect(isValidPageSlug('About')).toBe(false)
      expect(isValidPageSlug('../admin')).toBe(false)
      expect(isValidPageSlug('about/me')).toBe(false)
      expect(isValidPageSlug('a'.repeat(41))).toBe(false)
      expect(() => validatePageSlug('Invalid_Slug')).toThrow(ApiError)
    })

    it('仅允许 equipment 或 labs 作为目录分区', () => {
      expect(validateCatalogSection('equipment')).toBe('equipment')
      expect(validateCatalogSection('labs')).toBe('labs')
      expect(() => validateCatalogSection('books')).toThrow(ApiError)
    })
  })

  describe('parseVideoUrl (Bilibili / YouTube / 直链解析)', () => {
    it('正确解析 Bilibili、YouTube 与普通视频链接并拒绝非安全协议', () => {
      const bili = parseVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333')
      expect(bili).toEqual({
        source: 'bilibili',
        url: 'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333',
        embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&high_quality=1&autoplay=0',
        platform: 'Bilibili'
      })

      const ytWatch = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      expect(ytWatch).toEqual({
        source: 'youtube',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
        platform: 'YouTube'
      })

      const ytShortLink = parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=12')
      expect(ytShortLink?.source).toBe('youtube')
      expect(ytShortLink?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')

      const ytShorts = parseVideoUrl('https://www.youtube.com/shorts/abcdef12345')
      expect(ytShorts?.source).toBe('youtube')
      expect(ytShorts?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/abcdef12345')

      const direct = parseVideoUrl('https://cdn.example.com/media/demo.mp4')
      expect(direct).toEqual({
        source: 'url',
        url: 'https://cdn.example.com/media/demo.mp4',
        platform: 'cdn.example.com'
      })

      expect(parseVideoUrl('')).toBeNull()
      expect(parseVideoUrl('javascript:alert(1)')).toBeNull()
      expect(parseVideoUrl('ftp://cdn.example.com/a.mp4')).toBeNull()
      expect(parseVideoUrl('not a url')).toBeNull()
    })
  })

  describe('sanitizeImages (保留 Live Photo liveVideoUrl 与 liveVideoMediaId)', () => {
    it('保留合法的 liveVideoMediaId 与 liveVideoUrl 并在缺失 liveVideoUrl 时自动回填媒体地址', () => {
      const sanitized = sanitizeImages([
        {
          mediaId: 'img-1',
          url: '/api/blog/media/img-1',
          width: 1200,
          height: 900,
          liveVideoMediaId: 'vid-1',
          liveVideoUrl: '/api/blog/media/vid-1'
        },
        {
          mediaId: 'img-2',
          url: '/api/blog/media/img-2',
          liveVideoMediaId: 'vid-2'
        },
        {
          url: 'https://img.example.com/photo.jpg',
          liveVideoUrl: 'javascript:alert(1)'
        }
      ])

      expect(sanitized).toHaveLength(3)
      expect(sanitized[0]).toMatchObject({
        mediaId: 'img-1',
        url: '/api/blog/media/img-1',
        liveVideoMediaId: 'vid-1',
        liveVideoUrl: '/api/blog/media/vid-1'
      })
      expect(sanitized[1]).toMatchObject({
        mediaId: 'img-2',
        url: '/api/blog/media/img-2',
        liveVideoMediaId: 'vid-2',
        liveVideoUrl: '/api/blog/media/vid-2'
      })
      expect(sanitized[2].liveVideoUrl).toBeUndefined()
      expect(sanitized[2].liveVideoMediaId).toBeUndefined()
    })
  })

  describe('parseBlogRoute & parseLrc (前端路由与歌词解析)', () => {
    it('识别全部根路径与 /blog/* 兼容路径', () => {
      expect(parseBlogRoute('/')).toEqual({ kind: 'feed' })
      expect(parseBlogRoute('/blog')).toEqual({ kind: 'feed' })
      expect(parseBlogRoute('/archives')).toEqual({ kind: 'archives' })
      expect(parseBlogRoute('/blog/archives')).toEqual({ kind: 'archives' })
      expect(parseBlogRoute('/about')).toEqual({ kind: 'about' })
      expect(parseBlogRoute('/blog/about')).toEqual({ kind: 'about' })
      expect(parseBlogRoute('/equipment')).toEqual({ kind: 'equipment' })
      expect(parseBlogRoute('/blog/equipment/')).toEqual({ kind: 'equipment' })
      expect(parseBlogRoute('/labs?ref=nav')).toEqual({ kind: 'labs' })
      expect(parseBlogRoute('/blog/labs')).toEqual({ kind: 'labs' })
      expect(parseBlogRoute('/friends')).toEqual({ kind: 'friends' })
      expect(parseBlogRoute('/blog/friends')).toEqual({ kind: 'friends' })
      expect(parseBlogRoute('/articles/abc123')).toEqual({ kind: 'article', shortId: 'abc123' })
      expect(parseBlogRoute('/blog/moments/xyz789')).toEqual({ kind: 'moment', shortId: 'xyz789' })
    })

    it('正确解析多时间轴与毫秒级 LRC 同步歌词并排序', () => {
      const parsed = parseLrc('[00:18.50]第二句\n[00:05.00][00:25.250]副歌重复\n[ar:Jay]\n')
      expect(parsed).toEqual([
        { time: 5, text: '副歌重复' },
        { time: 18.5, text: '第二句' },
        { time: 25.25, text: '副歌重复' }
      ])
    })
  })

  describe('sanitizeTrackVisualConfig (单曲视觉与声学响应配置净化)', () => {
    it('对越界数值执行精确钳制，保留合法局部覆盖，并过滤非法 waveStyle、NaN 与未知字段', () => {
      // 1. 下界钳制
      expect(
        sanitizeTrackVisualConfig({
          sensitivity: -1,
          bassGain: -0.5,
          midGain: -10,
          trebleGain: -0.01,
          beatBoost: -2,
          smoothing: 0,
          silkSpeed: 0.01,
          silkWarp: -3,
          silkOpacity: 0.02,
          silkSoftness: -0.4,
          waveScale: 0.05,
          waveOpacity: 0.01,
          waveStyle: 'bars'
        })
      ).toEqual({
        sensitivity: 0.2,
        bassGain: 0,
        midGain: 0,
        trebleGain: 0,
        beatBoost: 0,
        smoothing: 0.1,
        silkSpeed: 0.2,
        silkWarp: 0.2,
        silkOpacity: 0.15,
        silkSoftness: 0,
        waveScale: 0.3,
        waveOpacity: 0.2,
        waveStyle: 'bars'
      })

      // 2. 上界钳制
      expect(
        sanitizeTrackVisualConfig({
          sensitivity: 9.9,
          bassGain: 5,
          midGain: 3.2,
          trebleGain: 2.5,
          beatBoost: 100,
          smoothing: 0.99,
          silkSpeed: 4.5,
          silkWarp: 3.1,
          silkOpacity: 1.5,
          silkSoftness: 2,
          waveScale: 8,
          waveOpacity: 1.8,
          waveStyle: 'wings'
        })
      ).toEqual({
        sensitivity: 2.5,
        bassGain: 2.0,
        midGain: 2.0,
        trebleGain: 2.0,
        beatBoost: 2.0,
        smoothing: 0.9,
        silkSpeed: 2.2,
        silkWarp: 2.0,
        silkOpacity: 0.95,
        silkSoftness: 1.0,
        waveScale: 2.0,
        waveOpacity: 1.0,
        waveStyle: 'wings'
      })

      // 3. 保留合法的局部覆盖且不注入未设置字段
      expect(
        sanitizeTrackVisualConfig({
          sensitivity: 1.35,
          bassGain: 1.6,
          silkOpacity: 0.72,
          waveStyle: 'horizon'
        })
      ).toEqual({
        sensitivity: 1.35,
        bassGain: 1.6,
        silkOpacity: 0.72,
        waveStyle: 'horizon'
      })

      // 4. 拒绝非法 waveStyle、NaN、Infinity、布尔值及未知字段
      expect(
        sanitizeTrackVisualConfig({
          sensitivity: Number.NaN,
          bassGain: Number.POSITIVE_INFINITY,
          midGain: Number.NEGATIVE_INFINITY,
          trebleGain: 'not-a-number',
          beatBoost: null,
          smoothing: undefined,
          silkSpeed: true,
          silkSoftness: '',
          waveStyle: 'spiral',
          waveScale: 1.25,
          unknownField: 42
        })
      ).toEqual({
        waveScale: 1.25
      })

      // 5. 非普通对象输入安全返回空对象
      expect(sanitizeTrackVisualConfig(null)).toEqual({})
      expect(sanitizeTrackVisualConfig(undefined)).toEqual({})
      expect(sanitizeTrackVisualConfig('invalid')).toEqual({})
      expect(sanitizeTrackVisualConfig([1, 2, 3])).toEqual({})
    })
  })
})

// --- Lightweight in-memory R2 + D1 harness for Worker endpoint integration tests ---

function createPhase2TestEnv() {
  const r2Store = new Map<string, { bytes: Uint8Array; contentType: string; etag: string }>()
  const mediaRows = new Map<string, Record<string, unknown>>()
  const postRows = new Map<string, Record<string, unknown>>()
  const musicRows = new Map<string, Record<string, unknown>>()
  const pageRows = new Map<string, Record<string, unknown>>()
  const pageCommentRows = new Map<string, Record<string, unknown>>()
  const catalogRows = new Map<string, Record<string, unknown>>()
  const friendRows = new Map<string, Record<string, unknown>>()
  const settingsRows = new Map<string, Record<string, unknown>>()
  const memoCanvasRows = new Map<string, Record<string, unknown>>()
  const memoAssetRows = new Map<string, Record<string, unknown>>()
  const pendingWaitUntil: Promise<unknown>[] = []

  const owner = { id: 'owner-1', email: 'owner@example.com' }
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
        etag: `"etag-${key}-${bytes.byteLength}"`
      })
    },
    async head(key: string) {
      const item = r2Store.get(key)
      if (!item) return null
      return {
        key,
        size: item.bytes.byteLength,
        httpEtag: item.etag
      }
    },
    async get(
      key: string,
      options?: { onlyIf?: Headers; range?: { offset: number; length: number } }
    ) {
      const item = r2Store.get(key)
      if (!item) return null
      if (options?.onlyIf) {
        const ifNoneMatch = options.onlyIf.get('if-none-match')
        if (ifNoneMatch && ifNoneMatch === item.etag) {
          return { key, size: item.bytes.byteLength, httpEtag: item.etag }
        }
      }
      const slice = options?.range
        ? item.bytes.slice(options.range.offset, options.range.offset + options.range.length)
        : item.bytes
      return {
        key,
        size: item.bytes.byteLength,
        httpEtag: item.etag,
        body: slice,
        async arrayBuffer() {
          return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)
        }
      }
    },
    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const k of list) r2Store.delete(k)
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
          if (bound[0] === sessionHash) {
            return { id: owner.id, email: owner.email, expires_at: Date.now() + 86400_000 } as unknown as T
          }
          return null
        }
        if (normalized.startsWith('SELECT id, email FROM users') || normalized.startsWith('SELECT id FROM users')) {
          return { id: owner.id, email: owner.email } as unknown as T
        }
        if (normalized.includes('FROM blog_settings WHERE user_id = ?')) {
          return (settingsRows.get(String(bound[0])) as unknown as T) || null
        }
        if (normalized.includes('SUM(size)') && normalized.includes('FROM assets WHERE user_id = ?')) {
          return { total: 1024 } as unknown as T
        }
        if (normalized.includes('SUM(size)') && normalized.includes('FROM memo_assets WHERE user_id = ?')) {
          const rows = [...memoAssetRows.values()].filter((r) => r.user_id === bound[0])
          const total = rows.reduce((s, r) => s + Number(r.size || 0), 0)
          return { total, count: rows.length } as unknown as T
        }
        if (normalized.includes('COUNT(*)') && normalized.includes('FROM memo_canvas WHERE user_id = ?')) {
          return { count: memoCanvasRows.has(String(bound[0])) ? 1 : 0 } as unknown as T
        }
        if (normalized.includes('FROM memo_canvas WHERE user_id = ?')) {
          return (memoCanvasRows.get(String(bound[0])) as unknown as T) || null
        }
        if (normalized.includes('COUNT(*)') && normalized.includes('FROM blog_comments')) {
          return { count: 0 } as unknown as T
        }
        if (normalized.includes('FROM blog_posts WHERE user_id = ? AND short_id = ?')) {
          for (const row of postRows.values()) {
            if (row.user_id === bound[0] && row.short_id === bound[1]) {
              return row as unknown as T
            }
          }
          return null
        }
        if (normalized.includes('FROM blog_media WHERE id = ? AND user_id = ?')) {
          const row = mediaRows.get(String(bound[0]))
          return row && row.user_id === bound[1] ? (row as unknown as T) : null
        }
        if (normalized.includes('FROM blog_media WHERE id = ?')) {
          return (mediaRows.get(String(bound[0])) as unknown as T) || null
        }
        if (normalized.startsWith('SELECT 1 FROM blog_posts WHERE short_id = ?')) {
          for (const row of postRows.values()) {
            if (row.short_id === bound[0]) return { 1: 1 } as unknown as T
          }
          return null
        }
        if (normalized.startsWith('SELECT * FROM blog_posts WHERE user_id = ? AND (short_id = ? OR id = ?)')) {
          for (const row of postRows.values()) {
            if (row.user_id === bound[0] && (row.short_id === bound[1] || row.id === bound[2])) {
              return row as unknown as T
            }
          }
          return null
        }
        if (normalized.includes('FROM blog_music_tracks WHERE id = ? AND user_id = ?')) {
          const row = musicRows.get(String(bound[0]))
          return row && row.user_id === bound[1] ? (row as unknown as T) : null
        }
        if (normalized.includes('FROM blog_pages WHERE user_id = ? AND slug = ?')) {
          return (pageRows.get(`${bound[0]}:${bound[1]}`) as unknown as T) || null
        }
        if (normalized.includes('FROM blog_page_comments WHERE id = ? AND user_id = ?')) {
          const row = pageCommentRows.get(String(bound[0]))
          if (!row || row.user_id !== bound[1]) return null
          if (bound[2] !== undefined && row.page_slug !== bound[2]) return null
          return row as unknown as T
        }
        if (normalized.includes('FROM blog_catalog_items WHERE id = ? AND user_id = ?')) {
          const row = catalogRows.get(String(bound[0]))
          return row && row.user_id === bound[1] ? (row as unknown as T) : null
        }
        if (normalized.includes('FROM blog_friends WHERE id = ? AND user_id = ?')) {
          const row = friendRows.get(String(bound[0]))
          return row && row.user_id === bound[1] ? (row as unknown as T) : null
        }
        return null
      },
      async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
        if (normalized.startsWith('SELECT id FROM users')) {
          return { results: [{ id: owner.id } as unknown as T] }
        }
        if (normalized.includes('FROM blog_media WHERE user_id = ?')) {
          let results = [...mediaRows.values()].filter((r) => r.user_id === bound[0])
          if (normalized.includes('AND paired_media_id IS NOT NULL')) {
            results = results.filter((r) => Boolean(r.paired_media_id))
          } else if (normalized.includes('AND paired_media_id = ?')) {
            results = results.filter((r) => r.paired_media_id === bound[1])
          } else if (normalized.includes('AND (id IN')) {
            const half = (bound.length - 1) / 2
            const setA = new Set(bound.slice(1, 1 + half).map(String))
            const setB = new Set(bound.slice(1 + half).map(String))
            results = results.filter(
              (r) => setA.has(String(r.id)) || (r.paired_media_id && setB.has(String(r.paired_media_id)))
            )
          } else if (normalized.includes('AND id IN')) {
            const ids = new Set(bound.slice(1).map(String))
            results = results.filter((r) => ids.has(String(r.id)))
          }
          return { results: results as unknown as T[] }
        }
        if (normalized.includes('FROM blog_posts WHERE user_id = ?')) {
          let results = [...postRows.values()].filter((r) => r.user_id === bound[0])
          if (normalized.includes("visibility <> 'private'")) {
            results = results.filter((r) => r.visibility !== 'private')
          }
          if (normalized.includes('AND id IN')) {
            const ids = new Set(bound.slice(1).map(String))
            results = results.filter((r) => ids.has(String(r.id)))
          }
          results.sort(
            (a, b) =>
              Number(b.is_pinned || 0) - Number(a.is_pinned || 0) ||
              Number(b.published_at || 0) - Number(a.published_at || 0) ||
              Number(b.created_at || 0) - Number(a.created_at || 0)
          )
          return { results: results as unknown as T[] }
        }
        if (normalized.includes('FROM blog_pages WHERE user_id = ?')) {
          const results = [...pageRows.values()].filter((r) => r.user_id === bound[0])
          return { results: results as unknown as T[] }
        }
        if (normalized.includes('FROM memo_assets WHERE user_id = ?')) {
          const results = [...memoAssetRows.values()].filter((r) => r.user_id === bound[0])
          return { results: results as unknown as T[] }
        }
        if (normalized.includes('FROM blog_likes WHERE post_id IN')) {
          return { results: [] }
        }
        if (normalized.includes('FROM blog_comments WHERE post_id IN')) {
          return { results: [] }
        }
        if (normalized.includes('FROM blog_music_tracks WHERE user_id = ?')) {
          const results = [...musicRows.values()]
            .filter((r) => r.user_id === bound[0])
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(b.created_at) - Number(a.created_at))
          return { results: results as unknown as T[] }
        }
        if (normalized.includes('FROM blog_page_comments WHERE user_id = ? AND page_slug = ?')) {
          const results = [...pageCommentRows.values()]
            .filter((r) => r.user_id === bound[0] && r.page_slug === bound[1])
            .sort((a, b) => Number(a.created_at) - Number(b.created_at))
          return { results: results as unknown as T[] }
        }
        if (normalized.includes('FROM blog_catalog_items WHERE user_id = ? AND section = ?')) {
          const results = [...catalogRows.values()]
            .filter((r) => r.user_id === bound[0] && r.section === bound[1])
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(b.created_at) - Number(a.created_at))
          return { results: results as unknown as T[] }
        }
        if (normalized.includes("FROM blog_catalog_items WHERE user_id = ? AND section = 'equipment'")) {
          const results = [...catalogRows.values()]
            .filter((r) => r.user_id === bound[0] && r.section === 'equipment')
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(b.created_at) - Number(a.created_at))
          return { results: results as unknown as T[] }
        }
        if (normalized.includes("FROM blog_catalog_items WHERE user_id = ? AND section = 'labs'")) {
          const results = [...catalogRows.values()]
            .filter((r) => r.user_id === bound[0] && r.section === 'labs')
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(b.created_at) - Number(a.created_at))
          return { results: results as unknown as T[] }
        }
        if (normalized.includes('FROM blog_catalog_items WHERE user_id = ?')) {
          const results = [...catalogRows.values()].filter((r) => r.user_id === bound[0])
          return { results: results as unknown as T[] }
        }
        if (normalized.includes('FROM blog_friends WHERE user_id = ?')) {
          const results = [...friendRows.values()]
            .filter((r) => r.user_id === bound[0])
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(b.created_at) - Number(a.created_at))
          return { results: results as unknown as T[] }
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
          } else if (normalized.includes('VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, NULL, ?, ?)')) {
            const [id, userId, kind, originalName, storageKey, mimeType, size, pairedMediaId, createdAt] = bound
            mediaRows.set(String(id), {
              id,
              user_id: userId,
              kind,
              original_name: originalName,
              storage_key: storageKey,
              thumb_key: null,
              mime_type: mimeType,
              thumb_mime_type: null,
              size,
              width: null,
              height: null,
              paired_media_id: pairedMediaId,
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
        if (normalized.startsWith('INSERT INTO blog_posts')) {
          const [
            id, shortId, userId, type, title, excerpt, content, coverMediaId, coverUrl,
            category, tagsJson, imagesJson, linkCardJson, locationName, sourceLabel,
            sourceItemId, metadataJson, visibility, passwordHash, isPinned, createdAt, updatedAt, publishedAt
          ] = bound
          postRows.set(String(id), {
            id,
            short_id: shortId,
            user_id: userId,
            type,
            title,
            excerpt,
            content,
            cover_media_id: coverMediaId,
            cover_url: coverUrl,
            category,
            tags_json: tagsJson,
            images_json: imagesJson,
            link_card_json: linkCardJson,
            location_name: locationName,
            source_label: sourceLabel,
            source_item_id: sourceItemId,
            metadata_json: metadataJson,
            visibility,
            password_hash: passwordHash,
            is_pinned: isPinned,
            view_count: 0,
            created_at: createdAt,
            updated_at: updatedAt,
            published_at: publishedAt
          })
          return { success: true }
        }
        if (normalized.startsWith('UPDATE blog_posts SET')) {
          const id = String(bound[bound.length - 2])
          const existing = postRows.get(id)
          if (existing) {
            const setClause = normalized.slice('UPDATE blog_posts SET '.length, normalized.indexOf(' WHERE '))
            const cols = setClause.split(',').map((part) => part.split('=')[0].trim())
            cols.forEach((col, idx) => {
              existing[col] = bound[idx]
            })
          }
          return { success: true }
        }
        if (normalized.startsWith('INSERT INTO blog_music_tracks')) {
          const [
            id,
            userId,
            title,
            artist,
            album,
            audioMediaId,
            coverMediaId,
            lrcText,
            durationSec,
            sortOrder,
            visualConfigJson,
            createdAt
          ] = bound
          musicRows.set(String(id), {
            id,
            user_id: userId,
            title,
            artist,
            album,
            audio_media_id: audioMediaId,
            cover_media_id: coverMediaId,
            lrc_text: lrcText,
            duration_sec: durationSec,
            sort_order: sortOrder,
            visual_config_json: visualConfigJson,
            created_at: createdAt
          })
          return { success: true }
        }
        if (normalized.startsWith('UPDATE blog_music_tracks SET')) {
          const id = String(bound[bound.length - 2])
          const existing = musicRows.get(id)
          if (existing) {
            const setClause = normalized.slice('UPDATE blog_music_tracks SET '.length, normalized.indexOf(' WHERE '))
            const cols = setClause.split(',').map((part) => part.split('=')[0].trim())
            cols.forEach((col, idx) => {
              existing[col] = bound[idx]
            })
          }
          return { success: true }
        }
        if (normalized.startsWith('DELETE FROM blog_music_tracks')) {
          musicRows.delete(String(bound[0]))
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
        if (normalized.startsWith('INSERT INTO blog_page_comments')) {
          const [id, userId, pageSlug, parentId, replyToId, replyToName, authorName, authorEmail, authorWebsite, isOwner, content, createdAt] = bound
          pageCommentRows.set(String(id), {
            id,
            user_id: userId,
            page_slug: pageSlug,
            parent_id: parentId,
            reply_to_id: replyToId,
            reply_to_name: replyToName,
            author_name: authorName,
            author_email: authorEmail,
            author_website: authorWebsite,
            is_owner: isOwner,
            content,
            like_count: 0,
            created_at: createdAt
          })
          return { success: true }
        }
        if (normalized.startsWith('DELETE FROM blog_page_comments')) {
          pageCommentRows.delete(String(bound[0]))
          return { success: true }
        }
        if (normalized.startsWith('INSERT INTO blog_catalog_items')) {
          const [id, userId, section, category, title, subtitle, description, imageMediaId, imageUrl, linkUrl, tag, sortOrder, createdAt, updatedAt] = bound
          catalogRows.set(String(id), {
            id,
            user_id: userId,
            section,
            category,
            title,
            subtitle,
            description,
            image_media_id: imageMediaId,
            image_url: imageUrl,
            link_url: linkUrl,
            tag,
            sort_order: sortOrder,
            created_at: createdAt,
            updated_at: updatedAt
          })
          return { success: true }
        }
        if (normalized.startsWith('UPDATE blog_catalog_items SET')) {
          const id = String(bound[bound.length - 2])
          const existing = catalogRows.get(id)
          if (existing) {
            const setClause = normalized.slice('UPDATE blog_catalog_items SET '.length, normalized.indexOf(' WHERE '))
            const cols = setClause.split(',').map((part) => part.split('=')[0].trim())
            cols.forEach((col, idx) => {
              existing[col] = bound[idx]
            })
          }
          return { success: true }
        }
        if (normalized.startsWith('DELETE FROM blog_catalog_items')) {
          catalogRows.delete(String(bound[0]))
          return { success: true }
        }
        if (normalized.startsWith('INSERT INTO blog_friends')) {
          const [id, userId, name, url, avatarUrl, avatarMediaId, description, sortOrder, createdAt, updatedAt] = bound
          friendRows.set(String(id), {
            id,
            user_id: userId,
            name,
            url,
            avatar_url: avatarUrl,
            avatar_media_id: avatarMediaId,
            description,
            sort_order: sortOrder,
            created_at: createdAt,
            updated_at: updatedAt
          })
          return { success: true }
        }
        if (normalized.startsWith('UPDATE blog_friends SET')) {
          const id = String(bound[bound.length - 2])
          const existing = friendRows.get(id)
          if (existing) {
            const setClause = normalized.slice('UPDATE blog_friends SET '.length, normalized.indexOf(' WHERE '))
            const cols = setClause.split(',').map((part) => part.split('=')[0].trim())
            cols.forEach((col, idx) => {
              existing[col] = bound[idx]
            })
          }
          return { success: true }
        }
        if (normalized.startsWith('DELETE FROM blog_friends')) {
          friendRows.delete(String(bound[0]))
          return { success: true }
        }
        if (normalized.startsWith('DELETE FROM blog_posts')) {
          postRows.delete(String(bound[0]))
          return { success: true }
        }
        if (normalized.startsWith('DELETE FROM blog_media WHERE user_id = ? AND id IN')) {
          for (const id of bound.slice(1)) {
            mediaRows.delete(String(id))
          }
          return { success: true }
        }
        if (normalized.startsWith('INSERT INTO blog_settings')) {
          const [userId, siteName, nickname, bio, avatarMediaId, coverMediaId, footerText, allowComments, extensionsJson, updatedAt] = bound
          settingsRows.set(String(userId), {
            user_id: userId,
            site_name: siteName,
            nickname,
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
        if (normalized.startsWith('DELETE FROM memo_assets WHERE user_id = ?')) {
          for (const [k, v] of memoAssetRows.entries()) {
            if (v.user_id === bound[0]) memoAssetRows.delete(k)
          }
          return { success: true }
        }
        if (normalized.startsWith('DELETE FROM memo_canvas WHERE user_id = ?')) {
          memoCanvasRows.delete(String(bound[0]))
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

  const assetsFetcher = {
    async fetch(req: Request) {
      const u = new URL(req.url)
      if (u.pathname === '/assets/chunk-ok.js') {
        return new Response('console.log("ok")', {
          status: 200,
          headers: { 'content-type': 'application/javascript; charset=utf-8' }
        })
      }
      // Simulate Cloudflare SPA fallback returning index.html for missing assets & HTML routes
      return new Response(
        '<!doctype html><html><head><meta charset="UTF-8"><title>Do It Laaaaaater</title></head><body><div id="root"></div></body></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
      )
    }
  }

  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pendingWaitUntil.push(promise)
    },
    passThroughOnException() {}
  } as unknown as ExecutionContext

  return {
    env: { DB: db, IMAGES: images, ASSETS: assetsFetcher } as unknown as Env,
    ctx,
    r2Store,
    mediaRows,
    postRows,
    memoCanvasRows,
    memoAssetRows,
    async flushWaitUntil() {
      while (pendingWaitUntil.length) {
        const batch = pendingWaitUntil.splice(0, pendingWaitUntil.length)
        await Promise.all(batch)
      }
    },
    async ownerCookie() {
      const rawToken = 'test-owner-session-token'
      sessionHash = await hashToken(rawToken)
      return `${SESSION_COOKIE}=${rawToken}`
    }
  }
}

describe('Phase 2 Worker 接口集成测试', () => {
  it('支持音视频与 Live Photo 配对上传、Range 206 流式切片、304 与 416', async () => {
    const { env, ctx, mediaRows, ownerCookie } = createPhase2TestEnv()
    const cookie = await ownerCookie()

    // 1. 上传音频文件 (application/octet-stream 自动识别 .mp3)
    const audioBytes = new Uint8Array(200)
    for (let i = 0; i < audioBytes.length; i += 1) audioBytes[i] = i % 256
    const audioForm = new FormData()
    audioForm.append('file', new File([audioBytes], 'theme-song.mp3', { type: 'application/octet-stream' }))
    audioForm.append('kind', 'audio')

    const uploadRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/media', {
        method: 'POST',
        headers: { cookie },
        body: audioForm
      }),
      env,
      ctx
    )
    expect(uploadRes.status).toBe(201)
    const uploadJson = (await uploadRes.json()) as { media: Array<{ id: string; kind: string; mimeType: string; size: number; url: string }> }
    expect(uploadJson.media).toHaveLength(1)
    const audioMedia = uploadJson.media[0]
    expect(audioMedia.kind).toBe('audio')
    expect(audioMedia.mimeType).toBe('audio/mpeg')
    expect(audioMedia.size).toBe(200)

    // 2. 上传配对 Live Photo 视频 (.mov)
    const videoForm = new FormData()
    videoForm.append('file', new File([new Uint8Array([1, 2, 3, 4, 5])], 'IMG_001.MOV', { type: 'application/octet-stream' }))
    videoForm.append('kind', 'video')
    videoForm.append('pairedMediaId', audioMedia.id)

    const videoRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/media', {
        method: 'POST',
        headers: { cookie },
        body: videoForm
      }),
      env,
      ctx
    )
    expect(videoRes.status).toBe(201)
    const videoJson = (await videoRes.json()) as { media: Array<{ id: string; kind: string; mimeType: string }> }
    expect(videoJson.media[0].kind).toBe('video')
    expect(videoJson.media[0].mimeType).toBe('video/quicktime')
    expect(mediaRows.get(videoJson.media[0].id)?.paired_media_id).toBe(audioMedia.id)

    // 3. 无 Range 请求返回 200 + Accept-Ranges: bytes，且支持 ETag 304
    const fullRes = await handleBlogApi(
      new Request(`https://blog.example.com${audioMedia.url}`),
      env,
      ctx
    )
    expect(fullRes.status).toBe(200)
    expect(fullRes.headers.get('accept-ranges')).toBe('bytes')
    expect(fullRes.headers.get('content-type')).toBe('audio/mpeg')
    const etag = fullRes.headers.get('etag')!
    expect(etag).toBeTruthy()

    const notModifiedRes = await handleBlogApi(
      new Request(`https://blog.example.com${audioMedia.url}`, {
        headers: { 'if-none-match': etag }
      }),
      env,
      ctx
    )
    expect(notModifiedRes.status).toBe(304)
    expect(notModifiedRes.headers.get('accept-ranges')).toBe('bytes')

    // 4. Range 请求返回 206 Partial Content 与精确字节切片
    const partialRes = await handleBlogApi(
      new Request(`https://blog.example.com${audioMedia.url}`, {
        headers: { range: 'bytes=10-29' }
      }),
      env,
      ctx
    )
    expect(partialRes.status).toBe(206)
    expect(partialRes.headers.get('accept-ranges')).toBe('bytes')
    expect(partialRes.headers.get('content-range')).toBe('bytes 10-29/200')
    expect(partialRes.headers.get('content-length')).toBe('20')
    const sliced = new Uint8Array(await partialRes.arrayBuffer())
    expect(sliced).toEqual(audioBytes.slice(10, 30))

    // 5. 非法越界 Range 返回 416 Range Not Satisfiable
    const invalidRangeRes = await handleBlogApi(
      new Request(`https://blog.example.com${audioMedia.url}`, {
        headers: { range: 'bytes=500-600' }
      }),
      env,
      ctx
    )
    expect(invalidRangeRes.status).toBe(416)
    expect(invalidRangeRes.headers.get('content-range')).toBe('bytes */200')
  })

  it('POST / PATCH /api/blog/posts 完整保留 Live Photo 字段与 music / video metadata', async () => {
    const { env, ctx, ownerCookie } = createPhase2TestEnv()
    const cookie = await ownerCookie()

    const createRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/posts', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'moment',
          content: '',
          images: [
            {
              mediaId: 'photo-1',
              url: '/api/blog/media/photo-1',
              liveVideoMediaId: 'live-vid-1',
              liveVideoUrl: '/api/blog/media/live-vid-1'
            }
          ],
          metadata: {
            music: {
              trackId: 'track-1',
              title: '晴天',
              artist: '周杰伦',
              audioUrl: '/api/blog/media/audio-1'
            },
            video: {
              source: 'bilibili',
              url: 'https://www.bilibili.com/video/BV1xx411c7mD',
              embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD'
            }
          }
        })
      }),
      env,
      ctx
    )
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as BlogPostDetail
    expect(created.images[0].liveVideoMediaId).toBe('live-vid-1')
    expect(created.images[0].liveVideoUrl).toBe('/api/blog/media/live-vid-1')
    expect(created.metadata).toMatchObject({
      music: { title: '晴天', artist: '周杰伦' },
      video: { source: 'bilibili' }
    })

    const patchRes = await handleBlogApi(
      new Request(`https://blog.example.com/api/blog/posts/${created.shortId}`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            ...created.metadata,
            music: {
              title: '七里香',
              artist: '周杰伦',
              audioUrl: '/api/blog/media/audio-2'
            }
          }
        })
      }),
      env,
      ctx
    )
    expect(patchRes.status).toBe(200)
    const patched = (await patchRes.json()) as BlogPostDetail
    expect(patched.images[0].liveVideoUrl).toBe('/api/blog/media/live-vid-1')
    expect((patched.metadata.music as { title: string }).title).toBe('七里香')
    expect((patched.metadata.video as { source: string }).source).toBe('bilibili')
  })

  it('完整支持歌单、独立页面与留言、装备/实验室目录以及友链 CRUD', async () => {
    const { env, ctx, ownerCookie } = createPhase2TestEnv()
    const cookie = await ownerCookie()

    // 先上传一段音频供歌单引用
    const audioForm = new FormData()
    audioForm.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'song.mp3', { type: 'audio/mpeg' }))
    audioForm.append('kind', 'audio')
    const mediaRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/media', { method: 'POST', headers: { cookie }, body: audioForm }),
      env,
      ctx
    )
    const audioId = ((await mediaRes.json()) as { media: Array<{ id: string }> }).media[0].id

    // 1. Music Tracks CRUD + visualConfig 净化持久化与 bootstrap?full=1 下发
    const trackCreateRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/music/tracks', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: '夜曲',
          artist: 'Jay',
          audioMediaId: audioId,
          lrcText: '[00:01.00] 一群嗜血的蚂蚁',
          sortOrder: 1,
          visualConfig: {
            sensitivity: 9.0,
            bassGain: 1.45,
            waveStyle: 'horizon',
            extraBadKey: 'ignored'
          }
        })
      }),
      env,
      ctx
    )
    expect(trackCreateRes.status).toBe(201)
    const track = (await trackCreateRes.json()) as BlogMusicTrack
    expect(track.audioUrl).toBe(`/api/blog/media/${audioId}`)
    expect(track.visualConfig).toEqual({
      sensitivity: 2.5,
      bassGain: 1.45,
      waveStyle: 'horizon'
    })

    // 未携带 visualConfig 的 PATCH 必须原样保留既有 visualConfig
    const trackPatchRes = await handleBlogApi(
      new Request(`https://blog.example.com/api/blog/music/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ album: '十一月的萧邦', durationSec: 226 })
      }),
      env,
      ctx
    )
    expect(trackPatchRes.status).toBe(200)
    const patchedTrackMeta = (await trackPatchRes.json()) as BlogMusicTrack
    expect(patchedTrackMeta.album).toBe('十一月的萧邦')
    expect(patchedTrackMeta.visualConfig).toEqual({
      sensitivity: 2.5,
      bassGain: 1.45,
      waveStyle: 'horizon'
    })

    // 携带 visualConfig 的 PATCH 会重新净化并覆盖存储
    const trackVisualPatchRes = await handleBlogApi(
      new Request(`https://blog.example.com/api/blog/music/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          visualConfig: {
            silkSpeed: 1.3,
            silkOpacity: 0.01,
            waveStyle: 'wings',
            waveScale: 1.4
          }
        })
      }),
      env,
      ctx
    )
    expect(trackVisualPatchRes.status).toBe(200)
    expect(((await trackVisualPatchRes.json()) as BlogMusicTrack).visualConfig).toEqual({
      silkSpeed: 1.3,
      silkOpacity: 0.15,
      waveStyle: 'wings',
      waveScale: 1.4
    })

    const tracksListRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/music/tracks'),
      env,
      ctx
    )
    const listedTracks = ((await tracksListRes.json()) as { tracks: BlogMusicTrack[] }).tracks
    expect(listedTracks).toHaveLength(1)
    expect(listedTracks[0].visualConfig).toEqual({
      silkSpeed: 1.3,
      silkOpacity: 0.15,
      waveStyle: 'wings',
      waveScale: 1.4
    })

    const bootWithTrackRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/bootstrap?full=1'),
      env,
      ctx
    )
    const bootWithTrack = (await bootWithTrackRes.json()) as { tracks: BlogMusicTrack[] }
    expect(bootWithTrack.tracks).toHaveLength(1)
    expect(bootWithTrack.tracks[0].visualConfig).toEqual({
      silkSpeed: 1.3,
      silkOpacity: 0.15,
      waveStyle: 'wings',
      waveScale: 1.4
    })

    // 2. Standalone Page (/about) 默认值、PUT 更新与留言板
    const defaultAboutRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/pages/about'),
      env,
      ctx
    )
    const defaultAbout = (await defaultAboutRes.json()) as BlogPageData
    expect(defaultAbout.title).toBe('关于我')
    expect(defaultAbout.subtitle).toBe('数字花园与个人简介')
    expect(defaultAbout.allowComments).toBe(true)

    const commentRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/pages/about/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.8' },
        body: JSON.stringify({
          authorName: '路人甲',
          authorWebsite: 'https://visitor.example.com',
          content: '很棒的博客！'
        })
      }),
      env,
      ctx
    )
    expect(commentRes.status).toBe(201)
    const pageComment = (await commentRes.json()) as BlogComment
    expect(pageComment.authorName).toBe('路人甲')

    const putAboutRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/pages/about', {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: '关于博主',
          subtitle: '全栈开发者',
          content: '欢迎来到我的数字花园',
          allowComments: false
        })
      }),
      env,
      ctx
    )
    const updatedAbout = (await putAboutRes.json()) as BlogPageData
    expect(updatedAbout.title).toBe('关于博主')
    expect(updatedAbout.allowComments).toBe(false)
    expect(updatedAbout.comments).toHaveLength(1)

    // 关闭留言后访客被拒绝 (403)，但博主本人仍可留言
    await expect(
      handleBlogApi(
        new Request('https://blog.example.com/api/blog/pages/about/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.9' },
          body: JSON.stringify({ content: '访客再次留言' })
        }),
        env,
        ctx
      )
    ).rejects.toMatchObject({ status: 403 })

    const delPageCommentRes = await handleBlogApi(
      new Request(`https://blog.example.com/api/blog/page-comments/${pageComment.id}`, {
        method: 'DELETE',
        headers: { cookie }
      }),
      env,
      ctx
    )
    expect(delPageCommentRes.status).toBe(200)

    // 3. Catalog (/equipment) CRUD
    const catCreateRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/catalog', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          section: 'equipment',
          category: '主力硬件',
          title: 'MacBook Pro 14',
          subtitle: 'M3 Max',
          description: '日常主力开发本',
          linkUrl: 'https://www.apple.com'
        })
      }),
      env,
      ctx
    )
    expect(catCreateRes.status).toBe(201)
    const catItem = (await catCreateRes.json()) as BlogCatalogItem
    expect(catItem.section).toBe('equipment')

    const catListRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/catalog/equipment'),
      env,
      ctx
    )
    expect(((await catListRes.json()) as { items: BlogCatalogItem[] }).items).toHaveLength(1)

    // 4. Friends CRUD
    const friendCreateRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/friends', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: '好友小站',
          url: 'https://friend.example.com',
          description: '独立博客好友'
        })
      }),
      env,
      ctx
    )
    expect(friendCreateRes.status).toBe(201)
    const friend = (await friendCreateRes.json()) as BlogFriend
    expect(friend.name).toBe('好友小站')

    const friendsListRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/friends'),
      env,
      ctx
    )
    expect(((await friendsListRes.json()) as { friends: BlogFriend[] }).friends).toHaveLength(1)

    const delFriendRes = await handleBlogApi(
      new Request(`https://blog.example.com/api/blog/friends/${friend.id}`, {
        method: 'DELETE',
        headers: { cookie }
      }),
      env,
      ctx
    )
    expect(delFriendRes.status).toBe(200)
  })

  it('拒绝 kind=file 上传并下发媒体沙箱头、全局安全头，且支持私密/加密媒体门控', async () => {
    const { env, ctx, ownerCookie } = createPhase2TestEnv()
    const cookie = await ownerCookie()

    expect(() => validateMediaKind('file')).toThrow('不支持该文件类型')

    const htmlForm = new FormData()
    htmlForm.append('file', new File(['<script>alert(1)</script>'], 'xss.html', { type: 'text/html' }))
    htmlForm.append('kind', 'file')

    await expect(
      handleBlogApi(
        new Request('https://blog.example.com/api/blog/media', {
          method: 'POST',
          headers: { cookie },
          body: htmlForm
        }),
        env,
        ctx
      )
    ).rejects.toMatchObject({ status: 400, message: '不支持该文件类型' })

    // 上传两段音频分别挂载到私密动态与加密动态
    const uploadAudio = async (name: string) => {
      const f = new FormData()
      f.append('file', new File([new Uint8Array([9, 8, 7, 6])], name, { type: 'audio/mpeg' }))
      f.append('kind', 'audio')
      const res = await handleBlogApi(
        new Request('https://blog.example.com/api/blog/media', { method: 'POST', headers: { cookie }, body: f }),
        env,
        ctx
      )
      return ((await res.json()) as { media: Array<{ id: string; url: string }> }).media[0]
    }

    const privateMedia = await uploadAudio('private.mp3')
    const passwordMedia = await uploadAudio('password.mp3')

    await handleBlogApi(
      new Request('https://blog.example.com/api/blog/posts', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'moment',
          content: `私密音频 ![a](${privateMedia.url})`,
          visibility: 'private'
        })
      }),
      env,
      ctx
    )

    const pwPostRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/posts', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'moment',
          content: `加密音频 ![b](${passwordMedia.url})`,
          visibility: 'password',
          password: 'secret-pass-123'
        })
      }),
      env,
      ctx
    )
    const pwPost = (await pwPostRes.json()) as BlogPostDetail

    // 未登录访客访问私密媒体 -> 404；博主本人访问 -> 200 + private, no-store + CSP sandbox
    await expect(
      handleBlogApi(new Request(`https://blog.example.com${privateMedia.url}`), env, ctx)
    ).rejects.toMatchObject({ status: 404 })

    const ownerPrivateRes = await handleBlogApi(
      new Request(`https://blog.example.com${privateMedia.url}`, { headers: { cookie } }),
      env,
      ctx
    )
    expect(ownerPrivateRes.status).toBe(200)
    expect(ownerPrivateRes.headers.get('cache-control')).toBe('private, no-store')
    expect(ownerPrivateRes.headers.get('content-security-policy')).toBe('sandbox')
    expect(ownerPrivateRes.headers.get('x-content-type-options')).toBe('nosniff')
    expect(ownerPrivateRes.headers.get('x-frame-options')).toBe('DENY')
    expect(ownerPrivateRes.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')

    // 未解锁访客访问加密媒体 -> 403；解锁获得 Path=/api/blog/ Cookie 后 -> 200 + private, no-store
    await expect(
      handleBlogApi(new Request(`https://blog.example.com${passwordMedia.url}`), env, ctx)
    ).rejects.toMatchObject({ status: 403 })

    const unlockRes = await handleBlogApi(
      new Request(`https://blog.example.com/api/blog/posts/${pwPost.shortId}/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'secret-pass-123' })
      }),
      env,
      ctx
    )
    const setCookieHeader = unlockRes.headers.get('set-cookie') || ''
    expect(setCookieHeader).toContain('Path=/api/blog/')
    const cookiePair = setCookieHeader.split(';')[0]

    const unlockedMediaRes = await handleBlogApi(
      new Request(`https://blog.example.com${passwordMedia.url}`, {
        headers: { cookie: cookiePair }
      }),
      env,
      ctx
    )
    expect(unlockedMediaRes.status).toBe(200)
    expect(unlockedMediaRes.headers.get('cache-control')).toBe('private, no-store')
    expect(unlockedMediaRes.headers.get('content-security-policy')).toBe('sandbox')
  })

  it('支持删帖立即回收未引用媒体、手动/定时 GC、容量统计、bootstrap?full=1、/assets/* 真 404 与 HTML OG 注入', async () => {
    const { env, ctx, r2Store, mediaRows, memoCanvasRows, memoAssetRows, flushWaitUntil, ownerCookie } =
      createPhase2TestEnv()
    const cookie = await ownerCookie()

    // 上传 2 段音频：1 段绑定文章正文 Markdown，1 段作为孤儿草稿
    const uploadAudio = async (name: string) => {
      const f = new FormData()
      f.append('file', new File([new Uint8Array(64)], name, { type: 'audio/mpeg' }))
      f.append('kind', 'audio')
      const res = await handleBlogApi(
        new Request('https://blog.example.com/api/blog/media', { method: 'POST', headers: { cookie }, body: f }),
        env,
        ctx
      )
      return ((await res.json()) as { media: Array<{ id: string; url: string }> }).media[0]
    }

    const linkedMedia = await uploadAudio('linked.mp3')
    const orphanMedia = await uploadAudio('orphan.mp3')

    const postCreateRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/posts', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'article',
          title: '公开测试文章',
          excerpt: '用于验证 OG 注入与媒体回收',
          content: `正文引用 [音频](${linkedMedia.url})`,
          visibility: 'public'
        })
      }),
      env,
      ctx
    )
    const createdPost = (await postCreateRes.json()) as BlogPostDetail

    // 验证 collectReferencedBlogMediaIds 能扫描到 Markdown 引用，但孤儿不在集合内
    const referenced = await collectReferencedBlogMediaIds(env, 'owner-1')
    expect(referenced.has(linkedMedia.id)).toBe(true)
    expect(referenced.has(orphanMedia.id)).toBe(false)

    // 模拟遗留 Memo 数据，验证 GET /api/storage/usage 统计
    memoCanvasRows.set('owner-1', { user_id: 'owner-1', scene_json: '{"elements":[],"appState":{}}' })
    memoAssetRows.set('owner-1:f1', {
      file_id: 'f1',
      user_id: 'owner-1',
      storage_key: 'memo/owner-1/f1.png',
      size: 512
    })
    await env.IMAGES.put('memo/owner-1/f1.png', new Uint8Array(16))

    const usageRes = await workerEntry.fetch(
      new Request('https://blog.example.com/api/storage/usage', { headers: { cookie } }),
      env,
      ctx
    )
    expect(usageRes.status).toBe(200)
    const usage = (await usageRes.json()) as Record<string, number>
    expect(usage).toMatchObject({
      libraryAssetsBytes: 1024,
      blogMediaBytes: 128,
      memoAssetsBytes: 512,
      totalBytes: 1664,
      quotaBytes: 10 * 1024 * 1024 * 1024,
      orphanBlogMediaCount: 1,
      orphanBlogMediaBytes: 64,
      legacyMemoCount: 2
    })

    // 验证 bootstrap?full=1 一次性返回 initialPosts / tracks / railSummary
    const fullBootstrapRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/bootstrap?full=1'),
      env,
      ctx
    )
    const fullBootstrap = (await fullBootstrapRes.json()) as {
      initialPosts: { posts: unknown[]; limit: number }
      tracks: unknown[]
      railSummary: { aboutSubtitle: string; equipment: unknown[]; labs: unknown[]; friends: unknown[] }
    }
    expect(fullBootstrap.initialPosts.limit).toBe(15)
    expect(fullBootstrap.initialPosts.posts).toHaveLength(1)
    expect(Array.isArray(fullBootstrap.tracks)).toBe(true)
    expect(fullBootstrap.railSummary.aboutSubtitle).toBeTruthy()

    // 验证 /assets/* 缺失 chunk 返回真 404 而非 SPA HTML，有效 JS 正常返回 200
    const missingAssetRes = await workerEntry.fetch(
      new Request('https://blog.example.com/assets/BlogApp-oldhash.js'),
      env,
      ctx
    )
    expect(missingAssetRes.status).toBe(404)
    expect(missingAssetRes.headers.get('cache-control')).toBe('no-store')

    const validAssetRes = await workerEntry.fetch(
      new Request('https://blog.example.com/assets/chunk-ok.js'),
      env,
      ctx
    )
    expect(validAssetRes.status).toBe(200)
    expect(validAssetRes.headers.get('x-content-type-options')).toBe('nosniff')

    // 验证公开文章 HTML 自动注入 OG / Twitter / RSS 标签
    const htmlPageRes = await workerEntry.fetch(
      new Request(`https://blog.example.com/articles/${createdPost.shortId}`),
      env,
      ctx
    )
    expect(htmlPageRes.status).toBe(200)
    const injectedHtml = await htmlPageRes.text()
    expect(injectedHtml).toContain('<title>公开测试文章 · 朋友圈博客</title>')
    expect(injectedHtml).toContain('property="og:type" content="article"')
    expect(injectedHtml).toContain('href="/api/blog/feed.xml"')

    // 删除公开文章 -> waitUntil 立即清理只被该文章引用的 linkedMedia (D1 + R2)
    await handleBlogApi(
      new Request(`https://blog.example.com/api/blog/posts/${createdPost.shortId}`, {
        method: 'DELETE',
        headers: { cookie }
      }),
      env,
      ctx
    )
    await flushWaitUntil()
    expect(mediaRows.has(linkedMedia.id)).toBe(false)
    expect([...r2Store.keys()].some((k) => k.includes(linkedMedia.id))).toBe(false)

    // 手动触发 POST /api/blog/media/gc (includeRecent + includeLegacyMemo) 回收近期孤儿与遗留 Memo
    const gcRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/media/gc', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ includeRecent: true, includeLegacyMemo: true })
      }),
      env,
      ctx
    )
    expect(gcRes.status).toBe(200)
    const gcStats = (await gcRes.json()) as Record<string, number>
    expect(gcStats).toMatchObject({
      deletedCount: 1,
      freedBytes: 64,
      legacyMemoDeletedCount: 2,
      legacyMemoFreedBytes: 512
    })
    expect(mediaRows.has(orphanMedia.id)).toBe(false)
    expect(memoCanvasRows.size).toBe(0)
    expect(memoAssetRows.size).toBe(0)
  })
})
