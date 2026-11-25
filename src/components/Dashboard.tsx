import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { ApiRequestError, api, errorMessage, jsonRequest, readCachedSnapshot } from '../api'
import { chinaToday, plannedDateLabel, plannedState } from '../china-date'
import { smartDashboardGroups, type DashboardGroup } from '../dashboard-groups'
import { discardDraft, readActiveDraft, type ActiveDraft } from '../draft-store'
import { itemAgeLabel } from '../item-age'
import { filterLibraryItems } from '../offline-query'
import {
  flushOfflineQueue,
  getOfflineQueueSummaries,
  useOfflineRuntime
} from '../offline-store'
import { useSyncStatus } from '../sync-status'
import type {
  AppPreferences,
  BulkItemChanges,
  Category,
  ImageAsset,
  ItemFilters,
  LibraryItem
} from '../types'
import { AppIcon, BrandMark, type AppIconName } from './AppIcon'
import { BackupManager } from './BackupManager'
import { CategoryPickerPopover } from './CategoryPickerPopover'
import { CoverFlowView } from './CoverFlowView'
import { FocusMode } from './FocusMode'
import { validateImageFiles } from './FormFields'
import { EditItemForm } from './ItemForms'
import {
  AccountManager,
  BookmarkletHelp,
  CategoriesManager,
  Lightbox
} from './ManagementModals'
import { EmptyState, Modal } from './Modal'
import { OfflineManagerModal } from './OfflineManager'
import { PosterArtwork } from './PosterArtwork'
import { SchedulePicker } from './SchedulePicker'
import { SmartAddModal, parseWebUrl, type SmartAddInitial } from './SmartAddModal'
import { showToast } from './Toast'

const MemoCanvas = lazy(() => import('./MemoCanvas').then((module) => ({ default: module.MemoCanvas })))

type ViewMode = 'list' | 'gallery' | 'coverflow'

type Overlay =
  | { type: 'smart-add'; initial?: SmartAddInitial }
  | { type: 'edit'; item: LibraryItem }
  | { type: 'categories' }
  | { type: 'account' }
  | { type: 'backup' }
  | { type: 'bookmarklet' }
  | { type: 'sync' }
  | { type: 'lightbox'; assets: ImageAsset[]; index: number }
  | null

const SORT_STORAGE_KEY = 'do-it-laaaaaater.item-sort.v1'
const VIEW_MODE_STORAGE_KEY = 'do-it-laaaaaater.view-mode.v1'
const SIDEBAR_STORAGE_KEY = 'do-it-laaaaaater.sidebar-collapsed.v1'
const NEW_CATEGORY_COLORS = ['#4d49fc', '#00b6ff', '#24cb71', '#ff7237', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6']

const defaultFilters: ItemFilters = {
  status: 'pending',
  kind: 'all',
  category: '',
  date: '',
  q: '',
  priority: 'all',
  sort: 'smart',
  trash: 'active'
}

function initialFilters(): ItemFilters {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY)
    if (saved === 'smart' || saved === 'newest' || saved === 'oldest' || saved === 'recently_completed' || saved === 'planned_date') {
      return { ...defaultFilters, sort: saved }
    }
  } catch {
    // Fallback to default smart sort.
  }
  return { ...defaultFilters }
}

function initialViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (saved === 'list' || saved === 'gallery' || saved === 'coverflow') return saved
  } catch {
    // Fallback to list view.
  }
  return 'list'
}

function initialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function dayKey(timestamp: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp))
}

function dayLabel(key: string) {
  const today = dayKey(Date.now())
  const yesterday = dayKey(Date.now() - 24 * 60 * 60 * 1000)
  if (key === today) return '今天'
  if (key === yesterday) return '昨天'
  const date = new Date(key + 'T00:00:00+08:00')
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(date)
}

function hostLabel(url: string | null) {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function shortPastedTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 300)
}

