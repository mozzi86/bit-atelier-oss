#!/bin/sh
# BIT-Atelier - start on macOS / Linux (plan 83-03). Run: ./start.sh
#  1. checks Node.js (22.9 or newer)
#  2. first start only: installs the runtime packages (and builds the app when
#     dist/ is missing, i.e. when started from a source checkout)
#  3. runs app + API on http://localhost:3001 and opens the browser
# Data: the folder "daten" next to this file. Stop: Ctrl+C.
# Options (environment): API_PORT=<port>, BIT_KEIN_BROWSER=1 (no browser), BIT_FENSTER=0 (browser tab instead
# of the own app window, plan 93-11).
# 92-08: when the package installation fails, "npm ping" tells a network problem (no internet, company proxy,
# blocked registry) from other errors, and the message says what to do in English and German.

cd "$(dirname "$0")" || exit 1
PORT="${API_PORT:-3001}"
export API_PORT="$PORT"

if ! command -v node >/dev/null 2>&1; then
  echo "BIT-Atelier needs Node.js 22.9 or newer, and Node.js was not found."
  echo "Install the LTS version from https://nodejs.org and run ./start.sh again."
  exit 1
fi
if ! node -e "var v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=9)?0:1)"; then
  echo "Found Node.js $(node --version) - BIT-Atelier needs 22.9 or newer."
  echo "Install the current LTS version from https://nodejs.org and run ./start.sh again."
  exit 1
fi

npm_fehler() {
  # A half-installed node_modules would make the next start skip the installation.
  rm -rf node_modules
  if npm ping --fetch-timeout=15000 --fetch-retries=0 >/dev/null 2>&1; then
    echo "[BIT-Atelier] Installing failed - see the messages above."
    exit 1
  fi
  REGISTRY="$(npm config get registry 2>/dev/null || echo 'the npm registry')"
  cat <<EOF

[BIT-Atelier] The runtime packages could not be downloaded: $REGISTRY
is not reachable from this computer (no internet, a company proxy or a firewall).
What helps:
 - Behind a company proxy (ask your IT for the address):
     npm config set proxy http://proxy.example:8080
     npm config set https-proxy http://proxy.example:8080
 - Your company has its own package registry:
     npm config set registry https://npm.example.com/
 - No internet on this computer: install BIT-Atelier on a computer with internet,
   then copy the whole folder (including node_modules) to this computer.
Then run ./start.sh again.

(Deutsch: Die Laufzeitpakete konnten nicht geladen werden - die Paketquelle ist von
 diesem Rechner aus nicht erreichbar: kein Internet, Firmen-Proxy oder Firewall.
 Hinter einem Proxy: die zwei Zeilen "npm config set proxy" / "https-proxy" mit der
 Adresse Ihrer IT ausfuehren. Eigene Firmen-Registry: "npm config set registry ...".
 Ohne Internet: auf einem Rechner mit Internet installieren und den ganzen Ordner samt
 node_modules hierher kopieren. Danach ./start.sh erneut starten.)
EOF
  exit 1
}

if [ ! -d node_modules ]; then
  if [ -f dist/index.html ]; then
    echo "[BIT-Atelier] First start: installing the runtime packages - this takes a few minutes ..."
    npm ci --omit=dev --no-audit --no-fund || npm_fehler
  else
    echo "[BIT-Atelier] First start from source: installing packages and building the app - this takes several minutes ..."
    npm ci --no-audit --no-fund || npm_fehler
  fi
fi
if [ ! -f dist/index.html ]; then
  echo "[BIT-Atelier] Building the app ..."
  npm run build || { echo "[BIT-Atelier] Building failed - see the messages above."; exit 1; }
fi

# 93-13: default data folder only when neither the environment nor .env names one (node --env-file never
# overrides a variable that is already set, so setting it unconditionally ignored .env).
if [ -z "${BIT_DATA_DIR:-}" ] && ! grep -q '^BIT_DATA_DIR=' .env 2>/dev/null; then
  BIT_DATA_DIR="$(pwd)/daten"
  export BIT_DATA_DIR
fi

if [ -z "${BIT_KEIN_BROWSER:-}" ]; then
  # Background: wait until the server answers, then open the browser.
  (
    if node tools/port-warten.mjs "$PORT" 120; then
      URL="http://localhost:$PORT/"
      # 93-11: own app window (Edge/Chrome/Chromium --app); falls back to open/xdg-open itself.
      node tools/app-fenster.mjs "$URL" || echo "Open $URL in your browser."
    fi
  ) &
fi

echo "[BIT-Atelier] Starting on http://localhost:$PORT - stop with Ctrl+C."
exec node --env-file-if-exists=.env server/index.js --app
