import type { CSSProperties } from 'react'
import type { LibraryItem } from '../types'

/**
 * PosterArtwork — bespoke, deterministic editorial poster compositions for items
 * that have no real cover image. Purely presentational: never mutates data.
 *
 * Layout contract: every composition keeps the bottom ~22% visually quiet, so a
 * floating card overlapping the lower edge of a cover never cuts content off.
 */

export type PosterVariant = 'coverflow' | 'gallery' | 'focus'
export type PosterStyle = 'swiss' | 'obsidian' | 'collage' | 'duotone' | 'bauhaus' | 'vinyl'

export const POSTER_STYLES: readonly PosterStyle[] = ['swiss', 'obsidian', 'collage', 'duotone', 'bauhaus', 'vinyl']

const SEP = '[-–—|｜_·•]'

const TRAILING_NOISE: RegExp[] = [
  // " - 搞七捻三 - LINUX DO", " - 开发调优 - LINUX DO", " - LINUX DO"
  new RegExp(`\\s*${SEP}\\s*(?:[^-–—|｜_·•]{1,24}\\s*${SEP}\\s*)?LINUX\\s*DO\\s*$`, 'i'),
  // " - GameMale最新游戏MOD资源交流论坛！"
  new RegExp(`\\s*${SEP}\\s*GameMale[^-–—|｜_·•]*$`, 'i'),
  // Discuz / generic forum tails
  new RegExp(`\\s*${SEP}\\s*Powered by Discuz!?.*$`, 'i'),
  // Common platform suffixes
  new RegExp(`\\s*${SEP}\\s*(?:知乎|知乎专栏|哔哩哔哩|bilibili|哔哩哔哩_bilibili|微信公众平台|少数派|掘金|稀土掘金|CSDN博客?|博客园|简书|V2EX|GitHub|YouTube|小红书|豆瓣|IT之家|36氪|虎嗅网?)\\s*$`, 'i')
]

/** Strips noisy trailing forum/platform boilerplate for display typography only. */
export function cleanPosterTitle(title: string): string {
  const original = (title || '').trim()
  let result = original
  for (let guard = 0; guard < 6; guard += 1) {
    const before = result
    for (const pattern of TRAILING_NOISE) result = result.replace(pattern, '').trim()
    if (result === before) break
  }
  return result || original
}

