import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addChinaDays, chinaToday, plannedDateLabel, plannedState, smartPriority } from '../china-date'
import { itemAgeLabel } from '../item-age'
import type { BulkItemChanges, Category, ImageAsset, LibraryItem } from '../types'
import { AppIcon, BrandMark } from './AppIcon'
import { CoverFlowView } from './CoverFlowView'
import { PosterArtwork } from './PosterArtwork'

type FocusViewMode = 'card' | 'coverflow'

const FOCUS_VIEW_STORAGE_KEY = 'do-it-laaaaaater.focus-view.v1'
const EMPTY_GENERATING_IDS = new Set<string>()

export interface FocusModeProps {
  items: LibraryItem[]
  categories: Category[]
  now: number
  onClose: () => void
  onPatch: (item: LibraryItem, changes: BulkItemChanges, label: string) => Promise<boolean>
  onEdit: (item: LibraryItem) => void
  onDelete: (item: LibraryItem) => Promise<boolean>
  onPreview: (assets: ImageAsset[], index: number) => void
  generatingIds?: Set<string>
  aiCoverConfigured?: boolean
  onGenerateCover?: (item: LibraryItem) => Promise<void>
  onOpenAiSettings?: () => void
}

function readInitialFocusView(): FocusViewMode {
  try {
    const saved = localStorage.getItem(FOCUS_VIEW_STORAGE_KEY)
    if (saved === 'card' || saved === 'coverflow') return saved
  } catch {
    // Ignore storage access errors.
  }
  return 'card'
}

function hasBlockingOverlay(rootEl: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false
  const overlays = document.querySelectorAll('[role="dialog"], [role="menu"]')
  for (const overlay of overlays) {
    if (!rootEl || !overlay.contains(rootEl)) return true
  }
  return false
}

function manualAssets(item: LibraryItem): ImageAsset[] {
  return item.assets.filter((asset) => asset.role !== 'web_cover')
}

function resolveCover(item: LibraryItem): ImageAsset | null {
  const webCover = item.assets.find((asset) => asset.role === 'web_cover')
  if (webCover) return webCover
  return manualAssets(item)[0] || null
}

function focusOrder(items: LibraryItem[]): LibraryItem[] {
  const today = chinaToday()
  return [...items].sort((left, right) => {
    const priority = smartPriority(left, today) - smartPriority(right, today)
    if (priority) return priority
    return left.createdAt - right.createdAt
  })
}

