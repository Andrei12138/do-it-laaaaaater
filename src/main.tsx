import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt'
import { ToastHost } from './components/Toast'
import { registerPwa } from './pwa'
import './styles.css'

(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ToastHost />
    <PwaUpdatePrompt />
    <App />
  </StrictMode>
)

void registerPwa()
