import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt'
import { ThemeNotificationHost } from './components/ThemeNotification'
import { registerPwa } from './pwa'
import { ThemeProvider } from './theme'
import 'animal-island-ui/style'
import './styles.css'
import './flat-2013.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <ThemeNotificationHost />
      <PwaUpdatePrompt />
      <App />
    </ThemeProvider>
  </StrictMode>
)

void registerPwa()
