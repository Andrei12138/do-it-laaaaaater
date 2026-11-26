const CACHE_PREFIX = 'do-it-laaaaaater-shell-'
const CACHE_NAME = CACHE_PREFIX + '2026-11-26-blog-v8'
const APP_SHELL = [
  '/manifest.webmanifest',
  '/icons/app-icon-180.png',
  '/icons/app-icon-192.png',
  '/icons/app-icon-512.png'
]
const NAVIGATE_TIMEOUT_MS = 3000

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

async function handleNavigate(request) {
  const cache = await caches.open(CACHE_NAME)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), NAVIGATE_TIMEOUT_MS)
  try {
    const response = await fetch(request, { signal: controller.signal })
    if (response.ok) {
      await cache.put('/', response.clone())
      return response
    }
    const cached = await cache.match('/')
    return cached || response
  } catch {
    const cached = await cache.match('/')
    return cached || new Response('Offline', { status: 503 })
  } finally {
    clearTimeout(timeoutId)
  }
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
    event.respondWith(handleNavigate(request))
    return
  }

  const staticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  if (!staticAsset) return

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        const cachedType = (cached.headers.get('content-type') || '').toLowerCase()
        if (!cachedType.includes('text/html')) return cached
      }
      return fetch(request).then((response) => {
        const contentType = (response.headers.get('content-type') || '').toLowerCase()
        if (contentType.includes('text/html')) {
          return Response.error()
        }
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    })
  )
})
