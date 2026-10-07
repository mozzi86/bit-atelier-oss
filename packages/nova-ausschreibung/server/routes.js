// nova-ausschreibung Server-Routen: TED-Preisrecherche-Proxy.
// Extrahiert 1:1 aus server/index.js (Phase 31). Pfade OHNE /api-Präfix.
import express from 'express';

// --- TED Search API v3 Proxy (Phase 28) --------------------------------------
// TED Search API v3 Proxy — kein Key, nur POST; Fehler/Offline → 200 { offline:true },
// nie 5xx. Ziel-URL hart kodiert (kein offener Relay), limit serverseitig ≤ 250.
export function pricesRouter() {
  const r = express.Router();

  r.post('/prices/ted-search', async (req, res) => {
    const limit = Math.min(Number(req.body?.limit) || 250, 250);
    // ME-07: Body auf erwartete Felder reduzieren — kein ungefiltertes Durchreichen.
    const { query, fields, page, scope } = req.body || {};
    const tedBody = {
      ...(typeof query === 'string' ? { query } : {}),
      ...(Array.isArray(fields) ? { fields } : {}),
      page: Math.max(1, Number(page) || 1),
      ...(typeof scope === 'string' ? { scope } : {}),
      limit,
    };
    try {
      const resp = await fetch('https://api.ted.europa.eu/v3/notices/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'BIT-Atelier/1.0 (lokales Planungstool)',
        },
        body: JSON.stringify(tedBody),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        // 405/400/429/504 landen hier — kein Throw, kein 5xx an den Client.
        res.json({ offline: true, status: resp.status });
        return;
      }
      res.json(await resp.json());
    } catch {
      res.json({ offline: true });
    }
  });

  return r;
}
