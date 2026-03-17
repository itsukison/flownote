import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import './index.css'
import '@fontsource/geist-sans'
import RootRouter from './RootRouter'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <RootRouter />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#1a1a1e',
            color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            fontSize: '13px',
          },
        }}
      />
    </HashRouter>
  </StrictMode>,
)
