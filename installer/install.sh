#!/bin/sh
# BIT-Atelier - installer for macOS / Linux (plan 92-02).
#   curl -fsSL https://github.com/mozzi86/bit-atelier-oss/releases/latest/download/install.sh | sh
# Downloads the latest release, verifies its SHA-256, installs to ~/BIT-Atelier (keeps an existing "daten"
# folder and .env), adds a launcher (Linux: application menu entry, macOS: ~/Applications/BIT-Atelier.command)
# and starts the app. Later updates come from inside the app.
set -eu
REPO="mozzi86/bit-atelier-oss"
ZIEL="${BIT_ATELIER_ZIEL:-$HOME/BIT-Atelier}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
say() { echo "[BIT-Atelier] $*"; }

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
    say "Launcher: ~/Applications/BIT-Atelier.command" ;;
  *)
    mkdir -p "$HOME/.local/share/applications"
    printf '[Desktop Entry]\nType=Application\nName=BIT-Atelier\nExec=sh -c "cd \\"%s\\" && ./start.sh"\nTerminal=true\nCategories=Office;\n' "$ZIEL" > "$HOME/.local/share/applications/bit-atelier.desktop"
    say "Launcher: application menu entry BIT-Atelier" ;;
esac
say "Installed to $ZIEL. Starting - the first start installs the runtime packages (a few minutes)."
cd "$ZIEL" && exec ./start.sh
