import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Progress } from 'animal-island-ui'
import { ApiRequestError, api, errorMessage, jsonRequest } from '../api'
import { useTheme } from '../theme'
import type { AppPreferences, Category, LibraryItem } from '../types'
import { AppIcon } from './AppIcon'
import { ThemeControl } from './ThemeControl'

interface MetadataResult {
  coverUrl: string
}

type CapturePhase = 'loading' | 'saving' | 'cover' | 'done' | 'duplicate' | 'error'

function captureInput() {
  const params = new URLSearchParams(window.location.search)
  return {
    url: params.get('url') || '',
    title: params.get('title') || ''
  }
}

function fallbackTitle(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return '稍后阅读网页'
  }
}

export function QuickCapture() {
  const { theme } = useTheme()
  const input = useMemo(captureInput, [])
  const started = useRef(false)
  const [phase, setPhase] = useState<CapturePhase>('loading')
  const [message, setMessage] = useState('正在读取默认类别…')
  const [warning, setWarning] = useState('')
  const [item, setItem] = useState<LibraryItem | null>(null)
  const [duplicateTrashed, setDuplicateTrashed] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    let cancelled = false

    async function run() {
      if (!input.url) {
        setPhase('error')
        setMessage('没有收到网页地址，请重新点击书签按钮。')
        return
      }
      try {
        const [preferences, categories] = await Promise.all([
          api<AppPreferences>('/api/preferences'),
          api<Category[]>('/api/categories')
        ])
        if (cancelled) return
        const defaultCategory = categories.find((category) => category.id === preferences.quickSaveCategoryId)
        if (!defaultCategory) setWarning('默认类别已失效，本次会保存为“未分类”。可稍后在账号设置中重新选择。')
        setPhase('saving')
        setMessage('正在快速保存…')
        const form = new FormData()
        form.set('url', input.url)
        form.set('title', input.title.trim() || fallbackTitle(input.url))
        form.set('categoryId', defaultCategory?.id || '')
        const saved = await api<LibraryItem>('/api/items/link', { method: 'POST', body: form })
        if (cancelled) return
        setItem(saved)
        setPhase('cover')
        setMessage('已经保存，正在尝试补充封面…')

        const controller = new AbortController()
        let timeout = 0
        try {
          const coverAttempt = (async () => {
            const metadata = await api<MetadataResult>('/api/metadata', {
              method: 'POST',
              body: JSON.stringify({ url: input.url }),
              signal: controller.signal
            })
            if (metadata.coverUrl) {
              await jsonRequest('/api/items/' + saved.id + '/cover', 'POST', { coverUrl: metadata.coverUrl })
            }
          })().catch(() => undefined)
          await Promise.race([
            coverAttempt,
            new Promise<void>((resolve) => {
              timeout = window.setTimeout(() => {
                controller.abort()
                resolve()
              }, 4_000)
            })
          ])
        } catch {
          // The link is already safe; cover lookup is deliberately best-effort.
        } finally {
          window.clearTimeout(timeout)
          controller.abort()
        }
        if (cancelled) return
        setPhase('done')
        setMessage('保存完成，这个小窗口会自动关闭。')
        window.setTimeout(() => window.close(), 850)
      } catch (requestError) {
        if (cancelled) return
        if (requestError instanceof ApiRequestError && requestError.status === 409) {
          const details = requestError.details as { existingId?: string; trashed?: boolean } | undefined
          const existingId = String(details?.existingId || '')
          let existing: LibraryItem | null = null
          if (existingId) {
            try {
              existing = await api<LibraryItem>('/api/items/' + existingId)
            } catch {
              // The duplicate message remains useful even if its summary cannot load.
            }
          }
          setItem(existing)
          setDuplicateTrashed(Boolean(details?.trashed || existing?.trashedAt))
          setPhase('duplicate')
          setMessage(details?.trashed
            ? '这个网页已经在回收站中。原条目没有改变，可前往恢复。'
            : '这个网页已经保存过了，原条目和录入时间都没有改变。')
          return
        }
        setPhase('error')
        setMessage(errorMessage(requestError))
      }
    }

    void run()
    return () => { cancelled = true }
  }, [input.title, input.url])

  function viewExisting() {
    if (!item) return
    const target = '/?open=' + encodeURIComponent(item.id)
    const opened = window.open(target, '_blank')
    if (opened) window.close()
    else window.location.href = target
  }

  return (
    <div className="quick-capture-shell">
      <div className="quick-capture-theme"><ThemeControl placement="auth" /></div>
      <Card className="quick-capture-card" pattern="default">
        <div className={`quick-capture-mark quick-capture-mark-${phase}`} aria-hidden="true">
          <AppIcon
            name={phase === 'duplicate' ? 'bookmark' : phase === 'error' ? 'warning' : phase === 'done' ? 'complete' : 'sync'}
            size={34}
          />
        </div>
        <span className="brand-kicker">QUICK SAVE</span>
        <h1>稍后保存</h1>
        <p className="quick-capture-message" role="status">{message}</p>
        {warning && <div className="notice notice-warning">{warning}</div>}
        {(phase === 'loading' || phase === 'saving' || phase === 'cover') && (
          theme === 'animal-island'
            ? <Progress percent={phase === 'loading' ? 20 : phase === 'saving' ? 55 : 85} showInfo={false} />
            : <div className="quick-capture-progress"><i style={{ width: phase === 'loading' ? '20%' : phase === 'saving' ? '55%' : '85%' }} /></div>
        )}
        {item && (
          <div className="quick-capture-summary">
            <strong>{item.title}</strong>
            {item.url && <span>{item.url}</span>}
            <small>{item.category?.name || '未分类'}</small>
          </div>
        )}
        <div className="quick-capture-actions">
          {phase === 'duplicate' && item && (
            <Button type="primary" onClick={viewExisting}>{duplicateTrashed ? '前往回收站' : '查看已有条目'}</Button>
          )}
          {(phase === 'done' || phase === 'error' || phase === 'duplicate') && (
            <Button onClick={() => window.close()}>关闭窗口</Button>
          )}
        </div>
      </Card>
    </div>
  )
}
