import { describe, expect, it } from 'vitest'
import { parseVideoUrl } from '../src/blog-api'
import { parseLrc } from '../src/blog-music'
import { parseBlogRoute } from '../src/components/blog/BlogApp'
import type { BlogCatalogItem, BlogComment, BlogFriend, BlogMusicTrack, BlogPageData, BlogPostDetail } from '../src/blog-types'
import {
  handleBlogApi,
  inferAudioMimeAndExt,
  inferVideoMimeAndExt,
  isValidPageSlug,
  parseByteRange,
  sanitizeImages,
  validateCatalogSection,
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
        if (normalized.startsWith('SELECT id, email FROM users')) {
          return { id: owner.id, email: owner.email } as unknown as T
        }
        if (normalized.includes('FROM blog_settings WHERE user_id = ?')) {
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
        if (normalized.includes('FROM blog_posts WHERE user_id = ?')) {
          const results = [...postRows.values()].filter((r) => r.user_id === bound[0])
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
          const [id, userId, title, artist, album, audioMediaId, coverMediaId, lrcText, durationSec, sortOrder, createdAt] = bound
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
    env: { DB: db, IMAGES: images, ASSETS: {} } as unknown as Env,
    ctx,
    mediaRows,
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

    // 1. Music Tracks CRUD
    const trackCreateRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/music/tracks', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: '夜曲',
          artist: 'Jay',
          audioMediaId: audioId,
          lrcText: '[00:01.00] 一群嗜血的蚂蚁',
          sortOrder: 1
        })
      }),
      env,
      ctx
    )
    expect(trackCreateRes.status).toBe(201)
    const track = (await trackCreateRes.json()) as BlogMusicTrack
    expect(track.audioUrl).toBe(`/api/blog/media/${audioId}`)

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
    expect(((await trackPatchRes.json()) as BlogMusicTrack).album).toBe('十一月的萧邦')

    const tracksListRes = await handleBlogApi(
      new Request('https://blog.example.com/api/blog/music/tracks'),
      env,
      ctx
    )
    expect(((await tracksListRes.json()) as { tracks: BlogMusicTrack[] }).tracks).toHaveLength(1)

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
})
