import { rmSync } from 'node:fs'
import path from 'node:path'

const dataDir = path.join(process.cwd(), 'test-results', 'e2e-data')
rmSync(dataDir, { recursive: true, force: true })
process.env.DATA_DIR = dataDir
process.env.PORT = '4321'
process.env.NODE_ENV = 'production'
await import('../dist-server/server/index.js')
