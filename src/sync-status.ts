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
    message: offline ? '当前离线，内容已保留，请联网后手动重试' : message
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
