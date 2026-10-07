---
name: skill-new
description: Legt einen neuen Skill mit SKILL.md-Gerüst an
version: 0.1.0
mode: developer
tools: [skill_new]
platforms: []
---

# /skill-new <name> — <Beschreibung>

Lege einen neuen Skill unter `skills/<name>/SKILL.md` an. Regeln:

1. `name` ist kebab-case (a-z, 0-9, Bindestrich).
2. `description` ist **ein Satz mit höchstens 60 Zeichen** — sie steht im
   System-Prompt jeder Session; jedes Zeichen kostet in jedem Aufruf Tokens.
3. `mode` ist `developer`, `user` oder `both`. Im Zweifel `developer`.
4. Alles Nicht-Triviale gehört in `scripts/`, nicht als Inline-Code in die
   Anleitung (Hermes-Standard: kein Parser je Aufruf neu erfinden).

Vorgehen: Rufe `skill_new` mit `name`, `description`, `mode` und — wenn die
Argumente eine Anleitung enthalten — `body` auf. Melde den Pfad zurück und
weise darauf hin, dass der Skill ab der nächsten Session (oder nach `/now`)
im Index erscheint.
