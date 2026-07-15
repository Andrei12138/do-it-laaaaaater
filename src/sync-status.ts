import { useSyncExternalStore } from 'react'
import type { SyncSnapshot } from './types'

let snapshot: SyncSnapshot = {
  phase: 'idle',
  lastSavedAt: null,
  message: ''
}

const listeners = new Set<() => void>()

function publish(next: SyncSnapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

export function markSaving(message = '正在保存…') {
  publish({ ...snapshot, phase: 'saving', message })
}

export function markQueueSyncing(message = '正在同步离线修改…') {
  publish({ ...snapshot, phase: 'syncing', message })
}

export function markQueued(count?: number) {
  publish({
    ...snapshot,
    phase: 'queued',
    message: count ? `已保存在本机，${count} 条等待同步` : '已保存在本机，联网后会自动同步'
  })
}

export function markOfflineReading(updatedAt?: number | null) {
  const suffix = updatedAt
    ? ` · 上次同步 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(updatedAt)}`
    : ''
  publish({ ...snapshot, phase: 'offline', message: '当前离线，正在显示本机内容' + suffix })
}

export function markSaved(cloud: boolean) {
  publish({
    phase: 'saved',
    lastSavedAt: Date.now(),
    message: cloud ? '已同步' : '已保存到本机'
  })
}

export function markSaveFailed(message: string, offline: boolean) {
  publish({
    ...snapshot,
    phase: offline ? 'offline' : 'error',
    message: offline ? '当前离线，此操作尚未保存' : message
  })
}

export function resetSyncStatus() {
  publish({ ...snapshot, phase: 'idle', message: '' })
}

export function useSyncStatus() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
    () => snapshot
  )
}
