import { useEffect, useId, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Category } from '../types'

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 20 * 1024 * 1024
const MAX_FILES = 30

export function CategoryField({
  categories,
  categoryId,
  onCategoryChange
}: {
  categories: Category[]
  categoryId: string
  onCategoryChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>类别</span>
      <select value={categoryId} onChange={(event) => onCategoryChange(event.target.value)}>
        <option value="">未分类</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>{category.name}</option>
        ))}
      </select>
    </label>
  )
}

function FilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
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
      <button type="button" className="small-button" onClick={onRemove}>移除</button>
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
  compact = false
}: {
  files: File[]
  onChange: (files: File[]) => void
  onError: (message: string) => void
  existingCount?: number
  compact?: boolean
}) {
  const inputId = useId()

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
      {files.length > 0 && (
        <ul className="pending-images">
          {files.map((file, index) => (
            <FilePreview
              key={file.name + ':' + file.size + ':' + index}
              file={file}
              onRemove={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
