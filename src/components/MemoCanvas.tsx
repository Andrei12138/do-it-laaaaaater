import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type CSSProperties,
  type ReactNode
} from 'react'
import {
  CaptureUpdateAction,
  Excalidraw,
  restoreElements,
  viewportCoordsToSceneCoords
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawElement,
  ExcalidrawEmbeddableElement
} from '@excalidraw/excalidraw/element/types'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  PointerDownState
} from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import '../memo-canvas.css'
import { Button, Card, Input, Select, Tag } from 'animal-island-ui'
import { addChinaDays, chinaToday, plannedDateLabel } from '../china-date'
import { errorMessage } from '../api'
import {
  emptyMemoCanvas,
  fetchMemoCanvas,
  loadMemoBinaryFiles,
  saveMemoCanvas,
  uploadMemoAsset,
  type MemoBinaryFile
} from '../memo-api'
import {
  activeMemoFileIds,
  createMemoItemElement,
  findMemoItemElement,
  findMemoItemPlacement,
  MEMO_ITEM_HEIGHT,
  MEMO_ITEM_WIDTH,
  memoItemId,
  normalizeMemoItemElements,
  persistedMemoAppState,
  removeMemoItemReference
} from '../memo-scene'
import { clearMemoDraft, readMemoDraft, writeMemoDraft, type MemoDraft } from '../memo-store'
import { filterLibraryItems } from '../offline-query'
import { useTheme } from '../theme'
import type {
  BulkItemChanges,
  Category,
  ImageAsset,
  ItemFilters,
  LibraryItem,
  MemoBackground,
  MemoColorMode
} from '../types'
import { AppIcon } from './AppIcon'

const SAVE_DELAY = 900
const CHANNEL_NAME = 'do-it-laaaaaater.memo-canvas.v1'
const DEFAULT_FILTERS: ItemFilters = {
  status: 'pending',
  kind: 'all',
  category: '',
  date: '',
  q: '',
  priority: 'all',
  sort: 'newest',
  trash: 'active'
}

type SavePhase = 'loading' | 'saved' | 'saving' | 'draft' | 'offline' | 'error'

function manualAssets(item: LibraryItem) {
  return item.assets.filter((asset) => asset.role !== 'web_cover')
}

function itemCover(item: LibraryItem) {
  if (item.kind === 'text') return null
  if (item.kind === 'link') {
    return item.assets.find((asset) => asset.role === 'web_cover') || manualAssets(item)[0] || null
  }
  return manualAssets(item)[0] || null
}

function kindLabel(item: LibraryItem) {
  return item.kind === 'link' ? '网页' : item.kind === 'text' ? '文本' : '图片'
}

function memoChangeSignature(
  elements: readonly ExcalidrawElement[],
  appState: AppState | Record<string, unknown>,
  files: BinaryFiles | Record<string, MemoBinaryFile>
) {
  return JSON.stringify({
    elements: elements.map((element) => [
      element.id,
      element.version,
      element.versionNonce,
      element.isDeleted
    ]),
    appState: persistedMemoAppState(appState),
    files: Object.keys(files).sort()
  })
}

function MemoReferenceCard({
  element,
  item,
  selected
}: {
  element: ExcalidrawEmbeddableElement
  item: LibraryItem | null
  selected: boolean
}) {
  if (!item) {
    return (
      <div className={`memo-reference-card is-missing${selected ? ' is-selected' : ''}`}>
        <strong>原条目已被彻底删除</strong>
        <span>可在选中后从画布移除此空引用</span>
      </div>
    )
  }
  const cover = itemCover(item)
  const categoryStyle = {
    '--memo-category-color': item.category?.color || '#95a5a6'
  } as CSSProperties
  return (
    <div
      className={[
        'memo-reference-card',
        cover ? 'has-cover' : '',
        selected ? 'is-selected' : '',
        item.trashedAt ? 'is-trashed' : '',
        item.status === 'completed' ? 'is-completed' : ''
      ].filter(Boolean).join(' ')}
      data-element-id={element.id}
      style={categoryStyle}
    >
      {cover && <img src={cover.thumbUrl} alt="" />}
      <div className="memo-reference-copy">
        <div className="memo-reference-tags">
          <span>{kindLabel(item)}</span>
          <span>{item.status === 'pending' ? '待处理' : '已完成'}</span>
          {item.isStarred && <span>★ 星标</span>}
          {item.trashedAt && <span>回收站</span>}
        </div>
        <strong>{item.title}</strong>
        <small>{item.category?.name || '未分类'}</small>
        {item.plannedFor && <small>{plannedDateLabel(item.plannedFor)}</small>}
      </div>
    </div>
  )
}

function Pane({
  className,
  children
}: {
  className: string
  children: ReactNode
}) {
  const { theme } = useTheme()
  if (theme === 'animal-island') return <Card className={className} pattern="default">{children}</Card>
  return <section className={className}>{children}</section>
}

