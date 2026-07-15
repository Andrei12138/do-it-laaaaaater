import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, Card, Footer, Input } from 'animal-island-ui'
import islandBag from 'animal-island-ui/items/item-022.png'
import { api, errorMessage, isCloudMode, jsonRequest } from './api'
import { subscribeCloudAuth } from './cloud/supabase'
import { Dashboard } from './components/Dashboard'
import { ThemeControl } from './components/ThemeControl'
import { getThemeDefinition, useTheme } from './theme'
import type { AuthStatus } from './types'

function AuthScreen({
  mode,
  onComplete
}: {
  mode: 'setup' | 'login'
  onComplete: () => Promise<void>
}) {
  const { theme } = useTheme()
  const themeDefinition = getThemeDefinition(theme)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mode === 'setup' && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const result = await jsonRequest<{ confirmationRequired?: boolean }>(
        mode === 'setup' ? '/api/auth/setup' : '/api/auth/login',
        'POST',
        { email, password }
      )
      if (result?.confirmationRequired) {
        setSuccess('账号已创建，请打开邮箱中的确认邮件，然后回到这里登录。')
        return
      }
      await onComplete()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  async function requestReset() {
    if (!email.trim()) {
      setError('请先填写账号邮箱')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await jsonRequest('/api/auth/request-reset', 'POST', { email })
      setSuccess('重置邮件已发送，请打开邮件中的链接。')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-theme-control"><ThemeControl placement="auth" /></div>
      <main className="auth-page">
        <Card className="auth-card" color="default" pattern="default">
          <div className="auth-brand">
            {theme === 'animal-island' && <img src={islandBag} alt="" className="auth-mascot" />}
            <div>
              <span className="brand-kicker">{themeDefinition.authKicker}</span>
              <h1>Do It Laaaaaater</h1>
              <p>{mode === 'setup' ? '创建你的唯一账号' : themeDefinition.authLoginDescription}</p>
            </div>
          </div>
          <form onSubmit={submit} className="stack">
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            {success && <div className="notice notice-success" role="status">{success}</div>}
            <label className="field">
              <span>邮箱</span>
              <Input
                type="email"
                size="large"
                shadow
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoFocus
              />
            </label>
            <label className="field">
              <span>密码</span>
              <Input
                type="password"
                size="large"
                shadow
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                minLength={10}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {mode === 'setup' && <small>至少 10 个字符</small>}
            </label>
            {mode === 'setup' && (
              <label className="field">
                <span>再次输入密码</span>
                <Input
                  type="password"
                  size="large"
                  shadow
                  autoComplete="new-password"
                  minLength={10}
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </label>
            )}
            <Button type="primary" size="large" block htmlType="submit" loading={busy} disabled={busy}>
              {busy ? '正在处理…' : mode === 'setup' ? '创建账号并开始使用' : '登录'}
            </Button>
            {mode === 'login' && isCloudMode && (
              <button type="button" className="text-button auth-reset-button" disabled={busy} onClick={() => void requestReset()}>
                忘记密码
              </button>
            )}
          </form>
        </Card>
      </main>
      {theme === 'animal-island' && <Footer type="sea" seamless className="auth-footer" />}
    </div>
  )
}

function RecoveryScreen({ onComplete }: { onComplete: () => Promise<void> }) {
  const { theme } = useTheme()
  const themeDefinition = getThemeDefinition(theme)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError('')
    try {
      await jsonRequest('/api/auth/complete-reset', 'POST', { password })
      await onComplete()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-theme-control"><ThemeControl placement="auth" /></div>
      <main className="auth-page">
        <Card className="auth-card" color="default" pattern="default">
          <div className="auth-brand">
            {theme === 'animal-island' && <img src={islandBag} alt="" className="auth-mascot" />}
            <div>
              <span className="brand-kicker">{themeDefinition.authKicker}</span>
              <h1>设置新密码</h1>
              <p>{themeDefinition.authRecoveryDescription}</p>
            </div>
          </div>
          <form onSubmit={submit} className="stack">
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            <label className="field">
              <span>新密码</span>
              <Input type="password" size="large" shadow minLength={10} required value={password}
                onChange={(event) => setPassword(event.target.value)} autoFocus />
              <small>至少 10 个字符</small>
            </label>
            <label className="field">
              <span>再次输入新密码</span>
              <Input type="password" size="large" shadow minLength={10} required value={confirm}
                onChange={(event) => setConfirm(event.target.value)} />
            </label>
            <Button type="primary" size="large" block htmlType="submit" loading={busy} disabled={busy}>
              {busy ? '正在保存…' : '保存新密码'}
            </Button>
          </form>
        </Card>
      </main>
      {theme === 'animal-island' && <Footer type="sea" seamless className="auth-footer" />}
    </div>
  )
}

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState('')
  const [recovering, setRecovering] = useState(() => isCloudMode && window.location.hash.includes('type=recovery'))

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<AuthStatus>('/api/auth/status'))
      setError('')
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => subscribeCloudAuth((event) => {
    if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    window.setTimeout(() => void refreshStatus(), 0)
  }), [refreshStatus])

  if (error && !status) {
    return (
      <main className="center-page">
        <Card className="empty-state" type="dashed" pattern="default">
          <h1>无法连接服务</h1>
          <p>{error}</p>
          <Button type="primary" onClick={() => void refreshStatus()}>重试</Button>
        </Card>
      </main>
    )
  }
  if (!status) return <main className="center-page"><div className="spinner" aria-label="加载中" /></main>
  if (recovering && status.authenticated) return (
    <RecoveryScreen onComplete={async () => {
      setRecovering(false)
      window.history.replaceState(null, '', window.location.pathname)
      await refreshStatus()
    }} />
  )
  if (status.setupRequired) return <AuthScreen mode="setup" onComplete={refreshStatus} />
  if (!status.authenticated) return <AuthScreen mode="login" onComplete={refreshStatus} />
  return (
    <Dashboard
      userEmail={status.user?.email || ''}
      onSessionChange={refreshStatus}
    />
  )
}
