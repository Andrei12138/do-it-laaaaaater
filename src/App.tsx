import { Suspense, lazy, useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage, jsonRequest, readCachedAuthStatus } from './api'
import { BrandMark } from './components/AppIcon'
import { Dashboard } from './components/Dashboard'
import { QuickCapture } from './components/QuickCapture'
import type { AuthStatus } from './types'

const BlogApp = lazy(() =>
  import('./components/blog/BlogApp').then((module) => ({ default: module.BlogApp }))
)

function isAppPath(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/') || pathname === '/login'
}

function AuthScreen({
  mode,
  onComplete,
  onOpenBlog
}: {
  mode: 'setup' | 'login'
  onComplete: () => Promise<void>
  onOpenBlog?: () => void
}) {
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
    <main className="auth-page">
      <section className="auth-card" aria-label={mode === 'setup' ? '创建账号' : '登录'}>
        <header className="auth-brand">
          <div className="auth-brand-mark">
            <BrandMark size={28} />
            <span className="auth-kicker">LATER WORKSPACE</span>
          </div>
          <h1 className="auth-title">Do It Laaaaaater</h1>
          <p className="auth-subtitle">
            {mode === 'setup'
              ? '创建你的唯一账号，开始收集稍后再看的链接、笔记与图片。'
              : '登录你的私人稍后阅读与灵感空间。'}
          </p>
        </header>

        <form onSubmit={submit} className="auth-form">
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}

          <label className="field">
            <span className="field-label">邮箱</span>
            <input
              type="email"
              className="input auth-input"
              autoComplete="email"
              placeholder="name@example.com"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field-label">密码</span>
            <input
              type="password"
              className="input auth-input"
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'setup' ? '至少 10 个字符' : '输入密码'}
              minLength={10}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === 'setup' && <small className="field-hint">至少 10 个字符</small>}
          </label>

          {mode === 'setup' && (
            <label className="field">
              <span className="field-label">再次输入密码</span>
              <input
                type="password"
                className="input auth-input"
                autoComplete="new-password"
                placeholder="再次确认密码"
                minLength={10}
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </label>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block auth-submit"
            disabled={busy}
          >
            {busy ? '正在处理…' : mode === 'setup' ? '创建账号并开始使用' : '登录'}
          </button>
        </form>

        {mode === 'login' && onOpenBlog && (
          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid var(--border-subtle)',
              textAlign: 'center'
            }}
          >
            <button
              type="button"
              className="btn btn-text btn-sm"
              onClick={onOpenBlog}
            >
              返回博客首页 →
            </button>
          </div>
        )}
      </section>
    </main>
  )
}

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(() => readCachedAuthStatus())
  const [error, setError] = useState('')
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [postLoginRedirect, setPostLoginRedirect] = useState<string | null>(null)
  const [initialDashboardTab, setInitialDashboardTab] = useState<'list' | 'plan' | 'memo' | undefined>(
    undefined
  )
  const [pendingBlogImportItemId, setPendingBlogImportItemId] = useState<string | null>(null)

  const navigate = useCallback((nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath)
    }
    setPathname(nextPath)
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

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

  const handleAuthComplete = useCallback(async () => {
    await refreshStatus()
    if (postLoginRedirect) {
      const target = postLoginRedirect
      setPostLoginRedirect(null)
      navigate(target)
    }
  }, [refreshStatus, postLoginRedirect, navigate])

  const handleConsumePendingImport = useCallback(() => {
    setPendingBlogImportItemId(null)
  }, [])

  const handleConsumeInitialTab = useCallback(() => {
    setInitialDashboardTab(undefined)
  }, [])

  const isQuickCapture = new URLSearchParams(window.location.search).get('capture') === 'quick'

  if (!isAppPath(pathname) && !isQuickCapture && !status?.setupRequired) {
    return (
      <Suspense
        fallback={
          <main className="center-page">
            <div className="spinner" aria-label="加载中" />
          </main>
        }
      >
        <BlogApp
          path={pathname}
          embedded={Boolean(status?.authenticated)}
          pendingImportItemId={pendingBlogImportItemId}
          onConsumePendingImport={handleConsumePendingImport}
          onNavigate={navigate}
          onRequestLogin={() => {
            const clean = pathname.replace(/\/+$/, '') || '/'
            setPostLoginRedirect(clean === '/' || clean === '/blog' ? '/app' : pathname)
            navigate('/app')
          }}
          onBackToWorkspace={() => navigate('/app')}
          onSwitchWorkspaceTab={(tab) => {
            setInitialDashboardTab(tab)
            navigate('/app')
          }}
        />
      </Suspense>
    )
  }

  if (error && !status) {
    return (
      <main className="center-page">
        <section className="auth-card auth-error-card" role="alert">
          <div className="auth-brand-mark">
            <BrandMark size={24} />
            <span className="auth-kicker">CONNECTION</span>
          </div>
          <h1 className="auth-title">无法连接服务</h1>
          <p className="auth-subtitle">{error}</p>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => void refreshStatus()}
          >
            重试
          </button>
        </section>
      </main>
    )
  }

  if (!status) {
    return (
      <main className="center-page">
        <div className="spinner" aria-label="加载中" />
      </main>
    )
  }

  if (status.setupRequired) return <AuthScreen mode="setup" onComplete={handleAuthComplete} />
  if (!status.authenticated) {
    return (
      <AuthScreen
        mode="login"
        onComplete={handleAuthComplete}
        onOpenBlog={() => {
          setPostLoginRedirect(null)
          navigate('/')
        }}
      />
    )
  }
  if (isQuickCapture) return <QuickCapture />

  return (
    <Dashboard
      userEmail={status.user?.email || ''}
      onSessionChange={refreshStatus}
      initialTab={initialDashboardTab}
      onConsumeInitialTab={handleConsumeInitialTab}
      onOpenBlog={(opts) => {
        if (opts?.importItemId) {
          setPendingBlogImportItemId(opts.importItemId)
        }
        navigate(opts?.path || '/')
      }}
    />
  )
}
