import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AdminSessionProvider } from './contexts/AdminSessionContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminSessionProvider>
      <App />
    </AdminSessionProvider>
  </StrictMode>,
)
