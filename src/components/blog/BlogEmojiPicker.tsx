import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { createPortal } from 'react-dom'
import {
  FLUENT_ANIMATED_EMOJIS,
  NOTO_ANIMATED_EMOJIS,
  STANDARD_EMOJI_GROUPS,
  pushRecentEmoji,
  readRecentEmojis,
  resolveAnimatedEmoji,
  type AnimatedEmojiItem
} from '../../blog-emojis'
import { AppIcon } from '../AppIcon'

export type EmojiPickerTab = 'noto' | 'fluent' | 'unicode'

export interface InlineAnimatedEmojiProps {
  code: string
  size?: number
  className?: string
}

export function InlineAnimatedEmoji({ code, size, className }: InlineAnimatedEmojiProps) {
  const item = resolveAnimatedEmoji(code)
  const [failedCode, setFailedCode] = useState<string | null>(null)

  if (!item) {
    return <span className={className}>{code}</span>
  }

  if (failedCode === item.code) {
    return (
      <span
        className={className}
        role="img"
        aria-label={item.label}
        title={item.label}
        style={size ? { fontSize: `${size}px`, lineHeight: 1, display: 'inline-block' } : undefined}
      >
        {item.fallback}
      </span>
    )
  }

  return (
    <img
      className={className ? `blog-anim-emoji ${className}` : 'blog-anim-emoji'}
      src={item.url}
      alt={item.fallback}
      title={item.label}
      loading="lazy"
      decoding="async"
      style={size ? { width: size, height: size } : undefined}
      onError={() => setFailedCode(item.code)}
    />
  )
}

interface PreviewInfo {
  value: string
  label: string
  sublabel: string
  animated: AnimatedEmojiItem | null
}

export interface BlogEmojiPickerProps {
  onSelect: (value: string) => void
  onClose?: () => void
  initialTab?: EmojiPickerTab
  className?: string
  style?: CSSProperties
}

