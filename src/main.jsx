import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import ThemeProvider from '@core/components/theme/ThemeProvider'
import { WurzelFehlergrenze } from '@core/components/ModulFehlergrenze'
import '@core/index.css'
import { registriereInstallPrompt } from '@/lib/settings/appInstall'
import { DATENQUELLE, SERVERLOS } from '@core/lib/umgebung'
import { inHuelle } from '@/client/huelle.js'
// 89-07: workshop zones are derived on load (one truth) — registers the designer's derivation.
import '@/lib/werkstattAbleitungAnmelden'
// 106-05: hands the AI harness (speech recognition, agent) to the speech field of the viewers.
// Loaded after start (dynamic import) so the harness client stays out of the entry chunk (size budget, 1.10.0);
// the speech field reads sprechDienst() only when the person presses the button, long after this has run.
import('@/lib/sprechDienstAnmelden.js')
import { installiereSitzungsKopf } from '@/lib/sitzungsKopf.js'

// 70-03: start gate of the desktop shell (profile, storage folder, takeover).
// Loaded ONLY in the serverless build and only inside the shell: behind the
// compile-time constant the dynamic import disappears from the office and cloud
// bundles, which must never carry the serverless data layer (see bitApi.js).
const ClientTor = SERVERLOS ? React.lazy(() => import('@/client/ClientTor.jsx')) : null

// 96-04: writes to the local API carry the session header (server/sitzungsSchutz.js). Only the
// Express build has that API; the serverless and cloud builds never reach it.
if (DATENQUELLE === 'express') installiereSitzungsKopf({ apiBasis: import.meta.env?.VITE_API_BASE_URL || '/api' })

// Catch the browser's install prompt before any page is loaded (Settings › System offers it).
registriereInstallPrompt()

// 70-07: last-resort boundary — a crash outside the routes (layout, providers)
// shows a bilingual reload page instead of a white screen.
ReactDOM.createRoot(document.getElementById('root')).render(
  <WurzelFehlergrenze>
    <ThemeProvider>
      {/* 70-03: in the desktop shell the profile and the storage folder come
          first — the app reads data on its first render. */}
      {ClientTor && inHuelle() ? (
        <React.Suspense fallback={null}>
          <ClientTor>
            <App />
          </ClientTor>
        </React.Suspense>
      ) : (
        <App />
      )}
    </ThemeProvider>
  </WurzelFehlergrenze>
)
