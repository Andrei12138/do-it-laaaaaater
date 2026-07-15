const CHINA_TIME_ZONE = 'Asia/Shanghai'

export function chinaDateKey(value: number | Date = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(typeof value === 'number' ? new Date(value) : value)
}

export function chinaToday() {
  return chinaDateKey(Date.now())
}

export function plannedState(plannedFor: string | null, today = chinaToday()) {
  if (!plannedFor) return 'none' as const
  if (plannedFor < today) return 'overdue' as const
  if (plannedFor === today) return 'today' as const
  return 'future' as const
}

export function smartPriority(item: { plannedFor: string | null; isStarred: boolean }, today = chinaToday()) {
  const state = plannedState(item.plannedFor, today)
  if (state === 'overdue') return 0
  if (state === 'today') return 1
  if (item.isStarred) return 2
  return 3
}
