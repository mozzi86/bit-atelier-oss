// IFC-GlobalId ↔ UUID.
//
// Eine IFC-GlobalId ist eine 128-Bit-UUID, base64-artig auf 22 Zeichen komprimiert
// (buildingSMART-Alphabet, NICHT Standard-Base64). Fremdsysteme exportieren dieselbe
// Identität oft in der entpackten 36-Zeichen-Schreibweise.
//
// Befund 26.08.2026, der diese Datei nötig machte: Der BimSnapshot des Referenzprojekt führt
// `3_VBElciFeIeExQx_$ZOnK`, der ASR-Raumdatenblatt-Export desselben Gebäudes
// `fe7cb3af-9ac3-e84a-83bb-6bbfbf8d8c54`. Ohne Umrechnung sah es nach zwei
// verschiedenen Gebäuden aus (Schnittmenge 0) — mit Umrechnung passen 56 Räume.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/**
 * IFC-GlobalId (22 Zeichen) → UUID (36 Zeichen, kleingeschrieben mit Bindestrichen).
 * @param {string} guid
 * @returns {string|null} null, wenn die Eingabe keine gültige GlobalId ist.
 */
export function ifcGuidToUuid(guid) {
  const g = String(guid ?? "");
  if (g.length !== 22) return null;
  // BigInt, weil 128 Bit nicht in eine JS-Number passen (Number verliert ab 2^53).
  let n = 0n;
  for (const ch of g) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 64n + BigInt(i);
  }
  const hex = n.toString(16).padStart(32, "0");
  if (hex.length !== 32) return null; // Überlauf: mehr als 128 Bit → keine gültige GlobalId
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * UUID (36 Zeichen, Bindestriche optional) → IFC-GlobalId (22 Zeichen).
 * @param {string} uuid
 * @returns {string|null}
 */
export function uuidToIfcGuid(uuid) {
  const hex = String(uuid ?? "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  let n = BigInt(`0x${hex}`);
  const out = [];
  for (let i = 0; i < 22; i++) {
    out.push(ALPHABET[Number(n % 64n)]);
    n /= 64n;
  }
  return out.reverse().join("");
}

/**
 * Vergleichsschlüssel für eine Identität, egal in welcher Schreibweise sie vorliegt.
 * Immer die UUID-Form (kleingeschrieben) — oder der Rohwert, wenn nicht deutbar.
 * @param {string} id
 * @returns {string}
 */
export function guidKey(id) {
  const s = String(id ?? "").trim();
  return (ifcGuidToUuid(s) || s).toLowerCase();
}
