import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error)
      else resolve(key as Buffer)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt)
  return ['scrypt', salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltText, keyText] = stored.split('$')
  if (algorithm !== 'scrypt' || !saltText || !keyText) return false
  const salt = Buffer.from(saltText, 'base64url')
  const expected = Buffer.from(keyText, 'base64url')
  const actual = await deriveKey(password, salt)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function validatePassword(password: string) {
  if (password.length < 10) return '密码至少需要 10 个字符'
  if (password.length > 200) return '密码过长'
  return null
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
