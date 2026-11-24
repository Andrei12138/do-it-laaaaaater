import { useEffect, useState } from 'react'
import {
  clearOfflineImages,
  discardFailedOfflineQueue,
  flushOfflineQueue,
  forceOfflineMutation,
  getOfflineQueueSummaries,
  pauseOfflineImageCache,
  resumeOfflineImageCache,
  retryOfflineImageCache,
  retryFailedOfflineQueue,
  useOfflineRuntime,
  type OfflineQueueSummary
} from '../offline-store'
import { AppIcon } from './AppIcon'
import { Modal } from './Modal'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(timestamp)
}

export function OfflineStatusContent({ onChanged }: { onChanged?: () => Promise<void> }) {
  const state = useOfflineRuntime()
  const [entries, setEntries] = useState<OfflineQueueSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function refreshEntries() {
    setEntries(await getOfflineQueueSummaries())
  }

  useEffect(() => {
    void refreshEntries()
  }, [state.pendingCount, state.failedCount, state.syncing])

  async function syncNow() {
    setBusy(true)
    setMessage('')
    try {
      await flushOfflineQueue()
      await refreshEntries()
      if (onChanged && navigator.onLine) await onChanged()
      setMessage('同步检查已完成')
    } finally {
      setBusy(false)
    }
  }

  async function retryFailed() {
    setBusy(true)
    setMessage('')
    try {
      await retryFailedOfflineQueue()
      await refreshEntries()
      if (onChanged && navigator.onLine) await onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function discardFailed() {
    if (!navigator.onLine) return
    if (!window.confirm('确定放弃失败的本地修改，并重新读取云端内容吗？')) return
    setBusy(true)
    try {
      await discardFailedOfflineQueue()
      if (onChanged) await onChanged()
      await refreshEntries()
      setMessage('失败任务已放弃，内容已重新同步')
    } finally {
      setBusy(false)
    }
  }

  async function forceLocal(entry: OfflineQueueSummary) {
    if (!window.confirm('云端内容已被其他设备更新。确定仍使用这台设备上的修改覆盖云端吗？')) return
    setBusy(true)
    try {
      await forceOfflineMutation(entry.id)
      await refreshEntries()
      if (onChanged && navigator.onLine) await onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function clearImages() {
    if (!window.confirm('清除本机图片缓存后，断网时将暂时无法查看这些图片。继续吗？')) return
    setBusy(true)
    try {
      await clearOfflineImages()
      setMessage('本机图片缓存已清除；下次联网刷新时会重新下载')
    } finally {
      setBusy(false)
    }
  }

  const waiting = state.pendingCount + state.failedCount
  const cacheDone = Math.min(state.cacheCompleted, state.cacheTotal)
  const cachePercent = state.cacheTotal > 0 ? Math.round((cacheDone / state.cacheTotal) * 100) : 0
  const storagePercent = state.storageQuota > 0
    ? Math.max(1, Math.min(100, Math.round((state.storageUsage / state.storageQuota) * 100)))
    : 0

  return (
    <div className="offline-manager stack">
      <div className="account-section-heading">
        <AppIcon name={state.online ? 'sync' : 'offline'} size={20} />
        <div>
          <h3>离线与缓存</h3>
          <p className="field-hint">
            {state.online ? '当前已联网。' : '当前处于离线模式。'}
            {waiting ? `还有 ${waiting} 项本地修改待处理。` : '所有修改均已同步。'}
          </p>
        </div>
      </div>

      <div className="offline-stats" role="status" aria-live="polite">
        <div className="offline-stat">
          <strong className="mono">{state.pendingCount}</strong>
          <span>等待同步</span>
        </div>
        <div className="offline-stat">
          <strong className="mono">{state.failedCount}</strong>
          <span>同步失败</span>
        </div>
        <div className="offline-stat">
          <strong className="mono">{formatBytes(state.storageBytes)}</strong>
          <span>图片缓存</span>
        </div>
      </div>

      <div className="offline-cache-progress" role="status" aria-live="polite">
        <div className="offline-cache-header">
          <strong>原图后台缓存</strong>
          <span className="field-hint">
            {state.cachePhase === 'running' && '正在依次下载，不影响使用'}
            {state.cachePhase === 'paused' && '已暂停'}
            {state.cachePhase === 'error' && `有 ${state.cacheFailed} 个文件等待重试`}
            {state.cachePhase === 'idle' && (state.cacheTotal ? '本轮缓存已完成' : '联网刷新清单后自动开始')}
          </span>
        </div>

        {state.cacheTotal > 0 && (
          <div className="offline-progress-row">
            <div className="progress-bar" aria-hidden="true">
              <div className="progress-fill" style={{ width: cachePercent + '%' }} />
            </div>
            <span className="mono">{cacheDone} / {state.cacheTotal}</span>
          </div>
        )}

        {state.storageQuota > 0 && (
          <div className="offline-storage-row">
            <div className="offline-storage-meta">
              <span className="field-hint">浏览器存储空间</span>
              <span className="mono">{formatBytes(state.storageUsage)} / {formatBytes(state.storageQuota)}</span>
            </div>
            <div className="progress-bar" aria-hidden="true">
              <div className="progress-fill" style={{ width: storagePercent + '%' }} />
            </div>
          </div>
        )}

        {(state.cachePhase === 'running' || state.cachePhase === 'paused' || state.cacheFailed > 0) && (
          <div className="offline-cache-actions">
            {state.cachePhase === 'running' && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={pauseOfflineImageCache}>
                暂停缓存
              </button>
            )}
            {state.cachePhase === 'paused' && (
              <button type="button" className="btn btn-primary btn-sm" onClick={resumeOfflineImageCache}>
                继续缓存
              </button>
            )}
            {state.cacheFailed > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={retryOfflineImageCache}>
                <AppIcon name="sync" size={14} />
                重试失败图片
              </button>
            )}
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <ul className="offline-queue-list">
          {entries.map((entry) => (
            <li key={entry.id} className={`offline-queue-item${entry.state === 'failed' ? ' is-failed' : ''}`}>
              <div className="offline-queue-head">
                <strong>{entry.label}</strong>
                <time className="mono">{timeLabel(entry.createdAt)}</time>
              </div>
              <span className="field-hint">
                {entry.state === 'failed' ? entry.lastError || '需要手动重试' : '等待联网后自动同步'}
              </span>
              {entry.conflict && (
                <div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy || !state.online}
                    onClick={() => void forceLocal(entry)}
                  >
                    使用本机版本
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {state.warning && <div className="notice notice-error" role="alert">{state.warning}</div>}
      {!state.online && (
        <div className="notice notice-info">断网期间可以继续使用；恢复联网后会自动按保存顺序同步。</div>
      )}
      {message && <div className="notice notice-success" role="status">{message}</div>}

      <div className="offline-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || state.syncing || !state.online || !waiting}
          onClick={() => void syncNow()}
        >
          <AppIcon name="sync" size={14} />
          {busy || state.syncing ? '同步中…' : '立即同步'}
        </button>
        {state.failedCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy || !state.online}
            onClick={() => void retryFailed()}
          >
            <AppIcon name="sync" size={14} />
            重试失败任务
          </button>
        )}
        {state.failedCount > 0 && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={busy || !state.online}
            onClick={() => void discardFailed()}
          >
            放弃失败修改
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || state.storageBytes === 0}
          onClick={() => void clearImages()}
        >
          <AppIcon name="trash" size={14} />
          清除图片缓存
        </button>
      </div>
    </div>
  )
}

export function OfflineManagerModal({
  onChanged,
  onClose
}: {
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  return (
    <Modal title="离线与同步" onClose={onClose} wide>
      <OfflineStatusContent onChanged={onChanged} />
    </Modal>
  )
}
