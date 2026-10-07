// novaXlsx — Re-Export. Der XLSX-Schreiber liegt seit Plan 66-14 in @core
// (packages/nova-core/src/lib/novaXlsx.js), damit auch das Prüf-Suite-Paket @ifc ihn
// nutzen darf (Paketgrenzen: @ifc importiert nur @core). Dieser Pfad bleibt, damit
// kbWorkbook.js, DeckungsReport.jsx, die Tests und das Paritätsgate G14 unverändert
// über `@ava/lib/novaXlsx.js` laufen.
//
// In:  nichts. Out: alle benannten Exporte des Schreibers (createWorkbook, writeWorkbook, …).

export * from "@core/lib/novaXlsx.js";
