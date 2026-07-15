export type ItemStatus = 'pending' | 'completed'
export type ItemKind = 'link' | 'text' | 'image_group'

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
}

export interface ItemFilters {
  status: 'pending' | 'completed' | 'all'
  kind: ItemKind | 'all'
  category: string
  date: string
  q: string
}
