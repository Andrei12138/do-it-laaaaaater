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
  it('把全部计划按日期分段，并让同时星标的计划内容在两个模块显示', () => {
    const groups = smartDashboardGroups([
      item({ id: 'overdue-recent', plannedFor: '2026-07-23' }),
      item({ id: 'overdue-older', plannedFor: '2026-07-20' }),
      item({ id: 'today', plannedFor: '2026-07-24' }),
      item({ id: 'tomorrow', plannedFor: '2026-07-25', createdAt: Date.parse('2026-07-24T10:00:00+08:00') }),
      item({
        id: 'planned-starred',
        plannedFor: '2026-07-25',
        isStarred: true,
        createdAt: Date.parse('2026-07-24T18:00:00+08:00')
      }),
      item({ id: 'future', plannedFor: '2026-08-01' }),
      item({ id: 'starred', isStarred: true, createdAt: Date.parse('2026-07-24T16:00:00+08:00') }),
      item({ id: 'later-new', createdAt: Date.parse('2026-07-24T20:00:00+08:00') }),
      item({ id: 'later-same-day', createdAt: Date.parse('2026-07-24T08:00:00+08:00') }),
      item({ id: 'later-previous', createdAt: Date.parse('2026-07-23T23:30:00+08:00') })
    ], '2026-07-24')

    expect(groups.map((group) => group.key)).toEqual(['planned', 'starred', 'later'])
    expect(groups[0].dateGroups?.map((group) => ({
      label: group.label,
      items: group.items.map((entry) => entry.id)
    }))).toEqual([
      { label: '逾期 · 2026年7月23日', items: ['overdue-recent'] },
      { label: '逾期 · 2026年7月20日', items: ['overdue-older'] },
      { label: '今天 · 2026年7月24日', items: ['today'] },
      { label: '明天 · 2026年7月25日', items: ['planned-starred', 'tomorrow'] },
      { label: '2026年8月1日', items: ['future'] }
    ])
    expect(groups[1].items.map((entry) => entry.id)).toEqual(['planned-starred', 'starred'])
    expect(groups[1].dateGroups).toBeUndefined()
    expect(groups[2].dateGroups?.map((group) => ({
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

  it('取消计划或星标后会立即回到唯一正确的模块', () => {
    const both = item({ id: 'both', plannedFor: '2026-07-25', isStarred: true })
    let groups = smartDashboardGroups([both], '2026-07-24')
    expect(groups.map((group) => [group.key, group.items.map((entry) => entry.id)])).toEqual([
      ['planned', ['both']],
      ['starred', ['both']]
    ])

    groups = smartDashboardGroups([{ ...both, plannedFor: null }], '2026-07-24')
    expect(groups.map((group) => group.key)).toEqual(['starred'])

    groups = smartDashboardGroups([{ ...both, isStarred: false }], '2026-07-24')
    expect(groups.map((group) => group.key)).toEqual(['planned'])

    groups = smartDashboardGroups([{ ...both, plannedFor: null, isStarred: false }], '2026-07-24')
    expect(groups.map((group) => group.key)).toEqual(['later'])
  })
})
