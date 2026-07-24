import type {
  ExcalidrawElement,
  ExcalidrawEmbeddableElement,
  ExcalidrawImageElement
} from '@excalidraw/excalidraw/element/types'
import type { AppState } from '@excalidraw/excalidraw/types'

const ITEM_LINK_PREFIX = 'https://do-it-laaaaaater.local/item/'
export const MEMO_ITEM_WIDTH = 680
export const MEMO_ITEM_HEIGHT = 204
const LEGACY_MEMO_ITEM_WIDTH = 340
const LEGACY_MEMO_ITEM_HEIGHT = 220
const MIN_MEMO_CONTENT_SCALE = 0.1
const MAX_MEMO_CONTENT_SCALE = 10
const CORNER_RESIZE_HANDLES = new Set(['nw', 'ne', 'sw', 'se'])
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

function clampMemoContentScale(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_MEMO_CONTENT_SCALE, Math.max(MIN_MEMO_CONTENT_SCALE, value))
}

export function memoItemId(element: Pick<ExcalidrawElement, 'type' | 'customData'>) {
  if (element.type !== 'embeddable') return null
  const value = element.customData?.itemId
  return typeof value === 'string' && value ? value : null
}

export function memoItemContentScale(
  element: Pick<ExcalidrawElement, 'width' | 'height' | 'customData'>
) {
  const stored = element.customData?.contentScale
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) {
    return clampMemoContentScale(stored)
  }
  return clampMemoContentScale(Math.min(
    Math.abs(element.width) / MEMO_ITEM_WIDTH,
    Math.abs(element.height) / MEMO_ITEM_HEIGHT
  ))
}

export function memoContentScaleAfterResize(
  handleType: string | false,
  initialScale: number,
  initialSize: { width: number; height: number },
  nextSize: { width: number; height: number }
) {
  const normalizedInitialScale = clampMemoContentScale(initialScale)
  if (!handleType || !CORNER_RESIZE_HANDLES.has(handleType)) return normalizedInitialScale
  const widthRatio = Math.abs(nextSize.width) / Math.max(1, Math.abs(initialSize.width))
  const heightRatio = Math.abs(nextSize.height) / Math.max(1, Math.abs(initialSize.height))
  const resizeFactor = Math.sqrt(Math.max(0.0001, widthRatio * heightRatio))
  return clampMemoContentScale(normalizedInitialScale * resizeFactor)
}

export function createMemoItemElement(itemId: string, x: number, y: number) {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    type: 'embeddable',
    x,
    y,
    width: MEMO_ITEM_WIDTH,
    height: MEMO_ITEM_HEIGHT,
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
      itemId,
      contentScale: 1
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
  const width = MEMO_ITEM_WIDTH
  const height = MEMO_ITEM_HEIGHT
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

export function normalizeMemoItemElements(elements: readonly ExcalidrawElement[]) {
  let changed = false
  const normalized = elements.map((element) => {
    if (element.isDeleted || !memoItemId(element)) return element
    const legacyDefaultSize =
      Math.abs(element.width - LEGACY_MEMO_ITEM_WIDTH) <= 0.01 &&
      Math.abs(element.height - LEGACY_MEMO_ITEM_HEIGHT) <= 0.01
    const storedScale = element.customData?.contentScale
    const contentScale = legacyDefaultSize ? 1 : memoItemContentScale(element)
    const needsContentScale =
      typeof storedScale !== 'number' ||
      !Number.isFinite(storedScale) ||
      storedScale <= 0 ||
      Math.abs(storedScale - contentScale) > 0.0001
    if (!legacyDefaultSize && !needsContentScale) return element
    changed = true
    return {
      ...element,
      ...(legacyDefaultSize
        ? {
            x: element.x - (MEMO_ITEM_WIDTH - element.width) / 2,
            y: element.y - (MEMO_ITEM_HEIGHT - element.height) / 2,
            width: MEMO_ITEM_WIDTH,
            height: MEMO_ITEM_HEIGHT
          }
        : {}),
      customData: {
        ...element.customData,
        contentScale
      },
      version: element.version + 1,
      versionNonce: randomInteger(),
      updated: Date.now()
    } as ExcalidrawElement
  })
  return { elements: normalized, changed }
}

export function updateMemoItemContentScale(
  elements: readonly ExcalidrawElement[],
  elementId: string,
  contentScale: number
) {
  const nextScale = clampMemoContentScale(contentScale)
  return elements.map((element) => {
    if (element.id !== elementId || element.isDeleted || !memoItemId(element)) return element
    if (Math.abs(memoItemContentScale(element) - nextScale) <= 0.0001) return element
    return {
      ...element,
      customData: {
        ...element.customData,
        contentScale: nextScale
      },
      version: element.version + 1,
      versionNonce: randomInteger(),
      updated: Date.now()
    } as ExcalidrawElement
  })
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
