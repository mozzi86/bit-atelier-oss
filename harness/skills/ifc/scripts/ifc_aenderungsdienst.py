"""ifc_aenderungsdienst — lay our own changes over a new model state from the client.

Standalone CLI:
    python ifc_aenderungsdienst.py <alt.ifc> <neu.ifc> --journal <journal.json> [--anwenden]

In-process: run(alt, neu, journal=[...], anwenden=False) -> dict

Plan 71-09 (ROHB-09). The client (AG) sends a new model state; we have a journal of
our own property edits on the old state (71-06). Per GlobalId this says what the
client changed (ifc_diff, 67-03) and per own change whether it still fits:

  uebertragbar  the client left this property as it was → our change can be re-applied
  schon_gleich  the new state already holds our value
  konflikt      the client changed the SAME property to something else → a person decides
  entfallen     the element is gone in the new state

The base of a change is its `alt` (value before our edit); without `alt` the value in
the old model is used. The verdict is a finding, never a decision (konflikt is "warn",
not "fail" — which value wins is a contractual question, not a programming one).

anwenden=True writes the transferable changes onto the NEW state with the writer
(71-05) → <neu>_v<n>.ifc; conflicts and removed elements stay untouched.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import data_note, error_result, load_module, open_ifc, table_md  # noqa: E402

URTEILE = ("uebertragbar", "schon_gleich", "konflikt", "entfallen", "ungueltig")
LABEL = {"uebertragbar": "übertragbar", "schon_gleich": "schon gleich", "konflikt": "Konflikt",
         "entfallen": "entfallen", "ungueltig": "ungültig"}


def _md_wert(v: Any) -> str:
    return "—" if v is None else str(v)


def urteile(model_alt, model_neu, journal: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One verdict row per journal entry (see module docstring)."""
    w = load_module("ifc_write.py")
    rows: list[dict[str, Any]] = []
    for i, e in enumerate(journal):
        fehler = w._pruefe_aenderung(e)
        row: dict[str, Any] = {"nr": i + 1, **{k: e.get(k) for k in ("guid", "pset", "attribut", "eigenschaft", "wert", "alt")}} \
            if isinstance(e, dict) else {"nr": i + 1}
        if fehler:
            rows.append({**row, "urteil": "ungueltig", "grund": fehler})
            continue
        im_alt, wert_alt_stand = w.aktueller_wert(model_alt, e)
        im_neu, wert_neu_stand = w.aktueller_wert(model_neu, e)
        row.update({"wert_alter_stand": wert_alt_stand, "wert_neuer_stand": wert_neu_stand})
        if not im_neu:
            rows.append({**row, "urteil": "entfallen", "grund": "Element im neuen Stand nicht mehr vorhanden"})
            continue
        basis = e["alt"] if "alt" in e else wert_alt_stand
        if im_alt and "alt" in e and not w._gleich(e["alt"], wert_alt_stand):
            row["hinweis"] = (f"Journal-Altwert {e['alt']!r} ≠ alter Stand {wert_alt_stand!r} — "
                              "Journal gehört evtl. zu einem anderen Stand")
        if w._gleich(wert_neu_stand, e.get("wert")):
            rows.append({**row, "urteil": "schon_gleich"})
        elif w._gleich(wert_neu_stand, basis):
            rows.append({**row, "urteil": "uebertragbar"})
        else:
            rows.append({**row, "urteil": "konflikt",
                         "grund": f"AG hat {basis!r} → {wert_neu_stand!r} geändert, eigene Änderung → {e.get('wert')!r}"})
    return rows


