let waitingWorker: ServiceWorker | null = null
const listeners = new Set<() => void>()

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
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return
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