function hashId(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

export function posterStyleFor(item: Pick<LibraryItem, 'id'>): PosterStyle {
  return POSTER_STYLES[hashId(item.id) % POSTER_STYLES.length]
}

const DUOTONE_TONES = ['#4d49fc', '#ff6b4a', '#0f8b6c', '#f2b705', '#e0457b', '#1d6fd8'] as const
const COLLAGE_GROUNDS = ['#f4f3ff', '#eff8f2', '#fdf3ec'] as const

function kindLabel(item: LibraryItem) {
  if (item.kind === 'link') return 'WEB'
  if (item.kind === 'text') return 'NOTE'
  return 'PHOTO'
}

function itemDomain(url: string | null) {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

function Motif({ style, seed }: { style: PosterStyle; seed: number }) {
  const flip = seed % 2 === 0
  switch (style) {
    case 'swiss':
      return (
        <svg className="poster-art__motif" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="62" x2="300" y2="62" />
          <line x1={flip ? 96 : 204} y1="0" x2={flip ? 96 : 204} y2="312" />
          <line x1="0" y1="312" x2="300" y2="312" />
          <rect className="poster-art__accent-fill" x={flip ? 0 : 288} y="62" width="12" height="96" />
        </svg>
      )
    case 'obsidian':
      return (
        <svg className="poster-art__motif" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <circle cx={flip ? 222 : 78} cy="118" r="96" />
          <circle cx={flip ? 222 : 78} cy="118" r="64" />
          <circle cx={flip ? 222 : 78} cy="118" r="30" />
          <path className="poster-art__accent-stroke" d={flip ? 'M 102 118 A 120 120 0 0 1 222 -2' : 'M 198 118 A 120 120 0 0 0 78 -2'} />
          <circle className="poster-art__accent-fill" cx={flip ? 126 : 174} cy="118" r="4" />
          <line x1="0" y1="250" x2="300" y2="250" />
        </svg>
      )
    case 'collage':
      return (
        <svg className="poster-art__motif" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect className="poster-art__paper" x={flip ? 128 : 30} y="34" width="142" height="120" rx="6" transform={`rotate(${flip ? 6 : -6} 200 94)`} />
          <rect className="poster-art__paper is-alt" x={flip ? 40 : 120} y="74" width="118" height="96" rx="6" transform={`rotate(${flip ? -4 : 4} 100 122)`} />
          <circle className="poster-art__accent-fill" cx={flip ? 228 : 72} cy="66" r="26" />
          <path className="poster-art__accent-stroke" d="M 40 196 Q 110 150 170 196 T 290 196" />
          <polygon className="poster-art__ink-fill" points={flip ? '60,40 84,40 72,20' : '228,150 252,150 240,130'} />
        </svg>
      )
    case 'duotone':
      return (
        <svg className="poster-art__motif" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true">
          <rect className="poster-art__block" x="0" y="0" width={flip ? 300 : 300} height="168" />
          <rect className="poster-art__block is-deep" x={flip ? 196 : 0} y="0" width="104" height="168" />
          <circle className="poster-art__glare" cx={flip ? 248 : 52} cy="84" r="34" />
        </svg>
      )
    case 'bauhaus':
      return (
        <svg className="poster-art__motif" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path className="poster-art__accent-fill" d={flip ? 'M 300 0 L 300 150 A 150 150 0 0 1 150 0 Z' : 'M 0 0 L 150 0 A 150 150 0 0 1 0 150 Z'} />
          <circle className="poster-art__ink-fill" cx={flip ? 92 : 208} cy="86" r="40" />
          <rect className="poster-art__tone-fill" x={flip ? 150 : 110} y="128" width="40" height="40" />
          <line x1="24" y1="196" x2="276" y2="196" />
        </svg>
      )
    case 'vinyl':
    default:
      return (
        <svg className="poster-art__motif" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {[118, 104, 90, 76, 62].map((radius) => (
            <circle key={radius} cx={flip ? 196 : 104} cy="120" r={radius} />
          ))}
          <circle className="poster-art__accent-fill" cx={flip ? 196 : 104} cy="120" r="34" />
          <circle className="poster-art__hole" cx={flip ? 196 : 104} cy="120" r="4" />
        </svg>
      )
  }
}

export interface PosterArtworkProps {
  item: LibraryItem
  index?: number
  variant?: PosterVariant
}

export function PosterArtwork({ item, index, variant = 'coverflow' }: PosterArtworkProps) {
  const seed = hashId(item.id)
  const style = POSTER_STYLES[seed % POSTER_STYLES.length]
  const accent = item.category?.color || '#4d49fc'
  const tone = DUOTONE_TONES[(seed >> 3) % DUOTONE_TONES.length]
  const ground = COLLAGE_GROUNDS[(seed >> 5) % COLLAGE_GROUNDS.length]
  const title = cleanPosterTitle(item.title)
  const domain = itemDomain(item.url)
  const number = typeof index === 'number'
    ? String(index + 1).padStart(2, '0')
    : String(seed % 1000).padStart(3, '0')
  const cssVars = {
    '--poster-accent': accent,
    '--poster-tone': tone,
    '--poster-ground': ground
  } as CSSProperties

  return (
    <div
      className={`poster-art poster-art--${style} poster-art--${variant}${title.length > 34 ? ' is-long' : ''}`}
      style={cssVars}
      data-poster-style={style}
      aria-hidden="true"
    >
      <Motif style={style} seed={seed} />

      <div className="poster-art__top">
        <span className="poster-art__kind">{kindLabel(item)}</span>
        <span className="poster-art__stamp">No.{number}</span>
      </div>

      {style === 'swiss' && (
        <span className="poster-art__index">{number}</span>
      )}

      <div className="poster-art__body">
        <span className="poster-art__rule" />
        <strong className="poster-art__title">{title}</strong>
        <span className="poster-art__meta">
          <span className="poster-art__dot" />
          <span className="poster-art__cat">{item.category?.name || '未分类'}</span>
          {domain && <span className="poster-art__domain">{domain}</span>}
        </span>
      </div>
    </div>
  )
}

export default PosterArtwork
