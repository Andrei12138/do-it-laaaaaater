import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactNode
} from 'react'
import {
  Button,
  Card,
  Divider,
  Drawer,
  Footer,
  Input,
  Select,
  Tabs,
  Tag,
  Title
} from 'animal-island-ui'
import islandBag from 'animal-island-ui/items/item-022.png'
import { ApiRequestError, api, errorMessage, jsonRequest } from '../api'
import { addChinaDays, chinaToday, plannedDateLabel, plannedState, smartPriority } from '../china-date'
import { discardDraft, readActiveDraft, type ActiveDraft } from '../draft-store'
import { itemAgeLabel } from '../item-age'
import { filterLibraryItems } from '../offline-query'
import {
  flushOfflineQueue,
  getOfflineQueueSummaries,
  useOfflineRuntime
} from '../offline-store'
import { useSyncStatus } from '../sync-status'
import { getThemeDefinition, useTheme, type ThemeId } from '../theme'
import type {
  Category,
  AppPreferences,
  BulkItemChanges,
  ImageAsset,
  ItemFilters,
  LibraryItem
} from '../types'
import { validateImageFiles } from './FormFields'
import { FocusMode } from './FocusMode'
import { AppIcon, type AppIconName } from './AppIcon'
import { EditItemForm, ImageGroupForm, LinkForm, TextItemForm } from './ItemForms'
import {
  AccountManager,
  BookmarkletHelp,
  CategoriesManager,
  Lightbox
} from './ManagementModals'
import { EmptyState, Modal } from './Modal'
import { ThemeControl } from './ThemeControl'
import { showThemeNotification } from './ThemeNotification'
import { OfflineManagerModal } from './OfflineManager'

type Overlay =
  | { type: 'link'; initial?: { url?: string; title?: string } }
  | { type: 'text'; initialText: string }
  | { type: 'images'; files: File[] }
  | { type: 'edit'; item: LibraryItem }
  | { type: 'categories' }
  | { type: 'account' }
  | { type: 'bookmarklet' }
  | { type: 'sync' }
  | { type: 'lightbox'; assets: ImageAsset[]; index: number }
  | null

type MobilePanel = 'filters' | 'add' | 'more' | null

function MobileActionSheet({
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
  const { theme } = useTheme()

  useEffect(() => {
    if (!open || theme === 'animal-island') return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open, theme])

  if (theme === 'animal-island') {
    return (
      <Drawer
        open={open}
        title={title}
        placement="bottom"
        height="min(78dvh, 620px)"
        pushBackground={false}
        className="mobile-action-drawer"
        onClose={onClose}
      >
        {children}
      </Drawer>
    )
  }
  if (!open) return null
  return (
    <div className="flat-mobile-sheet" role="presentation">
      <button type="button" className="flat-mobile-sheet-mask" aria-label="关闭" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-label={title} className="flat-mobile-sheet-panel">
        <header><h2>{title}</h2><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
        {children}
      </section>
    </div>
  )
}

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

const SORT_STORAGE_KEY = 'do-it-laaaaaater.item-sort.v1'

function initialFilters(): ItemFilters {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY)
    if (saved === 'smart' || saved === 'newest' || saved === 'oldest' || saved === 'recently_completed' || saved === 'planned_date') {
      return { ...defaultFilters, sort: saved }
    }
  } catch {
    // Smart sorting remains the safe default when browser storage is disabled.
  }
  return { ...defaultFilters }
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

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp))
}

function hostLabel(url: string | null) {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function asWebUrl(value: string) {
  let candidate = value.trim().replace(/^[<（(【[]+/, '').replace(/[>）)】\],，。.!！?？;；:：]+$/, '')
  if (/^www\./i.test(candidate)) candidate = 'https://' + candidate
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+(?:[/:?#].*)?$/i.test(candidate)) {
      candidate = 'https://' + candidate
    } else {
      return ''
    }
  }
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function shortPastedTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 300)
}

function overlayFromTextTransfer(data: DataTransfer): Overlay {
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
      const document = new DOMParser().parseFromString(html, 'text/html')
      const anchor = document.querySelector<HTMLAnchorElement>('a[href]')
      if (anchor) {
        htmlUrl = anchor.getAttribute('href') || ''
        htmlTitle = shortPastedTitle(anchor.textContent || '')
      }
    } catch {
      // Fall back to the plain-text clipboard value.
    }
  }

  const embedded = plain.match(/https?:\/\/[^\s<>"']+/i)?.[0] || ''
  const url = asWebUrl(uriList) || asWebUrl(htmlUrl) || asWebUrl(plain) || asWebUrl(embedded)
  if (url) {
    let title = htmlTitle
    if (!title && plain && !asWebUrl(plain)) {
      title = shortPastedTitle(embedded ? plain.replace(embedded, ' ') : plain)
    }
    return { type: 'link', initial: { url, title } }
  }
  return plain ? { type: 'text', initialText: plain } : null
}

function itemManualAssets(item: LibraryItem) {
  return item.assets.filter((asset) => asset.role !== 'web_cover')
}

function notifySuccess(message: string) {
  showThemeNotification('success', message)
}

function notifyError(message: string) {
  showThemeNotification('error', message)
}

interface FilterOption {
  key: string
  label: string
}

function ThemeFilterSelect({
  theme,
  ariaLabel,
  value,
  options,
  onChange
}: {
  theme: ThemeId
  ariaLabel: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}) {
  if (theme === 'flat-2013') {
    return (
      <select
        className="flat-filter-select"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.key || '__all__'} value={option.key}>{option.label}</option>
        ))}
      </select>
    )
  }

  return (
    <Select
      aria-label={ariaLabel}
      value={value}
      options={options}
      onChange={onChange}
    />
  )
}