def run(alt: str | Path, neu: str | Path, journal: list[dict[str, Any]] | None = None,
        anwenden: bool = False, out: str | Path | None = None, **opts: Any) -> dict:
    """Model diff + verdict per own change; optionally writes the transferable ones."""
    try:
        model_alt = open_ifc(alt)
        model_neu = open_ifc(neu)
    except ValueError as exc:
        return error_result(str(exc))
    journal = list(journal or [])
    diff = load_module("ifc_diff.py").run(alt, neu)
    if "error" in diff:
        return diff
    rows = urteile(model_alt, model_neu, journal)
    zaehl = {u: sum(1 for r in rows if r["urteil"] == u) for u in URTEILE}

    geschrieben = None
    if anwenden:
        uebertragen = [{k: r[k] for k in ("guid", "pset", "attribut", "eigenschaft", "wert") if r.get(k) is not None}
                       | {"alt": r["wert_neuer_stand"]}
                       for r in rows if r["urteil"] == "uebertragbar"]
        geschrieben = load_module("ifc_write.py").run(neu, uebertragen, out=out)
        if "error" in geschrieben:
            return geschrieben

    d = diff["json"]
    md = [f"# Änderungsdienst — {Path(alt).name} → {Path(neu).name}", "",
          f"**Modellstand AG:** {len(d['neu_ids'])} neu · {len(d['entfallen_ids'])} entfallen · "
          f"{len(d['geaendert'])} geändert (je GlobalId)",
          f"**Eigene Änderungen:** {len(rows)} — " + " · ".join(f"{zaehl[u]} {LABEL[u]}" for u in URTEILE if zaehl[u]),
          ""]
    if rows:
        md.append(table_md(
            ["Nr", "GUID", "Eigenschaft", "eigener Wert", "alter Stand", "neuer Stand", "Urteil", "Grund"],
            [[str(r["nr"]), f"`{r.get('guid')}`", r.get("attribut") or f"{r.get('pset')}.{r.get('eigenschaft')}",
              _md_wert(r.get("wert")), _md_wert(r.get("wert_alter_stand")), _md_wert(r.get("wert_neuer_stand")),
              LABEL[r["urteil"]], r.get("grund", "") or r.get("hinweis", "")] for r in rows]))
    if zaehl["konflikt"]:
        md += ["", f"**{zaehl['konflikt']} Konflikt(e):** der AG hat dieselbe Eigenschaft anders geändert — "
                   "wer gilt, entscheidet ein Mensch; nichts davon wurde geschrieben."]
    if geschrieben:
        md += ["", f"Übertragbare Änderungen geschrieben: `{Path(geschrieben['json']['datei']).name}` "
                   f"(GUID-Erhalt: {'ja' if geschrieben['json']['guid_erhalt'] else 'NEIN'})."]
    elif zaehl["uebertragbar"]:
        md += ["", "Mit `anwenden` werden die übertragbaren Änderungen auf den neuen Stand geschrieben."]
    return {"markdown": "\n".join(md), "hinweis": data_note(),
            "json": {"alt": str(alt), "neu": str(neu),
                     "diff": {"neu": len(d["neu_ids"]), "entfallen": len(d["entfallen_ids"]),
                              "geaendert": len(d["geaendert"]), "neu_ids": d["neu_ids"],
                              "entfallen_ids": d["entfallen_ids"]},
                     "urteile": rows, "zaehlung": zaehl,
                     "datei": geschrieben["json"]["datei"] if geschrieben else None,
                     "geschrieben": geschrieben["json"] if geschrieben else None}}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Eigene Änderungen über einen neuen AG-Stand legen (je GlobalId).")
    parser.add_argument("alt", help="alter AG-Stand (auf dem das Journal entstand)")
    parser.add_argument("neu", help="neuer AG-Stand")
    parser.add_argument("--journal", required=True, help="Journal-JSON (71-06)")
    parser.add_argument("--anwenden", action="store_true", help="übertragbare Änderungen auf den neuen Stand schreiben")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    journal = load_module("ifc_write.py").lade_journal(args.journal)
    result = run(args.alt, args.neu, journal, anwenden=args.anwenden)
    if "error" in result:
        print(result["error"], file=sys.stderr)
        return 1
    if args.json:
        import json
        print(json.dumps(result["json"], ensure_ascii=False, indent=2, default=str))
    else:
        print(result["markdown"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
