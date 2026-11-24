import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { api, errorMessage, jsonRequest } from '../api'
import { requestPwaInstall, usePwaInstall } from '../pwa'
import type { AppPreferences, Category, ImageAsset } from '../types'
import { AppIcon } from './AppIcon'
import { BackupManager } from './BackupManager'
import { Modal } from './Modal'
import { OfflineStatusContent } from './OfflineManager'
import { showToast } from './Toast'

function publicAppOrigin() {
  const configuredUrl = (import.meta.env.VITE_PUBLIC_APP_URL || '').trim()
  if (!configuredUrl) return window.location.origin
  try {
    return new URL(configuredUrl).origin
  } catch {
    return window.location.origin
  }
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
  const [newColor, setNewColor] = useState('#4d49fc')
  const [newCoverPrompt, setNewCoverPrompt] = useState('')
  const [savingId, setSavingId] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setRows(categories), [categories])

  async function save(category: Category) {
    if (!category.name.trim()) return
    setSavingId(category.id)
    setError('')
    try {
      await jsonRequest('/api/categories/' + category.id, 'PUT', {
        name: category.name.trim(),
        color: category.color,
        coverPrompt: (category.coverPrompt || '').trim()
      })
      await onChanged()
      showToast('success', `已保存类别「${category.name.trim()}」`)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSavingId('')
    }
  }

  async function remove(category: Category) {
    if (!window.confirm('删除“' + category.name + '”后，相关条目会变成未分类。确定继续吗？')) return
    setError('')
    try {
      await api('/api/categories/' + category.id, { method: 'DELETE' })
      await onChanged()
      showToast('info', `已删除类别「${category.name}」`)
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!newName.trim() || adding) return
    setAdding(true)
    setError('')
    try {
      const name = newName.trim()
      await jsonRequest('/api/categories', 'POST', {
        name,
        color: newColor,
        coverPrompt: newCoverPrompt.trim()
      })
      setNewName('')
      setNewCoverPrompt('')
      await onChanged()
      showToast('success', `已新增类别「${name}」`)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Modal title="类别管理" onClose={onClose}>
      <div className="stack">
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {rows.length === 0 ? (
          <p className="field-hint">还没有自定义类别，在下方添加一个开始整理吧。</p>
        ) : (
          <ul className="category-editor">
            {rows.map((category, index) => (
              <li key={category.id} className="category-editor-row">
                <div className="category-editor-main">
                  <span className="cat-dot" style={{ backgroundColor: category.color }} aria-hidden="true" />
                  <input
                    type="color"
                    className="category-color-input"
                    aria-label={category.name + '的颜色'}
                    value={category.color}
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...category, color: event.target.value }
                      setRows(next)
                    }}
                  />
                  <input
                    className="input"
                    aria-label="类别名称"
                    maxLength={40}
                    value={category.name}
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...category, name: event.target.value }
                      setRows(next)
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={savingId === category.id || !category.name.trim()}
                    onClick={() => void save(category)}
                  >
                    <AppIcon name="check" size={14} />
                    {savingId === category.id ? '保存中…' : '保存'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => void remove(category)}
                  >
                    <AppIcon name="trash" size={14} />
                    删除
                  </button>
                </div>
                <div className="category-editor-prompt">
                  <AppIcon name="sparkles" size={14} />
                  <input
                    className="input category-prompt-input"
                    aria-label={category.name + '的封面提示词'}
                    maxLength={600}
                    placeholder="封面提示词（可选），如：运动活力海报风、胶片摄影质感…"
                    value={category.coverPrompt || ''}
                    onChange={(event) => {
                      const next = [...rows]
                      next[index] = { ...category, coverPrompt: event.target.value }
                      setRows(next)
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <form className="category-add" onSubmit={add}>
          <div className="category-add-main">
            <input
              type="color"
              className="category-color-input"
              aria-label="新类别颜色"
              value={newColor}
              onChange={(event) => setNewColor(event.target.value)}
            />
            <input
              className="input"
              required
              maxLength={40}
              placeholder="输入新类别名称"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={adding || !newName.trim()}>
              <AppIcon name="plus" size={15} />
              {adding ? '添加中…' : '添加类别'}
            </button>
          </div>
          <div className="category-editor-prompt">
            <AppIcon name="sparkles" size={14} />
            <input
              className="input category-prompt-input"
              aria-label="新类别封面提示词"
              maxLength={600}
              placeholder="封面提示词（可选），如：运动活力海报风、胶片摄影质感…"
              value={newCoverPrompt}
              onChange={(event) => setNewCoverPrompt(event.target.value)}
            />
          </div>
        </form>
      </div>
    </Modal>
  )
}

export function AccountManager({
  email,
  categories,
  onChanged,
  onClose,
  onPreferencesChange
}: {
  email: string
  categories: Category[]
  onChanged: () => Promise<void>
  onClose: () => void
  onPreferencesChange?: (prefs: AppPreferences) => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [quickCategoryId, setQuickCategoryId] = useState('')
  const [preferenceBusy, setPreferenceBusy] = useState(false)
  const [aiImageApiUrl, setAiImageApiUrl] = useState('')
  const [aiImageApiKey, setAiImageApiKey] = useState('')
  const [aiImageApiKeySet, setAiImageApiKeySet] = useState(false)
  const [aiImageApiKeyHint, setAiImageApiKeyHint] = useState('')
  const [aiImageModel, setAiImageModel] = useState('')
  const [aiCoverAuto, setAiCoverAuto] = useState(false)
  const [aiCoverStyle, setAiCoverStyle] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  const [shortcutCopied, setShortcutCopied] = useState(false)
  const installMode = usePwaInstall()
  const shortcutPrefix = publicAppOrigin() + '/#quick-clipboard='

  function applyPreferences(preferences: AppPreferences) {
    setQuickCategoryId(preferences.quickSaveCategoryId || '')
    setAiImageApiUrl(preferences.aiImageApiUrl || '')
    setAiImageApiKeySet(Boolean(preferences.aiImageApiKeySet))
    setAiImageApiKeyHint(preferences.aiImageApiKeyHint || '')
    setAiImageModel(preferences.aiImageModel || '')
    setAiCoverAuto(Boolean(preferences.aiCoverAuto))
    setAiCoverStyle(preferences.aiCoverStyle || '')
  }

  useEffect(() => {
    void api<AppPreferences>('/api/preferences').then((preferences) => {
      applyPreferences(preferences)
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
      showToast('success', '登录密码已更新')
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
      applyPreferences(preferences)
      onPreferencesChange?.(preferences)
      setSuccess('快速保存的默认类别已同步')
      showToast('success', '默认快速保存类别已更新')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setPreferenceBusy(false)
    }
  }

  async function saveAiCoverSettings(event: FormEvent) {
    event.preventDefault()
    setAiBusy(true)
    setError('')
    setSuccess('')
    try {
      const payload: Record<string, unknown> = {
        aiImageApiUrl: aiImageApiUrl.trim(),
        aiImageModel: aiImageModel.trim(),
        aiCoverAuto,
        aiCoverStyle: aiCoverStyle.trim()
      }
      if (aiImageApiKey.trim()) {
        payload.aiImageApiKey = aiImageApiKey.trim()
      }
      const updated = await jsonRequest<AppPreferences>('/api/preferences', 'PATCH', payload)
      applyPreferences(updated)
      setAiImageApiKey('')
      onPreferencesChange?.(updated)
      setSuccess('AI 封面生图设置已保存')
      showToast('success', 'AI 封面生图设置已保存')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setAiBusy(false)
    }
  }

  async function clearAiApiKey() {
    if (!window.confirm('确定清除已保存的生图 API Key 吗？')) return
    setAiBusy(true)
    setError('')
    setSuccess('')
    try {
      const updated = await jsonRequest<AppPreferences>('/api/preferences', 'PATCH', {
        clearAiImageApiKey: true
      })
      applyPreferences(updated)
      setAiImageApiKey('')
      onPreferencesChange?.(updated)
      setSuccess('生图 API Key 已清除')
      showToast('info', '生图 API Key 已清除')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setAiBusy(false)
    }
  }

  async function copyShortcutPrefix() {
    try {
      await navigator.clipboard.writeText(shortcutPrefix)
      setShortcutCopied(true)
      showToast('success', '已复制快捷指令接收地址')
      window.setTimeout(() => setShortcutCopied(false), 1800)
    } catch {
      setError('浏览器没有允许复制，请手动选中接收地址复制。')
    }
  }

  return (
    <Modal title="账号设置" onClose={onClose} wide>
      <div className="account-settings stack">
        <div className="account-identity">
          <AppIcon name="user" size={16} />
          <span className="field-hint">当前账号</span>
          <strong className="mono">{email}</strong>
        </div>

        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {success && <div className="notice notice-success" role="status">{success}</div>}

        <section className="fig-card account-section quick-save-settings" aria-label="快速保存设置">
          <div className="account-section-heading">
            <AppIcon name="bookmark" size={20} />
            <div>
              <h3>快速保存默认类别</h3>
              <p className="field-hint">快速书签与快捷指令会自动使用这个类别，并在不同设备间同步。</p>
            </div>
          </div>
          <div className="inline-field">
            <select
              className="select"
              aria-label="快速保存默认类别"
              value={quickCategoryId}
              onChange={(event) => setQuickCategoryId(event.target.value)}
            >
              <option value="">未分类</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={preferenceBusy}
              onClick={() => void savePreference()}
            >
              {preferenceBusy ? '保存中…' : '保存默认类别'}
            </button>
          </div>
        </section>

        <form className="fig-card account-section ai-cover-settings stack" aria-label="AI 封面生成（生图 API）" onSubmit={saveAiCoverSettings}>
          <div className="account-section-heading ai-cover-settings-heading">
            <AppIcon name="sparkles" size={20} />
            <div className="ai-cover-settings-title">
              <div className="ai-cover-settings-title-row">
                <h3>AI 封面生成（生图 API）</h3>
                <span className={aiImageApiKeySet ? 'badge badge-indigo' : 'badge badge-muted'}>
                  {aiImageApiKeySet ? '已配置' : '未配置'}
                </span>
              </div>
              <p className="field-hint">
                连接 OpenAI 兼容生图接口（/images/generations），为无封面的网页或文本条目生成海报封面。
              </p>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span className="field-label">生图 API 地址</span>
              <input
                className="input"
                type="url"
                maxLength={500}
                placeholder="https://api.openai.com/v1"
                value={aiImageApiUrl}
                onChange={(event) => setAiImageApiUrl(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">模型名称</span>
              <input
                className="input"
                maxLength={120}
                placeholder="gpt-image-1"
                value={aiImageModel}
                onChange={(event) => setAiImageModel(event.target.value)}
              />
            </label>
          </div>

          <div className="field">
            <span className="field-label">API Key</span>
            <div className="inline-field">
              <input
                className="input"
                type="password"
                autoComplete="off"
                maxLength={500}
                aria-label="生图 API Key"
                placeholder={
                  aiImageApiKeySet
                    ? (aiImageApiKeyHint ? `已保存 ${aiImageApiKeyHint}（留空保持不变）` : '已保存（留空保持不变）')
                    : 'sk-...'
                }
                value={aiImageApiKey}
                onChange={(event) => setAiImageApiKey(event.target.value)}
              />
              {aiImageApiKeySet && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={aiBusy}
                  onClick={() => void clearAiApiKey()}
                >
                  清除
                </button>
              )}
            </div>
            {aiImageApiKeySet && (
              <span className="field-hint mono ai-cover-key-hint">
                当前密钥：{aiImageApiKeyHint || '已保存'} · 仅保存在服务端用于生图
              </span>
            )}
          </div>

          <label className="checkbox-row ai-cover-auto-toggle">
            <input
              type="checkbox"
              checked={aiCoverAuto}
              onChange={(event) => setAiCoverAuto(event.target.checked)}
            />
            <span>新建条目无封面时自动生成设计海报封面</span>
          </label>

          <label className="field">
            <span className="field-label">全局画面风格提示词（可选）</span>
            <textarea
              className="textarea"
              rows={3}
              maxLength={1000}
              placeholder="留空则使用默认 Figma 极简编辑海报风（Swiss editorial graphic design poster, clean geometric shapes, crisp studio lighting, gallery minimalism, no cluttered text）"
              value={aiCoverStyle}
              onChange={(event) => setAiCoverStyle(event.target.value)}
            />
            <span className="field-hint">
              提示：还可以在「类别管理」中为每个类别单独设置专属封面提示词，生图时会自动与全局风格融合。
            </span>
          </label>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={aiBusy}>
              <AppIcon name="sparkles" size={14} />
              {aiBusy ? '保存中…' : '保存生图设置'}
            </button>
          </div>
        </form>

        <section className="fig-card account-section home-screen-install" aria-label="安装与 iPhone 快捷指令">
          <div className="account-section-heading">
            <AppIcon name="download" size={20} />
            <div>
              <h3>安装到主屏幕 &amp; iPhone 快捷指令</h3>
              <p className="field-hint">安装后可从桌面或手机主屏幕以独立应用窗口直接打开。</p>
            </div>
          </div>

          <div className="account-subblock">
            {installMode === 'installed' ? (
              <div className="notice notice-success">当前已经从主屏幕应用中打开。</div>
            ) : installMode === 'prompt' ? (
              <div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void requestPwaInstall()}>
                  <AppIcon name="download" size={15} />
                  安装应用
                </button>
              </div>
            ) : installMode === 'ios-guide' ? (
              <>
                <div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowInstallGuide((value) => !value)}
                  >
                    {showInstallGuide ? '收起安装步骤' : '查看 Safari 安装步骤'}
                  </button>
                </div>
                {showInstallGuide && (
                  <ol className="install-steps">
                    <li>在 Safari 中打开当前正式网址。</li>
                    <li>点底部或顶部的“分享”按钮。</li>
                    <li>选择“添加到主屏幕”，再点“添加”。</li>
                  </ol>
                )}
              </>
            ) : (
              <div className="notice notice-info">
                当前浏览器未提供一键安装提示，可在浏览器菜单中选择“安装应用”或“添加到主屏幕”。
              </div>
            )}
            <p className="field-hint">首次从主屏幕打开时，可能需要重新登录一次。</p>
          </div>

          <div className="iphone-shortcut-guide">
            <div className="account-section-heading">
              <AppIcon name="copy" size={18} />
              <div>
                <h4>iPhone 剪贴板快捷保存</h4>
                <p className="field-hint">快捷指令读取文字或网址，点一次就会打开本站并按默认类别保存。</p>
              </div>
            </div>
            <ol className="install-steps">
              <li>在“快捷指令”App 中新建快捷指令，依次加入“获取剪贴板”和“URL 编码”。</li>
              <li>加入“文本”，先粘贴下面的接收地址，再紧接着放入上一步编码后的内容。</li>
              <li>最后加入“打开 URL”，命名为“稍后保存剪贴板”，可添加到主屏幕。</li>
            </ol>
            <div className="shortcut-prefix-box">
              <code className="mono">{shortcutPrefix}</code>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyShortcutPrefix()}>
                <AppIcon name={shortcutCopied ? 'check' : 'copy'} size={14} />
                {shortcutCopied ? '已复制' : '复制地址'}
              </button>
            </div>
            <p className="field-hint">剪贴板内容位于 URL 片段（# 后），不会发送至服务端访问日志，保存后立即清除。</p>
          </div>
        </section>

        <section className="fig-card account-section offline-settings" aria-label="离线与缓存">
          <OfflineStatusContent onChanged={onChanged} />
        </section>

        <BackupManager onRestored={onChanged} />

        <form className="fig-card account-section password-form stack" aria-label="账号安全" onSubmit={submit}>
          <div className="account-section-heading">
            <AppIcon name="settings" size={20} />
            <div>
              <h3>修改登录密码</h3>
              <p className="field-hint">新密码至少 10 个字符，更新后立即生效。</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">当前密码</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">新密码</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">再次输入新密码</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? '更新中…' : '修改密码'}
            </button>
          </div>
        </form>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
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
      showToast('success', '已复制书签代码')
      window.setTimeout(() => setCopied(''), 1800)
    } catch {
      setCopied('')
    }
  }

  return (
    <Modal title="浏览器书签按钮" onClose={onClose}>
      <div className="stack">
        <p className="field-hint">把需要的按钮拖到浏览器书签栏。两种方式都会保留原网页地址和当前阅读位置。</p>
        <div className="notice notice-info bookmarklet-upgrade">
          如果你此前安装过旧版“稍后保存”，请先删除旧书签，再拖入下方的新版本。
        </div>
        <div className="bookmarklet-options">
          <section className="fig-card bookmarklet-option">
            <div>
              <strong>快速保存</strong>
              <p className="field-hint">弹出小窗口，按网页标题与账号默认类别自动保存，完成后自动关闭。</p>
            </div>
            <div className="bookmarklet-box">
              <a
                ref={quickBookmarkRef}
                className="btn btn-primary"
                draggable
                onClick={(event) => event.preventDefault()}
              >
                <AppIcon name="bookmark" size={16} />
                快速保存
              </a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy('quick')}>
                <AppIcon name={copied === 'quick' ? 'check' : 'copy'} size={14} />
                {copied === 'quick' ? '已复制' : '复制代码'}
              </button>
            </div>
          </section>
          <section className="fig-card bookmarklet-option">
            <div>
              <strong>保存并分类</strong>
              <p className="field-hint">在新标签页打开完整添加窗口，可自由调整标题、类别和截图。</p>
            </div>
            <div className="bookmarklet-box">
              <a
                ref={detailBookmarkRef}
                className="btn btn-ghost"
                draggable
                onClick={(event) => event.preventDefault()}
              >
                <AppIcon name="folder" size={16} />
                保存并分类
              </a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy('detail')}>
                <AppIcon name={copied === 'detail' ? 'check' : 'copy'} size={14} />
                {copied === 'detail' ? '已复制' : '复制代码'}
              </button>
            </div>
          </section>
        </div>
        <p className="field-hint">
          书签无法在浏览器新标签页、设置页等内部页面运行。若窗口未出现请允许弹出窗口；无法拖动时可复制代码手动新建书签，确保地址以 javascript: 开头。
        </p>
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
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            disabled={scale <= 1}
            onClick={() => setZoom(scale - 0.5)}
          >
            − 缩小
          </button>
          <span className="lightbox-zoom-value mono">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            disabled={scale >= 4}
            onClick={() => setZoom(scale + 0.5)}
          >
            + 放大
          </button>
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            disabled={scale === 1}
            onClick={() => setZoom(1)}
          >
            还原
          </button>
          <a className="btn btn-ghost btn-sm" href={asset.originalUrl} target="_blank" rel="noreferrer">
            <AppIcon name="external" size={14} />
            打开原图
          </a>
          <a className="btn btn-ghost btn-sm" href={asset.originalUrl} download={asset.originalName}>
            <AppIcon name="download" size={14} />
            保存原图
          </a>
        </div>
        <div className="lightbox-controls">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={assets.length <= 1}
            onClick={() => changeIndex(-1)}
          >
            ← 上一张
          </button>
          <span className="lightbox-counter mono">{index + 1} / {assets.length}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={assets.length <= 1}
            onClick={() => changeIndex(1)}
          >
            下一张 →
          </button>
        </div>
      </div>
    </Modal>
  )
}
