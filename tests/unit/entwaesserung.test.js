// Unit-Tests für packages/nova-designer/src/lib/entwaesserung.js (Phase 63, ENTW-01/02/04/05).
//
// Kulisse: das Demo-Haus mit 10 × 8 m Grundfläche, zwei Geschossen, 20 Wohneinheiten im
// Beispielprojekt, ein Abwasser-Netz im EG mit zwei Grundleitungen (10 m DN100 ohne Override,
// 8 m DN100 mit Override 1 %) und einem Hausanschluss.
//
// Alle Erwartungswerte sind Handrechnungen nach 63-RESEARCH.md §4 — keine aus dem Code
// abgelesenen Zahlen:
//   schmutzwasser  ΣDU = 20 WE · 4 Objekte · 1,0 DU = 80 → Q_ww = 0,5 · √80 = 4,472 l/s
//                  → erste Tabellenzeile mit q_max ≥ 4,472 ist DN125 (6,5 l/s) bei ≥ 1,5 %
//   2 WE           ΣDU = 8 → 0,5 · √8 = 1,414 < DU_max 2,0 → auf 2,0 angehoben → DN100 bei 2,0 %
//   grundleitungen 10 m · 2,0 % = 0,200 m Gefälle · 8 m · 1,0 % = 0,080 m → Σ 0,280 m
//                  Frosttiefe 1,00 m → Endsohle −1,28 m ≥ Kanalsohle −2,50 m → in Ordnung
//                  mit Keller: −(3,0 + 0,3) = −3,30 m → Endsohle −3,58 m < −2,50 m → Warnung
//   abflusswirksam 200 m² Dach · 0,9 + 100 m² befestigt · 0,9 + 300 m² grün · 0,2 = 330 m²
//   ueberflutung   Zufluss = 300 · 1.000 / 10.000 = 30 l/s → (30 − 5) · 30 min · 60 / 1.000 = 45 m³
//   rueckhalt      Mulde 100 m² · 0,30 m³/m² = 30 m³ + Zisterne 20 m³ = 50 m³ ≥ 45 m³ → pass
//   notentwaesser. Q_Dach = 800 · 1.040 / 10.000 = 83,2 l/s − 4 Abläufe · 4,5 = 18,0 l/s
//                  → 65,2 l/s erforderlich; 5 Notüberläufe · 15 = 75 ≥ 65,2 → pass, 4 · 15 = 60 → warn

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ENTW_DEFAULT, RUECKSTAU_MASSNAHMEN, GRUNDLEITUNG_TABELLE, REGEN_ARTEN, REGEN_TYPEN,
  K_WOHNEN, DU_MITTEL, DU_MAX, FROSTTIEFE_M, SOHLE_UNTER_KELLER_M, ABLAUF_DN100_LS, NOTUEBERLAUF_LS,
  layerHardened, neuerDachpunkt, verschiebeDachpunkt, loescheDachpunkt,
  grundleitungZeile, schmutzwasser, grundleitungen, rueckstauCheck,
  abflusswirksam, ueberflutung, notentwaesserung, rueckhaltVolumen,
  entwaesserungChecks, entwaesserungMengen,
} from "@designer/lib/entwaesserung";

/** Rechteck als Flächen-Polygon (x/z in Metern). */
const rect = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

/** Abwasser-Netz des EG: zwei Grundleitungen + Hausanschluss. */
function netzBauen({ override = 1, dn = 100 } = {}) {
  return {
    version: 1,
    knoten: [
      { id: "n_1", gewerk: "abwasser", art: "anschluss", level: 0, x: 12, z: 0, name: "Hausanschluss" },
      { id: "n_2", gewerk: "abwasser", art: "auslass", level: 0, x: 0, z: 0 },
    ],
    kanten: [
      // 10 m, kein Override → Tabellenwert des DN
      { id: "k_1", gewerk: "abwasser", level: 0, dn, von: "n_2", nach: "n_1", points: [{ x: 0, z: 0 }, { x: 10, z: 0 }] },
      // 8 m, Override
      { id: "k_2", gewerk: "abwasser", level: 0, dn, von: "n_1", nach: null, gefaelle_pct: override, points: [{ x: 10, z: 0 }, { x: 10, z: 8 }] },
    ],
  };
}

