import { describe, expect, it } from 'vitest'
import { filterLibraryItems } from '../src/offline-query.js'
import type { ItemFilters, LibraryItem } from '../src/types.js'

const baseFilters: ItemFilters = {
  status: 'all',
  kind: 'all',
  category: '',
  date: '',
  q: '',
  priority: 'all',
  sort: 'newest'
}

function item(input: Partial<LibraryItem> & Pick<LibraryItem, 'id' | 'title'>): LibraryItem {
  return {
    id: input.id,
    title: input.title,
    kind: input.kind || 'text',
    url: input.url || null,
    status: input.status || 'pending',
    category: input.category || null,
    assets: input.assets || [],
    createdAt: input.createdAt || 1,
    updatedAt: input.updatedAt || input.createdAt || 1,
    completedAt: input.completedAt || null,
    isStarred: input.isStarred || false,
    plannedFor: input.plannedFor || null
  }
}

describe('离线清单筛选', () => {
  const items = [
    item({ id: 'new', title: '离线保存的文章', kind: 'link', url: 'https://example.com', createdAt: 30 }),
    item({
      id: 'image',
      title: '旅行照片',
      kind: 'image_group',
      createdAt: 20,
      category: { id: 'life', name: '生活', color: '#16a34a' },
      assets: [{
        id: 'asset', role: 'gallery', originalName: 'island.png', mimeType: 'image/png', size: 12,
        width: 1, height: 1, sortOrder: 0, thumbUrl: '/thumb', originalUrl: '/original'
      }]
    }),
    item({ id: 'done', title: '已经读完', status: 'completed', createdAt: 10, completedAt: 40 })
  ]

  it('与在线清单保持相同的状态、类型、类别和搜索语义', () => {
    expect(filterLibraryItems(items, { ...baseFilters, status: 'completed' }).map((entry) => entry.id)).toEqual(['done'])
    expect(filterLibraryItems(items, { ...baseFilters, kind: 'link' }).map((entry) => entry.id)).toEqual(['new'])
    expect(filterLibraryItems(items, { ...baseFilters, category: 'life' }).map((entry) => entry.id)).toEqual(['image'])
    expect(filterLibraryItems(items, { ...baseFilters, category: '' }).map((entry) => entry.id)).toEqual(['new', 'image', 'done'])
    expect(filterLibraryItems(items, { ...baseFilters, category: 'uncategorized' }).map((entry) => entry.id)).toEqual(['new', 'done'])
    expect(filterLibraryItems(items, { ...baseFilters, q: 'island.png' }).map((entry) => entry.id)).toEqual(['image'])
  })

  it('支持最近保存、最久未看和最近完成排序', () => {
    expect(filterLibraryItems(items, baseFilters).map((entry) => entry.id)).toEqual(['new', 'image', 'done'])
    expect(filterLibraryItems(items, { ...baseFilters, sort: 'oldest' }).map((entry) => entry.id)).toEqual(['done', 'image', 'new'])
    expect(filterLibraryItems(items, { ...baseFilters, sort: 'recently_completed' })[0].id).toBe('done')
  })
})
