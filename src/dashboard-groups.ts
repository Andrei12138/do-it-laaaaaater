import { chinaDateKey, smartPriority } from './china-date.js'
import type { LibraryItem } from './types.js'

export type DashboardDateGroup = {
  key: string
  label: string
  date: string
  items: LibraryItem[]
}

export type DashboardGroup = DashboardDateGroup & {
  dateGroups?: DashboardDateGroup[]
}

export function absoluteChinaDateLabel(key: string) {
  const date = new Date(key + 'T00:00:00+08:00')
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date)
}

export function groupItemsByCreatedDate(items: LibraryItem[]) {
  const result = new Map<string, LibraryItem[]>()
  items.forEach((item) => {
    const key = chinaDateKey(item.createdAt)
    result.set(key, [...(result.get(key) || []), item])
  })
  return Array.from(result.entries()).map(([key, groupItems]) => ({
    key,
    label: absoluteChinaDateLabel(key),
    date: key,
    items: groupItems
  }))
}

export function smartDashboardGroups(items: LibraryItem[], today: string): DashboardGroup[] {
  const definitions = [
    { key: 'overdue', label: '逾期的今天处理', rank: 0 },
    { key: 'today', label: '今天处理', rank: 1 },
    { key: 'starred', label: '星标优先', rank: 2 },
    { key: 'later', label: '其余内容', rank: 3 }
  ]
  return definitions.map((definition) => {
    const groupItems = items.filter((item) => smartPriority(item, today) === definition.rank)
    return {
      key: definition.key,
      label: definition.label,
      date: '',
      items: groupItems,
      ...(definition.key === 'later'
        ? { dateGroups: groupItemsByCreatedDate(groupItems) }
        : {})
    }
  }).filter((group) => group.items.length)
}
