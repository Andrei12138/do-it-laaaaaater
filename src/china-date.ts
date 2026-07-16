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

export function addChinaDays(days: number, value = chinaToday()) {
  const date = new Date(value + 'T12:00:00+08:00')
  date.setUTCDate(date.getUTCDate() + days)
  return chinaDateKey(date)
}

export function plannedDateLabel(value: string | null, today = chinaToday()) {
  if (!value) return ''
  if (value < today) return '逾期 · ' + formatShortDate(value)
  if (value === today) return '今天'
  if (value === addChinaDays(1, today)) return '明天'
  return formatShortDate(value)
}

export function formatShortDate(value: string) {
  const date = new Date(value + 'T00:00:00+08:00')
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    month: 'numeric',
    day: 'numeric'
  }).format(date)
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
