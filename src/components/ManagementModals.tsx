import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, errorMessage, jsonRequest } from '../api'
import type { Category, ImageAsset } from '../types'
import { ErrorNotice, Modal } from './Modal'

export function CategoriesManager({
  categories,
  onChanged,
  onClose
}: {
  categories: Category[]
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const [rows, setRows] = useState(categories)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#64748b')
  const [error, setError] = useState('')

  useEffect(() => setRows(categories), [categories])

  async function save(category: Category) {
    setError('')
    try {
      await jsonRequest('/api/categories/' + category.id, 'PUT', {
        name: category.name,
        color: category.color
      })
      await onChanged()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  async function remove(category: Category) {
    if (!window.confirm('删除“' + category.name + '”后，相关条目会变成未分类。确定继续吗？')) return
    setError('')
    try {
      await api('/api/categories/' + category.id, { method: 'DELETE' })
      await onChanged()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await jsonRequest('/api/categories', 'POST', { name: newName, color: newColor })
      setNewName('')
      await onChanged()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  return (
    <Modal title="类别管理" onClose={onClose}>
      <div className="stack">
        <ErrorNotice message={error} />
        <ul className="category-editor">
          {rows.map((category, index) => (
            <li key={category.id}>
              <input
                type="color"
                aria-label={category.name + '的颜色'}
                value={category.color}
                onChange={(event) => {
                  const next = [...rows]
                  next[index] = { ...category, color: event.target.value }
                  setRows(next)
                }}
              />
              <input
                aria-label="类别名称"
                maxLength={40}
                value={category.name}
                onChange={(event) => {
                  const next = [...rows]
                  next[index] = { ...category, name: event.target.value }
                  setRows(next)
                }}
              />
              <button type="button" className="small-button" onClick={() => void save(category)}>保存</button>
              <button type="button" className="small-button danger-text" onClick={() => void remove(category)}>删除</button>
            </li>
          ))}
        </ul>
        <form className="category-add" onSubmit={add}>
          <input type="color" aria-label="新类别颜色" value={newColor} onChange={(event) => setNewColor(event.target.value)} />
          <input
            required
            maxLength={40}
            placeholder="新类别名称"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <button className="button button-primary">添加类别</button>
        </form>
      </div>
    </Modal>
  )
}

export function AccountManager({
  email,
  onClose
}: {
  email: string
  onClose: () => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await jsonRequest('/api/auth/change-password', 'POST', { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      setSuccess('密码已更新')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="账号设置" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">当前账号：{email}</p>
        <ErrorNotice message={error} />
        {success && <div className="notice notice-success" role="status">{success}</div>}
        <label className="field">
          <span>当前密码</span>
          <input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label className="field">
          <span>新密码</span>
          <input type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label className="field">
          <span>再次输入新密码</span>
          <input type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </label>
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>关闭</button>
          <button className="button button-primary" disabled={busy}>{busy ? '更新中…' : '修改密码'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function BookmarkletHelp({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const bookmarkRef = useRef<HTMLAnchorElement>(null)
  const origin = window.location.origin
  const code =
    'javascript:(()=>{const u=' +
    JSON.stringify(origin + '/?add=link&url=') +
    "+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);location.href=u})()"

  useEffect(() => {
    bookmarkRef.current?.setAttribute('href', code)
  }, [code])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Modal title="浏览器书签按钮" onClose={onClose}>
      <div className="stack">
        <p>保持本应用正在运行，把下面的按钮拖到浏览器书签栏。以后浏览普通网页时点它，会在当前标签页回到添加页面并带入网址和标题。</p>
        <div className="bookmarklet-box">
          <a
            ref={bookmarkRef}
            className="button button-primary"
            draggable
            onClick={(event) => event.preventDefault()}
          >
            稍后保存
          </a>
        </div>
        <p className="muted">它不能在浏览器的新标签页、设置页等内部页面运行。如果拖动后仍无效，请复制代码，新建书签，并确认书签地址以 javascript: 开头。</p>
        <button type="button" className="button" onClick={() => void copy()}>
          {copied ? '已复制' : '复制书签代码'}
        </button>
      </div>
    </Modal>
  )
}

export function Lightbox({
  assets,
  initialIndex,
  onClose
}: {
  assets: ImageAsset[]
  initialIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(Math.min(initialIndex, assets.length - 1))
  const asset = assets[index]

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') setIndex((value) => (value - 1 + assets.length) % assets.length)
      if (event.key === 'ArrowRight') setIndex((value) => (value + 1) % assets.length)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [assets.length])

  if (!asset) return null
  return (
    <Modal title={asset.originalName || '查看图片'} onClose={onClose} wide>
      <div className="lightbox">
        <img src={asset.originalUrl} alt={asset.originalName} />
        <div className="lightbox-controls">
          <button
            type="button"
            className="button"
            disabled={assets.length <= 1}
            onClick={() => setIndex((value) => (value - 1 + assets.length) % assets.length)}
          >
            上一张
          </button>
          <span>{index + 1} / {assets.length}</span>
          <button
            type="button"
            className="button"
            disabled={assets.length <= 1}
            onClick={() => setIndex((value) => (value + 1) % assets.length)}
          >
            下一张
          </button>
        </div>
      </div>
    </Modal>
  )
}
