import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { chinaToday, plannedDateLabel, plannedState } from '../china-date'
import { itemAgeLabel } from '../item-age'
import type { BulkItemChanges, Category, ImageAsset, LibraryItem } from '../types'
import { AppIcon } from './AppIcon'
import { PosterArtwork, cleanPosterTitle } from './PosterArtwork'

/** Continuous showcase speed in cards/second (~3.57s per album cover). */
const PLAY_CARDS_PER_SEC = 0.28
/** Natural frequency ω₀ (rad/s) for critically-damped spring (~480ms silky settle, zero overshoot). */
const SPRING_OMEGA = 16.5
/** Dwell pause (ms) before resuming continuous play after manual nudge/drag while playing. */
const PLAY_RESUME_DWELL_MS = 420
const DRAG_ACTIVATE_PX = 6
const WHEEL_STEP_THRESHOLD = 46

export interface CoverFlowViewProps {
  items: LibraryItem[]
  categories: Category[]
  generatingIds: Set<string>
  aiCoverConfigured: boolean
  onPatch: (item: LibraryItem, changes: BulkItemChanges, label: string) => Promise<boolean>
  onEdit: (item: LibraryItem) => void
  onDelete: (item: LibraryItem) => Promise<boolean>
  onGenerateCover: (item: LibraryItem) => Promise<void>
  onPreview: (assets: ImageAsset[], index: number) => void
  onOpenAiSettings: () => void
  now: number
  customActions?: (item: LibraryItem) => ReactNode
  compact?: boolean
  activeItemId?: string
  onActiveItemChange?: (item: LibraryItem, index: number) => void
}

type MotionMode = 'idle' | 'playing' | 'spring' | 'dragging'

interface PhysicsState {
  mode: MotionMode
  pos: number
  vel: number
  target: number
  lastTime: number
  resumePlayAt: number
  rafId: number | null
}