describe("Konstanten und Layer", () => {
  it("die Kennwerte sind die der Norm bzw. die dokumentierten Annahmen", () => {
    assert.equal(K_WOHNEN, 0.5);          // DIN EN 12056-2 Tab. 3, Wohnen
    assert.equal(DU_MITTEL, 1.0);         // [ASSUMED] Mittelwert je Sanitärobjekt
    assert.equal(DU_MAX, 2.0);            // größter Einzel-DU (WC)
    assert.equal(FROSTTIEFE_M, 1.0);
    assert.equal(SOHLE_UNTER_KELLER_M, 0.3);
    assert.equal(ABLAUF_DN100_LS, 4.5);
    assert.equal(NOTUEBERLAUF_LS, 15);
    assert.deepEqual(Object.keys(RUECKSTAU_MASSNAHMEN), ["keine", "verschluss", "hebeanlage"]);
  });

  it("die Grundleitungstabelle steigt in DN und fällt im Mindestgefälle", () => {
    const dns = GRUNDLEITUNG_TABELLE.map((z) => z.dn);
    assert.deepEqual(dns, [100, 125, 150, 200]);
    for (let i = 1; i < GRUNDLEITUNG_TABELLE.length; i++) {
      assert.ok(GRUNDLEITUNG_TABELLE[i].qMax_ls > GRUNDLEITUNG_TABELLE[i - 1].qMax_ls);
      assert.ok(GRUNDLEITUNG_TABELLE[i].gefaelleMin_pct <= GRUNDLEITUNG_TABELLE[i - 1].gefaelleMin_pct);
    }
  });

  it("layerHardened ergänzt fehlende Felder und lässt Vorhandenes stehen", () => {
    const l = layerHardened({ rueckstau: { ebene_m: 0.15 } });
    assert.equal(l.rueckstau.ebene_m, 0.15);
    assert.equal(l.rueckstau.massnahme, "keine");
    assert.equal(l.rueckstau.kanalsohle_m, ENTW_DEFAULT.rueckstau.kanalsohle_m);
    assert.equal(l.regen.r5_100, 800);
    assert.deepEqual(l.dach.ablaeufe, []);
  });

  it("layerHardened wirft Unsinn weg statt ihn durchzulassen", () => {
    const l = layerHardened({
      rueckstau: { massnahme: "zauberei", ebene_m: "x", kanalsohle_m: null },
      regen: { r5_100: -50, dauer_min: 0, r30_100: null },
      dach: { gefaelle_pct: 0.1, dmin_m: 0, ablaeufe: [{ x: 1.234, z: 2 }, { x: "a", z: 1 }, null] },
    });
    assert.equal(l.rueckstau.massnahme, "keine");   // unbekannte Maßnahme → keine
    assert.equal(l.rueckstau.ebene_m, 0);           // nicht zahlig → 0
    assert.equal(l.rueckstau.kanalsohle_m, -2.5);   // null → Default
    assert.equal(l.regen.r5_100, 0);                // negativ → 0
    assert.equal(l.regen.r30_100, 300);             // null → Default, NICHT 0 (0 hieße: es regnet nie)
    assert.equal(l.regen.dauer_min, 1);             // mindestens 1 Minute
    assert.equal(l.dach.gefaelle_pct, 0.5);         // mindestens 0,5 %
    assert.equal(l.dach.dmin_m, 0.02);              // mindestens 2 cm
    assert.equal(l.dach.ablaeufe.length, 1);        // nur der gültige Punkt
    assert.equal(l.dach.ablaeufe[0].x, 1.23);       // auf cm gerundet
    assert.equal(l.dach.ablaeufe[0].id, "ab_1");    // Id nachgezogen
  });

  it("Dachpunkte anlegen, verschieben, löschen — Ids laufen weiter", () => {
    const a = neuerDachpunkt(ENTW_DEFAULT, "ablaeufe", { x: 2, z: 3 });
    assert.equal(a.punkt.id, "ab_1");
    const b = neuerDachpunkt(a.layer, "ablaeufe", { x: 8, z: 3 });
    assert.equal(b.punkt.id, "ab_2");
    const c = neuerDachpunkt(b.layer, "notueberlaeufe", { x: 0, z: 4 });
    assert.equal(c.punkt.id, "no_1");

    const verschoben = verschiebeDachpunkt(c.layer, "ablaeufe", "ab_2", { x: 9.005, z: 3 });
    assert.equal(verschoben.dach.ablaeufe.find((p) => p.id === "ab_2").x, 9.01);

    const geloescht = loescheDachpunkt(verschoben, "ab_1");
    assert.deepEqual(geloescht.dach.ablaeufe.map((p) => p.id), ["ab_2"]);
    assert.equal(geloescht.dach.notueberlaeufe.length, 1, "die andere Liste bleibt unberührt");
  });

  it("neuerDachpunkt lehnt unsinnige Eingaben ab, ohne den Layer zu beschädigen", () => {
    const ohnePunkt = neuerDachpunkt(ENTW_DEFAULT, "ablaeufe", { x: "a", z: 1 });
    assert.equal(ohnePunkt.punkt, null);
    assert.deepEqual(ohnePunkt.layer.dach.ablaeufe, []);
    const falscheListe = neuerDachpunkt(ENTW_DEFAULT, "dachfenster", { x: 1, z: 1 });
    assert.equal(falscheListe.punkt, null);
  });
});

