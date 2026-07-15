export type DraftType = 'link' | 'text' | 'images' | 'edit'

export interface FormDraft {
  key: string
  type: DraftType
  itemId?: string
  updatedAt: number
  data: Record<string, unknown>
  files: File[]
}

export interface ActiveDraft {
  key: string
  type: DraftType
  itemId?: string
  updatedAt: number
}

const DATABASE_NAME = 'do-it-laaaaaater-drafts-v1'
const STORE_NAME = 'drafts'
const ACTIVE_KEY = 'do-it-laaaaaater.active-draft.v1'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开草稿区'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = action(transaction.objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('草稿操作失败'))
      transaction.onerror = () => reject(transaction.error || new Error('草稿操作失败'))
    })
  } finally {
    database.close()
  }
}

export async function saveDraft(input: Omit<FormDraft, 'updatedAt'>) {
  if (typeof indexedDB === 'undefined') return
  const draft: FormDraft = { ...input, updatedAt: Date.now() }
  try {
    await withStore('readwrite', (store) => store.put(draft))
  } catch {
    return
  }
  try {
    const active: ActiveDraft = {
      key: draft.key,
      type: draft.type,
      itemId: draft.itemId,
      updatedAt: draft.updatedAt
    }
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(active))
  } catch {
    // IndexedDB still keeps the draft if local storage is unavailable.
  }
}

export async function loadDraft(key: string) {
  if (typeof indexedDB === 'undefined') return null
  try {
    return (await withStore<FormDraft | undefined>('readonly', (store) => store.get(key))) || null
  } catch {
    return null
  }
}

export async function discardDraft(key: string) {
  if (typeof indexedDB !== 'undefined') {
    try {
      await withStore('readwrite', (store) => store.delete(key))
    } catch {
      // A failed cleanup must not block a successful save.
    }
  }
  try {
    const active = readActiveDraft()
    if (active?.key === key) localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Ignore storage restrictions.
  }
}

export function readActiveDraft(): ActiveDraft | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as ActiveDraft
    if (!value?.key || !['link', 'text', 'images', 'edit'].includes(value.type)) return null
    return value
  } catch {
    return null
  }
}
