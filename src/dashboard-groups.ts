import { addChinaDays, chinaDateKey } from './china-date.js'
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

export function plannedDateGroupLabel(key: string, today: string) {
  const date = absoluteChinaDateLabel(key)
  if (key < today) return `逾期 · ${date}`
  if (key === today) return `今天 · ${date}`
  if (key === addChinaDays(1, today)) return `明天 · ${date}`
  return date
}

export function groupItemsByPlannedDate(items: LibraryItem[], today: string) {
  const result = new Map<string, LibraryItem[]>()
  items.forEach((item) => {
    if (!item.plannedFor) return
    result.set(item.plannedFor, [...(result.get(item.plannedFor) || []), item])
  })
  return Array.from(result.entries())
    .sort(([left], [right]) => {
      const leftOverdue = left < today
      const rightOverdue = right < today
      if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1
      if (leftOverdue) return right.localeCompare(left)
      return left.localeCompare(right)
    })
    .map(([key, groupItems]) => ({
      key,
      label: plannedDateGroupLabel(key, today),
      date: key,
      items: [...groupItems].sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    }))
}

export function smartDashboardGroups(items: LibraryItem[], today: string): DashboardGroup[] {
  const plannedDateGroups = groupItemsByPlannedDate(items, today)
  const plannedItems = plannedDateGroups.flatMap((group) => group.items)
  const starredItems = items
    .filter((item) => item.isStarred)
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
  const laterItems = items
    .filter((item) => !item.plannedFor && !item.isStarred)
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))

  return [
    {
      key: 'planned',
      label: '计划处理',
      date: '',
      items: plannedItems,
      dateGroups: plannedDateGroups
    },
    {
      key: 'starred',
      label: '星标优先',
      date: '',
      items: starredItems
    },
    {
      key: 'later',
      label: '其余内容',
      date: '',
      items: laterItems,
      dateGroups: groupItemsByCreatedDate(laterItems)
    }
  ].filter((group) => group.items.length)
}
