import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent
} from 'react'
import {
  Button,
  Card,
  Divider,
  Footer,
  Input,
  Notification,
  Select,
  Tabs,
  Tag,
  Title
} from 'animal-island-ui'
import islandBag from 'animal-island-ui/items/item-022.png'
import { api, errorMessage, jsonRequest } from '../api'
import { itemAgeLabel } from '../item-age'
import { getThemeDefinition, useTheme } from '../theme'
import type {
  Category,
  ImageAsset,
  ItemFilters,
  LibraryItem
} from '../types'
import { validateImageFiles } from './FormFields'
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

type Overlay =
  | { type: 'link'; initial?: { url?: string; title?: string } }
  | { type: 'text'; initialText: string }
  | { type: 'images'; files: File[] }
  | { type: 'edit'; item: LibraryItem }
  | { type: 'categories' }
  | { type: 'account' }
  | { type: 'bookmarklet' }
  | { type: 'lightbox'; assets: ImageAsset[]; index: number }
  | null

const defaultFilters: ItemFilters = {
  status: 'pending',
  kind: 'all',
  category: '',
  date: '',
  q: ''
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
  try {
    Notification.success({ message, duration: 3, position: 'bottom' })
  } catch {
    // Visual feedback must never interrupt a completed save.
  }
}

function notifyError(message: string) {
  try {
    Notification.error({ message, duration: 4.5, position: 'bottom' })
  } catch {
    // Keep the underlying interaction usable if the visual portal cannot mount.
  }
}

