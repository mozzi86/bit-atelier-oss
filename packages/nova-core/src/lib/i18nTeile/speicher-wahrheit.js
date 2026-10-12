// Besitzer: 89-07 — nur diese Datei ändern.
//
// English dictionary part of the store-of-truth line in Settings → Data (speicherWahrheit.js,
// decision D-BW-05). The three texts are the WAHRHEITEN values, passed to t() by the caller.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Wahrheit dieser Fassung": "Source of truth of this edition",
  "Lokale Datei (server/db.json über den lokalen Server) — Open-Source-Fassung": "Local file (server/db.json through the local server) — open-source edition",
  "Speicher dieses Geräts (Browser/Tauri-Datei) — lokale Fassung ohne Server": "Storage of this device (browser/Tauri file) — local edition without a server",
  "Gehostete Büro-Fassung (Supabase), Last-Write-Wins je Fachlayer über updatedAt": "Hosted office edition (Supabase), last-write-wins per specialist layer via updatedAt",
};
