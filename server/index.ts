import { createApp } from './app.js'
import { createContext } from './db.js'

const port = Number(process.env.PORT || 4317)
const host = '127.0.0.1'
const context = createContext()
const app = createApp(context)

const server = app.listen(port, host, () => {
  console.log('Do It Laaaaaater 已启动：http://' + host + ':' + port)
})

function shutdown() {
  server.close(() => {
    context.db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
