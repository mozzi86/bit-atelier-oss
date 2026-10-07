// Unit-Tests für packages/nova-designer/src/lib/asr.js (ASR-Raumdatenblatt, Phase 27).
//
// Belegte Sample-Werte: .planning/phases/27-asr-raumdatenblatt-reiter/27-01-PLAN.md
//   (Smoke: sollwerteFuer("buero") ⇒ 500 lx / 26 °C Hitzeschutz / 55 dB(A);
//   Fallback "sonstige" ⇒ 300 lx; 10 Nutzungsarten; belegungsAequivalent(2,3) = 3,5;
//   roomKey({level:1,name:"Büro 1"}) = "1:Büro 1"; Ampel pass/neutral; nie fail;
//   bewegungsflaeche(4×3-Raum, 1,0, "sued").d === 1; leeres Polygon ⇒ null).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NUTZUNGSARTEN,
  ASR_CHECKLISTE,
  sollwerteFuer,
  roomKey,
  belegungsAequivalent,
  flaecheJeAequivalent,
  asrChecks,
  checklistFuer,
  konformitaetAusCheckliste,
  bewegungsflaeche,
} from "@designer/lib/asr";

describe("asr.js — Nutzungsart-Katalog", () => {
  it("genau 10 Nutzungsarten", () => {
    assert.equal(Object.keys(NUTZUNGSARTEN).length, 10);
  });

  it("Büro: 500 lx, Hitzeschutz 26 °C, Lärm 55 dB(A), Temperatur 20 °C", () => {
    const s = sollwerteFuer("buero");
    assert.equal(s.beleuchtung_lx, 500);
    assert.equal(s.hitzeschutz_c, 26);
    assert.equal(s.laerm_dbA, 55);
    assert.equal(s.temp_soll_c, 20);
  });

  it("Hitzeschutz ist in ALLEN Nutzungsarten 26 °C (ASR A3.5, Sommerfall)", () => {
    for (const [key, s] of Object.entries(NUTZUNGSARTEN)) {
      assert.equal(s.hitzeschutz_c, 26, `${key}`);
    }
  });

  it("nicht relevante Sollwerte sind bewusst null (nicht 0) — Sanitär/Verkehr/Technik", () => {
    assert.equal(NUTZUNGSARTEN.sanitaer.luftwechsel_1h, null);
    assert.equal(NUTZUNGSARTEN.sanitaer.laerm_dbA, null);
    assert.equal(NUTZUNGSARTEN.verkehr.laerm_dbA, null);
    assert.equal(NUTZUNGSARTEN.technik.temp_soll_c, null);
    // Unterschied null vs. 0 ist bedeutungstragend
    assert.notEqual(NUTZUNGSARTEN.technik.temp_soll_c, 0);
  });

  it("unbekannte Nutzungsart fällt auf \"sonstige\" zurück (300 lx)", () => {
    assert.equal(sollwerteFuer("xxx").beleuchtung_lx, 300);
    assert.equal(sollwerteFuer(undefined).beleuchtung_lx, 300);
    assert.equal(sollwerteFuer(), NUTZUNGSARTEN.sonstige);
    assert.equal(sollwerteFuer(null), NUTZUNGSARTEN.sonstige);
  });
});

describe("asr.js — roomKey() (Pitfall 4: nicht index-keyed)", () => {
  it("belegter Sample-Wert: {level:1, name:\"Büro 1\"} ⇒ \"1:Büro 1\"", () => {
    assert.equal(roomKey({ level: 1, name: "Büro 1" }), "1:Büro 1");
  });

  it("Härtung: fehlende Felder ⇒ \"0:Raum\", kein undefined im Schlüssel", () => {
    assert.equal(roomKey({}), "0:Raum");
    assert.equal(roomKey(undefined), "0:Raum");
    assert.equal(roomKey(null), "0:Raum");
    assert.ok(!/undefined/.test(roomKey({ level: undefined, name: undefined })));
  });

  it("level 0 bleibt 0 (kein Fallback über ??-Kette)", () => {
    assert.equal(roomKey({ level: 0, name: "EG-Flur" }), "0:EG-Flur");
  });
});

