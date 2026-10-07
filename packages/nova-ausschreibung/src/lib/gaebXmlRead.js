// GAEB DA XML (X8x) — Leser mit EIGENEM Tokenizer. Phase 33 / W5 (Plan 33-03).
//
// WARUM EIN EIGENER TOKENIZER: `DOMParser` ist in Node `undefined` (gemessen,
// Node v24.13.1 — Pitfall 11). Ein Leser, der ihn braucht, ist in `node --test`
// nicht lauffähig; damit wäre der Roundtrip-Nachweis „Bauen → Lesen → dieselben
// 497 Positionen" nicht automatisierbar. Er wäre also nie geprüft.
//
// WAS DER ALTE LESER FALSCH MACHTE (und was hier ersetzt wird):
//   * Ordnungszahl aus `Item@ID` — das ergab `I00101010010` statt `01010010`.
//     Richtig ist die `RNoPart`-KETTE: Bereich + Abschnitt + Position.
//   * DIN 276 aus einem Tag `CostGroup`, den es in GAEB nicht gibt ⇒ 0 von 497.
//     Richtig ist `CtlgAssign/CtlgCode`, getrennt je Fassung.
//   * Gewerk aus einem Tag `LotLabel`, den es nicht gibt ⇒ alles landete in
//     „Ohne Gewerk". Richtig ist `BoQ/BoQInfo/LblBoQ`.
//   * Langtext gar nicht gelesen. Richtig ist `DetailTxt>Text>span*`.
//
// SICHERHEIT (T-33-17, ASVS V5): keine Entity-Auflösung über die fünf
// XML-Standardentitäten hinaus, KEIN DTD/DOCTYPE (XXE), Größen- und
// Tiefenlimit. Mengen über `Number()` mit `null` statt 0 bei Unlesbarkeit —
// eine 0 wäre eine erfundene Menge.
//
// Isomorph: kein window, kein DOMParser, keine Aliase.

/** Obergrenzen. Ein X83 des Realprojekts ist ~200 kB; 32 MB ist reichlich. */
export const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_TIEFE = 64;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Nur die 5 Standardentitäten + numerische Referenzen. Keine benutzerdefinierten. */
export function entdecke(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (all, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X'
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, ent) ? ENTITIES[ent] : all;
  });
}

const lokal = (n) => (n.indexOf(':') < 0 ? n : n.slice(n.indexOf(':') + 1));

function attrs(s) {
  const out = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[lokal(m[1])] = entdecke(m[3] != null ? m[3] : m[4]);
  return out;
}

/**
 * Der Tokenizer. `cb({name, attrs, ende, selbst, text, pfad})`.
 * `pfad` ist der Stack der offenen Elementnamen — daraus liest der Parser die
 * Struktur, ohne einen Baum aufzubauen (ein X83 mit 500 Positionen soll auch im
 * Browser nicht in Objekten ertrinken).
 */
export function tokenize(xml, cb) {
  const s = String(xml ?? '');
  if (s.length > MAX_BYTES) throw new Error(`gaebXmlRead: Eingabe zu groß (${s.length} > ${MAX_BYTES})`);
  if (/<!DOCTYPE/i.test(s.slice(0, 8192))) {
    throw new Error('gaebXmlRead: DTD/DOCTYPE wird nicht verarbeitet (XXE-Schutz)');
  }
  const pfad = [];
  const texte = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i && texte.length) texte[texte.length - 1] += s.slice(i, lt);
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); i = e < 0 ? s.length : e + 3; continue; }
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt); i = e < 0 ? s.length : e + 2; continue; }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt);
      const inhalt = s.slice(lt + 9, e < 0 ? s.length : e);
      if (texte.length) texte[texte.length - 1] += inhalt;
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    const gt = s.indexOf('>', lt);
    if (gt < 0) throw new Error('gaebXmlRead: unabgeschlossenes Tag');
    const roh = s.slice(lt + 1, gt);
    i = gt + 1;
    if (roh.startsWith('/')) {
      const name = lokal(roh.slice(1).trim());
      const offen = pfad.pop();
      if (offen !== name) {
        throw new Error(`gaebXmlRead: Tag "${name}" schließt "${offen ?? '(nichts)'}" — nicht wohlgeformt`);
      }
      const text = texte.pop() ?? '';
      cb({ name, attrs: null, ende: true, selbst: false, text: entdecke(text), pfad });
      continue;
    }
    const selbst = roh.endsWith('/');
    const inhalt = selbst ? roh.slice(0, -1) : roh;
    const sp = inhalt.search(/\s/);
    const name = lokal(sp < 0 ? inhalt : inhalt.slice(0, sp));
    const a = sp < 0 ? {} : attrs(inhalt.slice(sp));
    if (!selbst) {
      pfad.push(name);
      if (pfad.length > MAX_TIEFE) throw new Error(`gaebXmlRead: Verschachtelung zu tief (> ${MAX_TIEFE})`);
      texte.push('');
    }
    cb({ name, attrs: a, ende: false, selbst, text: null, pfad });
  }
  if (pfad.length) throw new Error(`gaebXmlRead: ${pfad.length} Tag(s) nicht geschlossen (${pfad.join('>')})`);
}

