#!/bin/sh
# BIT-Atelier - open a .bitproj project file (plan 93-10). install.sh registers this script in the
# desktop entry bit-atelier-datei.desktop (MimeType application/x-bitproj). It only finds Node.js and
# hands the file to tools/datei-oeffnen.mjs, which starts BIT-Atelier when needed and shows the import
# preview in the app.
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "BIT-Atelier needs Node.js 22.9 or newer (https://nodejs.org)."
  exit 1
fi
exec node tools/datei-oeffnen.mjs "$@"
