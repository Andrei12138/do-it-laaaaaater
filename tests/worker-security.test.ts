import { describe, expect, it } from 'vitest'
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionToken,
  hashPassword,
  hashToken,
  parseCookie,
  verifyPassword
} from '../worker/security'

describe('Cloudflare Worker 安全与会话模块', () => {
  it('使用 PBKDF2 正确加密并校验密码', async () => {
    const hash = await hashPassword('my-super-secret-password')
    expect(hash.startsWith('pbkdf2$')).toBe(true)
    expect(await verifyPassword('my-super-secret-password', hash)).toBe(true)
    expect(await verifyPassword('wrong-password-123', hash)).toBe(false)
  })

  it('生成并解析会话 Cookie', async () => {
    const token = createSessionToken()
    const hashed = await hashToken(token)
    expect(hashed).toHaveLength(64)

    const httpsUrl = new URL('https://do-it-laaaaaater.workers.dev/api/auth/login')
    const setCookie = buildSessionCookie(token, httpsUrl)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(parseCookie(`foo=1; dil_session=${encodeURIComponent(token)}`, 'dil_session')).toBe(token)

    const cleared = buildClearSessionCookie(httpsUrl)
    expect(cleared).toContain('Max-Age=0')
  })
})
