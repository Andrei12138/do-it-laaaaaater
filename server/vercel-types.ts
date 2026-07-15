import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

export interface VercelRequest extends IncomingMessage {
  headers: IncomingHttpHeaders
  body?: Record<string, unknown>
  query: Record<string, string | string[] | undefined>
}

export interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse
  json(value: unknown): void
  send(value: Buffer | string): void
}
