import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ToastProvider } from './components/Toast'
import { AuthProvider } from './auth/AuthContext'
import { AuthGate } from './auth/AuthGate'
import './index.css'

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
      <ToastProvider>
        <AuthProvider>
          <AuthGate>
            <App />
          </AuthGate>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
