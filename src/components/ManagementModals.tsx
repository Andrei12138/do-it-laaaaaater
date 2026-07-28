import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Button, Card, Select } from 'animal-island-ui'
import { api, errorMessage, jsonRequest } from '../api'
import { requestPwaInstall, usePwaInstall } from '../pwa'
import { useTheme } from '../theme'
import type { AppPreferences, Category, ImageAsset } from '../types'
import { AppIcon } from './AppIcon'
import { BackupManager } from './BackupManager'
import { ErrorNotice, Modal } from './Modal'
import { OfflineStatusContent } from './OfflineManager'

function publicAppOrigin() {
  const configuredUrl = (import.meta.env.VITE_PUBLIC_APP_URL || '').trim()
  if (!configuredUrl) return window.location.origin
  try {
    return new URL(configuredUrl).origin
  } catch {
    return window.location.origin
  }
}

function AccountPanel({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const { theme } = useTheme()
  const classes = `account-section ${className}`
  if (theme === 'animal-island') {
    return <Card className={classes} pattern="default" role="region" aria-label={label}>{children}</Card>
  }
  return <section className={classes} aria-label={label}>{children}</section>
}

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
              <button type="button" className="small-button" onClick={() => void save(category)}>
                <AppIcon name="complete" size={16} />保存
              </button>
              <button type="button" className="small-button danger-text" onClick={() => void remove(category)}>
                <AppIcon name="delete" size={16} />删除
              </button>
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
  categories,
  onChanged,
  onClose
}: {
  email: string
  categories: Category[]
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const { theme } = useTheme()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [quickCategoryId, setQuickCategoryId] = useState('')
  const [preferenceBusy, setPreferenceBusy] = useState(false)
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  const [shortcutCopied, setShortcutCopied] = useState(false)
  const installMode = usePwaInstall()
  const shortcutPrefix = publicAppOrigin() + '/#quick-clipboard='

  useEffect(() => {
    void api<AppPreferences>('/api/preferences').then((preferences) => {
      setQuickCategoryId(preferences.quickSaveCategoryId || '')
    }).catch((requestError) => setError(errorMessage(requestError)))
  }, [])

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

  async function savePreference() {
    setPreferenceBusy(true)
    setError('')
    setSuccess('')
    try {
      const preferences = await jsonRequest<AppPreferences>('/api/preferences', 'PATCH', {
        quickSaveCategoryId: quickCategoryId || null
      })
      setQuickCategoryId(preferences.quickSaveCategoryId || '')
      setSuccess('快速保存的默认类别已同步')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setPreferenceBusy(false)
    }
  }

  async function copyShortcutPrefix() {
    try {
      await navigator.clipboard.writeText(shortcutPrefix)
      setShortcutCopied(true)
      window.setTimeout(() => setShortcutCopied(false), 1800)
    } catch {
      setError('浏览器没有允许复制，请手动选中接收地址复制。')
    }
  }

  return (
    <Modal title="账号设置" onClose={onClose} wide>
      <div className="account-settings stack">
        <p className="muted">当前账号：{email}</p>
        <ErrorNotice message={error} />
        {success && <div className="notice notice-success" role="status">{success}</div>}
        <AccountPanel className="quick-save-settings" label="快速保存设置">
          <div className="account-section-heading">
            <AppIcon name="bookmark" size={24} />
            <div>
              <h3>快速保存默认类别</h3>
              <p>快速书签会自动使用这个类别，并在公司与家里的设备之间同步。</p>
            </div>
          </div>
          <div className="inline-field">
            {theme === 'animal-island' ? (
              <Select
                aria-label="快速保存默认类别"
                value={quickCategoryId}
                options={[
                  { key: '', label: '未分类' },
                  ...categories.map((category) => ({ key: category.id, label: category.name }))
                ]}
                onChange={setQuickCategoryId}
              />
            ) : (
              <select aria-label="快速保存默认类别" value={quickCategoryId} onChange={(event) => setQuickCategoryId(event.target.value)}>
                <option value="">未分类</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            )}
            <Button type="primary" size="small" loading={preferenceBusy} disabled={preferenceBusy} onClick={() => void savePreference()}>
              {preferenceBusy ? '保存中…' : '保存默认类别'}
            </Button>
          </div>
        </AccountPanel>

        <AccountPanel className="home-screen-install" label="安装与 iPhone">
          <div className="account-section-heading">
            <AppIcon name="install" size={24} />
            <div>
              <h3>安装与 iPhone</h3>
              <p>安装后可以从桌面直接打开，并以独立应用窗口运行。</p>
            </div>
          </div>
          {installMode === 'installed' ? (
            <div className="notice notice-success">当前已经从主屏幕应用中打开。</div>
          ) : installMode === 'prompt' ? (
            <Button type="primary" size="small" icon={<AppIcon name="install" size={17} />} onClick={() => void requestPwaInstall()}>
              安装应用
            </Button>
          ) : installMode === 'ios-guide' ? (
            <>
              <Button size="small" icon={<AppIcon name="install" size={17} />} onClick={() => setShowInstallGuide((value) => !value)}>
                {showInstallGuide ? '收起安装步骤' : '查看安装步骤'}
              </Button>
              {showInstallGuide && (
                <ol className="install-steps">
                  <li>请在 Safari 中打开当前正式网址。</li>
                  <li>点浏览器的“分享”按钮。</li>
                  <li>选择“添加到主屏幕”，再点“添加”。</li>
                </ol>
              )}
            </>
          ) : (
            <div className="notice notice-warning">当前浏览器没有提供直接安装按钮；可在浏览器菜单中查找“安装应用”或“添加到主屏幕”。</div>
          )}
          <p className="install-note">首次从主屏幕打开时，可能需要重新登录一次。</p>
          <div className="iphone-shortcut-guide">
            <div className="account-section-heading">
              <AppIcon name="clipboard" size={24} />
              <div>
                <h3>iPhone 剪贴板快捷保存</h3>
                <p>快捷指令只读取文字和网址；点一次就会打开本站并按默认类别保存。</p>
              </div>
            </div>
            <ol className="install-steps">
              <li>在“快捷指令”App 中新建快捷指令，依次加入“获取剪贴板”和“URL 编码”。</li>
              <li>加入“文本”，先粘贴下面的接收地址，再紧接着放入上一步编码后的内容。</li>
              <li>最后加入“打开 URL”，命名为“稍后保存剪贴板”，可放到主屏幕。</li>
            </ol>
            <div className="shortcut-prefix-box">
              <code>{shortcutPrefix}</code>
              <Button size="small" onClick={() => void copyShortcutPrefix()}>{shortcutCopied ? '已复制' : '复制接收地址'}</Button>
            </div>
            <p className="muted">内容放在网址片段中，不会出现在 Vercel 的访问地址记录里；登录后网站会立即清除片段。</p>
          </div>
        </AccountPanel>

        <AccountPanel className="offline-settings" label="离线与缓存">
          <OfflineStatusContent onChanged={onChanged} />
        </AccountPanel>

        <BackupManager onRestored={onChanged} />

        <form className="account-section password-form stack" aria-label="账号安全" onSubmit={submit}>
          <div className="account-section-heading">
            <AppIcon name="account" size={24} />
            <div><h3>账号安全</h3><p>修改登录密码；新密码至少 10 个字符。</p></div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>当前密码</span>
              <input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </label>
            <label className="field">
              <span>新密码</span>
              <input type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>再次输入新密码</span>
            <input type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </label>
          <div className="form-actions">
            <button className="button button-primary" disabled={busy}>{busy ? '更新中…' : '修改密码'}</button>
          </div>
        </form>
        <div className="form-actions"><button type="button" className="button" onClick={onClose}>关闭</button></div>
      </div>
    </Modal>
  )
}

