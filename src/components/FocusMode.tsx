import { useEffect, useMemo, useState } from 'react'
import { addChinaDays, chinaToday, plannedDateLabel, plannedState, smartPriority } from '../china-date'
import { itemAgeLabel } from '../item-age'
import type { BulkItemChanges, Category, ImageAsset, LibraryItem } from '../types'
import { AppIcon, BrandMark } from './AppIcon'

function manualAssets(item: LibraryItem) {
  return item.assets.filter((asset) => asset.role !== 'web_cover')
}

function focusOrder(items: LibraryItem[]) {
  const today = chinaToday()
  return [...items].sort((left, right) => {
    const priority = smartPriority(left, today) - smartPriority(right, today)
    if (priority) return priority
    return left.createdAt - right.createdAt
  })
}

function ChevronLeftIcon({ size = 20 }: { size?: number }) {
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

export function FocusMode({
  items,
  categories,
  now,
  onClose,
  onPatch,
  onEdit,
  onDelete,
  onPreview
}: {
  items: LibraryItem[]
  categories: Category[]
  now: number
  onClose: () => void
  onPatch: (item: LibraryItem, changes: BulkItemChanges, label: string) => Promise<boolean>
  onEdit: (item: LibraryItem) => void
  onDelete: (item: LibraryItem) => Promise<boolean>
  onPreview: (assets: ImageAsset[], index: number) => void
}) {
  const ordered = useMemo(() => focusOrder(items), [items])
  const [activeId, setActiveId] = useState(() => ordered[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const activeIndex = Math.max(0, ordered.findIndex((item) => item.id === activeId))
  const item = ordered[activeIndex] || ordered[0]

  useEffect(() => {
    if (!ordered.length) {
      setActiveId('')
      return
    }
    if (!ordered.some((entry) => entry.id === activeId)) {
      setActiveId(ordered[Math.min(activeIndex, ordered.length - 1)].id)
    }
  }, [activeId, activeIndex, ordered])

  function move(direction: -1 | 1) {
    if (!ordered.length) return
    const next = (activeIndex + direction + ordered.length) % ordered.length
    setActiveId(ordered[next].id)
  }

  function openItem() {
    if (item?.kind === 'link' && item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
    else if (item?.kind === 'image_group') {
      const assets = manualAssets(item)
      if (assets.length) onPreview(assets, 0)
    }
  }

  async function patch(changes: BulkItemChanges, label: string, advance = false) {
    if (!item || busy) return
    const nextId = ordered[(activeIndex + 1) % Math.max(1, ordered.length)]?.id || ''
    setBusy(true)
    try {
      const success = await onPatch(item, changes, label)
      if (success && advance && ordered.length > 1) setActiveId(nextId)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    function interactive(target: EventTarget | null) {
      return Boolean((target as HTMLElement | null)?.closest('input,textarea,select,[contenteditable="true"]'))
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (interactive(event.target) || !item) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        move(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        move(1)
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        openItem()
      } else if (event.key === ' ') {
        event.preventDefault()
        void patch(
          { status: item.status === 'pending' ? 'completed' : 'pending' },
          item.status === 'pending' ? '已完成' : '已恢复',
          item.status === 'pending'
        )
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void patch({ isStarred: !item.isStarred }, item.isStarred ? '已取消星标' : '已加星标')
      } else if (event.key.toLowerCase() === 't' && item.status === 'pending') {
        event.preventDefault()
        void patch(
          { plannedFor: item.plannedFor ? null : chinaToday() },
          item.plannedFor ? '已清除处理计划' : '已加入今日清单'
        )
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  if (!item) {
    return (
      <div className="focus-mode" role="dialog" aria-modal="true" aria-label="晚间处理模式">
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
  const cover = item.kind === 'link'
    ? item.assets.find((asset) => asset.role === 'web_cover') || manual[0]
    : item.kind === 'image_group'
      ? manual[0]
      : undefined
  const planState = plannedState(item.plannedFor, today)

  return (
    <div className="focus-mode" role="dialog" aria-modal="true" aria-label="晚间处理模式">
      <header className="focus-header">
        <div className="focus-brand">
          <BrandMark size={22} />
          <div>
            <span className="focus-kicker">EVENING REVIEW</span>
            <h1>晚间处理</h1>
          </div>
        </div>
        <div className="focus-counter" aria-live="polite">
          {String(activeIndex + 1).padStart(2, '0')} / {String(ordered.length).padStart(2, '0')}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          <AppIcon name="close" size={15} />
          退出
        </button>
      </header>

      <main className="focus-stage">
        <button
          type="button"
          className="btn btn-icon focus-arrow focus-arrow-left"
          aria-label="上一条"
          onClick={() => move(-1)}
          disabled={ordered.length <= 1}
        >
          <ChevronLeftIcon size={20} />
        </button>

        <article className={cover ? 'focus-card has-cover' : 'focus-card'}>
          {cover && (
            <button
              type="button"
              className="focus-cover"
              onClick={() => onPreview(item.kind === 'image_group' ? manual : [cover], 0)}
            >
              <img src={cover.thumbUrl} alt="" />
              {manual.length > 1 && <span className="focus-cover-count">{manual.length} 张</span>}
            </button>
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
                onChange={(event) => void patch({ categoryId: event.target.value || null }, '类别已更新')}
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
                onClick={() => void patch(
                  { status: item.status === 'pending' ? 'completed' : 'pending' },
                  item.status === 'pending' ? '已完成' : '已恢复',
                  item.status === 'pending'
                )}
              >
                <AppIcon name={item.status === 'pending' ? 'check' : 'restore'} size={17} />
                {item.status === 'pending' ? '完成' : '恢复待处理'}
              </button>

              {(item.kind === 'link' || item.kind === 'image_group') && (
                <button
                  type="button"
                  className="btn btn-ghost btn-lg"
                  disabled={busy}
                  onClick={openItem}
                >
                  <AppIcon name={item.kind === 'link' ? 'external' : 'image'} size={16} />
                  {item.kind === 'link' ? '打开原网页' : '查看图片'}
                </button>
              )}

              <button
                type="button"
                className="btn btn-subtle btn-lg"
                disabled={busy || ordered.length <= 1}
                onClick={() => move(1)}
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
                onClick={() => void patch({ plannedFor: tomorrow }, '已移到明天处理', true)}
              >
                <AppIcon name="calendar" size={14} />
                移到明天
              </button>

              <button
                type="button"
                className={`btn btn-subtle btn-sm${item.plannedFor === nextWeek ? ' is-active' : ''}`}
                disabled={busy || item.status === 'completed'}
                onClick={() => void patch({ plannedFor: nextWeek }, '已移到下周处理', true)}
              >
                <AppIcon name="calendar" size={14} />
                移到下周
              </button>

              <button
                type="button"
                className={`btn btn-subtle btn-sm${item.isStarred ? ' is-active' : ''}`}
                disabled={busy}
                onClick={() => void patch({ isStarred: !item.isStarred }, item.isStarred ? '已取消星标' : '已加星标')}
              >
                <AppIcon name={item.isStarred ? 'starFilled' : 'star'} size={14} />
                {item.isStarred ? '取消星标' : '星标'}
              </button>

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
                onClick={async () => {
                  const nextId = ordered[(activeIndex + 1) % Math.max(1, ordered.length)]?.id || ''
                  if (await onDelete(item)) setActiveId(nextId)
                }}
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
          onClick={() => move(1)}
          disabled={ordered.length <= 1}
        >
          <AppIcon name="chevronRight" size={20} />
        </button>
      </main>

      <footer className="focus-shortcuts" aria-label="键盘快捷键">
        <span><kbd>←</kbd><kbd>→</kbd> 切换</span>
        <span><kbd>O</kbd> 打开</span>
        <span><kbd>Space</kbd> 完成/恢复</span>
        <span><kbd>S</kbd> 星标</span>
        <span><kbd>T</kbd> 今日</span>
        <span><kbd>Esc</kbd> 退出</span>
      </footer>
    </div>
  )
}
