export interface ExtractedAudioMeta {
  title: string
  artist: string
  album: string
  durationSec: number | null
  lrcText: string
  coverFile: File | null
  coverPreviewUrl: string | null
}

const EMPTY_AUDIO_META: ExtractedAudioMeta = {
  title: '',
  artist: '',
  album: '',
  durationSec: null,
  lrcText: '',
  coverFile: null,
  coverPreviewUrl: null
}

const LRC_TIMESTAMP_DETECT_RE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/

function detectCoverMimeAndExt(rawFormat: string | undefined, bytes: Uint8Array): {
  mime: string
  ext: string
} {
  // Sniff magic bytes first so mislabeled ID3 APIC headers still upload cleanly
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' }
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
    return { mime: 'image/gif', ext: 'gif' }
  }

  const normalized = (rawFormat || '').trim().toLowerCase()
  if (normalized.includes('png')) return { mime: 'image/png', ext: 'png' }
  if (normalized.includes('webp')) return { mime: 'image/webp', ext: 'webp' }
  if (normalized.includes('gif')) return { mime: 'image/gif', ext: 'gif' }
  return { mime: 'image/jpeg', ext: 'jpg' }
}

function formatMsToLrcTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms))
  const totalSeconds = Math.floor(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const hundredths = Math.floor((safeMs % 1000) / 10)
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    hundredths
  ).padStart(2, '0')}]`
}

function extractLyricsFromMetadata(
  lyricsEntries:
    | Array<{
        text?: string
        syncText?: Array<{ text: string; timestamp?: number }>
      }>
    | undefined,
  nativeTags: Record<string, Array<{ id: string; value: unknown }>> | undefined
): string {
  let syncedCandidate = ''
  let plainCandidate = ''

  if (Array.isArray(lyricsEntries)) {
    for (const entry of lyricsEntries) {
      if (Array.isArray(entry.syncText) && entry.syncText.length > 0) {
        const lines: string[] = []
        for (const item of entry.syncText) {
          const lineText = (item.text || '').trim()
          if (!lineText) continue
          if (typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)) {
            lines.push(`${formatMsToLrcTimestamp(item.timestamp)} ${lineText}`)
          } else {
            lines.push(lineText)
          }
        }
        if (lines.length > 0 && !syncedCandidate) {
          syncedCandidate = lines.join('\n')
        }
      }

      const rawText = typeof entry.text === 'string' ? entry.text.trim() : ''
      if (rawText) {
        if (LRC_TIMESTAMP_DETECT_RE.test(rawText) && !syncedCandidate) {
          syncedCandidate = rawText
        } else if (!plainCandidate) {
          plainCandidate = rawText
        }
      }
    }
  }

  if (syncedCandidate) return syncedCandidate

  // Check native Vorbis / ID3 / iTunes lyric tags in case synced LRC text sits in native frames
  if (nativeTags && typeof nativeTags === 'object') {
    for (const tagList of Object.values(nativeTags)) {
      if (!Array.isArray(tagList)) continue
      for (const tag of tagList) {
        const idUpper = String(tag.id || '').toUpperCase()
        if (
          idUpper === 'LYRICS' ||
          idUpper === 'UNSYNCEDLYRICS' ||
          idUpper === '©LYR' ||
          idUpper === 'USLT' ||
          idUpper === 'TXXX:LYRICS'
        ) {
          const textVal =
            typeof tag.value === 'string'
              ? tag.value.trim()
              : tag.value && typeof tag.value === 'object' && 'text' in tag.value
                ? String((tag.value as { text?: unknown }).text || '').trim()
                : ''
          if (!textVal) continue
          if (LRC_TIMESTAMP_DETECT_RE.test(textVal)) {
            return textVal
          }
          if (!plainCandidate) {
            plainCandidate = textVal
          }
        }
      }
    }
  }

  return plainCandidate
}

export async function extractAudioMetadata(file: File): Promise<ExtractedAudioMeta> {
  if (!file) return { ...EMPTY_AUDIO_META }

  try {
    const { parseBlob, selectCover } = await import('music-metadata')
    const metadata = await parseBlob(file, { duration: true })

    const title = (metadata.common.title || '').trim()
    const artist = (
      metadata.common.artist ||
      (Array.isArray(metadata.common.artists) ? metadata.common.artists.join(' / ') : '') ||
      metadata.common.albumArtist ||
      ''
    ).trim()
    const album = (metadata.common.album || '').trim()

    const rawDuration = metadata.format.duration
    const durationSec =
      typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0
        ? Math.round(rawDuration)
        : null

    const lrcText = extractLyricsFromMetadata(metadata.common.lyrics, metadata.native)

    let coverFile: File | null = null
    let coverPreviewUrl: string | null = null

    const pic = selectCover(metadata.common.picture) ?? metadata.common.picture?.[0] ?? null
    if (pic && pic.data && pic.data.byteLength > 0) {
      const bytes = new Uint8Array(pic.data)
      const { mime, ext } = detectCoverMimeAndExt(pic.format, bytes)
      coverFile = new File([bytes], `embedded-cover.${ext}`, { type: mime })
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        coverPreviewUrl = URL.createObjectURL(coverFile)
      }
    }

    return {
      title,
      artist,
      album,
      durationSec,
      lrcText,
      coverFile,
      coverPreviewUrl
    }
  } catch {
    return { ...EMPTY_AUDIO_META }
  }
}
