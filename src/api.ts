import { ApiRequestError } from './api-error'
import { cloudApi } from './cloud/cloud-api'
import { cloudEnabled } from './cloud/supabase'
import {
  enqueueOfflineApi,
  flushOfflineQueue,
  initializeOfflineRuntime,
  isOfflineQueueable,
  isOfflineReadable,
  readOfflineApi,
  rememberSuccessfulApi
} from './offline-store'
import { markOfflineReading, markQueued, markSaved, markSaveFailed, markSaving } from './sync-status'

export { ApiRequestError } from './api-error'
export { cloudEnabled as isCloudMode } from './cloud/supabase'

async function sendRemote<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (cloudEnabled) return cloudApi<T>(path, options)
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) {
    throw new ApiRequestError(response.status, body?.error || '操作失败，请稍后重试', body?.details)
  }
  return body as T
}

function retryableNetworkError(error: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (error instanceof ApiRequestError) return error.status >= 500 || error.status === 408 || error.status === 429
  return error instanceof TypeError || /fetch|network|网络|连接/i.test(errorMessage(error))
}

if (typeof window !== 'undefined') initializeOfflineRuntime(sendRemote)

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase()
  const tracksWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method) && path !== '/api/metadata'
  const definitelyOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (tracksWrite) markSaving()

  if (definitelyOffline) {
    if (isOfflineReadable(path, method)) {
      const result = await readOfflineApi<T>(path)
      markOfflineReading()
      return result
    }
    if (isOfflineQueueable(path, method)) {
      const result = await enqueueOfflineApi<T>(path, options)
      markQueued()
      return result
    }
  }

  try {
    const result = await sendRemote<T>(path, options)
    await rememberSuccessfulApi(path, options, result)
    if (tracksWrite) markSaved(cloudEnabled)
    return result
  } catch (error) {
    if (isOfflineReadable(path, method) && retryableNetworkError(error)) {
      try {
        const result = await readOfflineApi<T>(path)
        markOfflineReading()
        return result
      } catch {
        // Preserve the original server error when no local snapshot exists.
      }
    }
    if (isOfflineQueueable(path, method) && retryableNetworkError(error)) {
      try {
        const result = await enqueueOfflineApi<T>(path, options)
        markQueued()
        return result
      } catch (queueError) {
        if (tracksWrite) markSaveFailed(errorMessage(queueError), definitelyOffline)
        throw queueError
      }
    }
    if (tracksWrite) markSaveFailed(errorMessage(error), definitelyOffline)
    throw error
  }
}

export { flushOfflineQueue }

export function jsonRequest<T>(path: string, method: string, body?: unknown) {
  return api<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}

// ── AI 辅助（摘要 / 分类 / 处理建议）────────────────────────────
export interface AiSummaryResult {
  summary: string
}
export interface AiCategorizeResult {
  category: string
}
export interface AiAdviceResult {
  advice: string
}

export function aiSummarize(payload: { title?: string; text: string }) {
  return jsonRequest<AiSummaryResult>('/api/ai/summarize', 'POST', payload)
}

export function aiCategorize(payload: { text: string; categories?: string[] }) {
  return jsonRequest<AiCategorizeResult>('/api/ai/categorize', 'POST', payload)
}

export function aiAdvice(payload: { text: string }) {
  return jsonRequest<AiAdviceResult>('/api/ai/advice', 'POST', payload)
}