function MemoLibrary({
  items,
  categories,
  filters,
  onFilters,
  onAdd,
  onClose
}: {
  items: LibraryItem[]
  categories: Category[]
  filters: ItemFilters
  onFilters: (filters: ItemFilters) => void
  onAdd: (itemId: string) => void
  onClose: () => void
}) {
  const { theme } = useTheme()
  const filtered = useMemo(() => filterLibraryItems(items, filters), [filters, items])
  const update = <K extends keyof ItemFilters>(key: K, value: ItemFilters[K]) => onFilters({ ...filters, [key]: value })
  const select = (
    label: string,
    value: string,
    options: Array<{ key: string; label: string }>,
    onChange: (value: string) => void
  ) => theme === 'animal-island' ? (
    <Select aria-label={label} value={value} options={options} onChange={onChange} />
  ) : (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.key || '__all__'} value={option.key}>{option.label}</option>)}
    </select>
  )

  return (
    <Pane className="memo-library-pane">
      <header>
        <div><AppIcon name="library" size={25} /><h2>资料库</h2></div>
        <button type="button" aria-label="收起资料库" onClick={onClose}><AppIcon name="close" size={20} /></button>
      </header>
      <label className="memo-library-search">
        <span className="visually-hidden">搜索资料库</span>
        <Input
          type="search"
          size="large"
          allowClear
          prefix={<AppIcon name="search" size={19} />}
          placeholder="搜索稍后再看的内容"
          value={filters.q}
          onChange={(event) => update('q', event.target.value)}
          onClear={() => update('q', '')}
        />
      </label>
      <div className="memo-library-filters">
        {select('状态', filters.status, [
          { key: 'pending', label: '待处理' },
          { key: 'completed', label: '已完成' },
          { key: 'all', label: '全部状态' }
        ], (value) => update('status', value as ItemFilters['status']))}
        {select('类型', filters.kind, [
          { key: 'all', label: '全部类型' },
          { key: 'link', label: '网页' },
          { key: 'text', label: '文本' },
          { key: 'image_group', label: '图片' }
        ], (value) => update('kind', value as ItemFilters['kind']))}
        {select('类别', filters.category, [
          { key: '', label: '全部类别' },
          { key: 'uncategorized', label: '未分类' },
          ...categories.map((category) => ({ key: category.id, label: category.name }))
        ], (value) => update('category', value))}
        {select('优先级', filters.priority, [
          { key: 'all', label: '全部优先级' },
          { key: 'planned', label: '今日 / 逾期' },
          { key: 'starred', label: '星标' }
        ], (value) => update('priority', value as ItemFilters['priority']))}
        <label>
          <span>保存日期</span>
          <input type="date" value={filters.date} onChange={(event) => update('date', event.target.value)} />
        </label>
      </div>
      <div className="memo-library-result-heading">
        <span>{filtered.length} 条内容</span>
        <button type="button" onClick={() => onFilters({ ...DEFAULT_FILTERS })}>清除筛选</button>
      </div>
      <div className="memo-library-results">
        {filtered.map((item) => {
          const cover = itemCover(item)
          return (
            <article
              key={item.id}
              className={cover ? 'has-cover' : ''}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy'
                event.dataTransfer.setData('application/x-do-it-laaaaaater-item', item.id)
                event.dataTransfer.setData('text/plain', item.title)
              }}
            >
              {cover && <img src={cover.thumbUrl} alt="" />}
              <div>
                <span>{kindLabel(item)} · {item.category?.name || '未分类'}</span>
                <strong>{item.title}</strong>
              </div>
              <button
                type="button"
                className="memo-library-add"
                aria-label="放到画布"
                title={`放到画布：${item.title}`}
                onClick={() => onAdd(item.id)}
              >
                <AppIcon name="add" size={17} />
              </button>
            </article>
          )
        })}
        {!filtered.length && <p className="memo-library-empty">没有符合当前筛选的内容。</p>}
      </div>
      <p className="memo-library-tip">电脑可直接拖到画布；手机点右侧的添加图标。同一条内容只会放入一次。</p>
    </Pane>
  )
}

