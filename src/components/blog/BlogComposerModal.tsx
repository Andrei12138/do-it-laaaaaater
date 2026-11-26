import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  type FormEvent
} from 'react'
import { createPortal } from 'react-dom'
import { errorMessage } from '../../api-error'
import {
  createBlogPost,
  fetchBlogMusicTracks,
  fetchBlogUrlPreview,
  importLibraryItemToBlog,
  parseVideoUrl,
  updateBlogPost,
  uploadBlogFile,
  uploadBlogMedia
} from '../../blog-api'
import { discardDraft, loadDraft, saveDraft, type DraftType } from '../../draft-store'
import { generateExcerpt, renderArticleMarkdown } from '../../blog-markdown'
import type {
  BlogImageItem,
  BlogImportedItemDraft,
  BlogLinkCard,
  BlogMusicTrack,
  BlogPostDetail,
  BlogPostInput,
  BlogPostMetadata,
  BlogPostMusic,
  BlogPostSummary,
  BlogPostType,
  BlogPostVideo,
  BlogVisibility
} from '../../blog-types'
import type { LibraryItem } from '../../types'
import { AppIcon } from '../AppIcon'
import { showToast } from '../Toast'
import { BlogEmojiTrigger } from './BlogEmojiPicker'
import { BlogMusicCard } from './BlogMusicCard'
import { BlogVideoCard } from './BlogVideoCard'

export interface BlogComposerModalProps {
  open: boolean
  initialType?: BlogPostType
  editingPost?: BlogPostSummary | null
  importedDraft?: BlogImportedItemDraft | null
  initialPastedFiles?: File[] | null
  onConsumePastedFiles?: () => void
  existingCategories: string[]
  onClose: () => void
  onSaved: (post: BlogPostDetail, isNew: boolean) => void
}

const MAX_MOMENT_IMAGES = 9

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

function stripMediaExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim()
}

type ComposerAttachTab = 'none' | 'link' | 'video' | 'music'

const ACTIVE_WORKSPACE_DRAFT_KEY = 'do-it-laaaaaater.active-draft.v1'
const BLOG_DRAFT_FALLBACK_PREFIX = 'do-it-laaaaaater.blog.draft.v1.'

interface BlogComposerDraftSnapshot {
  title: string
  excerpt: string
  content: string
  coverMediaId: string | null
  coverUrl: string
  category: string
  tagsText: string
  images: BlogImageItem[]
  linkCard: BlogLinkCard | null
  linkUrlInput: string
  videoData: BlogPostVideo | null
  videoUrlInput: string
  musicData: BlogPostMusic | null
  activeAttachTab: ComposerAttachTab
  locationName: string
  sourceLabel: string
  sourceItemId: string | null
  visibility: BlogVisibility
  isPinned: boolean
}

function createEmptyComposerSnapshot(): BlogComposerDraftSnapshot {
  return {
    title: '',
    excerpt: '',
    content: '',
    coverMediaId: null,
    coverUrl: '',
    category: '',
    tagsText: '',
    images: [],
    linkCard: null,
    linkUrlInput: '',
    videoData: null,
    videoUrlInput: '',
    musicData: null,
    activeAttachTab: 'none',
    locationName: '',
    sourceLabel: '',
    sourceItemId: null,
    visibility: 'public',
    isPinned: false
  }
}

function hasMeaningfulComposerSnapshot(snap: Partial<BlogComposerDraftSnapshot>): boolean {
  return Boolean(
    (snap.title && snap.title.trim()) ||
      (snap.content && snap.content.trim()) ||
      (snap.excerpt && snap.excerpt.trim()) ||
      (snap.tagsText && snap.tagsText.trim()) ||
      (snap.locationName && snap.locationName.trim()) ||
      (snap.coverUrl && snap.coverUrl.trim()) ||
      (Array.isArray(snap.images) && snap.images.length > 0) ||
      (snap.linkCard && (snap.linkCard.url?.trim() || snap.linkCard.title?.trim())) ||
      (snap.linkUrlInput && snap.linkUrlInput.trim()) ||
      (snap.videoData && snap.videoData.url?.trim()) ||
      (snap.videoUrlInput && snap.videoUrlInput.trim()) ||
      (snap.musicData && snap.musicData.audioUrl?.trim())
  )
}

async function saveBlogComposerDraft(
  key: string,
  draftType: DraftType,
  itemId: string | undefined,
  snapshot: BlogComposerDraftSnapshot
) {
  let prevActiveWorkspaceDraft: string | null = null
  try {
    prevActiveWorkspaceDraft = localStorage.getItem(ACTIVE_WORKSPACE_DRAFT_KEY)
  } catch {
    // Ignore storage read errors.
  }

  await saveDraft({
    key,
    type: draftType,
    itemId,
    data: snapshot as unknown as Record<string, unknown>,
    files: []
  })

  try {
    if (prevActiveWorkspaceDraft === null) {
      localStorage.removeItem(ACTIVE_WORKSPACE_DRAFT_KEY)
    } else {
      localStorage.setItem(ACTIVE_WORKSPACE_DRAFT_KEY, prevActiveWorkspaceDraft)
    }
    localStorage.setItem(
      `${BLOG_DRAFT_FALLBACK_PREFIX}${key}`,
      JSON.stringify({ key, updatedAt: Date.now(), data: snapshot })
    )
  } catch {
    // Ignore storage write errors.
  }
}