describe("asr.js — Belegung", () => {
  it("belegter Sample-Wert: 2 Arbeitsplätze + 3 Arbeitsgelegenheiten ⇒ 3,5 Äquivalent", () => {
    assert.equal(belegungsAequivalent(2, 3), 3.5);
    assert.equal(belegungsAequivalent(1, 0), 1);
  });

  it("Arbeitsgelegenheiten zählen mit Faktor 0,5", () => {
    assert.equal(belegungsAequivalent(0, 4), 2);
  });

  it("Härtung: leer/negativ/NaN ⇒ 0, immer endlich", () => {
    assert.equal(belegungsAequivalent("", ""), 0);
    assert.ok(Number.isFinite(belegungsAequivalent("", "")));
    assert.equal(belegungsAequivalent(-2, -3), 0);
    assert.equal(belegungsAequivalent(NaN, NaN), 0);
    assert.equal(belegungsAequivalent(), 0);
  });

  it("flaecheJeAequivalent(): 20 m² auf 4 Äquivalente = 5 m²", () => {
    assert.equal(flaecheJeAequivalent(20, 4), 5);
  });

  it("Härtung: Äquivalent 0 bleibt endlich (safeDiv), kein Infinity", () => {
    const v = flaecheJeAequivalent(20, 0);
    assert.ok(Number.isFinite(v), `nicht endlich: ${v}`);
    assert.equal(v, 200);
  });

  it("Härtung: negative/leere Eingaben ⇒ endlich, nie NaN", () => {
    assert.ok(Number.isFinite(flaecheJeAequivalent(-20, -4)));
    assert.equal(flaecheJeAequivalent(-20, -4), 0);
    assert.ok(Number.isFinite(flaecheJeAequivalent()));
  });
});