function MemoItemInspector({
  item,
  categories,
  elementId,
  busy,
  onClose,
  onSelectForAdjustment,
  onEdit,
  onPatch,
  onRemoveReference,
  onDelete,
  onRestore,
  onPermanentDelete,
  onPreview
}: {
  item: LibraryItem | null
  categories: Category[]
  elementId: string
  busy: boolean
  onClose: () => void
  onSelectForAdjustment: (elementId: string) => void
  onEdit: (item: LibraryItem) => void
  onPatch: (item: LibraryItem, changes: BulkItemChanges, label: string) => Promise<boolean>
  onRemoveReference: (elementId: string) => void
  onDelete: (item: LibraryItem) => Promise<boolean>
  onRestore: (item: LibraryItem) => Promise<boolean>
  onPermanentDelete: (item: LibraryItem) => Promise<boolean>
  onPreview: (assets: ImageAsset[], index: number) => void
}) {
  const { theme } = useTheme()
  const [planOpen, setPlanOpen] = useState(false)
  if (!item) {
    return (
      <Pane className="memo-inspector-pane">
        <header><h2>条目已删除</h2><button type="button" aria-label="关闭编辑面板" onClick={onClose}><AppIcon name="close" size={20} /></button></header>
        <p>原资料库条目已经被彻底删除，这里只剩一个空引用。</p>
        <Button danger icon={<AppIcon name="delete" size={18} />} onClick={() => onRemoveReference(elementId)}>从画布移除</Button>
      </Pane>
    )
  }
  const manual = manualAssets(item)
  const cover = itemCover(item)
  const categoryControl = theme === 'animal-island' ? (
    <Select
      aria-label="修改类别"
      value={item.category?.id || ''}
      disabled={busy}
      options={[{ key: '', label: '未分类' }, ...categories.map((category) => ({ key: category.id, label: category.name }))]}
      onChange={(value) => void onPatch(item, { categoryId: value || null }, '类别已更新')}
    />
  ) : (
    <select
      aria-label="修改类别"
      value={item.category?.id || ''}
      disabled={busy}
      onChange={(event) => void onPatch(item, { categoryId: event.target.value || null }, '类别已更新')}
    >
      <option value="">未分类</option>
      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select>
  )

  return (
    <Pane className="memo-inspector-pane">
      <header>
        <div><AppIcon name="edit" size={24} /><h2>编辑条目</h2></div>
        <button type="button" aria-label="关闭编辑面板" onClick={onClose}><AppIcon name="close" size={20} /></button>
      </header>
      {cover && (
        <button
          type="button"
          className="memo-inspector-cover"
          onClick={() => {
            const assets = item.kind === 'image_group' ? manual : item.assets
            if (assets.length) onPreview(assets, 0)
          }}
        >
          <img src={cover.thumbUrl} alt="" />
        </button>
      )}
      <div className="memo-inspector-title">
        <div>
          <Tag size="small" color={item.status === 'pending' ? 'app-yellow' : 'app-green'}>{item.status === 'pending' ? '待处理' : '已完成'}</Tag>
          <Tag size="small" color="app-teal" variant="outlined">{kindLabel(item)}</Tag>
          {item.trashedAt && <Tag size="small" color="app-red">回收站</Tag>}
        </div>
        <h3>{item.title}</h3>
        {item.url && <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>}
      </div>
      <Button
        block
        icon={<AppIcon name="focus" size={18} />}
        onClick={() => onSelectForAdjustment(elementId)}
      >
        选中卡片并调整位置、大小或角度
      </Button>
      {!item.trashedAt && (
        <>
          <label className="field">
            <span>类别</span>
            {categoryControl}
          </label>
          <div className="memo-inspector-actions">
            {item.kind === 'link' && item.url && (
              <a className="button button-primary" href={item.url} target="_blank" rel="noreferrer"><AppIcon name="open" size={18} />打开网页</a>
            )}
            {item.kind === 'image_group' && manual.length > 0 && (
              <Button type="primary" icon={<AppIcon name="image" size={18} />} onClick={() => onPreview(manual, 0)}>查看图片</Button>
            )}
            <Button
              disabled={busy}
              icon={<AppIcon name={item.status === 'pending' ? 'complete' : 'restore'} size={18} />}
              onClick={() => void onPatch(
                item,
                { status: item.status === 'pending' ? 'completed' : 'pending' },
                item.status === 'pending' ? '已标记完成' : '已恢复待处理'
              )}
            >
              {item.status === 'pending' ? '已完成' : '恢复待处理'}
            </Button>
            <Button
              disabled={busy}
              icon={<AppIcon name="star" size={18} />}
              onClick={() => void onPatch(item, { isStarred: !item.isStarred }, item.isStarred ? '已取消星标' : '已加星标')}
            >
              {item.isStarred ? '取消星标' : '加星标'}
            </Button>
            <Button disabled={busy || item.status === 'completed'} icon={<AppIcon name="today" size={18} />} onClick={() => setPlanOpen((open) => !open)}>
              {item.plannedFor ? plannedDateLabel(item.plannedFor) : '安排处理'}
            </Button>
          </div>
          {planOpen && (
            <div className="memo-plan-menu">
              <button type="button" onClick={() => { setPlanOpen(false); void onPatch(item, { plannedFor: chinaToday() }, '已安排今天处理') }}>今天</button>
              <button type="button" onClick={() => { setPlanOpen(false); void onPatch(item, { plannedFor: addChinaDays(1) }, '已安排明天处理') }}>明天</button>
              <button type="button" onClick={() => { setPlanOpen(false); void onPatch(item, { plannedFor: addChinaDays(7) }, '已安排一周后处理') }}>一周后</button>
              <button type="button" onClick={() => { setPlanOpen(false); void onPatch(item, { plannedFor: null }, '已清除处理计划') }}>清除计划</button>
            </div>
          )}
          <Button block icon={<AppIcon name="edit" size={19} />} onClick={() => onEdit(item)}>编辑标题、网址或图片</Button>
          <Button block danger icon={<AppIcon name="trash" size={19} />} onClick={() => void onDelete(item)}>移到回收站</Button>
        </>
      )}
      {item.trashedAt && (
        <div className="memo-inspector-actions">
          <Button type="primary" disabled={busy} icon={<AppIcon name="restore" size={18} />} onClick={() => void onRestore(item)}>恢复条目</Button>
          <Button danger disabled={busy} icon={<AppIcon name="delete" size={18} />} onClick={() => void onPermanentDelete(item)}>彻底删除</Button>
        </div>
      )}
      <div className="memo-reference-danger-zone">
        <strong>只处理画布引用</strong>
        <p>“从画布移除”不会删除资料库中的原条目。</p>
        <Button icon={<AppIcon name="remove" size={18} />} onClick={() => onRemoveReference(elementId)}>从画布移除</Button>
      </div>
    </Pane>
  )
}

