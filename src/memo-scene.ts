import type {
  ExcalidrawElement,
  ExcalidrawEmbeddableElement,
  ExcalidrawImageElement
} from '@excalidraw/excalidraw/element/types'
import type { AppState } from '@excalidraw/excalidraw/types'

const ITEM_LINK_PREFIX = 'https://do-it-laaaaaater.local/item/'
const APP_STATE_KEYS = [
  'scrollX',
  'scrollY',
  'zoom',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemFillStyle',
  'currentItemStrokeWidth',
  'currentItemStrokeStyle',
  'currentItemRoughness',
  'currentItemOpacity',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemTextAlign',
  'currentItemStartArrowhead',
  'currentItemEndArrowhead'
] as const

function randomInteger() {
  return Math.floor(Math.random() * 2_147_483_647)
}

export function memoItemId(element: Pick<ExcalidrawElement, 'type' | 'customData'>) {
  if (element.type !== 'embeddable') return null
  const value = element.customData?.itemId
  return typeof value === 'string' && value ? value : null
}

export function createMemoItemElement(itemId: string, x: number, y: number) {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    type: 'embeddable',
    x,
    y,
    width: 340,
    height: 220,
    angle: 0,
    strokeColor: '#1abc9c',
    backgroundColor: '#ffffff',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: now,
    link: ITEM_LINK_PREFIX + encodeURIComponent(itemId),
    locked: false,
    customData: {
      source: 'do-it-laaaaaater',
      itemId
    }
  } as unknown as ExcalidrawEmbeddableElement
}

export function findMemoItemElement(elements: readonly ExcalidrawElement[], itemId: string) {
  return elements.find((element) => !element.isDeleted && memoItemId(element) === itemId) || null
}

export function findMemoItemPlacement(
  elements: readonly ExcalidrawElement[],
  center: { x: number; y: number }
) {
  const width = 340
  const height = 220
  const gapX = 40
  const gapY = 40
  const existing = elements.filter((element) => !element.isDeleted && memoItemId(element))
  const columns = [0, 1, -1, 2, -2, 3, -3, 4, -4]
  const rows = [0, 1, -1, 2, -2, 3, -3, 4, -4]

  for (const row of rows) {
    for (const column of columns) {
      const candidate = {
        x: center.x - width / 2 + column * (width + gapX),
        y: center.y - height / 2 + row * (height + gapY)
      }
      const overlaps = existing.some((element) => (
        candidate.x < element.x + element.width + gapX &&
        candidate.x + width + gapX > element.x &&
        candidate.y < element.y + element.height + gapY &&
        candidate.y + height + gapY > element.y
      ))
      if (!overlaps) return candidate
    }
  }

  return {
    x: center.x - width / 2 + existing.length * gapX,
    y: center.y - height / 2 + existing.length * gapY
  }
}

export function removeMemoItemReference(elements: readonly ExcalidrawElement[], elementId: string) {
  return elements.map((element) => {
    if (element.id !== elementId || element.isDeleted) return element
    return {
      ...element,
      isDeleted: true,
      version: element.version + 1,
      versionNonce: randomInteger(),
      updated: Date.now()
    }
  })
}

export function activeMemoFileIds(elements: readonly ExcalidrawElement[]) {
  return [...new Set(elements.flatMap((element) => (
    element.type === 'image' && !element.isDeleted && (element as ExcalidrawImageElement).fileId
      ? [String((element as ExcalidrawImageElement).fileId)]
      : []
  )))]
}

export function persistedMemoAppState(appState: AppState | Record<string, unknown>) {
  const source = appState as unknown as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of APP_STATE_KEYS) {
    const value = source[key]
    if (value !== undefined) result[key] = value
  }
  return result
}