/** Wohlgeformtheitsprüfung. Wirft bei Bruch, gibt sonst die Tagzahl zurück. */
export function pruefeWohlgeformt(xml) {
  let n = 0;
  tokenize(xml, (t) => { if (!t.ende) n += 1; });
  if (n === 0) throw new Error('gaebXmlRead: kein einziges Element gefunden');
  return n;
}

/** Menge tolerant lesen — `null` statt 0 bei Unlesbarkeit. */
export function menge(s) {
  if (s == null || String(s).trim() === '') return null;
  let t = String(s).trim().replace(/\s/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Einheiten-Normalisierung über den `EinheitenKatalog` (optional). */
export function normalisiereEinheit(u, einheitenKatalog = []) {
  const roh = String(u ?? '').trim();
  if (!roh) return '';
  const treffer = (einheitenKatalog || []).find(
    (e) => e?.gaeb === roh || e?.code === roh || e?.key === roh || e?.name === roh,
  );
  return treffer?.code ?? treffer?.key ?? roh;
}

/**
 * Ein GAEB-DA-XML (X83/X84/X81 …) lesen.
 *
 * @param {string} xml
 * @param {{einheitenKatalog?: Array}} opt
 * @returns {{positionen: Array<object>, gewerk: string|null, gewerk_nr: string|null,
 *            projekt: string|null, dp: string|null, version: string|null,
 *            titel: Array<{rno: string, lbl: string|null}>, warnungen: string[]}}
 */
export function readX83(xml, { einheitenKatalog = [] } = {}) {
  const positionen = [];
  const warnungen = [];
  let version = null;
  let dp = null;
  let gewerk = null;
  let gewerkNr = null;
  let projekt = null;

  // Gliederungs-Stack: je offenes BoQCtgy ein {rno, lbl}.
  const ctgy = [];
  const titelAlle = [];
  let item = null;         // aktuelle Position
  let inItem = 0;          // Tiefe innerhalb <Item>
  let ctlg = null;         // aktuelles <CtlgAssign>
  let inDetail = 0;        // Tiefe innerhalb <DetailTxt>
  let inOutline = 0;
  let inLblTx = 0;
  let lblSpans = [];
  let detailSpans = [];
  let outlineSpans = [];
  let ctgyOffenOhneLbl = null;

  tokenize(xml, (t) => {
    if (!t.ende) {
      switch (t.name) {
        case 'BoQCtgy': {
          const e = { rno: t.attrs?.RNoPart ?? '', lbl: null };
          ctgy.push(e);
          ctgyOffenOhneLbl = e;
          return;
        }
        case 'LblTx': inLblTx += 1; lblSpans = []; return;
        case 'Item':
          inItem += 1;
          item = {
            id: t.attrs?.ID ?? null,
            rno: t.attrs?.RNoPart ?? '',
            qty: null,
            unit: '',
            kg2018: null,
            kg2008: null,
            kurztext: '',
            langtext: '',
            // OZ aus der RNoPart-KETTE, nicht aus Item@ID.
            titel: ctgy.map((c) => c.lbl).filter((x) => x != null),
            titel_oz: ctgy.map((c) => c.rno),
          };
          return;
        case 'CtlgAssign': ctlg = { id: null, code: null }; return;
        case 'DetailTxt': inDetail += 1; detailSpans = []; return;
        case 'OutlineText': inOutline += 1; outlineSpans = []; return;
        default: return;
      }
    }
    // --- Endtags ---
    switch (t.name) {
      case 'Version': if (!version) version = t.text.trim(); return;
      case 'DP': dp = t.text.trim(); return;
      case 'NamePrj': if (!projekt) projekt = t.text.trim(); return;
      case 'LblBoQ': if (!gewerk) gewerk = t.text.trim(); return;
      case 'Name':
        // <Name> direkt in <BoQInfo> ist die Gewerksnummer.
        if (!gewerkNr && t.pfad[t.pfad.length - 1] === 'BoQInfo') gewerkNr = t.text.trim();
        return;
      case 'span': {
        const v = t.text;
        if (inDetail > 0) detailSpans.push(v);
        else if (inOutline > 0) outlineSpans.push(v);
        else if (inLblTx > 0) lblSpans.push(v);
        return;
      }
      case 'LblTx': {
        inLblTx -= 1;
        const lbl = lblSpans.join('\n').trim() || t.text.trim();
        if (ctgyOffenOhneLbl && ctgyOffenOhneLbl.lbl == null) ctgyOffenOhneLbl.lbl = lbl;
        ctgyOffenOhneLbl = null;
        return;
      }
      case 'OutlineText':
        inOutline -= 1;
        if (item) item.kurztext = outlineSpans.join('\n').trim() || item.kurztext;
        return;
      case 'DetailTxt':
        inDetail -= 1;
        if (item) item.langtext = detailSpans.join('\n');
        return;
      case 'Qty': if (item) item.qty = menge(t.text); return;
      case 'QU': if (item) item.unit = normalisiereEinheit(t.text, einheitenKatalog); return;
      case 'CtlgID': if (ctlg) ctlg.id = t.text.trim(); return;
      case 'CtlgCode': if (ctlg) ctlg.code = t.text.trim(); return;
      case 'CtlgAssign': {
        if (item && ctlg?.code) {
          // Die beiden Fassungen werden GETRENNT geführt und nie ineinander
          // gemappt — bei 352/353/354 bedeuten sie Verschiedenes.
          if (/2018/.test(ctlg.id || '')) item.kg2018 = ctlg.code;
          else if (/2008/.test(ctlg.id || '')) item.kg2008 = ctlg.code;
          else warnungen.push(`unbekannter Katalog "${ctlg.id}" (Code ${ctlg.code}) — nicht zugeordnet`);
        }
        ctlg = null;
        return;
      }
      case 'BoQCtgy': {
        const fertig = ctgy.pop();
        if (fertig) titelAlle.push({ rno: fertig.rno, lbl: fertig.lbl });
        return;
      }
      case 'Item': {
        inItem -= 1;
        if (item) {
          // ORDNUNGSZAHL = Verkettung der RNoPart-Kette. Das ist der Kern des
          // Fixes: `Item@ID` ist eine Dokument-ID, keine Ordnungszahl.
          const oz = [...item.titel_oz, item.rno].join('');
          positionen.push({
            oz,
            oz_kette: [...item.titel_oz, item.rno],
            item_id: item.id,
            title: item.kurztext || oz,
            description: item.kurztext || oz,
            short_text: item.kurztext,
            long_text: item.langtext,
            quantity: item.qty,
            unit: item.unit,
            // In einer Angebotsaufforderung gibt es keinen Preis — `null`, nicht 0.
            unit_price: null,
            trade: gewerk || '',
            trade_nr: gewerkNr || null,
            din276: item.kg2018,
            din276_2008: item.kg2008,
            titel_pfad: item.titel,
            titel_oz: item.titel_oz,
          });
          if (item.qty == null) warnungen.push(`Position ${oz}: Menge nicht lesbar — null statt 0`);
        }
        item = null;
        return;
      }
      default: return;
    }
  });

  // Gewerk/Gewerknummer nachziehen: sie stehen VOR den Items, aber `trade` wird
  // beim Item gesetzt — bei mehreren BoQ pro Datei kann das abweichen.
  for (const p of positionen) {
    if (!p.trade && gewerk) p.trade = gewerk;
    if (!p.trade_nr && gewerkNr) p.trade_nr = gewerkNr;
  }
  return { positionen, gewerk, gewerk_nr: gewerkNr, projekt, dp, version, titel: titelAlle, warnungen };
}