async function loadBlogComposerDraft(
  key: string
): Promise<{ key: string; updatedAt: number; data: Partial<BlogComposerDraftSnapshot> } | null> {
  const fromIdb = await loadDraft(key)
  if (fromIdb && fromIdb.data && typeof fromIdb.data === 'object') {
    return {
      key: fromIdb.key,
      updatedAt: fromIdb.updatedAt,
      data: fromIdb.data as Partial<BlogComposerDraftSnapshot>
    }
  }
  try {
    const raw = localStorage.getItem(`${BLOG_DRAFT_FALLBACK_PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      key?: string
      updatedAt?: number
      data?: Partial<BlogComposerDraftSnapshot>
    }
    if (!parsed || !parsed.data || typeof parsed.data !== 'object') return null
    return {
      key: parsed.key || key,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      data: parsed.data
    }
  } catch {
    return null
  }
}

async function discardBlogComposerDraft(key: string) {
  await discardDraft(key)
  try {
    localStorage.removeItem(`${BLOG_DRAFT_FALLBACK_PREFIX}${key}`)
  } catch {
    // Ignore storage errors.
  }
}

function normalizeClipboardImageFile(rawFile: File, index = 0): File {
  if (
    rawFile.name &&
    /\.[a-z0-9]{2,5}$/i.test(rawFile.name) &&
    !/^image\.[a-z]+$/i.test(rawFile.name)
  ) {
    return rawFile
  }
  const mime = (rawFile.type || 'image/png').toLowerCase()
  const ext = mime.includes('gif')
    ? 'gif'
    : mime.includes('webp')
      ? 'webp'
      : mime.includes('jpeg') || mime.includes('jpg')
        ? 'jpg'
        : 'png'
  const suffix = index > 0 ? `-${index + 1}` : ''
  return new File([rawFile], `pasted-${Date.now()}${suffix}.${ext}`, { type: mime })
}

function extractClipboardImageFilesFromData(clipboardData: DataTransfer | null | undefined): File[] {
  if (!clipboardData) return []
  const files: File[] = []
  const items = clipboardData.items
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) files.push(normalizeClipboardImageFile(file, files.length))
      }
    }
  }
  if (!files.length && clipboardData.files?.length) {
    for (let i = 0; i < clipboardData.files.length; i += 1) {
      const file = clipboardData.files[i]
      if (file.type.startsWith('image/')) {
        files.push(normalizeClipboardImageFile(file, files.length))
      }
    }
  }
  return files
}

function extractClipboardImageFiles(event: ReactClipboardEvent<HTMLTextAreaElement>): File[] {
  return extractClipboardImageFilesFromData(event.clipboardData)
}

export function BlogComposerModal({
  open,
  initialType = 'moment',
  editingPost = null,
  importedDraft = null,
  initialPastedFiles = null,
  onConsumePastedFiles,
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
  const [linkUrlInput, setLinkUrlInput] = useState('')
  const [activeAttachTab, setActiveAttachTab] = useState<ComposerAttachTab>('none')
  const [baseMetadata, setBaseMetadata] = useState<Record<string, unknown>>({})
  const [videoData, setVideoData] = useState<BlogPostVideo | null>(null)
  const [videoUrlInput, setVideoUrlInput] = useState('')
  const [musicData, setMusicData] = useState<BlogPostMusic | null>(null)
  const [playlistTracks, setPlaylistTracks] = useState<BlogMusicTrack[]>([])
  const [tracksLoaded, setTracksLoaded] = useState(false)
  const [tracksLoading, setTracksLoading] = useState(false)
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
  const [liveTargetIndex, setLiveTargetIndex] = useState<number | null>(null)
  const [uploadingLiveIndex, setUploadingLiveIndex] = useState<number | null>(null)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [uploadingVideoCover, setUploadingVideoCover] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingInlineImage, setUploadingInlineImage] = useState(false)
  const [fetchingLink, setFetchingLink] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [error, setError] = useState('')

  const momentTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const articleTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const momentFileInputRef = useRef<HTMLInputElement | null>(null)
  const liveVideoInputRef = useRef<HTMLInputElement | null>(null)
  const videoFileInputRef = useRef<HTMLInputElement | null>(null)
  const videoCoverInputRef = useRef<HTMLInputElement | null>(null)
  const musicAudioInputRef = useRef<HTMLInputElement | null>(null)
  const coverFileInputRef = useRef<HTMLInputElement | null>(null)
  const inlineImageInputRef = useRef<HTMLInputElement | null>(null)

  const busy =
    saving ||
    uploadingImages ||
    uploadingLiveIndex !== null ||
    uploadingVideo ||
    uploadingVideoCover ||
    uploadingAudio ||
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

  const [baselineJson, setBaselineJson] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [recoverableDraft, setRecoverableDraft] = useState<{
    key: string
    updatedAt: number
    data: Partial<BlogComposerDraftSnapshot>
  } | null>(null)

  const draftKey = editingPost ? `blog-edit-${editingPost.shortId}` : `blog-new-${type}`

  const currentSnapshot = useMemo<BlogComposerDraftSnapshot>(
    () => ({
      title,
      excerpt,
      content,
      coverMediaId,
      coverUrl,
      category,
      tagsText,
      images,
      linkCard,
      linkUrlInput,
      videoData,
      videoUrlInput,
      musicData,
      activeAttachTab,
      locationName,
      sourceLabel,
      sourceItemId,
      visibility,
      isPinned
    }),
    [
      title,
      excerpt,
      content,
      coverMediaId,
      coverUrl,
      category,
      tagsText,
      images,
      linkCard,
      linkUrlInput,
      videoData,
      videoUrlInput,
      musicData,
      activeAttachTab,
      locationName,
      sourceLabel,
      sourceItemId,
      visibility,
      isPinned
    ]
  )

  const currentSnapshotJson = useMemo(() => JSON.stringify(currentSnapshot), [currentSnapshot])
  const hasMeaningfulContent = useMemo(
    () => hasMeaningfulComposerSnapshot(currentSnapshot),
    [currentSnapshot]
  )
  const isDirty =
    hydrated &&
    ((Boolean(baselineJson) && currentSnapshotJson !== baselineJson) || Boolean(password.trim()))

  const attemptClose = useCallback(() => {
    if (busy) return
    if (isDirty) {
      const confirmed = window.confirm('当前内容尚未发布，确定关闭吗？（草稿已自动暂存）')
      if (!confirmed) return
      if (hasMeaningfulContent) {
        void saveBlogComposerDraft(
          draftKey,
          editingPost ? 'edit' : 'text',
          editingPost?.shortId,
          currentSnapshot
        )
      }
    }
    onClose()
  }, [busy, isDirty, hasMeaningfulContent, draftKey, editingPost, currentSnapshot, onClose])

  // Populate / reset form whenever modal opens
  useEffect(() => {
    if (!open) {
      setTracksLoaded(false)
      setHydrated(false)
      setRecoverableDraft(null)
      return
    }
    setBlogTheme(detectBlogTheme())
    setError('')
    setMobileView('edit')
    setImportPickerOpen(false)
    setImportSearch('')
    setImportingItemId(null)
    setShowPassword(false)
    setDraggingIndex(null)
    setLiveTargetIndex(null)
    setUploadingLiveIndex(null)

    if (editingPost) {
      const rawMeta =
        editingPost.metadata && typeof editingPost.metadata === 'object'
          ? { ...editingPost.metadata }
          : {}
      const hydratedMeta = rawMeta as BlogPostMetadata
      const initImages = editingPost.images ? editingPost.images.slice(0, MAX_MOMENT_IMAGES) : []
      const initLinkCard = editingPost.linkCard ? { ...editingPost.linkCard } : null
      const initVideo = hydratedMeta.video ? { ...hydratedMeta.video } : null
      const initMusic = hydratedMeta.music ? { ...hydratedMeta.music } : null
      const initAttachTab: ComposerAttachTab =
        editingPost.type === 'moment' && editingPost.linkCard
          ? 'link'
          : hydratedMeta.video
            ? 'video'
            : hydratedMeta.music
              ? 'music'
              : 'none'
      const editSnap: BlogComposerDraftSnapshot = {
        title: editingPost.title || '',
        excerpt: editingPost.excerpt || '',
        content: editingPost.content || '',
        coverMediaId: editingPost.coverMediaId ?? null,
        coverUrl: editingPost.coverUrl || '',
        category: editingPost.category || '',
        tagsText: (editingPost.tags || []).join(', '),
        images: initImages,
        linkCard: initLinkCard,
        linkUrlInput: editingPost.linkCard?.url || '',
        videoData: initVideo,
        videoUrlInput: hydratedMeta.video?.url || '',
        musicData: initMusic,
        activeAttachTab: initAttachTab,
        locationName: editingPost.locationName || '',
        sourceLabel: editingPost.sourceLabel || '',
        sourceItemId: editingPost.sourceItemId ?? null,
        visibility: editingPost.visibility || 'public',
        isPinned: Boolean(editingPost.isPinned)
      }
      setBaseMetadata(rawMeta)
      setType(editingPost.type)
      setTitle(editSnap.title)
      setExcerpt(editSnap.excerpt)
      setContent(editSnap.content)
      setCoverMediaId(editSnap.coverMediaId)
      setCoverUrl(editSnap.coverUrl)
      setCategory(editSnap.category)
      setTagsText(editSnap.tagsText)
      setImages(editSnap.images)
      setLinkCard(editSnap.linkCard)
      setLinkUrlInput(editSnap.linkUrlInput)
      setVideoData(editSnap.videoData)
      setVideoUrlInput(editSnap.videoUrlInput)
      setMusicData(editSnap.musicData)
      setActiveAttachTab(editSnap.activeAttachTab)
      setLocationName(editSnap.locationName)
      setSourceLabel(editSnap.sourceLabel)
      setSourceItemId(editSnap.sourceItemId)
      setVisibility(editSnap.visibility)
      setPassword('')
      setIsPinned(editSnap.isPinned)
      setBaselineJson(JSON.stringify(editSnap))
      setHydrated(true)
      return
    }

    if (importedDraft) {
      setBaseMetadata({})
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
      setVideoData(null)
      setVideoUrlInput('')
      setMusicData(null)
      setActiveAttachTab(importedDraft.linkCard ? 'link' : 'none')
      setLocationName('')
      setSourceLabel(importedDraft.sourceLabel || '')
      setSourceItemId(importedDraft.sourceItemId || null)
      setVisibility('public')
      setPassword('')
      setIsPinned(false)
      setBaselineJson(JSON.stringify(createEmptyComposerSnapshot()))
      setHydrated(true)
      return
    }

    const emptySnap = createEmptyComposerSnapshot()
    setBaseMetadata({})
    setType(initialType)
    setTitle(emptySnap.title)
    setExcerpt(emptySnap.excerpt)
    setContent(emptySnap.content)
    setCoverMediaId(emptySnap.coverMediaId)
    setCoverUrl(emptySnap.coverUrl)
    setCategory(emptySnap.category)
    setTagsText(emptySnap.tagsText)
    setImages(emptySnap.images)
    setLinkCard(emptySnap.linkCard)
    setLinkUrlInput(emptySnap.linkUrlInput)
    setVideoData(emptySnap.videoData)
    setVideoUrlInput(emptySnap.videoUrlInput)
    setMusicData(emptySnap.musicData)
    setActiveAttachTab(emptySnap.activeAttachTab)
    setLocationName(emptySnap.locationName)
    setSourceLabel(emptySnap.sourceLabel)
    setSourceItemId(emptySnap.sourceItemId)
    setVisibility(emptySnap.visibility)
    setPassword('')
    setIsPinned(emptySnap.isPinned)
    setBaselineJson(JSON.stringify(emptySnap))
    setHydrated(true)
  }, [open, editingPost, importedDraft, initialType])

  // Check for saved unpublished draft on open / type switch
  useEffect(() => {
    if (!open || !hydrated || importedDraft) {
      setRecoverableDraft(null)
      return
    }
    let cancelled = false
    setRecoverableDraft(null)
    void loadBlogComposerDraft(draftKey).then((saved) => {
      if (cancelled || !saved) return
      if (!hasMeaningfulComposerSnapshot(saved.data)) return
      const merged: BlogComposerDraftSnapshot = {
        ...createEmptyComposerSnapshot(),
        ...saved.data
      }
      if (baselineJson && JSON.stringify(merged) === baselineJson) return
      setRecoverableDraft(saved)
    })
    return () => {
      cancelled = true
    }
  }, [open, hydrated, draftKey, importedDraft, baselineJson])

  // Debounced 600ms draft autosave whenever user edits meaningful fields
  useEffect(() => {
    if (!open || !hydrated || !isDirty || !hasMeaningfulContent) return
    const timer = window.setTimeout(() => {
      void saveBlogComposerDraft(
        draftKey,
        editingPost ? 'edit' : 'text',
        editingPost?.shortId,
        currentSnapshot
      )
    }, 600)
    return () => window.clearTimeout(timer)
  }, [open, hydrated, isDirty, hasMeaningfulContent, draftKey, editingPost, currentSnapshot])

  // Warn before closing browser tab when open & dirty
  useEffect(() => {
    if (!open || !isDirty || typeof window === 'undefined') return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [open, isDirty])

  const handleRestoreDraft = useCallback(() => {
    if (!recoverableDraft) return
    const d = recoverableDraft.data
    if (typeof d.title === 'string') setTitle(d.title)
    if (typeof d.excerpt === 'string') setExcerpt(d.excerpt)
    if (typeof d.content === 'string') setContent(d.content)
    if (d.coverMediaId !== undefined) setCoverMediaId(d.coverMediaId ?? null)
    if (typeof d.coverUrl === 'string') setCoverUrl(d.coverUrl)
    if (typeof d.category === 'string') setCategory(d.category)
    if (typeof d.tagsText === 'string') setTagsText(d.tagsText)
    if (Array.isArray(d.images)) setImages(d.images.slice(0, MAX_MOMENT_IMAGES))
    if (d.linkCard !== undefined) setLinkCard(d.linkCard ? { ...d.linkCard } : null)
    if (typeof d.linkUrlInput === 'string') setLinkUrlInput(d.linkUrlInput)
    if (d.videoData !== undefined) setVideoData(d.videoData ? { ...d.videoData } : null)
    if (typeof d.videoUrlInput === 'string') setVideoUrlInput(d.videoUrlInput)
    if (d.musicData !== undefined) setMusicData(d.musicData ? { ...d.musicData } : null)
    if (
      d.activeAttachTab === 'none' ||
      d.activeAttachTab === 'link' ||
      d.activeAttachTab === 'video' ||
      d.activeAttachTab === 'music'
    ) {
      setActiveAttachTab(type === 'article' && d.activeAttachTab === 'link' ? 'none' : d.activeAttachTab)
    }
    if (typeof d.locationName === 'string') setLocationName(d.locationName)
    if (typeof d.sourceLabel === 'string') setSourceLabel(d.sourceLabel)
    if (d.sourceItemId !== undefined) setSourceItemId(d.sourceItemId ?? null)
    if (d.visibility === 'public' || d.visibility === 'private' || d.visibility === 'password') {
      setVisibility(d.visibility)
    }
    if (typeof d.isPinned === 'boolean') setIsPinned(d.isPinned)
    setRecoverableDraft(null)
    showToast('info', '已恢复未发布草稿')
  }, [recoverableDraft, type])

  const handleDiscardDraft = useCallback(() => {
    if (!recoverableDraft) return
    const keyToDiscard = recoverableDraft.key
    setRecoverableDraft(null)
    void discardBlogComposerDraft(keyToDiscard)
  }, [recoverableDraft])

  // Lazy-load R2 music tracks when Music attachment tab opens
  useEffect(() => {
    if (!open || activeAttachTab !== 'music' || tracksLoaded || tracksLoading) return
    let cancelled = false
    setTracksLoading(true)
    fetchBlogMusicTracks()
      .then((res) => {
        if (cancelled) return
        setPlaylistTracks(Array.isArray(res.tracks) ? res.tracks : [])
        setTracksLoaded(true)
      })
      .catch((err) => {
        if (cancelled) return
        showToast('error', errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setTracksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, activeAttachTab, tracksLoaded, tracksLoading])

  // Escape key & body scroll lock
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        attemptClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, busy, attemptClose])

  // Lazy-load reading list items when import picker opens
  useEffect(() => {
    if (!open || !importPickerOpen || importLoaded || importLoading) return
    let cancelled = false
    setImportLoading(true)
    fetch('/api/items?trash=active&status=all', { credentials: 'same-origin' })
      .then(async (response) => {
        const contentType = response.headers.get('content-type') || ''
        const parsed = contentType.includes('application/json') ? await response.json() : null
        if (!response.ok) {
          const payload =
            parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
          const message =
            (typeof payload?.error === 'string' && payload.error) ||
            (typeof payload?.message === 'string' && payload.message) ||
            '加载稍后阅读列表失败'
          throw new Error(message)
        }
        return parsed as LibraryItem[]
      })
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

  const insertEmojiAtCursor = useCallback(
    (emojiToken: string) => {
      const targetTextarea =
        type === 'article' ? articleTextareaRef.current : momentTextareaRef.current
      insertAtCursor(targetTextarea, emojiToken)
    },
    [type, insertAtCursor]
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
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
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

  const handleUploadLiveVideo = useCallback(
    async (targetIndex: number, file: File) => {
      const targetImage = images[targetIndex]
      if (!targetImage) return
      setUploadingLiveIndex(targetIndex)
      setError('')
      try {
        const uploaded = await uploadBlogFile(file, 'video', targetImage.mediaId)
        setImages((prev) =>
          prev.map((item, idx) =>
            idx === targetIndex
              ? {
                  ...item,
                  liveVideoMediaId: uploaded.id,
                  liveVideoUrl: uploaded.url
                }
              : item
          )
        )
        showToast('success', '已配对实况视频')
      } catch (err) {
        const msg = errorMessage(err)
        setError(msg)
        showToast('error', msg)
      } finally {
        setUploadingLiveIndex(null)
        setLiveTargetIndex(null)
      }
    },
    [images]
  )

  const handleDetachLiveVideo = useCallback((targetIndex: number) => {
    setImages((prev) =>
      prev.map((item, idx) =>
        idx === targetIndex
          ? {
              ...item,
              liveVideoMediaId: undefined,
              liveVideoUrl: undefined
            }
          : item
      )
    )
    showToast('info', '已取消实况配对')
  }, [])

  const handleUploadAttachVideo = useCallback(async (file: File) => {
    setUploadingVideo(true)
    setError('')
    try {
      const uploaded = await uploadBlogFile(file, 'video')
      setVideoUrlInput(uploaded.url)
      setVideoData((prev) => ({
        source: 'upload',
        mediaId: uploaded.id,
        url: uploaded.url,
        title: prev?.title || stripMediaExtension(file.name),
        coverUrl: prev?.coverUrl || null,
        platform: '实拍视频'
      }))
      showToast('success', '视频已上传')
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      showToast('error', msg)
    } finally {
      setUploadingVideo(false)
    }
  }, [])

  const handleParseVideoInput = useCallback(
    (rawInput?: string, notify = false) => {
      const candidate = (rawInput !== undefined ? rawInput : videoUrlInput).trim()
      if (!candidate) {
        if (notify) showToast('info', '请先粘贴视频链接')
        return
      }
      if (candidate.startsWith('/api/blog/media/')) {
        setVideoData((prev) => ({
          source: 'upload',
          mediaId: prev?.mediaId,
          url: candidate,
          title: prev?.title || '',
          coverUrl: prev?.coverUrl || null,
          platform: '实拍视频'
        }))
        return
      }
      const parsed = parseVideoUrl(candidate)
      if (!parsed) {
        if (notify) showToast('error', '无法识别该视频链接，请确认以 http(s):// 开头')
        return
      }
      setVideoData((prev) => ({
        ...parsed,
        title: prev?.title || parsed.title || '',
        coverUrl: prev?.coverUrl || null
      }))
      if (notify) {
        showToast(
          'success',
          parsed.embedUrl ? `已解析 ${parsed.platform || '视频'} 嵌入播放器` : '已绑定视频链接'
        )
      }
    },
    [videoUrlInput]
  )

  const handleUploadVideoCover = useCallback(async (file: File) => {
    setUploadingVideoCover(true)
    setError('')
    try {
      const [uploaded] = await uploadBlogMedia([file])
      if (uploaded) {
        setVideoData((prev) =>
          prev
            ? { ...prev, coverUrl: uploaded.url }
            : {
                source: 'url',
                url: videoUrlInput.trim(),
                coverUrl: uploaded.url
              }
        )
        showToast('success', '视频封面已上传')
      }
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      showToast('error', msg)
    } finally {
      setUploadingVideoCover(false)
    }
  }, [videoUrlInput])

  const handleSelectPlaylistTrack = useCallback(
    (trackId: string) => {
      if (!trackId) return
      const found = playlistTracks.find((item) => item.id === trackId)
      if (!found) return
      setMusicData({
        trackId: found.id,
        title: found.title,
        artist: found.artist || '',
        coverUrl: found.coverUrl || null,
        audioUrl: found.audioUrl,
        lrc: found.lrcText || undefined
      })
    },
    [playlistTracks]
  )

  const handleUploadAttachAudio = useCallback(async (file: File) => {
    setUploadingAudio(true)
    setError('')
    try {
      const uploaded = await uploadBlogFile(file, 'audio')
      setMusicData((prev) => ({
        trackId: undefined,
        title: prev?.title || stripMediaExtension(file.name) || '未命名曲目',
        artist: prev?.artist || '',
        coverUrl: prev?.coverUrl || null,
        audioUrl: uploaded.url,
        lrc: prev?.lrc
      }))
      showToast('success', '音频已上传')
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      showToast('error', msg)
    } finally {
      setUploadingAudio(false)
    }
  }, [])

  const updateMusicField = useCallback(
    (field: keyof BlogPostMusic, value: string) => {
      setMusicData((prev) => {
        const base: BlogPostMusic = prev ?? {
          title: '',
          artist: '',
          coverUrl: null,
          audioUrl: ''
        }
        if (field === 'audioUrl') {
          return { ...base, trackId: undefined, audioUrl: value }
        }
        return { ...base, [field]: value }
      })
    },
    []
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
      setActiveAttachTab(draft.linkCard ? 'link' : 'none')
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
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const files = extractClipboardImageFiles(event)
      if (!files.length) return
      event.preventDefault()
      void handleUploadInlineImages(files)
    },
    [handleUploadInlineImages]
  )

  const consumedPastedRef = useRef<File[] | null>(null)

  // Consume initialPastedFiles passed from global feed Ctrl+V paste-to-post
  useEffect(() => {
    if (!open) {
      consumedPastedRef.current = null
      return
    }
    if (!hydrated || !initialPastedFiles || initialPastedFiles.length === 0) return
    if (consumedPastedRef.current === initialPastedFiles) return
    consumedPastedRef.current = initialPastedFiles

    const imageFiles = initialPastedFiles
      .filter((file) => file.type.startsWith('image/'))
      .map((file, idx) => normalizeClipboardImageFile(file, idx))
    onConsumePastedFiles?.()

    if (!imageFiles.length) return
    if (type === 'article') {
      void handleUploadInlineImages(imageFiles)
    } else {
      void handleUploadMomentImages(imageFiles)
    }
  }, [
    open,
    hydrated,
    initialPastedFiles,
    onConsumePastedFiles,
    type,
    handleUploadInlineImages,
    handleUploadMomentImages
  ])

  // Modal-wide Ctrl+V image / GIF paste handler (avoids double-handling textarea onPaste)
  useEffect(() => {
    if (!open || typeof window === 'undefined') return

    const onWindowPaste = (event: globalThis.ClipboardEvent) => {
      if (event.defaultPrevented || busy) return
      const targetNode = event.target as Node | null
      if (
        targetNode &&
        (targetNode === momentTextareaRef.current || targetNode === articleTextareaRef.current)
      ) {
        return
      }
      const files = extractClipboardImageFilesFromData(event.clipboardData)
      if (!files.length) return
      event.preventDefault()
      if (type === 'article') {
        void handleUploadInlineImages(files)
      } else {
        void handleUploadMomentImages(files)
      }
    }

    window.addEventListener('paste', onWindowPaste)
    return () => window.removeEventListener('paste', onWindowPaste)
  }, [open, busy, type, handleUploadInlineImages, handleUploadMomentImages])

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
      type === 'moment' && activeLinkUrl
        ? {
            url: activeLinkUrl,
            title: (linkCard?.title || '').trim() || extractDomain(activeLinkUrl),
            description: (linkCard?.description || '').trim() || undefined,
            siteName: (linkCard?.siteName || '').trim() || undefined,
            image: (linkCard?.image || '').trim() || undefined
          }
        : null

    let normalizedVideo: BlogPostVideo | null = null
    const rawVideoUrl = (videoData?.url || videoUrlInput).trim()
    if (rawVideoUrl) {
      if (videoData && videoData.url.trim() === rawVideoUrl) {
        normalizedVideo = {
          ...videoData,
          url: rawVideoUrl,
          title: videoData.title?.trim() || undefined,
          coverUrl: videoData.coverUrl?.trim() || null
        }
      } else {
        const parsedVideo = parseVideoUrl(rawVideoUrl)
        if (parsedVideo) {
          normalizedVideo = {
            ...parsedVideo,
            title: videoData?.title?.trim() || undefined,
            coverUrl: videoData?.coverUrl?.trim() || null
          }
        }
      }
    }

    const rawAudioUrl = (musicData?.audioUrl || '').trim()
    const normalizedMusic: BlogPostMusic | null = rawAudioUrl
      ? {
          trackId: musicData?.trackId || undefined,
          title: (musicData?.title || '').trim() || '未命名曲目',
          artist: (musicData?.artist || '').trim() || '未知艺术家',
          coverUrl: (musicData?.coverUrl || '').trim() || null,
          audioUrl: rawAudioUrl,
          lrc: musicData?.lrc || undefined
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
      if (
        !trimmedContent &&
        images.length === 0 &&
        !normalizedLinkCard &&
        !normalizedVideo &&
        !normalizedMusic
      ) {
        setError('请输入动态正文，或添加图片、视频、音乐、外链卡片')
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

    const nextMetadata: Record<string, unknown> = { ...baseMetadata }
    if (normalizedVideo) {
      nextMetadata.video = normalizedVideo
    } else {
      delete nextMetadata.video
    }
    if (normalizedMusic) {
      nextMetadata.music = normalizedMusic
    } else {
      delete nextMetadata.music
    }

    const fallbackMomentTitle =
      type === 'moment' &&
      !trimmedTitle &&
      !trimmedContent &&
      images.length === 0 &&
      !normalizedLinkCard
        ? normalizedVideo?.title ||
          (normalizedMusic ? `分享音乐：${normalizedMusic.title}` : normalizedVideo ? '分享视频' : '')
        : trimmedTitle

    const payload: BlogPostInput = {
      type,
      title: type === 'article' ? trimmedTitle : fallbackMomentTitle,
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
      metadata: nextMetadata,
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
      await discardBlogComposerDraft(draftKey)
      setRecoverableDraft(null)
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

  const previewVideoData: BlogPostVideo | null = (() => {
    const raw = (videoData?.url || videoUrlInput).trim()
    if (!raw) return null
    if (videoData && videoData.url.trim() === raw) return videoData
    const parsed = parseVideoUrl(raw)
    if (!parsed) return null
    return {
      ...parsed,
      title: videoData?.title || parsed.title,
      coverUrl: videoData?.coverUrl || null
    }
  })()

  const previewMusicData: BlogPostMusic | null =
    musicData && musicData.audioUrl.trim()
      ? {
          ...musicData,
          title: musicData.title.trim() || '未命名曲目',
          artist: musicData.artist.trim() || '未知艺术家',
          audioUrl: musicData.audioUrl.trim()
        }
      : null

  const toggleAttachTab = (tab: Exclude<ComposerAttachTab, 'none'>) => {
    setActiveAttachTab((prev) => (prev === tab ? 'none' : tab))
  }

  const attachmentSection = (
    <div className="blog-p2-attach-section">
      <div className="blog-p2-attach-tabs" role="tablist" aria-label="多媒体卡片附件">
        {type === 'moment' && (
          <button
            type="button"
            role="tab"
            aria-selected={activeAttachTab === 'link'}
            className={activeAttachTab === 'link' ? 'is-active' : undefined}
            onClick={() => toggleAttachTab('link')}
          >
            <AppIcon name="link" size={14} />
            <span>外链卡片{previewCardData ? ' · 已配' : ''}</span>
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={activeAttachTab === 'video'}
          className={activeAttachTab === 'video' ? 'is-active' : undefined}
          onClick={() => toggleAttachTab('video')}
        >
          <AppIcon name="video" size={14} />
          <span>视频动态{previewVideoData ? ' · 已配' : ''}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeAttachTab === 'music'}
          className={activeAttachTab === 'music' ? 'is-active' : undefined}
          onClick={() => toggleAttachTab('music')}
        >
          <AppIcon name="music" size={14} />
          <span>音乐卡片{previewMusicData ? ' · 已配' : ''}</span>
        </button>
      </div>

      {type === 'moment' && activeAttachTab === 'link' && (
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
              <div
                className="blog-share-card"
                style={{ marginTop: 0, maxWidth: '100%', flex: 1, cursor: 'default' }}
              >
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
                className="blog-btn blog-btn-danger blog-btn-sm"
                onClick={() => {
                  setLinkCard(null)
                  setLinkUrlInput('')
                }}
              >
                移除卡片
              </button>
            </div>
          )}
        </div>
      )}

      {activeAttachTab === 'video' && (
        <div className="blog-link-preview-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="blog-btn blog-btn-subtle blog-btn-sm"
              disabled={uploadingVideo}
              onClick={() => videoFileInputRef.current?.click()}
            >
              <AppIcon name="upload" size={14} />
              <span>{uploadingVideo ? '上传视频中…' : '上传视频 (.mp4/.mov/.webm)'}</span>
            </button>

            <input
              ref={videoFileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void handleUploadAttachVideo(file)
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 220 }}>
              <input
                type="url"
                className="blog-input"
                value={videoUrlInput}
                onChange={(e) => {
                  const val = e.target.value
                  setVideoUrlInput(val)
                  if (!val.trim()) {
                    setVideoData(null)
                    return
                  }
                  const parsed = parseVideoUrl(val)
                  if (parsed) {
                    setVideoData((prev) => ({
                      ...parsed,
                      title: prev?.title || parsed.title || '',
                      coverUrl: prev?.coverUrl || null
                    }))
                  }
                }}
                placeholder="或粘贴 Bilibili (BV号) / YouTube / 视频直链 URL"
              />
              <button
                type="button"
                className="blog-btn blog-btn-ghost blog-btn-sm"
                disabled={!videoUrlInput.trim()}
                onClick={() => handleParseVideoInput(videoUrlInput, true)}
              >
                解析链接
              </button>
            </div>
          </div>

          <div className="blog-composer-grid">
            <input
              type="text"
              className="blog-input"
              value={videoData?.title || ''}
              onChange={(e) => {
                const nextTitle = e.target.value
                setVideoData((prev) =>
                  prev
                    ? { ...prev, title: nextTitle }
                    : {
                        source: 'url',
                        url: videoUrlInput.trim(),
                        title: nextTitle
                      }
                )
              }}
              placeholder="视频标题（可选）"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="url"
                className="blog-input"
                value={videoData?.coverUrl || ''}
                onChange={(e) => {
                  const nextCover = e.target.value
                  setVideoData((prev) =>
                    prev
                      ? { ...prev, coverUrl: nextCover || null }
                      : {
                          source: 'url',
                          url: videoUrlInput.trim(),
                          coverUrl: nextCover || null
                        }
                  )
                }}
                placeholder="视频封面 URL（可选）"
              />
              <button
                type="button"
                className="blog-btn blog-btn-subtle blog-btn-sm"
                disabled={uploadingVideoCover}
                onClick={() => videoCoverInputRef.current?.click()}
              >
                {uploadingVideoCover ? '上传中…' : '封面'}
              </button>
              <input
                ref={videoCoverInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void handleUploadVideoCover(file)
                }}
              />
            </div>
          </div>

          {previewVideoData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <BlogVideoCard video={previewVideoData} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="blog-btn blog-btn-danger blog-btn-sm"
                  onClick={() => {
                    setVideoData(null)
                    setVideoUrlInput('')
                  }}
                >
                  移除视频
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeAttachTab === 'music' && (
        <div className="blog-link-preview-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="blog-input"
              style={{ flex: 1, minWidth: 200 }}
              value={musicData?.trackId || ''}
              onChange={(e) => handleSelectPlaylistTrack(e.target.value)}
            >
              <option value="">
                {tracksLoading
                  ? '正在加载歌单…'
                  : playlistTracks.length > 0
                    ? '从博客歌单选择曲目…'
                    : '歌单暂无曲目（可上传音频或粘贴链接）'}
              </option>
              {playlistTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.title}
                  {track.artist ? ` — ${track.artist}` : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="blog-btn blog-btn-subtle blog-btn-sm"
              disabled={uploadingAudio}
              onClick={() => musicAudioInputRef.current?.click()}
            >
              <AppIcon name="upload" size={14} />
              <span>{uploadingAudio ? '上传音频中…' : '上传音频'}</span>
            </button>
            <input
              ref={musicAudioInputRef}
              type="file"
              accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,audio/webm,audio/flac,.mp3,.m4a,.ogg,.wav,.flac,.webm"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void handleUploadAttachAudio(file)
              }}
            />
          </div>

          <input
            type="url"
            className="blog-input"
            value={musicData?.audioUrl || ''}
            onChange={(e) => updateMusicField('audioUrl', e.target.value)}
            placeholder="或直接粘贴音频直链 URL（.mp3 / .m4a / .ogg 等）"
          />

          <div className="blog-composer-grid">
            <input
              type="text"
              className="blog-input"
              value={musicData?.title || ''}
              onChange={(e) => updateMusicField('title', e.target.value)}
              placeholder="歌曲名称"
            />
            <input
              type="text"
              className="blog-input"
              value={musicData?.artist || ''}
              onChange={(e) => updateMusicField('artist', e.target.value)}
              placeholder="歌手 / 艺术家"
            />
          </div>

          <input
            type="url"
            className="blog-input"
            value={musicData?.coverUrl || ''}
            onChange={(e) => updateMusicField('coverUrl', e.target.value)}
            placeholder="专辑封面图 URL（可选）"
          />

          {previewMusicData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <BlogMusicCard music={previewMusicData} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="blog-btn blog-btn-danger blog-btn-sm"
                  onClick={() => setMusicData(null)}
                >
                  移除音乐
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )

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
          attemptClose()
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
                onClick={() => {
                  setType('article')
                  setActiveAttachTab((prev) => (prev === 'link' ? 'none' : prev))
                }}
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
                onClick={attemptClose}
              >
                <AppIcon name="close" size={16} />
              </button>
            </div>
          </header>

          {/* Body */}
          <div className="blog-modal-body">
            {recoverableDraft && !isDirty && (
              <div className="blog-draft-banner" role="status">
                <div className="blog-draft-banner-text">
                  <AppIcon name="edit" size={14} />
                  <span>发现未发布草稿</span>
                </div>
                <div className="blog-draft-banner-actions">
                  <button
                    type="button"
                    className="blog-btn blog-btn-primary blog-btn-sm"
                    onClick={handleRestoreDraft}
                  >
                    恢复草稿
                  </button>
                  <button
                    type="button"
                    className="blog-btn blog-btn-ghost blog-btn-sm"
                    onClick={handleDiscardDraft}
                  >
                    丢弃
                  </button>
                </div>
              </div>
            )}

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
                  {/* Emoji Picker & Clipboard Paste Hint */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <BlogEmojiTrigger
                      label="表情"
                      onSelect={insertEmojiAtCursor}
                      disabled={busy}
                    />
                    <span className="blog-paste-hint">支持 Ctrl+V 粘贴图片 / GIF</span>
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
                          className={`blog-p2-live-attach-btn${img.liveVideoUrl ? ' is-active' : ''}`}
                          style={images.length > 1 ? { top: 4, left: 4, bottom: 'auto' } : undefined}
                          disabled={uploadingLiveIndex !== null}
                          title={
                            img.liveVideoUrl
                              ? '点击移除已配对的实况视频'
                              : '上传配对短视频（.mp4/.mov/.webm）生成实况图'
                          }
                          onClick={(e) => {
                            e.stopPropagation()
                            if (img.liveVideoUrl) {
                              handleDetachLiveVideo(idx)
                            } else {
                              setLiveTargetIndex(idx)
                              liveVideoInputRef.current?.click()
                            }
                          }}
                        >
                          {uploadingLiveIndex === idx
                            ? '上传中…'
                            : img.liveVideoUrl
                              ? '已配实况 ×'
                              : '实况'}
                        </button>
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
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    hidden
                    onChange={(e) => {
                      const files = e.target.files ? Array.from(e.target.files) : []
                      e.target.value = ''
                      if (files.length) void handleUploadMomentImages(files)
                    }}
                  />
                  <input
                    ref={liveVideoInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file && liveTargetIndex !== null) {
                        void handleUploadLiveVideo(liveTargetIndex, file)
                      }
                    }}
                  />
                </div>

                {/* Multi-Media Attachment Toolbar (Link Card / Video / Music) */}
                {attachmentSection}

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
                    accept="image/png,image/jpeg,image/webp,image/gif"
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
                    <BlogEmojiTrigger
                      label="表情"
                      onSelect={insertEmojiAtCursor}
                      disabled={busy}
                    />

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
                    accept="image/png,image/jpeg,image/webp,image/gif"
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
                    <span className="blog-paste-hint">支持 Ctrl+V 粘贴图片 / GIF</span>
                  </div>
                </div>

                {/* Optional Article Audio / Video Attachments */}
                {attachmentSection}
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
              <button type="button" className="blog-btn blog-btn-ghost" disabled={busy} onClick={attemptClose}>
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
