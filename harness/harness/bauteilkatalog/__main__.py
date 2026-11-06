"""CLI of the component catalogue (phase 109): write the neutral IFC samples and check IFC files.

    python -m harness.bauteilkatalog muster <ordner> [--schema IFC4|IFC4X3]
        → sample project twice: stud wall decomposed into parts, and stud wall as layers (fixed roles
          `MUSTER_ROLLEN` from the base stock, so no project option)
    python -m harness.bauteilkatalog bibliothek <ordner> [--schema IFC4|IFC4X3] [--projekt <ordner>]
        → material library and type library
    python -m harness.bauteilkatalog pruefen <datei.ifc> [--ohne-regeln]
        → check report (schema + WHERE rules, proxies, elements without type, neutrality)

In:  target folder / IFC file; `bibliothek --projekt` adds the runtime types of a harness project folder
     to the type library. `--schema` is case-insensitive.
Out: IFC files named `bit-atelier-<erzeugnis>-<schema>[-staenderwand-als-schichten].ifc` and one JSON
     report per file on stdout. Exit code 0 = all valid and neutral, 1 = a check failed or the input is
     unusable (German message on stderr), 2 = wrong arguments (argparse), 3 = builder not available.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import (NichtVerfuegbar, SCHEMATA, katalog, materialbibliothek, muster_projekt, pruefen, schreiben,
               typbibliothek)
from .neutral import NeutralitaetsFehler

#: Exit code when elmonkey-core / ifcopenshell are missing (2 is taken by argparse for wrong arguments).
EXIT_NICHT_VERFUEGBAR = 3


def dateiname(erzeugnis: str, schema: str, zusatz: str = "") -> str:
    """Neutral file name of a written sample, e.g. `bit-atelier-bauteiltypen-ifc4.ifc`."""
    return f"bit-atelier-{erzeugnis}-{schema.lower()}{'-' + zusatz if zusatz else ''}.ifc"


def _bericht(pfad: Path, extra: dict | None = None) -> dict:
    b = pruefen(pfad)
    b = {"datei": pfad.name, "bytes": pfad.stat().st_size, **{k: v for k, v in b.items() if k != "fehler"},
         "fehler": b["fehler"][:5]}
    if extra:
        b.update(extra)
    return b


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m harness.bauteilkatalog",
                                 description="Bauteilkatalog: neutrale IFC-Muster schreiben und IFC-Dateien prüfen")
    sub = ap.add_subparsers(dest="befehl", required=True)
    for name, hilfe in (("muster", "Muster-Projekt (Ständerwand als Teile und als Schichten)"),
                        ("bibliothek", "Material- und Typbibliothek")):
        p = sub.add_parser(name, help=hilfe)
        p.add_argument("ordner", type=Path)
        p.add_argument("--schema", default="IFC4", type=str.upper, choices=SCHEMATA)
        if name == "bibliothek":
            p.add_argument("--projekt", type=Path, default=None,
                           help="Harness-Projektordner, dessen Laufzeit-Typen in die Typbibliothek kommen")
    p = sub.add_parser("pruefen", help="IFC-Datei prüfen")
    p.add_argument("datei", type=Path)
    p.add_argument("--ohne-regeln", action="store_true", help="ohne WHERE-Regeln (schneller)")
    a = ap.parse_args(argv)

    try:
        if a.befehl == "pruefen":
            if not a.datei.is_file():
                print(f"Datei nicht gefunden: {a.datei}", file=sys.stderr)
                return 1
            b = pruefen(a.datei, regeln=not a.ohne_regeln)
            print(json.dumps(b, ensure_ascii=False, indent=1))
            return 0 if b["gueltig"] and b["neutral"] else 1
        k = katalog(getattr(a, "projekt", None))
        berichte = []
        if a.befehl == "muster":
            for art, zusatz in (("teile", ""), ("schichten", "staenderwand-als-schichten")):
                f, info = muster_projekt(a.schema, art, k)
                pfad = schreiben(f, a.ordner / dateiname("bauteilkatalog-muster", a.schema, zusatz))
                berichte.append(_bericht(pfad, {"zaehler": info["zaehler"], "nachlauf": info["nachlauf"]}))
        else:
            for erzeugnis, fn in (("materialbibliothek", materialbibliothek), ("bauteiltypen", typbibliothek)):
                pfad = schreiben(fn(a.schema, k), a.ordner / dateiname(erzeugnis, a.schema))
                berichte.append(_bericht(pfad))
    except NichtVerfuegbar as e:
        print(str(e), file=sys.stderr)
        return EXIT_NICHT_VERFUEGBAR
    except (NeutralitaetsFehler, ValueError, OSError, RuntimeError) as e:
        # KatalogFehler is a ValueError: invalid catalogue data or runtime type; `pruefen` turns an
        # unreadable IFC file into a ValueError; RuntimeError: non-unique GlobalIds after the rewrite.
        print(f"Abbruch: {e}", file=sys.stderr)
        return 1
    print(json.dumps(berichte, ensure_ascii=False, indent=1))
    return 0 if all(b["gueltig"] and b["neutral"] and b["proxys"] == 0 and not b["ohne_typ"] for b in berichte) else 1


if __name__ == "__main__":
    sys.exit(main())