describe("Schmutzwasser (DIN EN 12056-2)", () => {
  it("20 WE mit 4 Objekten: ΣDU 80 → Q_ww 4,47 l/s → DN125 bei 1,5 %", () => {
    const sw = schmutzwasser({ we: 20, sanitaerJeWe: 4 });
    assert.equal(sw.sumDU, 80);
    assert.equal(sw.qww_ls, 4.47);          // 0,5 · √80 = 4,4721
    assert.equal(sw.dn, 125);               // DN100 trägt nur 4,0 l/s
    assert.equal(sw.gefaelleMin_pct, 1.5);
  });

  it("2 WE: der Rechenwert 1,41 wird auf den größten Einzel-DU 2,0 angehoben → DN100", () => {
    const sw = schmutzwasser({ we: 2, sanitaerJeWe: 4 });
    assert.equal(sw.sumDU, 8);
    assert.equal(sw.qww_ls, 2);             // max(2,0 ; 0,5·√8 = 1,414)
    assert.equal(sw.dn, 100);
    assert.equal(sw.gefaelleMin_pct, 2);
  });

  it("ohne Wohneinheiten ist der Abfluss 0 und nicht der DU-Mindestwert", () => {
    const sw = schmutzwasser({ we: 0 });
    assert.equal(sw.sumDU, 0);
    assert.equal(sw.qww_ls, 0);
  });

  it("grundleitungZeile trifft die Zeile, rundet nach oben und deckelt bei DN200", () => {
    assert.equal(grundleitungZeile(100).dn, 100);
    assert.equal(grundleitungZeile(110).dn, 125, "unbekanntes DN → nächstgrößere Zeile");
    assert.equal(grundleitungZeile(300).dn, 200, "über DN200 → letzte Zeile");
    assert.equal(grundleitungZeile(0).dn, 100);
  });
});

