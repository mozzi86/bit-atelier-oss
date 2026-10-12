#!/bin/sh
# BIT-Atelier - installer for macOS / Linux (plan 92-02).
#   curl -fsSL https://github.com/mozzi86/bit-atelier-oss/releases/latest/download/install.sh | sh
# Downloads the latest release, verifies its SHA-256, installs to ~/BIT-Atelier (keeps an existing "daten"
# folder and .env), adds a launcher (Linux: application menu entry, macOS: ~/Applications/BIT-Atelier.command)
# and starts the app. Later updates come from inside the app.
# File association (plan 93-10, Linux only): *.bitproj -> application/x-bitproj -> tools/datei-oeffnen.sh
#   (~/.local/share/mime + a hidden desktop entry, default via xdg-mime). macOS: not supported (no app bundle).
# Uninstall (plan 92-06):  sh ~/BIT-Atelier/installer/install.sh --entfernen   (or --uninstall;
#   via curl: curl -fsSL .../install.sh | sh -s -- --entfernen) - stops a running BIT-Atelier, asks whether
#   the data folder stays (default: yes, a backup copy is offered before deleting), removes program,
#   .update, node_modules and the launcher.
set -eu
REPO="mozzi86/bit-atelier-oss"
ZIEL="${BIT_ATELIER_ZIEL:-$HOME/BIT-Atelier}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
say() { echo "[BIT-Atelier] $*"; }

# Yes/no question; answers come from the terminal even when this script itself arrives through a pipe.
# $1 question, $2 default (j|n). Returns 0 for yes.
frage() {
  printf '[BIT-Atelier] %s ' "$1"
  antwort=""
  # No terminal (e.g. started by another program): the default answer counts.
  if { read -r antwort < /dev/tty; } 2>/dev/null; then :; else antwort=""; echo "($2)"; fi
  [ -n "$antwort" ] || antwort="$2"
  case "$antwort" in [YyJj]*) return 0 ;; *) return 1 ;; esac
}

# 93-10: .bitproj -> BIT-Atelier on Linux, per user: a shared-mime-info type plus a hidden desktop entry with
# MimeType, set as default with xdg-mime. Removed again by the uninstall (only while it points here).
MIME_XML="$HOME/.local/share/mime/packages/bit-atelier-bitproj.xml"
DATEI_DESKTOP="$HOME/.local/share/applications/bit-atelier-datei.desktop"
datei_zuordnen() {
  [ -f "$ZIEL/tools/datei-oeffnen.sh" ] || return 0
  mkdir -p "$(dirname "$MIME_XML")" "$(dirname "$DATEI_DESKTOP")"
  cat > "$MIME_XML" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-bitproj">
    <comment>BIT-Atelier-Projekt</comment>
    <glob pattern="*.bitproj"/>
  </mime-type>
</mime-info>
XML
  printf '[Desktop Entry]\nType=Application\nName=BIT-Atelier (Projektdatei)\nExec=sh "%s/tools/datei-oeffnen.sh" %%f\nIcon=%s/public/favicon.ico\nTerminal=false\nNoDisplay=true\nMimeType=application/x-bitproj;\n' "$ZIEL" "$ZIEL" > "$DATEI_DESKTOP"
  if command -v update-mime-database >/dev/null 2>&1; then update-mime-database "$HOME/.local/share/mime" >/dev/null 2>&1 || true; fi
  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true; fi
  if command -v xdg-mime >/dev/null 2>&1; then xdg-mime default bit-atelier-datei.desktop application/x-bitproj >/dev/null 2>&1 || true; fi
}
datei_entfernen() {
  [ -f "$DATEI_DESKTOP" ] || return 0
  if ! grep -qF "$ZIEL/tools/datei-oeffnen.sh" "$DATEI_DESKTOP"; then
    say "The .bitproj association belongs to another installation - left unchanged."
    return 0
  fi
  rm -f "$DATEI_DESKTOP" "$MIME_XML"
  if command -v update-mime-database >/dev/null 2>&1; then update-mime-database "$HOME/.local/share/mime" >/dev/null 2>&1 || true; fi
  say "Removed the .bitproj file association."
}

