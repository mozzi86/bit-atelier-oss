# Sicherheit / Security

Bitte melden Sie Sicherheitslücken **nicht** als öffentliches Issue, sondern per E-Mail an
**me@bit-atelier.de** (Betreff „Security“). Sie erhalten eine Antwort, sobald es möglich ist.

Please report vulnerabilities **privately** to **me@bit-atelier.de** (subject “Security”), not as a public issue.

## Wichtig für den Betrieb / Operating notes

- Die lokale API (`:3001`), der KI-Harness (`:8765`) und der MCP-Server haben **keine Anmeldung**.
  Sie lauschen nur auf `127.0.0.1`. Geben Sie diese Ports nie im Netzwerk oder Internet frei.
- API-Schlüssel für KI-Anbieter gehören in `.env` bzw. in die lokale Installation, nie in ein Repository.
- The local API, the AI harness and the MCP server have **no authentication** and bind to `127.0.0.1` only.
  Never expose these ports to a network.

## Büro-Modus (Mehrplatz) / Office mode

Ein zweiter Arbeitsplatz oder ein Tablet im **selben Büro-Netz** kann die installierte App mitbenutzen,
wenn der Büro-Modus unter Einstellungen › System & Info eingeschaltet ist. Vorgabe: **aus**.

- Einschalten, Koppel-Codes erzeugen und Geräte widerrufen geht nur am Büro-Rechner selbst.
- Jedes andere Gerät braucht eine **Kopplung**: 6-stelliger Code vom Büro-Rechner (10 Minuten gültig,
  einmal verwendbar, nach 5 Fehlversuchen verbrannt, höchstens 10 Versuche je Adresse in 10 Minuten),
  danach ein langer Geräte-Schlüssel (httpOnly-Cookie, SameSite=Strict; 30 Tage gültig). In `buero.json`
  im Datenordner steht nur dessen SHA-256.
- Nur private Absenderadressen (10/8, 172.16/12, 192.168/16, 169.254/16, fe80::/10, fc00::/7); der Server
  lauscht zusätzlich nur auf den privaten IPv4-Adressen des Rechners. Öffentliche Adressen → 403.
- Gekoppelte Geräte erreichen Projektdaten, Kataloge, Dateien und den KI-Aufruf. **Nicht**: Personaldaten
  (außer `PERSONAL_LAN=1`), KI-Zugänge/Schlüssel, Datenordner, Updates, Büro-Modus-Verwaltung.
- **Keine Verschlüsselung im LAN (kein HTTPS).** Wer im selben Netz mitliest, sieht Projektdaten und kann den
  Geräte-Schlüssel abgreifen. Nur in einem vertrauenswürdigen Büro-Netz verwenden — nie im Gäste- oder
  öffentlichen WLAN, nie per Portweiterleitung oder Tunnel ins Internet.
- Das Cookie gilt für die Adresse des Büro-Rechners, nicht für den Port: Andere Dienste auf demselben Rechner,
  die im LAN erreichbar sind, könnten es mitlesen. Keine fremden Webdienste auf dem Büro-Rechner freigeben.
- `API_HOST` öffnet die API seit 93-03 nicht mehr ohne Anmeldung: Auch dann brauchen andere Geräte Büro-Modus
  und Kopplung.

Office mode lets a second workstation or a tablet in the same office LAN use the installed app after pairing
with a code shown on the host (off by default). Device tokens are stored hashed and expire after 30 days; only
private source addresses are accepted. **There is no TLS in the LAN** — use trusted networks only.