describe("Grundleitungen aus dem Netz", () => {
  it("zwei Leitungen: Tabellengefälle und Override, Gefälle 0,200 + 0,080 m", () => {
    const gl = grundleitungen(netzBauen(), { kanalsohle_m: -2.5 });
    assert.equal(gl.level, 0);
    assert.equal(gl.kanten.length, 2);

    const k1 = gl.kanten.find((k) => k.id === "k_1");
    assert.equal(k1.L_m, 10);
    assert.equal(k1.override, false);
    assert.equal(k1.gefaelle_pct, 2, "DN100 → Tabellenwert 2,0 %");
    assert.equal(k1.drop_m, 0.2);

    const k2 = gl.kanten.find((k) => k.id === "k_2");
    assert.equal(k2.L_m, 8);
    assert.equal(k2.override, true);
    assert.equal(k2.gefaelle_pct, 1);
    assert.equal(k2.drop_m, 0.08);

    assert.equal(gl.laengsterStrang_m, 18);
    assert.equal(gl.dropGesamt_m, 0.28);
  });

  it("ohne Keller startet die Sohle auf Frosttiefe; die Endsohle liegt über der Kanalsohle", () => {
    const gl = grundleitungen(netzBauen(), { kanalsohle_m: -2.5 });
    assert.equal(gl.startsohle_m, -1);      // −FROSTTIEFE_M
    assert.equal(gl.endsohle_m, -1.28);     // −1,00 − 0,28
    assert.equal(gl.tiefeOk, true);
    assert.equal(gl.anschluss.id, "n_1");
  });

  it("mit Keller sinkt die Sohle unter die Kanalsohle — das muss auffallen", () => {
    const gl = grundleitungen(netzBauen(), { kellerAktiv: true, storeyHeight: 3, kanalsohle_m: -2.5 });
    assert.equal(gl.startsohle_m, -3.3);    // −(3,0 + 0,3)
    assert.equal(gl.endsohle_m, -3.58);
    assert.equal(gl.tiefeOk, false);
  });

  it("ein Netz ohne Abwasser-Leitungen liefert keine Aussage statt einer falschen", () => {
    const nurHeizung = {
      version: 1, knoten: [],
      kanten: [{ id: "k_9", gewerk: "heizung", level: 0, dn: 25, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }] }],
    };
    const gl = grundleitungen(nurHeizung);
    assert.equal(gl.level, null);
    assert.equal(gl.kanten.length, 0);
    assert.equal(gl.tiefeOk, null, "keine Leitung → kein Urteil");
    assert.equal(gl.anschluss, null);
  });
});

describe("Rückstauebene (DIN 1986-100 § 13)", () => {
  it("ohne Untergeschoss liegt kein Gegenstand unter der Rückstauebene → pass", () => {
    const r = rueckstauCheck({ ebene_m: 0.15 });
    assert.equal(r.status, "pass");
    assert.deepEqual(r.gegenstaende, []);
  });

  it("Keller ohne Maßnahme → warn, mit Rückstauverschluss → pass", () => {
    const ohne = rueckstauCheck({ ebene_m: 0.15, kellerAktiv: true });
    assert.equal(ohne.status, "warn");
    assert.equal(ohne.sohle_m, -3);
    assert.match(ohne.detail, /Rückstausicherung|Hebeanlage/);

    const mit = rueckstauCheck({ ebene_m: 0.15, kellerAktiv: true, massnahme: "verschluss" });
    assert.equal(mit.status, "pass");
  });

  it("Tiefgarage mit Rückstauverschluss bleibt warn — dort ist er unzulässig", () => {
    const tg = rueckstauCheck({ ebene_m: 0.15, tiefgarageAktiv: true, massnahme: "verschluss" });
    assert.equal(tg.status, "warn");
    assert.match(tg.detail, /unzulässig/);
  });

  it("die Hebeanlage hebt über die Rückstauebene — auch für die Tiefgarage → pass", () => {
    const h = rueckstauCheck({ ebene_m: 0.15, kellerAktiv: true, tiefgarageAktiv: true, massnahme: "hebeanlage" });
    assert.equal(h.status, "pass");
    assert.equal(h.gegenstaende.length, 2);
  });
});