interface DragSample {
  x: number
  t: number
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  startPos: number
  dragging: boolean
  samples: DragSample[]
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function hasBlockingOverlay(rootEl: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false
  const overlays = document.querySelectorAll('[role="dialog"], [role="menu"]')
  for (const overlay of overlays) {
    if (!rootEl || !overlay.contains(rootEl)) return true
  }
  return false
}

function manualAssets(item: LibraryItem): ImageAsset[] {
  return item.assets.filter((asset) => asset.role !== 'web_cover')
}

function itemCover(item: LibraryItem): ImageAsset | null {
  const webCover = item.assets.find((asset) => asset.role === 'web_cover')
  if (webCover) return webCover
  return manualAssets(item)[0] || null
}

function itemDomain(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

function kindText(item: LibraryItem): string {
  if (item.kind === 'link') return '网页'
  if (item.kind === 'text') return '文本'
  return '图片'
}

function itemSubtitle(item: LibraryItem, manualCount: number): string {
  const domain = itemDomain(item.url)
  if (domain) return domain
  if (item.kind === 'image_group') {
    return manualCount > 0 ? `${manualCount} 张图片 · 画廊收藏` : '图片收藏'
  }
  if (item.kind === 'text') return '文字备忘 · 随手记'
  return '网页收藏'
}

function baseStepPx(cardWidth: number, stageWidth: number, compact: boolean): number {
  if (cardWidth > 0) {
    // Proportional to CSS --cf-card-w across desktop (288), compact (260), tablet (240), mobile (198)
    const desired = cardWidth * 0.94
    const maxByStage = Math.max(cardWidth * 0.76, stageWidth * 0.34)
    return Math.min(desired, maxByStage)
  }
  const maxStep = compact ? 248 : 272
  const minStep = compact ? 148 : 154
  return Math.min(maxStep, Math.max(minStep, stageWidth * 0.275 + 20))
}

function computeCardVisuals(delta: number, cardWidth: number, stageWidth: number, compact: boolean) {
  const abs = Math.abs(delta)
  const step = baseStepPx(cardWidth, stageWidth, compact)
  // Smooth C∞ odd compression curve: 1:1 spacing near center, gracefully fanning at ±2, ±3
  const x = (delta * step) / Math.pow(1 + 0.088 * delta * delta, 0.42)
  // Subtle pedestal arc: center cover sits elevated at y=0, outer covers dip gently
  const y = (compact ? 7 : 10) * (1 - Math.exp(-0.46 * delta * delta))
  // Bell-curve scale with zero derivative kink at delta=0
  const scale = 0.64 + 0.36 * Math.exp(-0.52 * delta * delta)
  // Architectural inward 3D Cover Flow pivot (0deg at center, ~±14deg at ±1, ~±21deg at ±2)
  const rotateY = -23.5 * Math.tanh(delta * 0.68)
  // Smooth cosine falloff reaching 0.00 before ±3.42 so edge slot mount/unmount is 100% invisible
  const fadeRadius = stageWidth <= 620 ? 2.45 : 3.42
  const norm = Math.min(1, abs / fadeRadius)
  const opacity = Math.pow(Math.cos(norm * Math.PI * 0.5), 1.32)
  // Smooth side-cover shade (0 at center, ~0.42 on wings) for .coverflow-card::after
  const shade = 0.44 * (1 - Math.exp(-0.75 * delta * delta))
  // Keep z-index strictly < 20 so .coverflow-float-card (z-index: 20) always floats above 3D track
  const zIndex = Math.max(1, Math.min(18, Math.round(16 - abs * 3.8)))

  return { x, y, scale, rotateY, opacity, shade, zIndex }
}

function visibleSlots(centerSlot: number, count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [centerSlot]
  return [
    centerSlot - 3,
    centerSlot - 2,
    centerSlot - 1,
    centerSlot,
    centerSlot + 1,
    centerSlot + 2,
    centerSlot + 3
  ]
}

export function CoverFlowView({
  items,
  categories,
  generatingIds,
  aiCoverConfigured,
  onPatch,
  onEdit,
  onDelete,
  onGenerateCover,
  onPreview,
  onOpenAiSettings,
  now,
  customActions,
  compact = false,
  activeItemId,
  onActiveItemChange
}: CoverFlowViewProps) {
  const initialIndex = useMemo(() => {
    if (!items.length || !activeItemId) return 0
    const found = items.findIndex((entry) => entry.id === activeItemId)
    return found >= 0 ? found : 0
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [centerSlot, setCenterSlot] = useState<number>(initialIndex)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [isDraggingState, setIsDraggingState] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)

  const rootRef = useRef<HTMLElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const floatBodyRef = useRef<HTMLDivElement | null>(null)
  const slotElsRef = useRef<Map<number, HTMLButtonElement>>(new Map())

  const stageWidthRef = useRef<number>(typeof window !== 'undefined' ? Math.min(window.innerWidth, 1040) : 960)
  const cardWidthRef = useRef<number>(compact ? 260 : 288)
  const centerSlotRef = useRef<number>(initialIndex)
  const isPlayingRef = useRef<boolean>(false)
  const itemsRef = useRef<LibraryItem[]>(items)
  itemsRef.current = items

  const onActiveItemChangeRef = useRef(onActiveItemChange)
  onActiveItemChangeRef.current = onActiveItemChange

  const physicsRef = useRef<PhysicsState>({
    mode: 'idle',
    pos: initialIndex,
    vel: 0,
    target: initialIndex,
    lastTime: 0,
    resumePlayAt: 0,
    rafId: null
  })

  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef<boolean>(false)
  const wheelAccumRef = useRef<number>(0)
  const wheelResetTimerRef = useRef<number | null>(null)
  const prevActiveIdRef = useRef<string>(items[initialIndex]?.id || '')
  const prevLengthRef = useRef<number>(items.length)

  const categoryMap = useMemo(() => new Map(categories.map((cat) => [cat.id, cat])), [categories])

  const activeIndex = items.length > 0 ? wrapIndex(centerSlot, items.length) : 0
  const activeItem = items[activeIndex] || null

  const applyTrackStyles = useCallback(() => {
    const count = itemsRef.current.length
    const pos = physicsRef.current.pos
    const width = stageWidthRef.current
    const cardW = cardWidthRef.current
    for (const [slotIndex, el] of slotElsRef.current.entries()) {
      const delta = count <= 1 ? 0 : slotIndex - pos
      const { x, y, scale, rotateY, opacity, shade, zIndex } = computeCardVisuals(delta, cardW, width, compact)
      el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)}) rotateY(${rotateY.toFixed(2)}deg)`
      el.style.opacity = opacity.toFixed(3)
      el.style.zIndex = String(zIndex)
      el.style.setProperty('--cf-shade', shade.toFixed(3))
      el.style.pointerEvents = opacity < 0.04 ? 'none' : 'auto'
      el.classList.toggle('is-center', Math.abs(delta) < 0.36)
    }
  }, [compact])

  const syncCenterSlotFromPos = useCallback((pos: number) => {
    const list = itemsRef.current
    if (!list.length) return
    const nextSlot = Math.round(pos)
    if (nextSlot !== centerSlotRef.current) {
      centerSlotRef.current = nextSlot
      setCenterSlot(nextSlot)
      const idx = wrapIndex(nextSlot, list.length)
      const nextItem = list[idx]
      if (nextItem) {
        prevActiveIdRef.current = nextItem.id
        onActiveItemChangeRef.current?.(nextItem, idx)
      }
    }
  }, [])

  const stopLoop = useCallback(() => {
    const phys = physicsRef.current
    if (phys.rafId !== null) {
      window.cancelAnimationFrame(phys.rafId)
      phys.rafId = null
    }
    phys.lastTime = 0
  }, [])

  const tickRef = useRef<(timestamp: number) => void>(() => {})

  tickRef.current = (timestamp: number) => {
    const phys = physicsRef.current
    phys.rafId = null

    const count = itemsRef.current.length
    if (count <= 1) {
      phys.mode = 'idle'
      phys.vel = 0
      phys.lastTime = 0
      applyTrackStyles()
      return
    }

    const rawDt = phys.lastTime > 0 ? (timestamp - phys.lastTime) / 1000 : 1 / 60
    phys.lastTime = timestamp
    // Clamp dt so tab switches never cause large jumps
    const dt = Math.min(0.064, Math.max(0.001, rawDt))

    if (phys.mode === 'playing') {
      if (document.visibilityState !== 'visible' || hasBlockingOverlay(rootRef.current)) {
        phys.vel = 0
      } else if (timestamp < phys.resumePlayAt) {
        phys.vel *= Math.exp(-10 * dt)
      } else {
        const targetVel = prefersReducedMotion() ? 0.18 : PLAY_CARDS_PER_SEC
        phys.vel += (targetVel - phys.vel) * (1 - Math.exp(-6.5 * dt))
        phys.pos += phys.vel * dt
        phys.target = Math.round(phys.pos)
      }
      syncCenterSlotFromPos(phys.pos)
      applyTrackStyles()
      phys.rafId = window.requestAnimationFrame(tickRef.current)
      return
    }

    if (phys.mode === 'spring') {
      if (prefersReducedMotion()) {
        phys.pos = phys.target
        phys.vel = 0
      } else {
        // Exact closed-form analytical solution for critically-damped harmonic oscillator:
        // d'' + 2*w*d' + w^2*d = 0
        const d0 = phys.pos - phys.target
        const v0 = phys.vel
        const w = SPRING_OMEGA
        const expTerm = Math.exp(-w * dt)
        const c2 = v0 + w * d0
        const nextD = (d0 + c2 * dt) * expTerm
        const nextV = (v0 - w * c2 * dt) * expTerm
        phys.pos = phys.target + nextD
        phys.vel = nextV
      }

      const settled = Math.abs(phys.pos - phys.target) < 0.0012 && Math.abs(phys.vel) < 0.015
      if (settled) {
        phys.pos = phys.target
        phys.vel = 0
        syncCenterSlotFromPos(phys.pos)
        applyTrackStyles()
        if (isPlayingRef.current) {
          phys.mode = 'playing'
          phys.resumePlayAt = timestamp + PLAY_RESUME_DWELL_MS
          phys.rafId = window.requestAnimationFrame(tickRef.current)
        } else {
          phys.mode = 'idle'
          phys.lastTime = 0
        }
        return
      }

      syncCenterSlotFromPos(phys.pos)
      applyTrackStyles()
      phys.rafId = window.requestAnimationFrame(tickRef.current)
      return
    }

    if (phys.mode === 'dragging') {
      syncCenterSlotFromPos(phys.pos)
      applyTrackStyles()
    }
  }

  const ensureLoop = useCallback(() => {
    const phys = physicsRef.current
    if (phys.rafId === null) {
      phys.lastTime = 0
      phys.rafId = window.requestAnimationFrame((ts) => tickRef.current(ts))
    }
  }, [])

  const springToSlot = useCallback((targetSlot: number, initialVel?: number) => {
    const count = itemsRef.current.length
    if (count <= 1) return
    const phys = physicsRef.current
    phys.target = targetSlot
    if (typeof initialVel === 'number') {
      phys.vel = initialVel
    }
    phys.mode = 'spring'
    syncCenterSlotFromPos(phys.pos)
    ensureLoop()
  }, [ensureLoop, syncCenterSlotFromPos])

  const stepBy = useCallback((deltaSlots: number) => {
    const count = itemsRef.current.length
    if (count <= 1) return
    const phys = physicsRef.current
    const base = phys.mode === 'spring' ? phys.target : Math.round(phys.pos)
    springToSlot(base + deltaSlots)
  }, [springToSlot])

  const togglePlay = useCallback(() => {
    const count = itemsRef.current.length
    if (count <= 1) return
    const phys = physicsRef.current
    if (isPlayingRef.current) {
      isPlayingRef.current = false
      setIsPlaying(false)
      // Smoothly decelerate using current velocity and spring cleanly onto nearest integer cover
      const nearest = Math.round(phys.pos + phys.vel * 0.18)
      springToSlot(nearest, phys.vel)
    } else {
      isPlayingRef.current = true
      setIsPlaying(true)
      phys.mode = 'playing'
      phys.resumePlayAt = 0
      ensureLoop()
    }
  }, [ensureLoop, springToSlot])

  useEffect(() => stopLoop, [stopLoop])

  // Observe track width & CSS --cf-card-w so spacing adapts seamlessly across resize & sidebar collapse
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const updateDimensions = () => {
      const next = el.clientWidth
      if (rootRef.current) {
        const rawCardW = parseFloat(window.getComputedStyle(rootRef.current).getPropertyValue('--cf-card-w'))
        if (Number.isFinite(rawCardW) && rawCardW > 0) {
          cardWidthRef.current = rawCardW
        }
      }
      if (next > 0) {
        stageWidthRef.current = next
      }
      applyTrackStyles()
    }
    updateDimensions()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateDimensions)
    observer.observe(el)
    return () => observer.disconnect()
  }, [applyTrackStyles, compact, items.length])

  // Apply GPU transforms synchronously before paint whenever visible slot window updates
  useLayoutEffect(() => {
    applyTrackStyles()
  }, [applyTrackStyles, centerSlot, items])

  // Subtle crossfade/slide-in on floating card content when activeItem changes
  useLayoutEffect(() => {
    const el = floatBodyRef.current
    if (!el || !activeItem || prefersReducedMotion()) return
    if (typeof el.animate !== 'function') return
    const computed = window.getComputedStyle(el)
    if (computed.animationName && computed.animationName !== 'none') return
    const anim = el.animate(
      [
        { opacity: 0.28, transform: 'translate3d(0, 5px, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ],
      { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    )
    return () => anim.cancel()
  }, [activeItem?.id])

  // Reconcile virtual position cleanly when items array changes (filter/delete/sort)
  useEffect(() => {
    const phys = physicsRef.current
    const prevLength = prevLengthRef.current
    prevLengthRef.current = items.length

    if (!items.length) {
      isPlayingRef.current = false
      setIsPlaying(false)
      stopLoop()
      phys.mode = 'idle'
      phys.pos = 0
      phys.vel = 0
      phys.target = 0
      centerSlotRef.current = 0
      setCenterSlot(0)
      prevActiveIdRef.current = ''
      return
    }

    if (items.length === 1) {
      if (isPlayingRef.current) {
        isPlayingRef.current = false
        setIsPlaying(false)
      }
      stopLoop()
      phys.mode = 'idle'
      phys.pos = 0
      phys.vel = 0
      phys.target = 0
      centerSlotRef.current = 0
      setCenterSlot(0)
      prevActiveIdRef.current = items[0].id
      applyTrackStyles()
      return
    }

    const currentCenterIdx = wrapIndex(centerSlotRef.current, items.length)
    const currentMapped = items[currentCenterIdx]
    const prevId = prevActiveIdRef.current

    if (prevId && currentMapped?.id !== prevId) {
      const foundIdx = items.findIndex((entry) => entry.id === prevId)
      if (foundIdx >= 0) {
        let diff = foundIdx - currentCenterIdx
        if (diff > items.length / 2) diff -= items.length
        if (diff < -items.length / 2) diff += items.length
        const adjustedSlot = centerSlotRef.current + diff
        phys.pos += diff
        phys.target += diff
        centerSlotRef.current = adjustedSlot
        setCenterSlot(adjustedSlot)
        applyTrackStyles()
      } else {
        // Active item was deleted or filtered out: smoothly glide replacement cover into spotlight
        const nextEntry = items[currentCenterIdx]
        if (nextEntry) {
          prevActiveIdRef.current = nextEntry.id
          onActiveItemChangeRef.current?.(nextEntry, currentCenterIdx)
          if (prevLength - items.length === 1 && !prefersReducedMotion()) {
            phys.pos = centerSlotRef.current + 0.28
            springToSlot(centerSlotRef.current, 0)
          } else {
            applyTrackStyles()
          }
        }
      }
    }
  }, [applyTrackStyles, items, springToSlot, stopLoop])

  // Sync smoothly when controlled activeItemId prop changes from parent (e.g. FocusMode shortcuts)
  useEffect(() => {
    if (!activeItemId || items.length <= 1) return
    const currentIdx = wrapIndex(centerSlotRef.current, items.length)
    if (items[currentIdx]?.id === activeItemId) return
    const targetIdx = items.findIndex((entry) => entry.id === activeItemId)
    if (targetIdx < 0) return

    let diff = targetIdx - currentIdx
    if (diff > items.length / 2) diff -= items.length
    if (diff < -items.length / 2) diff += items.length
    if (items.length === 2 && diff === -1) diff = 1
    if (diff !== 0) {
      prevActiveIdRef.current = activeItemId
      springToSlot(centerSlotRef.current + diff)
    }
  }, [activeItemId, items, springToSlot])

  // Keyboard ArrowLeft / ArrowRight navigation
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      if (hasBlockingOverlay(rootRef.current)) return
      if (itemsRef.current.length <= 1) return
      event.preventDefault()
      stepBy(event.key === 'ArrowLeft' ? -1 : 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [stepBy])

  // Horizontal trackpad wheel / Shift+Wheel support
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    function onWheel(event: WheelEvent) {
      if (itemsRef.current.length <= 1) return
      if (hasBlockingOverlay(rootRef.current)) return
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.08
        ? event.deltaX
        : event.shiftKey
          ? event.deltaY
          : 0
      if (Math.abs(horizontal) < 2) return
      event.preventDefault()

      wheelAccumRef.current += horizontal
      if (wheelResetTimerRef.current !== null) {
        window.clearTimeout(wheelResetTimerRef.current)
      }
      wheelResetTimerRef.current = window.setTimeout(() => {
        wheelAccumRef.current = 0
        wheelResetTimerRef.current = null
      }, 180)

      while (Math.abs(wheelAccumRef.current) >= WHEEL_STEP_THRESHOLD) {
        const dir = wheelAccumRef.current > 0 ? 1 : -1
        wheelAccumRef.current -= dir * WHEEL_STEP_THRESHOLD
        stepBy(dir)
      }
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', onWheel)
      if (wheelResetTimerRef.current !== null) {
        window.clearTimeout(wheelResetTimerRef.current)
      }
    }
  }, [stepBy])

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (items.length <= 1) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('.coverflow-float-card')) return

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPos: physicsRef.current.pos,
      dragging: false,
      samples: [{ x: event.clientX, t: performance.now() }]
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY

    if (!drag.dragging) {
      if (Math.abs(dx) < DRAG_ACTIVATE_PX && Math.abs(dy) < DRAG_ACTIVATE_PX) return
      if (Math.abs(dy) > Math.abs(dx) * 1.1) {
        dragRef.current = null
        return
      }
      drag.dragging = true
      suppressClickRef.current = true
      setIsDraggingState(true)
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Ignore capture failure on synthetic pointers.
      }
      physicsRef.current.mode = 'dragging'
      physicsRef.current.vel = 0
      stopLoop()
    }

    const nowTs = performance.now()
    drag.samples.push({ x: event.clientX, t: nowTs })
    while (drag.samples.length > 6 && nowTs - drag.samples[0].t > 90) {
      drag.samples.shift()
    }

    const stepPx = baseStepPx(cardWidthRef.current, stageWidthRef.current, compact)
    physicsRef.current.pos = drag.startPos - dx / stepPx
    syncCenterSlotFromPos(physicsRef.current.pos)
    applyTrackStyles()
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null

    if (!drag.dragging) return
    setIsDraggingState(false)
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Ignore release errors.
    }

    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)

    const phys = physicsRef.current
    if (cancelled) {
      springToSlot(Math.round(phys.pos), 0)
      return
    }

    const stepPx = baseStepPx(cardWidthRef.current, stageWidthRef.current, compact)
    const nowTs = performance.now()
    const anchor = drag.samples[0]
    const elapsedSec = anchor ? Math.max(0.012, (nowTs - anchor.t) / 1000) : 0.016
    const vxPx = anchor && nowTs - anchor.t < 140 ? (event.clientX - anchor.x) / elapsedSec : 0
    const rawVelCards = -vxPx / stepPx
    const velCards = Math.max(-11, Math.min(11, rawVelCards))

    let targetSlot = Math.round(phys.pos + velCards * 0.2)
    const totalDx = event.clientX - drag.startX
    const startRounded = Math.round(drag.startPos)
    if (targetSlot === startRounded && Math.abs(totalDx) > 28 && Math.abs(velCards) > 0.7) {
      targetSlot = startRounded + (velCards > 0 ? 1 : -1)
    }

    springToSlot(targetSlot, velCards)
  }

  async function runPatch(item: LibraryItem, changes: BulkItemChanges, label: string) {
    if (busy) return
    setBusy(true)
    try {
      await onPatch(item, changes, label)
    } finally {
      setBusy(false)
    }
  }

  async function runDelete(item: LibraryItem) {
    if (busy) return
    setBusy(true)
    try {
      await onDelete(item)
    } finally {
      setBusy(false)
    }
  }

  function openItemPrimary(item: LibraryItem) {
    if (item.kind === 'link' && item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer')
      return
    }
    const manual = manualAssets(item)
    if (item.kind === 'image_group' && manual.length) {
      onPreview(manual, 0)
      return
    }
    const cover = itemCover(item)
    if (cover) {
      onPreview([cover], 0)
      return
    }
    onEdit(item)
  }

  if (!activeItem) {
    return (
      <div className="coverflow-empty">
        <AppIcon name="album" size={24} />
        <p>当前视图下没有可展示的条目</p>
      </div>
    )
  }

  const today = chinaToday()
  const slots = visibleSlots(centerSlot, items.length)
  const activeCategory = activeItem.category
    ? categoryMap.get(activeItem.category.id) || activeItem.category
    : null
  const activeManual = manualAssets(activeItem)
  const activeCover = itemCover(activeItem)
  const activeSubtitle = itemSubtitle(activeItem, activeManual.length)
  const displayTitle = cleanPosterTitle(activeItem.title)
  const activePlanState = plannedState(activeItem.plannedFor, today)
  const isGeneratingActive = generatingIds.has(activeItem.id)
  const primaryIsComplete = activeItem.kind === 'text'
    || (activeItem.kind === 'link' && !activeItem.url)
    || (activeItem.kind === 'image_group' && activeManual.length === 0)
  const counterDigits = Math.max(2, String(items.length).length)

  return (
    <section
      ref={rootRef}
      className={`coverflow-view${compact ? ' is-compact' : ''}${isPlaying ? ' is-playing' : ''}`}
      aria-label="专辑封面视图"
    >
      <div ref={stageRef} className={`coverflow-stage${isDraggingState ? ' is-dragging' : ''}`}>
        <div
          ref={trackRef}
          className="coverflow-track"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishPointerDrag(event, false)}
          onPointerCancel={(event) => finishPointerDrag(event, true)}
        >
          {slots.map((slotIndex) => {
            const index = wrapIndex(slotIndex, items.length)
            const entry = items[index]
            const cover = itemCover(entry)
            const cat = entry.category ? categoryMap.get(entry.category.id) || entry.category : null
            const entryWithCat = cat && cat !== entry.category ? { ...entry, category: cat } : entry
            const slotOffset = slotIndex - centerSlot
            const isCenterNominal = slotOffset === 0
            const isGenerating = generatingIds.has(entry.id)
            const stableKey = items.length >= 7 || items.length === 1
              ? entry.id
              : `${entry.id}@${slotIndex}`

            return (
              <button
                key={stableKey}
                ref={(node) => {
                  if (node) slotElsRef.current.set(slotIndex, node)
                  else slotElsRef.current.delete(slotIndex)
                }}
                type="button"
                className={`coverflow-card${isCenterNominal ? ' is-center' : ''}${cover ? ' has-image' : ' is-fallback'}`}
                data-slot={slotOffset}
                aria-label={isCenterNominal ? `当前条目：${entry.title}` : `切换到：${entry.title}`}
                aria-current={isCenterNominal ? 'true' : undefined}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    event.preventDefault()
                    return
                  }
                  const liveDelta = items.length <= 1 ? 0 : slotIndex - physicsRef.current.pos
                  if (!isPlayingRef.current && Math.abs(liveDelta) < 0.22) {
                    if (cover) {
                      const previewAssets = entry.kind === 'image_group' && manualAssets(entry).length
                        ? manualAssets(entry)
                        : [cover]
                      onPreview(previewAssets, 0)
                    } else {
                      openItemPrimary(entry)
                    }
                  } else {
                    springToSlot(slotIndex)
                  }
                }}
              >
                {cover ? (
                  <img
                    className="coverflow-poster-img"
                    src={cover.thumbUrl}
                    alt=""
                    loading={Math.abs(slotOffset) <= 1 ? 'eager' : 'lazy'}
                    draggable={false}
                  />
                ) : (
                  <PosterArtwork item={entryWithCat} index={index} variant="coverflow" />
                )}

                {isGenerating && (
                  <span className="coverflow-generating-badge" role="status">
                    <AppIcon name="sparkles" size={13} className="is-spinning" />
                    AI 绘制中…
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <article className={`coverflow-float-card${compact ? ' is-compact' : ''}`} aria-live="polite">
          <div key={activeItem.id} ref={floatBodyRef} className="coverflow-float-body">
            <div className="coverflow-float-meta">
              <span className="coverflow-float-cat">
                <span
                  className="cat-dot"
                  style={{ backgroundColor: activeCategory?.color || '#a3a3a3' }}
                  aria-hidden="true"
                />
                <span className="coverflow-float-cat-name">{activeCategory?.name || '未分类'}</span>
              </span>

              <span className="badge badge-muted">{kindText(activeItem)}</span>

              {activeItem.status === 'completed' && (
                <span className="badge badge-muted">已完成</span>
              )}
              {activePlanState === 'overdue' && (
                <span className="badge badge-danger">逾期</span>
              )}
              {activePlanState === 'today' && (
                <span className="badge badge-indigo">今天</span>
              )}
              {activePlanState === 'future' && activeItem.plannedFor && (
                <span className="badge badge-muted">{plannedDateLabel(activeItem.plannedFor, today)}</span>
              )}

              <span className="coverflow-float-age">{itemAgeLabel(activeItem, now)}</span>
            </div>

            <h2 className="coverflow-float-title" title={activeItem.title}>
              {activeItem.kind === 'link' && activeItem.url ? (
                <a
                  className="coverflow-float-title-link"
                  href={activeItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {displayTitle}
                </a>
              ) : (
                <span
                  role="button"
                  tabIndex={0}
                  className="coverflow-float-title-btn"
                  onClick={() => openItemPrimary(activeItem)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      openItemPrimary(activeItem)
                    }
                  }}
                >
                  {displayTitle}
                </span>
              )}
            </h2>

            <p className="coverflow-float-domain" title={activeItem.url || activeSubtitle}>
              {activeSubtitle}
            </p>
          </div>

          <div className={customActions ? 'coverflow-float-actions is-custom' : 'coverflow-float-actions'}>
            {customActions ? (
              customActions(activeItem)
            ) : (
              <>
                {activeItem.kind === 'link' && activeItem.url ? (
                  <a
                    className="btn btn-primary"
                    href={activeItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <AppIcon name="external" size={15} />
                    打开网页
                  </a>
                ) : activeItem.kind === 'image_group' && activeManual.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onPreview(activeManual, 0)}
                  >
                    <AppIcon name="image" size={15} />
                    查看原图
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void runPatch(
                      activeItem,
                      { status: activeItem.status === 'pending' ? 'completed' : 'pending' },
                      activeItem.status === 'pending' ? '已完成' : '已恢复待处理'
                    )}
                  >
                    <AppIcon name={activeItem.status === 'pending' ? 'check' : 'restore'} size={15} />
                    {activeItem.status === 'pending' ? '标记完成' : '恢复待处理'}
                  </button>
                )}

                <div className="coverflow-float-tools">
                  {!primaryIsComplete && (
                    <button
                      type="button"
                      className={`btn btn-subtle btn-icon${activeItem.status === 'completed' ? ' is-active' : ''}`}
                      disabled={busy}
                      aria-label={activeItem.status === 'pending' ? '标记完成' : '恢复待处理'}
                      title={activeItem.status === 'pending' ? '标记完成' : '恢复待处理'}
                      onClick={() => void runPatch(
                        activeItem,
                        { status: activeItem.status === 'pending' ? 'completed' : 'pending' },
                        activeItem.status === 'pending' ? '已完成' : '已恢复待处理'
                      )}
                    >
                      <AppIcon name={activeItem.status === 'pending' ? 'check' : 'restore'} size={16} />
                    </button>
                  )}

                  <button
                    type="button"
                    className={`btn btn-subtle btn-icon${activeItem.isStarred ? ' is-active' : ''}`}
                    disabled={busy}
                    aria-label={activeItem.isStarred ? '取消星标' : '加星标'}
                    title={activeItem.isStarred ? '取消星标' : '加星标'}
                    onClick={() => void runPatch(
                      activeItem,
                      { isStarred: !activeItem.isStarred },
                      activeItem.isStarred ? '已取消星标' : '已加星标'
                    )}
                  >
                    <AppIcon name={activeItem.isStarred ? 'starFilled' : 'star'} size={16} />
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm coverflow-ai-btn"
                    disabled={isGeneratingActive}
                    title={aiCoverConfigured ? (activeCover ? '用 AI 重新生成海报封面' : '用 AI 生成海报封面') : '前往配置生图 API'}
                    onClick={() => {
                      if (!aiCoverConfigured) {
                        onOpenAiSettings()
                        return
                      }
                      void onGenerateCover(activeItem)
                    }}
                  >
                    <AppIcon
                      name={isGeneratingActive ? 'sync' : 'sparkles'}
                      size={14}
                      className={isGeneratingActive ? 'is-spinning' : undefined}
                    />
                    {isGeneratingActive ? '生成中…' : activeCover ? '重绘封面' : '生成封面'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-subtle btn-icon"
                    disabled={busy}
                    aria-label="编辑条目"
                    title="编辑条目"
                    onClick={() => onEdit(activeItem)}
                  >
                    <AppIcon name="edit" size={16} />
                  </button>

                  <button
                    type="button"
                    className="btn btn-subtle btn-icon coverflow-delete-btn"
                    disabled={busy}
                    aria-label="移到回收站"
                    title="移到回收站"
                    onClick={() => void runDelete(activeItem)}
                  >
                    <AppIcon name="trash" size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </article>
      </div>

      <div className="coverflow-footer">
        <span className="coverflow-counter" aria-live="polite" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {String(activeIndex + 1).padStart(counterDigits, '0')} / {String(items.length).padStart(counterDigits, '0')}
        </span>

        <div className="coverflow-controls" role="group" aria-label="轮播控制">
          <button
            type="button"
            className="btn btn-icon coverflow-ctrl-btn"
            aria-label="上一张封面"
            disabled={items.length <= 1}
            onClick={() => stepBy(-1)}
          >
            <AppIcon name="chevronLeft" size={17} />
          </button>

          <button
            type="button"
            className={`btn btn-icon coverflow-ctrl-btn coverflow-play-btn${isPlaying ? ' is-active is-playing' : ''}`}
            aria-label={isPlaying ? '暂停平滑漫游' : '开始平滑漫游'}
            title={isPlaying ? '暂停并停靠到最近封面' : '平滑连续漫游展示'}
            aria-pressed={isPlaying}
            disabled={items.length <= 1}
            onClick={togglePlay}
          >
            <AppIcon name={isPlaying ? 'pause' : 'play'} size={15} />
          </button>

          <button
            type="button"
            className="btn btn-icon coverflow-ctrl-btn"
            aria-label="下一张封面"
            disabled={items.length <= 1}
            onClick={() => stepBy(1)}
          >
            <AppIcon name="chevronRight" size={17} />
          </button>
        </div>
      </div>
    </section>
  )
}