export function BookmarkletHelp({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState<'quick' | 'detail' | ''>('')
  const quickBookmarkRef = useRef<HTMLAnchorElement>(null)
  const detailBookmarkRef = useRef<HTMLAnchorElement>(null)
  const origin = publicAppOrigin()
  const detailCode =
    'javascript:(()=>{const u=' +
    JSON.stringify(origin + '/?add=link&url=') +
    "+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);const w=window.open(u,'_blank');if(w){try{w.opener=null}catch(e){}}else{alert('浏览器阻止了新标签页，请允许弹出窗口后重试。')}})()"
  const quickCode =
    'javascript:(()=>{const u=' +
    JSON.stringify(origin + '/?capture=quick&url=') +
    "+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);const x=Math.max(0,(screen.width-480)/2),y=Math.max(0,(screen.height-620)/2);const w=window.open(u,'doitlaterQuick','popup=yes,width=480,height=620,left='+x+',top='+y+',resizable=yes,scrollbars=yes');if(w){try{w.opener=null;w.focus()}catch(e){}}else{alert('浏览器阻止了快速保存窗口，请允许弹出窗口后重试。')}})()"

  useEffect(() => {
    quickBookmarkRef.current?.setAttribute('href', quickCode)
    detailBookmarkRef.current?.setAttribute('href', detailCode)
  }, [detailCode, quickCode])

  async function copy(kind: 'quick' | 'detail') {
    try {
      await navigator.clipboard.writeText(kind === 'quick' ? quickCode : detailCode)
      setCopied(kind)
    } catch {
      setCopied('')
    }
  }

  return (
    <Modal title="浏览器书签按钮" onClose={onClose}>
      <div className="stack">
        <p>把需要的按钮拖到浏览器书签栏。两种方式都会保留原网页的地址和阅读位置。</p>
        <div className="notice notice-warning bookmarklet-upgrade">
          如果你已经安装过旧版“稍后保存”，请先删除旧书签，再重新拖入下面的新版本。
        </div>
        <div className="bookmarklet-options">
          <section className="bookmarklet-option">
            <div>
              <strong>快速保存</strong>
              <p>打开小窗口，按网页标题和账号默认类别自动保存，完成后自动关闭。</p>
            </div>
            <div className="bookmarklet-box">
              <a
                ref={quickBookmarkRef}
                className="button button-primary"
                draggable
                onClick={(event) => event.preventDefault()}
              >
                <AppIcon name="bookmark" size={19} />
                快速保存
              </a>
              <button type="button" className="button button-small" onClick={() => void copy('quick')}>
                {copied === 'quick' ? '已复制' : '复制代码'}
              </button>
            </div>
          </section>
          <section className="bookmarklet-option">
            <div>
              <strong>保存并分类</strong>
              <p>在新标签页打开完整添加窗口，可调整标题、类别和截图。</p>
            </div>
            <div className="bookmarklet-box">
              <a
                ref={detailBookmarkRef}
                className="button"
                draggable
                onClick={(event) => event.preventDefault()}
              >
                <AppIcon name="categories" size={19} />
                保存并分类
              </a>
              <button type="button" className="button button-small" onClick={() => void copy('detail')}>
                {copied === 'detail' ? '已复制' : '复制代码'}
              </button>
            </div>
          </section>
        </div>
        <p className="muted">书签不能在浏览器的新标签页、设置页等内部页面运行。若窗口没有出现，请允许弹出窗口；拖动无效时可复制代码，新建书签，并确认书签地址以 javascript: 开头。</p>
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
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const gesture = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0, active: false })
  const asset = assets[index]

  function changeIndex(direction: -1 | 1) {
    setIndex((value) => (value + direction + assets.length) % assets.length)
  }

  function setZoom(next: number) {
    const value = Math.max(1, Math.min(4, next))
    setScale(value)
    if (value === 1) setOffset({ x: 0, y: 0 })
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y, active: true }
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!gesture.current.active || scale <= 1) return
    setOffset({
      x: gesture.current.offsetX + event.clientX - gesture.current.x,
      y: gesture.current.offsetY + event.clientY - gesture.current.y
    })
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!gesture.current.active) return
    const distance = event.clientX - gesture.current.x
    gesture.current.active = false
    if (scale === 1 && Math.abs(distance) > 55 && assets.length > 1) changeIndex(distance > 0 ? -1 : 1)
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') changeIndex(-1)
      if (event.key === 'ArrowRight') changeIndex(1)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [assets.length])

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [index])

  if (!asset) return null
  return (
    <Modal title={asset.originalName || '查看图片'} onClose={onClose} wide>
      <div className="lightbox">
        <div
          className={`lightbox-stage${scale > 1 ? ' is-zoomed' : ''}`}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onDoubleClick={() => setZoom(scale > 1 ? 1 : 2)}
          onWheel={(event) => {
            if (!event.ctrlKey && Math.abs(event.deltaY) < 2) return
            event.preventDefault()
            setZoom(scale + (event.deltaY < 0 ? 0.25 : -0.25))
          }}
        >
          <img
            src={asset.originalUrl}
            alt={asset.originalName}
            draggable={false}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        </div>
        <div className="lightbox-tools" aria-label="图片工具">
          <button type="button" className="button button-small" disabled={scale <= 1} onClick={() => setZoom(scale - 0.5)}><AppIcon name="zoomOut" size={17} />缩小</button>
          <span>{Math.round(scale * 100)}%</span>
          <button type="button" className="button button-small" disabled={scale >= 4} onClick={() => setZoom(scale + 0.5)}><AppIcon name="zoomIn" size={17} />放大</button>
          <button type="button" className="button button-small" disabled={scale === 1} onClick={() => setZoom(1)}>还原</button>
          <a className="button button-small" href={asset.originalUrl} target="_blank" rel="noreferrer"><AppIcon name="open" size={17} />打开原图</a>
          <a className="button button-small" href={asset.originalUrl} download={asset.originalName}><AppIcon name="download" size={17} />保存原图</a>
        </div>
        <div className="lightbox-controls">
          <button
            type="button"
            className="button"
            disabled={assets.length <= 1}
            onClick={() => changeIndex(-1)}
          >
            <AppIcon name="previous" size={18} />
            上一张
          </button>
          <span>{index + 1} / {assets.length}</span>
          <button
            type="button"
            className="button"
            disabled={assets.length <= 1}
            onClick={() => changeIndex(1)}
          >
            下一张
            <AppIcon name="next" size={18} />
          </button>
        </div>
      </div>
    </Modal>
  )
}
