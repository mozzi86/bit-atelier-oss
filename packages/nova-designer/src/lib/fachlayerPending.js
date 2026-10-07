// Pure Entscheidungslogik des useFachlayer-Save-Pfads — eigenes, import-freies
// Modul, damit sie node-testbar bleibt (useFachlayer zieht transitiv bitApi,
// das nur unter Vite lädt).

// Nach erfolgreichem Save den Pending-Eintrag nur löschen, wenn er noch den
// GERADE GESPEICHERTEN Stand trägt: kam während des Save-Awaits eine neuere
// Eingabe (Effekt-Lauf hat pendingRef bereits überschrieben), muss sie für
// den Unmount-Flush erhalten bleiben — bedingungsloses Nullen verlor sie.
export const pendingNachSave = (pending, gespeicherteSig) =>
  (pending && pending.sig !== gespeicherteSig ? pending : null);
