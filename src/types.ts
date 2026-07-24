export type ItemStatus = 'pending' | 'completed'
export type ItemKind = 'link' | 'text' | 'image_group'
export type ItemSort = 'smart' | 'newest' | 'oldest' | 'recently_completed' | 'planned_date'
export type PriorityFilter = 'all' | 'planned' | 'starred'
export type TrashFilter = 'active' | 'only' | 'all'

export interface AuthStatus {
  setupRequired: boolean
  authenticated: boolean
  user: { email: string } | null
}

export interface Category {
  id: string
  name: string
  color: string
  sort_order?: number
}

export interface ImageAsset {
  id: string
  role: 'web_cover' | 'attachment' | 'gallery'
  originalName: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  sortOrder: number
  thumbUrl: string
  originalUrl: string
}

export interface LibraryItem {
  id: string
  kind: ItemKind
  title: string
  url: string | null
  status: ItemStatus
  category: Category | null
  assets: ImageAsset[]
  createdAt: number
  updatedAt: number
  completedAt: number | null
  isStarred: boolean
  plannedFor: string | null
  trashedAt: number | null
}

export interface ItemFilters {
  status: 'pending' | 'completed' | 'all'
  kind: ItemKind | 'all'
  category: string
  date: string
  q: string
  priority: PriorityFilter
  sort: ItemSort
  trash: TrashFilter
}

export interface AppPreferences {
  quickSaveCategoryId: string | null
}

export type SyncPhase = 'idle' | 'saving' | 'syncing' | 'queued' | 'saved' | 'offline' | 'error'

export interface SyncSnapshot {
  phase: SyncPhase
  lastSavedAt: number | null
  message: string
}

export interface BulkItemChanges {
  status?: ItemStatus
  categoryId?: string | null
  isStarred?: boolean
  plannedFor?: string | null
}

export type MemoBackground = 'solid' | 'grid' | 'dots' | 'lines'
export type MemoColorMode = 'light' | 'dark'

export interface MemoCanvasAsset {
  fileId: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  size: number
  createdAt: number
  url: string
}

export interface MemoCanvasScene {
  elements: unknown[]
  appState: Record<string, unknown>
}

export interface MemoCanvasSnapshot {
  scene: MemoCanvasScene
  background: MemoBackground
  colorMode: MemoColorMode
  updatedAt: number
  assets: MemoCanvasAsset[]
}
