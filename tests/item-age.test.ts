import { describe, expect, it } from 'vitest'
import { formatElapsedDays, itemAgeLabel } from '../src/item-age.js'

const hour = 60 * 60 * 1000
const now = 2_000_000_000_000

describe('条目时长文案', () => {
  it('最多保留一位小数并省略无意义的 .0', () => {
    expect(formatElapsedDays(now - 36 * hour, now)).toBe('1.5')
    expect(formatElapsedDays(now - 48 * hour, now)).toBe('2')
  })

  it('待处理按录入时间计算', () => {
    expect(itemAgeLabel({
      status: 'pending',
      createdAt: now - 36 * hour,
      updatedAt: now - 2 * hour,
      completedAt: null
    }, now)).toBe('1.5天未看')
  })

  it('已完成按完成时间计算', () => {
    expect(itemAgeLabel({
      status: 'completed',
      createdAt: now - 10 * 24 * hour,
      updatedAt: now - 36 * hour,
      completedAt: now - 36 * hour
    }, now)).toBe('1.5天前看了')
  })

  it('未来时间会按零天处理', () => {
    expect(formatElapsedDays(now + hour, now)).toBe('0')
  })
})
