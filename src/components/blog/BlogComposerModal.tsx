import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent
} from 'react'
import { createPortal } from 'react-dom'
import { api, errorMessage } from '../../api'
import {
  createBlogPost,
  fetchBlogUrlPreview,
  importLibraryItemToBlog,
  updateBlogPost,
  uploadBlogMedia
} from '../../blog-api'
import { generateExcerpt, renderArticleMarkdown } from '../../blog-markdown'
import type {
  BlogImageItem,
  BlogImportedItemDraft,
  BlogLinkCard,
  BlogPostDetail,
  BlogPostInput,
  BlogPostSummary,
  BlogPostType,
  BlogVisibility
} from '../../blog-types'
import type { LibraryItem } from '../../types'
import { AppIcon } from '../AppIcon'
import { showToast } from '../Toast'

export interface BlogComposerModalProps {
  open: boolean
  initialType?: BlogPostType
  editingPost?: BlogPostSummary | null
  importedDraft?: BlogImportedItemDraft | null
  existingCategories: string[]
  onClose: () => void
  onSaved: (post: BlogPostDetail, isNew: boolean) => void
}

const MAX_MOMENT_IMAGES = 9
const QUICK_EMOJIS = ['😊', '✨', '🎉', '☕', '📸', '📚', '💡', '🌙'] as const

function detectBlogTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const theme = document.querySelector<HTMLElement>('.blog-root')?.getAttribute('data-blog-theme')
  return theme === 'dark' ? 'dark' : 'light'
}

function parseTagsInput(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const token of raw.split(/[,，\s]+/)) {
    const cleaned = token.trim().replace(/^#+/, '').trim()
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
  }
  return result
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function sanitizeFilenameAlt(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[\[\]()]/g, '').trim()
  return base || 'image'
}

function extractClipboardImageFiles(event: ClipboardEvent<HTMLTextAreaElement>): File[] {
  const files: File[] = []
  const items = event.clipboardData?.items
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
  }
  if (!files.length && event.clipboardData?.files?.length) {
    for (let i = 0; i < event.clipboardData.files.length; i += 1) {
      const file = event.clipboardData.files[i]
      if (file.type.startsWith('image/')) files.push(file)
    }
  }
  return files
}

