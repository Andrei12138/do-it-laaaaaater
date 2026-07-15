import { ApiRequestError } from './api-error'
import { cloudApi } from './cloud/cloud-api'
import { cloudEnabled } from './cloud/supabase'

export { ApiRequestError } from './api-error'
export { cloudEnabled as isCloudMode } from './cloud/supabase'

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (cloudEnabled) return cloudApi<T>(path, options)
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
  return body as T
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
