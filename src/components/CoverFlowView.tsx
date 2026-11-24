import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from 'react'
import { chinaToday, plannedDateLabel, plannedState } from '../china-date'
import { itemAgeLabel } from '../item-age'
import type { BulkItemChanges, Category, ImageAsset, LibraryItem } from '../types'
import { AppIcon } from './AppIcon'

const AUTO_ADVANCE_MS = 4500
const SWIPE_THRESHOLD = 44

const FIGMA_POSTER_PASTELS = [
  '#f3ffe3',
  '#e4ff97',
  '#c4baff',
  '#ffc9c1',
  '#c7f8fb'
] as const

export interface CoverFlowViewProps {
  items: LibraryItem[]
  categories: Category[]
  generatingIds: Set<string>
  aiCoverConfigured: boolean
  onPatch: (item: LibraryItem, changes: BulkItemChanges, label: string) => Promise<boolean>
  onEdit: (item: LibraryItem) => void
  onDelete: (item: LibraryItem) => Promise<boolean>
  onGenerateCover: (item: LibraryItem) => Promise<void>
  onPreview: (assets: ImageAsset[], index: number) => void
  onOpenAiSettings: () => void
  now: number
}

function manualAssets(item: LibraryItem) {
  return item.assets.filter((asset) => asset.role !== 'web_cover')
}

function itemCover(item: LibraryItem): ImageAsset | null {
  const webCover = item.assets.find((asset) => asset.role === 'web_cover')
  if (webCover) return webCover
  return manualAssets(item)[0] || null
}

