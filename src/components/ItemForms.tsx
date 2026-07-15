import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiRequestError, api, errorMessage, jsonRequest } from '../api'
import { discardDraft, loadDraft, saveDraft } from '../draft-store'
import type { Category, ImageAsset, LibraryItem } from '../types'
import { CategoryField, ImageInput } from './FormFields'
import { ErrorNotice } from './Modal'

interface BaseFormProps {
  categories: Category[]
  onCreateCategory: (name: string, color: string) => Promise<Category>
  onSaved: (item: LibraryItem) => void
  onClose: () => void
}

function defaultCategory(categories: Category[]) {
  return categories.find((category) => category.name === '其他')?.id || categories[0]?.id || ''
}

interface MetadataResult {
  url: string
  normalizedUrl: string
  title: string
  siteName: string
  coverUrl: string
}

export function LinkForm({
  categories,
  initial,
  onCreateCategory,
  onSaved,
  onClose,
  onDuplicate
}: BaseFormProps & {
  initial?: { url?: string; title?: string }
  onDuplicate: (id: string) => void
}) {
  const [url, setUrl] = useState(initial?.url || '')
  const [title, setTitle] = useState(initial?.title || '')
  const [categoryId, setCategoryId] = useState(defaultCategory(categories))
  const [coverUrl, setCoverUrl] = useState('')
  const [coverVisible, setCoverVisible] = useState(true)
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [duplicateId, setDuplicateId] = useState('')
  const lastFetched = useRef('')
  const draftKey = 'new-link'

  async function readMetadata(target = url) {
    const trimmed = target.trim()
    if (!trimmed || fetching || lastFetched.current === trimmed) return
    setFetching(true)
    setError('')
    lastFetched.current = trimmed
    try {
      const metadata = await jsonRequest<MetadataResult>('/api/metadata', 'POST', { url: trimmed })
      setUrl(metadata.normalizedUrl)
      setTitle((current) => current.trim() || metadata.title)
      setCoverUrl(metadata.coverUrl)
      setCoverVisible(true)
    } catch (requestError) {
      setError(errorMessage(requestError) + '。你仍可手动填写标题并保存。')
    } finally {
      setFetching(false)
    }
  }

  useEffect(() => {
    if (initial?.url) void readMetadata(initial.url)
    // Only process bookmarklet data once when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let active = true
    if (initial?.url) {
      setDraftReady(true)
      return () => { active = false }
    }
    void loadDraft(draftKey).then((draft) => {
      if (!active || !draft) return
      setUrl(String(draft.data.url || ''))
      setTitle(String(draft.data.title || ''))
      setCategoryId(String(draft.data.categoryId || ''))
      setCoverUrl(String(draft.data.coverUrl || ''))
      setFiles(draft.files || [])
    }).finally(() => {
      if (active) setDraftReady(true)
    })
    return () => { active = false }
  }, [initial?.url])

  useEffect(() => {
    if (!draftReady || (!url.trim() && !title.trim() && !files.length)) return
    const timer = window.setTimeout(() => {
      void saveDraft({
        key: draftKey,
        type: 'link',
        data: { url, title, categoryId, coverUrl },
        files
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [categoryId, coverUrl, draftReady, files, title, url])

  function discardAndClose() {
    void discardDraft(draftKey)
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setDuplicateId('')
    const form = new FormData()
    form.set('url', url)
    form.set('title', title)
    form.set('categoryId', categoryId)
    form.set('coverUrl', coverUrl)
    files.forEach((file) => form.append('images', file))
    try {
      const item = await api<LibraryItem>('/api/items/link', { method: 'POST', body: form })
      await discardDraft(draftKey)
      onSaved(item)
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status === 409) {
        const details = requestError.details as { existingId?: string } | undefined
        if (details?.existingId) {
          setError(requestError.message)
          setDuplicateId(details.existingId)
          return
        }
      }
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <ErrorNotice message={error} />
      {duplicateId && (
        <div className="duplicate-notice" role="status">
          <strong>已经保存过了</strong>
          <span>原条目没有被修改，录入时间也保持不变。</span>
          <button type="button" className="button button-small" onClick={() => onDuplicate(duplicateId)}>
            查看已有条目
          </button>
        </div>
      )}
      <label className="field">
        <span>网页地址</span>
        <div className="inline-field">
          <input
            type="url"
            aria-label="网页地址"
            required
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              lastFetched.current = ''
            }}
            onBlur={() => {
              if (!title.trim()) void readMetadata()
            }}
            placeholder="https://example.com/article"
            autoFocus
          />
          <button type="button" className="button" onClick={() => void readMetadata()} disabled={fetching || !url}>
            {fetching ? '获取中…' : '获取标题'}
          </button>
        </div>
      </label>
      <label className="field">
        <span>标题</span>
        <input required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      {coverUrl && coverVisible && (
        <div className="cover-preview">
          <img src={coverUrl} alt="网页封面预览" onError={() => setCoverVisible(false)} />
          <span>保存时会把这张网页封面下载到本机</span>
        </div>
      )}
      <CategoryField
        categories={categories}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
        onCreateCategory={onCreateCategory}
      />
      <div className="field">
        <span>相关截图（可选）</span>
        <ImageInput files={files} onChange={setFiles} onError={setError} />
      </div>
      <div className="form-actions">
        <button type="button" className="button" onClick={discardAndClose}>取消</button>
        <button className="button button-primary" disabled={saving}>
          {saving ? '保存中…' : '保存网页'}
        </button>
      </div>
    </form>
  )
}

function pastedTextTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 300)
}

export function TextItemForm({
  categories,
  initialText,
  onCreateCategory,
  onSaved,
  onClose
}: BaseFormProps & { initialText: string }) {
  const [title, setTitle] = useState(() => pastedTextTitle(initialText))
  const [categoryId, setCategoryId] = useState(defaultCategory(categories))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const draftKey = 'new-text'

  useEffect(() => {
    let active = true
    if (initialText) {
      setDraftReady(true)
      return () => { active = false }
    }
    void loadDraft(draftKey).then((draft) => {
      if (!active || !draft) return
      setTitle(String(draft.data.title || ''))
      setCategoryId(String(draft.data.categoryId || ''))
    }).finally(() => {
      if (active) setDraftReady(true)
    })
    return () => { active = false }
  }, [initialText])

  useEffect(() => {
    if (!draftReady || !title.trim()) return
    const timer = window.setTimeout(() => {
      void saveDraft({ key: draftKey, type: 'text', data: { title, categoryId }, files: [] })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [categoryId, draftReady, title])

  function discardAndClose() {
    void discardDraft(draftKey)
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const saved = await jsonRequest<LibraryItem>('/api/items/text', 'POST', { title, categoryId })
      await discardDraft(draftKey)
      onSaved(saved)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <ErrorNotice message={error} />
      <label className="field">
        <span>标题</span>
        <input
          required
          maxLength={300}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
      </label>
      <CategoryField
        categories={categories}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
        onCreateCategory={onCreateCategory}
      />
      <div className="form-actions">
        <button type="button" className="button" onClick={discardAndClose}>取消</button>
        <button className="button button-primary" disabled={saving}>
          {saving ? '保存中…' : '保存文本'}
        </button>
      </div>
    </form>
  )
}

function newImageGroupTitle() {
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date())
  return '图片组 · ' + date
}

export function ImageGroupForm({
  categories,
  initialFiles = [],
  onCreateCategory,
  onSaved,
  onClose
}: BaseFormProps & { initialFiles?: File[] }) {
  const [title, setTitle] = useState(newImageGroupTitle)
  const [categoryId, setCategoryId] = useState(defaultCategory(categories))
  const [files, setFiles] = useState<File[]>(initialFiles)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const draftKey = 'new-images'

  useEffect(() => {
    let active = true
    if (initialFiles.length) {
      setDraftReady(true)
      return () => { active = false }
    }
    void loadDraft(draftKey).then((draft) => {
      if (!active || !draft) return
      setTitle(String(draft.data.title || newImageGroupTitle()))
      setCategoryId(String(draft.data.categoryId || ''))
      setFiles(draft.files || [])
    }).finally(() => {
      if (active) setDraftReady(true)
    })
    return () => { active = false }
  }, [initialFiles.length])

  useEffect(() => {
    if (!draftReady || !files.length) return
    const timer = window.setTimeout(() => {
      void saveDraft({ key: draftKey, type: 'images', data: { title, categoryId }, files })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [categoryId, draftReady, files, title])

  function discardAndClose() {
    void discardDraft(draftKey)
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!files.length) {
      setError('请至少添加一张图片')
      return
    }
    setSaving(true)
    setError('')
    const form = new FormData()
    form.set('title', title)
    form.set('categoryId', categoryId)
    files.forEach((file) => form.append('images', file))
    try {
      const saved = await api<LibraryItem>('/api/items/image-group', { method: 'POST', body: form })
      await discardDraft(draftKey)
      onSaved(saved)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <ErrorNotice message={error} />
      <label className="field">
        <span>图片组标题</span>
        <input required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
      </label>
      <CategoryField
        categories={categories}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
        onCreateCategory={onCreateCategory}
      />
      <ImageInput files={files} onChange={setFiles} onError={setError} compact />
      <div className="form-actions">
        <button type="button" className="button" onClick={discardAndClose}>取消</button>
        <button className="button button-primary" disabled={saving}>
          {saving ? '保存中…' : '保存图片组'}
        </button>
      </div>
    </form>
  )
}

function manualAssets(item: LibraryItem) {
  return item.assets.filter((asset) => asset.role !== 'web_cover')
}

export function EditItemForm({
  item: initialItem,
  categories,
  onCreateCategory,
  onSaved,
  onClose,
  onPreview
}: BaseFormProps & {
  item: LibraryItem
  onPreview: (assets: ImageAsset[], index: number) => void
}) {
  const [item, setItem] = useState(initialItem)
  const [title, setTitle] = useState(initialItem.title)
  const [url, setUrl] = useState(initialItem.url || '')
  const [categoryId, setCategoryId] = useState(initialItem.category?.id || '')
  const [status, setStatus] = useState(initialItem.status)
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [isStarred, setIsStarred] = useState(initialItem.isStarred)
  const [plannedFor, setPlannedFor] = useState(initialItem.plannedFor || '')
  const draftKey = 'edit-' + initialItem.id
  const assets = manualAssets(item)
  const webCover = item.assets.find((asset) => asset.role === 'web_cover')

  useEffect(() => {
    let active = true
    void loadDraft(draftKey).then((draft) => {
      if (!active || !draft) return
      setTitle(String(draft.data.title || initialItem.title))
      setUrl(String(draft.data.url || initialItem.url || ''))
      setCategoryId(String(draft.data.categoryId || ''))
      if (draft.data.status === 'pending' || draft.data.status === 'completed') setStatus(draft.data.status)
      setIsStarred(Boolean(draft.data.isStarred))
      setPlannedFor(String(draft.data.plannedFor || ''))
      setFiles(draft.files || [])
    }).finally(() => {
      if (active) setDraftReady(true)
    })
    return () => { active = false }
  }, [draftKey, initialItem.title, initialItem.url])

  useEffect(() => {
    if (!draftReady) return
    const hasChanges = title !== initialItem.title ||
      url !== (initialItem.url || '') ||
      categoryId !== (initialItem.category?.id || '') ||
      status !== initialItem.status ||
      isStarred !== initialItem.isStarred ||
      plannedFor !== (initialItem.plannedFor || '') ||
      files.length > 0
    if (!hasChanges) {
      void discardDraft(draftKey)
      return
    }
    const timer = window.setTimeout(() => {
      void saveDraft({
        key: draftKey,
        type: 'edit',
        itemId: item.id,
        data: { title, url, categoryId, status, isStarred, plannedFor },
        files
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [categoryId, draftKey, draftReady, files, initialItem, isStarred, item.id, plannedFor, status, title, url])

  function discardAndClose() {
    void discardDraft(draftKey)
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      let updated = await jsonRequest<LibraryItem>('/api/items/' + item.id, 'PUT', {
        title,
        url,
        categoryId,
        status,
        isStarred,
        plannedFor: status === 'completed' ? null : (plannedFor || null)
      })
      if (files.length) {
        const form = new FormData()
        files.forEach((file) => form.append('images', file))
        updated = await api<LibraryItem>('/api/items/' + item.id + '/assets', {
          method: 'POST',
          body: form
        })
      }
      setItem(updated)
      await discardDraft(draftKey)
      onSaved(updated)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  async function reorder(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= assets.length) return
    const reordered = [...assets]
    const temporary = reordered[index]
    reordered[index] = reordered[nextIndex]
    reordered[nextIndex] = temporary
    try {
      const updated = await jsonRequest<LibraryItem>(
        '/api/items/' + item.id + '/assets/order',
        'PUT',
        { ids: reordered.map((asset) => asset.id) }
      )
      setItem(updated)
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  async function removeAsset(asset: ImageAsset) {
    if (!window.confirm('确定删除这张图片吗？')) return
    try {
      const updated = await api<LibraryItem>('/api/assets/' + asset.id, { method: 'DELETE' })
      setItem(updated)
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <ErrorNotice message={error} />
      <div className="form-grid">
        <label className="field">
          <span>标题</span>
          <input required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as 'pending' | 'completed')}>
            <option value="pending">待处理</option>
            <option value="completed">已完成</option>
          </select>
        </label>
      </div>
      {item.kind === 'link' && (
        <label className="field">
          <span>网页地址</span>
          <input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
      )}
      <CategoryField
        categories={categories}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
        onCreateCategory={onCreateCategory}
      />
      <div className="form-grid item-priority-fields">
        <label className="field checkbox-field">
          <span>长期优先</span>
          <span className="inline-check">
            <input type="checkbox" checked={isStarred} onChange={(event) => setIsStarred(event.target.checked)} />
            星标条目
          </span>
        </label>
        <label className="field">
          <span>计划处理日期</span>
          <input
            type="date"
            disabled={status === 'completed'}
            value={status === 'completed' ? '' : plannedFor}
            onChange={(event) => setPlannedFor(event.target.value)}
          />
        </label>
      </div>
      {webCover && (
        <div className="saved-cover">
          <span>网页封面</span>
          <button type="button" className="image-button" onClick={() => onPreview([webCover], 0)}>
            <img src={webCover.thumbUrl} alt="网页封面" />
          </button>
        </div>
      )}
      {item.kind !== 'text' && <div className="field">
        <span>{item.kind === 'link' ? '相关截图' : '图片组内容'}</span>
        {assets.length > 0 && (
          <ul className="asset-editor">
            {assets.map((asset, index) => (
              <li key={asset.id}>
                <button type="button" className="image-button" onClick={() => onPreview(assets, index)}>
                  <img src={asset.thumbUrl} alt={asset.originalName} />
                </button>
                <span title={asset.originalName}>{asset.originalName}</span>
                <div className="asset-actions">
                  <button type="button" className="small-button" disabled={index === 0} onClick={() => void reorder(index, -1)}>
                    前移
                  </button>
                  <button
                    type="button"
                    className="small-button"
                    disabled={index === assets.length - 1}
                    onClick={() => void reorder(index, 1)}
                  >
                    后移
                  </button>
                  <button type="button" className="small-button danger-text" onClick={() => void removeAsset(asset)}>
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <ImageInput
          files={files}
          onChange={setFiles}
          onError={setError}
          existingCount={assets.length}
          compact
        />
      </div>}
      <div className="form-actions">
        <button type="button" className="button" onClick={discardAndClose}>取消</button>
        <button className="button button-primary" disabled={saving}>
          {saving ? '保存中…' : '保存修改'}
        </button>
      </div>
    </form>
  )
}
