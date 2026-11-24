import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { ApiRequestError, api, errorMessage, jsonRequest } from '../api'
import { discardDraft, loadDraft, saveDraft } from '../draft-store'
import type { Category, LibraryItem } from '../types'
import { AppIcon } from './AppIcon'
import { CategoryPickerPopover } from './CategoryPickerPopover'
import { validateImageFiles } from './FormFields'
import { Modal } from './Modal'

export interface SmartAddInitial {
  url?: string
  title?: string
  text?: string
  files?: File[]
  draftKey?: string
}

export interface SmartAddModalProps {
  categories: Category[]
  defaultCategoryId?: string | null
  aiCoverAuto?: boolean
  initial?: SmartAddInitial
  onCreateCategory: (name: string, color: string) => Promise<Category>
  onSaved?: (item: LibraryItem) => void
  onDuplicate: (id: string) => void
  onClose: () => void
}

interface MetadataResult {
  url: string
  normalizedUrl: string
  title: string
  siteName: string
  coverUrl: string
}

const DEFAULT_DRAFT_KEY = 'smart-add'
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
const SUBMIT_KBD = IS_MAC ? '⌘↵' : 'Ctrl↵'

export function parseWebUrl(value: string): string {
  let candidate = value
    .trim()
    .replace(/^[<（(【[]+/, '')
    .replace(/[>）)】\],，。.!！?？;；:：]+$/, '')
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

function extractUrlFromInput(raw: string): { url: string; remainder: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { url: '', remainder: '' }
  const direct = parseWebUrl(trimmed)
  if (direct) return { url: direct, remainder: '' }
  const embeddedMatch = trimmed.match(/https?:\/\/[^\s<>"']+/i)
  if (embeddedMatch) {
    const candidate = parseWebUrl(embeddedMatch[0])
    if (candidate) {
      const remainder = trimmed.replace(embeddedMatch[0], ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
      return { url: candidate, remainder }
    }
  }
  return { url: '', remainder: '' }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function defaultImageGroupTitle() {
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date())
  return `图片 ${date}`
}

function ThumbPreview({
  file,
  index,
  onRemove
}: {
  file: File
  index: number
  onRemove: () => void
}) {
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return (
    <div className="smart-add-thumb">
      {previewUrl && <img src={previewUrl} alt={file.name} />}
      <span className="smart-add-thumb-index">{index + 1}</span>
      <button
        type="button"
        className="smart-add-thumb-remove"
        aria-label={`移除第 ${index + 1} 张图片`}
        onClick={onRemove}
      >
        <AppIcon name="close" size={12} />
      </button>
    </div>
  )
}

export function SmartAddModal({
  categories,
  defaultCategoryId = null,
  aiCoverAuto = false,
  initial,
  onCreateCategory,
  onSaved,
  onDuplicate,
  onClose
}: SmartAddModalProps) {
  const fileInputId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const catTriggerRef = useRef<HTMLButtonElement>(null)
  const metadataReqRef = useRef(0)
  const lastFetchedUrlRef = useRef('')
  const pastedUrlRef = useRef(false)

  const validDefaultCatId = useMemo(() => {
    if (defaultCategoryId && categories.some((category) => category.id === defaultCategoryId)) {
      return defaultCategoryId
    }
    return null
  }, [categories, defaultCategoryId])

  const initialInputText = initial?.url
    ? initial.url
    : (initial?.text || '')

  const [rawInput, setRawInput] = useState(initialInputText)
  const [linkTitle, setLinkTitle] = useState(initial?.title || '')
  const [titleTouched, setTitleTouched] = useState(Boolean(initial?.title))
  const [coverUrl, setCoverUrl] = useState('')
  const [coverVisible, setCoverVisible] = useState(true)
  const [normalizedUrl, setNormalizedUrl] = useState('')
  const [forceText, setForceText] = useState(false)
  const [files, setFiles] = useState<File[]>(() => initial?.files || [])
  const [categoryId, setCategoryId] = useState<string | null>(validDefaultCatId)
  const [catPickerOpen, setCatPickerOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchHint, setFetchHint] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState<{ id: string; trashed: boolean } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [draftReady, setDraftReady] = useState(false)

  const draftKey = initial?.draftKey || DEFAULT_DRAFT_KEY

  const extracted = useMemo(() => extractUrlFromInput(rawInput), [rawInput])
  const detectedUrl = extracted.url
  const mode: 'link' | 'image_group' | 'text' = detectedUrl && !forceText
    ? 'link'
    : files.length > 0
      ? 'image_group'
      : 'text'

  // Sync default category if categories finish loading after mount and user hasn't picked one
  const userPickedCategoryRef = useRef(false)
  useEffect(() => {
    if (!userPickedCategoryRef.current && validDefaultCatId && categoryId === null) {
      setCategoryId(validDefaultCatId)
    }
  }, [categoryId, validDefaultCatId])

  // Load saved draft if modal opened fresh or via draft recovery
  useEffect(() => {
    let active = true
    const hasExplicitInitial = Boolean(
      initial?.url || initial?.text || (initial?.files && initial.files.length > 0)
    )
    if (hasExplicitInitial && !initial?.draftKey) {
      setDraftReady(true)
      return () => { active = false }
    }
    void loadDraft(draftKey).then((draft) => {
      if (!active || !draft) return
      const data = draft.data || {}
      if (data.rawInput !== undefined) {
        setRawInput(String(data.rawInput || ''))
      } else if (data.url) {
        setRawInput(String(data.url || ''))
      } else if (data.title) {
        setRawInput(String(data.title || ''))
      }
      if (data.linkTitle) {
        setLinkTitle(String(data.linkTitle))
        setTitleTouched(true)
      } else if (data.url && data.title) {
        setLinkTitle(String(data.title))
        setTitleTouched(true)
      }
      if (data.coverUrl) {
        setCoverUrl(String(data.coverUrl))
        setCoverVisible(true)
      }
      if (typeof data.categoryId === 'string' && data.categoryId) {
        userPickedCategoryRef.current = true
        setCategoryId(data.categoryId)
      }
      if (draft.files?.length) {
        setFiles(draft.files)
      }
    }).finally(() => {
      if (active) setDraftReady(true)
    })
    return () => { active = false }
  }, [draftKey, initial?.draftKey, initial?.files, initial?.text, initial?.url])

  // Auto-save draft while typing
  useEffect(() => {
    if (!draftReady) return
    if (!rawInput.trim() && !linkTitle.trim() && !files.length) return
    const timer = window.setTimeout(() => {
      void saveDraft({
        key: draftKey,
        type: mode === 'link' ? 'link' : mode === 'image_group' ? 'images' : 'text',
        data: {
          rawInput,
          linkTitle,
          coverUrl,
          categoryId: categoryId || ''
        },
        files
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [categoryId, coverUrl, draftKey, draftReady, files, linkTitle, mode, rawInput])

  // Focus input on mount (cursor at the end so pasted / restored content can be appended)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      const end = textarea.value.length
      textarea.setSelectionRange(end, end)
    }, 30)
    return () => window.clearTimeout(timer)
  }, [])

  // Live metadata fetch when a URL is detected
  async function fetchMetadata(targetUrl: string, force = false) {
    if (!targetUrl) return
    if (!force && lastFetchedUrlRef.current === targetUrl) return
    lastFetchedUrlRef.current = targetUrl
    const reqId = ++metadataReqRef.current
    setFetching(true)
    setFetchHint('')
    try {
      const metadata = await jsonRequest<MetadataResult>('/api/metadata', 'POST', { url: targetUrl })
      if (reqId !== metadataReqRef.current) return
      setNormalizedUrl(metadata.normalizedUrl || targetUrl)
      if (!titleTouched || !linkTitle.trim()) {
        setLinkTitle(metadata.title || extracted.remainder || hostOf(targetUrl))
      }
      setCoverUrl(metadata.coverUrl || '')
      setCoverVisible(Boolean(metadata.coverUrl))
    } catch {
      if (reqId !== metadataReqRef.current) return
      setNormalizedUrl(targetUrl)
      setFetchHint('未能自动读取网页标题，可直接手动输入')
    } finally {
      if (reqId === metadataReqRef.current) setFetching(false)
    }
  }

  useEffect(() => {
    if (mode !== 'link' || !detectedUrl) {
      setFetchHint('')
      setFetching(false)
      return
    }
    setDuplicate(null)
    if (!titleTouched && extracted.remainder && !linkTitle) {
      setLinkTitle(extracted.remainder)
    }
    const instant = pastedUrlRef.current || Boolean(initial?.url && detectedUrl === parseWebUrl(initial.url))
    pastedUrlRef.current = false
    const delay = instant ? 0 : 380
    const timer = window.setTimeout(() => {
      void fetchMetadata(detectedUrl)
    }, delay)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedUrl, mode])

  function addImages(incoming: File[]) {
    if (!incoming.length) return
    const result = validateImageFiles(incoming, files.length)
    if (result.error) setError(result.error)
    else setError('')
    if (result.accepted.length) {
      setFiles((current) => [...current, ...result.accepted])
    }
  }

  function handlePaste(event: ReactClipboardEvent) {
    const pastedImages = Array.from(event.clipboardData?.files || []).filter((file) =>
      file.type.startsWith('image/')
    )
    if (pastedImages.length) {
      event.preventDefault()
      addImages(pastedImages)
      return
    }
    // Pasted URL text: skip the typing debounce so metadata loads instantly.
    const pastedText = event.clipboardData?.getData('text') || ''
    if (pastedText && extractUrlFromInput(pastedText).url) pastedUrlRef.current = true
  }

  function handleDrop(event: ReactDragEvent) {
    event.preventDefault()
    setDragOver(false)
    const dropped = Array.from(event.dataTransfer?.files || [])
    if (dropped.length) {
      addImages(dropped)
    }
  }

  function handleCancel() {
    void discardDraft(draftKey)
    onClose()
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (saving) return

    const trimmed = rawInput.trim()
    if (mode === 'text' && !trimmed) {
      setError('请输入文字、粘贴网址或添加图片')
      return
    }
    if (mode === 'image_group' && !files.length) {
      setError('请至少添加一张图片')
      return
    }

    setSaving(true)
    setError('')
    setDuplicate(null)

    try {
      let saved: LibraryItem
      if (mode === 'link') {
        const finalUrl = normalizedUrl || detectedUrl
        const finalTitle = (linkTitle.trim() || extracted.remainder || hostOf(finalUrl)).slice(0, 300)
        const form = new FormData()
        form.set('url', finalUrl)
        form.set('title', finalTitle)
        form.set('categoryId', categoryId || '')
        form.set('coverUrl', coverVisible ? coverUrl : '')
        files.forEach((file) => form.append('images', file))
        saved = await api<LibraryItem>('/api/items/link', { method: 'POST', body: form })
      } else if (mode === 'image_group') {
        const title = (trimmed || defaultImageGroupTitle()).slice(0, 300)
        const form = new FormData()
        form.set('title', title)
        form.set('categoryId', categoryId || '')
        files.forEach((file) => form.append('images', file))
        saved = await api<LibraryItem>('/api/items/image-group', { method: 'POST', body: form })
      } else {
        saved = await jsonRequest<LibraryItem>('/api/items/text', 'POST', {
          title: trimmed.slice(0, 300),
          categoryId: categoryId || null
        })
      }
      await discardDraft(draftKey)
      onSaved?.(saved)
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status === 409) {
        const details = requestError.details as { existingId?: string; trashed?: boolean } | undefined
        if (details?.existingId) {
          setDuplicate({ id: details.existingId, trashed: Boolean(details.trashed) })
        }
        setError(details?.trashed ? '这个网页在回收站中，可先恢复原条目。' : '这个网页已经保存过了。')
      } else {
        setError(errorMessage(requestError))
      }
    } finally {
      setSaving(false)
    }
  }

  function handleFormKeyDown(event: ReactKeyboardEvent) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    } else if (event.altKey && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'c') {
      // Alt+C: jump straight into the category picker without leaving the keyboard.
      event.preventDefault()
      setCatPickerOpen((value) => !value)
    }
  }

  const selectedCategory = categories.find((category) => category.id === categoryId) || null
  const modeLabel = mode === 'link'
    ? (files.length ? `网页 + ${files.length} 张附图` : '网页链接')
    : mode === 'image_group'
      ? `图片组 (${files.length})`
      : '文字备忘'
  const submitLabel = saving
    ? '保存中…'
    : mode === 'link'
      ? '保存网页'
      : mode === 'image_group'
        ? '保存图片'
        : '保存文本'
  const canSubmit = !saving && (
    mode === 'link'
      ? Boolean(detectedUrl)
      : mode === 'image_group'
        ? files.length > 0
        : Boolean(rawInput.trim())
  )

  return (
    <Modal title="快速添加" onClose={onClose} wide>
      <form
        className="smart-add-form"
        aria-busy={fetching || saving}
        onSubmit={submit}
        onPaste={handlePaste}
        onKeyDown={handleFormKeyDown}
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes('Files')) {
            event.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragOver(false)
        }}
        onDrop={handleDrop}
      >
        {error && (
          <div className="notice notice-error smart-add-notice" role="alert">
            <span>{error}</span>
            {duplicate && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  void discardDraft(draftKey)
                  onDuplicate(duplicate.id)
                }}
              >
                {duplicate.trashed ? '前往回收站查看' : '打开已有条目'}
              </button>
            )}
          </div>
        )}

        <div className={`smart-add-box${dragOver ? ' is-dragover' : ''}`}>
          <textarea
            ref={textareaRef}
            className="smart-add-input"
            rows={mode === 'link' ? 2 : 3}
            maxLength={mode === 'link' ? 2048 : 300}
            placeholder="粘贴网址、输入备忘文字，或拖入 / Ctrl+V 粘贴图片…"
            aria-label="内容或网址"
            value={rawInput}
            onChange={(event) => {
              setRawInput(event.target.value)
              setError('')
              setDuplicate(null)
              if (forceText && !extractUrlFromInput(event.target.value).url) {
                setForceText(false)
              }
            }}
          />

          <div className="smart-add-box-bar">
            <span className="badge badge-indigo smart-add-mode-badge">
              <AppIcon name={mode === 'link' ? 'link' : mode === 'image_group' ? 'image' : 'text'} size={12} />
              {modeLabel}
            </span>
            {detectedUrl && (
              <button
                type="button"
                className="btn btn-text btn-sm"
                onClick={() => setForceText((value) => !value)}
              >
                {forceText ? '按网页链接保存' : '改为纯文本'}
              </button>
            )}
            {!dragOver && fetching && mode === 'link' && (
              <span className="smart-add-ai-hint" role="status">
                <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} aria-hidden="true" />
                正在读取网页信息…
              </span>
            )}
            {dragOver && <span className="smart-add-drop-hint">松开以添加图片</span>}
            {!dragOver && !fetching && aiCoverAuto && mode !== 'image_group' && !(mode === 'link' && coverUrl && coverVisible) && (
              <span className="smart-add-ai-hint">
                <AppIcon name="sparkles" size={12} />保存后自动生成 AI 封面
              </span>
            )}
          </div>
        </div>

        {mode === 'link' && detectedUrl && (
          <div className="smart-add-link-preview">
            {coverUrl && coverVisible && (
              <div className="smart-add-cover">
                <img src={coverUrl} alt="" />
                <button
                  type="button"
                  className="smart-add-cover-remove"
                  aria-label="移除网页封面"
                  onClick={() => setCoverVisible(false)}
                >
                  <AppIcon name="close" size={12} />
                </button>
              </div>
            )}
            <div className="smart-add-link-meta">
              <input
                type="text"
                className="input smart-add-title-input"
                maxLength={300}
                placeholder={fetching ? '正在获取网页标题…' : '网页标题（可编辑）'}
                aria-label="网页标题"
                value={linkTitle}
                onChange={(event) => {
                  setLinkTitle(event.target.value)
                  setTitleTouched(true)
                }}
              />
              <div className="smart-add-link-sub">
                <span className="smart-add-host">{hostOf(normalizedUrl || detectedUrl)}</span>
                <button
                  type="button"
                  className="btn btn-text btn-sm"
                  disabled={fetching}
                  onClick={() => void fetchMetadata(detectedUrl, true)}
                >
                  <AppIcon name="sync" size={12} />
                  {fetching ? '获取中…' : '刷新信息'}
                </button>
                {fetchHint && <span className="field-hint">{fetchHint}</span>}
              </div>
            </div>
          </div>
        )}

        {files.length > 0 && (
          <div className="smart-add-images">
            <div className="smart-add-thumb-grid">
              {files.map((file, index) => (
                <ThumbPreview
                  key={`${file.name}:${file.size}:${index}`}
                  file={file}
                  index={index}
                  onRemove={() => setFiles((current) => current.filter((_, i) => i !== index))}
                />
              ))}
            </div>
          </div>
        )}

        <div className="smart-add-footer">
          <div className="smart-add-tools">
            <button
              ref={catTriggerRef}
              type="button"
              className="pill smart-add-cat-btn"
              aria-expanded={catPickerOpen}
              aria-haspopup="dialog"
              title="选择类别 (Alt+C)"
              onClick={() => setCatPickerOpen((value) => !value)}
            >
              <span
                className="cat-dot"
                style={{ backgroundColor: selectedCategory?.color || '#a3a3a3' }}
                aria-hidden="true"
              />
              <span>{selectedCategory?.name || '未分类'}</span>
              <AppIcon name="chevronDown" size={13} />
            </button>

            <label htmlFor={fileInputId} className="btn btn-subtle btn-sm smart-add-file-btn">
              <AppIcon name="image" size={14} />
              <span>{files.length ? `附图 (${files.length})` : '添加图片'}</span>
            </label>
            <input
              id={fileInputId}
              type="file"
              className="visually-hidden"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => {
                addImages(Array.from(event.target.files || []))
                event.target.value = ''
              }}
            />
          </div>

          <div className="smart-add-submit">
            <button type="button" className="btn btn-text btn-sm" onClick={handleCancel}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              <span>{submitLabel}</span>
              <kbd className="smart-add-kbd">{SUBMIT_KBD}</kbd>
            </button>
          </div>
        </div>

        <CategoryPickerPopover
          open={catPickerOpen}
          anchor={catTriggerRef.current}
          categories={categories}
          selectedId={categoryId}
          onSelect={(nextId) => {
            userPickedCategoryRef.current = true
            setCategoryId(nextId)
            // Hand focus back to the input so the user can hit Ctrl+Enter immediately.
            window.setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 0)
          }}
          onCreateCategory={onCreateCategory}
          onClose={() => setCatPickerOpen(false)}
        />
      </form>
    </Modal>
  )
}