function itemDomain(url: string | null) {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

function kindLabel(item: LibraryItem) {
  if (item.kind === 'link') return 'WEB'
  if (item.kind === 'text') return 'NOTE'
  return 'PHOTO'
}

function kindText(item: LibraryItem) {
  if (item.kind === 'link') return '网页'
  if (item.kind === 'text') return '文本'
  return '图片'
}

function hashId(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function posterBg(item: LibraryItem) {
  return FIGMA_POSTER_PASTELS[hashId(item.id) % FIGMA_POSTER_PASTELS.length]
}

function visibleOffsets(count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [0]
  if (count === 2) return [0, 1]
  if (count === 3) return [-1, 0, 1]
  if (count === 4) return [-1, 0, 1, 2]
  return [-2, -1, 0, 1, 2]
}

export function CoverFlowView({
  items,
  categories,
  generatingIds,
  aiCoverConfigured,
  onPatch,
  onEdit,
  onDelete,
  onGenerateCover,
  onPreview,
  onOpenAiSettings,
  now
}: CoverFlowViewProps) {
  const [activeId, setActiveId] = useState(() => items[0]?.id || '')
  const [autoPlay, setAutoPlay] = useState(false)
  const [busy, setBusy] = useState(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const categoryMap = useMemo(() => new Map(categories.map((cat) => [cat.id, cat])), [categories])

  const activeIndex = useMemo(() => {
    if (!items.length) return 0
    const found = items.findIndex((entry) => entry.id === activeId)
    return found >= 0 ? found : 0
  }, [activeId, items])

  const activeItem = items[activeIndex] || null

  useEffect(() => {
    if (!items.length) {
      setActiveId('')
      return
    }
    if (!items.some((entry) => entry.id === activeId)) {
      setActiveId(items[Math.min(activeIndex, items.length - 1)].id)
    }
  }, [activeId, activeIndex, items])

  const step = useCallback((direction: -1 | 1) => {
    if (items.length <= 1) return
    const nextIndex = (activeIndex + direction + items.length) % items.length
    setActiveId(items[nextIndex].id)
  }, [activeIndex, items])

  useEffect(() => {
    if (!autoPlay || items.length <= 1) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('[role="dialog"]')) {
        step(1)
      }
    }, AUTO_ADVANCE_MS)
    return () => window.clearInterval(timer)
  }, [autoPlay, items.length, step])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      if (document.querySelector('[role="dialog"]')) return
      if (items.length <= 1) return
      event.preventDefault()
      setAutoPlay(false)
      step(event.key === 'ArrowLeft' ? -1 : 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [items.length, step])

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start || event.changedTouches.length !== 1 || items.length <= 1) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.2) return
    setAutoPlay(false)
    step(dx < 0 ? 1 : -1)
  }

  async function runPatch(item: LibraryItem, changes: BulkItemChanges, label: string) {
    if (busy) return
    setBusy(true)
    try {
      await onPatch(item, changes, label)
    } finally {
      setBusy(false)
    }
  }

  async function runDelete(item: LibraryItem) {
    if (busy) return
    const nextId = items[(activeIndex + 1) % Math.max(1, items.length)]?.id || ''
    setBusy(true)
    try {
      if (await onDelete(item) && nextId && nextId !== item.id) {
        setActiveId(nextId)
      }
    } finally {
      setBusy(false)
    }
  }

  function openItemPrimary(item: LibraryItem) {
    if (item.kind === 'link' && item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer')
      return
    }
    const manual = manualAssets(item)
    if (item.kind === 'image_group' && manual.length) {
      onPreview(manual, 0)
      return
    }
    const cover = itemCover(item)
    if (cover) {
      onPreview([cover], 0)
      return
    }
    onEdit(item)
  }

  if (!activeItem) {
    return (
      <div className="coverflow-empty">
        <AppIcon name="album" size={24} />
        <p>当前视图下没有可展示的条目</p>
      </div>
    )
  }

  const today = chinaToday()
  const offsets = visibleOffsets(items.length)
  const activeCategory = activeItem.category
    ? categoryMap.get(activeItem.category.id) || activeItem.category
    : null
  const activeManual = manualAssets(activeItem)
  const activeCover = itemCover(activeItem)
  const activeDomain = itemDomain(activeItem.url)
  const activePlanState = plannedState(activeItem.plannedFor, today)
  const isGeneratingActive = generatingIds.has(activeItem.id)
  const primaryIsComplete = activeItem.kind === 'text' || (activeItem.kind === 'link' && !activeItem.url) || (activeItem.kind === 'image_group' && activeManual.length === 0)

  return (
    <section className="coverflow-view" aria-label="专辑封面视图">
      <div
        className="coverflow-stage"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="coverflow-track">
          {offsets.map((offset) => {
            const index = (activeIndex + offset + items.length) % items.length
            const entry = items[index]
            const cover = itemCover(entry)
            const cat = entry.category ? categoryMap.get(entry.category.id) || entry.category : null
            const domain = itemDomain(entry.url)
            const isCenter = offset === 0
            const isGenerating = generatingIds.has(entry.id)
            const offsetClass = offset < 0 ? `is-offset-neg-${Math.abs(offset)}` : `is-offset-${offset}`
            const posterStyle = {
              '--poster-bg': posterBg(entry),
              '--poster-accent': cat?.color || '#4d49fc'
            } as CSSProperties

            return (
              <button
                key={`${entry.id}-${offset}`}
                type="button"
                className={`coverflow-card ${offsetClass}${isCenter ? ' is-center' : ''}${cover ? ' has-image' : ' is-fallback'}`}
                data-offset={offset}
                aria-label={isCenter ? `当前条目：${entry.title}` : `切换到：${entry.title}`}
                aria-current={isCenter ? 'true' : undefined}
                onClick={() => {
                  setAutoPlay(false)
                  if (isCenter) {
                    if (cover) {
                      const previewAssets = entry.kind === 'image_group' && manualAssets(entry).length
                        ? manualAssets(entry)
                        : [cover]
                      onPreview(previewAssets, 0)
                    } else {
                      openItemPrimary(entry)
                    }
                  } else {
                    setActiveId(entry.id)
                  }
                }}
              >
                {cover ? (
                  <img
                    className="coverflow-poster-img"
                    src={cover.thumbUrl}
                    alt=""
                    loading={isCenter ? 'eager' : 'lazy'}
                    draggable={false}
                  />
                ) : (
                  <div className="coverflow-poster-fallback" style={posterStyle}>
                    <div className="coverflow-poster-top">
                      <span className="coverflow-poster-kind">{kindLabel(entry)}</span>
                      <span className="coverflow-poster-index">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="coverflow-poster-body">
                      <span className="coverflow-poster-rule" aria-hidden="true" />
                      <strong className="coverflow-poster-title">{entry.title}</strong>
                    </div>
                    <div className="coverflow-poster-bottom">
                      <span className="coverflow-poster-cat">
                        <span
                          className="cat-dot"
                          style={{ backgroundColor: cat?.color || '#000000' }}
                          aria-hidden="true"
                        />
                        {cat?.name || '未分类'}
                      </span>
                      <span className="coverflow-poster-domain">{domain || kindText(entry)}</span>
                    </div>
                  </div>
                )}

                {isGenerating && (
                  <span className="coverflow-generating-badge" role="status">
                    <AppIcon name="sparkles" size={13} className="is-spinning" />
                    AI 绘制中…
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <article className="coverflow-float-card" aria-live="polite">
          <div className="coverflow-float-meta">
            <span className="coverflow-float-cat">
              <span
                className="cat-dot"
                style={{ backgroundColor: activeCategory?.color || '#a3a3a3' }}
                aria-hidden="true"
              />
              {activeCategory?.name || '未分类'}
            </span>

            <span className="badge badge-muted">{kindText(activeItem)}</span>

            {activeItem.status === 'completed' && (
              <span className="badge badge-muted">已完成</span>
            )}
            {activePlanState === 'overdue' && (
              <span className="badge badge-danger">逾期</span>
            )}
            {activePlanState === 'today' && (
              <span className="badge badge-indigo">今天</span>
            )}
            {activePlanState === 'future' && activeItem.plannedFor && (
              <span className="badge badge-muted">{plannedDateLabel(activeItem.plannedFor, today)}</span>
            )}

            <span className="coverflow-float-age">{itemAgeLabel(activeItem, now)}</span>
          </div>

          <h2 className="coverflow-float-title">
            {activeItem.kind === 'link' && activeItem.url ? (
              <a href={activeItem.url} target="_blank" rel="noopener noreferrer">
                {activeItem.title}
              </a>
            ) : (
              <button
                type="button"
                className="coverflow-float-title-btn"
                onClick={() => openItemPrimary(activeItem)}
              >
                {activeItem.title}
              </button>
            )}
          </h2>

          {activeDomain && <p className="coverflow-float-domain">{activeDomain}</p>}

          <div className="coverflow-float-actions">
            {activeItem.kind === 'link' && activeItem.url ? (
              <a
                className="btn btn-primary"
                href={activeItem.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <AppIcon name="external" size={15} />
                打开网页
              </a>
            ) : activeItem.kind === 'image_group' && activeManual.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onPreview(activeManual, 0)}
              >
                <AppIcon name="image" size={15} />
                查看原图
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void runPatch(
                  activeItem,
                  { status: activeItem.status === 'pending' ? 'completed' : 'pending' },
                  activeItem.status === 'pending' ? '已完成' : '已恢复待处理'
                )}
              >
                <AppIcon name={activeItem.status === 'pending' ? 'check' : 'restore'} size={15} />
                {activeItem.status === 'pending' ? '标记完成' : '恢复待处理'}
              </button>
            )}

            <div className="coverflow-float-tools">
              {!primaryIsComplete && (
                <button
                  type="button"
                  className={`btn btn-subtle btn-icon${activeItem.status === 'completed' ? ' is-active' : ''}`}
                  disabled={busy}
                  aria-label={activeItem.status === 'pending' ? '标记完成' : '恢复待处理'}
                  title={activeItem.status === 'pending' ? '标记完成' : '恢复待处理'}
                  onClick={() => void runPatch(
                    activeItem,
                    { status: activeItem.status === 'pending' ? 'completed' : 'pending' },
                    activeItem.status === 'pending' ? '已完成' : '已恢复待处理'
                  )}
                >
                  <AppIcon name={activeItem.status === 'pending' ? 'check' : 'restore'} size={16} />
                </button>
              )}

              <button
                type="button"
                className={`btn btn-subtle btn-icon${activeItem.isStarred ? ' is-active' : ''}`}
                disabled={busy}
                aria-label={activeItem.isStarred ? '取消星标' : '加星标'}
                title={activeItem.isStarred ? '取消星标' : '加星标'}
                onClick={() => void runPatch(
                  activeItem,
                  { isStarred: !activeItem.isStarred },
                  activeItem.isStarred ? '已取消星标' : '已加星标'
                )}
              >
                <AppIcon name={activeItem.isStarred ? 'starFilled' : 'star'} size={16} />
              </button>

              <button
                type="button"
                className="btn btn-ghost btn-sm coverflow-ai-btn"
                disabled={isGeneratingActive}
                title={aiCoverConfigured ? (activeCover ? '用 AI 重新生成海报封面' : '用 AI 生成海报封面') : '前往配置生图 API'}
                onClick={() => {
                  if (!aiCoverConfigured) {
                    onOpenAiSettings()
                    return
                  }
                  void onGenerateCover(activeItem)
                }}
              >
                <AppIcon
                  name={isGeneratingActive ? 'sync' : 'sparkles'}
                  size={14}
                  className={isGeneratingActive ? 'is-spinning' : undefined}
                />
                {isGeneratingActive ? '生成中…' : activeCover ? '重绘封面' : '生成封面'}
              </button>

              <button
                type="button"
                className="btn btn-subtle btn-icon"
                disabled={busy}
                aria-label="编辑条目"
                title="编辑条目"
                onClick={() => onEdit(activeItem)}
              >
                <AppIcon name="edit" size={16} />
              </button>

              <button
                type="button"
                className="btn btn-subtle btn-icon coverflow-delete-btn"
                disabled={busy}
                aria-label="移到回收站"
                title="移到回收站"
                onClick={() => void runDelete(activeItem)}
              >
                <AppIcon name="trash" size={16} />
              </button>
            </div>
          </div>
        </article>
      </div>

      <div className="coverflow-footer">
        <span className="coverflow-counter" aria-live="polite">
          {String(activeIndex + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
        </span>

        <div className="coverflow-controls" role="group" aria-label="轮播控制">
          <button
            type="button"
            className="btn btn-icon coverflow-ctrl-btn"
            aria-label="上一张封面"
            disabled={items.length <= 1}
            onClick={() => {
              setAutoPlay(false)
              step(-1)
            }}
          >
            <AppIcon name="chevronLeft" size={17} />
          </button>

          <button
            type="button"
            className={`btn btn-icon coverflow-ctrl-btn${autoPlay ? ' is-active' : ''}`}
            aria-label={autoPlay ? '暂停自动轮播' : '自动轮播'}
            aria-pressed={autoPlay}
            disabled={items.length <= 1}
            onClick={() => setAutoPlay((playing) => !playing)}
          >
            <AppIcon name={autoPlay ? 'pause' : 'play'} size={15} />
          </button>

          <button
            type="button"
            className="btn btn-icon coverflow-ctrl-btn"
            aria-label="下一张封面"
            disabled={items.length <= 1}
            onClick={() => {
              setAutoPlay(false)
              step(1)
            }}
          >
            <AppIcon name="chevronRight" size={17} />
          </button>
        </div>
      </div>
    </section>
  )
}
