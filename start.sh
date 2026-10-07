#!/bin/sh
# BIT-Atelier - start on macOS / Linux (plan 83-03). Run: ./start.sh
#  1. checks Node.js (22.9 or newer)
#  2. first start only: installs the runtime packages (and builds the app when
#     dist/ is missing, i.e. when started from a source checkout)
#  3. runs app + API on http://localhost:3001 and opens the browser
# Data: the folder "daten" next to this file. Stop: Ctrl+C.
# Options (environment): API_PORT=<port>, BIT_KEIN_BROWSER=1 (no browser).

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

if [ ! -d node_modules ]; then
  if [ -f dist/index.html ]; then
    echo "[BIT-Atelier] First start: installing the runtime packages - this takes a few minutes ..."
    npm ci --omit=dev --no-audit --no-fund || { echo "[BIT-Atelier] Installing failed - see the messages above."; exit 1; }
  else
    echo "[BIT-Atelier] First start from source: installing packages and building the app - this takes several minutes ..."
    npm ci --no-audit --no-fund || { echo "[BIT-Atelier] Installing failed - see the messages above."; exit 1; }
  fi
fi
if [ ! -f dist/index.html ]; then
  echo "[BIT-Atelier] Building the app ..."
  npm run build || { echo "[BIT-Atelier] Building failed - see the messages above."; exit 1; }
fi

BIT_DATA_DIR="$(pwd)/daten"
export BIT_DATA_DIR

if [ -z "${BIT_KEIN_BROWSER:-}" ]; then
  # Background: wait until the server answers, then open the browser.
  (
    if node tools/port-warten.mjs "$PORT" 120; then
      URL="http://localhost:$PORT"
      case "$(uname -s)" in
        Darwin) open "$URL" ;;
        *) if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; else echo "Open $URL in your browser."; fi ;;
      esac
    fi
  ) &
fi

echo "[BIT-Atelier] Starting on http://localhost:$PORT - stop with Ctrl+C."
exec node --env-file-if-exists=.env server/index.js --app