export function BlogComposerModal({
  open,
  initialType = 'moment',
  editingPost = null,
  importedDraft = null,
  existingCategories,
  onClose,
  onSaved
}: BlogComposerModalProps) {
  const categoryListId = useId()
  const isEditing = Boolean(editingPost)

  const [blogTheme, setBlogTheme] = useState<'light' | 'dark'>('light')
  const [isMobile, setIsMobile] = useState(false)
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')

  // Core post fields
  const [type, setType] = useState<BlogPostType>(initialType)
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [content, setContent] = useState('')
  const [coverMediaId, setCoverMediaId] = useState<string | null>(null)
  const [coverUrl, setCoverUrl] = useState('')
  const [category, setCategory] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [images, setImages] = useState<BlogImageItem[]>([])
  const [linkCard, setLinkCard] = useState<BlogLinkCard | null>(null)
  const [linkSectionOpen, setLinkSectionOpen] = useState(false)
  const [linkUrlInput, setLinkUrlInput] = useState('')
  const [locationName, setLocationName] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [sourceItemId, setSourceItemId] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<BlogVisibility>('public')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isPinned, setIsPinned] = useState(false)

  // Reading-list import picker state
  const [importPickerOpen, setImportPickerOpen] = useState(false)
  const [importItems, setImportItems] = useState<LibraryItem[]>([])
  const [importLoaded, setImportLoaded] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importSearch, setImportSearch] = useState('')
  const [importingItemId, setImportingItemId] = useState<string | null>(null)

  // Async & drag state
  const [saving, setSaving] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingInlineImage, setUploadingInlineImage] = useState(false)
  const [fetchingLink, setFetchingLink] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [error, setError] = useState('')

  const momentTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const articleTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const momentFileInputRef = useRef<HTMLInputElement | null>(null)
  const coverFileInputRef = useRef<HTMLInputElement | null>(null)
  const inlineImageInputRef = useRef<HTMLInputElement | null>(null)

  const busy =
    saving ||
    uploadingImages ||
    uploadingCover ||
    uploadingInlineImage ||
    fetchingLink ||
    Boolean(importingItemId)

  // Detect responsive mobile viewport
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 768px)')
    const sync = () => setIsMobile(media.matches)
    sync()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync)
      return () => media.removeEventListener('change', sync)
    }
    media.addListener(sync)
    return () => media.removeListener(sync)
  }, [])

  // Populate / reset form whenever modal opens
  useEffect(() => {
    if (!open) return
    setBlogTheme(detectBlogTheme())
    setError('')
    setMobileView('edit')
    setImportPickerOpen(false)
    setImportSearch('')
    setImportingItemId(null)
    setShowPassword(false)
    setDraggingIndex(null)

    if (editingPost) {
      setType(editingPost.type)
      setTitle(editingPost.title || '')
      setExcerpt(editingPost.excerpt || '')
      setContent(editingPost.content || '')
      setCoverMediaId(editingPost.coverMediaId ?? null)
      setCoverUrl(editingPost.coverUrl || '')
      setCategory(editingPost.category || '')
      setTagsText((editingPost.tags || []).join(', '))
      setImages(editingPost.images ? editingPost.images.slice(0, MAX_MOMENT_IMAGES) : [])
      setLinkCard(editingPost.linkCard ? { ...editingPost.linkCard } : null)
      setLinkUrlInput(editingPost.linkCard?.url || '')
      setLinkSectionOpen(Boolean(editingPost.linkCard))
      setLocationName(editingPost.locationName || '')
      setSourceLabel(editingPost.sourceLabel || '')
      setSourceItemId(editingPost.sourceItemId ?? null)
      setVisibility(editingPost.visibility || 'public')
      setPassword('')
      setIsPinned(Boolean(editingPost.isPinned))
      return
    }

    if (importedDraft) {
      setType(importedDraft.type || initialType)
      setTitle(importedDraft.title || '')
      setExcerpt('')
      setContent(importedDraft.content || '')
      setCoverMediaId(importedDraft.coverMediaId ?? null)
      setCoverUrl(importedDraft.coverUrl || '')
      setCategory(importedDraft.category || '')
      setTagsText('')
      setImages(importedDraft.images ? importedDraft.images.slice(0, MAX_MOMENT_IMAGES) : [])
      setLinkCard(importedDraft.linkCard ? { ...importedDraft.linkCard } : null)
      setLinkUrlInput(importedDraft.linkCard?.url || '')
      setLinkSectionOpen(Boolean(importedDraft.linkCard))
      setLocationName('')
      setSourceLabel(importedDraft.sourceLabel || '')
      setSourceItemId(importedDraft.sourceItemId || null)
      setVisibility('public')
      setPassword('')
      setIsPinned(false)
      return
    }

    setType(initialType)
    setTitle('')
    setExcerpt('')
    setContent('')
    setCoverMediaId(null)
    setCoverUrl('')
    setCategory('')
    setTagsText('')
    setImages([])
    setLinkCard(null)
    setLinkUrlInput('')
    setLinkSectionOpen(false)
    setLocationName('')
    setSourceLabel('')
    setSourceItemId(null)
    setVisibility('public')
    setPassword('')
    setIsPinned(false)
  }, [open, editingPost, importedDraft, initialType])

  // Escape key & body scroll lock
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, busy, onClose])

  // Lazy-load reading list items when import picker opens
  useEffect(() => {
    if (!open || !importPickerOpen || importLoaded || importLoading) return
    let cancelled = false
    setImportLoading(true)
    api<LibraryItem[]>('/api/items?trash=active&status=all')
      .then((items) => {
        if (cancelled) return
        setImportItems(Array.isArray(items) ? items : [])
        setImportLoaded(true)
      })
      .catch((err) => {
        if (cancelled) return
        showToast('error', errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setImportLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, importPickerOpen, importLoaded, importLoading])

  const uniqueCategories = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const cat of existingCategories) {
      const trimmed = cat.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      list.push(trimmed)
    }
    return list
  }, [existingCategories])

  const filteredImportItems = useMemo(() => {
    const q = importSearch.trim().toLowerCase()
    const source = importItems
    if (!q) return source.slice(0, 30)
    return source
      .filter((item) => {
        const titleMatch = item.title.toLowerCase().includes(q)
        const urlMatch = (item.url || '').toLowerCase().includes(q)
        const catMatch = (item.category?.name || '').toLowerCase().includes(q)
        return titleMatch || urlMatch || catMatch
      })
      .slice(0, 30)
  }, [importItems, importSearch])

  const renderedPreview = useMemo(() => {
    if (type !== 'article') {
      return { html: '', headings: [], wordCount: 0, readingMinutes: 1 }
    }
    return renderArticleMarkdown(content)
  }, [type, content])

  // Insert text into a controlled textarea at cursor position
  const insertAtCursor = useCallback(
    (
      textarea: HTMLTextAreaElement | null,
      prefix: string,
      suffix = '',
      placeholder = ''
    ) => {
      if (!textarea) {
        setContent((prev) => `${prev}${prefix}${placeholder}${suffix}`)
        return
      }
      const start = textarea.selectionStart ?? content.length
      const end = textarea.selectionEnd ?? content.length
      const selected = content.slice(start, end)
      const middle = selected || placeholder
      const nextValue = `${content.slice(0, start)}${prefix}${middle}${suffix}${content.slice(end)}`
      setContent(nextValue)
      const cursorStart = start + prefix.length
      const cursorEnd = cursorStart + middle.length
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(cursorStart, cursorEnd)
      })
    },
    [content]
  )

  const handleUploadMomentImages = useCallback(
    async (rawFiles: File[]) => {
      const imageFiles = rawFiles.filter((file) => file.type.startsWith('image/'))
      if (!imageFiles.length) return
      const remaining = MAX_MOMENT_IMAGES - images.length
      if (remaining <= 0) {
        showToast('info', `最多上传 ${MAX_MOMENT_IMAGES} 张图片`)
        return
      }
      const toUpload = imageFiles.slice(0, remaining)
      if (imageFiles.length > remaining) {
        showToast('info', `已截取前 ${remaining} 张（最多 ${MAX_MOMENT_IMAGES} 张）`)
      }
      setUploadingImages(true)
      setError('')
      try {
        const uploaded = await uploadBlogMedia(toUpload)
        const mapped: BlogImageItem[] = uploaded.map((item) => ({
          mediaId: item.id,
          url: item.url,
          thumbUrl: item.thumbUrl,
          width: item.width,
          height: item.height,
          alt: item.originalName
        }))
        setImages((prev) => [...prev, ...mapped].slice(0, MAX_MOMENT_IMAGES))
      } catch (err) {
        const msg = errorMessage(err)
        setError(msg)
        showToast('error', msg)
      } finally {
        setUploadingImages(false)
      }
    },
    [images.length]
  )

  const handleMomentPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = extractClipboardImageFiles(event)
      if (!files.length) return
      event.preventDefault()
      void handleUploadMomentImages(files)
    },
    [handleUploadMomentImages]
  )

  const handleMoveImage = useCallback((index: number, delta: -1 | 1) => {
    setImages((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }, [])

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, idx) => idx !== index))
  }, [])

  const handleImageDragStart = useCallback((index: number) => {
    setDraggingIndex(index)
  }, [])

  const handleImageDrop = useCallback(
    (targetIndex: number, event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (draggingIndex === null || draggingIndex === targetIndex) {
        setDraggingIndex(null)
        return
      }
      setImages((prev) => {
        const next = [...prev]
        const [moved] = next.splice(draggingIndex, 1)
        next.splice(targetIndex, 0, moved)
        return next
      })
      setDraggingIndex(null)
    },
    [draggingIndex]
  )

  const handleFetchLinkPreview = useCallback(async () => {
    const trimmed = linkUrlInput.trim()
    if (!trimmed) {
      showToast('info', '请先输入外链 URL')
      return
    }
    setFetchingLink(true)
    setError('')
    try {
      const preview = await fetchBlogUrlPreview(trimmed)
      setLinkCard({
        url: preview.url || trimmed,
        title: preview.title || extractDomain(trimmed),
        description: preview.description || '',
        image: preview.image || '',
        siteName: preview.siteName || extractDomain(trimmed)
      })
      setLinkUrlInput(preview.url || trimmed)
      showToast('success', '已抓取外链预览')
    } catch (err) {
      const msg = errorMessage(err)
      showToast('error', msg)
      // Still allow manual editing of the link card
      setLinkCard((prev) => ({
        url: trimmed,
        title: prev?.title || extractDomain(trimmed),
        description: prev?.description || '',
        image: prev?.image || '',
        siteName: prev?.siteName || extractDomain(trimmed)
      }))
    } finally {
      setFetchingLink(false)
    }
  }, [linkUrlInput])

  const updateLinkCardField = useCallback(
    (field: keyof BlogLinkCard, value: string) => {
      setLinkCard((prev) => {
        const base: BlogLinkCard = prev ?? {
          url: linkUrlInput.trim(),
          title: '',
          description: '',
          siteName: '',
          image: ''
        }
        return { ...base, [field]: value }
      })
    },
    [linkUrlInput]
  )

  const handleImportItem = useCallback(async (item: LibraryItem) => {
    setImportingItemId(item.id)
    setError('')
    try {
      const draft = await importLibraryItemToBlog(item.id)
      setTitle(draft.title || '')
      setContent(draft.content || '')
      setLinkCard(draft.linkCard ? { ...draft.linkCard } : null)
      setLinkUrlInput(draft.linkCard?.url || '')
      setLinkSectionOpen(Boolean(draft.linkCard))
      setImages(draft.images ? draft.images.slice(0, MAX_MOMENT_IMAGES) : [])
      setCoverMediaId(draft.coverMediaId ?? null)
      setCoverUrl(draft.coverUrl || '')
      setCategory(draft.category || '')
      setSourceLabel(draft.sourceLabel || '')
      setSourceItemId(draft.sourceItemId || item.id)
      setImportPickerOpen(false)
      showToast('success', '已导入稍后阅读条目')
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      showToast('error', msg)
    } finally {
      setImportingItemId(null)
    }
  }, [])

  const handleUploadCover = useCallback(async (file: File) => {
    setUploadingCover(true)
    setError('')
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        setCoverMediaId(uploaded.id)
        setCoverUrl(uploaded.url)
        showToast('success', '封面已上传')
      }
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      showToast('error', msg)
    } finally {
      setUploadingCover(false)
    }
  }, [])

  const handleUploadInlineImages = useCallback(
    async (rawFiles: File[]) => {
      const imageFiles = rawFiles.filter((file) => file.type.startsWith('image/'))
      if (!imageFiles.length) return
      setUploadingInlineImage(true)
      setError('')
      try {
        const uploaded = await uploadBlogMedia(imageFiles)
        if (!uploaded.length) return
        const markdownSnippets = uploaded
          .map((item) => `![${sanitizeFilenameAlt(item.originalName)}](${item.url})`)
          .join('\n')
        insertAtCursor(articleTextareaRef.current, `\n${markdownSnippets}\n`, '', '')
      } catch (err) {
        const msg = errorMessage(err)
        setError(msg)
        showToast('error', msg)
      } finally {
        setUploadingInlineImage(false)
      }
    },
    [insertAtCursor]
  )

  const handleArticlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = extractClipboardImageFiles(event)
      if (!files.length) return
      event.preventDefault()
      void handleUploadInlineImages(files)
    },
    [handleUploadInlineImages]
  )

  const handleMdTool = useCallback(
    (tool: 'h2' | 'h3' | 'bold' | 'italic' | 'quote' | 'inlineCode' | 'codeBlock' | 'table' | 'link') => {
      const ta = articleTextareaRef.current
      switch (tool) {
        case 'h2':
          insertAtCursor(ta, '\n## ', '\n', '小节标题')
          break
        case 'h3':
          insertAtCursor(ta, '\n### ', '\n', '三级标题')
          break
        case 'bold':
          insertAtCursor(ta, '**', '**', '加粗文字')
          break
        case 'italic':
          insertAtCursor(ta, '*', '*', '斜体文字')
          break
        case 'quote':
          insertAtCursor(ta, '\n> ', '\n', '引用内容')
          break
        case 'inlineCode':
          insertAtCursor(ta, '`', '`', 'code')
          break
        case 'codeBlock':
          insertAtCursor(ta, '\n```ts\n', '\n```\n', '// 在此输入代码')
          break
        case 'table':
          insertAtCursor(
            ta,
            '\n| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n',
            '',
            ''
          )
          break
        case 'link':
          insertAtCursor(ta, '[', '](https://)', '链接文字')
          break
      }
    },
    [insertAtCursor]
  )

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')

    const trimmedContent = content.trim()
    const trimmedTitle = title.trim()

    const activeLinkUrl = (linkCard?.url || linkUrlInput).trim()
    const normalizedLinkCard: BlogLinkCard | null =
      type === 'moment' && linkSectionOpen && activeLinkUrl
        ? {
            url: activeLinkUrl,
            title: (linkCard?.title || '').trim() || extractDomain(activeLinkUrl),
            description: (linkCard?.description || '').trim() || undefined,
            siteName: (linkCard?.siteName || '').trim() || undefined,
            image: (linkCard?.image || '').trim() || undefined
          }
        : null

    if (type === 'article') {
      if (!trimmedTitle) {
        setError('请输入文章标题')
        return
      }
      if (!trimmedContent) {
        setError('请输入文章正文内容')
        return
      }
    } else {
      if (!trimmedContent && images.length === 0 && !normalizedLinkCard) {
        setError('请输入动态正文、上传图片或添加外链卡片')
        return
      }
    }

    const needsPassword =
      visibility === 'password' && (!editingPost || editingPost.visibility !== 'password')
    if (needsPassword && !password.trim()) {
      setError('请设置访问密码')
      return
    }

    const tags = parseTagsInput(tagsText)
    const computedExcerpt =
      type === 'article' ? excerpt.trim() || generateExcerpt(trimmedContent) : ''

    const payload: BlogPostInput = {
      type,
      title: type === 'article' ? trimmedTitle : trimmedTitle,
      excerpt: type === 'article' ? computedExcerpt : '',
      content: trimmedContent,
      coverMediaId: type === 'article' ? coverMediaId : null,
      coverUrl: type === 'article' ? coverUrl.trim() || null : null,
      category: category.trim(),
      tags,
      images: type === 'moment' ? images : [],
      linkCard: type === 'moment' ? normalizedLinkCard : null,
      locationName: type === 'moment' ? locationName.trim() : '',
      sourceLabel: sourceLabel.trim(),
      sourceItemId,
      visibility,
      isPinned
    }

    if (visibility === 'password' && password.trim()) {
      payload.password = password.trim()
    }

    setSaving(true)
    try {
      const saved = editingPost
        ? await updateBlogPost(editingPost.shortId, payload)
        : await createBlogPost(payload)
      showToast(
        'success',
        editingPost ? '修改已保存' : type === 'article' ? '文章已发布' : '动态已发布'
      )
      onSaved(saved, !editingPost)
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      showToast('error', msg)
    } finally {
      setSaving(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const alreadyPasswordProtected = Boolean(editingPost && editingPost.visibility === 'password')
  const previewCardData: BlogLinkCard | null =
    linkCard && (linkCard.url.trim() || linkCard.title.trim())
      ? linkCard
      : linkUrlInput.trim()
        ? {
            url: linkUrlInput.trim(),
            title: extractDomain(linkUrlInput.trim()),
            siteName: extractDomain(linkUrlInput.trim())
          }
        : null

  return createPortal(
    <div
      className="blog-root blog-modal-backdrop"
      data-blog-theme={blogTheme}
      style={{
        minHeight: 0,
        zIndex: 1000
      }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose()
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? '编辑内容' : type === 'article' ? '写长文章' : '发朋友圈动态'}
        className={`blog-composer-modal${type === 'article' ? ' is-article' : ''}`}
      >
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'inherit', flex: 1 }}
        >
          {/* Header */}
          <header className="blog-modal-header">
            <div className="blog-segmented" role="tablist" aria-label="内容类型">
              <button
                type="button"
                role="tab"
                aria-selected={type === 'moment'}
                disabled={isEditing || busy}
                className={`blog-segmented-btn${type === 'moment' ? ' is-active is-accent' : ''}`}
                onClick={() => setType('moment')}
              >
                <AppIcon name="sparkles" size={14} />
                <span>发朋友圈动态</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={type === 'article'}
                disabled={isEditing || busy}
                className={`blog-segmented-btn${type === 'article' ? ' is-active is-accent' : ''}`}
                onClick={() => setType('article')}
              >
                <AppIcon name="book" size={14} />
                <span>写长文章</span>
              </button>
            </div>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {!isEditing && (
                <button
                  type="button"
                  className={`blog-btn blog-btn-sm ${importPickerOpen ? 'blog-btn-ghost' : 'blog-btn-subtle'}`}
                  disabled={busy}
                  onClick={() => setImportPickerOpen((prev) => !prev)}
                >
                  <AppIcon name="bookmark" size={14} />
                  <span>从稍后阅读导入</span>
                </button>
              )}
              <button
                type="button"
                className="blog-btn blog-btn-icon"
                aria-label="关闭"
                disabled={busy}
                onClick={onClose}
              >
                <AppIcon name="close" size={16} />
              </button>
            </div>
          </header>

          {/* Body */}
          <div className="blog-modal-body">
            {/* Inline Reading-List Import Picker */}
            {!isEditing && importPickerOpen && (
              <div className="blog-import-picker">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span className="blog-field-label">从稍后阅读选择条目导入</span>
                  <button
                    type="button"
                    className="blog-btn blog-btn-subtle blog-btn-sm"
                    onClick={() => setImportPickerOpen(false)}
                  >
                    收起
                  </button>
                </div>
                <input
                  type="search"
                  className="blog-input"
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                  placeholder="搜索标题、网址或分类…"
                />
                <div className="blog-import-list">
                  {importLoading ? (
                    <div className="blog-field-hint" style={{ padding: '12px 4px', textAlign: 'center' }}>
                      正在加载稍后阅读列表…
                    </div>
                  ) : filteredImportItems.length === 0 ? (
                    <div className="blog-field-hint" style={{ padding: '12px 4px', textAlign: 'center' }}>
                      {importSearch.trim() ? '未找到匹配的条目' : '稍后阅读暂无可导入条目'}
                    </div>
                  ) : (
                    filteredImportItems.map((item) => {
                      const isImportingThis = importingItemId === item.id
                      const iconName =
                        item.kind === 'link' ? 'link' : item.kind === 'image_group' ? 'image' : 'text'
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="blog-import-row"
                          disabled={Boolean(importingItemId)}
                          onClick={() => void handleImportItem(item)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                            <AppIcon name={iconName} size={14} style={{ flexShrink: 0, color: 'var(--blog-link)' }} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 500,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {item.title || item.url || '未命名条目'}
                              </div>
                              {item.url && (
                                <div
                                  className="blog-field-hint"
                                  style={{
                                    fontSize: 11.5,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {extractDomain(item.url)}
                                </div>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {item.category?.name && (
                              <span className="blog-badge-category">{item.category.name}</span>
                            )}
                            <span style={{ fontSize: 12, color: 'var(--blog-link)' }}>
                              {isImportingThis ? '导入中…' : '导入'}
                            </span>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {/* MOMENT MODE */}
            {type === 'moment' ? (
              <>
                <div className="blog-field">
                  <textarea
                    ref={momentTextareaRef}
                    className="blog-textarea"
                    rows={5}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onPaste={handleMomentPaste}
                    placeholder="分享此刻的想法、摘录或日常…（支持 #标签 与粘贴图片）"
                  />
                  {/* Quick Emoji Strip */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      {QUICK_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="blog-md-tool-btn"
                          style={{ fontSize: 15, padding: '0 6px' }}
                          title={`插入 ${emoji}`}
                          onClick={() => insertAtCursor(momentTextareaRef.current, emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <span className="blog-field-hint">支持 Ctrl+V 直接粘贴图片</span>
                  </div>
                </div>

                {/* 9-Image Uploader */}
                <div className="blog-field">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="blog-field-label">
                      图片配图（{images.length}/{MAX_MOMENT_IMAGES}）
                    </span>
                    {images.length > 1 && (
                      <span className="blog-field-hint">拖拽或点击箭头调整顺序</span>
                    )}
                  </div>
                  <div className="blog-upload-grid">
                    {images.map((img, idx) => (
                      <div
                        key={`${img.mediaId || img.url}-${idx}`}
                        className={`blog-upload-item${draggingIndex === idx ? ' is-dragging' : ''}`}
                        draggable
                        onDragStart={() => handleImageDragStart(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleImageDrop(idx, e)}
                        onDragEnd={() => setDraggingIndex(null)}
                      >
                        <img src={img.thumbUrl || img.url} alt={img.alt || `图片 ${idx + 1}`} />
                        <button
                          type="button"
                          className="blog-upload-remove"
                          aria-label={`移除第 ${idx + 1} 张图片`}
                          onClick={() => handleRemoveImage(idx)}
                        >
                          <AppIcon name="close" size={12} />
                        </button>
                        {images.length > 1 && (
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              bottom: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '3px 4px',
                              background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.68))'
                            }}
                          >
                            <button
                              type="button"
                              aria-label="前移图片"
                              disabled={idx === 0}
                              onClick={() => handleMoveImage(idx, -1)}
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 4,
                                border: 0,
                                background: 'rgba(0,0,0,0.45)',
                                color: '#fff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                opacity: idx === 0 ? 0.35 : 1
                              }}
                            >
                              <AppIcon name="chevronLeft" size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label="后移图片"
                              disabled={idx === images.length - 1}
                              onClick={() => handleMoveImage(idx, 1)}
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 4,
                                border: 0,
                                background: 'rgba(0,0,0,0.45)',
                                color: '#fff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: idx === images.length - 1 ? 'not-allowed' : 'pointer',
                                opacity: idx === images.length - 1 ? 0.35 : 1
                              }}
                            >
                              <AppIcon name="chevronRight" size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                    {images.length < MAX_MOMENT_IMAGES && (
                      <button
                        type="button"
                        className="blog-upload-add"
                        disabled={uploadingImages}
                        onClick={() => momentFileInputRef.current?.click()}
                      >
                        <AppIcon name={uploadingImages ? 'upload' : 'plus'} size={18} />
                        <span>{uploadingImages ? '上传中…' : '添加图片'}</span>
                      </button>
                    )}
                  </div>
                  <input
                    ref={momentFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    hidden
                    onChange={(e) => {
                      const files = e.target.files ? Array.from(e.target.files) : []
                      e.target.value = ''
                      if (files.length) void handleUploadMomentImages(files)
                    }}
                  />
                </div>

                {/* Collapsible External Link Card */}
                <div className="blog-field">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <button
                      type="button"
                      className="blog-btn blog-btn-subtle blog-btn-sm"
                      onClick={() => setLinkSectionOpen((prev) => !prev)}
                    >
                      <AppIcon name="link" size={14} />
                      <span>
                        {linkSectionOpen
                          ? '收起外链卡片'
                          : previewCardData
                            ? '编辑外链卡片（已附带）'
                            : '添加外链卡片'}
                      </span>
                      <AppIcon name={linkSectionOpen ? 'chevronDown' : 'chevronRight'} size={13} />
                    </button>
                    {previewCardData && (
                      <button
                        type="button"
                        className="blog-btn blog-btn-danger blog-btn-sm"
                        onClick={() => {
                          setLinkCard(null)
                          setLinkUrlInput('')
                          setLinkSectionOpen(false)
                        }}
                      >
                        移除卡片
                      </button>
                    )}
                  </div>

                  {linkSectionOpen && (
                    <div className="blog-link-preview-box">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="url"
                          className="blog-input"
                          value={linkUrlInput}
                          onChange={(e) => {
                            const val = e.target.value
                            setLinkUrlInput(val)
                            setLinkCard((prev) =>
                              prev
                                ? { ...prev, url: val }
                                : val.trim()
                                  ? { url: val, title: '', siteName: '', description: '' }
                                  : null
                            )
                          }}
                          placeholder="粘贴网页链接，如 https://example.com/article"
                        />
                        <button
                          type="button"
                          className="blog-btn blog-btn-ghost"
                          disabled={fetchingLink || !linkUrlInput.trim()}
                          onClick={() => void handleFetchLinkPreview()}
                        >
                          {fetchingLink ? '抓取中…' : '抓取预览'}
                        </button>
                      </div>

                      <div className="blog-composer-grid">
                        <input
                          type="text"
                          className="blog-input"
                          value={linkCard?.title || ''}
                          onChange={(e) => updateLinkCardField('title', e.target.value)}
                          placeholder="卡片标题"
                        />
                        <input
                          type="text"
                          className="blog-input"
                          value={linkCard?.siteName || ''}
                          onChange={(e) => updateLinkCardField('siteName', e.target.value)}
                          placeholder="站点名称（可选）"
                        />
                      </div>

                      <input
                        type="text"
                        className="blog-input"
                        value={linkCard?.description || ''}
                        onChange={(e) => updateLinkCardField('description', e.target.value)}
                        placeholder="卡片简介（可选）"
                      />

                      {previewCardData && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div className="blog-share-card" style={{ marginTop: 0, maxWidth: '100%', flex: 1, cursor: 'default' }}>
                            <div className="blog-share-thumb">
                              {previewCardData.image ? (
                                <img src={previewCardData.image} alt={previewCardData.title} />
                              ) : (
                                <AppIcon name="link" size={20} />
                              )}
                            </div>
                            <div className="blog-share-info">
                              <div className="blog-share-title">
                                {previewCardData.title || extractDomain(previewCardData.url)}
                              </div>
                              {previewCardData.description && (
                                <div className="blog-share-excerpt">{previewCardData.description}</div>
                              )}
                              <div className="blog-share-domain">
                                {previewCardData.siteName || extractDomain(previewCardData.url)}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="blog-btn blog-btn-icon"
                            aria-label="移除外链预览"
                            onClick={() => {
                              setLinkCard(null)
                              setLinkUrlInput('')
                            }}
                          >
                            <AppIcon name="trash" size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Location & Source Label */}
                <div className="blog-composer-grid">
                  <label className="blog-field">
                    <span className="blog-field-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <AppIcon name="mapPin" size={13} />
                      <span>所在位置</span>
                    </span>
                    <input
                      type="text"
                      className="blog-input"
                      value={locationName}
                      onChange={(e) => setLocationName(e.target.value)}
                      placeholder="位置，例如：厦门 · 鼓浪屿"
                    />
                  </label>

                  <label className="blog-field">
                    <span className="blog-field-label">来源标记（可选）</span>
                    <input
                      type="text"
                      className="blog-input"
                      value={sourceLabel}
                      onChange={(e) => setSourceLabel(e.target.value)}
                      placeholder="例如：来自 稍后阅读"
                    />
                  </label>
                </div>
              </>
            ) : (
              /* ARTICLE MODE */
              <>
                <label className="blog-field">
                  <span className="blog-field-label">文章标题 *</span>
                  <input
                    type="text"
                    className="blog-input"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="输入文章标题…"
                  />
                </label>

                <div className="blog-composer-grid">
                  <label className="blog-field">
                    <span className="blog-field-label">文章分类</span>
                    <input
                      type="text"
                      className="blog-input"
                      list={categoryListId}
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="例如：随笔、技术笔记、读书"
                    />
                    <datalist id={categoryListId}>
                      {uniqueCategories.map((cat) => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                  </label>

                  <label className="blog-field">
                    <span className="blog-field-label">文章摘要</span>
                    <input
                      type="text"
                      className="blog-input"
                      value={excerpt}
                      onChange={(e) => setExcerpt(e.target.value)}
                      placeholder="摘要，留空将自动从正文提取"
                    />
                  </label>
                </div>

                {/* Cover Image Uploader */}
                <div className="blog-field">
                  <span className="blog-field-label">文章封面（可选）</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="blog-btn blog-btn-subtle blog-btn-sm"
                      disabled={uploadingCover}
                      onClick={() => coverFileInputRef.current?.click()}
                    >
                      <AppIcon name="upload" size={14} />
                      <span>{uploadingCover ? '上传中…' : '上传封面'}</span>
                    </button>
                    <input
                      type="url"
                      className="blog-input"
                      style={{ flex: 1, minWidth: 180 }}
                      value={coverUrl}
                      onChange={(e) => {
                        setCoverUrl(e.target.value)
                        setCoverMediaId(null)
                      }}
                      placeholder="或粘贴外部封面图片 URL"
                    />
                    {coverUrl && (
                      <button
                        type="button"
                        className="blog-btn blog-btn-danger blog-btn-sm"
                        onClick={() => {
                          setCoverMediaId(null)
                          setCoverUrl('')
                        }}
                      >
                        移除封面
                      </button>
                    )}
                  </div>
                  <input
                    ref={coverFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void handleUploadCover(file)
                    }}
                  />
                  {coverUrl && (
                    <div
                      style={{
                        marginTop: 4,
                        width: 200,
                        height: 108,
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: '1px solid var(--blog-divider)',
                        background: 'var(--blog-surface-subtle)'
                      }}
                    >
                      <img
                        src={coverUrl}
                        alt="文章封面预览"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </div>
                  )}
                </div>

                {/* Markdown Toolbar + Live Split Editor */}
                <div className="blog-field">
                  <div className="blog-md-toolbar">
                    <button type="button" className="blog-md-tool-btn" onClick={() => handleMdTool('h2')}>
                      H2
                    </button>
                    <button type="button" className="blog-md-tool-btn" onClick={() => handleMdTool('h3')}>
                      H3
                    </button>
                    <button type="button" className="blog-md-tool-btn" onClick={() => handleMdTool('bold')}>
                      <strong>加粗</strong>
                    </button>
                    <button type="button" className="blog-md-tool-btn" onClick={() => handleMdTool('italic')}>
                      <em>斜体</em>
                    </button>
                    <button type="button" className="blog-md-tool-btn" onClick={() => handleMdTool('quote')}>
                      引用
                    </button>
                    <button type="button" className="blog-md-tool-btn" onClick={() => handleMdTool('inlineCode')}>
                      行内代码
                    </button>
                    <button type="button" className="blog-md-tool-btn" onClick={() => handleMdTool('codeBlock')}>
                      代码块
                    </button>
                    <button type="button" className="blog-md-tool-btn" onClick={() => handleMdTool('table')}>
                      表格
                    </button>
                    <button type="button" className="blog-md-tool-btn" onClick={() => handleMdTool('link')}>
                      链接
                    </button>
                    <button
                      type="button"
                      className="blog-md-tool-btn"
                      disabled={uploadingInlineImage}
                      onClick={() => inlineImageInputRef.current?.click()}
                    >
                      <AppIcon name="image" size={14} />
                      <span>{uploadingInlineImage ? '上传中…' : '插图'}</span>
                    </button>

                    {isMobile && (
                      <div className="blog-segmented" style={{ marginLeft: 'auto' }}>
                        <button
                          type="button"
                          className={`blog-segmented-btn${mobileView === 'edit' ? ' is-active' : ''}`}
                          onClick={() => setMobileView('edit')}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className={`blog-segmented-btn${mobileView === 'preview' ? ' is-active' : ''}`}
                          onClick={() => setMobileView('preview')}
                        >
                          预览
                        </button>
                      </div>
                    )}
                  </div>

                  <input
                    ref={inlineImageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    hidden
                    onChange={(e) => {
                      const files = e.target.files ? Array.from(e.target.files) : []
                      e.target.value = ''
                      if (files.length) void handleUploadInlineImages(files)
                    }}
                  />

                  <div className={`blog-md-split${isMobile ? ' is-single-pane' : ''}`}>
                    {(!isMobile || mobileView === 'edit') && (
                      <textarea
                        ref={articleTextareaRef}
                        className="blog-md-editor"
                        rows={12}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onPaste={handleArticlePaste}
                        placeholder="使用 Markdown 撰写长文章…（支持直接粘贴图片上传）"
                      />
                    )}
                    {(!isMobile || mobileView === 'preview') && (
                      <div className="blog-md-preview">
                        {renderedPreview.html ? (
                          <div
                            className="blog-article-content"
                            dangerouslySetInnerHTML={{ __html: renderedPreview.html }}
                          />
                        ) : (
                          <div className="blog-field-hint" style={{ padding: '24px 0', textAlign: 'center' }}>
                            右侧将实时渲染 Markdown 预览
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    className="blog-field-hint"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontFamily: 'var(--blog-font-mono)',
                      fontSize: 11.5
                    }}
                  >
                    <span>
                      {renderedPreview.wordCount} 字 · 预计阅读 {renderedPreview.readingMinutes} 分钟
                    </span>
                    <span>支持粘贴图片自动上传</span>
                  </div>
                </div>
              </>
            )}

            {/* Shared Settings Bar */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--blog-divider)'
              }}
            >
              <label className="blog-field">
                <span className="blog-field-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <AppIcon name="tag" size={13} />
                  <span>标签</span>
                </span>
                <input
                  type="text"
                  className="blog-input"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="标签，用逗号或空格分隔"
                />
              </label>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="blog-field-label">可见性</span>
                  <div className="blog-segmented" role="radiogroup" aria-label="可见性">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={visibility === 'public'}
                      className={`blog-segmented-btn${visibility === 'public' ? ' is-active' : ''}`}
                      onClick={() => setVisibility('public')}
                    >
                      公开
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={visibility === 'private'}
                      className={`blog-segmented-btn${visibility === 'private' ? ' is-active' : ''}`}
                      onClick={() => setVisibility('private')}
                    >
                      仅自己
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={visibility === 'password'}
                      className={`blog-segmented-btn${visibility === 'password' ? ' is-active' : ''}`}
                      onClick={() => setVisibility('password')}
                    >
                      <AppIcon name="lock" size={12} />
                      <span>密码解锁</span>
                    </button>
                  </div>
                </div>

                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    color: 'var(--blog-text-secondary)',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                    style={{ accentColor: '#4d49fc', width: 15, height: 15, cursor: 'pointer' }}
                  />
                  <AppIcon name="pin" size={13} />
                  <span>置顶展示</span>
                </label>
              </div>

              {visibility === 'password' && (
                <div className="blog-field">
                  <span className="blog-field-label">
                    访问密码{alreadyPasswordProtected ? '（可选）' : ' *'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="blog-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={alreadyPasswordProtected ? '留空保持原密码' : '输入解锁密码'}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="blog-btn blog-btn-icon"
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      onClick={() => setShowPassword((prev) => !prev)}
                    >
                      <AppIcon name={showPassword ? 'eyeOff' : 'eye'} size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'var(--blog-danger-soft)',
                  color: 'var(--blog-danger)',
                  fontSize: 13
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <footer className="blog-modal-footer">
            <span className="blog-field-hint">
              {isEditing
                ? `正在编辑${type === 'article' ? '文章' : '动态'}`
                : type === 'article'
                  ? '支持 Markdown 排版与目录自动生成'
                  : '发布后立即展示在动态时间线'}
            </span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="blog-btn blog-btn-ghost" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button type="submit" className="blog-btn blog-btn-primary" disabled={busy}>
                <AppIcon name="send" size={14} />
                <span>
                  {saving ? '保存中…' : isEditing ? '保存修改' : type === 'article' ? '发布文章' : '发布动态'}
                </span>
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}
