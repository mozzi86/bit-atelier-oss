// 100-05 (Argon review 18.10.2026): office catalogues seeded before 97-02a/97-07 keep demolition under
// STLB LB 040 (which is Wärmeversorgungsanlagen) and have no DIN 276 KG 212 (Abbruchmaßnahmen) — the new
// seed (packages/nova-core/server/catalog-seed.js) only reaches fresh installations, because seeding never
// overwrites existing catalogues (they are office data). This module finds the gap and lists the changes;
// the UI shows them and applies them only after a confirmation. Never silent.
//
// In:  the catalogue snapshot { StlbKatalog: [...], Din276Katalog: [...] }.
// Out: befund (what is outdated) and schritte (entity, create/update, data). Pure, no I/O.

/** The correct demolition trade (STLB-Bau). */
export const LB_ABBRUCH = Object.freeze({ lb: "084", name: "Abbruch- und Rückbauarbeiten" });
/** DIN 276:2018 Kostengruppe for demolition while preparing the site. */
export const KG_ABBRUCH = Object.freeze({ fassung: "2018", code: "212", name: "Abbruchmaßnahmen", ebene: 3, gruppe: "200", obergruppe: "210" });

const bueroweit = (/** @type {any} */ r) => r && !r.projekt_override_id;

/**
 * What is outdated in the office-wide catalogues.
 * @param {Record<string, any[]>} kataloge catalogue snapshot (/api/catalogs)
 * @returns {{alt040: any[], fehlt084: boolean, fehlt212: boolean, faellig: boolean}}
 *   alt040 = office rows "Abbruch/Rückbau" under LB 040; fehlt084/fehlt212 only when the catalogue exists at all
 */
export function katalogUpdateBefund(kataloge) {
  const stlb = Array.isArray(kataloge?.StlbKatalog) ? kataloge.StlbKatalog : [];
  const din = Array.isArray(kataloge?.Din276Katalog) ? kataloge.Din276Katalog : [];
  const alt040 = stlb.filter((r) => bueroweit(r) && String(r.lb) === "040" && /abbruch|rückbau|rueckbau/i.test(String(r.name || "")));
  const fehlt084 = stlb.length > 0 && !stlb.some((r) => bueroweit(r) && String(r.lb) === LB_ABBRUCH.lb);
  const fehlt212 = din.length > 0 && !din.some((r) => String(r.code) === KG_ABBRUCH.code && String(r.fassung ?? "2018") === "2018");
  return { alt040, fehlt084, fehlt212, faellig: alt040.length > 0 || fehlt084 || fehlt212 };
}

/**
 * The changes that bring the catalogues up to date. An "Abbruch" row under LB 040 is moved to LB 084
 * (an update of the same record — the office's own text, unit etc. stay); only when no such row exists
 * and LB 084 is missing a new row is created. When LB 084 already exists, a stale 040 row is reported
 * but not touched (the office decides; deleting is never automatic).
 * @param {ReturnType<typeof katalogUpdateBefund>} befund
 * @returns {Array<{entity: string, art: 'update'|'create', id?: string, daten: Record<string, any>, text: string}>}
 */
export function katalogUpdateSchritte(befund) {
  /** @type {Array<{entity: string, art: 'update'|'create', id?: string, daten: Record<string, any>, text: string}>} */
  const schritte = [];
  if (befund.fehlt084 && befund.alt040.length > 0) {
    const [erste] = befund.alt040;
    schritte.push({ entity: "StlbKatalog", art: "update", id: erste.id, daten: { ...erste, lb: LB_ABBRUCH.lb, name: LB_ABBRUCH.name }, text: `LB 040 „${erste.name}“ → LB 084` });
  } else if (befund.fehlt084) {
    schritte.push({ entity: "StlbKatalog", art: "create", daten: { scope: "buero", projekt_override_id: null, ...LB_ABBRUCH }, text: "LB 084 Abbruch- und Rückbauarbeiten ergänzen" });
  }
  if (befund.fehlt212) {
    schritte.push({ entity: "Din276Katalog", art: "create", daten: { scope: "buero", projekt_override_id: null, ...KG_ABBRUCH }, text: "KG 212 Abbruchmaßnahmen (DIN 276:2018) ergänzen" });
  }
  return schritte;
}
