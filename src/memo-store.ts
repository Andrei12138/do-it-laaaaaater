import type { MemoBackground, MemoCanvasScene, MemoColorMode } from './types'

const DATABASE_NAME = 'do-it-laaaaaater-memo'
const DATABASE_VERSION = 1
const STORE_NAME = 'drafts'
const DRAFT_KEY = 'single-canvas'

export interface MemoDraft {
  scene: MemoCanvasScene
  background: MemoBackground
  colorMode: MemoColorMode
  updatedAt: number
  files: Record<string, {
    id: string
    mimeType: string
    dataURL: string
    created: number
    lastRetrieved?: number
  }>
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开画布草稿区'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
) {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = action(transaction.objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('画布草稿操作失败'))
      transaction.onabort = () => reject(transaction.error || new Error('画布草稿操作已中止'))
    })
  } finally {
    database.close()
  }
}

export async function readMemoDraft() {
  if (typeof indexedDB === 'undefined') return null
  try {
    const draft = await withStore<MemoDraft | undefined>('readonly', (store) => store.get(DRAFT_KEY))
    return draft || null
  } catch {
    return null
  }
}

export async function writeMemoDraft(draft: MemoDraft) {
  if (typeof indexedDB === 'undefined') return
  await withStore<IDBValidKey>('readwrite', (store) => store.put(draft, DRAFT_KEY))
}

export async function clearMemoDraft() {
  if (typeof indexedDB === 'undefined') return
  try {
    await withStore<undefined>('readwrite', (store) => store.delete(DRAFT_KEY))
  } catch {
    // A server-synced canvas remains safe even if an old local draft cannot be removed.
  }
}
