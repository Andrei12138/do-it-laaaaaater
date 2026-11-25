import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt'
import { ToastHost } from './components/Toast'
import { registerPwa } from './pwa'
import './styles.css'

const PRELOAD_RELOAD_KEY = 'do-it-laaaaaater.preload-reload'

window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem(PRELOAD_RELOAD_KEY)) return
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1')
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ToastHost />
    <PwaUpdatePrompt />
    <App />
  </StrictMode>
)

void registerPwa()