function ItemCard({
  item,
  categories,
  selectionMode,
  trashMode,
  selected,
  busy,
  retry,
  onEdit,
  onPatch,
  onSelect,
  onDelete,
  onRestore,
  onPermanentDelete,
  onPreview,
  now
}: {
  item: LibraryItem
  categories: Category[]
  selectionMode: boolean
  trashMode: boolean
  selected: boolean
  busy: boolean
  retry?: { changes: BulkItemChanges; label: string }
  onEdit: () => void
  onPatch: (changes: BulkItemChanges, label: string) => Promise<boolean>
  onSelect: (selected: boolean) => void
  onDelete: () => Promise<boolean>
  onRestore: () => Promise<boolean>
  onPermanentDelete: () => Promise<boolean>
  onPreview: (assets: ImageAsset[], index: number) => void
  now: number
}) {
  const { theme } = useTheme()
  const webCover = item.assets.find((asset) => asset.role === 'web_cover')
  const manual = itemManualAssets(item)
  const cover = item.kind === 'link'
    ? (webCover || manual[0])
    : item.kind === 'image_group'
      ? manual[0]
      : undefined
  const previewAssets = item.kind === 'link'
    ? (webCover ? [webCover] : manual)
    : item.kind === 'image_group'
      ? manual
      : []
  const kindLabel = item.kind === 'link' ? '网页' : item.kind === 'text' ? '文本' : '图片'
  const kindIcon: AppIconName = item.kind === 'link' ? 'link' : item.kind === 'text' ? 'text' : 'image'
  const plan = plannedState(item.plannedFor)
  const [planMenuOpen, setPlanMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const trashDaysLeft = item.trashedAt
    ? Math.max(0, Math.ceil((item.trashedAt + 7 * 24 * 60 * 60 * 1000 - now) / (24 * 60 * 60 * 1000)))
    : 0
  const categoryStyle = {
    '--category-color': item.category?.color || 'transparent'
  } as CSSProperties

  return (
    <article
      className={`item-card-shell${selectionMode ? ' is-selection-mode' : ''}${selected ? ' is-selected' : ''}${trashMode ? ' is-trash-item' : ''}`}
      style={categoryStyle}
    >
      <Card
        className={cover ? 'item-card has-cover' : 'item-card'}
        pattern="default"
        inert={selectionMode}
      >
        {cover && (
          <button
            type="button"
            className="card-cover"
            onClick={() => onPreview(previewAssets, 0)}
            aria-label={'查看' + item.title + '的图片'}
          >
            <img src={cover.thumbUrl} alt="" loading="lazy" />
            {item.kind === 'image_group' && manual.length > 1 && (
              <span className="image-count">{manual.length} 张</span>
            )}
          </button>
        )}
        <div className="item-content">
          <div className="item-heading">
            <Tag
              size="small"
              color={item.status === 'pending' ? 'app-yellow' : 'app-green'}
              className="status-tag"
            >
              {item.status === 'pending' ? '待处理' : '已完成'}
            </Tag>
            <Tag size="small" color="app-teal" variant="outlined" className="kind-tag">
              <AppIcon name={kindIcon} size={18} />
              <span className="kind-tag-label">{kindLabel}</span>
            </Tag>
            {item.isStarred && (
              <Tag size="small" color="app-yellow" className="priority-tag">
                <AppIcon name="star" size={15} />星标
              </Tag>
            )}
            {plan === 'overdue' && <Tag size="small" color="app-red" className="priority-tag">逾期</Tag>}
            {plan === 'today' && <Tag size="small" color="app-teal" className="priority-tag">今天</Tag>}
            {plan === 'future' && <Tag size="small" color="app-teal" variant="outlined" className="priority-tag">{plannedDateLabel(item.plannedFor)}</Tag>}
            {trashMode && <Tag size="small" color="app-red" variant="outlined" className="priority-tag">还可恢复 {trashDaysLeft} 天</Tag>}
            <span className={`item-age item-age-${item.status}`}>{itemAgeLabel(item, now)}</span>
            <time>{timeLabel(item.createdAt)}</time>
          </div>
          <h3>
            {item.kind === 'link' && item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
            ) : item.kind === 'image_group' ? (
              <button type="button" className="title-button" onClick={() => {
                if (manual.length) onPreview(manual, 0)
              }}>
                {item.title}
              </button>
            ) : (
              <span>{item.title}</span>
            )}
          </h3>
          {item.url && <p className="item-host" title={item.url}>{hostLabel(item.url)}</p>}
          <div className="item-meta">
            <span className="category-color-key" aria-hidden="true" style={{ backgroundColor: item.category?.color || '#95a5a6' }} />
            <label className="card-category-field">
              <span className="visually-hidden">修改类别</span>
              {theme === 'animal-island' ? (
                <Select
                  aria-label={'修改“' + item.title + '”的类别'}
                  value={item.category?.id || ''}
                  disabled={busy}
                  options={[
                    { key: '', label: '未分类' },
                    ...categories.map((category) => ({ key: category.id, label: category.name }))
                  ]}
                  onChange={(value) => void onPatch({ categoryId: value || null }, '类别已更新')}
                />
              ) : (
                <select
                  aria-label={'修改“' + item.title + '”的类别'}
                  value={item.category?.id || ''}
                  disabled={busy}
                  onChange={(event) => void onPatch({ categoryId: event.target.value || null }, '类别已更新')}
                >
                  <option value="">未分类</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              )}
            </label>
            {item.kind === 'link' && manual.length > 0 && (
              <button type="button" className="text-button" onClick={() => onPreview(manual, 0)}>
                {manual.length} 张截图
              </button>
            )}
          </div>
          <div className="item-actions">
            {trashMode ? (
              <>
                <Button
                  size="small"
                  type="primary"
                  disabled={busy}
                  icon={<AppIcon name="restore" size={17} />}
                  onClick={() => void onRestore()}
                >
                  恢复
                </Button>
                <Button
                  size="small"
                  danger
                  disabled={busy}
                  icon={<AppIcon name="delete" size={17} />}
                  onClick={() => void onPermanentDelete()}
                >
                  彻底删除
                </Button>
              </>
            ) : (
              <>
            <span className="card-action-mobile">
              {item.kind === 'link' && item.url ? (
                <a className="button button-primary button-small" href={item.url} target="_blank" rel="noreferrer">
                  <AppIcon name="open" size={17} />打开
                </a>
              ) : (
                <button type="button" className="button button-primary button-small" onClick={() => {
                  if (item.kind === 'image_group' && manual.length) onPreview(manual, 0)
                  else onEdit()
                }}>
                  <AppIcon name={item.kind === 'image_group' ? 'image' : 'open'} size={17} />查看
                </button>
              )}
            </span>
            <Button
              size="small"
              type="primary"
              disabled={busy}
              icon={<AppIcon name={item.status === 'pending' ? 'complete' : 'restore'} size={17} />}
              onClick={() => void onPatch(
                { status: item.status === 'pending' ? 'completed' : 'pending' },
                item.status === 'pending' ? '已标记完成' : '已恢复待处理'
              )}
            >
              {item.status === 'pending' ? '标记完成' : '恢复待处理'}
            </Button>
            <Button
              size="small"
              disabled={busy}
              className={`card-action-secondary${item.isStarred ? ' is-active' : ''}`}
              icon={<AppIcon name="star" size={17} />}
              onClick={() => void onPatch({ isStarred: !item.isStarred }, item.isStarred ? '已取消星标' : '已加星标')}
            >
              {item.isStarred ? '取消星标' : '星标'}
            </Button>
            <Button
              size="small"
              disabled={busy || item.status === 'completed'}
              className={`card-action-secondary${item.plannedFor ? ' is-active' : ''}`}
              icon={<AppIcon name="today" size={17} />}
              onClick={() => setPlanMenuOpen((value) => !value)}
            >
              {item.plannedFor ? '计划 ' + plannedDateLabel(item.plannedFor) : '安排处理'}
            </Button>
            <Button className="card-action-secondary" size="small" disabled={busy} icon={<AppIcon name="edit" size={17} />} onClick={onEdit}>编辑</Button>
            <Button className="card-action-secondary" size="small" disabled={busy} danger icon={<AppIcon name="delete" size={17} />} onClick={() => void onDelete()}>删除</Button>
            <Button
              className="card-action-mobile card-more-trigger"
              size="small"
              disabled={busy}
              icon={<AppIcon name="more" size={18} />}
              onClick={() => setMoreOpen((value) => !value)}
            >更多</Button>
            {planMenuOpen && (
              <div className="card-plan-menu" role="menu" aria-label="安排处理时间">
                <button type="button" onClick={() => { setPlanMenuOpen(false); void onPatch({ plannedFor: chinaToday() }, '已安排今天处理') }}>今天</button>
                <button type="button" onClick={() => { setPlanMenuOpen(false); void onPatch({ plannedFor: addChinaDays(1) }, '已安排明天处理') }}>明天</button>
                <button type="button" onClick={() => { setPlanMenuOpen(false); void onPatch({ plannedFor: addChinaDays(7) }, '已安排一周后处理') }}>一周后</button>
                <button type="button" disabled={!item.plannedFor} onClick={() => { setPlanMenuOpen(false); void onPatch({ plannedFor: null }, '已清除处理计划') }}>清除计划</button>
              </div>
            )}
            {moreOpen && (
              <div className="card-more-menu" role="menu" aria-label="更多条目操作">
                <button type="button" onClick={() => { setMoreOpen(false); void onPatch({ isStarred: !item.isStarred }, item.isStarred ? '已取消星标' : '已加星标') }}>{item.isStarred ? '取消星标' : '加星标'}</button>
                <button type="button" disabled={item.status === 'completed'} onClick={() => { setMoreOpen(false); setPlanMenuOpen(true) }}>安排处理</button>
                <button type="button" onClick={() => { setMoreOpen(false); onEdit() }}>编辑</button>
                <button type="button" className="danger-text" onClick={() => { setMoreOpen(false); void onDelete() }}>移到回收站</button>
              </div>
            )}
              </>
            )}
          </div>
          {retry && (
            <div className="card-retry" role="alert">
              <span>刚才的修改没有保存。</span>
              <button type="button" className="small-button" disabled={busy} onClick={() => void onPatch(retry.changes, retry.label)}>
                <AppIcon name="retry" size={16} />重试
              </button>
            </div>
          )}
        </div>
      </Card>
      {selectionMode && (
        <button
          type="button"
          className="item-card-selection-toggle"
          aria-label={(selected ? '取消选择“' : '选择“') + item.title + '”'}
          aria-pressed={selected}
          onClick={() => onSelect(!selected)}
        >
          <span className="visually-hidden">{selected ? '再次点击取消选择' : '点击整张卡片选择'}</span>
        </button>
      )}
    </article>
  )
}