function smartInitialFromTransfer(data: DataTransfer): SmartAddInitial | null {
  const plain = data.getData('text/plain').trim()
  const uriList = data.getData('text/uri-list')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#')) || ''

  let htmlUrl = ''
  let htmlTitle = ''
  const html = data.getData('text/html')
  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const anchor = doc.querySelector<HTMLAnchorElement>('a[href]')
      if (anchor) {
        htmlUrl = anchor.getAttribute('href') || ''
        htmlTitle = shortPastedTitle(anchor.textContent || '')
      }
    } catch {
      // Ignore malformed HTML clipboard payloads.
    }
  }

  const embedded = plain.match(/https?:\/\/[^\s<>"']+/i)?.[0] || ''
  const url = parseWebUrl(uriList) || parseWebUrl(htmlUrl) || parseWebUrl(plain) || parseWebUrl(embedded)
  if (url) {
    let title = htmlTitle
    if (!title && plain && !parseWebUrl(plain)) {
      title = shortPastedTitle(embedded ? plain.replace(embedded, ' ') : plain)
    }
    return { url, title }
  }
  return plain ? { text: plain } : null
}

function itemManualAssets(item: LibraryItem) {
  return item.assets.filter((asset) => asset.role !== 'web_cover')
}

function notifySuccess(message: string) {
  showToast('success', message)
}

function notifyError(message: string) {
  showToast('error', message)
}

class MemoErrorBoundary extends Component<
  { onClose: () => void; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="memo-canvas-overlay">
          <div className="fig-card fig-memo-error">
            <h2>备忘录画布加载失败</h2>
            <p>应用可能刚刚更新或网络连接中断，刷新页面即可恢复画布。</p>
            <div className="fig-memo-error-actions">
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                重新加载页面
              </button>
              <button type="button" className="btn btn-ghost" onClick={this.props.onClose}>
                返回清单
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function AnchoredMenu({
  open,
  anchor,
  align = 'right',
  className = '',
  label,
  onClose,
  children
}: {
  open: boolean
  anchor: HTMLElement | null
  align?: 'left' | 'right'
  className?: string
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const el = menuRef.current
    if (!el) return
    const update = () => {
      const box = el.getBoundingClientRect()
      const vw = document.documentElement.clientWidth
      const vh = window.visualViewport?.height || window.innerHeight
      const ab = anchor?.isConnected ? anchor.getBoundingClientRect() : null
      let left = ab
        ? (align === 'right' ? ab.right - box.width : ab.left)
        : (vw - box.width) / 2
      left = Math.max(12, Math.min(left, vw - box.width - 12))
      let top = ab ? ab.bottom + 6 : 72
      if (ab && top + box.height > vh - 12) {
        const above = ab.top - box.height - 6
        top = above >= 12 ? above : vh - box.height - 12
      }
      top = Math.max(12, Math.min(top, vh - box.height - 12))
      setPos({ top, left })
    }
    const frame = window.requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [align, anchor, open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      if (anchor?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [anchor, onClose, open])

  if (!open) return null

  const style: CSSProperties = pos
    ? { position: 'fixed', top: `${pos.top}px`, left: `${pos.left}px`, visibility: 'visible' }
    : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className={`fig-popover fig-menu ${className}`.trim()}
      style={style}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  )
}

function MobileBottomSheet({
  open,
  title,
  onClose,
  children
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null
  return createPortal(
    <div
      className="fig-sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section role="dialog" aria-modal="true" aria-label={title} className="fig-sheet">
        <div className="fig-sheet-handle" aria-hidden="true" />
        <header className="fig-sheet-header">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon" aria-label="关闭" onClick={onClose}>
            <AppIcon name="close" size={18} />
          </button>
        </header>
        <div className="fig-sheet-body">{children}</div>
      </section>
    </div>,
    document.body
  )
}

interface ItemEntryProps {
  item: LibraryItem
  index?: number
  viewMode: 'list' | 'gallery'
  categories: Category[]
  selectionMode: boolean
  trashMode: boolean
  selected: boolean
  busy: boolean
  generatingCover: boolean
  retry?: { changes: BulkItemChanges; label: string }
  now: number
  onEdit: () => void
  onPatch: (changes: BulkItemChanges, label: string) => Promise<boolean>
  onCreateCategory: (name: string, color: string) => Promise<Category>
  onSelect: (selected: boolean) => void
  onDelete: () => Promise<boolean>
  onRestore: () => Promise<boolean>
  onPermanentDelete: () => Promise<boolean>
  onGenerateCover: () => void
  onPreview: (assets: ImageAsset[], index: number) => void
  onShareToBlog?: () => void
}

function ItemEntry({
  item,
  index = 0,
  viewMode,
  categories,
  selectionMode,
  trashMode,
  selected,
  busy,
  generatingCover,
  retry,
  now,
  onEdit,
  onPatch,
  onCreateCategory,
  onSelect,
  onDelete,
  onRestore,
  onPermanentDelete,
  onGenerateCover,
  onPreview,
  onShareToBlog
}: ItemEntryProps) {
  const webCover = item.assets.find((asset) => asset.role === 'web_cover')
  const manual = itemManualAssets(item)
  const cover = item.kind === 'link'
    ? (webCover || manual[0])
    : item.kind === 'image_group'
      ? (webCover || manual[0])
      : webCover
  const previewAssets = item.kind === 'link'
    ? (webCover ? [webCover, ...manual] : manual)
    : item.kind === 'image_group'
      ? (webCover ? [webCover, ...manual] : manual)
      : (webCover ? [webCover] : [])

  const plan = plannedState(item.plannedFor)
  const kindIcon: AppIconName = item.kind === 'link' ? 'link' : item.kind === 'text' ? 'text' : 'image'
  const trashDaysLeft = item.trashedAt
    ? Math.max(0, Math.ceil((item.trashedAt + 7 * 24 * 60 * 60 * 1000 - now) / (24 * 60 * 60 * 1000)))
    : 0

  const [catOpen, setCatOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const catBtnRef = useRef<HTMLButtonElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)

  const toggleComplete = () => {
    void onPatch(
      { status: item.status === 'pending' ? 'completed' : 'pending' },
      item.status === 'pending' ? '已标记完成' : '已恢复待处理'
    )
  }

  const toggleStar = () => {
    void onPatch({ isStarred: !item.isStarred }, item.isStarred ? '已取消星标' : '已加星标')
  }

  const planBadge = plan === 'overdue' ? (
    <span className="badge badge-danger">{plannedDateLabel(item.plannedFor)}</span>
  ) : plan === 'today' ? (
    <span className="badge badge-indigo">今天</span>
  ) : plan === 'future' ? (
    <span className="badge badge-muted">{plannedDateLabel(item.plannedFor)}</span>
  ) : null

  const categoryChip = (
    <button
      ref={catBtnRef}
      type="button"
      className="fig-cat-chip"
      disabled={busy || trashMode || selectionMode}
      aria-label={`修改“${item.title}”的类别`}
      aria-expanded={catOpen}
      onClick={(event) => {
        event.stopPropagation()
        setCatOpen((value) => !value)
      }}
    >
      <span
        className="cat-dot"
        style={{ backgroundColor: item.category?.color || '#b5b5b5' }}
        aria-hidden="true"
      />
      <span>{item.category?.name || '未分类'}</span>
    </button>
  )

  const cardMenu = (
    <AnchoredMenu
      open={menuOpen}
      anchor={moreBtnRef.current}
      label="条目操作"
      className="fig-card-menu"
      onClose={() => setMenuOpen(false)}
    >
      {item.kind === 'link' && item.url && (
        <a
          role="menuitem"
          className="fig-menu-item"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={() => setMenuOpen(false)}
        >
          <AppIcon name="external" size={15} />
          <span>打开原网页</span>
        </a>
      )}
      {previewAssets.length > 0 && (
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item"
          onClick={() => {
            setMenuOpen(false)
            onPreview(previewAssets, 0)
          }}
        >
          <AppIcon name="image" size={15} />
          <span>查看图片 ({previewAssets.length})</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="fig-menu-item"
        disabled={item.status === 'completed'}
        onClick={() => {
          setMenuOpen(false)
          setPlanOpen(true)
        }}
      >
        <AppIcon name="calendar" size={15} />
        <span>{item.plannedFor ? `计划：${plannedDateLabel(item.plannedFor)}` : '安排日期'}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="fig-menu-item"
        disabled={generatingCover}
        onClick={() => {
          setMenuOpen(false)
          onGenerateCover()
        }}
      >
        <AppIcon name="sparkles" size={15} />
        <span>{generatingCover ? '生成封面中…' : (webCover ? '重新生成封面' : '生成 AI 封面')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="fig-menu-item"
        onClick={() => {
          setMenuOpen(false)
          onEdit()
        }}
      >
        <AppIcon name="edit" size={15} />
        <span>编辑详情</span>
      </button>
      {!trashMode && onShareToBlog && (
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item"
          onClick={() => {
            setMenuOpen(false)
            onShareToBlog()
          }}
        >
          <AppIcon name="send" size={15} />
          <span>转摘到博客</span>
        </button>
      )}
      <div className="fig-menu-divider" />
      <button
        type="button"
        role="menuitem"
        className="fig-menu-item is-danger"
        onClick={() => {
          setMenuOpen(false)
          void onDelete()
        }}
      >
        <AppIcon name="trash" size={15} />
        <span>移到回收站</span>
      </button>
    </AnchoredMenu>
  )

  const popovers = (
    <>
      <CategoryPickerPopover
        open={catOpen}
        anchor={catBtnRef.current}
        categories={categories}
        selectedId={item.category?.id || null}
        busy={busy}
        onSelect={(categoryId) => onPatch({ categoryId }, '类别已更新')}
        onCreateCategory={onCreateCategory}
        onClose={() => setCatOpen(false)}
      />
      <SchedulePicker
        open={planOpen}
        anchor={moreBtnRef.current}
        value={item.plannedFor}
        busy={busy}
        onSelect={(date) => onPatch({ plannedFor: date }, `已安排 ${plannedDateLabel(date)}处理`)}
        onClear={() => onPatch({ plannedFor: null }, '已取消处理计划')}
        onClose={() => setPlanOpen(false)}
      />
      {cardMenu}
    </>
  )

  const titleElement = item.kind === 'link' && item.url ? (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="fig-item-link"
      onClick={(event) => {
        if (selectionMode) {
          event.preventDefault()
          onSelect(!selected)
        }
      }}
    >
      {item.title}
    </a>
  ) : item.kind === 'image_group' ? (
    <button
      type="button"
      className="fig-item-link"
      onClick={() => {
        if (selectionMode) {
          onSelect(!selected)
          return
        }
        if (manual.length) onPreview(manual, 0)
        else onEdit()
      }}
    >
      {item.title}
    </button>
  ) : (
    <button
      type="button"
      className="fig-item-link"
      onClick={() => {
        if (selectionMode) onSelect(!selected)
        else onEdit()
      }}
    >
      {item.title}
    </button>
  )

  if (viewMode === 'gallery') {
    return (
      <article
        className={`fig-card fig-gallery-card${item.status === 'completed' ? ' is-completed' : ''}${selected ? ' is-selected' : ''}${selectionMode ? ' is-selectable' : ''}`}
        onClick={selectionMode ? () => onSelect(!selected) : undefined}
      >
        <div className="fig-gallery-cover">
          {cover ? (
            <button
              type="button"
              className="fig-gallery-cover-btn"
              aria-label={`查看 ${item.title} 的图片`}
              onClick={(event) => {
                if (selectionMode) return
                event.stopPropagation()
                onPreview(previewAssets, 0)
              }}
            >
              <img src={cover.thumbUrl} alt="" loading="lazy" />
              {item.kind === 'image_group' && manual.length > 1 && (
                <span className="fig-gallery-count">{manual.length} 张</span>
              )}
            </button>
          ) : (
            <button
              type="button"
              className="fig-gallery-cover-btn fig-gallery-poster"
              style={{ position: 'relative' }}
              aria-label={item.kind === 'link' && item.url ? `打开 ${item.title}` : `编辑 ${item.title}`}
              onClick={() => {
                if (selectionMode) return
                if (item.kind === 'link' && item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
                else onEdit()
              }}
            >
              <PosterArtwork item={item} index={index} variant="gallery" />
            </button>
          )}

          {selectionMode ? (
            <span
              className={`fig-check-circle fig-gallery-check${selected ? ' is-selected' : ''}`}
              aria-hidden="true"
            >
              {selected && <AppIcon name="check" size={12} />}
            </span>
          ) : !trashMode ? (
            <button
              type="button"
              className={`fig-check-circle fig-gallery-check${item.status === 'completed' ? ' is-completed' : ''}`}
              disabled={busy}
              aria-label={item.status === 'pending' ? '标记完成' : '恢复待处理'}
              onClick={(event) => {
                event.stopPropagation()
                toggleComplete()
              }}
            >
              {item.status === 'completed' && <AppIcon name="check" size={12} />}
            </button>
          ) : null}

          {!trashMode && !selectionMode && (
            <button
              type="button"
              className={`fig-gallery-star${item.isStarred ? ' is-starred' : ''}`}
              disabled={busy}
              aria-label={item.isStarred ? '取消星标' : '加星标'}
              onClick={(event) => {
                event.stopPropagation()
                toggleStar()
              }}
            >
              <AppIcon name={item.isStarred ? 'starFilled' : 'star'} size={14} />
            </button>
          )}
        </div>

        <div className="fig-gallery-body">
          <h3 className="fig-gallery-title">{titleElement}</h3>
          <div className="fig-gallery-sub">
            {item.url ? (
              <span className="fig-mono fig-domain" title={item.url}>{hostLabel(item.url)}</span>
            ) : (
              <span className="fig-mono fig-domain">
                {item.kind === 'image_group' ? `${manual.length} 张图片` : '文字备忘'}
              </span>
            )}
            <span className="fig-mono fig-age">{itemAgeLabel(item, now)}</span>
          </div>

          <div className="fig-gallery-foot">
            <div className="fig-gallery-foot-left">
              {categoryChip}
              {planBadge}
              {generatingCover && (
                <span className="badge badge-indigo fig-generating-badge">
                  <AppIcon name="sparkles" size={11} />生成封面中…
                </span>
              )}
              {trashMode && <span className="badge badge-danger">剩 {trashDaysLeft} 天</span>}
            </div>
            <div className="fig-gallery-foot-right">
              {trashMode ? (
                <>
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    disabled={busy}
                    title="恢复"
                    aria-label="恢复"
                    onClick={(event) => {
                      event.stopPropagation()
                      void onRestore()
                    }}
                  >
                    <AppIcon name="restore" size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-sm fig-danger-icon"
                    disabled={busy}
                    title="彻底删除"
                    aria-label="彻底删除"
                    onClick={(event) => {
                      event.stopPropagation()
                      void onPermanentDelete()
                    }}
                  >
                    <AppIcon name="trash" size={14} />
                  </button>
                </>
              ) : !selectionMode ? (
                <button
                  ref={moreBtnRef}
                  type="button"
                  className="btn btn-icon btn-sm fig-more-btn"
                  disabled={busy}
                  aria-label="更多操作"
                  aria-expanded={menuOpen}
                  onClick={(event) => {
                    event.stopPropagation()
                    setMenuOpen((value) => !value)
                  }}
                >
                  <AppIcon name="more" size={15} />
                </button>
              ) : null}
            </div>
          </div>

          {retry && (
            <div className="fig-row-retry" role="alert">
              <span>保存失败</span>
              <button
                type="button"
                className="btn btn-text btn-sm"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation()
                  void onPatch(retry.changes, retry.label)
                }}
              >
                重试
              </button>
            </div>
          )}
        </div>
        {popovers}
      </article>
    )
  }

  return (
    <article
      className={`fig-row${item.status === 'completed' ? ' is-completed' : ''}${selected ? ' is-selected' : ''}${selectionMode ? ' is-selectable' : ''}`}
      onClick={selectionMode ? () => onSelect(!selected) : undefined}
    >
      <div className="fig-row-lead">
        {selectionMode ? (
          <button
            type="button"
            className={`fig-check-circle${selected ? ' is-selected' : ''}`}
            aria-label={selected ? `取消选择 ${item.title}` : `选择 ${item.title}`}
            aria-pressed={selected}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(!selected)
            }}
          >
            {selected && <AppIcon name="check" size={12} />}
          </button>
        ) : !trashMode ? (
          <button
            type="button"
            className={`fig-check-circle${item.status === 'completed' ? ' is-completed' : ''}`}
            disabled={busy}
            aria-label={item.status === 'pending' ? '标记完成' : '恢复待处理'}
            onClick={toggleComplete}
          >
            {item.status === 'completed' && <AppIcon name="check" size={12} />}
          </button>
        ) : (
          <span className="fig-row-kind-dot" aria-hidden="true">
            <AppIcon name={kindIcon} size={15} />
          </span>
        )}
      </div>

      {cover && (
        <button
          type="button"
          className="fig-row-thumb"
          aria-label={`查看 ${item.title} 的图片`}
          onClick={(event) => {
            if (selectionMode) return
            event.stopPropagation()
            onPreview(previewAssets, 0)
          }}
        >
          <img src={cover.thumbUrl} alt="" loading="lazy" />
          {item.kind === 'image_group' && manual.length > 1 && (
            <span className="fig-row-thumb-count">{manual.length}</span>
          )}
        </button>
      )}

      <div className="fig-row-main">
        <div className="fig-row-title-line">
          <h3 className="fig-row-title">{titleElement}</h3>
          {planBadge}
          {generatingCover && (
            <span className="badge badge-indigo fig-generating-badge">
              <AppIcon name="sparkles" size={11} />生成封面中…
            </span>
          )}
          {trashMode && <span className="badge badge-danger">还可恢复 {trashDaysLeft} 天</span>}
        </div>
        <div className="fig-row-meta">
          <span className="fig-row-kind" title={item.kind === 'link' ? '网页' : item.kind === 'image_group' ? '图片' : '文本'}>
            <AppIcon name={kindIcon} size={12} />
          </span>
          {item.url && <span className="fig-mono fig-domain" title={item.url}>{hostLabel(item.url)}</span>}
          {categoryChip}
          {item.kind === 'link' && manual.length > 0 && (
            <button
              type="button"
              className="fig-meta-btn"
              onClick={(event) => {
                if (selectionMode) return
                event.stopPropagation()
                onPreview(manual, 0)
              }}
            >
              {manual.length} 张附图
            </button>
          )}
          <span className="fig-mono fig-age">{itemAgeLabel(item, now)}</span>
        </div>
        {retry && (
          <div className="fig-row-retry" role="alert">
            <span>刚才的修改没有保存</span>
            <button
              type="button"
              className="btn btn-text btn-sm"
              disabled={busy}
              onClick={() => void onPatch(retry.changes, retry.label)}
            >
              重试
            </button>
          </div>
        )}
      </div>

      <div className="fig-row-actions">
        {trashMode ? (
          <>
            <button type="button" className="btn btn-subtle btn-sm" disabled={busy} onClick={() => void onRestore()}>
              <AppIcon name="restore" size={14} />恢复
            </button>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void onPermanentDelete()}>
              彻底删除
            </button>
          </>
        ) : !selectionMode ? (
          <>
            <button
              type="button"
              className={`btn btn-icon fig-star-btn${item.isStarred ? ' is-starred' : ''}`}
              disabled={busy}
              aria-label={item.isStarred ? '取消星标' : '加星标'}
              onClick={toggleStar}
            >
              <AppIcon name={item.isStarred ? 'starFilled' : 'star'} size={15} />
            </button>
            <button
              ref={moreBtnRef}
              type="button"
              className="btn btn-icon fig-more-btn"
              disabled={busy}
              aria-label="更多操作"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <AppIcon name="more" size={16} />
            </button>
          </>
        ) : null}
      </div>
      {popovers}
    </article>
  )
}

export function Dashboard({
  userEmail,
  onSessionChange,
  initialTab,
  onConsumeInitialTab,
  onOpenBlog
}: {
  userEmail: string
  onSessionChange: () => Promise<void>
  initialTab?: 'list' | 'plan' | 'memo'
  onConsumeInitialTab?: () => void
  onOpenBlog?: (opts?: { path?: string; importItemId?: string }) => void
}) {
  const [categories, setCategories] = useState<Category[]>([])
  const [allItems, setAllItems] = useState<LibraryItem[]>([])
  const [preferences, setPreferences] = useState<AppPreferences>({ quickSaveCategoryId: null })
  const [filters, setFilters] = useState<ItemFilters>(initialFilters)
  const [todayOverdueOnly, setTodayOverdueOnly] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(initialSidebarCollapsed)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false)
  const [bulkScheduleAnchor, setBulkScheduleAnchor] = useState<HTMLElement | null>(null)
  const [bulkCatOpen, setBulkCatOpen] = useState(false)
  const [bulkCatAnchor, setBulkCatAnchor] = useState<HTMLElement | null>(null)

  const [busyItems, setBusyItems] = useState<Set<string>>(() => new Set())
  const [generatingCoverIds, setGeneratingCoverIds] = useState<Set<string>>(() => new Set())
  const generatingCoverRef = useRef<Set<string>>(new Set())
  const preferencesRef = useRef<AppPreferences>(preferences)
  preferencesRef.current = preferences
  const [retryItems, setRetryItems] = useState<Record<string, { changes: BulkItemChanges; label: string }>>({})
  const [focusMode, setFocusMode] = useState(false)
  const [memoOpen, setMemoOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [undoDelete, setUndoDelete] = useState<{ ids: string[]; label: string } | null>(null)
  const [activeDraft, setActiveDraft] = useState<ActiveDraft | null>(() => readActiveDraft())

  const [sidebarAddingCat, setSidebarAddingCat] = useState(false)
  const [sidebarNewCatName, setSidebarNewCatName] = useState('')
  const [sidebarCreatingCat, setSidebarCreatingCat] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const accountBtnRef = useRef<HTMLButtonElement>(null)
  const requestNumber = useRef(0)

  const syncStatus = useSyncStatus()
  const offlineState = useOfflineRuntime()

  const items = useMemo(() => {
    const base = filterLibraryItems(allItems, filters)
    if (!todayOverdueOnly) return base
    const today = chinaToday()
    return base.filter((item) => Boolean(item.plannedFor && item.plannedFor <= today))
  }, [allItems, filters, todayOverdueOnly])

  const counts = useMemo(() => {
    const today = chinaToday()
    let pending = 0
    let todayOverdue = 0
    let starred = 0
    let completed = 0
    let trash = 0
    let uncategorized = 0
    const byCategory = new Map<string, number>()

    for (const item of allItems) {
      if (item.trashedAt) {
        trash++
        continue
      }
      if (item.isStarred) starred++
      if (item.status === 'completed') {
        completed++
      } else {
        pending++
        if (item.plannedFor && item.plannedFor <= today) todayOverdue++
        if (item.category) {
          byCategory.set(item.category.id, (byCategory.get(item.category.id) || 0) + 1)
        } else {
          uncategorized++
        }
      }
    }
    return { pending, todayOverdue, starred, completed, trash, uncategorized, byCategory }
  }, [allItems])

  const bulkPlannedFor = useMemo(() => {
    const selected = allItems.filter((item) => selectedIds.has(item.id))
    if (!selected.length) return null
    const first = selected[0].plannedFor
    return selected.every((item) => item.plannedFor === first) ? first : null
  }, [allItems, selectedIds])

  const bulkHasPlanned = useMemo(
    () => allItems.some((item) => selectedIds.has(item.id) && Boolean(item.plannedFor)),
    [allItems, selectedIds]
  )

  const bulkCanSchedule = useMemo(
    () => allItems.some((item) => selectedIds.has(item.id) && item.status === 'pending'),
    [allItems, selectedIds]
  )

  const refreshReferences = useCallback(async () => {
    const [nextCategories, nextPreferences] = await Promise.all([
      api<Category[]>('/api/categories'),
      api<AppPreferences>('/api/preferences')
    ])
    setCategories(nextCategories)
    setPreferences(nextPreferences)
    return nextCategories
  }, [])

  const createCategory = useCallback(async (name: string, color: string) => {
    const created = await jsonRequest<Category>('/api/categories', 'POST', { name, color })
    const nextCategories = await refreshReferences()
    return nextCategories.find((category) => category.id === created.id) || created
  }, [refreshReferences])

  const refreshItems = useCallback(async (background = false) => {
    const currentRequest = ++requestNumber.current
    if (!background) setLoading(true)
    try {
      const fetchedItems = await api<LibraryItem[]>('/api/items?status=all&sort=newest&trash=all')
      if (currentRequest === requestNumber.current) {
        setAllItems(fetchedItems)
        setError('')
      }
    } catch (requestError) {
      if (currentRequest === requestNumber.current) setError(errorMessage(requestError))
    } finally {
      if (currentRequest === requestNumber.current) setLoading(false)
    }
  }, [])

  // SWR instant-open hydration from IndexedDB snapshot + live refresh
  useEffect(() => {
    let active = true
    let itemsSettled = false
    let refsSettled = false
    void Promise.all([
      readCachedSnapshot<Category[]>('/api/categories'),
      readCachedSnapshot<AppPreferences>('/api/preferences'),
      readCachedSnapshot<LibraryItem[]>('/api/items?status=all&sort=newest&trash=all')
    ]).then(([cachedCategories, cachedPreferences, cachedItems]) => {
      if (!active) return
      if (!refsSettled) {
        if (cachedCategories) setCategories(cachedCategories)
        if (cachedPreferences) setPreferences(cachedPreferences)
      }
      if (!itemsSettled && cachedItems) {
        setAllItems(cachedItems)
        setLoading(false)
      }
    })
    void refreshReferences()
      .then(() => { refsSettled = true })
      .catch((requestError) => setError(errorMessage(requestError)))
    void refreshItems(true).finally(() => { itemsSettled = true })
    return () => { active = false }
  }, [refreshItems, refreshReferences])

  useEffect(() => {
    const refreshNow = () => setNow(Date.now())
    const timer = window.setInterval(refreshNow, 60_000)
    document.addEventListener('visibilitychange', refreshNow)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshNow)
    }
  }, [])

  useEffect(() => {
    const synced = () => {
      void Promise.all([refreshReferences(), refreshItems(true)])
    }
    window.addEventListener('offline-sync-complete', synced)
    return () => window.removeEventListener('offline-sync-complete', synced)
  }, [refreshItems, refreshReferences])

  useEffect(() => {
    if (!filters.category || filters.category === 'uncategorized') return
    if (!categories.some((category) => category.id === filters.category)) {
      setFilters((current) => ({ ...current, category: '' }))
    }
  }, [categories, filters.category])

  useEffect(() => {
    try { localStorage.setItem(SORT_STORAGE_KEY, filters.sort) } catch { /* ignore */ }
  }, [filters.sort])

  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode) } catch { /* ignore */ }
  }, [viewMode])

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? '1' : '0') } catch { /* ignore */ }
  }, [sidebarCollapsed])

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => items.some((item) => item.id === id))))
  }, [items])

  useEffect(() => {
    if (!undoDelete) return
    const timer = window.setTimeout(() => setUndoDelete(null), 10_000)
    return () => window.clearTimeout(timer)
  }, [undoDelete])

  // URL query ?add=link, ?open=, and #quick-clipboard
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('add') === 'link' && params.get('url')) {
      setOverlay({
        type: 'smart-add',
        initial: {
          url: params.get('url') || '',
          title: params.get('title') || ''
        }
      })
      window.history.replaceState({}, '', window.location.pathname)
      return
    }
    const openId = params.get('open')
    if (openId) {
      void api<LibraryItem>('/api/items/' + encodeURIComponent(openId)).then((item) => {
        if (item.trashedAt) {
          setTodayOverdueOnly(false)
          setFilters((current) => ({ ...current, trash: 'only', status: 'all', priority: 'all', category: '' }))
          notifyError('这个条目在回收站中，可先恢复')
        } else {
          setOverlay({ type: 'edit', item })
        }
        window.history.replaceState({}, '', window.location.pathname)
      }).catch((requestError) => notifyError(errorMessage(requestError)))
    }
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const clipboardValue = hash.get('quick-clipboard')
    if (clipboardValue) {
      window.history.replaceState({}, '', window.location.pathname + window.location.search)
      void quickSaveClipboard(clipboardValue)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global "/" search focus + global paste/drag-drop to open SmartAddModal
  useEffect(() => {
    function editableTarget(target: EventTarget | null) {
      const element = target as HTMLElement | null
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'))
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (overlay || focusMode || memoOpen) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
      if (editableTarget(event.target)) return
      // Floating menus / sheets / popovers own Escape and the letter keys while open.
      if (accountMenuOpen || mobileMoreOpen || bulkScheduleOpen || bulkCatOpen) return
      if (document.querySelector('.cat-popover, .fig-popover')) return

      if (event.key === 'Escape') {
        if (filters.q) {
          setFilters((current) => ({ ...current, q: '' }))
        } else if (selectionMode) {
          exitSelection()
        }
        return
      }
      if (event.repeat) return

      switch (event.key) {
        case '/':
          event.preventDefault()
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
          break
        case 'n':
        case 'N':
          event.preventDefault()
          setOverlay({ type: 'smart-add' })
          break
        case '1':
          event.preventDefault()
          changeViewMode('list')
          break
        case '2':
          event.preventDefault()
          changeViewMode('gallery')
          break
        case '3':
          event.preventDefault()
          changeViewMode('coverflow')
          break
        case 'f':
        case 'F':
          if (items.length > 0 && filters.trash !== 'only') {
            event.preventDefault()
            setFocusMode(true)
          }
          break
        default:
      }
    }
    function handlePaste(event: ClipboardEvent) {
      if (overlay || focusMode || memoOpen || editableTarget(event.target)) return
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
      if (files.length) {
        event.preventDefault()
        const result = validateImageFiles(files)
        if (result.error) notifyError(result.error)
        if (result.accepted.length) setOverlay({ type: 'smart-add', initial: { files: result.accepted } })
        return
      }
      if (!event.clipboardData) return
      const initial = smartInitialFromTransfer(event.clipboardData)
      if (initial) {
        event.preventDefault()
        setOverlay({ type: 'smart-add', initial })
      }
    }
    function handleDragOver(event: DragEvent) {
      if (!overlay && !focusMode && !memoOpen && event.dataTransfer?.types.some((type) => (
        type === 'Files' || type === 'text/plain' || type === 'text/uri-list'
      ))) {
        event.preventDefault()
      }
    }
    function handleDrop(event: DragEvent) {
      if (overlay || focusMode || memoOpen) return
      const files = Array.from(event.dataTransfer?.files || [])
      if (files.length) {
        event.preventDefault()
        const result = validateImageFiles(files)
        if (result.error) notifyError(result.error)
        if (result.accepted.length) setOverlay({ type: 'smart-add', initial: { files: result.accepted } })
        return
      }
      if (!event.dataTransfer) return
      const initial = smartInitialFromTransfer(event.dataTransfer)
      if (initial) {
        event.preventDefault()
        setOverlay({ type: 'smart-add', initial })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('paste', handlePaste)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('paste', handlePaste)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountMenuOpen,
    bulkCatOpen,
    bulkScheduleOpen,
    filters.q,
    filters.trash,
    focusMode,
    items.length,
    memoOpen,
    mobileMoreOpen,
    overlay,
    selectionMode
  ])

  // Restore the reading position after List <-> Gallery switches (anchored on the first visible group).
  const viewAnchorRef = useRef<{ key: string; top: number } | null>(null)

  function changeViewMode(next: ViewMode) {
    if (next === viewMode) return
    viewAnchorRef.current = null
    if (next !== 'coverflow' && viewMode !== 'coverflow') {
      const groupsInView = Array.from(document.querySelectorAll<HTMLElement>('[data-group-key]'))
      const headerOffset = 72
      const anchor = groupsInView.find((node) => node.getBoundingClientRect().bottom > headerOffset)
      if (anchor?.dataset.groupKey) {
        viewAnchorRef.current = { key: anchor.dataset.groupKey, top: anchor.getBoundingClientRect().top }
      }
    }
    setViewMode(next)
  }

  useLayoutEffect(() => {
    const anchor = viewAnchorRef.current
    viewAnchorRef.current = null
    if (viewMode === 'coverflow') {
      window.scrollTo({ top: 0 })
      return
    }
    if (!anchor) return
    const node = Array.from(document.querySelectorAll<HTMLElement>('[data-group-key]'))
      .find((entry) => entry.dataset.groupKey === anchor.key)
    if (node) window.scrollBy({ top: node.getBoundingClientRect().top - anchor.top })
  }, [viewMode])

  const groups = useMemo<DashboardGroup[]>(() => {
    if (filters.trash === 'only') {
      const result = new Map<string, LibraryItem[]>()
      items.forEach((item) => {
        const key = dayKey(item.trashedAt || item.updatedAt)
        result.set(key, [...(result.get(key) || []), item])
      })
      return Array.from(result.entries()).map(([key, groupItems]) => ({
        key: 'trash-' + key,
        label: dayLabel(key) + '移入回收站',
        date: key,
        items: groupItems
      }))
    }
    if (filters.sort === 'smart') {
      return smartDashboardGroups(items, chinaToday())
    }
    if (filters.sort === 'planned_date') {
      const planned = new Map<string, LibraryItem[]>()
      const unplanned: LibraryItem[] = []
      const today = chinaToday()
      items.forEach((item) => {
        if (item.plannedFor) {
          planned.set(item.plannedFor, [...(planned.get(item.plannedFor) || []), item])
        } else {
          unplanned.push(item)
        }
      })
      const list: DashboardGroup[] = Array.from(planned.entries()).map(([key, groupItems]) => ({
        key: 'plan-' + key,
        label: plannedDateLabel(key, today),
        date: key,
        items: groupItems
      }))
      if (unplanned.length) {
        list.push({ key: 'plan-none', label: '未安排日期', date: '', items: unplanned })
      }
      return list
    }
    const result = new Map<string, LibraryItem[]>()
    items.forEach((item) => {
      const ts = filters.sort === 'recently_completed' ? (item.completedAt || item.createdAt) : item.createdAt
      const key = dayKey(ts)
      result.set(key, [...(result.get(key) || []), item])
    })
    return Array.from(result.entries()).map(([key, groupItems]) => ({
      key,
      label: dayLabel(key),
      date: key,
      items: groupItems
    }))
  }, [filters.sort, filters.trash, items])

  async function reloadAll() {
    await Promise.all([refreshReferences(), refreshItems(true)])
  }

  function shouldAutoGenerateCover(item: LibraryItem, prefs: AppPreferences) {
    if (!prefs.aiCoverAuto || !prefs.aiImageApiKeySet) return false
    if (item.kind !== 'link' && item.kind !== 'text') return false
    return !item.assets.some((asset) => asset.role === 'web_cover' || asset.role === 'gallery')
  }

  const generateItemCover = useCallback(async (
    item: LibraryItem,
    options?: { auto?: boolean; configuredOverride?: boolean }
  ) => {
    if (generatingCoverRef.current.has(item.id)) return
    const configured = options?.configuredOverride ?? Boolean(preferencesRef.current.aiImageApiKeySet)
    if (!configured) {
      if (!options?.auto) {
        notifyError('请先在「账号设置」中配置 AI 生图 API Key')
        setOverlay({ type: 'account' })
      }
      return
    }
    generatingCoverRef.current.add(item.id)
    setGeneratingCoverIds(new Set(generatingCoverRef.current))
    if (!options?.auto) showToast('info', '正在生成 AI 封面…')
    try {
      const updated = await jsonRequest<LibraryItem>(`/api/items/${item.id}/generate-cover`, 'POST', {})
      setAllItems((current) => current.map((entry) => entry.id === item.id ? updated : entry))
      notifySuccess('AI 封面已生成')
    } catch (requestError) {
      if (!options?.auto) notifyError(errorMessage(requestError))
    } finally {
      generatingCoverRef.current.delete(item.id)
      setGeneratingCoverIds(new Set(generatingCoverRef.current))
    }
  }, [])

  async function itemSaved(saved?: LibraryItem, triggerAutoCover = false) {
    setOverlay(null)
    setActiveDraft(null)
    if (saved) {
      setAllItems((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)])
    }
    await reloadAll()
    notifySuccess('已保存')
    if (triggerAutoCover && saved && shouldAutoGenerateCover(saved, preferencesRef.current)) {
      void generateItemCover(saved, { auto: true })
    }
  }

  async function quickSaveClipboard(rawValue: string) {
    const value = rawValue.trim()
    if (!value) {
      notifyError('剪贴板里没有可保存的文字或网址')
      return
    }
    try {
      const [latestPreferences, latestCategories] = categories.length
        ? [preferences, categories]
        : await Promise.all([
            api<AppPreferences>('/api/preferences'),
            api<Category[]>('/api/categories')
          ])
      const categoryId = latestCategories.some((category) => category.id === latestPreferences.quickSaveCategoryId)
        ? latestPreferences.quickSaveCategoryId
        : null
      const webUrl = parseWebUrl(value)
      let saved: LibraryItem
      if (webUrl) {
        let title = hostLabel(webUrl)
        let coverUrl = ''
        try {
          const metadata = await jsonRequest<{ title: string; coverUrl: string }>('/api/metadata', 'POST', { url: webUrl })
          title = metadata.title || title
          coverUrl = metadata.coverUrl || ''
        } catch {
          // Never block quick clipboard save when metadata fails.
        }
        const form = new FormData()
        form.set('url', webUrl)
        form.set('title', title)
        form.set('categoryId', categoryId || '')
        form.set('coverUrl', coverUrl)
        saved = await api<LibraryItem>('/api/items/link', { method: 'POST', body: form })
      } else {
        saved = await jsonRequest<LibraryItem>('/api/items/text', 'POST', {
          title: shortPastedTitle(value),
          categoryId
        })
      }
      await reloadAll()
      notifySuccess(webUrl ? '剪贴板网址已保存' : '剪贴板文字已保存')
      if (shouldAutoGenerateCover(saved, latestPreferences)) {
        void generateItemCover(saved, {
          auto: true,
          configuredOverride: Boolean(latestPreferences.aiImageApiKeySet)
        })
      }
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status === 409) {
        const details = requestError.details as { existingId?: string; trashed?: boolean } | undefined
        notifyError(details?.trashed ? '这个网址已在回收站中，可先恢复原条目' : '这个网址已经保存过了')
        if (details?.trashed) selectQuickView('trash')
        return
      }
      notifyError(errorMessage(requestError))
    }
  }

  async function readClipboardAndSave() {
    setMobileMoreOpen(false)
    try {
      if (!navigator.clipboard?.readText) throw new Error('当前浏览器不允许读取剪贴板')
      await quickSaveClipboard(await navigator.clipboard.readText())
    } catch (requestError) {
      notifyError(errorMessage(requestError) + '。请允许剪贴板权限，或在页面空白处直接粘贴。')
    }
  }

  function optimisticItem(item: LibraryItem, changes: BulkItemChanges): LibraryItem {
    const nextStatus = changes.status || item.status
    const categoryChanged = Object.prototype.hasOwnProperty.call(changes, 'categoryId')
    const nextCategory = categoryChanged
      ? categories.find((category) => category.id === changes.categoryId) || null
      : item.category
    return {
      ...item,
      status: nextStatus,
      category: nextCategory,
      isStarred: changes.isStarred ?? item.isStarred,
      plannedFor: nextStatus === 'completed'
        ? null
        : (Object.prototype.hasOwnProperty.call(changes, 'plannedFor') ? changes.plannedFor || null : item.plannedFor),
      completedAt: nextStatus === 'completed'
        ? (item.status === 'completed' ? item.completedAt : Date.now())
        : null,
      updatedAt: Date.now()
    }
  }

  async function patchItem(item: LibraryItem, changes: BulkItemChanges, label: string) {
    if (busyItems.has(item.id)) return false
    const previous = item
    setBusyItems((current) => new Set(current).add(item.id))
    setRetryItems((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
    setAllItems((current) => current.map((entry) => entry.id === item.id ? optimisticItem(entry, changes) : entry))
    try {
      const updated = await jsonRequest<LibraryItem>('/api/items/' + item.id, 'PATCH', changes)
      setAllItems((current) => current.map((entry) => entry.id === item.id ? updated : entry))
      notifySuccess(label)
      return true
    } catch (requestError) {
      setAllItems((current) => current.map((entry) => entry.id === item.id ? previous : entry))
      setRetryItems((current) => ({ ...current, [item.id]: { changes, label } }))
      notifyError(errorMessage(requestError))
      return false
    } finally {
      setBusyItems((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  async function deleteItem(item: LibraryItem) {
    const previous = item
    const nowTs = Date.now()
    setAllItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, trashedAt: nowTs, updatedAt: nowTs } : entry))
    try {
      const res = await api<{ ok: boolean; item?: LibraryItem }>('/api/items/' + item.id, { method: 'DELETE' })
      if (res?.item) {
        setAllItems((current) => current.map((entry) => entry.id === item.id ? res.item! : entry))
      }
      setUndoDelete({ ids: [item.id], label: `“${item.title}”已移到回收站` })
      return true
    } catch (requestError) {
      setAllItems((current) => current.map((entry) => entry.id === item.id ? previous : entry))
      notifyError(errorMessage(requestError))
      return false
    }
  }

  async function restoreItem(item: LibraryItem) {
    const previous = item
    const nowTs = Date.now()
    setAllItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, trashedAt: null, updatedAt: nowTs } : entry))
    try {
      const restored = await jsonRequest<LibraryItem>('/api/items/' + item.id + '/restore', 'POST')
      setAllItems((current) => current.map((entry) => entry.id === item.id ? restored : entry))
      notifySuccess('已恢复到清单')
      return true
    } catch (requestError) {
      setAllItems((current) => current.map((entry) => entry.id === item.id ? previous : entry))
      notifyError(errorMessage(requestError))
      return false
    }
  }

  async function permanentDeleteItem(item: LibraryItem) {
    if (!window.confirm(`确定彻底删除“${item.title}”吗？相关图片也会永久删除，无法撤销。`)) return false
    const previous = item
    setAllItems((current) => current.filter((entry) => entry.id !== item.id))
    try {
      await api('/api/items/' + item.id + '/permanent', { method: 'DELETE' })
      notifySuccess('已彻底删除')
      return true
    } catch (requestError) {
      setAllItems((current) => [previous, ...current])
      notifyError(errorMessage(requestError))
      return false
    }
  }

  async function undoLastDelete() {
    if (!undoDelete) return
    const ids = undoDelete.ids
    setUndoDelete(null)
    try {
      await jsonRequest('/api/items/bulk', 'POST', { ids, restore: true })
      await reloadAll()
      notifySuccess(ids.length > 1 ? '已恢复这些条目' : '已恢复条目')
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    }
  }

  function toggleSelection(itemId: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }

  async function runBulk(changes: BulkItemChanges, label: string) {
    const ids = [...selectedIds]
    if (!ids.length || bulkBusy) return false
    setBulkBusy(true)
    try {
      const result = await jsonRequest<{
        updated: number
        deleted: number
        succeededIds?: string[]
        failed?: Array<{ id: string; error: string }>
      }>('/api/items/bulk', 'POST', { ids, changes })
      const failedIds = new Set((result.failed || []).map((entry) => entry.id))
      setSelectedIds(failedIds)
      await reloadAll()
      if (failedIds.size) notifyError(`有 ${failedIds.size} 条未能处理，已保留选择。`)
      else notifySuccess(`${label}（${result.updated} 条）`)
      return failedIds.size === 0
    } catch (requestError) {
      notifyError(errorMessage(requestError))
      return false
    } finally {
      setBulkBusy(false)
    }
  }

  async function runBulkDelete() {
    const ids = [...selectedIds]
    if (!ids.length || bulkBusy) return
    setBulkBusy(true)
    try {
      const result = await jsonRequest<{
        deleted: number
        succeededIds?: string[]
        failed?: Array<{ id: string; error: string }>
      }>('/api/items/bulk', 'POST', { ids, delete: true })
      const failedIds = new Set((result.failed || []).map((entry) => entry.id))
      setSelectedIds(failedIds)
      await reloadAll()
      if (failedIds.size) notifyError(`有 ${failedIds.size} 条未能移入回收站，已保留选择。`)
      else setUndoDelete({ ids: result.succeededIds || ids, label: `已将 ${result.deleted} 条移到回收站` })
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    } finally {
      setBulkBusy(false)
    }
  }

  async function runBulkRestore() {
    const ids = [...selectedIds]
    if (!ids.length || bulkBusy) return
    setBulkBusy(true)
    try {
      const result = await jsonRequest<{ updated: number; failed?: Array<{ id: string; error: string }> }>(
        '/api/items/bulk', 'POST', { ids, restore: true }
      )
      const failedIds = new Set((result.failed || []).map((entry) => entry.id))
      setSelectedIds(failedIds)
      await reloadAll()
      if (failedIds.size) notifyError(`有 ${failedIds.size} 条未能恢复，已保留选择。`)
      else notifySuccess(`已恢复 ${result.updated} 条`)
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    } finally {
      setBulkBusy(false)
    }
  }

  async function runBulkPermanentDelete() {
    const ids = [...selectedIds]
    if (!ids.length || bulkBusy) return
    if (!window.confirm(`确定彻底删除选中的 ${ids.length} 条内容吗？相关图片也会永久删除，无法撤销。`)) return
    setBulkBusy(true)
    try {
      const result = await jsonRequest<{ deleted: number; failed?: Array<{ id: string; error: string }> }>(
        '/api/items/bulk', 'POST', { ids, permanentDelete: true }
      )
      const failedIds = new Set((result.failed || []).map((entry) => entry.id))
      setSelectedIds(failedIds)
      await reloadAll()
      if (failedIds.size) notifyError(`有 ${failedIds.size} 条未能彻底删除，已保留选择。`)
      else notifySuccess(`已彻底删除 ${result.deleted} 条`)
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    } finally {
      setBulkBusy(false)
    }
  }

  async function emptyTrash() {
    if (!counts.trash || !window.confirm(`确定清空回收站中的 ${counts.trash} 条内容吗？相关图片也会永久删除，无法撤销。`)) return
    try {
      await jsonRequest('/api/items/trash/empty', 'POST', { confirmed: true })
      await reloadAll()
      notifySuccess('回收站已清空')
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    }
  }

  async function restoreActiveDraft() {
    if (!activeDraft) return
    if (activeDraft.type === 'edit' && activeDraft.itemId) {
      try {
        const item = await api<LibraryItem>('/api/items/' + activeDraft.itemId)
        setOverlay({ type: 'edit', item })
      } catch (requestError) {
        notifyError(errorMessage(requestError))
      }
      return
    }
    setOverlay({ type: 'smart-add', initial: { draftKey: activeDraft.key } })
  }

  async function discardActiveDraft() {
    if (!activeDraft) return
    await discardDraft(activeDraft.key)
    setActiveDraft(null)
  }

  async function openDuplicate(id: string) {
    try {
      const item = await api<LibraryItem>('/api/items/' + id)
      setActiveDraft(null)
      if (item.trashedAt) {
        setOverlay(null)
        selectQuickView('trash')
        notifyError('这个网址在回收站中，可先恢复原条目')
      } else {
        setOverlay({ type: 'edit', item })
      }
      await discardDraft('smart-add')
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    }
  }

  async function logout() {
    try {
      if (!navigator.onLine) {
        notifyError('退出账号需要联网，以免本机尚未同步的内容丢失。')
        return
      }
      await flushOfflineQueue()
      const remaining = await getOfflineQueueSummaries()
      if (remaining.length && !window.confirm(`还有 ${remaining.length} 项本地修改没有同步。继续退出会丢弃这些修改，确定吗？`)) return
      await jsonRequest('/api/auth/logout', 'POST')
      await onSessionChange()
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    }
  }

  async function submitSidebarCategory() {
    const name = sidebarNewCatName.trim()
    if (!name || sidebarCreatingCat) return
    setSidebarCreatingCat(true)
    try {
      const color = NEW_CATEGORY_COLORS[categories.length % NEW_CATEGORY_COLORS.length]
      const created = await createCategory(name, color)
      setSidebarNewCatName('')
      setSidebarAddingCat(false)
      selectCategory(created.id)
      notifySuccess(`已创建类别“${created.name}”`)
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    } finally {
      setSidebarCreatingCat(false)
    }
  }

  function closeEditor() {
    setOverlay(null)
    void reloadAll()
  }

  function dropOnMain(event: ReactDragEvent) {
    if (event.dataTransfer.files.length) event.preventDefault()
  }

  function exitSelection() {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  function selectQuickView(view: 'pending' | 'today' | 'planned' | 'starred' | 'completed' | 'trash') {
    setMemoOpen(false)
    setMobileMoreOpen(false)
    exitSelection()
    if (view === 'pending') {
      setTodayOverdueOnly(false)
      setFilters((current) => ({
        ...current,
        trash: 'active',
        status: 'pending',
        priority: 'all',
        category: '',
        sort: current.sort === 'recently_completed' ? 'smart' : current.sort
      }))
    } else if (view === 'today') {
      setTodayOverdueOnly(true)
      setFilters((current) => ({
        ...current,
        trash: 'active',
        status: 'pending',
        priority: 'planned',
        category: '',
        sort: 'planned_date'
      }))
    } else if (view === 'planned') {
      setTodayOverdueOnly(false)
      setFilters((current) => ({
        ...current,
        trash: 'active',
        status: 'pending',
        priority: 'planned',
        category: '',
        sort: 'planned_date'
      }))
    } else if (view === 'starred') {
      setTodayOverdueOnly(false)
      setFilters((current) => ({
        ...current,
        trash: 'active',
        status: 'all',
        priority: 'starred',
        category: ''
      }))
    } else if (view === 'completed') {
      setTodayOverdueOnly(false)
      setFilters((current) => ({
        ...current,
        trash: 'active',
        status: 'completed',
        priority: 'all',
        category: '',
        sort: 'recently_completed'
      }))
    } else if (view === 'trash') {
      setTodayOverdueOnly(false)
      setFilters((current) => ({
        ...current,
        trash: 'only',
        status: 'all',
        priority: 'all',
        category: ''
      }))
    }
  }

  function selectCategory(categoryId: string) {
    setMemoOpen(false)
    setTodayOverdueOnly(false)
    exitSelection()
    setFilters((current) => ({
      ...current,
      trash: 'active',
      priority: 'all',
      status: current.trash === 'only' || current.status === 'completed' ? 'pending' : current.status,
      category: categoryId
    }))
  }

  function resetFilters(showAll = false) {
    setTodayOverdueOnly(false)
    setFilters({
      ...defaultFilters,
      trash: filters.trash,
      status: filters.trash === 'only' || showAll ? 'all' : 'pending'
    })
  }

  const activeNavTab: 'list' | 'plan' | 'memo' = memoOpen
    ? 'memo'
    : (filters.trash === 'active' && filters.priority === 'planned' && !todayOverdueOnly)
      ? 'plan'
      : 'list'

  useEffect(() => {
    if (!initialTab) return
    if (initialTab === 'plan') {
      setMemoOpen(false)
      setMobileMoreOpen(false)
      setSelectionMode(false)
      setSelectedIds(new Set())
      setTodayOverdueOnly(false)
      setFilters((current) => ({
        ...current,
        trash: 'active',
        status: 'pending',
        priority: 'planned',
        category: '',
        sort: 'planned_date'
      }))
    } else if (initialTab === 'memo') {
      setMobileMoreOpen(false)
      setSelectionMode(false)
      setSelectedIds(new Set())
      setMemoOpen(true)
    } else if (initialTab === 'list') {
      setMemoOpen(false)
      setMobileMoreOpen(false)
      setSelectionMode(false)
      setSelectedIds(new Set())
      setTodayOverdueOnly(false)
      setFilters((current) => ({
        ...current,
        trash: 'active',
        status: 'pending',
        priority: 'all',
        category: '',
        sort: current.sort === 'recently_completed' ? 'smart' : current.sort
      }))
    }
    onConsumeInitialTab?.()
  }, [initialTab, onConsumeInitialTab])

  const activeQuickView = filters.trash === 'only'
    ? 'trash'
    : todayOverdueOnly
      ? 'today'
      : filters.priority === 'starred' && !filters.category
        ? 'starred'
        : filters.status === 'completed' && !filters.category && filters.priority === 'all'
          ? 'completed'
          : filters.status === 'pending' && !filters.category && filters.priority === 'all'
            ? 'pending'
            : ''

  const viewTitle = filters.trash === 'only'
    ? '回收站'
    : todayOverdueOnly
      ? '今日与逾期'
      : filters.priority === 'planned'
        ? '计划处理'
        : filters.priority === 'starred'
          ? '星标'
          : filters.category === 'uncategorized'
            ? '未分类'
            : filters.category
              ? (categories.find((category) => category.id === filters.category)?.name || '类别')
              : filters.status === 'completed'
                ? '已完成'
                : filters.status === 'all'
                  ? '全部条目'
                  : '全部待处理'

  const queuedCount = offlineState.pendingCount + offlineState.failedCount
  const displayedSyncPhase = !offlineState.online
    ? 'offline'
    : offlineState.syncing
      ? 'syncing'
      : queuedCount
        ? 'queued'
        : syncStatus.phase
  const displayedSyncMessage = !offlineState.online
    ? `离线模式${queuedCount ? ` · ${queuedCount} 项待同步` : ''}`
    : offlineState.syncing
      ? '正在同步离线修改…'
      : queuedCount
        ? `${queuedCount} 项等待同步`
        : (offlineState.lastSyncedAt ? '数据已同步' : (syncStatus.message || '数据已就绪'))

  const viewTotal = filters.trash === 'only' ? counts.trash : (counts.pending + counts.completed)

  const aiCoverConfigured = Boolean(preferences.aiImageApiKeySet)

  // Stable poster index per item so generated artwork never reshuffles when groups change.
  const itemIndexById = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach((item, position) => map.set(item.id, position))
    return map
  }, [items])

  // Active-filter summary chips (so a narrowed view never feels "lost").
  const filterChips: Array<{ key: string; label: string; clear: () => void }> = []
  if (filters.q.trim()) {
    filterChips.push({ key: 'q', label: `搜索：${filters.q.trim().slice(0, 24)}`, clear: () => setFilters((current) => ({ ...current, q: '' })) })
  }
  if (filters.kind !== 'all') {
    const kindLabel = filters.kind === 'link' ? '网页' : filters.kind === 'text' ? '文本' : '图片'
    filterChips.push({ key: 'kind', label: `类型：${kindLabel}`, clear: () => setFilters((current) => ({ ...current, kind: 'all' })) })
  }
  if (filters.category) {
    const categoryLabel = filters.category === 'uncategorized'
      ? '未分类'
      : (categories.find((category) => category.id === filters.category)?.name || '类别')
    filterChips.push({ key: 'category', label: `类别：${categoryLabel}`, clear: () => setFilters((current) => ({ ...current, category: '' })) })
  }
  if (filters.priority !== 'all') {
    filterChips.push({
      key: 'priority',
      label: filters.priority === 'starred' ? '仅星标' : '仅计划处理',
      clear: () => setFilters((current) => ({ ...current, priority: 'all' }))
    })
  }
  if (todayOverdueOnly) {
    filterChips.push({ key: 'today', label: '今日与逾期', clear: () => setTodayOverdueOnly(false) })
  }
  if (filters.date) {
    filterChips.push({ key: 'date', label: `日期：${filters.date}`, clear: () => setFilters((current) => ({ ...current, date: '' })) })
  }
  if (filterChips.length && filters.trash === 'active' && filters.status !== 'pending') {
    filterChips.push({
      key: 'status',
      label: filters.status === 'completed' ? '状态：已完成' : '状态：全部',
      clear: () => setFilters((current) => ({ ...current, status: 'pending' }))
    })
  }

  const renderItems = (groupItems: LibraryItem[]) => (
    <div className={viewMode === 'gallery' ? 'fig-gallery-grid' : 'fig-list'}>
      {groupItems.map((item) => (
        <ItemEntry
          key={item.id}
          item={item}
          index={itemIndexById.get(item.id) ?? 0}
          viewMode={viewMode === 'gallery' ? 'gallery' : 'list'}
          categories={categories}
          selectionMode={selectionMode}
          trashMode={filters.trash === 'only'}
          selected={selectedIds.has(item.id)}
          busy={busyItems.has(item.id)}
          generatingCover={generatingCoverIds.has(item.id)}
          retry={retryItems[item.id]}
          now={now}
          onEdit={() => setOverlay({ type: 'edit', item })}
          onPatch={(changes, label) => patchItem(item, changes, label)}
          onCreateCategory={createCategory}
          onSelect={(selected) => toggleSelection(item.id, selected)}
          onDelete={() => deleteItem(item)}
          onRestore={() => restoreItem(item)}
          onPermanentDelete={() => permanentDeleteItem(item)}
          onGenerateCover={() => void generateItemCover(item)}
          onPreview={(assets, index) => setOverlay({ type: 'lightbox', assets, index })}
          onShareToBlog={
            onOpenBlog ? () => onOpenBlog({ path: '/', importItemId: item.id }) : undefined
          }
        />
      ))}
    </div>
  )

  return (
    <div className="fig-app" onDragOver={dropOnMain}>
      {/* Flat 64px Top Header */}
      <header className="fig-header">
        <div className="fig-header-inner">
          <div className="fig-header-left">
            <button
              type="button"
              className="btn btn-icon fig-sidebar-toggle"
              aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              <AppIcon name="sidebar" size={18} />
            </button>

            <button
              type="button"
              className="fig-brand"
              onClick={() => selectQuickView('pending')}
            >
              <BrandMark size={22} />
              <span className="fig-brand-name">Do It Laaaaaater</span>
            </button>

            <nav className="fig-nav-tabs" aria-label="主视图">
              <button
                type="button"
                className={`fig-nav-tab${activeNavTab === 'list' ? ' is-active' : ''}`}
                onClick={() => selectQuickView('pending')}
              >
                清单
              </button>
              <button
                type="button"
                className={`fig-nav-tab${activeNavTab === 'plan' ? ' is-active' : ''}`}
                onClick={() => selectQuickView('planned')}
              >
                计划
              </button>
              <button
                type="button"
                className={`fig-nav-tab${activeNavTab === 'memo' ? ' is-active' : ''}`}
                onClick={() => setMemoOpen(true)}
              >
                备忘录
              </button>
              <button
                type="button"
                className="fig-nav-tab"
                onClick={() => onOpenBlog?.({ path: '/' })}
              >
                博客
              </button>
            </nav>
          </div>

          <div className="fig-header-search">
            <AppIcon name="search" size={15} className="fig-search-icon" />
            <input
              ref={searchInputRef}
              type="search"
              className="fig-search-input"
              aria-label="全局搜索"
              placeholder="搜索标题、网址、类别…"
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  if (filters.q) setFilters((current) => ({ ...current, q: '' }))
                  else searchInputRef.current?.blur()
                }
              }}
            />
            {filters.q ? (
              <button
                type="button"
                className="fig-search-clear"
                aria-label="清除搜索"
                onClick={() => setFilters((current) => ({ ...current, q: '' }))}
              >
                <AppIcon name="close" size={13} />
              </button>
            ) : (
              <kbd className="fig-search-kbd" aria-hidden="true">/</kbd>
            )}
          </div>

          <div className="fig-header-right">
            <button
              type="button"
              className="btn btn-primary fig-add-btn"
              title="快速添加 (N)"
              onClick={() => setOverlay({ type: 'smart-add' })}
            >
              <AppIcon name="plus" size={15} />
              <span>添加</span>
            </button>

            <button
              type="button"
              className="btn btn-icon fig-sync-btn"
              title={displayedSyncMessage}
              aria-label={`${displayedSyncMessage}，点击管理离线缓存`}
              onClick={() => setOverlay({ type: 'sync' })}
            >
              <span className={`fig-sync-dot is-${displayedSyncPhase}`} aria-hidden="true" />
              {queuedCount > 0 && <span className="fig-sync-count">{queuedCount}</span>}
            </button>

            <button
              ref={accountBtnRef}
              type="button"
              className="btn btn-icon fig-menu-trigger"
              aria-label="账号与工具菜单"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((value) => !value)}
            >
              <AppIcon name="user" size={17} />
            </button>
          </div>
        </div>
      </header>

      {/* Account & Tools Dropdown */}
      <AnchoredMenu
        open={accountMenuOpen}
        anchor={accountBtnRef.current}
        label="账号与工具"
        className="fig-account-menu"
        onClose={() => setAccountMenuOpen(false)}
      >
        <div className="fig-menu-header">
          <span className="fig-menu-email" title={userEmail}>{userEmail}</span>
          <span className="fig-menu-sync">{displayedSyncMessage}</span>
        </div>
        <div className="fig-menu-divider" />
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item"
          disabled={!items.length || filters.trash === 'only'}
          onClick={() => {
            setAccountMenuOpen(false)
            setFocusMode(true)
          }}
        >
          <AppIcon name="focus" size={15} />
          <span>晚间专注处理</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item"
          onClick={() => {
            setAccountMenuOpen(false)
            setOverlay({ type: 'bookmarklet' })
          }}
        >
          <AppIcon name="bookmark" size={15} />
          <span>书签按钮</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item"
          onClick={() => {
            setAccountMenuOpen(false)
            setOverlay({ type: 'categories' })
          }}
        >
          <AppIcon name="folder" size={15} />
          <span>类别管理</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item"
          onClick={() => {
            setAccountMenuOpen(false)
            setOverlay({ type: 'backup' })
          }}
        >
          <AppIcon name="download" size={15} />
          <span>数据备份与恢复</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item"
          onClick={() => {
            setAccountMenuOpen(false)
            setOverlay({ type: 'sync' })
          }}
        >
          <AppIcon name="sync" size={15} />
          <span>离线缓存管理</span>
          {queuedCount > 0 && <span className="fig-menu-count">{queuedCount}</span>}
        </button>
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item"
          onClick={() => {
            setAccountMenuOpen(false)
            selectQuickView(filters.trash === 'only' ? 'pending' : 'trash')
          }}
        >
          <AppIcon name="trash" size={15} />
          <span>{filters.trash === 'only' ? '返回待处理清单' : '回收站'}</span>
          {counts.trash > 0 && <span className="fig-menu-count">{counts.trash}</span>}
        </button>
        <div className="fig-menu-divider" />
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item"
          onClick={() => {
            setAccountMenuOpen(false)
            setOverlay({ type: 'account' })
          }}
        >
          <AppIcon name="settings" size={15} />
          <span>账号设置</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="fig-menu-item is-danger"
          onClick={() => {
            setAccountMenuOpen(false)
            void logout()
          }}
        >
          <AppIcon name="logout" size={15} />
          <span>退出登录</span>
        </button>
      </AnchoredMenu>

      {/* Mobile Horizontal Scrollable Category Pill Rail (<900px) */}
      <nav className="fig-mobile-cats" aria-label="移动端快速类别">
        <button
          type="button"
          className={`pill${activeQuickView === 'pending' && !filters.category ? ' is-active' : ''}`}
          onClick={() => selectQuickView('pending')}
        >
          待处理 <span className="fig-mono">{counts.pending}</span>
        </button>
        <button
          type="button"
          className={`pill${activeQuickView === 'today' ? ' is-active' : ''}`}
          onClick={() => selectQuickView('today')}
        >
          今日 <span className="fig-mono">{counts.todayOverdue}</span>
        </button>
        <button
          type="button"
          className={`pill${activeQuickView === 'starred' ? ' is-active' : ''}`}
          onClick={() => selectQuickView('starred')}
        >
          星标 <span className="fig-mono">{counts.starred}</span>
        </button>
        <button
          type="button"
          className={`pill${filters.category === 'uncategorized' ? ' is-active' : ''}`}
          onClick={() => selectCategory('uncategorized')}
        >
          <span className="cat-dot" style={{ backgroundColor: '#b5b5b5' }} aria-hidden="true" />
          未分类
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={`pill${filters.category === category.id ? ' is-active' : ''}`}
            onClick={() => selectCategory(category.id)}
          >
            <span className="cat-dot" style={{ backgroundColor: category.color }} aria-hidden="true" />
            {category.name}
          </button>
        ))}
      </nav>

      {/* Main Shell: Collapsible Left Sidebar + Workspace */}
      <div className={`fig-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
        <aside className="fig-sidebar" aria-label="侧边导航">
          <div className="fig-sidebar-section">
            <div className="fig-sidebar-label">视图</div>
            <button
              type="button"
              className={`fig-sidebar-item${activeQuickView === 'pending' ? ' is-active' : ''}`}
              onClick={() => selectQuickView('pending')}
            >
              <AppIcon name="inbox" size={16} />
              <span className="fig-sidebar-name">全部待处理</span>
              <span className="fig-sidebar-count">{counts.pending}</span>
            </button>
            <button
              type="button"
              className={`fig-sidebar-item${activeQuickView === 'today' ? ' is-active' : ''}`}
              onClick={() => selectQuickView('today')}
            >
              <AppIcon name="calendar" size={16} />
              <span className="fig-sidebar-name">今日与逾期</span>
              <span className="fig-sidebar-count">{counts.todayOverdue}</span>
            </button>
            <button
              type="button"
              className={`fig-sidebar-item${activeQuickView === 'starred' ? ' is-active' : ''}`}
              onClick={() => selectQuickView('starred')}
            >
              <AppIcon name="star" size={16} />
              <span className="fig-sidebar-name">星标</span>
              <span className="fig-sidebar-count">{counts.starred}</span>
            </button>
            <button
              type="button"
              className={`fig-sidebar-item${activeQuickView === 'completed' ? ' is-active' : ''}`}
              onClick={() => selectQuickView('completed')}
            >
              <AppIcon name="checkCircle" size={16} />
              <span className="fig-sidebar-name">已完成</span>
              <span className="fig-sidebar-count">{counts.completed}</span>
            </button>
            <button
              type="button"
              className={`fig-sidebar-item${activeQuickView === 'trash' ? ' is-active' : ''}`}
              onClick={() => selectQuickView('trash')}
            >
              <AppIcon name="trash" size={16} />
              <span className="fig-sidebar-name">回收站</span>
              <span className="fig-sidebar-count">{counts.trash}</span>
            </button>
          </div>

          <div className="fig-sidebar-section">
            <div className="fig-sidebar-label-row">
              <span className="fig-sidebar-label">类别</span>
              <button
                type="button"
                className="btn btn-icon fig-sidebar-add-icon"
                aria-label="新建类别"
                onClick={() => setSidebarAddingCat((value) => !value)}
              >
                <AppIcon name="plus" size={14} />
              </button>
            </div>

            <button
              type="button"
              className={`fig-sidebar-item${filters.category === 'uncategorized' && filters.trash === 'active' ? ' is-active' : ''}`}
              onClick={() => selectCategory('uncategorized')}
            >
              <span className="cat-dot" style={{ backgroundColor: '#b5b5b5' }} aria-hidden="true" />
              <span className="fig-sidebar-name">未分类</span>
              <span className="fig-sidebar-count">{counts.uncategorized}</span>
            </button>

            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`fig-sidebar-item${filters.category === category.id && filters.trash === 'active' ? ' is-active' : ''}`}
                onClick={() => selectCategory(category.id)}
              >
                <span className="cat-dot" style={{ backgroundColor: category.color }} aria-hidden="true" />
                <span className="fig-sidebar-name">{category.name}</span>
                <span className="fig-sidebar-count">{counts.byCategory.get(category.id) || 0}</span>
              </button>
            ))}

            {sidebarAddingCat ? (
              <form
                className="fig-sidebar-create-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitSidebarCategory()
                }}
              >
                <input
                  type="text"
                  className="input fig-sidebar-create-input"
                  maxLength={40}
                  placeholder="输入类别名后回车"
                  aria-label="新类别名称"
                  value={sidebarNewCatName}
                  disabled={sidebarCreatingCat}
                  autoFocus
                  onChange={(event) => setSidebarNewCatName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSidebarAddingCat(false)
                      setSidebarNewCatName('')
                    }
                  }}
                />
              </form>
            ) : (
              <button
                type="button"
                className="fig-sidebar-item fig-sidebar-new-cat"
                onClick={() => setSidebarAddingCat(true)}
              >
                <AppIcon name="plus" size={14} />
                <span className="fig-sidebar-name">新建类别</span>
              </button>
            )}
          </div>
        </aside>

        <main className="fig-main">
          {/* Workspace Header & Toolbar */}
          <div className="fig-toolbar">
            <div className="fig-workspace-head">
              <div className="fig-workspace-title-group">
                <h1 className="fig-view-title">{viewTitle}</h1>
                <span className="fig-view-count">{loading ? '…' : items.length}</span>
              </div>

              <div className="fig-workspace-actions">
                {filters.trash === 'only' && counts.trash > 0 && (
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void emptyTrash()}>
                    清空回收站
                  </button>
                )}

                {filters.trash !== 'only' && items.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-subtle btn-sm fig-desktop-only"
                    title="专注处理 (F)"
                    onClick={() => setFocusMode(true)}
                  >
                    <AppIcon name="focus" size={14} />
                    <span>专注处理</span>
                  </button>
                )}

                <button
                  type="button"
                  className={`btn btn-subtle btn-sm${selectionMode ? ' is-active' : ''}`}
                  onClick={() => {
                    if (selectionMode) exitSelection()
                    else setSelectionMode(true)
                  }}
                >
                  <AppIcon name="select" size={14} />
                  <span>{selectionMode ? '退出选择' : '批量选择'}</span>
                </button>

                <div className="fig-view-switch" role="group" aria-label="视图模式">
                  <button
                    type="button"
                    className={`fig-view-switch-btn${viewMode === 'list' ? ' is-active' : ''}`}
                    aria-label="精炼列表视图"
                    aria-pressed={viewMode === 'list'}
                    title="精炼列表 (1)"
                    onClick={() => changeViewMode('list')}
                  >
                    <AppIcon name="list" size={15} />
                  </button>
                  <button
                    type="button"
                    className={`fig-view-switch-btn${viewMode === 'gallery' ? ' is-active' : ''}`}
                    aria-label="4列画廊视图"
                    aria-pressed={viewMode === 'gallery'}
                    title="4列画廊 (2)"
                    onClick={() => changeViewMode('gallery')}
                  >
                    <AppIcon name="grid" size={15} />
                  </button>
                  <button
                    type="button"
                    className={`fig-view-switch-btn${viewMode === 'coverflow' ? ' is-active' : ''}`}
                    aria-label="专辑封面视图"
                    aria-pressed={viewMode === 'coverflow'}
                    title="专辑封面 (3)"
                    onClick={() => changeViewMode('coverflow')}
                  >
                    <AppIcon name="album" size={15} />
                  </button>
                </div>
              </div>
            </div>

            <div className="fig-filter-bar">
              <div className="fig-type-pills" role="group" aria-label="内容类型筛选">
                {(
                  [
                    { key: 'all', label: '全部' },
                    { key: 'link', label: '网页' },
                    { key: 'text', label: '文本' },
                    { key: 'image_group', label: '图片' }
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`pill${filters.kind === tab.key ? ' is-active' : ''}`}
                    onClick={() => setFilters((current) => ({ ...current, kind: tab.key }))}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="fig-filter-controls">
                {filters.category && filters.trash === 'active' && (
                  <select
                    className="select fig-sort-select"
                    aria-label="状态筛选"
                    value={filters.status}
                    onChange={(event) => setFilters((current) => ({
                      ...current,
                      status: event.target.value as ItemFilters['status']
                    }))}
                  >
                    <option value="pending">待处理</option>
                    <option value="completed">已完成</option>
                    <option value="all">全部状态</option>
                  </select>
                )}

                <select
                  className="select fig-sort-select"
                  aria-label="排序方式"
                  value={filters.sort}
                  onChange={(event) => setFilters((current) => ({
                    ...current,
                    sort: event.target.value as ItemFilters['sort']
                  }))}
                >
                  <option value="smart">智能排序</option>
                  <option value="newest">最新保存</option>
                  <option value="oldest">最早保存</option>
                  <option value="planned_date">计划日期</option>
                  <option value="recently_completed">最近完成</option>
                </select>

              </div>
            </div>

            {filterChips.length > 0 && (
              <div className="fig-filter-summary" role="status" aria-live="polite" aria-label="当前筛选">
                {filterChips.map((chip) => (
                  <span key={chip.key} className="fig-filter-chip">
                    <span>{chip.label}</span>
                    <button
                      type="button"
                      className="fig-filter-chip-x"
                      aria-label={`移除筛选：${chip.label}`}
                      onClick={chip.clear}
                    >
                      <AppIcon name="close" size={11} />
                    </button>
                  </span>
                ))}
                <span className="fig-view-count" aria-hidden="true">
                  {loading ? '…' : `${items.length} / ${viewTotal} 项`}
                </span>
                <button type="button" className="fig-filter-reset" onClick={() => resetFilters()}>
                  重置筛选
                </button>
              </div>
            )}
          </div>

          {activeDraft && (
            <div className="notice notice-info fig-draft-banner" role="status">
              <span>发现一份未完成的草稿，可继续编辑或丢弃。</span>
              <div className="fig-draft-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void restoreActiveDraft()}>
                  恢复草稿
                </button>
                <button type="button" className="btn btn-text btn-sm" onClick={() => void discardActiveDraft()}>
                  丢弃
                </button>
              </div>
            </div>
          )}

          {error && <div className="notice notice-error" role="alert">{error}</div>}

          {!loading && !items.length && (
            viewTotal === 0 ? (
              filters.trash === 'only' ? (
                <EmptyState
                  title="回收站是空的"
                  description="删除的内容会在这里保留 7 天，期间随时可以一键恢复。"
                  action={
                    <button type="button" className="btn btn-ghost" onClick={() => selectQuickView('pending')}>
                      返回清单
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  title="开始收集你的稍后阅读"
                  description="在页面任意处直接 Ctrl+V 粘贴网址、文字或图片，或点击右上角“+ 添加”。"
                  action={
                    <button type="button" className="btn btn-primary" onClick={() => setOverlay({ type: 'smart-add' })}>
                      <AppIcon name="plus" size={15} />快速添加
                    </button>
                  }
                />
              )
            ) : (
              <EmptyState
                title="当前视图没有匹配内容"
                description="尝试切换筛选条件、清空搜索关键词，或查看全部条目。"
                action={
                  <div className="fig-empty-actions">
                    <button type="button" className="btn btn-primary" onClick={() => resetFilters()}>
                      清除筛选
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => resetFilters(true)}>
                      查看全部
                    </button>
                  </div>
                }
              />
            )
          )}

          <div className="fig-view-stage" key={viewMode} data-view={viewMode}>
          {items.length > 0 && viewMode === 'coverflow' ? (
            <CoverFlowView
              items={items}
              categories={categories}
              generatingIds={generatingCoverIds}
              aiCoverConfigured={aiCoverConfigured}
              onPatch={patchItem}
              onEdit={(item) => setOverlay({ type: 'edit', item })}
              onDelete={deleteItem}
              onGenerateCover={(item) => generateItemCover(item)}
              onPreview={(assets, index) => setOverlay({ type: 'lightbox', assets, index })}
              onOpenAiSettings={() => setOverlay({ type: 'account' })}
              now={now}
            />
          ) : (
            <div className="fig-groups">
              {groups.map((group) => (
                <section key={group.key} className="fig-group" data-group-key={group.key}>
                  <header className="fig-group-head">
                    <h2>{group.label}</h2>
                    <span className="fig-group-count">{group.items.length}</span>
                  </header>
                  {group.dateGroups ? (
                    <div className="fig-subgroups">
                      {group.dateGroups.map((dateGroup) => (
                        <section key={dateGroup.key} className="fig-subgroup">
                          <h3 className="fig-subgroup-head">
                            <time dateTime={dateGroup.date}>{dateGroup.label}</time>
                          </h3>
                          {renderItems(dateGroup.items)}
                        </section>
                      ))}
                    </div>
                  ) : renderItems(group.items)}
                </section>
              ))}
            </div>
          )}
          </div>
        </main>
      </div>

      {/* Floating Bulk Action Pill Bar */}
      {selectionMode && (
        <div className="fig-bulk-bar" role="toolbar" aria-label="批量操作">
          <span className="fig-bulk-count">已选 <strong>{selectedIds.size}</strong></span>
          <button
            type="button"
            className="btn btn-text btn-sm"
            disabled={!items.length || bulkBusy}
            onClick={() => setSelectedIds(new Set(items.map((item) => item.id)))}
          >
            全选
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="btn btn-text btn-sm"
              disabled={bulkBusy}
              onClick={() => setSelectedIds(new Set())}
            >
              清空
            </button>
          )}
          <span className="fig-bulk-divider" aria-hidden="true" />
          {filters.trash === 'only' ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!selectedIds.size || bulkBusy}
                onClick={() => void runBulkRestore()}
              >
                <AppIcon name="restore" size={14} />恢复
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={!selectedIds.size || bulkBusy}
                onClick={() => void runBulkPermanentDelete()}
              >
                彻底删除
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!selectedIds.size || bulkBusy}
                onClick={() => void runBulk({ status: 'completed' }, '已批量完成')}
              >
                完成
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={!selectedIds.size || bulkBusy}
                onClick={() => void runBulk({ status: 'pending' }, '已批量恢复待处理')}
              >
                待处理
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={!selectedIds.size || bulkBusy}
                onClick={() => void runBulk({ isStarred: true }, '已批量加星标')}
              >
                <AppIcon name="star" size={14} />星标
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={!selectedIds.size || bulkBusy || !bulkCanSchedule}
                onClick={(event) => {
                  setBulkScheduleAnchor(event.currentTarget)
                  setBulkScheduleOpen(true)
                }}
              >
                <AppIcon name="calendar" size={14} />计划
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={!selectedIds.size || bulkBusy}
                onClick={(event) => {
                  setBulkCatAnchor(event.currentTarget)
                  setBulkCatOpen(true)
                }}
              >
                <AppIcon name="folder" size={14} />改类别
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={!selectedIds.size || bulkBusy}
                onClick={() => void runBulkDelete()}
              >
                <AppIcon name="trash" size={14} />删除
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-icon btn-sm"
            aria-label="退出批量选择"
            onClick={exitSelection}
          >
            <AppIcon name="close" size={15} />
          </button>
        </div>
      )}

      {/* Undo Delete Bar */}
      {undoDelete && (
        <div className="fig-undo-bar" role="status" aria-live="polite">
          <span>{undoDelete.label}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void undoLastDelete()}>
            撤销
          </button>
          <button
            type="button"
            className="btn btn-icon btn-sm"
            aria-label="关闭撤销提示"
            onClick={() => setUndoDelete(null)}
          >
            <AppIcon name="close" size={14} />
          </button>
        </div>
      )}

      {/* Mobile Single-Hand Bottom Nav (<900px) */}
      <nav className="fig-bottom-nav" aria-label="移动端主导航">
        <button
          type="button"
          className={`fig-bottom-item${activeNavTab === 'list' && !mobileMoreOpen ? ' is-active' : ''}`}
          onClick={() => {
            selectQuickView('pending')
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        >
          <AppIcon name="inbox" size={20} />
          <span>清单</span>
        </button>
        <button
          type="button"
          className={`fig-bottom-item${activeNavTab === 'plan' && !mobileMoreOpen ? ' is-active' : ''}`}
          onClick={() => selectQuickView('planned')}
        >
          <AppIcon name="calendar" size={20} />
          <span>计划</span>
        </button>
        <button
          type="button"
          className="fig-bottom-item fig-bottom-add"
          aria-label="快速添加"
          onClick={() => {
            setMobileMoreOpen(false)
            setOverlay({ type: 'smart-add' })
          }}
        >
          <span className="fig-bottom-add-pill">
            <AppIcon name="plus" size={20} />
          </span>
          <span>添加</span>
        </button>
        <button
          type="button"
          className={`fig-bottom-item${memoOpen ? ' is-active' : ''}`}
          onClick={() => {
            setMobileMoreOpen(false)
            setMemoOpen(true)
          }}
        >
          <AppIcon name="memo" size={20} />
          <span>备忘录</span>
        </button>
        <button
          type="button"
          className={`fig-bottom-item${mobileMoreOpen ? ' is-active' : ''}`}
          onClick={() => setMobileMoreOpen((value) => !value)}
        >
          <span className="fig-bottom-icon-wrap">
            <AppIcon name="more" size={20} />
            {queuedCount > 0 && <span className="fig-bottom-badge">{queuedCount}</span>}
          </span>
          <span>更多</span>
        </button>
      </nav>

      {/* Mobile "更多" Bottom Sheet */}
      <MobileBottomSheet open={mobileMoreOpen} title="更多与工具" onClose={() => setMobileMoreOpen(false)}>
        <div className="fig-sheet-list">
          <div className="fig-sheet-section-title">快速视图</div>
          <button type="button" className="fig-sheet-row" onClick={() => selectQuickView('today')}>
            <AppIcon name="calendar" size={17} />
            <span>今日与逾期</span>
            <span className="fig-mono">{counts.todayOverdue}</span>
          </button>
          <button type="button" className="fig-sheet-row" onClick={() => selectQuickView('starred')}>
            <AppIcon name="star" size={17} />
            <span>星标</span>
            <span className="fig-mono">{counts.starred}</span>
          </button>
          <button type="button" className="fig-sheet-row" onClick={() => selectQuickView('completed')}>
            <AppIcon name="checkCircle" size={17} />
            <span>已完成</span>
            <span className="fig-mono">{counts.completed}</span>
          </button>
          <button type="button" className="fig-sheet-row" onClick={() => selectQuickView('trash')}>
            <AppIcon name="trash" size={17} />
            <span>回收站</span>
            <span className="fig-mono">{counts.trash}</span>
          </button>

          <div className="fig-sheet-section-title">效率与工具</div>
          <button
            type="button"
            className="fig-sheet-row"
            onClick={() => {
              setMobileMoreOpen(false)
              onOpenBlog?.({ path: '/' })
            }}
          >
            <AppIcon name="book" size={17} />
            <span>个人博客（朋友圈）</span>
          </button>
          <button
            type="button"
            className="fig-sheet-row"
            disabled={!items.length || filters.trash === 'only'}
            onClick={() => {
              setMobileMoreOpen(false)
              setFocusMode(true)
            }}
          >
            <AppIcon name="focus" size={17} />
            <span>晚间专注处理</span>
          </button>
          <button type="button" className="fig-sheet-row" onClick={() => void readClipboardAndSave()}>
            <AppIcon name="copy" size={17} />
            <span>识别剪贴板并保存</span>
          </button>
          <button
            type="button"
            className="fig-sheet-row"
            onClick={() => {
              setMobileMoreOpen(false)
              setOverlay({ type: 'categories' })
            }}
          >
            <AppIcon name="folder" size={17} />
            <span>类别管理</span>
          </button>
          <button
            type="button"
            className="fig-sheet-row"
            onClick={() => {
              setMobileMoreOpen(false)
              setOverlay({ type: 'backup' })
            }}
          >
            <AppIcon name="download" size={17} />
            <span>数据备份与恢复</span>
          </button>
          <button
            type="button"
            className="fig-sheet-row"
            onClick={() => {
              setMobileMoreOpen(false)
              setOverlay({ type: 'sync' })
            }}
          >
            <AppIcon name="sync" size={17} />
            <span>离线缓存管理</span>
            {queuedCount > 0 && <span className="fig-mono">{queuedCount}</span>}
          </button>
          <button
            type="button"
            className="fig-sheet-row"
            onClick={() => {
              setMobileMoreOpen(false)
              setOverlay({ type: 'bookmarklet' })
            }}
          >
            <AppIcon name="bookmark" size={17} />
            <span>书签按钮</span>
          </button>
          <button
            type="button"
            className="fig-sheet-row"
            onClick={() => {
              setMobileMoreOpen(false)
              setOverlay({ type: 'account' })
            }}
          >
            <AppIcon name="settings" size={17} />
            <span>账号设置</span>
          </button>
          <button
            type="button"
            className="fig-sheet-row is-danger"
            onClick={() => {
              setMobileMoreOpen(false)
              void logout()
            }}
          >
            <AppIcon name="logout" size={17} />
            <span>退出登录</span>
          </button>
        </div>
      </MobileBottomSheet>

      {/* Bulk Popovers */}
      <SchedulePicker
        open={bulkScheduleOpen}
        anchor={bulkScheduleAnchor}
        value={bulkPlannedFor}
        title={`为已选 ${selectedIds.size} 条安排日期`}
        busy={bulkBusy}
        clearDisabled={!selectedIds.size || !bulkHasPlanned}
        onSelect={(date) => runBulk({ plannedFor: date }, `已批量安排 ${plannedDateLabel(date)}处理`)}
        onClear={() => runBulk({ plannedFor: null }, '已批量取消计划')}
        onClose={() => setBulkScheduleOpen(false)}
      />

      <CategoryPickerPopover
        open={bulkCatOpen}
        anchor={bulkCatAnchor}
        categories={categories}
        selectedId={null}
        busy={bulkBusy}
        onSelect={(categoryId) => runBulk({ categoryId }, '类别已批量更新')}
        onCreateCategory={createCategory}
        onClose={() => setBulkCatOpen(false)}
      />

      {/* Modals & Overlays */}
      {overlay?.type === 'smart-add' && (
        <SmartAddModal
          categories={categories}
          defaultCategoryId={preferences.quickSaveCategoryId}
          aiCoverAuto={Boolean(preferences.aiCoverAuto && preferences.aiImageApiKeySet)}
          initial={overlay.initial}
          onCreateCategory={createCategory}
          onSaved={(saved) => void itemSaved(saved, true)}
          onDuplicate={(id) => void openDuplicate(id)}
          onClose={() => {
            setActiveDraft(readActiveDraft())
            setOverlay(null)
          }}
        />
      )}

      {overlay?.type === 'edit' && (
        <Modal title="编辑条目" onClose={closeEditor} wide>
          <EditItemForm
            item={overlay.item}
            categories={categories}
            onCreateCategory={createCategory}
            onClose={() => {
              setActiveDraft(null)
              closeEditor()
            }}
            onSaved={() => void itemSaved()}
            onPreview={(assets, index) => setOverlay({ type: 'lightbox', assets, index })}
          />
        </Modal>
      )}

      {overlay?.type === 'categories' && (
        <CategoriesManager
          categories={categories}
          onClose={() => setOverlay(null)}
          onChanged={reloadAll}
        />
      )}

      {overlay?.type === 'account' && (
        <AccountManager
          email={userEmail}
          categories={categories}
          onChanged={reloadAll}
          onPreferencesChange={setPreferences}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay?.type === 'backup' && (
        <Modal title="数据备份与恢复" onClose={() => setOverlay(null)} wide>
          <BackupManager onRestored={reloadAll} />
        </Modal>
      )}

      {overlay?.type === 'sync' && (
        <OfflineManagerModal onChanged={reloadAll} onClose={() => setOverlay(null)} />
      )}

      {overlay?.type === 'bookmarklet' && (
        <BookmarkletHelp onClose={() => setOverlay(null)} />
      )}

      {overlay?.type === 'lightbox' && (
        <Lightbox
          assets={overlay.assets}
          initialIndex={overlay.index}
          onClose={() => setOverlay(null)}
        />
      )}

      {focusMode && (
        <FocusMode
          items={items}
          categories={categories}
          now={now}
          onClose={() => setFocusMode(false)}
          onPatch={patchItem}
          onEdit={(item) => setOverlay({ type: 'edit', item })}
          onDelete={deleteItem}
          onPreview={(assets, index) => setOverlay({ type: 'lightbox', assets, index })}
          generatingIds={generatingCoverIds}
          aiCoverConfigured={aiCoverConfigured}
          onGenerateCover={(item) => generateItemCover(item)}
          onOpenAiSettings={() => setOverlay({ type: 'account' })}
        />
      )}

      {memoOpen && (
        <MemoErrorBoundary onClose={() => setMemoOpen(false)}>
          <Suspense
            fallback={
              <div className="memo-canvas-overlay">
                <div className="memo-canvas-loading">
                  <span className="spinner" />
                  <p>正在加载备忘录画布…</p>
                </div>
              </div>
            }
          >
            <MemoCanvas
              items={allItems}
              categories={categories}
              onClose={() => setMemoOpen(false)}
              onEdit={(item) => setOverlay({ type: 'edit', item })}
              onPatch={patchItem}
              onDelete={deleteItem}
              onRestore={restoreItem}
              onPermanentDelete={permanentDeleteItem}
              onPreview={(assets, index) => setOverlay({ type: 'lightbox', assets, index })}
              onRefresh={reloadAll}
            />
          </Suspense>
        </MemoErrorBoundary>
      )}
    </div>
  )
}
