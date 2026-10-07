# Third-Party-Lizenzen

BIT-Atelier selbst steht unter der MIT-Lizenz (`LICENSE`). Diese Datei dokumentiert
Open-Source-Komponenten mit Hinweispflichten oder nicht-permissiven Lizenzen, die mit
der Plattform an den Browser ausgeliefert werden. Permissiv lizenzierte Abhängigkeiten
(MIT/ISC/BSD/Apache-2.0) sind über `package.json` und npm nachvollziehbar und hier nicht
einzeln gelistet. Lizenzangaben laut `node_modules/<paket>/package.json` (Stand 06.10.2026).

## @mapbox/mapbox-gl-rtl-text — BSD-2-Clause

- **Version:** 0.3.x (npm) · Kopie der `dist/mapbox-gl-rtl-text.js` liegt unter
  `public/mapbox-gl-rtl-text.js` (Map-Worker lädt sie per importScripts —
  ein Vite-Modulimport würde sie im Dev-Server transformieren).
- **Was:** RTL-Text-Shaping (Arabisch/Hebräisch, ICU-Bidi) für MapLibre-Karten.
- **Lizenz:** BSD-2-Clause (permissiv) — Hinweis genügt.
  Quelle: https://github.com/mapbox/mapbox-gl-rtl-text

## @salusoft89/planegcs — LGPL-2.0-or-later

- **Version:** 1.2.0 (gepinnt)
- **Was:** 2D-Geometric-Constraint-Solver aus FreeCAD (PlaneGCS,
  © 2011 Konstantinos Poulios u. a.) als WebAssembly-Build mit
  TypeScript-Wrapper von Salusoft89 (Miroslav Šerý).
- **Lizenz:** laut `package.json` `LGPL-2.0-or-later`; die im Paket mitgelieferte
  Lizenzdatei ist der Text der GNU Lesser General Public License 2.1
  (`node_modules/@salusoft89/planegcs/LICENSE`, im Build als
  `LICENSES/planegcs-LGPL-2.1.txt` ausgeliefert) sowie
  https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
- **Quellcode:** https://github.com/Salusoft89/planegcs (Wrapper + Build) und
  https://github.com/FreeCAD/FreeCAD `src/Mod/Sketcher/App/planegcs` (C++-Kern).
  Zusätzlich lokal archiviert: `vendor/salusoft89-planegcs-1.2.0.tgz`
  (npm-Tarball der gepinnten Version inkl. TypeScript-Quellen des Wrappers).

**Compliance-Maßnahmen in diesem Repo** (Austauschbarkeit gemäß LGPL §6):

1. Die `.wasm`-Datei wird als separates Asset ausgeliefert (Vite `?url`-Import,
   kein Inlining) — funktionales Äquivalent zu Dynamic Linking.
2. Der LGPL-JS-Wrapper wird als eigener Chunk gebaut
   (`build.rollupOptions.output.manualChunks.planegcs` in `vite.config.js`)
   und zusätzlich nur lazy importiert (`packages/bit-sketch/src/lib/solver.js`) —
   er wird nie in den übrigen App-Code eingeschmolzen.
3. Das Paket wird unmodifiziert verwendet. Jede Modifikation (auch am
   TS-Wrapper) müsste als LGPL-Quellcode veröffentlicht werden (Fork).
4. Die Nutzungsbedingungen verbieten Reverse Engineering nicht (seit 83-02,
   Open Source unter MIT) — der von der LGPL verlangte Spielraum besteht.

## web-ifc — MPL-2.0

- **Version:** 0.0.77 (npm, `^0.0.77`)
- **Was:** IFC-Parser und Geometrie-Kern (WebAssembly) von That Open Company —
  Grundlage von BIM-Viewer, IFC-Viewer, Modellständen und Prüf-Suite.
- **Lizenz:** Mozilla Public License 2.0 (dateibezogenes Copyleft): Änderungen an
  den Dateien von web-ifc selbst müssten unter MPL-2.0 offengelegt werden; der
  übrige Code bleibt davon unberührt. Das Paket wird unmodifiziert verwendet und
  als eigener Chunk (`ifc`) bzw. eigene `.wasm`-Datei ausgeliefert.
  Volltext: `node_modules/web-ifc/LICENSE.md` sowie https://mozilla.org/MPL/2.0/
- **Quellcode:** https://github.com/ThatOpen/engine_web-ifc

## dompurify — MPL-2.0 OR Apache-2.0

- **Version:** 3.4.7 (npm, transitive Abhängigkeit)
- **Was:** HTML-Bereinigung (XSS-Schutz) für aus HTML erzeugte Inhalte.
- **Lizenz:** wahlweise Mozilla Public License 2.0 oder Apache License 2.0
  (`(MPL-2.0 OR Apache-2.0)`); unmodifiziert verwendet.
  Volltext: `node_modules/dompurify/LICENSE`
- **Quellcode:** https://github.com/cure53/DOMPurify

## @supabase/supabase-js — MIT

- **Version:** 2.x (npm, `^2.116.0`)
- **Was:** JavaScript-Client für Supabase (Auth, PostgREST, Storage) — die
  Datenschicht des Cloud-Wegs (Phase 57).
- **Lizenz:** MIT (permissiv). Quelle: https://github.com/supabase/supabase-js
- **Warum hier gelistet, obwohl MIT sonst über package.json nachvollziehbar
  ist:** der Plan 57-01 (Task 4) verlangt den ausdrücklichen Nachweis für die
  mit dem Browser ausgelieferte Datenschicht. Im `lokal`-Build ist das Paket
  per Tree-Shaking NICHT enthalten (57-02).
