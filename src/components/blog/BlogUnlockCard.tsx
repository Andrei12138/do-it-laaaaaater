import { useEffect, useState, type FormEvent } from 'react'
import { unlockBlogPost } from '../../blog-api'
import type { BlogPostDetail } from '../../blog-types'
import { AppIcon } from '../AppIcon'

export interface BlogUnlockCardProps {
  shortId: string
  title: string
  onUnlocked: (detail: BlogPostDetail) => void
  onBack?: () => void
}

export function BlogUnlockCard({ shortId, title, onUnlocked, onBack }: BlogUnlockCardProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPassword('')
    setShowPassword(false)
    setSubmitting(false)
    setError(null)
  }, [shortId])

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    const trimmed = password.trim()
    if (!trimmed) {
      setError('请输入访问密码')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const detail = await unlockBlogPost(shortId, trimmed)
      onUnlocked(detail)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '密码错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="blog-unlock-card">
      <div className="blog-unlock-icon" aria-hidden="true">
        <AppIcon name="lock" size={20} />
      </div>
      <h2 className="blog-unlock-title">{title || '加密内容'}</h2>
      <p className="blog-unlock-hint">此内容已设置访问密码，请输入密码解锁阅读</p>

      <form className="blog-unlock-form" onSubmit={handleSubmit}>
        <div
          style={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error) setError(null)
            }}
            placeholder="请输入访问密码"
            autoComplete="off"
            autoFocus
            disabled={submitting}
            aria-label="访问密码"
            style={{ width: '100%', paddingRight: 36 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            disabled={submitting}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            title={showPassword ? '隐藏密码' : '显示密码'}
            style={{
              position: 'absolute',
              right: 4,
              width: 28,
              height: 28,
              padding: 0,
              border: 0,
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--blog-text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <AppIcon name={showPassword ? 'eyeOff' : 'eye'} size={15} />
          </button>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting || !password.trim()}
          style={{ height: 36, flexShrink: 0 }}
        >
          <AppIcon name="unlock" size={14} />
          <span>{submitting ? '解锁中…' : '解锁'}</span>
        </button>
      </form>

      {error && (
        <p className="blog-unlock-error" role="alert">
          {error}
        </p>
      )}

      {onBack && (
        <button
          type="button"
          className="blog-btn blog-btn-ghost blog-btn-sm"
          onClick={onBack}
          style={{ marginTop: 4 }}
        >
          <AppIcon name="arrowLeft" size={14} />
          <span>返回</span>
        </button>
      )}
    </div>
  )
}
