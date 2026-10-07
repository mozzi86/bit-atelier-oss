// "New version available" bar for the online demo (Phase 65-04).
//
// A service worker that swaps itself in silently is worse than none: the tab
// keeps running old chunks while new ones arrive, and the failure shows up much
// later as something that makes no sense. So the new version waits and the user
// decides when to take it.
//
// In:  the registration from swRegistrierung.js.
// Out: a bar at the bottom edge with one button.

import React from 'react';
import { RefreshCw } from 'lucide-react';
import { registriereSw, uebernehmeUpdate } from './swRegistrierung';

export default function UpdateHinweis() {
  const [reg, setReg] = React.useState(null);
  const [offen, setOffen] = React.useState(false);

  React.useEffect(() => {
    let lebt = true;
    registriereSw(() => lebt && setOffen(true)).then((r) => {
      if (lebt) setReg(r);
    });
    return () => {
      lebt = false;
    };
  }, []);

  if (!offen) return null;

  return (
    <div
      role="status"
      data-testid="update-hinweis"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-xl"
    >
      <RefreshCw className="w-4 h-4 shrink-0 text-emerald-400" />
      <span>Neue Version verfügbar</span>
      <button
        type="button"
        onClick={() => uebernehmeUpdate(reg)}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium hover:bg-emerald-700 transition-colors"
      >
        Neu laden
      </button>
      <button
        type="button"
        onClick={() => setOffen(false)}
        className="text-xs text-slate-400 hover:text-white transition-colors"
      >
        Später
      </button>
    </div>
  );
}