export function FocusMode({
  items,
  categories,
  now,
  onClose,
  onPatch,
  onEdit,
  onDelete,
  onPreview,
  generatingIds = EMPTY_GENERATING_IDS,
  aiCoverConfigured = false,
  onGenerateCover,
  onOpenAiSettings
}: FocusModeProps) {
  const ordered = useMemo(() => focusOrder(items), [items])
  const categoryMap = useMemo(() => new Map(categories.map((cat) => [cat.id, cat])), [categories])

  const [focusView, setFocusView] = useState<FocusViewMode>(readInitialFocusView)
  const [activeId, setActiveId] = useState(() => ordered[0]?.id || '')
  const [navDir, setNavDir] = useState<'next' | 'prev'>('next')
  const [busy, setBusy] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)

  const foundIndex = ordered.findIndex((entry) => entry.id === activeId)
  const activeIndex = foundIndex >= 0 ? foundIndex : 0
  const item = ordered[activeIndex] || ordered[0] || null

  const switchFocusView = useCallback((mode: FocusViewMode) => {
    setFocusView(mode)
    try {
      localStorage.setItem(FOCUS_VIEW_STORAGE_KEY, mode)
    } catch {
      // Ignore storage write errors.
    }
  }, [])

  useEffect(() => {
    if (!ordered.length) {
      setActiveId('')
      return
    }
    if (!ordered.some((entry) => entry.id === activeId)) {
      setActiveId(ordered[Math.min(activeIndex, ordered.length - 1)].id)
    }
  }, [activeId, activeIndex, ordered])

  const moveFrom = useCallback((baseItem: LibraryItem, direction: -1 | 1) => {
    if (ordered.length <= 1) return
    const idx = ordered.findIndex((entry) => entry.id === baseItem.id)
    const baseIdx = idx >= 0 ? idx : activeIndex
    const next = (baseIdx + direction + ordered.length) % ordered.length
    setNavDir(direction > 0 ? 'next' : 'prev')
    setActiveId(ordered[next].id)
  }, [activeIndex, ordered])

  const openTargetItem = useCallback((target: LibraryItem) => {
    if (target.kind === 'link' && target.url) {
      window.open(target.url, '_blank', 'noopener,noreferrer')
      return
    }
    const manual = manualAssets(target)
    if (target.kind === 'image_group' && manual.length) {
      onPreview(manual, 0)
      return
    }
    const cover = resolveCover(target)
    if (cover) {
      onPreview([cover], 0)
      return
    }
    onEdit(target)
  }, [onEdit, onPreview])

  const patchTarget = useCallback(async (
    target: LibraryItem,
    changes: BulkItemChanges,
    label: string,
    advance = false
  ): Promise<boolean> => {
    if (busy) return false
    const idx = ordered.findIndex((entry) => entry.id === target.id)
    const baseIdx = idx >= 0 ? idx : activeIndex
    const nextId = ordered[(baseIdx + 1) % Math.max(1, ordered.length)]?.id || ''
    setBusy(true)
    try {
      const success = await onPatch(target, changes, label)
      if (success && advance && ordered.length > 1 && nextId && nextId !== target.id) {
        setNavDir('next')
        setActiveId(nextId)
      }
      return success
    } finally {
      setBusy(false)
    }
  }, [activeIndex, busy, onPatch, ordered])

  const deleteTarget = useCallback(async (target: LibraryItem): Promise<boolean> => {
    if (busy) return false
    const idx = ordered.findIndex((entry) => entry.id === target.id)
    const baseIdx = idx >= 0 ? idx : activeIndex
    const nextId = ordered[(baseIdx + 1) % Math.max(1, ordered.length)]?.id || ''
    setBusy(true)
    try {
      const removed = await onDelete(target)
      if (removed && nextId && nextId !== target.id) {
        setNavDir('next')
        setActiveId(nextId)
      }
      return removed
    } finally {
      setBusy(false)
    }
  }, [activeIndex, busy, onDelete, ordered])

  const triggerGenerateCover = useCallback((target: LibraryItem) => {
    if (!aiCoverConfigured) {
      onOpenAiSettings?.()
      return
    }
    if (onGenerateCover) {
      void onGenerateCover(target)
    }
  }, [aiCoverConfigured, onGenerateCover, onOpenAiSettings])

  useEffect(() => {
    function isEditable(target: EventTarget | null) {
      return Boolean((target as HTMLElement | null)?.closest('input,textarea,select,[contenteditable="true"]'))
    }

    function onKeyDown(event: KeyboardEvent) {
      if (hasBlockingOverlay(rootRef.current)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (isEditable(event.target) || !item) return

      // In 'coverflow' mode, CoverFlowView's physics engine handles ArrowLeft/ArrowRight directly
      if (focusView === 'card') {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          moveFrom(item, -1)
          return
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          moveFrom(item, 1)
          return
        }
      }

      const key = event.key.toLowerCase()
      const todayKey = chinaToday()
      const tomorrowKey = addChinaDays(1, todayKey)
      const nextWeekKey = addChinaDays(7, todayKey)

      if (event.key === ' ' || key === 'o') {
        event.preventDefault()
        openTargetItem(item)
      } else if (key === 'd') {
        event.preventDefault()
        void patchTarget(
          item,
          { status: item.status === 'pending' ? 'completed' : 'pending' },
          item.status === 'pending' ? '已完成' : '已恢复待处理',
          item.status === 'pending'
        )
      } else if (key === 't' && item.status === 'pending') {
        event.preventDefault()
        void patchTarget(item, { plannedFor: tomorrowKey }, '已移到明天处理', true)
      } else if (key === 'w' && item.status === 'pending') {
        event.preventDefault()
        void patchTarget(item, { plannedFor: nextWeekKey }, '已移到下周处理', true)
      } else if (key === 's') {
        event.preventDefault()
        void patchTarget(
          item,
          { isStarred: !item.isStarred },
          item.isStarred ? '已取消星标' : '已加星标'
        )
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [focusView, item, moveFrom, onClose, openTargetItem, patchTarget])

  if (!item) {
    return (
      <div ref={rootRef} className="focus-mode" role="dialog" aria-modal="true" aria-label="晚间处理模式">
        <section className="focus-empty">
          <div className="focus-empty-icon" aria-hidden="true">
            <AppIcon name="checkCircle" size={28} />
          </div>
          <h2>当前筛选下已经处理完了</h2>
          <p>可以退出处理模式，换一组筛选条件继续。</p>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            返回首页
          </button>
        </section>
      </div>
    )
  }

  const today = chinaToday()
  const tomorrow = addChinaDays(1, today)
  const nextWeek = addChinaDays(7, today)
  const manual = manualAssets(item)
  const cover = resolveCover(item)
  const resolvedCategory = item.category ? categoryMap.get(item.category.id) || item.category : null
  const itemWithCat = resolvedCategory && resolvedCategory !== item.category
    ? { ...item, category: resolvedCategory }
    : item
  const planState = plannedState(item.plannedFor, today)
  const isGeneratingCurrent = generatingIds.has(item.id)
  const canGenerateCover = Boolean(onGenerateCover || onOpenAiSettings)
  const counterDigits = Math.max(2, String(ordered.length).length)

  return (
    <div ref={rootRef} className="focus-mode" role="dialog" aria-modal="true" aria-label="晚间处理模式">
      <header className="focus-header">
        <div className="focus-brand">
          <BrandMark size={22} />
          <div>
            <span className="focus-kicker">EVENING REVIEW</span>
            <h1>晚间处理</h1>
          </div>
        </div>

        <div className="focus-view-switch" role="tablist" aria-label="专注处理视图">
          <button
            type="button"
            role="tab"
            aria-selected={focusView === 'card'}
            className={`focus-view-switch-btn${focusView === 'card' ? ' is-active' : ''}`}
            onClick={() => switchFocusView('card')}
          >
            <AppIcon name="focus" size={14} />
            专注卡片
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={focusView === 'coverflow'}
            className={`focus-view-switch-btn${focusView === 'coverflow' ? ' is-active' : ''}`}
            onClick={() => switchFocusView('coverflow')}
          >
            <AppIcon name="album" size={14} />
            专辑封面
          </button>
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '14px' }}>
          <div className="focus-counter" aria-live="polite">
            {String(activeIndex + 1).padStart(counterDigits, '0')} / {String(ordered.length).padStart(counterDigits, '0')}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <AppIcon name="close" size={15} />
            退出
          </button>
        </div>
      </header>

      {focusView === 'coverflow' ? (
        <main className="focus-album">
          <CoverFlowView
            items={ordered}
            categories={categories}
            generatingIds={generatingIds}
            aiCoverConfigured={aiCoverConfigured}
            onPatch={(target, changes, label) => patchTarget(target, changes, label, false)}
            onEdit={onEdit}
            onDelete={deleteTarget}
            onGenerateCover={async (target) => {
              if (onGenerateCover) await onGenerateCover(target)
            }}
            onPreview={onPreview}
            onOpenAiSettings={() => onOpenAiSettings?.()}
            now={now}
            compact
            activeItemId={activeId}
            onActiveItemChange={(nextItem) => {
              if (nextItem.id !== activeId) {
                setActiveId(nextItem.id)
              }
            }}
            customActions={(active) => {
              const activeCover = resolveCover(active)
              const isGenerating = generatingIds.has(active.id)
              return (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => void patchTarget(
                      active,
                      { status: active.status === 'pending' ? 'completed' : 'pending' },
                      active.status === 'pending' ? '已完成' : '已恢复待处理',
                      active.status === 'pending'
                    )}
                  >
                    <AppIcon name={active.status === 'pending' ? 'check' : 'restore'} size={14} />
                    {active.status === 'pending' ? '完成' : '恢复'}
                  </button>

                  <button
                    type="button"
                    className={`btn btn-subtle btn-sm${active.plannedFor === tomorrow ? ' is-active' : ''}`}
                    disabled={busy || active.status === 'completed'}
                    onClick={() => void patchTarget(active, { plannedFor: tomorrow }, '已移到明天处理', true)}
                  >
                    明天
                  </button>

                  <button
                    type="button"
                    className={`btn btn-subtle btn-sm${active.plannedFor === nextWeek ? ' is-active' : ''}`}
                    disabled={busy || active.status === 'completed'}
                    onClick={() => void patchTarget(active, { plannedFor: nextWeek }, '已移到下周处理', true)}
                  >
                    下周
                  </button>

                  <button
                    type="button"
                    className={`btn btn-subtle btn-icon btn-sm${active.isStarred ? ' is-active' : ''}`}
                    disabled={busy}
                    aria-label={active.isStarred ? '取消星标' : '星标'}
                    title={active.isStarred ? '取消星标' : '星标'}
                    onClick={() => void patchTarget(
                      active,
                      { isStarred: !active.isStarred },
                      active.isStarred ? '已取消星标' : '已加星标'
                    )}
                  >
                    <AppIcon name={active.isStarred ? 'starFilled' : 'star'} size={15} />
                  </button>

                  {canGenerateCover && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm coverflow-ai-btn"
                      disabled={isGenerating}
                      title={aiCoverConfigured ? (activeCover ? '用 AI 重新生成海报封面' : '用 AI 生成海报封面') : '前往配置生图 API'}
                      onClick={() => triggerGenerateCover(active)}
                    >
                      <AppIcon
                        name={isGenerating ? 'sync' : 'sparkles'}
                        size={13}
                        className={isGenerating ? 'is-spinning' : undefined}
                      />
                      {isGenerating ? '生成中…' : activeCover ? '重绘封面' : '生成封面'}
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-subtle btn-icon btn-sm"
                    disabled={busy}
                    aria-label="编辑"
                    title="编辑"
                    onClick={() => onEdit(active)}
                  >
                    <AppIcon name="edit" size={15} />
                  </button>

                  <button
                    type="button"
                    className="btn btn-subtle btn-icon btn-sm coverflow-delete-btn"
                    disabled={busy}
                    aria-label="删除"
                    title="删除"
                    onClick={() => void deleteTarget(active)}
                  >
                    <AppIcon name="trash" size={15} />
                  </button>

                  <button
                    type="button"
                    className="btn btn-subtle btn-sm"
                    disabled={busy || ordered.length <= 1}
                    style={{ marginLeft: 'auto' }}
                    onClick={() => moveFrom(active, 1)}
                  >
                    跳过
                    <AppIcon name="chevronRight" size={14} />
                  </button>
                </>
              )
            }}
          />
        </main>
      ) : (
        <main className="focus-stage">
          <button
            type="button"
            className="btn btn-icon focus-arrow focus-arrow-left"
            aria-label="上一条"
            onClick={() => moveFrom(item, -1)}
            disabled={ordered.length <= 1}
          >
            <AppIcon name="chevronLeft" size={20} />
          </button>

          <article
            key={item.id}
            data-dir={navDir}
            className="focus-card has-cover"
          >
            {cover ? (
              <button
                type="button"
                className="focus-cover"
                onClick={() => onPreview(item.kind === 'image_group' && manual.length ? manual : [cover], 0)}
              >
                <img src={cover.thumbUrl} alt="" />
                {manual.length > 1 && <span className="focus-cover-count">{manual.length} 张</span>}
                {isGeneratingCurrent && (
                  <span className="coverflow-generating-badge" role="status">
                    <AppIcon name="sparkles" size={13} className="is-spinning" />
                    AI 绘制中…
                  </span>
                )}
              </button>
            ) : (
              <div className="focus-cover is-poster">
                <PosterArtwork item={itemWithCat} index={activeIndex} variant="focus" />
                {isGeneratingCurrent && (
                  <span className="coverflow-generating-badge" role="status">
                    <AppIcon name="sparkles" size={13} className="is-spinning" />
                    AI 绘制中…
                  </span>
                )}
              </div>
            )}

            <div className="focus-content">
              <div className="focus-badges">
                <span className={item.status === 'pending' ? 'badge badge-indigo' : 'badge badge-muted'}>
                  {item.status === 'pending' ? '待处理' : '已完成'}
                </span>
                {item.isStarred && (
                  <span className="badge badge-indigo">
                    <AppIcon name="starFilled" size={11} />
                    星标
                  </span>
                )}
                {planState === 'overdue' && <span className="badge badge-danger">逾期</span>}
                {planState === 'today' && <span className="badge badge-indigo">今天处理</span>}
                {planState === 'future' && item.plannedFor && (
                  <span className="badge badge-muted">计划 · {plannedDateLabel(item.plannedFor, today)}</span>
                )}
                <span className="focus-age">{itemAgeLabel(item, now)}</span>
              </div>

              <h2 className="focus-title">{item.title}</h2>
              {item.url && <p className="focus-url">{item.url}</p>}

              <label className="focus-category">
                <span className="field-label">类别</span>
                <select
                  className="select"
                  aria-label="修改当前条目类别"
                  value={item.category?.id || ''}
                  disabled={busy}
                  onChange={(event) => void patchTarget(item, { categoryId: event.target.value || null }, '类别已更新')}
                >
                  <option value="">未分类</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>

              <div className="focus-primary-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  disabled={busy}
                  onClick={() => void patchTarget(
                    item,
                    { status: item.status === 'pending' ? 'completed' : 'pending' },
                    item.status === 'pending' ? '已完成' : '已恢复待处理',
                    item.status === 'pending'
                  )}
                >
                  <AppIcon name={item.status === 'pending' ? 'check' : 'restore'} size={17} />
                  {item.status === 'pending' ? '完成' : '恢复待处理'}
                </button>

                {(item.kind === 'link' || item.kind === 'image_group' || Boolean(cover)) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-lg"
                    disabled={busy}
                    onClick={() => openTargetItem(item)}
                  >
                    <AppIcon name={item.kind === 'link' ? 'external' : 'image'} size={16} />
                    {item.kind === 'link' ? '打开原网页' : '查看图片'}
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-subtle btn-lg"
                  disabled={busy || ordered.length <= 1}
                  onClick={() => moveFrom(item, 1)}
                >
                  跳过
                  <AppIcon name="chevronRight" size={16} />
                </button>
              </div>

              <div className="focus-secondary-actions">
                <button
                  type="button"
                  className={`btn btn-subtle btn-sm${item.plannedFor === tomorrow ? ' is-active' : ''}`}
                  disabled={busy || item.status === 'completed'}
                  onClick={() => void patchTarget(item, { plannedFor: tomorrow }, '已移到明天处理', true)}
                >
                  <AppIcon name="calendar" size={14} />
                  移到明天
                </button>

                <button
                  type="button"
                  className={`btn btn-subtle btn-sm${item.plannedFor === nextWeek ? ' is-active' : ''}`}
                  disabled={busy || item.status === 'completed'}
                  onClick={() => void patchTarget(item, { plannedFor: nextWeek }, '已移到下周处理', true)}
                >
                  <AppIcon name="calendar" size={14} />
                  移到下周
                </button>

                <button
                  type="button"
                  className={`btn btn-subtle btn-sm${item.isStarred ? ' is-active' : ''}`}
                  disabled={busy}
                  onClick={() => void patchTarget(
                    item,
                    { isStarred: !item.isStarred },
                    item.isStarred ? '已取消星标' : '已加星标'
                  )}
                >
                  <AppIcon name={item.isStarred ? 'starFilled' : 'star'} size={14} />
                  {item.isStarred ? '取消星标' : '星标'}
                </button>

                {canGenerateCover && (
                  <button
                    type="button"
                    className="btn btn-subtle btn-sm"
                    disabled={isGeneratingCurrent}
                    onClick={() => triggerGenerateCover(item)}
                  >
                    <AppIcon
                      name={isGeneratingCurrent ? 'sync' : 'sparkles'}
                      size={14}
                      className={isGeneratingCurrent ? 'is-spinning' : undefined}
                    />
                    {isGeneratingCurrent ? '生成中…' : cover ? '重绘封面' : '生成封面'}
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-subtle btn-sm"
                  disabled={busy}
                  onClick={() => onEdit(item)}
                >
                  <AppIcon name="edit" size={14} />
                  编辑
                </button>

                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={() => void deleteTarget(item)}
                >
                  <AppIcon name="trash" size={14} />
                  删除
                </button>
              </div>
            </div>
          </article>

          <button
            type="button"
            className="btn btn-icon focus-arrow focus-arrow-right"
            aria-label="下一条"
            onClick={() => moveFrom(item, 1)}
            disabled={ordered.length <= 1}
          >
            <AppIcon name="chevronRight" size={20} />
          </button>
        </main>
      )}

      <footer className="focus-shortcuts" aria-label="键盘快捷键">
        <span><kbd>←</kbd><kbd>→</kbd> 切换封面</span>
        <span><kbd>Space</kbd> 打开</span>
        <span><kbd>D</kbd> 完成</span>
        <span><kbd>T</kbd> 明天</span>
        <span><kbd>W</kbd> 下周</span>
        <span><kbd>S</kbd> 星标</span>
        <span><kbd>Esc</kbd> 退出</span>
      </footer>
    </div>
  )
}
