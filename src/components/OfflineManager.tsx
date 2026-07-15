import { useEffect, useState } from 'react'
import { Button } from 'animal-island-ui'
import {
  clearOfflineImages,
  discardFailedOfflineQueue,
  flushOfflineQueue,
  forceOfflineMutation,
  getOfflineQueueSummaries,
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
  return (
    <div className="offline-manager stack">
      <div className="account-section-heading">
        <AppIcon name={state.online ? 'sync' : 'warning'} size={24} />
        <div>
          <h3>离线阅读与自动同步</h3>
          <p>
            {state.online ? '当前已联网。' : '当前处于离线模式。'}
            {waiting ? `还有 ${waiting} 项本地修改。` : '所有修改均已同步。'}
          </p>
        </div>
      </div>

      <div className="offline-stats" role="status" aria-live="polite">
        <span><strong>{state.pendingCount}</strong> 等待同步</span>
        <span><strong>{state.failedCount}</strong> 同步失败</span>
        <span><strong>{formatBytes(state.storageBytes)}</strong> 图片缓存</span>
      </div>

      {entries.length > 0 && (
        <ul className="offline-queue-list">
          {entries.map((entry) => (
            <li key={entry.id} className={entry.state === 'failed' ? 'is-failed' : ''}>
              <div>
                <strong>{entry.label}</strong>
                <time>{timeLabel(entry.createdAt)}</time>
              </div>
              <span>{entry.state === 'failed' ? entry.lastError || '需要手动重试' : '等待联网后自动同步'}</span>
              {entry.conflict && (
                <Button size="small" disabled={busy || !state.online} onClick={() => void forceLocal(entry)}>
                  使用本机版本
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {state.warning && <div className="notice notice-warning">{state.warning}</div>}
      {!state.online && <div className="notice notice-warning">断网期间可以继续使用；恢复联网后会自动按保存顺序同步。</div>}
      {message && <div className="notice notice-success">{message}</div>}

      <div className="offline-actions">
        <Button
          type="primary"
          size="small"
          loading={busy || state.syncing}
          disabled={busy || state.syncing || !state.online || !waiting}
          icon={<AppIcon name="sync" size={17} />}
          onClick={() => void syncNow()}
        >
          立即同步
        </Button>
        {state.failedCount > 0 && (
          <Button size="small" disabled={busy || !state.online} icon={<AppIcon name="retry" size={17} />} onClick={() => void retryFailed()}>
            重试失败任务
          </Button>
        )}
        {state.failedCount > 0 && (
          <Button size="small" danger disabled={busy || !state.online} onClick={() => void discardFailed()}>
            放弃失败修改
          </Button>
        )}
        <Button size="small" disabled={busy || state.storageBytes === 0} onClick={() => void clearImages()}>
          清除图片缓存
        </Button>
      </div>
    </div>
  )
}

export function OfflineManagerModal({ onChanged, onClose }: { onChanged: () => Promise<void>; onClose: () => void }) {
  return (
    <Modal title="离线与同步" onClose={onClose} wide>
      <OfflineStatusContent onChanged={onChanged} />
    </Modal>
  )
}