entfernen() {
  case "$ZIEL" in ""|/|"$HOME"|"$HOME/") say "Refusing to remove $ZIEL."; exit 1 ;; esac
  say "Uninstalling BIT-Atelier from $ZIEL  [Deutsch: BIT-Atelier wird entfernt]"
  # a) Stop a running BIT-Atelier - only when the port really answers as BIT-Atelier.
  PORT="${API_PORT:-3001}"
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/status" 2>/dev/null | grep -q '"name":"bit-atelier"'; then
    PIDS=""
    if command -v lsof >/dev/null 2>&1; then PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"; fi
    if [ -z "$PIDS" ] && command -v fuser >/dev/null 2>&1; then PIDS="$(fuser "$PORT/tcp" 2>/dev/null || true)"; fi
    if [ -z "$PIDS" ]; then say "BIT-Atelier runs on port $PORT, but its process was not found - stop it (Ctrl+C) and run this again."; exit 1; fi
    # shellcheck disable=SC2086 # several PIDs on purpose
    kill $PIDS 2>/dev/null || true
    sleep 2
    say "Stopped the running BIT-Atelier (port $PORT)."
  fi
  # b) The data folder stays unless the user says otherwise; a backup copy is offered before deleting.
  BEHALTEN=1
  if [ -d "$ZIEL/daten" ]; then
    say "Your data folder (projects, settings): $ZIEL/daten"
    if ! frage "Keep your data? (Y/n)  [Deutsch: Daten behalten? (J/n)]" j; then
      BEHALTEN=0
      if frage "Copy a backup of the data to your home folder first? (Y/n)  [Deutsch: Vorher Sicherung kopieren? (J/n)]" j; then
        KOPIE="$HOME/BIT-Atelier-Daten-$(date +%Y-%m-%d-%H%M)"
        cp -R "$ZIEL/daten" "$KOPIE"
        say "Backup copied to $KOPIE"
      fi
      if ! frage "Really delete the data folder? This cannot be undone. (y/N)  [Deutsch: Daten wirklich loeschen? (j/N)]" n; then
        BEHALTEN=1
        say "Data kept."
      fi
    fi
  fi
  # c) Program files, .update, node_modules - everything except daten and .env when the data stay.
  if [ -d "$ZIEL" ]; then
    if [ "$BEHALTEN" = 1 ]; then
      find "$ZIEL" -mindepth 1 -maxdepth 1 ! -name daten ! -name .env -exec rm -rf {} +
    else
      rm -rf "$ZIEL"
    fi
  else
    say "No installation found in $ZIEL."
  fi
  # d) Launchers.
  rm -f "$HOME/Applications/BIT-Atelier.command" "$HOME/.local/share/applications/bit-atelier.desktop"
  datei_entfernen
  if [ "$BEHALTEN" = 1 ] && [ -d "$ZIEL/daten" ]; then
    say "BIT-Atelier was removed. Your data stay in $ZIEL/daten - installing again picks them up.  [Deutsch: Programm entfernt, Daten bleiben.]"
  else
    say "BIT-Atelier and its data were removed.  [Deutsch: Programm und Daten entfernt.]"
  fi
}

for a in "$@"; do
  case "$a" in --entfernen|--uninstall) entfernen; exit 0 ;; esac
done

if ! command -v node >/dev/null 2>&1 || ! node -e "var v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=9)?0:1)"; then
  say "Node.js 22.9 or newer is needed. Install it from https://nodejs.org (macOS: brew install node@22) and run this again."
  exit 1
fi
for t in curl unzip; do command -v "$t" >/dev/null 2>&1 || { say "Missing tool: $t"; exit 1; }; done

BASIS="https://github.com/$REPO/releases/latest/download"
say "Downloading the latest version ..."
curl -fsSL "$BASIS/BIT-Atelier.zip" -o "$TMP/BIT-Atelier.zip"
if curl -fsSL "$BASIS/BIT-Atelier.zip.sha256" -o "$TMP/sha" 2>/dev/null; then
  SOLL="$(grep -oiE '[a-f0-9]{64}' "$TMP/sha" | head -1 | tr 'A-F' 'a-f')"
  if command -v sha256sum >/dev/null 2>&1; then IST="$(sha256sum "$TMP/BIT-Atelier.zip" | cut -d' ' -f1)"; else IST="$(shasum -a 256 "$TMP/BIT-Atelier.zip" | cut -d' ' -f1)"; fi
  [ "$SOLL" = "$IST" ] || { say "Checksum mismatch - download discarded."; exit 1; }
  say "Checksum OK."
else
  say "Warning: this release has no checksum file - installing without verification."
fi

unzip -q "$TMP/BIT-Atelier.zip" -d "$TMP"
[ -f "$TMP/BIT-Atelier/package.json" ] || { say "The download does not contain the app."; exit 1; }
if [ -d "$ZIEL" ]; then
  say "Existing installation in $ZIEL - replacing the program, keeping your data."
  find "$ZIEL" -mindepth 1 -maxdepth 1 ! -name daten ! -name .env -exec rm -rf {} +
else
  mkdir -p "$ZIEL"
fi
cp -R "$TMP/BIT-Atelier/." "$ZIEL/"
chmod +x "$ZIEL/start.sh"

case "$(uname -s)" in
  Darwin)
    mkdir -p "$HOME/Applications"
    printf '#!/bin/sh\ncd "%s" && ./start.sh\n' "$ZIEL" > "$HOME/Applications/BIT-Atelier.command"
    chmod +x "$HOME/Applications/BIT-Atelier.command"
    say "Launcher: ~/Applications/BIT-Atelier.command"
    # 93-10: a .bitproj double-click needs an app bundle (CFBundleDocumentTypes) on macOS - not provided.
    say "Note: no double-click on .bitproj on macOS - open one with: sh \"$ZIEL/tools/datei-oeffnen.sh\" <file.bitproj>" ;;
  *)
    mkdir -p "$HOME/.local/share/applications"
    printf '[Desktop Entry]\nType=Application\nName=BIT-Atelier\nExec=sh -c "cd \\"%s\\" && ./start.sh"\nTerminal=true\nCategories=Office;\n' "$ZIEL" > "$HOME/.local/share/applications/bit-atelier.desktop"
    say "Launcher: application menu entry BIT-Atelier"
    datei_zuordnen
    say "File type .bitproj registered: a double-click opens the project in BIT-Atelier." ;;
esac
say "Installed to $ZIEL. Starting - the first start installs the runtime packages (a few minutes)."
cd "$ZIEL" && exec ./start.sh
