import { describe, expect, it } from 'vitest'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  activeMemoFileIds,
  createMemoItemElement,
  findMemoItemElement,
  findMemoItemPlacement,
  memoItemId,
  persistedMemoAppState,
  removeMemoItemReference
} from '../src/memo-scene.js'

describe('备忘录画布场景', () => {
  it('同一条资料库内容可被识别、定位并只移除引用', () => {
    const reference = createMemoItemElement('item-123', 100, 200)
    expect(memoItemId(reference)).toBe('item-123')
    expect(findMemoItemElement([reference], 'item-123')?.id).toBe(reference.id)

    const removed = removeMemoItemReference([reference], reference.id)
    expect(removed[0].isDeleted).toBe(true)
    expect(findMemoItemElement(removed, 'item-123')).toBeNull()
  })

  it('只保存仍在画布中的图片编号，并过滤临时界面状态', () => {
    const elements = [
      { id: 'one', type: 'image', fileId: 'file-one', isDeleted: false },
      { id: 'two', type: 'image', fileId: 'file-two', isDeleted: true },
      { id: 'three', type: 'rectangle', isDeleted: false }
    ] as unknown as ExcalidrawElement[]
    expect(activeMemoFileIds(elements)).toEqual(['file-one'])
    expect(persistedMemoAppState({
      scrollX: 12,
      scrollY: 34,
      zoom: { value: 1 },
      selectedElementIds: { one: true },
      openMenu: 'canvas'
    })).toEqual({
      scrollX: 12,
      scrollY: 34,
      zoom: { value: 1 }
    })
  })

  it('连续放入多条资料时自动错开放置，不让卡片完全叠在一起', () => {
    const first = createMemoItemElement('first', 330, 390)
    const second = findMemoItemPlacement([first], { x: 500, y: 500 })
    expect(second).toEqual({ x: 710, y: 390 })

    const next = createMemoItemElement('second', second.x, second.y)
    const third = findMemoItemPlacement([first, next], { x: 500, y: 500 })
    expect(third).toEqual({ x: -50, y: 390 })
  })
})
