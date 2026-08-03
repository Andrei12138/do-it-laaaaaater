import { describe, expect, it } from 'vitest'
import {
  calendarDateLabel,
  calendarDays,
  calendarMonthLabel,
  initialCalendarMonth,
  shiftCalendarMonth
} from '../src/calendar.js'

describe('calendar scheduling helpers', () => {
  it('builds a stable Monday-first six-week grid', () => {
    const days = calendarDays('2026-08', '2026-08-03')
    expect(days).toHaveLength(42)
    expect(days[0]).toMatchObject({ date: '2026-07-27', day: 27, inCurrentMonth: false, isPast: true })
    expect(days[5]).toMatchObject({ date: '2026-08-01', day: 1, inCurrentMonth: true, isPast: true })
    expect(days[7]).toMatchObject({ date: '2026-08-03', day: 3, inCurrentMonth: true, isPast: false })
    expect(days[41].date).toBe('2026-09-06')
  })

  it('includes leap day and keeps it selectable', () => {
    const days = calendarDays('2028-02', '2028-02-01')
    expect(days.find((day) => day.date === '2028-02-29')).toMatchObject({
      day: 29,
      inCurrentMonth: true,
      isPast: false
    })
  })

  it('moves across month and year boundaries', () => {
    expect(shiftCalendarMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftCalendarMonth('2027-01', -1)).toBe('2026-12')
    expect(shiftCalendarMonth('2026-01', 14)).toBe('2027-03')
  })

  it('opens on a future plan but falls back to the current month for overdue plans', () => {
    expect(initialCalendarMonth('2026-11-18', '2026-08-03')).toBe('2026-11')
    expect(initialCalendarMonth('2026-07-18', '2026-08-03')).toBe('2026-08')
    expect(initialCalendarMonth(null, '2026-08-03')).toBe('2026-08')
  })

  it('formats Chinese month and accessible date labels', () => {
    expect(calendarMonthLabel('2026-08')).toBe('2026年8月')
    expect(calendarDateLabel('2026-08-03')).toContain('2026年8月3日')
    expect(calendarDateLabel('2026-08-03')).toContain('星期一')
  })
})