export function MemoCanvas({
  items,
  categories,
  onClose,
  onEdit,
  onPatch,
  onDelete,
  onRestore,
  onPermanentDelete,
  onPreview,
  onRefresh
}: {
  items: LibraryItem[]
  categories: Category[]
  onClose: () => void
  onEdit: (item: LibraryItem) => void
  onPatch: (item: LibraryItem, changes: BulkItemChanges, label: string) => Promise<boolean>
  onDelete: (item: LibraryItem) => Promise<boolean>
  onRestore: (item: LibraryItem) => Promise<boolean>
  onPermanentDelete: (item: LibraryItem) => Promise<boolean>
  onPreview: (assets: ImageAsset[], index: number) => void
  onRefresh: () => Promise<void>
}) {
  const { theme } = useTheme()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const elementsRef = useRef<readonly ExcalidrawElement[]>([])
  const appStateRef = useRef<AppState | null>(null)
  const filesRef = useRef<Record<string, MemoBinaryFile>>({})
  const knownAssetsRef = useRef(new Set<string>())
  const revisionRef = useRef(0)
  const savedRevisionRef = useRef(0)
  const serverUpdatedAtRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)
  const savingRef = useRef(false)
  const saveAgainRef = useRef(false)
  const readyRef = useRef(false)
  const applyingRemoteRef = useRef(false)
  const lastChangeSignatureRef = useRef('')
  const mountedRef = useRef(true)
  const [initialData, setInitialData] = useState<{
    elements: readonly ExcalidrawElement[]
    appState: Record<string, unknown>
    files: BinaryFiles
  } | null>(null)
  const [background, setBackground] = useState<MemoBackground>('solid')
  const [colorMode, setColorMode] = useState<MemoColorMode>('light')
  const backgroundRef = useRef<MemoBackground>('solid')
  const colorModeRef = useRef<MemoColorMode>('light')
  const [savePhase, setSavePhase] = useState<SavePhase>('loading')
  const [saveMessage, setSaveMessage] = useState('正在打开画布…')
  const [loadError, setLoadError] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [filters, setFilters] = useState<ItemFilters>({ ...DEFAULT_FILTERS })
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [inspectorBusy, setInspectorBusy] = useState(false)
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const fullscreenSupported = typeof document !== 'undefined' &&
    Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen)

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const selectedItem = selectedItemId ? itemById.get(selectedItemId) || null : null

  const appearanceState = useCallback((nextBackground: MemoBackground, nextMode: MemoColorMode) => ({
    theme: nextMode,
    viewBackgroundColor: nextBackground === 'dots' || nextBackground === 'lines'
      ? 'transparent'
      : nextMode === 'dark' ? '#17191f' : '#ffffff',
    gridSize: 20
  }), [])

  const draftFromCurrent = useCallback((updatedAt = Date.now()): MemoDraft => {
    const activeIds = new Set(activeMemoFileIds(elementsRef.current))
    const files = Object.fromEntries(
      Object.entries(filesRef.current)
        .filter(([id]) => activeIds.has(id))
        .map(([id, file]) => [id, { ...file }])
    )
    return {
      scene: {
        elements: elementsRef.current as unknown[],
        appState: appStateRef.current ? persistedMemoAppState(appStateRef.current) : {}
      },
      background: backgroundRef.current,
      colorMode: colorModeRef.current,
      updatedAt,
      files
    }
  }, [])

  const applyLoadedSnapshot = useCallback(async (draft: MemoDraft, knownIds: string[], remote = false) => {
    const normalized = normalizeMemoItemElements(
      draft.scene.elements as unknown as readonly ExcalidrawElement[]
    )
    const restored = restoreElements(
      normalized.elements as Parameters<typeof restoreElements>[0],
      remote ? elementsRef.current : null
    )
    elementsRef.current = restored
    filesRef.current = draft.files
    knownAssetsRef.current = new Set(knownIds)
    backgroundRef.current = draft.background
    colorModeRef.current = draft.colorMode
    setBackground(draft.background)
    setColorMode(draft.colorMode)
    const nextAppState = {
      ...draft.scene.appState,
      ...appearanceState(draft.background, draft.colorMode)
    }
    lastChangeSignatureRef.current = memoChangeSignature(restored, nextAppState, draft.files)
    if (remote && apiRef.current) {
      applyingRemoteRef.current = true
      apiRef.current.addFiles(Object.values(draft.files) as unknown as Parameters<ExcalidrawImperativeAPI['addFiles']>[0])
      apiRef.current.updateScene({
        elements: restored,
        appState: nextAppState,
        captureUpdate: CaptureUpdateAction.NEVER
      })
      window.setTimeout(() => {
        applyingRemoteRef.current = false
      }, 0)
    } else {
      setInitialData({
        elements: restored,
        appState: nextAppState,
        files: draft.files as unknown as BinaryFiles
      })
    }
    return normalized.changed
  }, [appearanceState])

  const loadCanvas = useCallback(async () => {
    setSavePhase('loading')
    setSaveMessage('正在打开画布…')
    setLoadError('')
    const localDraft = await readMemoDraft()
    let server = emptyMemoCanvas()
    let serverFiles: Record<string, MemoBinaryFile> = {}
    let serverError: unknown = null
    if (navigator.onLine) {
      try {
        server = await fetchMemoCanvas()
        serverFiles = await loadMemoBinaryFiles(server.assets)
      } catch (error) {
        serverError = error
      }
    }
    const useDraft = Boolean(localDraft && (!server.updatedAt || localDraft.updatedAt > server.updatedAt))
    if (useDraft && localDraft) {
      serverUpdatedAtRef.current = server.updatedAt
      await applyLoadedSnapshot(localDraft, server.assets.map((asset) => asset.fileId))
      revisionRef.current = 1
      savedRevisionRef.current = 0
      setSavePhase(navigator.onLine ? 'draft' : 'offline')
      setSaveMessage(navigator.onLine ? '已恢复本机草稿，正在等待同步' : '离线草稿已恢复')
      return
    }
    if (serverError && !localDraft) {
      setLoadError(errorMessage(serverError))
      setSavePhase('error')
      setSaveMessage('画布暂时无法打开')
      return
    }
    const source: MemoDraft = localDraft && !server.updatedAt
      ? localDraft
      : {
          scene: server.scene,
          background: server.background,
          colorMode: server.colorMode,
          updatedAt: server.updatedAt,
          files: serverFiles
        }
    serverUpdatedAtRef.current = server.updatedAt
    const normalizedLegacyCards = await applyLoadedSnapshot(source, server.assets.map((asset) => asset.fileId))
    if (normalizedLegacyCards) {
      revisionRef.current = Math.max(revisionRef.current, 1)
      savedRevisionRef.current = 0
      setSavePhase(navigator.onLine ? 'draft' : 'offline')
      setSaveMessage(navigator.onLine ? '已优化旧卡片比例，正在同步' : '已优化旧卡片比例并保存在本机')
    } else {
      setSavePhase(navigator.onLine ? 'saved' : 'offline')
      setSaveMessage(navigator.onLine ? '画布已同步' : '当前离线，修改会保存在本机')
    }
    if (localDraft && server.updatedAt >= localDraft.updatedAt) await clearMemoDraft()
  }, [applyLoadedSnapshot])

  const persistNow = useCallback(async () => {
    if (!readyRef.current || !initialData) return
    if (savingRef.current) {
      saveAgainRef.current = true
      return
    }
    const revision = revisionRef.current
    const draft = draftFromCurrent()
    await writeMemoDraft(draft)
    if (!navigator.onLine) {
      if (mountedRef.current) {
        setSavePhase('offline')
        setSaveMessage('当前离线，画布已安全保存在本机')
      }
      return
    }
    savingRef.current = true
    if (mountedRef.current) {
      setSavePhase('saving')
      setSaveMessage('正在同步画布…')
    }
    try {
      const activeIds = activeMemoFileIds(elementsRef.current)
      for (const fileId of activeIds) {
        if (knownAssetsRef.current.has(fileId)) continue
        const file = filesRef.current[fileId]
        if (!file) throw new Error('画布中的一张图片尚未准备好，请稍后重试')
        await uploadMemoAsset(file)
        knownAssetsRef.current.add(fileId)
      }
      const result = await saveMemoCanvas({
        scene: draft.scene,
        background: draft.background,
        colorMode: draft.colorMode,
        fileIds: activeIds,
        updatedAt: draft.updatedAt
      })
      serverUpdatedAtRef.current = result.updatedAt
      knownAssetsRef.current = new Set(result.assets.map((asset) => asset.fileId))
      savedRevisionRef.current = revision
      if (revision === revisionRef.current) {
        await clearMemoDraft()
        if (mountedRef.current) {
          setSavePhase('saved')
          setSaveMessage('画布已同步')
        }
        channelRef.current?.postMessage({ type: 'saved', updatedAt: result.updatedAt })
      } else {
        saveAgainRef.current = true
      }
    } catch (error) {
      if (mountedRef.current) {
        setSavePhase('error')
        setSaveMessage('同步失败，草稿仍保存在本机：' + errorMessage(error))
      }
    } finally {
      savingRef.current = false
      if (saveAgainRef.current) {
        saveAgainRef.current = false
        window.setTimeout(() => void persistNow(), 0)
      }
    }
  }, [draftFromCurrent, initialData])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void persistNow(), SAVE_DELAY)
  }, [persistNow])

  const refreshRemote = useCallback(async () => {
    if (!navigator.onLine || savingRef.current || revisionRef.current !== savedRevisionRef.current || !apiRef.current) return
    try {
      const server = await fetchMemoCanvas()
      if (server.updatedAt <= serverUpdatedAtRef.current) return
      const files = await loadMemoBinaryFiles(server.assets)
      serverUpdatedAtRef.current = server.updatedAt
      const normalizedLegacyCards = await applyLoadedSnapshot({
        scene: server.scene,
        background: server.background,
        colorMode: server.colorMode,
        updatedAt: server.updatedAt,
        files
      }, server.assets.map((asset) => asset.fileId), true)
      if (normalizedLegacyCards) {
        revisionRef.current += 1
        setSavePhase('draft')
        setSaveMessage('已优化另一台设备上的旧卡片比例，正在同步')
        scheduleSave()
      } else {
        setSavePhase('saved')
        setSaveMessage('已载入另一台设备的最新画布')
      }
    } catch {
      // Keep the current scene intact when a background refresh fails.
    }
  }, [applyLoadedSnapshot, scheduleSave])

  useEffect(() => {
    void loadCanvas()
  }, [loadCanvas])

  useEffect(() => {
    mountedRef.current = true
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = channel
    if (channel) channel.onmessage = () => void refreshRemote()
    const online = () => {
      setSaveMessage('网络已恢复，正在同步画布…')
      void persistNow()
    }
    const visible = () => {
      if (document.visibilityState === 'visible') void refreshRemote()
    }
    const fullscreen = () => setIsBrowserFullscreen(document.fullscreenElement === rootRef.current)
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visible)
    document.addEventListener('fullscreenchange', fullscreen)
    return () => {
      mountedRef.current = false
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      channel?.close()
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', visible)
      document.removeEventListener('fullscreenchange', fullscreen)
    }
  }, [persistNow, refreshRemote])

  useLayoutEffect(() => {
    apiRef.current?.refresh()
  }, [libraryOpen, selectedElementId])

  function changed(
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ) {
    elementsRef.current = elements
    appStateRef.current = appState
    filesRef.current = files as unknown as Record<string, MemoBinaryFile>
    const selected = elements.find((element) => !element.isDeleted && appState.selectedElementIds[element.id])
    const itemId = selected ? memoItemId(selected) : null
    if (itemId) {
      setSelectedItemId(itemId)
      setSelectedElementId(selected?.id || null)
    }
    const signature = memoChangeSignature(elements, appState, files)
    if (!readyRef.current || applyingRemoteRef.current) {
      lastChangeSignatureRef.current = signature
      return
    }
    if (signature === lastChangeSignatureRef.current) return
    lastChangeSignatureRef.current = signature
    revisionRef.current += 1
    setSavePhase(navigator.onLine ? 'draft' : 'offline')
    setSaveMessage(navigator.onLine ? '修改已保存在本机，等待同步' : '当前离线，修改已保存在本机')
    void writeMemoDraft(draftFromCurrent())
    scheduleSave()
  }

  function selectItemReference(element: ExcalidrawElement | null) {
    const itemId = element ? memoItemId(element) : null
    if (!element || !itemId) {
      setSelectedItemId(null)
      setSelectedElementId(null)
      return
    }
    setSelectedItemId(itemId)
    setSelectedElementId(element.id)
    const api = apiRef.current
    if (api && !api.getAppState().selectedElementIds[element.id]) {
      api.setActiveTool({ type: 'selection' })
      api.updateScene({
        appState: {
          selectedElementIds: { [element.id]: true },
          activeEmbeddable: null
        },
        captureUpdate: CaptureUpdateAction.NEVER
      })
    }
  }

  function focusItemReference(api: ExcalidrawImperativeAPI, element: ExcalidrawElement) {
    selectItemReference(element)
    setLibraryOpen(false)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (apiRef.current !== api) return
        api.scrollToContent(element, {
          animate: false,
          fitToViewport: true,
          viewportZoomFactor: 0.7,
          maxZoom: 1
        })
        api.updateScene({
          appState: { selectedElementIds: { [element.id]: true } },
          captureUpdate: CaptureUpdateAction.NEVER
        })
      })
    })
  }

  function pointerUp(_tool: AppState['activeTool'], pointerDownState: PointerDownState) {
    if (pointerDownState.drag.hasOccurred || pointerDownState.resize.isResizing) return
    selectItemReference(pointerDownState.hit.element)
  }

  function addItem(itemId: string, point?: { x: number; y: number }) {
    const api = apiRef.current
    const stage = stageRef.current
    if (!api || !stage) return
    const current = api.getSceneElementsIncludingDeleted()
    const existing = findMemoItemElement(current, itemId)
    if (existing) {
      api.updateScene({
        appState: { selectedElementIds: { [existing.id]: true } },
        captureUpdate: CaptureUpdateAction.NEVER
      })
      focusItemReference(api, existing)
      api.setToast({ message: '这条内容已经在画布中，已为你定位。' })
      return
    }
    const appState = api.getAppState()
    const bounds = stage.getBoundingClientRect()
    const center = point || viewportCoordsToSceneCoords({
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2
    }, appState)
    const placement = point
      ? { x: point.x - MEMO_ITEM_WIDTH / 2, y: point.y - MEMO_ITEM_HEIGHT / 2 }
      : findMemoItemPlacement(current, center)
    const raw = createMemoItemElement(itemId, placement.x, placement.y)
    const next = restoreElements(
      [...current, raw] as Parameters<typeof restoreElements>[0],
      current
    )
    api.updateScene({
      elements: next,
      appState: { selectedElementIds: { [raw.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    const inserted = next.find((element) => element.id === raw.id) || raw
    focusItemReference(api, inserted)
  }

  function dropItem(event: DragEvent<HTMLDivElement>) {
    const itemId = event.dataTransfer.getData('application/x-do-it-laaaaaater-item')
    if (!itemId) return
    event.preventDefault()
    const api = apiRef.current
    if (!api) return
    const point = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, api.getAppState())
    addItem(itemId, point)
  }

  function removeReference(elementId: string) {
    const api = apiRef.current
    if (!api) return
    const next = removeMemoItemReference(api.getSceneElementsIncludingDeleted(), elementId)
    api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    setSelectedItemId(null)
    setSelectedElementId(null)
  }

  function selectReferenceForAdjustment(elementId: string) {
    const api = apiRef.current
    if (!api) return
    const element = api.getSceneElementsIncludingDeleted().find((entry) => entry.id === elementId && !entry.isDeleted)
    if (!element || !memoItemId(element)) return
    api.setActiveTool({ type: 'selection' })
    api.updateScene({
      appState: {
        selectedElementIds: { [element.id]: true },
        activeEmbeddable: null
      },
      captureUpdate: CaptureUpdateAction.NEVER
    })
    selectItemReference(element)
    api.setToast({ message: '卡片已选中，可以拖动边框或控制点来移动、缩放和旋转。' })
  }

  function changeBackground(next: MemoBackground) {
    backgroundRef.current = next
    setBackground(next)
    apiRef.current?.updateScene({
      appState: appearanceState(next, colorModeRef.current),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    revisionRef.current += 1
    void writeMemoDraft(draftFromCurrent())
    scheduleSave()
  }

  function changeMode(next: MemoColorMode) {
    colorModeRef.current = next
    setColorMode(next)
    apiRef.current?.updateScene({
      appState: appearanceState(backgroundRef.current, next),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    revisionRef.current += 1
    void writeMemoDraft(draftFromCurrent())
    scheduleSave()
  }

  async function closeCanvas() {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    await writeMemoDraft(draftFromCurrent())
    if (navigator.onLine && revisionRef.current !== savedRevisionRef.current) await persistNow()
    if (document.fullscreenElement === rootRef.current) await document.exitFullscreen().catch(() => undefined)
    onClose()
  }

  async function toggleBrowserFullscreen() {
    if (!rootRef.current || !fullscreenSupported) return
    if (document.fullscreenElement === rootRef.current) await document.exitFullscreen()
    else await rootRef.current.requestFullscreen()
  }

  async function withInspectorAction(action: () => Promise<boolean>) {
    if (inspectorBusy) return
    setInspectorBusy(true)
    try {
      if (await action()) await onRefresh()
    } finally {
      setInspectorBusy(false)
    }
  }

  if (loadError && !initialData) {
    return (
      <div className="memo-canvas-overlay">
        <div className="memo-load-error">
          <AppIcon name="warning" size={34} />
          <h2>备忘录画布暂时无法打开</h2>
          <p>{loadError}</p>
          <Button type="primary" onClick={() => void loadCanvas()}>重试</Button>
          <Button onClick={onClose}>返回清单</Button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`memo-canvas-overlay memo-site-${theme} memo-mode-${colorMode}`}
      role="dialog"
      aria-modal="true"
      aria-label="备忘录无限画布"
    >
      <header className="memo-canvas-header">
        <div className="memo-canvas-brand">
          <AppIcon name="memo" size={28} />
          <div><h1>备忘录</h1><span>唯一画布 · 自动保存</span></div>
        </div>
        <div className="memo-canvas-controls">
          <Button
            type={libraryOpen ? 'primary' : 'default'}
            icon={<AppIcon name="library" size={20} />}
            onClick={() => setLibraryOpen((open) => !open)}
          >
            资料库
          </Button>
          <div className="memo-background-switcher" role="group" aria-label="画布背景">
            {([
              ['solid', '纯色'],
              ['grid', '网格'],
              ['dots', '点阵'],
              ['lines', '横线']
            ] as Array<[MemoBackground, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={background === value ? 'is-active' : ''}
                aria-pressed={background === value}
                onClick={() => changeBackground(value)}
              >
                <AppIcon name={value === 'solid' ? 'background' : value} size={17} />{label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="memo-mode-toggle"
            aria-label={colorMode === 'light' ? '切换到夜间画布' : '切换到昼间画布'}
            aria-pressed={colorMode === 'dark'}
            onClick={() => changeMode(colorMode === 'light' ? 'dark' : 'light')}
          >
            <AppIcon name={colorMode === 'light' ? 'moon' : 'sun'} size={19} />
            {colorMode === 'light' ? '夜间' : '昼间'}
          </button>
          {fullscreenSupported && (
            <button type="button" className="memo-icon-button" aria-label={isBrowserFullscreen ? '退出浏览器全屏' : '浏览器全屏'} onClick={() => void toggleBrowserFullscreen()}>
              <AppIcon name={isBrowserFullscreen ? 'fullscreenExit' : 'fullscreen'} size={21} />
            </button>
          )}
          <button type="button" className="memo-icon-button memo-close-button" aria-label="关闭备忘录" onClick={() => void closeCanvas()}>
            <AppIcon name="close" size={22} />
          </button>
        </div>
        <div className={`memo-save-state is-${savePhase}`} role="status" aria-live="polite">
          <i />
          <span>{saveMessage}</span>
          {savePhase === 'error' && <button type="button" onClick={() => void persistNow()}>重试</button>}
        </div>
      </header>
      <div className="memo-canvas-workspace">
        {libraryOpen && (
          <MemoLibrary
            items={items.filter((item) => !item.trashedAt)}
            categories={categories}
            filters={filters}
            onFilters={setFilters}
            onAdd={addItem}
            onClose={() => setLibraryOpen(false)}
          />
        )}
        <div
          ref={stageRef}
          className={`memo-canvas-stage memo-bg-${background}`}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-do-it-laaaaaater-item')) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={dropItem}
        >
          {initialData ? (
            <>
              <Excalidraw
                initialData={initialData}
                excalidrawAPI={(api) => {
                  apiRef.current = api
                  appStateRef.current = api.getAppState()
                  window.requestAnimationFrame(() => {
                    readyRef.current = true
                    if (revisionRef.current > savedRevisionRef.current) scheduleSave()
                  })
                }}
                langCode="zh-CN"
                theme={colorMode}
                gridModeEnabled={background === 'grid'}
                handleKeyboardGlobally
                autoFocus
                validateEmbeddable={() => true}
                renderEmbeddable={(element, appState) => (
                  <MemoReferenceCard
                    element={element}
                    item={itemById.get(memoItemId(element) || '') || null}
                    selected={Boolean(appState.selectedElementIds[element.id])}
                  />
                )}
                onChange={changed}
                onPointerUp={pointerUp}
                onLinkOpen={(element, event) => {
                  const itemId = memoItemId(element)
                  if (!itemId) return
                  event.preventDefault()
                  const item = itemById.get(itemId)
                  if (!item) return
                  if (item.kind === 'link' && item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
                  else if (item.kind === 'image_group' && manualAssets(item).length) onPreview(manualAssets(item), 0)
                  else onEdit(item)
                }}
                UIOptions={{
                  canvasActions: {
                    loadScene: false,
                    saveToActiveFile: false,
                    toggleTheme: false,
                    changeViewBackgroundColor: false
                  }
                }}
              />
              {(background === 'dots' || background === 'lines') && <div className="memo-pattern-layer" aria-hidden="true" />}
            </>
          ) : (
            <div className="memo-canvas-loading"><span className="spinner" /><p>正在准备画布工具…</p></div>
          )}
        </div>
        {selectedElementId && (
          <MemoItemInspector
            item={selectedItem}
            categories={categories}
            elementId={selectedElementId}
            busy={inspectorBusy}
            onClose={() => { setSelectedItemId(null); setSelectedElementId(null) }}
            onSelectForAdjustment={selectReferenceForAdjustment}
            onEdit={onEdit}
            onPatch={async (item, changes, label) => {
              setInspectorBusy(true)
              try {
                return await onPatch(item, changes, label)
              } finally {
                setInspectorBusy(false)
              }
            }}
            onRemoveReference={removeReference}
            onDelete={(item) => withInspectorAction(() => onDelete(item)).then(() => true)}
            onRestore={(item) => withInspectorAction(() => onRestore(item)).then(() => true)}
            onPermanentDelete={(item) => withInspectorAction(() => onPermanentDelete(item)).then(() => true)}
            onPreview={onPreview}
          />
        )}
      </div>
    </div>
  )
}