function ItemCard({
  item,
  onEdit,
  onToggle,
  onDelete,
  onPreview,
  now
}: {
  item: LibraryItem
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  onPreview: (assets: ImageAsset[], index: number) => void
  now: number
}) {
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

  return (
    <article className="item-card-shell">
      <Card className={cover ? 'item-card has-cover' : 'item-card'} pattern="default">
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
            {item.category && (
              <Tag
                size="small"
                variant="outlined"
                className="category-chip"
                style={{ borderColor: item.category.color }}
              >
                <i style={{ backgroundColor: item.category.color }} />
                {item.category.name}
              </Tag>
            )}
            {item.kind === 'link' && manual.length > 0 && (
              <button type="button" className="text-button" onClick={() => onPreview(manual, 0)}>
                {manual.length} 张截图
              </button>
            )}
          </div>
          <div className="item-actions">
            <Button
              size="small"
              type="primary"
              icon={<AppIcon name={item.status === 'pending' ? 'complete' : 'restore'} size={17} />}
              onClick={onToggle}
            >
              {item.status === 'pending' ? '标记完成' : '恢复待处理'}
            </Button>
            <Button size="small" icon={<AppIcon name="edit" size={17} />} onClick={onEdit}>编辑</Button>
            <Button size="small" danger icon={<AppIcon name="delete" size={17} />} onClick={onDelete}>删除</Button>
          </div>
        </div>
      </Card>
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
  const [items, setItems] = useState<LibraryItem[]>([])
  const [filters, setFilters] = useState<ItemFilters>(defaultFilters)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
  const requestNumber = useRef(0)

  const refreshReferences = useCallback(async () => {
    const nextCategories = await api<Category[]>('/api/categories')
    setCategories(nextCategories)
    return nextCategories
  }, [])

  const createCategory = useCallback(async (name: string, color: string) => {
    const created = await jsonRequest<Category>('/api/categories', 'POST', { name, color })
    const nextCategories = await refreshReferences()
    return nextCategories.find((category) => category.id === created.id) || created
  }, [refreshReferences])

  const refreshItems = useCallback(async (activeFilters: ItemFilters) => {
    const currentRequest = ++requestNumber.current
    const params = new URLSearchParams()
    if (activeFilters.status !== 'all') params.set('status', activeFilters.status)
    if (activeFilters.kind !== 'all') params.set('kind', activeFilters.kind)
    if (activeFilters.category) params.set('category', activeFilters.category)
    if (activeFilters.date) params.set('date', activeFilters.date)
    if (activeFilters.q.trim()) params.set('q', activeFilters.q.trim())
    setLoading(true)
    try {
      const result = await api<LibraryItem[]>('/api/items?' + params.toString())
      if (currentRequest === requestNumber.current) {
        setItems(result)
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
    const timer = window.setTimeout(() => {
      void refreshItems(filters)
    }, filters.q ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [filters, refreshItems])

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
    const result = new Map<string, LibraryItem[]>()
    items.forEach((item) => {
      const key = dayKey(item.createdAt)
      result.set(key, [...(result.get(key) || []), item])
    })
    return Array.from(result.entries())
  }, [items])

  async function reloadAll() {
    await Promise.all([refreshReferences(), refreshItems(filters)])
  }

  async function itemSaved() {
    setOverlay(null)
    await reloadAll()
    notifySuccess('已保存')
  }

  async function toggleItem(item: LibraryItem) {
    try {
      await jsonRequest('/api/items/' + item.id, 'PUT', {
        title: item.title,
        url: item.url,
        categoryId: item.category?.id || '',
        status: item.status === 'pending' ? 'completed' : 'pending'
      })
      await reloadAll()
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    }
  }

  async function deleteItem(item: LibraryItem) {
    const detail = item.assets.length ? '相关图片也会一起删除。' : ''
    if (!window.confirm('确定删除“' + item.title + '”吗？' + detail)) return
    try {
      await api('/api/items/' + item.id, { method: 'DELETE' })
      await reloadAll()
      notifySuccess('已删除')
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    }
  }

  async function openDuplicate(id: string) {
    try {
      const item = await api<LibraryItem>('/api/items/' + id)
      setOverlay({ type: 'edit', item })
    } catch (requestError) {
      notifyError(errorMessage(requestError))
    }
  }

  async function logout() {
    await jsonRequest('/api/auth/logout', 'POST')
    await onSessionChange()
  }

  function closeEditor() {
    setOverlay(null)
    void reloadAll()
  }

  function dropOnMain(event: ReactDragEvent) {
    if (event.dataTransfer.files.length) event.preventDefault()
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
      </header>

      <main className="main-content">
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
          <div className="filter-select">
            <Select
              aria-label="内容类型"
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
          <div className="filter-select">
            <Select
              aria-label="类别"
              value={filters.category}
              options={[
                { key: '', label: '全部类别' },
                { key: 'uncategorized', label: '未分类' },
                ...categories.map((category) => ({ key: category.id, label: category.name }))
              ]}
              onChange={(value) => setFilters((current) => ({ ...current, category: value }))}
            />
          </div>
          <label className="date-field">
            <span className="visually-hidden">保存日期</span>
            <input
              type="date"
              aria-label="保存日期"
              value={filters.date}
              onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
          <Button size="small" type="dashed" onClick={() => setFilters(defaultFilters)}>清除筛选</Button>
        </Card>

        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="result-summary">
          <span>{loading ? '正在加载…' : '共 ' + items.length + ' 条'}</span>
          <span className="muted">在空白处按 Ctrl+V，可直接添加图片、文字或网页链接</span>
        </div>

        {!loading && !items.length && (
          <EmptyState>
            {theme === 'animal-island' && <img src={islandBag} alt="" className="empty-mascot" />}
            <h2>这里还没有内容</h2>
            <p>复制图片、文字或网页链接，然后在这里按 Ctrl+V 即可添加。</p>
            <div className="empty-actions">
              <Button type="primary" onClick={() => setOverlay({ type: 'link' })}>添加网页</Button>
              <Button onClick={() => setOverlay({ type: 'images', files: [] })}>保存图片</Button>
            </div>
          </EmptyState>
        )}

        <div className="date-groups">
          {groups.map(([key, groupItems]) => (
            <section key={key} className="date-group">
              <div className="date-heading">
                <Title size="small" color="app-teal">
                  <span role="heading" aria-level={2}>{dayLabel(key)}</span>
                </Title>
                <time dateTime={key}>{key}</time>
              </div>
              <Divider type="line-teal" className="date-divider" />
              <div className="item-list">
                {groupItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onEdit={() => setOverlay({ type: 'edit', item })}
                    onToggle={() => void toggleItem(item)}
                    onDelete={() => void deleteItem(item)}
                    onPreview={(assets, index) => setOverlay({ type: 'lightbox', assets, index })}
                    now={now}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

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
        ) : theme === 'grid-paper' ? (
          <p className="grid-paper-credit">
            — Grid Paper by{' '}
            <a href={themeDefinition.creditUrl} target="_blank" rel="noreferrer">
              NovusGFX
            </a>
            {' '}· MIT · end of page —
          </p>
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
            onClose={() => setOverlay(null)}
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
            onClose={() => setOverlay(null)}
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
            onClose={() => setOverlay(null)}
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
            onClose={closeEditor}
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
        <AccountManager email={userEmail} onClose={() => setOverlay(null)} />
      )}
      {overlay?.type === 'bookmarklet' && <BookmarkletHelp onClose={() => setOverlay(null)} />}
      {overlay?.type === 'lightbox' && (
        <Lightbox
          assets={overlay.assets}
          initialIndex={overlay.index}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  )
}
