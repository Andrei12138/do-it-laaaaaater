import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { createPortal } from 'react-dom'
import { errorMessage } from '../api'
import type { Category } from '../types'
import { AppIcon } from './AppIcon'

const VIEWPORT_MARGIN = 12
const ANCHOR_GAP = 6
const NEW_CATEGORY_COLORS = [
  '#4d49fc',
  '#00b6ff',
  '#24cb71',
  '#ff7237',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#14b8a6',
  '#64748b'
]

export interface CategoryPickerPopoverProps {
  open: boolean
  anchor: HTMLElement | null
  categories: Category[]
  selectedId: string | null
  busy?: boolean
  onSelect: (categoryId: string | null) => void | Promise<unknown>
  onCreateCategory?: (name: string, color: string) => Promise<Category>
  onClose: () => void
}

interface PopoverOption {
  id: string | null
  name: string
  color: string
  isCreate?: boolean
}

export function CategoryPickerPopover({
  open,
  anchor,
  categories,
  selectedId,
  busy = false,
  onSelect,
  onCreateCategory,
  onClose
}: CategoryPickerPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const trimmed = query.trim()
  const nextColor = NEW_CATEGORY_COLORS[categories.length % NEW_CATEGORY_COLORS.length]

  const options = useMemo<PopoverOption[]>(() => {
    const q = trimmed.toLocaleLowerCase('zh-CN')
    const list: PopoverOption[] = []
    if (!q || '未分类'.includes(q)) {
      list.push({ id: null, name: '未分类', color: '#a3a3a3' })
    }
    for (const category of categories) {
      if (!q || category.name.toLocaleLowerCase('zh-CN').includes(q)) {
        list.push({ id: category.id, name: category.name, color: category.color })
      }
    }
    const exactMatch = !trimmed ||
      trimmed === '未分类' ||
      categories.some((category) => category.name.trim().toLocaleLowerCase('zh-CN') === q)
    if (onCreateCategory && trimmed && !exactMatch) {
      list.push({
        id: '__create__',
        name: trimmed.slice(0, 40),
        color: nextColor,
        isCreate: true
      })
    }
    return list
  }, [categories, nextColor, onCreateCategory, trimmed])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setError('')
    setCreating(false)
    setActiveIndex(0)
    setPosition(null)
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    setActiveIndex((current) => {
      if (!options.length) return 0
      return Math.min(current, options.length - 1)
    })
  }, [options.length])

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const updatePosition = () => {
      const panelBox = panel.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = window.visualViewport?.height || window.innerHeight
      const anchorBox = anchor?.isConnected ? anchor.getBoundingClientRect() : null
      let left = anchorBox ? anchorBox.left : (viewportWidth - panelBox.width) / 2
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
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchor, open, options.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (anchor?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        anchor?.focus?.()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchor, onClose, open])

  async function pick(option: PopoverOption) {
    if (busy || creating) return
    if (option.isCreate) {
      if (!onCreateCategory) return
      setCreating(true)
      setError('')
      try {
        const created = await onCreateCategory(option.name, option.color)
        await onSelect(created.id)
        onClose()
      } catch (requestError) {
        setError(errorMessage(requestError))
      } finally {
        setCreating(false)
      }
      return
    }
    onClose()
    await onSelect(option.id)
  }

  if (!open) return null

  const style: CSSProperties = position
    ? { position: 'fixed', top: `${position.top}px`, left: `${position.left}px`, visibility: 'visible' }
    : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }

  return createPortal(
    <div
      ref={panelRef}
      className="fig-popover cat-popover"
      role="dialog"
      aria-label="选择类别"
      style={style}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="cat-popover-search">
        <AppIcon name="search" size={14} className="cat-popover-search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="cat-popover-input"
          placeholder="搜索或新建类别…"
          aria-label="搜索或新建类别"
          maxLength={40}
          value={query}
          disabled={busy || creating}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
            setError('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((current) => (options.length ? (current + 1) % options.length : 0))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((current) => (options.length ? (current - 1 + options.length) % options.length : 0))
            } else if (event.key === 'Enter' && options[activeIndex]) {
              event.preventDefault()
              void pick(options[activeIndex])
            }
          }}
        />
      </div>

      {error && <div className="cat-popover-error" role="alert">{error}</div>}

      <div className="cat-popover-list" role="listbox" aria-label="类别列表">
        {options.length === 0 ? (
          <div className="cat-popover-empty">没有匹配的类别</div>
        ) : (
          options.map((option, index) => {
            const isSelected = !option.isCreate && option.id === selectedId
            const isActive = index === activeIndex
            if (option.isCreate) {
              return (
                <button
                  key="__create__"
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={busy || creating}
                  className={`cat-popover-item cat-popover-create${isActive ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void pick(option)}
                >
                  <span className="cat-dot" style={{ backgroundColor: option.color }} aria-hidden="true" />
                  <span className="cat-popover-name">
                    {creating ? '正在创建…' : `+ 新建类别 “${option.name}”`}
                  </span>
                </button>
              )
            }
            return (
              <button
                key={option.id ?? '__uncategorized__'}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={busy || creating}
                className={`cat-popover-item${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void pick(option)}
              >
                <span className="cat-dot" style={{ backgroundColor: option.color }} aria-hidden="true" />
                <span className="cat-popover-name">{option.name}</span>
                {isSelected && <AppIcon name="check" size={14} className="cat-popover-check" />}
              </button>
            )
          })
        )}
      </div>
    </div>,
    document.body
  )
}