export function BlogEmojiPicker({
  onSelect,
  onClose,
  initialTab = 'noto',
  className,
  style
}: BlogEmojiPickerProps) {
  const [activeTab, setActiveTab] = useState<EmojiPickerTab>(initialTab)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>(() => readRecentEmojis())
  const [preview, setPreview] = useState<PreviewInfo | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string>(STANDARD_EMOJI_GROUPS[0]?.id ?? 'smileys')

  const gridWrapRef = useRef<HTMLDivElement | null>(null)
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const normalizedQuery = query.trim().toLowerCase()

  const filteredNoto = useMemo(() => {
    if (!normalizedQuery) return NOTO_ANIMATED_EMOJIS
    return NOTO_ANIMATED_EMOJIS.filter(
      (item) =>
        item.keywords.toLowerCase().includes(normalizedQuery) ||
        item.code.toLowerCase().includes(normalizedQuery) ||
        item.fallback.includes(normalizedQuery)
    )
  }, [normalizedQuery])

  const filteredFluent = useMemo(() => {
    if (!normalizedQuery) return FLUENT_ANIMATED_EMOJIS
    return FLUENT_ANIMATED_EMOJIS.filter(
      (item) =>
        item.keywords.toLowerCase().includes(normalizedQuery) ||
        item.code.toLowerCase().includes(normalizedQuery) ||
        item.fallback.includes(normalizedQuery)
    )
  }, [normalizedQuery])

  const filteredUnicodeGroups = useMemo(() => {
    if (!normalizedQuery) return STANDARD_EMOJI_GROUPS
    return STANDARD_EMOJI_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (entry) =>
          entry.keywords.toLowerCase().includes(normalizedQuery) ||
          entry.emoji.includes(normalizedQuery)
      )
    })).filter((group) => group.items.length > 0)
  }, [normalizedQuery])

  const handlePick = useCallback(
    (value: string) => {
      const updated = pushRecentEmoji(value)
      setRecent(updated)
      onSelect(value)
    },
    [onSelect]
  )

  const describeValue = useCallback((value: string, explicitLabel?: string): PreviewInfo => {
    const anim = resolveAnimatedEmoji(value)
    if (anim) {
      return {
        value: anim.code,
        label: anim.label,
        sublabel: anim.code,
        animated: anim
      }
    }
    return {
      value,
      label: explicitLabel || '标准 Emoji',
      sublabel: value,
      animated: null
    }
  }, [])

  const scrollToGroup = (groupId: string) => {
    setActiveGroupId(groupId)
    const target = groupRefs.current[groupId]
    if (target && gridWrapRef.current) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const defaultPreview = useMemo<PreviewInfo>(() => {
    if (activeTab === 'noto') {
      const first = NOTO_ANIMATED_EMOJIS[28] || NOTO_ANIMATED_EMOJIS[0]
      return describeValue(first.code)
    }
    if (activeTab === 'fluent') {
      const first = FLUENT_ANIMATED_EMOJIS[27] || FLUENT_ANIMATED_EMOJIS[0]
      return describeValue(first.code)
    }
    return {
      value: '✨',
      label: '悬停预览 · 点击即插',
      sublabel: '中英文搜索',
      animated: null
    }
  }, [activeTab, describeValue])

  const activePreview = preview ?? defaultPreview

  const renderAnimatedGrid = (items: readonly AnimatedEmojiItem[], emptyHint: string) => {
    if (items.length === 0) {
      return (
        <div
          style={{
            padding: '24px 12px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--blog-text-muted)'
          }}
        >
          {emptyHint}
        </div>
      )
    }
    return (
      <div className="blog-emoji-grid" role="listbox" aria-label="动态表情列表">
        {items.map((item) => (
          <button
            key={item.code}
            type="button"
            className="blog-emoji-cell is-animated"
            title={`${item.label} ${item.code}`}
            aria-label={item.label}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setPreview(describeValue(item.code))}
            onFocus={() => setPreview(describeValue(item.code))}
            onClick={() => handlePick(item.code)}
          >
            <InlineAnimatedEmoji code={item.code} size={26} />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      className={className ? `blog-emoji-popover ${className}` : 'blog-emoji-popover'}
      style={style}
      role="dialog"
      aria-label="表情选择器"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {/* Top 3-in-1 Pack Tabs (3-column segmented grid) */}
      <div className="blog-emoji-tabs" role="tablist" aria-label="表情包切换">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'noto'}
          className={activeTab === 'noto' ? 'blog-emoji-tab is-active' : 'blog-emoji-tab'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setActiveTab('noto')
            setPreview(null)
          }}
        >
          Noto 动效
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'fluent'}
          className={activeTab === 'fluent' ? 'blog-emoji-tab is-active' : 'blog-emoji-tab'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setActiveTab('fluent')
            setPreview(null)
          }}
        >
          Fluent 3D
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'unicode'}
          className={activeTab === 'unicode' ? 'blog-emoji-tab is-active' : 'blog-emoji-tab'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setActiveTab('unicode')
            setPreview(null)
          }}
        >
          标准 Emoji
        </button>
      </div>

      {/* Bilingual Search Input */}
      <div className="blog-emoji-search">
        <AppIcon name="search" size={14} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索表情（如：火、开心、fire、cat）…"
          aria-label="搜索表情"
          autoComplete="off"
        />
        {query ? (
          <button
            type="button"
            aria-label="清空搜索"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setQuery('')}
            style={{
              border: 0,
              background: 'transparent',
              color: 'var(--blog-text-muted)',
              padding: 4,
              display: 'inline-flex',
              alignItems: 'center',
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            <AppIcon name="close" size={13} />
          </button>
        ) : onClose ? (
          <button
            type="button"
            aria-label="关闭表情面板"
            title="关闭 (Esc)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClose}
            style={{
              border: 0,
              background: 'transparent',
              color: 'var(--blog-text-muted)',
              padding: 4,
              display: 'inline-flex',
              alignItems: 'center',
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            <AppIcon name="close" size={13} />
          </button>
        ) : null}
      </div>

      {/* Recent Emojis Strip */}
      {!normalizedQuery && recent.length > 0 && (
        <div className="blog-emoji-recent" aria-label="最近使用">
          <div className="blog-emoji-recent-label">最近使用</div>
          <div className="blog-emoji-recent-row">
            {recent.slice(0, 8).map((token) => {
              const anim = resolveAnimatedEmoji(token)
              return (
                <button
                  key={token}
                  type="button"
                  className={anim ? 'blog-emoji-cell is-animated' : 'blog-emoji-cell'}
                  title={anim ? `${anim.label} ${anim.code}` : token}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setPreview(describeValue(token))}
                  onFocus={() => setPreview(describeValue(token))}
                  onClick={() => handlePick(token)}
                >
                  {anim ? <InlineAnimatedEmoji code={anim.code} size={22} /> : token}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Category Quick-Jump Strip for Standard Unicode Emoji */}
      {activeTab === 'unicode' && !normalizedQuery && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            padding: '4px 10px',
            borderBottom: '1px solid var(--blog-divider)',
            overflowX: 'auto',
            scrollbarWidth: 'none'
          }}
          aria-label="表情分类导航"
        >
          {STANDARD_EMOJI_GROUPS.map((group) => {
            const isCurrent = activeGroupId === group.id
            return (
              <button
                key={group.id}
                type="button"
                title={group.label}
                aria-label={group.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => scrollToGroup(group.id)}
                style={{
                  border: 0,
                  background: isCurrent ? 'var(--blog-link-soft)' : 'transparent',
                  borderRadius: 6,
                  padding: '3px 7px',
                  fontSize: 14,
                  lineHeight: 1.2,
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                {group.icon}
              </button>
            )
          })}
        </div>
      )}

      {/* Scrollable Emoji Body */}
      <div
        ref={gridWrapRef}
        className="blog-emoji-body"
        style={{ overscrollBehavior: 'contain' }}
      >
        {activeTab === 'noto' &&
          renderAnimatedGrid(filteredNoto, '未找到匹配的 Noto 动效表情')}

        {activeTab === 'fluent' &&
          renderAnimatedGrid(filteredFluent, '未找到匹配的 Fluent 3D 表情')}

        {activeTab === 'unicode' &&
          (filteredUnicodeGroups.length === 0 ? (
            <div
              style={{
                padding: '24px 12px',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--blog-text-muted)'
              }}
            >
              未找到匹配的标准 Emoji
            </div>
          ) : (
            filteredUnicodeGroups.map((group) => (
              <div
                key={group.id}
                ref={(el) => {
                  groupRefs.current[group.id] = el
                }}
              >
                <div className="blog-emoji-group-title">{group.label}</div>
                <div className="blog-emoji-grid" role="listbox" aria-label={group.label}>
                  {group.items.map((entry) => (
                    <button
                      key={`${group.id}-${entry.emoji}`}
                      type="button"
                      className="blog-emoji-cell"
                      title={entry.label}
                      aria-label={entry.label}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setPreview(describeValue(entry.emoji, entry.label))}
                      onFocus={() => setPreview(describeValue(entry.emoji, entry.label))}
                      onClick={() => handlePick(entry.emoji)}
                    >
                      {entry.emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))
          ))}
      </div>

      {/* Live Preview Footer */}
      <div className="blog-emoji-preview" aria-live="polite">
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            overflow: 'hidden'
          }}
        >
          {activePreview.animated ? (
            <InlineAnimatedEmoji code={activePreview.animated.code} size={22} />
          ) : (
            <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
              {activePreview.value}
            </span>
          )}
          <span
            style={{
              fontWeight: 500,
              color: 'var(--blog-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {activePreview.label}
          </span>
        </div>
        <code>{activePreview.sublabel}</code>
      </div>
    </div>
  )
}

export interface BlogEmojiTriggerProps {
  onSelect: (value: string) => void // inserts unicode emoji OR ':noto-fire:' / ':fluent-fire:' shortcode
  align?: 'left' | 'right'
  label?: string
  compact?: boolean
  className?: string
  disabled?: boolean
}

function detectActiveBlogTheme(anchor: HTMLElement | null): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const closestThemed = anchor?.closest<HTMLElement>('[data-blog-theme]')
  if (closestThemed) {
    return closestThemed.getAttribute('data-blog-theme') === 'dark' ? 'dark' : 'light'
  }
  const rootTheme = document.querySelector<HTMLElement>('.blog-root')?.getAttribute('data-blog-theme')
  return rootTheme === 'dark' ? 'dark' : 'light'
}

function EmojiFaceIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="app-icon"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2" />
      <circle cx="9" cy="9.75" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9.75" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function BlogEmojiTrigger({
  onSelect,
  align = 'left',
  label,
  compact = false,
  className,
  disabled = false
}: BlogEmojiTriggerProps) {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverWrapRef = useRef<HTMLDivElement | null>(null)

  const updatePosition = useCallback(() => {
    if (typeof window === 'undefined' || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 10

    const measuredWidth = popoverWrapRef.current?.offsetWidth || 352
    const measuredHeight = popoverWrapRef.current?.offsetHeight || 400
    const popWidth = Math.min(measuredWidth, vw - margin * 2)

    let left = align === 'right' ? rect.right - popWidth : rect.left
    left = Math.max(margin, Math.min(left, vw - popWidth - margin))

    const spaceBelow = vh - rect.bottom - margin
    const spaceAbove = rect.top - margin
    let top: number
    if (spaceBelow >= measuredHeight || spaceBelow >= spaceAbove) {
      top = Math.min(rect.bottom + 6, Math.max(margin, vh - measuredHeight - margin))
    } else {
      top = Math.max(margin, rect.top - measuredHeight - 6)
    }

    setCoords({ top: Math.round(top), left: Math.round(left) })
  }, [align])

  useLayoutEffect(() => {
    if (!open) return
    setTheme(detectActiveBlogTheme(triggerRef.current))
    updatePosition()
    const raf = window.requestAnimationFrame(updatePosition)
    return () => window.cancelAnimationFrame(raf)
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (popoverWrapRef.current?.contains(target)) return
      setOpen(false)
    }

    // Capture-phase Escape handler so closing the emoji popover inside a modal
    // does not simultaneously trigger the parent modal's Escape close handler.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    const handleViewportChange = () => {
      updatePosition()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown, { passive: true })
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open, updatePosition])

  const handleSelectFromTrigger = useCallback(
    (value: string) => {
      onSelect(value)
      setOpen(false)
    },
    [onSelect]
  )

  const buttonClasses = [
    'blog-emoji-trigger',
    'blog-md-tool-btn',
    compact ? 'is-compact' : '',
    open ? 'is-active' : '',
    className || ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className="blog-emoji-trigger-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={buttonClasses}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label || '插入表情'}
        title={label || '插入表情（支持 Noto / Fluent 3D 动效表情）'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((prev) => !prev)}
      >
        <EmojiFaceIcon size={compact ? 15 : 16} />
        {!compact && label ? <span>{label}</span> : null}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="blog-root"
            data-blog-theme={theme}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: 0,
              height: 0,
              minHeight: 0,
              overflow: 'visible',
              background: 'transparent',
              pointerEvents: 'none',
              zIndex: 1350
            }}
          >
            <div
              ref={popoverWrapRef}
              style={{
                position: 'fixed',
                top: coords.top,
                left: coords.left,
                maxWidth: 'calc(100vw - 20px)',
                pointerEvents: 'auto',
                zIndex: 1350
              }}
            >
              <BlogEmojiPicker
                onSelect={handleSelectFromTrigger}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body
        )}
    </span>
  )
}
