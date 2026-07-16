import { useEffect, useId, useState, type ClipboardEvent, type DragEvent } from 'react'
import { errorMessage } from '../api'
import type { Category } from '../types'
import { AppIcon } from './AppIcon'

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 20 * 1024 * 1024
const MAX_FILES = 30

export function CategoryField({
  categories,
  categoryId,
  onCategoryChange,
  onCreateCategory
}: {
  categories: Category[]
  categoryId: string
  onCategoryChange: (value: string) => void
  onCreateCategory?: (name: string, color: string) => Promise<Category>
}) {
  const selectId = useId()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#64748b')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function createCategory() {
    const trimmed = name.trim()
    if (!trimmed || !onCreateCategory || creating) return
    setCreating(true)
    setError('')
    try {
      const category = await onCreateCategory(trimmed, color)
      onCategoryChange(category.id)
      setName('')
      setAdding(false)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="field category-field">
      <div className="field-label-row">
        <label htmlFor={selectId}>类别</label>
        {onCreateCategory && (
          <button
            type="button"
            className="category-add-trigger"
            aria-expanded={adding}
            onClick={() => {
              setAdding((value) => !value)
              setError('')
            }}
          >
            <AppIcon name="add" size={15} />
            {adding ? '收起' : '新增类别'}
          </button>
        )}
      </div>
      <select id={selectId} value={categoryId} onChange={(event) => onCategoryChange(event.target.value)}>
        <option value="">未分类</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>{category.name}</option>
        ))}
      </select>
      {adding && onCreateCategory && (
        <div className="category-quick-add" role="group" aria-label="新增类别">
          <input
            aria-label="新类别名称"
            maxLength={40}
            placeholder="输入类别名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void createCategory()
              }
            }}
            autoFocus
          />
          <input
            type="color"
            aria-label="新类别颜色"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
          <button type="button" className="button button-primary button-small" disabled={!name.trim() || creating} onClick={() => void createCategory()}>
            {creating ? '添加中…' : '添加并选中'}
          </button>
          <button type="button" className="button button-small" disabled={creating} onClick={() => {
            setAdding(false)
            setError('')
          }}>
            取消
          </button>
          {error && <span className="category-quick-error" role="alert">{error}</span>}
        </div>
      )}
    </div>
  )
}

function FilePreview({
  file,
  index,
  total,
  onRemove,
  onMove
}: {
  file: File
  index: number
  total: number
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return (
    <li className="pending-image">
      {url && <img src={url} alt="" />}
      <span title={file.name}>{file.name}</span>
      <span className="pending-image-order">第 {index + 1} 张</span>
      <div className="pending-image-actions">
        <button type="button" className="small-button" disabled={index === 0} onClick={() => onMove(-1)}>前移</button>
        <button type="button" className="small-button" disabled={index === total - 1} onClick={() => onMove(1)}>后移</button>
      <button type="button" className="small-button" onClick={onRemove}>
        <AppIcon name="delete" size={16} />移除
      </button>
      </div>
    </li>
  )
}

export function validateImageFiles(files: File[], existingCount = 0) {
  const accepted: File[] = []
  let error = ''
  for (const file of files) {
    if (!ACCEPTED_TYPES.has(file.type)) {
      error = '只支持 PNG、JPEG 和 WebP 图片'
      continue
    }
    if (file.size > MAX_BYTES) {
      error = '单张图片不能超过 20 MB'
      continue
    }
    if (existingCount + accepted.length >= MAX_FILES) {
      error = '每个条目最多保存 30 张图片'
      break
    }
    accepted.push(file)
  }
  return { accepted, error }
}

export function ImageInput({
  files,
  onChange,
  onError,
  existingCount = 0,
  compact = false,
  collapsible = false
}: {
  files: File[]
  onChange: (files: File[]) => void
  onError: (message: string) => void
  existingCount?: number
  compact?: boolean
  collapsible?: boolean
}) {
  const inputId = useId()
  const [expanded, setExpanded] = useState(!collapsible || files.length > 0)

  function add(input: File[]) {
    const result = validateImageFiles(input, existingCount + files.length)
    if (result.error) onError(result.error)
    if (result.accepted.length) onChange([...files, ...result.accepted])
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
    if (images.length) {
      event.preventDefault()
      add(images)
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    add(Array.from(event.dataTransfer.files))
  }

  return (
    <div className={compact ? 'image-input compact' : 'image-input'}>
      {collapsible && (
        <button type="button" className="image-input-summary" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <AppIcon name="image" size={18} />
          <span>{files.length ? `已选择 ${files.length} 张截图` : '添加相关截图（可选）'}</span>
          <span aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>
      )}
      {expanded && (
      <div
        className={compact ? 'image-dropzone compact' : 'image-dropzone'}
        tabIndex={0}
        onPaste={onPaste}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <strong>拖入图片或按 Ctrl+V 粘贴</strong>
        <span>PNG、JPEG、WebP，单张不超过 20 MB</span>
        <label htmlFor={inputId} className="button button-small">选择图片</label>
        <input
          id={inputId}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(event) => {
            add(Array.from(event.target.files || []))
            event.target.value = ''
          }}
        />
      </div>
      )}
      {files.length > 0 && (
        <ul className="pending-images">
          {files.map((file, index) => (
            <FilePreview
              key={file.name + ':' + file.size + ':' + index}
              file={file}
              index={index}
              total={files.length}
              onMove={(direction) => {
                const nextIndex = index + direction
                if (nextIndex < 0 || nextIndex >= files.length) return
                const next = [...files]
                const current = next[index]
                next[index] = next[nextIndex]
                next[nextIndex] = current
                onChange(next)
              }}
              onRemove={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
