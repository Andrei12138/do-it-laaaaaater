import type { LibraryItem } from './types.js'

const DAY_MS = 24 * 60 * 60 * 1000

export function formatElapsedDays(timestamp: number, now = Date.now()) {
  const elapsedDays = Math.max(0, now - timestamp) / DAY_MS
  const rounded = Math.round(elapsedDays * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function itemAgeLabel(
  item: Pick<LibraryItem, 'status' | 'createdAt' | 'updatedAt' | 'completedAt'>,
  now = Date.now()
) {
  if (item.status === 'completed') {
    const completedAt = item.completedAt ?? item.updatedAt ?? item.createdAt
    return formatElapsedDays(completedAt, now) + '天前看了'
  }
  return formatElapsedDays(item.createdAt, now) + '天未看'
}