export function Dashboard({
  userEmail,
  onSessionChange
}: {
  userEmail: string
  onSessionChange: () => Promise<void>
}) {
  const { theme } = useTheme()
  const themeDefinition = getThemeDefinition(theme)
  const [categories, setCategories] = useState<Category[]>([])
  const [allItems, setAllItems] = useState<LibraryItem[]>([])
  const [preferences, setPreferences] = useState<AppPreferences>({ quickSaveCategoryId: null })
  const [filters, setFilters] = useState<ItemFilters>(initialFilters)
  const items = useMemo(() => filterLibraryItems(allItems, filters), [allItems, filters])
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [busyItems, setBusyItems] = useState<Set<string>>(() => new Set())
  const [retryItems, setRetryItems] = useState<Record<string, { changes: BulkItemChanges; label: string }>>({})
  const [focusMode, setFocusMode] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null)
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false)
  const [undoDelete, setUndoDelete] = useState<{ ids: string[]; label: string } | null>(null)
  const [activeDraft, setActiveDraft] = useState<ActiveDraft | null>(() => readActiveDraft())
  const syncStatus = useSyncStatus()
  const offlineState = useOfflineRuntime()
  const requestNumber = useRef(0)

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

  const refreshItems = useCallback(async () => {
    const currentRequest = ++requestNumber.current
    setLoading(true)
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

  useEffect(() => {
    void refreshReferences().catch((requestError) => setError(errorMessage(requestError)))
  }, [refreshReferences])

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
    void refreshItems()
  }, [refreshItems])

  useEffect(() => {
    const synced = () => {
      void Promise.all([refreshReferences(), refreshItems()])
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
    try {
      localStorage.setItem(SORT_STORAGE_KEY, filters.sort)
    } catch {
      // Sorting still works for the current tab.
    }
  }, [filters.sort])

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => items.some((item) => item.id === id))))
  }, [items])

  useEffect(() => {
    if (!undoDelete) return
    const timer = window.setTimeout(() => setUndoDelete(null), 10_000)
    return () => window.clearTimeout(timer)
  }, [undoDelete])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('add') === 'link' && params.get('url')) {
      setOverlay({
        type: 'link',
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
          setFilters((current) => ({ ...current, trash: 'only', status: 'all' }))
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
  }, [])

  useEffect(() => {
    function editableTarget(target: EventTarget | null) {
      const element = target as HTMLElement | null
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'))
    }
    function handlePaste(event: ClipboardEvent) {
      if (overlay || editableTarget(event.target)) return
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
      if (files.length) {
        event.preventDefault()
        const result = validateImageFiles(files)
        if (result.error) notifyError(result.error)
        if (result.accepted.length) setOverlay({ type: 'images', files: result.accepted })
        return
      }
      if (!event.clipboardData) return
      const nextOverlay = overlayFromTextTransfer(event.clipboardData)
      if (nextOverlay) {
        event.preventDefault()
        setOverlay(nextOverlay)
      }
    }
    function handleDragOver(event: DragEvent) {
      if (!overlay && event.dataTransfer?.types.some((type) => (
        type === 'Files' || type === 'text/plain' || type === 'text/uri-list'
      ))) event.preventDefault()
    }
    function handleDrop(event: DragEvent) {
      if (overlay) return
      const files = Array.from(event.dataTransfer?.files || [])
      if (files.length) {
        event.preventDefault()
        const result = validateImageFiles(files)
        if (result.error) notifyError(result.error)
        if (result.accepted.length) setOverlay({ type: 'images', files: result.accepted })
        return
      }
      if (!event.dataTransfer) return
      const nextOverlay = overlayFromTextTransfer(event.dataTransfer)
      if (nextOverlay) {
        event.preventDefault()
        setOverlay(nextOverlay)
      }
    }
    document.addEventListener('paste', handlePaste)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('paste', handlePaste)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [overlay])

  const groups = useMemo(() => {
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
      const today = chinaToday()
      const definitions = [
        { key: 'overdue', label: '逾期的今天处理', rank: 0 },
        { key: 'today', label: '今天处理', rank: 1 },
        { key: 'starred', label: '星标优先', rank: 2 },
        { key: 'later', label: '其余内容', rank: 3 }
      ]
      return definitions.map((definition) => ({
        key: definition.key,
        label: definition.label,
        date: '',
        items: items.filter((item) => smartPriority(item, today) === definition.rank)
      })).filter((group) => group.items.length)
    }
    const result = new Map<string, LibraryItem[]>()
    items.forEach((item) => {
      const key = dayKey(item.createdAt)
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
    await Promise.all([refreshReferences(), refreshItems()])
  }

  async function itemSaved() {
    setOverlay(null)
    setActiveDraft(null)
    await reloadAll()
    notifySuccess('已保存')
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
      const webUrl = asWebUrl(value)
      if (webUrl) {
        let title = hostLabel(webUrl)
        let coverUrl = ''
        try {
          const metadata = await jsonRequest<{ title: string; coverUrl: string }>('/api/metadata', 'POST', { url: webUrl })
          title = metadata.title || title
          coverUrl = metadata.coverUrl || ''
        } catch {
          // A readable title is helpful but never blocks one-tap saving.
        }
        const form = new FormData()
        form.set('url', webUrl)
        form.set('title', title)
        form.set('categoryId', categoryId || '')
        form.set('coverUrl', coverUrl)
        await api<LibraryItem>('/api/items/link', { method: 'POST', body: form })
      } else {
        await jsonRequest<LibraryItem>('/api/items/text', 'POST', {
          title: shortPastedTitle(value),
          categoryId
        })
      }
      await reloadAll()
      notifySuccess(webUrl ? '剪贴板网址已保存' : '剪贴板文字已保存')
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status === 409) {
        const details = requestError.details as { existingId?: string; trashed?: boolean } | undefined
        notifyError(details?.trashed ? '这个网址已在回收站中，可先恢复原条目' : '这个网址已经保存过了')
        if (details?.trashed) setFilters((current) => ({ ...current, trash: 'only', status: 'all' }))
        return
      }
      notifyError(errorMessage(requestError))
    }
  }

  async function readClipboardAndSave() {
    setMobilePanel(null)
    try {
      if (!navigator.clipboard?.readText) throw new Error('当前浏览器不允许读取剪贴板')
      await quickSaveClipboard(await navigator.clipboard.readText())
    } catch (requestError) {
      notifyError(errorMessage(requestError) + '。请允许剪贴板权限，或在首页空白处直接粘贴。')
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
      await refreshItems()
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
    try {
      await api('/api/items/' + item.id, { method: 'DELETE' })
      await reloadAll()
      setUndoDelete({ ids: [item.id], label: '“' + item.title + '”已移到回收站' })
      return true
    } catch (requestError) {
      notifyError(errorMessage(requestError))
      return false
    }
  }

  async function restoreItem(item: LibraryItem) {
    try {
      await jsonRequest<LibraryItem>('/api/items/' + item.id + '/restore', 'POST')
      await reloadAll()
      notifySuccess('已恢复到清单')
      return true
    } catch (requestError) {
      notifyError(errorMessage(requestError))
      return false
    }
  }

  async function permanentDeleteItem(item: LibraryItem) {
    if (!window.confirm('确定彻底删除“' + item.title + '”吗？相关图片也会永久删除，无法撤销。')) return false
    try {
      await api('/api/items/' + item.id + '/permanent', { method: 'DELETE' })
      await reloadAll()
      notifySuccess('已彻底删除')
      return true
    } catch (requestError) {
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
    if (!ids.length || bulkBusy) return
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
      if (failedIds.size) notifyError('有 ' + failedIds.size + ' 条没有处理成功，已保留选择，可再次重试。')
      else notifySuccess(label + '（' + result.updated + ' 条）')
    } catch (requestError) {
      notifyError(errorMessage(requestError))
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
        updated: number
        deleted: number
        succeededIds?: string[]
        failed?: Array<{ id: string; error: string }>
      }>('/api/items/bulk', 'POST', { ids, delete: true })
      const failedIds = new Set((result.failed || []).map((entry) => entry.id))
      setSelectedIds(failedIds)
      await reloadAll()
      if (failedIds.size) notifyError('有 ' + failedIds.size + ' 条未能移入回收站，已保留选择。')
      else setUndoDelete({ ids: result.succeededIds || ids, label: '已将 ' + result.deleted + ' 条移到回收站' })
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
      const result = await jsonRequest<{ updated: number; succeededIds?: string[]; failed?: Array<{ id: string; error: string }> }>(
        '/api/items/bulk', 'POST', { ids, restore: true }
      )
      const failedIds = new Set((result.failed || []).map((entry) => entry.id))
      setSelectedIds(failedIds)
      await reloadAll()
      if (failedIds.size) notifyError('有 ' + failedIds.size + ' 条未能恢复，已保留选择。')
      else notifySuccess('已恢复 ' + result.updated + ' 条')
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    } finally {
      setBulkBusy(false)
    }
  }

  async function runBulkPermanentDelete() {
    const ids = [...selectedIds]
    if (!ids.length || bulkBusy) return
    if (!window.confirm('确定彻底删除选中的 ' + ids.length + ' 条内容吗？相关图片也会永久删除，无法撤销。')) return
    setBulkBusy(true)
    try {
      const result = await jsonRequest<{ deleted: number; succeededIds?: string[]; failed?: Array<{ id: string; error: string }> }>(
        '/api/items/bulk', 'POST', { ids, permanentDelete: true }
      )
      const failedIds = new Set((result.failed || []).map((entry) => entry.id))
      setSelectedIds(failedIds)
      await reloadAll()
      if (failedIds.size) notifyError('有 ' + failedIds.size + ' 条未能彻底删除，已保留选择。')
      else notifySuccess('已彻底删除 ' + result.deleted + ' 条')
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    } finally {
      setBulkBusy(false)
    }
  }

  async function emptyTrash() {
    const count = allItems.filter((item) => item.trashedAt).length
    if (!count || !window.confirm('确定清空回收站中的 ' + count + ' 条内容吗？相关图片也会永久删除，无法撤销。')) return
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
    if (activeDraft.type === 'link') setOverlay({ type: 'link' })
    if (activeDraft.type === 'text') setOverlay({ type: 'text', initialText: '' })
    if (activeDraft.type === 'images') setOverlay({ type: 'images', files: [] })
    if (activeDraft.type === 'edit' && activeDraft.itemId) {
      try {
        const item = await api<LibraryItem>('/api/items/' + activeDraft.itemId)
        setOverlay({ type: 'edit', item })
      } catch (requestError) {
        notifyError(errorMessage(requestError))
      }
    }
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
        setFilters((current) => ({ ...current, trash: 'only', status: 'all' }))
        notifyError('这个网址在回收站中，可先恢复原条目')
      } else {
        setOverlay({ type: 'edit', item })
      }
      await discardDraft('new-link')
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

  function closeEditor() {
    setOverlay(null)
    void reloadAll()
  }

  function dropOnMain(event: ReactDragEvent) {
    if (event.dataTransfer.files.length) event.preventDefault()
  }

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
  const activeFilterCount = [
    Boolean(filters.q),
    filters.status !== (filters.trash === 'only' ? 'all' : 'pending'),
    filters.kind !== 'all',
    filters.priority !== 'all',
    Boolean(filters.category),
    Boolean(filters.date),
    filters.sort !== 'smart'
  ].filter(Boolean).length
  const viewTotal = allItems.filter((item) => filters.trash === 'only' ? Boolean(item.trashedAt) : !item.trashedAt).length
  const trashTotal = allItems.filter((item) => item.trashedAt).length
  const filterChips = [
    filters.status !== 'all' ? { key: 'status', label: filters.status === 'pending' ? '待处理' : '已完成' } : null,
    filters.q ? { key: 'q', label: '搜索：' + filters.q } : null,
    filters.kind !== 'all' ? { key: 'kind', label: filters.kind === 'link' ? '网页' : filters.kind === 'text' ? '文本' : '图片' } : null,
    filters.priority !== 'all' ? { key: 'priority', label: filters.priority === 'starred' ? '星标' : '今日 / 逾期' } : null,
    filters.category ? {
      key: 'category',
      label: filters.category === 'uncategorized'
        ? '未分类'
        : '类别：' + (categories.find((category) => category.id === filters.category)?.name || '已删除类别')
    } : null,
    filters.date ? { key: 'date', label: '保存日期：' + filters.date } : null,
    filters.sort !== 'smart' ? { key: 'sort', label: '自定义排序' } : null
  ].filter(Boolean) as Array<{ key: string; label: string }>

  function resetFilters(showAll = false) {
    setFilters({
      ...defaultFilters,
      trash: filters.trash,
      status: filters.trash === 'only' || showAll ? 'all' : 'pending'
    })
  }

  function switchLibraryView(next: 'active' | 'only') {
    setFilters((current) => ({ ...current, trash: next, status: next === 'only' ? 'all' : 'pending' }))
    setSelectionMode(false)
    setSelectedIds(new Set())
    setBulkPanelOpen(false)
    setMobilePanel(null)
  }

  function removeFilterChip(key: string) {
    setFilters((current) => {
      if (key === 'status') return { ...current, status: 'all' }
      if (key === 'q') return { ...current, q: '' }
      if (key === 'kind') return { ...current, kind: 'all' }
      if (key === 'priority') return { ...current, priority: 'all' }
      if (key === 'category') return { ...current, category: '' }
      if (key === 'date') return { ...current, date: '' }
      if (key === 'sort') return { ...current, sort: 'smart' }
      return current
    })
  }

  function openFromMobile(nextOverlay: NonNullable<Overlay>) {
    setMobilePanel(null)
    setOverlay(nextOverlay)
  }

  return (
    <div className="app-shell" onDragOver={dropOnMain}>
      <header className="app-header">
        <div className="brand-lockup">
          {theme === 'animal-island' && <img src={islandBag} alt="" className="brand-icon" />}
          <div>
            <span className="brand-kicker">{themeDefinition.dashboardKicker}</span>
            <h1>Do It Laaaaaater</h1>
            <p>{themeDefinition.dashboardDescription}</p>
          </div>
        </div>
        <nav className="header-actions" aria-label="主要操作">
          <Button
            type="primary"
            size="middle"
            icon={<AppIcon name="add" size={26} />}
            onClick={() => setOverlay({ type: 'link' })}
          >
            添加网页
          </Button>
          <Button
            size="middle"
            icon={<AppIcon name="image" size={26} />}
            onClick={() => setOverlay({ type: 'images', files: [] })}
          >
            保存图片
          </Button>
          <Button
            size="middle"
            icon={<AppIcon name="bookmark" size={26} />}
            onClick={() => setOverlay({ type: 'bookmarklet' })}
          >
            书签按钮
          </Button>
          <Button
            size="middle"
            icon={<AppIcon name="categories" size={26} />}
            onClick={() => setOverlay({ type: 'categories' })}
          >
            类别管理
          </Button>
          <Button
            size="middle"
            icon={<AppIcon name="trash" size={26} />}
            onClick={() => switchLibraryView(filters.trash === 'only' ? 'active' : 'only')}
          >
            {filters.trash === 'only' ? '返回清单' : `回收站${trashTotal ? ` ${trashTotal}` : ''}`}
          </Button>
          <ThemeControl />
          <Button
            size="middle"
            icon={<AppIcon name="account" size={26} />}
            onClick={() => setOverlay({ type: 'account' })}
          >
            账号
          </Button>
          <Button
            size="middle"
            icon={<AppIcon name="logout" size={26} />}
            onClick={() => void logout()}
          >
            退出
          </Button>
        </nav>
        <button
          type="button"
          className={`sync-indicator sync-${displayedSyncPhase}`}
          aria-label={`${displayedSyncMessage}，查看同步详情`}
          onClick={() => setOverlay({ type: 'sync' })}
        >
          <AppIcon
            name={displayedSyncPhase === 'error' || displayedSyncPhase === 'offline' ? 'warning' : 'sync'}
            size={17}
          />
          <span aria-live="polite">{displayedSyncMessage}</span>
        </button>
      </header>

      <main className="main-content">
        <div className="library-view-bar" role="navigation" aria-label="清单视图">
          <button
            type="button"
            className={filters.trash === 'active' ? 'is-active' : ''}
            onClick={() => switchLibraryView('active')}
          >
            <AppIcon name="focus" size={18} />阅读清单
          </button>
          <button
            type="button"
            className={filters.trash === 'only' ? 'is-active' : ''}
            onClick={() => switchLibraryView('only')}
          >
            <AppIcon name="trash" size={18} />回收站{trashTotal ? `（${trashTotal}）` : ''}
          </button>
          {filters.trash === 'only' && trashTotal > 0 && (
            <Button size="small" danger onClick={() => void emptyTrash()}>清空回收站</Button>
          )}
        </div>
        <Card className="toolbar" pattern="default" aria-label="筛选和搜索">
          <div className="toolbar-tabs">
            <Tabs
              aria-label="处理状态"
              className="status-tabs"
              activeKey={filters.status}
              items={[
                { key: 'pending', label: '待处理', children: null },
                { key: 'completed', label: '已完成', children: null },
                { key: 'all', label: '全部', children: null }
              ]}
              onChange={(value) => setFilters((current) => ({
                ...current,
                status: value as ItemFilters['status']
              }))}
            />
          </div>
          <label className="search-field">
            <span className="visually-hidden">搜索</span>
            <Input
              type="search"
              size="large"
              shadow
              allowClear
              aria-label="搜索"
              clearAriaLabel="清除搜索"
              prefix={<AppIcon name="search" size={21} className="search-icon" />}
              placeholder="搜索标题、网址、类别或图片名"
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              onClear={() => setFilters((current) => ({ ...current, q: '' }))}
            />
          </label>
          <div className="filter-select advanced-filter">
            <ThemeFilterSelect
              theme={theme}
              ariaLabel="内容类型"
              value={filters.kind}
              options={[
                { key: 'all', label: '全部类型' },
                { key: 'link', label: '网页' },
                { key: 'text', label: '文本' },
                { key: 'image_group', label: '图片' }
              ]}
              onChange={(value) => setFilters((current) => ({
                ...current,
                kind: value as ItemFilters['kind']
              }))}
            />
          </div>
          <div className="filter-select advanced-filter">
            <ThemeFilterSelect
              theme={theme}
              ariaLabel="优先筛选"
              value={filters.priority}
              options={[
                { key: 'all', label: '全部优先级' },
                { key: 'planned', label: '今日 / 逾期' },
                { key: 'starred', label: '星标' }
              ]}
              onChange={(value) => setFilters((current) => ({
                ...current,
                priority: value as ItemFilters['priority']
              }))}
            />
          </div>
          <div className="filter-select advanced-filter">
            <ThemeFilterSelect
              theme={theme}
              ariaLabel="类别"
              value={filters.category}
              options={[
                { key: '', label: '全部类别' },
                { key: 'uncategorized', label: '未分类' },
                ...categories.map((category) => ({ key: category.id, label: category.name }))
              ]}
              onChange={(value) => setFilters((current) => ({ ...current, category: value }))}
            />
          </div>
          <label className="date-field advanced-filter">
            <span className="visually-hidden">保存日期</span>
            <input
              type="date"
              aria-label="保存日期"
              value={filters.date}
              onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
          <div className="filter-select sort-select advanced-filter">
            <ThemeFilterSelect
              theme={theme}
              ariaLabel="排序方式"
              value={filters.sort}
              options={[
                { key: 'smart', label: '智能优先' },
                { key: 'newest', label: '最近保存' },
                { key: 'oldest', label: '最久未看' },
                { key: 'recently_completed', label: '最近完成' },
                { key: 'planned_date', label: '计划日期' }
              ]}
              onChange={(value) => setFilters((current) => ({
                ...current,
                sort: value as ItemFilters['sort']
              }))}
            />
          </div>
          <Button className="advanced-filter" size="small" type="dashed" onClick={() => resetFilters()}>清除筛选</Button>
        </Card>

        {activeDraft && (
          <div className="draft-recovery notice notice-warning" role="status">
            <div>
              <strong>发现一份未完成草稿</strong>
              <span>上次输入的文字和图片仍保存在这个浏览器中。</span>
            </div>
            <Button size="small" type="primary" onClick={() => void restoreActiveDraft()}>恢复草稿</Button>
            <Button size="small" onClick={() => void discardActiveDraft()}>丢弃</Button>
          </div>
        )}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="result-summary">
          <div className="result-count">
            <span>{loading ? '正在加载…' : `显示 ${items.length} 条 · 当前视图共 ${viewTotal} 条`}</span>
            {filters.trash !== 'only' && (
            <Button
              size="small"
              type={focusMode ? 'primary' : 'default'}
              icon={<AppIcon name="focus" size={18} />}
              disabled={!items.length}
              onClick={() => setFocusMode(true)}
            >
              开始处理
            </Button>
            )}
            <Button
              size="small"
              icon={<AppIcon name="select" size={18} />}
              onClick={() => {
                setSelectionMode((value) => !value)
                if (selectionMode) setSelectedIds(new Set())
              }}
            >
              {selectionMode ? '退出选择' : '选择条目'}
            </Button>
          </div>
          <span className="muted">在空白处按 Ctrl+V，可直接添加图片、文字或网页链接</span>
        </div>
        {filterChips.length > 0 && (
          <div className="active-filter-chips" aria-label="当前筛选条件">
            <span>当前条件</span>
            {filterChips.map((chip) => (
              <button key={chip.key} type="button" onClick={() => removeFilterChip(chip.key)} title="移除此条件">
                {chip.label}<span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" className="clear-filter-chip" onClick={() => resetFilters()}>清除全部条件</button>
          </div>
        )}

        {selectionMode && (
          <div className="bulk-toolbar desktop-bulk-toolbar" role="toolbar" aria-label="批量操作">
            <strong>已选 {selectedIds.size} 条</strong>
            <Button size="small" disabled={!items.length || bulkBusy} onClick={() => setSelectedIds(new Set(items.map((item) => item.id)))}>全选当前结果</Button>
            <Button size="small" disabled={!selectedIds.size || bulkBusy} onClick={() => setSelectedIds(new Set())}>取消全选</Button>
            <span className="bulk-divider" />
            {filters.trash === 'only' ? (
              <>
                <Button size="small" type="primary" disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="restore" size={16} />} onClick={() => void runBulkRestore()}>恢复</Button>
                <Button size="small" danger disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="delete" size={16} />} onClick={() => void runBulkPermanentDelete()}>彻底删除</Button>
              </>
            ) : (
              <>
            <Button size="small" type="primary" disabled={!selectedIds.size || bulkBusy} onClick={() => void runBulk({ status: 'completed' }, '已批量完成')}>完成</Button>
            <Button size="small" disabled={!selectedIds.size || bulkBusy} onClick={() => void runBulk({ status: 'pending' }, '已批量恢复')}>恢复</Button>
            <Button size="small" disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="star" size={16} />} onClick={() => void runBulk({ isStarred: true }, '已批量加星标')}>加星标</Button>
            <Button size="small" disabled={!selectedIds.size || bulkBusy} onClick={() => void runBulk({ isStarred: false }, '已批量取消星标')}>取消星标</Button>
            <Button size="small" disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="today" size={16} />} onClick={() => void runBulk({ plannedFor: chinaToday() }, '已加入今日清单')}>加入今日</Button>
            <Button size="small" disabled={!selectedIds.size || bulkBusy} onClick={() => void runBulk({ plannedFor: null }, '已移出今日清单')}>移出今日</Button>
            <label className="bulk-category">
              <span className="visually-hidden">批量修改类别</span>
              {theme === 'animal-island' ? (
                <Select
                  aria-label="批量修改类别"
                  value={bulkCategoryId}
                  options={[
                    { key: '', label: '未分类' },
                    ...categories.map((category) => ({ key: category.id, label: category.name }))
                  ]}
                  onChange={setBulkCategoryId}
                />
              ) : (
                <select aria-label="批量修改类别" value={bulkCategoryId} onChange={(event) => setBulkCategoryId(event.target.value)}>
                  <option value="">未分类</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              )}
              <Button size="small" disabled={!selectedIds.size || bulkBusy} onClick={() => void runBulk({ categoryId: bulkCategoryId || null }, '类别已批量更新')}>应用类别</Button>
            </label>
            <Button size="small" danger disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="delete" size={16} />} onClick={() => void runBulkDelete()}>移到回收站</Button>
              </>
            )}
          </div>
        )}

        {!loading && !items.length && (
          <EmptyState>
            {theme === 'animal-island' && <img src={islandBag} alt="" className="empty-mascot" />}
            {viewTotal === 0 ? filters.trash === 'only' ? (
              <>
                <h2>回收站是空的</h2>
                <p>删除的内容会在这里保留 7 天，期间可以随时恢复。</p>
                <div className="empty-actions">
                  <Button type="primary" onClick={() => switchLibraryView('active')}>返回阅读清单</Button>
                </div>
              </>
            ) : (
              <>
                <h2>开始建立你的稍后阅读清单</h2>
                <p>粘贴图片、文字或网页链接即可添加，也可以使用下面的入口。</p>
                <div className="empty-actions">
                  <Button type="primary" onClick={() => setOverlay({ type: 'link' })}>添加网页</Button>
                  <Button onClick={() => setOverlay({ type: 'text', initialText: '' })}>保存文本</Button>
                  <Button onClick={() => setOverlay({ type: 'images', files: [] })}>保存图片</Button>
                </div>
              </>
            ) : (
              <>
                <h2>当前条件下没有结果</h2>
                <p>资料库里仍有 {viewTotal} 条内容，只是没有符合当前搜索或筛选条件的条目。</p>
                <div className="empty-filter-summary">
                  {filterChips.map((chip) => <span key={chip.key}>{chip.label}</span>)}
                </div>
                <div className="empty-actions">
                  <Button type="primary" onClick={() => resetFilters()}>清除筛选</Button>
                  <Button onClick={() => resetFilters(true)}>查看全部</Button>
                </div>
              </>
            )}
          </EmptyState>
        )}

        <div className="date-groups">
          {groups.map((group) => (
            <section key={group.key} className={`date-group${filters.sort === 'smart' ? ' priority-group' : ''}`}>
              <div className="date-heading">
                <Title size="small" color="app-teal">
                  <span role="heading" aria-level={2}>{group.label}</span>
                </Title>
                {group.date && <time dateTime={group.date}>{group.date}</time>}
              </div>
              <Divider type="line-teal" className="date-divider" />
              <div className="item-list">
                {group.items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    categories={categories}
                    selectionMode={selectionMode}
                    trashMode={filters.trash === 'only'}
                    selected={selectedIds.has(item.id)}
                    busy={busyItems.has(item.id)}
                    retry={retryItems[item.id]}
                    onEdit={() => setOverlay({ type: 'edit', item })}
                    onPatch={(changes, label) => patchItem(item, changes, label)}
                    onSelect={(selected) => toggleSelection(item.id, selected)}
                    onDelete={() => deleteItem(item)}
                    onRestore={() => restoreItem(item)}
                    onPermanentDelete={() => permanentDeleteItem(item)}
                    onPreview={(assets, index) => setOverlay({ type: 'lightbox', assets, index })}
                    now={now}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      {selectionMode && (
        <div className="mobile-selection-bar" role="toolbar" aria-label="移动端批量操作">
          <strong>已选 {selectedIds.size} 条</strong>
          <button type="button" disabled={!items.length || bulkBusy} onClick={() => setSelectedIds(new Set(items.map((item) => item.id)))}>全选</button>
          {filters.trash === 'only' ? (
            <button type="button" className="is-primary" disabled={!selectedIds.size || bulkBusy} onClick={() => void runBulkRestore()}>恢复</button>
          ) : (
            <button type="button" className="is-primary" disabled={!selectedIds.size || bulkBusy} onClick={() => void runBulk({ status: 'completed' }, '已批量完成')}>完成</button>
          )}
          <button type="button" disabled={!selectedIds.size || bulkBusy} onClick={() => setBulkPanelOpen(true)}>更多</button>
          <button type="button" onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); setBulkPanelOpen(false) }}>退出</button>
        </div>
      )}

      <nav className="mobile-bottom-nav" aria-label="移动端主导航">
        <button
          type="button"
          className={!mobilePanel && !selectionMode ? 'is-active' : ''}
          onClick={() => {
            setMobilePanel(null)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        >
          <AppIcon name="focus" size={22} />
          <span>清单</span>
        </button>
        <button
          type="button"
          className={mobilePanel === 'filters' ? 'is-active' : ''}
          onClick={() => setMobilePanel((current) => current === 'filters' ? null : 'filters')}
        >
          <span className="mobile-nav-icon"><AppIcon name="sort" size={22} />{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</span>
          <span>筛选</span>
        </button>
        <button
          type="button"
          className={`mobile-add-action${mobilePanel === 'add' ? ' is-active' : ''}`}
          onClick={() => setMobilePanel((current) => current === 'add' ? null : 'add')}
        >
          <span className="mobile-add-icon"><AppIcon name="add" size={27} /></span>
          <span>添加</span>
        </button>
        <button
          type="button"
          className={selectionMode ? 'is-active' : ''}
          onClick={() => {
            setMobilePanel(null)
            setSelectionMode((value) => !value)
            if (selectionMode) setSelectedIds(new Set())
          }}
        >
          <AppIcon name="select" size={22} />
          <span>选择</span>
        </button>
        <button
          type="button"
          className={mobilePanel === 'more' ? 'is-active' : ''}
          onClick={() => setMobilePanel((current) => current === 'more' ? null : 'more')}
        >
          <span className="mobile-nav-icon"><AppIcon name={queuedCount ? 'sync' : 'categories'} size={22} />{queuedCount > 0 && <b>{queuedCount}</b>}</span>
          <span>更多</span>
        </button>
      </nav>

      <MobileActionSheet open={mobilePanel === 'filters'} title="筛选与排序" onClose={() => setMobilePanel(null)}>
        <div className="mobile-filter-sheet stack">
          <label className="field">
            <span>内容类型</span>
            <ThemeFilterSelect
              theme={theme}
              ariaLabel="内容类型"
              value={filters.kind}
              options={[
                { key: 'all', label: '全部类型' },
                { key: 'link', label: '网页' },
                { key: 'text', label: '文本' },
                { key: 'image_group', label: '图片' }
              ]}
              onChange={(value) => setFilters((current) => ({ ...current, kind: value as ItemFilters['kind'] }))}
            />
          </label>
          <label className="field">
            <span>优先级</span>
            <ThemeFilterSelect
              theme={theme}
              ariaLabel="优先筛选"
              value={filters.priority}
              options={[
                { key: 'all', label: '全部优先级' },
                { key: 'planned', label: '今日 / 逾期' },
                { key: 'starred', label: '星标' }
              ]}
              onChange={(value) => setFilters((current) => ({ ...current, priority: value as ItemFilters['priority'] }))}
            />
          </label>
          <label className="field">
            <span>类别</span>
            <ThemeFilterSelect
              theme={theme}
              ariaLabel="类别"
              value={filters.category}
              options={[
                { key: '', label: '全部类别' },
                { key: 'uncategorized', label: '未分类' },
                ...categories.map((category) => ({ key: category.id, label: category.name }))
              ]}
              onChange={(value) => setFilters((current) => ({ ...current, category: value }))}
            />
          </label>
          <label className="field">
            <span>保存日期</span>
            <input type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} />
          </label>
          <label className="field">
            <span>排序方式</span>
            <ThemeFilterSelect
              theme={theme}
              ariaLabel="排序方式"
              value={filters.sort}
              options={[
                { key: 'smart', label: '智能优先' },
                { key: 'newest', label: '最近保存' },
                { key: 'oldest', label: '最久未看' },
                { key: 'recently_completed', label: '最近完成' },
                { key: 'planned_date', label: '计划日期' }
              ]}
              onChange={(value) => setFilters((current) => ({ ...current, sort: value as ItemFilters['sort'] }))}
            />
          </label>
          <div className="mobile-sheet-actions">
            <Button type="dashed" onClick={() => resetFilters()}>清除筛选</Button>
            <Button type="primary" onClick={() => setMobilePanel(null)}>查看结果</Button>
          </div>
        </div>
      </MobileActionSheet>

      <MobileActionSheet open={mobilePanel === 'add'} title="添加内容" onClose={() => setMobilePanel(null)}>
        <div className="mobile-action-list">
          <Button block type="primary" size="large" icon={<AppIcon name="link" size={24} />} onClick={() => openFromMobile({ type: 'link' })}>
            添加网页
          </Button>
          <Button block size="large" icon={<AppIcon name="text" size={24} />} onClick={() => openFromMobile({ type: 'text', initialText: '' })}>
            保存文本
          </Button>
          <Button block size="large" icon={<AppIcon name="image" size={24} />} onClick={() => openFromMobile({ type: 'images', files: [] })}>
            保存图片
          </Button>
          <Button block size="large" icon={<AppIcon name="clipboard" size={24} />} onClick={() => void readClipboardAndSave()}>
            识别剪贴板并保存
          </Button>
          <p>断网时也可以添加；内容会先安全保存在本机，联网后自动同步。</p>
        </div>
      </MobileActionSheet>

      <MobileActionSheet open={mobilePanel === 'more'} title="更多功能" onClose={() => setMobilePanel(null)}>
        <div className="mobile-action-list mobile-more-list">
          <Button block size="large" icon={<AppIcon name="sync" size={24} />} onClick={() => openFromMobile({ type: 'sync' })}>
            离线与同步{queuedCount ? `（${queuedCount}）` : ''}
          </Button>
          <Button block size="large" icon={<AppIcon name="categories" size={24} />} onClick={() => openFromMobile({ type: 'categories' })}>
            类别管理
          </Button>
          <Button block size="large" icon={<AppIcon name="trash" size={24} />} onClick={() => {
            switchLibraryView(filters.trash === 'only' ? 'active' : 'only')
          }}>
            {filters.trash === 'only' ? '返回阅读清单' : `回收站${trashTotal ? `（${trashTotal}）` : ''}`}
          </Button>
          <ThemeControl />
          <Button block size="large" icon={<AppIcon name="account" size={24} />} onClick={() => openFromMobile({ type: 'account' })}>
            账号设置
          </Button>
          <Button block size="large" danger icon={<AppIcon name="logout" size={24} />} onClick={() => {
            setMobilePanel(null)
            void logout()
          }}>
            退出账号
          </Button>
        </div>
      </MobileActionSheet>

      <MobileActionSheet open={bulkPanelOpen} title="批量操作" onClose={() => setBulkPanelOpen(false)}>
        <div className="mobile-bulk-sheet stack">
          <p>已选择 {selectedIds.size} 条内容</p>
          {filters.trash === 'only' ? (
            <>
              <Button block type="primary" disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="restore" size={20} />} onClick={() => { setBulkPanelOpen(false); void runBulkRestore() }}>恢复到清单</Button>
              <Button block danger disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="delete" size={20} />} onClick={() => { setBulkPanelOpen(false); void runBulkPermanentDelete() }}>彻底删除</Button>
            </>
          ) : (
            <>
              <Button block type="primary" disabled={!selectedIds.size || bulkBusy} onClick={() => { setBulkPanelOpen(false); void runBulk({ status: 'completed' }, '已批量完成') }}>标记完成</Button>
              <Button block disabled={!selectedIds.size || bulkBusy} onClick={() => { setBulkPanelOpen(false); void runBulk({ status: 'pending' }, '已批量恢复') }}>恢复待处理</Button>
              <Button block disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="star" size={20} />} onClick={() => { setBulkPanelOpen(false); void runBulk({ isStarred: true }, '已批量加星标') }}>加星标</Button>
              <Button block disabled={!selectedIds.size || bulkBusy} onClick={() => { setBulkPanelOpen(false); void runBulk({ isStarred: false }, '已批量取消星标') }}>取消星标</Button>
              <Button block disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="today" size={20} />} onClick={() => { setBulkPanelOpen(false); void runBulk({ plannedFor: chinaToday() }, '已安排今天处理') }}>安排今天</Button>
              <Button block disabled={!selectedIds.size || bulkBusy} onClick={() => { setBulkPanelOpen(false); void runBulk({ plannedFor: addChinaDays(1) }, '已安排明天处理') }}>安排明天</Button>
              <Button block disabled={!selectedIds.size || bulkBusy} onClick={() => { setBulkPanelOpen(false); void runBulk({ plannedFor: addChinaDays(7) }, '已安排一周后处理') }}>安排一周后</Button>
              <Button block disabled={!selectedIds.size || bulkBusy} onClick={() => { setBulkPanelOpen(false); void runBulk({ plannedFor: null }, '已清除处理计划') }}>清除计划</Button>
              <label className="field">
                <span>修改类别</span>
                <select value={bulkCategoryId} onChange={(event) => setBulkCategoryId(event.target.value)}>
                  <option value="">未分类</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <Button block disabled={!selectedIds.size || bulkBusy} onClick={() => { setBulkPanelOpen(false); void runBulk({ categoryId: bulkCategoryId || null }, '类别已批量更新') }}>应用类别</Button>
              <Button block danger disabled={!selectedIds.size || bulkBusy} icon={<AppIcon name="trash" size={20} />} onClick={() => { setBulkPanelOpen(false); void runBulkDelete() }}>移到回收站</Button>
            </>
          )}
        </div>
      </MobileActionSheet>

      {undoDelete && (
        <div className="delete-undo-bar" role="status" aria-live="polite">
          <span>{undoDelete.label}</span>
          <button type="button" onClick={() => void undoLastDelete()}>撤销</button>
          <button type="button" aria-label="关闭撤销提示" onClick={() => setUndoDelete(null)}>×</button>
        </div>
      )}

      <footer className="app-footer">
        {theme === 'animal-island' ? (
          <>
            <Footer type="tree" seamless />
            <p>
              Animal Island UI by{' '}
              <a href="https://github.com/guokaigdg/animal-island-ui" target="_blank" rel="noreferrer">
                guokaigdg
              </a>
              {' '}· CC BY-NC 4.0
            </p>
          </>
        ) : (
          <p className="flat-credit">
            Flat Design 2013 by{' '}
            <a href="https://github.com/novusgfx/retro-design-system" target="_blank" rel="noreferrer">
              NovusGFX
            </a>
            {' '}· MIT
          </p>
        )}
      </footer>

      {overlay?.type === 'link' && (
        <Modal title="添加网页" onClose={() => setOverlay(null)} wide>
          <LinkForm
            categories={categories}
            onCreateCategory={createCategory}
            initial={overlay.initial}
            onClose={() => {
              setActiveDraft(null)
              setOverlay(null)
            }}
            onSaved={() => void itemSaved()}
            onDuplicate={(id) => void openDuplicate(id)}
          />
        </Modal>
      )}
      {overlay?.type === 'text' && (
        <Modal title="保存文本" onClose={() => setOverlay(null)}>
          <TextItemForm
            categories={categories}
            onCreateCategory={createCategory}
            initialText={overlay.initialText}
            onClose={() => {
              setActiveDraft(null)
              setOverlay(null)
            }}
            onSaved={() => void itemSaved()}
          />
        </Modal>
      )}
      {overlay?.type === 'images' && (
        <Modal title="保存图片" onClose={() => setOverlay(null)} wide>
          <ImageGroupForm
            categories={categories}
            onCreateCategory={createCategory}
            initialFiles={overlay.files}
            onClose={() => {
              setActiveDraft(null)
              setOverlay(null)
            }}
            onSaved={() => void itemSaved()}
          />
        </Modal>
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
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay?.type === 'sync' && (
        <OfflineManagerModal onChanged={reloadAll} onClose={() => setOverlay(null)} />
      )}
      {overlay?.type === 'bookmarklet' && <BookmarkletHelp onClose={() => setOverlay(null)} />}
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
        />
      )}
    </div>
  )
}
