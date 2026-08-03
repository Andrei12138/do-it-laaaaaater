import { chinaToday, smartPriority } from './china-date.js'
import type { ItemFilters, LibraryItem } from './types.js'

function chinaDayKey(timestamp: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp))
}

export function filterLibraryItems(items: LibraryItem[], filters: ItemFilters) {
  const query = filters.q.trim().toLocaleLowerCase('zh-CN')
  const today = chinaToday()
  const result = items.filter((item) => {
    if (filters.trash === 'active' && item.trashedAt) return false
    if (filters.trash === 'only' && !item.trashedAt) return false
    if (filters.status !== 'all' && item.status !== filters.status) return false
    if (filters.kind !== 'all' && item.kind !== filters.kind) return false
    if (filters.category === 'uncategorized' && item.category) return false
    if (filters.category && filters.category !== 'uncategorized' && item.category?.id !== filters.category) return false
    if (filters.date && chinaDayKey(item.createdAt) !== filters.date) return false
    if (filters.priority === 'planned' && !item.plannedFor) return false
    if (filters.priority === 'starred' && !item.isStarred) return false
    if (query) {
      const haystack = [
        item.title,
        item.url || '',
        item.category?.name || '',
        ...item.assets.map((asset) => asset.originalName)
      ].join('\n').toLocaleLowerCase('zh-CN')
      if (!haystack.includes(query)) return false
    }
    return true
  })

  return [...result].sort((left, right) => {
    if (filters.sort === 'oldest') return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    if (filters.sort === 'recently_completed') {
      return (right.completedAt || 0) - (left.completedAt || 0) || right.createdAt - left.createdAt
    }
    if (filters.sort === 'planned_date') {
      const leftPlan = left.plannedFor || '9999-12-31'
      const rightPlan = right.plannedFor || '9999-12-31'
      return leftPlan.localeCompare(rightPlan) || right.createdAt - left.createdAt
    }
    if (filters.sort === 'smart') {
      return smartPriority(left, today) - smartPriority(right, today) || right.createdAt - left.createdAt
    }
    return right.createdAt - left.createdAt || right.id.localeCompare(left.id)
  })
}
