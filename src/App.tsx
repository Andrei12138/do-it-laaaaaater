import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, Card, Footer, Input } from 'animal-island-ui'
import islandBag from 'animal-island-ui/items/item-022.png'
import { api, errorMessage, jsonRequest, readCachedAuthStatus } from './api'
import { Dashboard } from './components/Dashboard'
import { QuickCapture } from './components/QuickCapture'
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
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mode === 'setup' && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError('')
    try {
      await jsonRequest(
        mode === 'setup' ? '/api/auth/setup' : '/api/auth/login',
        'POST',
        { email, password }
      )
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
              <h1>Do It Laaaaaater</h1>
              <p>{mode === 'setup' ? '创建你的唯一账号' : themeDefinition.authLoginDescription}</p>
            </div>
          </div>
          <form onSubmit={submit} className="stack">
            {error && <div className="notice notice-error" role="alert">{error}</div>}
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
          </form>
        </Card>
      </main>
      {theme === 'animal-island' && <Footer type="sea" seamless className="auth-footer" />}
    </div>
  )
}

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(() => readCachedAuthStatus())
  const [error, setError] = useState('')

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
  if (status.setupRequired) return <AuthScreen mode="setup" onComplete={refreshStatus} />
  if (!status.authenticated) return <AuthScreen mode="login" onComplete={refreshStatus} />
  if (new URLSearchParams(window.location.search).get('capture') === 'quick') return <QuickCapture />
  return (
    <Dashboard
      userEmail={status.user?.email || ''}
      onSessionChange={refreshStatus}
    />
  )
}