describe("asr.js — asrChecks() Invarianten", () => {
  const soll = sollwerteFuer("buero");

  it("Büro mit konformitaet \"ja\" ⇒ Ampel pass", () => {
    const c = asrChecks({}, soll, { konformitaet: "ja" });
    assert.equal(c.ampel, "pass");
    assert.equal(c.offen, 0);
    assert.equal(c.warns, 0);
  });

  it("konformitaet \"offen\" ⇒ Ampel neutral (NIE Auto-Rot)", () => {
    const c = asrChecks({}, soll, { konformitaet: "offen" });
    assert.equal(c.ampel, "neutral");
    assert.ok(c.offen > 0);
  });

  it("konformitaet \"nein\" ⇒ warn, NICHT fail (manuelle Einschätzung)", () => {
    const c = asrChecks({}, soll, { konformitaet: "nein" });
    const item = c.items.find((i) => i.key === "konformitaet");
    assert.equal(item.status, "warn");
    assert.equal(c.ampel, "warn");
  });

  it("Hitzeschutz-Sollwert über 26 °C ⇒ warn (Sommerfall ASR A3.5)", () => {
    const c = asrChecks({}, { ...soll, hitzeschutz_c: 28 }, { konformitaet: "ja" });
    const item = c.items.find((i) => i.key === "hitzeschutz");
    assert.equal(item.status, "warn");
    assert.match(item.detail, /über 26 °C/);
  });

  it("Grenzwert exakt: 26 °C ⇒ pass, 26,1 °C ⇒ warn", () => {
    assert.equal(asrChecks({}, { ...soll, hitzeschutz_c: 26 }, {}).items.find((i) => i.key === "hitzeschutz").status, "pass");
    assert.equal(asrChecks({}, { ...soll, hitzeschutz_c: 26.1 }, {}).items.find((i) => i.key === "hitzeschutz").status, "warn");
  });

  it("ME-06: fehlender Hitzeschutz-Sollwert ⇒ \"offen\", NICHT \"0 °C eingehalten\"-pass", () => {
    for (const wert of [null, undefined, ""]) {
      const c = asrChecks({}, { ...soll, hitzeschutz_c: wert }, {});
      const item = c.items.find((i) => i.key === "hitzeschutz");
      assert.equal(item.status, "offen", `hitzeschutz_c = ${String(wert)}`);
      assert.match(item.detail, /pflegen/);
    }
  });

  it("Sollwerte mit null werden GAR NICHT geprüft (Sanitär hat keine Lärm-/Luftwechselzeile)", () => {
    const sani = asrChecks({}, sollwerteFuer("sanitaer"), { konformitaet: "ja" });
    assert.equal(sani.items.find((i) => i.key === "laerm"), undefined);
    const technik = asrChecks({}, sollwerteFuer("technik"), { konformitaet: "ja" });
    assert.equal(technik.items.find((i) => i.key === "temperatur"), undefined);
  });

  it("Büro hat alle 5 Items (hitzeschutz, beleuchtung, temperatur, laerm, konformitaet)", () => {
    const c = asrChecks({}, soll, { konformitaet: "ja" });
    assert.deepEqual(c.items.map((i) => i.key), ["hitzeschutz", "beleuchtung", "temperatur", "laerm", "konformitaet"]);
  });

  it("INVARIANTE: asrChecks liefert NIE Status \"fail\" — nur pass/warn/offen", () => {
    const varianten = [
      [{}, {}, {}],
      [{}, soll, { konformitaet: "ja" }],
      [{}, soll, { konformitaet: "nein" }],
      [{}, { ...soll, hitzeschutz_c: 99, beleuchtung_lx: 0, temp_soll_c: 0, laerm_dbA: 0 }, {}],
      [{}, { hitzeschutz_c: -26, beleuchtung_lx: -500, temp_soll_c: -20, laerm_dbA: -55 }, { konformitaet: "quatsch" }],
      [undefined, undefined, undefined],
    ];
    for (const [room, s, ist] of varianten) {
      const c = asrChecks(room, s, ist);
      for (const i of c.items) {
        assert.ok(["pass", "warn", "offen"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
    }
  });

  it("INVARIANTE: Ampel folgt offen > warn > pass", () => {
    for (const ist of [{}, { konformitaet: "ja" }, { konformitaet: "nein" }]) {
      const c = asrChecks({}, soll, ist);
      assert.equal(c.ampel, c.offen > 0 ? "neutral" : c.warns > 0 ? "warn" : "pass");
    }
  });

  it("Härtung: leerer Aufruf liefert Items ohne NaN-Texte", () => {
    for (const c of [asrChecks(), asrChecks({}, {}, {})]) {
      assert.ok(c.items.length >= 3);
      for (const i of c.items) {
        assert.equal(typeof i.detail, "string");
        assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter in ${i.key}: ${i.detail}`);
      }
    }
  });
});

describe("asr.js — Checkliste", () => {
  it("ASR_CHECKLISTE enthält Gruppen-Header und Prüfzeilen mit ASR-Referenz", () => {
    assert.ok(ASR_CHECKLISTE.length > 20, `nur ${ASR_CHECKLISTE.length} Einträge`);
    assert.ok(ASR_CHECKLISTE.some((r) => r.gruppe), "keine Gruppen-Header");
    assert.ok(ASR_CHECKLISTE.some((r) => r.ref === "ASR V3"), "Gefährdungsbeurteilung fehlt");
  });

  it("checklistFuer(\"sanitaer\") enthält mehr Zeilen als andere Nutzungsarten", () => {
    const sani = checklistFuer("sanitaer");
    const buero = checklistFuer("buero");
    assert.ok(sani.length >= buero.length, `sanitaer ${sani.length} < buero ${buero.length}`);
    assert.ok(ASR_CHECKLISTE.some((r) => r.nurSanitaer), "keine Sanitär-Zeilen im Katalog");
  });

  it("leere Gruppen-Header werden entfernt (kein Header ohne Punkte)", () => {
    for (const nutzung of Object.keys(NUTZUNGSARTEN)) {
      const rows = checklistFuer(nutzung);
      rows.forEach((r, i) => {
        if (r.gruppe) {
          assert.ok(rows[i + 1] && !rows[i + 1].gruppe, `leerer Header "${r.gruppe}" bei ${nutzung}`);
        }
      });
    }
  });

  it("Härtung: unbekannte/leere Nutzungsart liefert eine gültige Liste", () => {
    assert.ok(checklistFuer("gibtsnicht").length > 0);
    assert.ok(checklistFuer(undefined).length > 0);
    assert.ok(checklistFuer().length > 0);
  });
});

describe("asr.js — konformitaetAusCheckliste() (nie automatisch \"nein\")", () => {
  const punkte = checklistFuer("buero");
  const refs = punkte.filter((p) => p.ref).map((p) => p.ref);

  it("alle Punkte \"ok\" ⇒ \"ja\"", () => {
    const status = Object.fromEntries(refs.map((r) => [r, "ok"]));
    assert.equal(konformitaetAusCheckliste(status, punkte), "ja");
  });

  it("ein Punkt \"offen\" ⇒ \"offen\"", () => {
    const status = Object.fromEntries(refs.map((r) => [r, "ok"]));
    status[refs[0]] = "offen";
    assert.equal(konformitaetAusCheckliste(status, punkte), "offen");
  });

  it("\"nz\" zählt nicht gegen, solange mindestens ein Punkt \"ok\" ist", () => {
    const status = Object.fromEntries(refs.map((r) => [r, "nz"]));
    assert.equal(konformitaetAusCheckliste(status, punkte), "offen", "nur nz ⇒ kein ja");
    status[refs[0]] = "ok";
    assert.equal(konformitaetAusCheckliste(status, punkte), "ja");
  });

  it("INVARIANTE: gibt NIE automatisch \"nein\" zurück (Haftung)", () => {
    const varianten = [
      {},
      Object.fromEntries(refs.map((r) => [r, "offen"])),
      Object.fromEntries(refs.map((r) => [r, "nz"])),
      Object.fromEntries(refs.map((r) => [r, "irgendwas"])),
      Object.fromEntries(refs.map((r) => [r, "ok"])),
    ];
    for (const status of varianten) {
      const r = konformitaetAusCheckliste(status, punkte);
      assert.notEqual(r, "nein");
      assert.ok(["ja", "offen"].includes(r), `unerwartet: ${r}`);
    }
  });

  it("Härtung: leere Punkte-Liste ⇒ \"offen\"; leerer Aufruf ⇒ \"offen\"", () => {
    assert.equal(konformitaetAusCheckliste({}, []), "offen");
    assert.equal(konformitaetAusCheckliste(), "offen");
    assert.equal(konformitaetAusCheckliste({}, [{ gruppe: "X" }]), "offen");
  });
});

describe("asr.js — bewegungsflaeche() (ASR A1.2)", () => {
  const RAUM = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }];

  it("belegter Sample-Wert: 4 × 3 m Raum, Tiefe 1,0 m, Seite süd ⇒ d = 1", () => {
    const bf = bewegungsflaeche(RAUM, 1.0, "sued");
    assert.deepEqual(bf, { x: 0, z: 2, w: 4, d: 1 });
  });

  it("nord/sued setzen d = Tiefe, west/ost setzen w = Tiefe", () => {
    assert.equal(bewegungsflaeche(RAUM, 1.0, "nord").d, 1);
    assert.equal(bewegungsflaeche(RAUM, 1.0, "sued").d, 1);
    assert.equal(bewegungsflaeche(RAUM, 1.0, "west").w, 1);
    assert.equal(bewegungsflaeche(RAUM, 1.0, "ost").w, 1);
  });

  it("unbekannte Seite verhält sich wie \"ost\"", () => {
    assert.deepEqual(bewegungsflaeche(RAUM, 1.0, "nordwest"), bewegungsflaeche(RAUM, 1.0, "ost"));
  });

  it("Band liegt immer innerhalb der Bounding-Box", () => {
    for (const seite of ["nord", "sued", "west", "ost"]) {
      const bf = bewegungsflaeche(RAUM, 1.0, seite);
      assert.ok(bf.x >= 0 && bf.z >= 0, `${seite}: ${JSON.stringify(bf)}`);
      assert.ok(bf.x + bf.w <= 4 + 1e-9, `${seite}: rechts raus`);
      assert.ok(bf.z + bf.d <= 3 + 1e-9, `${seite}: unten raus`);
    }
  });

  it("Härtung: leeres/zu kleines Polygon ⇒ null (kein 0-Rechteck)", () => {
    assert.equal(bewegungsflaeche([], 1.0), null);
    assert.equal(bewegungsflaeche(null, 1.0), null);
    assert.equal(bewegungsflaeche(undefined), null);
    assert.equal(bewegungsflaeche([{ x: 0, z: 0 }, { x: 1, z: 1 }], 1.0), null);
  });

  it("Härtung: 0/negativ/NaN/leerer String werden auf Tiefe 0 geklemmt, alle Werte endlich", () => {
    for (const t of [0, -1, NaN, "", null]) {
      const bf = bewegungsflaeche(RAUM, t, "sued");
      assert.equal(bf.d, 0, `Tiefe ${String(t)}`);
      for (const [k, v] of Object.entries(bf)) {
        assert.ok(Number.isFinite(v), `${k} nicht endlich`);
      }
    }
  });

  it("undefined greift auf den Default 1,0 m zurück (nicht auf 0)", () => {
    assert.equal(bewegungsflaeche(RAUM, undefined, "sued").d, 1);
    assert.equal(bewegungsflaeche(RAUM).d, 1);
  });

  it("Tiefe größer als der Raum liefert weiterhin endliche Werte", () => {
    const bf = bewegungsflaeche(RAUM, 99, "sued");
    for (const [k, v] of Object.entries(bf)) {
      assert.ok(Number.isFinite(v), `${k} nicht endlich`);
    }
  });
});