describe("Regen: abflusswirksame Fläche, Überflutung, Notentwässerung, Rückhalt", () => {
  it("A_red = 200·0,9 + 100·0,9 + 300·0,2 = 330 m²", () => {
    assert.equal(abflusswirksam({ footArea: 200, befestigt_m2: 100, gruen_m2: 300 }), 330);
  });

  it("Jahrhundertregen: Zufluss 30 l/s, zulässig 5 l/s → 45 m³ Rückhalt", () => {
    const b = ueberflutung({ r30_100: 300, aRed: 1000, qAb_ls: 5, dauer_min: 30 });
    assert.equal(b.zufluss_ls, 30);
    assert.equal(b.vRueck_m3, 45);
  });

  it("liegt der Zufluss unter dem zulässigen Abfluss, ist kein Rückhalt nötig", () => {
    const b = ueberflutung({ r30_100: 300, aRed: 100, qAb_ls: 5 });
    assert.equal(b.zufluss_ls, 3);
    assert.equal(b.vRueck_m3, 0, "kein negatives Volumen");
  });

  it("Notentwässerung: 83,2 − 18,0 = 65,2 l/s erforderlich; 5 Notüberläufe (75) pass, 4 (60) warn", () => {
    const fuenf = notentwaesserung({ r5_100: 800, aDach: 1040, nAblaeufe: 4, nNot: 5 });
    assert.equal(fuenf.qDach_ls, 83.2);
    assert.equal(fuenf.qAblaeufe_ls, 18);
    assert.equal(fuenf.qNotErf_ls, 65.2);
    assert.equal(fuenf.qNotVorh_ls, 75);
    assert.equal(fuenf.status, "pass");

    const vier = notentwaesserung({ r5_100: 800, aDach: 1040, nAblaeufe: 4, nNot: 4 });
    assert.equal(vier.qNotVorh_ls, 60);
    assert.equal(vier.status, "warn");
  });

  it("ohne Abläufe auf dem Dach gibt es kein Urteil, sondern offen", () => {
    assert.equal(notentwaesserung({ aDach: 1040, nAblaeufe: 0, nNot: 0 }).status, "offen");
    assert.equal(notentwaesserung({ aDach: 0, nAblaeufe: 4, nNot: 4 }).status, "offen");
  });

  it("Rückhalt: Mulde 100 m² = 30 m³ plus Zisterne 20 m³ = 50 m³", () => {
    const r = rueckhaltVolumen({
      flaechen: [{ id: "fl_1", art: "mulde", points: rect(0, 0, 10, 10) }],
      elemente: [{ id: "el_1", typ: "zisterne20", x: 5, z: 20 }],
    });
    assert.equal(r.je.mulde, 30);          // 100 m² · 0,30 m³/m²
    assert.equal(r.je.zisterne, 20);
    assert.equal(r.zisternen, 1);
    assert.equal(r.gesamt_m3, 50);
  });

  it("fremde Flächenarten und unbekannte Bauteiltypen zählen nicht mit", () => {
    const r = rueckhaltVolumen({
      flaechen: [{ id: "fl_1", art: "gruen", points: rect(0, 0, 10, 10) }],
      elemente: [{ id: "el_1", typ: "gartenzwerg", x: 1, z: 1 }],
    });
    assert.deepEqual(r.je, {});
    assert.equal(r.gesamt_m3, 0);
    assert.equal(r.zisternen, 0);
    assert.equal(REGEN_ARTEN.gruen, undefined);
    assert.equal(REGEN_TYPEN.gartenzwerg, undefined);
  });
});

