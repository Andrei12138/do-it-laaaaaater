import { useSyncExternalStore } from 'react'

let waitingWorker: ServiceWorker | null = null
const listeners = new Set<() => void>()

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export type PwaInstallMode = 'prompt' | 'ios-guide' | 'installed' | 'unavailable'

let installPrompt: InstallPromptEvent | null = null
const installListeners = new Set<() => void>()

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

function isIosLike() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function installMode(): PwaInstallMode {
  if (isStandalone()) return 'installed'
  if (installPrompt) return 'prompt'
  if (isIosLike()) return 'ios-guide'
  return 'unavailable'
}

function publishInstall() {
  installListeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event as InstallPromptEvent
    publishInstall()
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    publishInstall()
  })
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', publishInstall)
}

export function usePwaInstall() {
  return useSyncExternalStore(
    (listener) => {
      installListeners.add(listener)
      return () => installListeners.delete(listener)
    },
    installMode,
    () => 'unavailable' as PwaInstallMode
  )
}

export async function requestPwaInstall() {
  if (!installPrompt) return 'unavailable' as const
  const prompt = installPrompt
  await prompt.prompt()
  const choice = await prompt.userChoice
  if (choice.outcome === 'accepted') installPrompt = null
  publishInstall()
  return choice.outcome
}

function announce(worker: ServiceWorker) {
  waitingWorker = worker
  listeners.forEach((listener) => listener())
}

export function subscribePwaUpdate(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function hasPwaUpdate() {
  return Boolean(waitingWorker)
}

export function applyPwaUpdate() {
  if (!waitingWorker) return
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  waitingWorker.postMessage({ type: 'SKIP_WAITING' })
}

export async function registerPwa() {
  const loopback = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1'
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && !loopback)) return
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    if (registration.waiting && navigator.serviceWorker.controller) announce(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      if (!worker) return
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(worker)
      })
    })
  } catch {
    // The web app remains fully usable when installation is unavailable.
  }
}
