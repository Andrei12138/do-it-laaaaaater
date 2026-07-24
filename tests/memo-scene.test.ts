import { describe, expect, it } from 'vitest'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  activeMemoFileIds,
  createMemoItemElement,
  findMemoItemElement,
  findMemoItemPlacement,
  MEMO_ITEM_HEIGHT,
  MEMO_ITEM_WIDTH,
  memoItemId,
  normalizeMemoItemElements,
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
    const firstPlacement = findMemoItemPlacement([], { x: 500, y: 500 })
    expect(firstPlacement).toEqual({ x: 160, y: 398 })
    const first = createMemoItemElement('first', firstPlacement.x, firstPlacement.y)
    const second = findMemoItemPlacement([first], { x: 500, y: 500 })
    expect(second).toEqual({ x: 880, y: 398 })

    const next = createMemoItemElement('second', second.x, second.y)
    const third = findMemoItemPlacement([first, next], { x: 500, y: 500 })
    expect(third).toEqual({ x: -560, y: 398 })
  })

  it('旧版默认卡片会升级为与首页一致的横向比例，手动缩放过的卡片保持原样', () => {
    const reference = createMemoItemElement('legacy', 100, 200)
    const legacy = {
      ...reference,
      width: 340,
      height: 220
    } as ExcalidrawElement
    const custom = {
      ...createMemoItemElement('custom', 500, 300),
      width: 420,
      height: 260
    } as ExcalidrawElement

    const normalized = normalizeMemoItemElements([legacy, custom])
    expect(normalized.changed).toBe(true)
    expect(normalized.elements[0]).toMatchObject({
      width: MEMO_ITEM_WIDTH,
      height: MEMO_ITEM_HEIGHT
    })
    expect(normalized.elements[1]).toMatchObject({ width: 420, height: 260 })
  })
})
