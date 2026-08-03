export interface CalendarDay {
  date: string
  day: number
  inCurrentMonth: boolean
  isPast: boolean
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function parseMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new Error('日历月份无效')
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) throw new Error('日历月份无效')
  return { year, monthIndex }
}

function dateKey(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function monthFromDate(value: string) {
  return value.slice(0, 7)
}

export function shiftCalendarMonth(month: string, offset: number) {
  const { year, monthIndex } = parseMonth(month)
  const date = new Date(Date.UTC(year, monthIndex + offset, 1))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
}

export function calendarMonthLabel(month: string) {
  const { year, monthIndex } = parseMonth(month)
  return `${year}年${monthIndex + 1}月`
}

export function initialCalendarMonth(value: string | null, today: string) {
  return value && value >= today ? monthFromDate(value) : monthFromDate(today)
}

export function calendarDays(month: string, today: string): CalendarDay[] {
  const { year, monthIndex } = parseMonth(month)
  const first = new Date(Date.UTC(year, monthIndex, 1))
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, monthIndex, 1 - mondayOffset))

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const value = dateKey(date)
    return {
      date: value,
      day: date.getUTCDate(),
      inCurrentMonth: date.getUTCMonth() === monthIndex && date.getUTCFullYear() === year,
      isPast: value < today
    }
  })
}

export function calendarDateLabel(value: string) {
  const date = new Date(value + 'T12:00:00+08:00')
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  }).format(date)
}
