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
