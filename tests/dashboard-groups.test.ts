import { describe, expect, it } from 'vitest'
import { smartDashboardGroups } from '../src/dashboard-groups.js'
import type { LibraryItem } from '../src/types.js'

function item(input: Partial<LibraryItem> & Pick<LibraryItem, 'id'>): LibraryItem {
  return {
    id: input.id,
    kind: 'text',
    title: input.id,
    url: null,
    status: 'pending',
    category: null,
    assets: [],
    createdAt: input.createdAt || Date.parse('2026-07-24T12:00:00+08:00'),
    updatedAt: input.updatedAt || input.createdAt || Date.parse('2026-07-24T12:00:00+08:00'),
    completedAt: null,
    isStarred: input.isStarred || false,
    plannedFor: input.plannedFor || null,
    trashedAt: null
  }
}

describe('首页智能分组', () => {
  it('只在其余内容中按中国日期分组，优先模块保持扁平列表', () => {
    const groups = smartDashboardGroups([
      item({ id: 'overdue', plannedFor: '2026-07-23' }),
      item({ id: 'today', plannedFor: '2026-07-24' }),
      item({ id: 'starred', isStarred: true }),
      item({ id: 'later-new', createdAt: Date.parse('2026-07-24T20:00:00+08:00') }),
      item({ id: 'later-same-day', createdAt: Date.parse('2026-07-24T08:00:00+08:00') }),
      item({ id: 'later-previous', createdAt: Date.parse('2026-07-23T23:30:00+08:00') })
    ], '2026-07-24')

    expect(groups.map((group) => group.key)).toEqual(['overdue', 'today', 'starred', 'later'])
    expect(groups.slice(0, 3).every((group) => group.dateGroups === undefined)).toBe(true)
    expect(groups[3].dateGroups?.map((group) => ({
      label: group.label,
      items: group.items.map((entry) => entry.id)
    }))).toEqual([
      {
        label: '2026年7月24日',
        items: ['later-new', 'later-same-day']
      },
      {
        label: '2026年7月23日',
        items: ['later-previous']
      }
    ])
  })
})
