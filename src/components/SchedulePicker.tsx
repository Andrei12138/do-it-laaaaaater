import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { createPortal } from 'react-dom'
import {
  calendarDateLabel,
  calendarDays,
  calendarMonthLabel,
  initialCalendarMonth,
  monthFromDate,
  shiftCalendarMonth
} from '../calendar'
import { addChinaDays, chinaToday } from '../china-date'
import { AppIcon } from './AppIcon'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const VIEWPORT_MARGIN = 12
const ANCHOR_GAP = 8

interface PickerPosition {
  top: number
  left: number
}

export interface SchedulePickerProps {
  open: boolean
  anchor: HTMLElement | null
  value: string | null
  title?: string
  busy?: boolean
  clearDisabled?: boolean
  onSelect: (date: string) => boolean | Promise<boolean>
  onClear: () => boolean | Promise<boolean>
  onClose: () => void
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hasAttribute('hidden'))
}

function ChevronLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="app-icon"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

export function SchedulePicker({
  open,
  anchor,
  value,
  title = '安排处理日期',
  busy = false,
  clearDisabled = !value,
  onSelect,
  onClear,
  onClose
}: SchedulePickerProps) {
  const today = chinaToday()
  const tomorrow = addChinaDays(1, today)
  const nextWeek = addChinaDays(7, today)
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const [month, setMonth] = useState(() => initialCalendarMonth(value, today))
  const [position, setPosition] = useState<PickerPosition | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const days = useMemo(() => calendarDays(month, today), [month, today])
  const disabled = busy || submitting
  const previousDisabled = shiftCalendarMonth(month, -1) < monthFromDate(today)

  useEffect(() => {
    if (!open) return
    setMonth(initialCalendarMonth(value, today))
    setPosition(null)
  }, [open, today, value])

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const updatePosition = () => {
      const panelBox = panel.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = window.visualViewport?.height || window.innerHeight
      const anchorBox = anchor?.isConnected ? anchor.getBoundingClientRect() : null
      const centeredLeft = (viewportWidth - panelBox.width) / 2
      let left = anchorBox ? anchorBox.left : centeredLeft
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - panelBox.width - VIEWPORT_MARGIN))

      let top = anchorBox ? anchorBox.bottom + ANCHOR_GAP : (viewportHeight - panelBox.height) / 2
      if (anchorBox && top + panelBox.height > viewportHeight - VIEWPORT_MARGIN) {
        const above = anchorBox.top - panelBox.height - ANCHOR_GAP
        top = above >= VIEWPORT_MARGIN ? above : viewportHeight - panelBox.height - VIEWPORT_MARGIN
      }
      top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - panelBox.height - VIEWPORT_MARGIN))
      setPosition({ top, left })
    }

    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.visualViewport?.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('scroll', updatePosition)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.visualViewport?.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('scroll', updatePosition)
    }
  }, [anchor, month, open])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const frame = window.requestAnimationFrame(() => {
      const preferred = panel.querySelector<HTMLElement>('[aria-selected="true"]')
        || panel.querySelector<HTMLElement>('[aria-current="date"]')
        || focusableElements(panel)[0]
      preferred?.focus()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements(panel)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      if (anchor?.isConnected) anchor.focus()
    }
  }, [anchor, onClose, open])

  if (!open) return null

  async function commitDate(date: string) {
    if (disabled || date < today) return
    setSubmitting(true)
    try {
      if (await onSelect(date)) onClose()
    } finally {
      setSubmitting(false)
    }
  }

  async function clearPlan() {
    if (disabled || clearDisabled) return
    setSubmitting(true)
    try {
      if (await onClear()) onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const panelStyle = position
    ? ({ top: position.top, left: position.left } satisfies CSSProperties)
    : undefined

  return createPortal(
    <div className="schedule-picker-layer">
      <button type="button" className="schedule-picker-backdrop" aria-label="关闭日期选择" onClick={onClose} />
      <section
        ref={panelRef}
        className={`fig-popover schedule-picker-panel${position ? ' is-positioned' : ''}`}
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={disabled}
      >
        <header className="schedule-picker-heading">
          <div>
            <span className="schedule-picker-kicker">SCHEDULE</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="btn btn-icon btn-sm" aria-label="关闭日历" onClick={onClose}>
            <AppIcon name="close" size={16} />
          </button>
        </header>

        <div className="schedule-picker-quick" role="group" aria-label="快捷安排">
          <button
            type="button"
            className={`pill${value === today ? ' is-active' : ''}`}
            disabled={disabled}
            onClick={() => void commitDate(today)}
          >
            今天
          </button>
          <button
            type="button"
            className={`pill${value === tomorrow ? ' is-active' : ''}`}
            disabled={disabled}
            onClick={() => void commitDate(tomorrow)}
          >
            明天
          </button>
          <button
            type="button"
            className={`pill${value === nextWeek ? ' is-active' : ''}`}
            disabled={disabled}
            onClick={() => void commitDate(nextWeek)}
          >
            下周
          </button>
          <button
            type="button"
            className="pill schedule-picker-clear-pill"
            disabled={disabled || clearDisabled}
            onClick={() => void clearPlan()}
          >
            清除计划
          </button>
        </div>

        <div className="schedule-picker-month-nav">
          <button
            type="button"
            className="btn btn-icon btn-sm"
            aria-label="上个月"
            disabled={disabled || previousDisabled}
            onClick={() => setMonth((current) => shiftCalendarMonth(current, -1))}
          >
            <ChevronLeftIcon size={16} />
          </button>
          <strong className="schedule-picker-month-label" aria-live="polite">{calendarMonthLabel(month)}</strong>
          <button
            type="button"
            className="btn btn-icon btn-sm"
            aria-label="下个月"
            disabled={disabled}
            onClick={() => setMonth((current) => shiftCalendarMonth(current, 1))}
          >
            <AppIcon name="chevronRight" size={16} />
          </button>
        </div>

        <div className="schedule-picker-calendar" role="grid" aria-label={calendarMonthLabel(month)}>
          {WEEKDAYS.map((weekday) => (
            <span key={weekday} className="schedule-picker-weekday" role="columnheader">{weekday}</span>
          ))}
          {days.map((day) => {
            const selected = day.date === value
            const current = day.date === today
            return (
              <button
                key={day.date}
                type="button"
                role="gridcell"
                className={[
                  'schedule-picker-day',
                  day.inCurrentMonth ? '' : 'is-outside',
                  selected ? 'is-selected' : '',
                  current ? 'is-today' : ''
                ].filter(Boolean).join(' ')}
                data-date={day.date}
                disabled={disabled || day.isPast}
                aria-label={calendarDateLabel(day.date)}
                aria-selected={selected}
                aria-current={current ? 'date' : undefined}
                onClick={() => void commitDate(day.date)}
              >
                {day.day}
              </button>
            )
          })}
        </div>

        <footer className="schedule-picker-footer">
          <span>{value ? `当前计划：${calendarDateLabel(value)}` : '尚未安排处理日期'}</span>
        </footer>
      </section>
    </div>,
    document.body
  )
}
