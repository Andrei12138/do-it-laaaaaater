import { ApiRequestError } from './api-error'
import { cloudApi } from './cloud/cloud-api'
import { cloudEnabled } from './cloud/supabase'
import { markSaved, markSaveFailed, markSaving } from './sync-status'

export { ApiRequestError } from './api-error'
export { cloudEnabled as isCloudMode } from './cloud/supabase'

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase()
  const tracksWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method) && path !== '/api/metadata'
  if (tracksWrite) markSaving()
  try {
    let result: T
    if (cloudEnabled) {
      result = await cloudApi<T>(path, options)
    } else {
      const headers = new Headers(options.headers)
      if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) {
        headers.set('content-type', 'application/json')
      }
      const response = await fetch(path, {
        ...options,
        headers,
        credentials: 'same-origin'
      })
      const contentType = response.headers.get('content-type') || ''
      const body = contentType.includes('application/json') ? await response.json() : null
      if (!response.ok) {
        throw new ApiRequestError(
          response.status,
          body?.error || '操作失败，请稍后重试',
          body?.details
        )
      }
      result = body as T
    }
    if (tracksWrite) markSaved(cloudEnabled)
    return result
  } catch (error) {
    if (tracksWrite) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      markSaveFailed(errorMessage(error), offline)
    }
    throw error
  }
}

export function jsonRequest<T>(path: string, method: string, body?: unknown) {
  return api<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}
