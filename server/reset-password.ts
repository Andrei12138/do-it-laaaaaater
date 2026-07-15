import { createContext, runTransaction } from './db.js'
import { hashPassword, normalizeEmail, validatePassword } from './security.js'

const email = normalizeEmail(process.env.RESET_EMAIL || '')
const password = process.env.RESET_PASSWORD || ''
const passwordError = validatePassword(password)

if (!email || passwordError) {
  console.error(passwordError || '缺少账号邮箱')
  process.exit(1)
}

const context = createContext()
try {
  const user = context.db.prepare('SELECT id FROM users WHERE email=?').get(email) as
    | { id: string }
    | undefined
  if (!user) {
    console.error('没有找到这个账号')
    process.exitCode = 1
  } else {
    const passwordHash = await hashPassword(password)
    runTransaction(context.db, () => {
      context.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, user.id)
      context.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id)
    })
    console.log('密码已重置，请使用新密码登录。')
  }
} finally {
  context.db.close()
}
