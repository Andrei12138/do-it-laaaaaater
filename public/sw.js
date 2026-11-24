const CACHE_PREFIX = 'do-it-laaaaaater-shell-'
const CACHE_NAME = CACHE_PREFIX + '2026-11-24-figma-v9'
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/app-icon-180.png',
  '/icons/app-icon-192.png',
  '/icons/app-icon-512.png'
]

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  await cache.addAll(APP_SHELL)
  const response = await fetch('/')
  if (!response.ok) return
  await cache.put('/', response.clone())
  const html = await response.text()
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1])
  await Promise.allSettled([...new Set(assets)].map((asset) => cache.add(asset)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match('/')
        const networkPromise = fetch(request)
          .then((response) => {
            if (response.ok) cache.put('/', response.clone())
            return response
          })
          .catch(() => null)
        if (cached) {
          event.waitUntil(networkPromise)
          return cached
        }
        return (await networkPromise) || new Response('Offline', { status: 503 })
      })
    )
    return
  }

  const staticAsset = url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/excalidraw-assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  if (!staticAsset) return
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const contentType = response.headers.get('content-type') || ''
      if (response.ok && !contentType.includes('text/html')) {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
      }
      return response
    }))
  )
})
