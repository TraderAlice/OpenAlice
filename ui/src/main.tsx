import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ToastProvider } from './components/Toast'
import { TooltipProvider } from './components/ui/tooltip'
import { AuthProvider } from './auth/AuthContext'
import { AuthGate } from './auth/AuthGate'
import { initializeBackendConnection } from './auth/backendConnection'
import { installBackendRequestObserver } from './auth/backendConnectivity'
import { installScrollbarVisibilityController } from './services/scrollbarVisibility'
import './index.css'
import './theme' // side-effect: resolve persisted mode + palette pair on <html>
import './i18n' // side-effect: init react-i18next + seed locale before first render

initializeBackendConnection()
installBackendRequestObserver()
installScrollbarVisibilityController()

if (import.meta.env.VITE_DEMO_MODE) {
  await (await import('./demo')).startWorker()
} else if (import.meta.env.DEV) {
  // Dev-only: expose window.__demoRecord for capturing real PTY transcripts.
  // See ui/src/demo/recorder/README.md.
  await import('./demo/recorder')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider delay={250} timeout={300}>
        <ToastProvider>
          <AuthProvider>
            <AuthGate>
              <App />
            </AuthGate>
          </AuthProvider>
        </ToastProvider>
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>,
)
