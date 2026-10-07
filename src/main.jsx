import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import ThemeProvider from '@core/components/theme/ThemeProvider'
import { WurzelFehlergrenze } from '@core/components/ModulFehlergrenze'
import '@core/index.css'
import { registriereInstallPrompt } from '@/lib/settings/appInstall'

// Catch the browser's install prompt before any page is loaded (Settings › System offers it).
registriereInstallPrompt()

// 70-07: last-resort boundary — a crash outside the routes (layout, providers)
// shows a bilingual reload page instead of a white screen.
ReactDOM.createRoot(document.getElementById('root')).render(
  <WurzelFehlergrenze>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </WurzelFehlergrenze>
)