describe("Checks und Mengen", () => {
  it("ohne Eingaben ist jeder Check offen — nie stillschweigend pass", () => {
    const items = entwaesserungChecks({});
    const sw = items.find((i) => i.key === "schmutzwasser");
    assert.equal(sw.status, "offen");
    assert.equal(items.find((i) => i.key === "grundleitung").status, "offen");
    assert.ok(items.every((i) => ["pass", "warn", "offen"].includes(i.status)), "kein fail — das ist eine Haftungsentscheidung");
  });

  it("die vollständige Kette liefert pass für Grundleitung, Anschluss und Überflutungsnachweis", () => {
    const sw = schmutzwasser({ we: 2, sanitaerJeWe: 4 });                 // DN100
    const gl = grundleitungen(netzBauen({ override: 2 }));                // beide Leitungen 2 %
    const bilanz = ueberflutung({ r30_100: 300, aRed: 1000, qAb_ls: 5 }); // 45 m³
    const rueckhalt = rueckhaltVolumen({
      flaechen: [{ id: "fl_1", art: "mulde", points: rect(0, 0, 10, 10) }],
      elemente: [{ id: "el_1", typ: "zisterne20", x: 5, z: 20 }],
    });                                                                    // 50 m³
    const items = entwaesserungChecks({ sw, gl, bilanz, rueckhalt, rueckstau: rueckstauCheck({}), not: notentwaesserung({ aDach: 1040, nAblaeufe: 4, nNot: 5 }) });
    assert.equal(items.find((i) => i.key === "grundleitung").status, "pass");
    assert.equal(items.find((i) => i.key === "anschluss").status, "pass");
    assert.equal(items.find((i) => i.key === "ueberflutung").status, "pass");
    assert.equal(items.find((i) => i.key === "not").status, "pass");
  });

  it("eine Leitung unter dem erforderlichen DN und zu wenig Rückhalt werden zur Warnung", () => {
    const sw = schmutzwasser({ we: 20, sanitaerJeWe: 4 });                 // fordert DN125
    const gl = grundleitungen(netzBauen());                                // liefert DN100
    const bilanz = ueberflutung({ r30_100: 300, aRed: 1000, qAb_ls: 5 });  // 45 m³
    const rueckhalt = rueckhaltVolumen({ flaechen: [{ id: "fl_1", art: "mulde", points: rect(0, 0, 10, 10) }] }); // 30 m³
    const items = entwaesserungChecks({ sw, gl, bilanz, rueckhalt });
    assert.equal(items.find((i) => i.key === "grundleitung").status, "warn");
    const u = items.find((i) => i.key === "ueberflutung");
    assert.equal(u.status, "warn");
    assert.match(u.detail, /30 m³ Rückhalt vorhanden \/ 45 m³ erforderlich/);
  });

  it("ohne Rückhalt-Element bleibt der Überflutungsnachweis offen statt warn", () => {
    const bilanz = ueberflutung({ r30_100: 300, aRed: 1000, qAb_ls: 5 });
    const items = entwaesserungChecks({ bilanz, rueckhalt: rueckhaltVolumen({}) });
    assert.equal(items.find((i) => i.key === "ueberflutung").status, "offen");
  });

  it("bei einem Steildach gelten Gefälledämmung und Notentwässerung nicht", () => {
    const items = entwaesserungChecks({ dachform: "sattel", not: notentwaesserung({ aDach: 1040, nAblaeufe: 4, nNot: 5 }) });
    const dach = items.find((i) => i.key === "dach");
    assert.equal(dach.status, "offen");
    assert.equal(items.find((i) => i.key === "not"), undefined, "kein Notentwässerungs-Check am Steildach");
  });

  it("Mengen: Grundleitungen je DN, Dachbauteile als Stück, Rückhalt in m³", () => {
    const gl = grundleitungen(netzBauen({ dn: 125 }));
    const mengen = entwaesserungMengen({
      gl,
      dach: { ablaeufe: [{ id: "ab_1" }, { id: "ab_2" }], notueberlaeufe: [{ id: "no_1" }] },
      rueckstau: { massnahme: "hebeanlage" },
      rueckhalt: rueckhaltVolumen({ flaechen: [{ id: "fl_1", art: "mulde", points: rect(0, 0, 10, 10) }] }),
      gefaelleMengen: [{ key: "staffel_120", label: "Gefälledämmung 120 mm", menge: 42.5, einheit: "m²" }],
    });
    const nach = (k) => mengen.find((m) => m.key === k);
    assert.equal(nach("gl_dn125").menge, 18, "10 m + 8 m in einer Zeile je DN");
    assert.equal(nach("gl_dn125").einheit, "m");
    assert.equal(nach("ablaeufe").menge, 2);
    assert.equal(nach("notueberlaeufe").menge, 1);
    assert.equal(nach("hebeanlage").menge, 1);
    assert.equal(nach("rh_mulde").menge, 30);
    assert.equal(nach("rh_mulde").einheit, "m³");
    assert.equal(nach("staffel_120").menge, 42.5, "Gefälle-Mengen werden unverändert durchgereicht");
  });

  it("Mengen ohne Eingaben sind leer — keine Phantom-Positionen", () => {
    assert.deepEqual(entwaesserungMengen({}), []);
    const nurVerschluss = entwaesserungMengen({ rueckstau: { massnahme: "verschluss" } });
    assert.equal(nurVerschluss.length, 1);
    assert.equal(nurVerschluss[0].key, "verschluss");
  });
});
