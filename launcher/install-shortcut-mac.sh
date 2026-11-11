#!/usr/bin/env bash
# Creates "Kenney Asset Index.app" on the desktop (macOS counterpart of
# install-shortcut.ps1). Safe to re-run: an existing app is replaced.
#
# The app is a tiny AppleScript applet. Apps started from Finder do not get the
# shell's PATH (nvm, Homebrew), so the absolute path of the node found now is
# baked in. Re-run this script after switching node versions or moving the repo.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
launch="$here/launch.mjs"
ico="$here/kenney-assets.ico"
app="${KENNEY_APP_DIR:-$HOME/Desktop}/Kenney Asset Index.app"

[ -f "$launch" ] || { echo "Missing: $launch" >&2; exit 1; }
node_bin="$(command -v node || true)"
[ -n "$node_bin" ] || { echo "node not found on PATH" >&2; exit 1; }
command -v osacompile > /dev/null || { echo "osacompile not found (macOS only)" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# quoted form of keeps spaces and quotes in either path from breaking the
# command; the redirect and & let the applet return at once while the server
# keeps running.
# Escape for an AppleScript string literal.
esc() { local v="${1//\\/\\\\}"; printf '%s' "${v//\"/\\\"}"; }
script="$work/launch.applescript"
cat > "$script" <<APPLESCRIPT
set nodeBin to "$(esc "$node_bin")"
set launchJs to "$(esc "$launch")"
do shell script quoted form of nodeBin & " " & quoted form of launchJs & " > /dev/null 2>&1 &"
APPLESCRIPT

rm -rf "$app"
osacompile -o "$app" "$script"

# Icon (errexit is off inside the "if" below, so each step stays best effort): pull the largest PNG out of the .ico and build an .icns from it. Any
# failure here only costs the icon, never the app.
make_icns() {
  local png="$work/icon.png" set="$work/icon.iconset"
  node -e '
    const fs = require("fs"), d = fs.readFileSync(process.argv[1])
    let best = null
    for (let i = 0; i < d.readUInt16LE(4); i++) {
      const e = 6 + 16 * i, size = d.readUInt32LE(e + 8), off = d.readUInt32LE(e + 12)
      if (!best || size > best.size) best = { size, off }
    }
    fs.writeFileSync(process.argv[2], d.subarray(best.off, best.off + best.size))
  ' "$ico" "$png"
  mkdir "$set"
  # The .ico tops out at 256px, so there is no 512 variant.
  for spec in 16:16x16 32:16x16@2x 32:32x32 64:32x32@2x 128:128x128 256:128x128@2x 256:256x256; do
    sips -z "${spec%%:*}" "${spec%%:*}" "$png" --out "$set/icon_${spec#*:}.png" > /dev/null
  done
  iconutil -c icns "$set" -o "$app/Contents/Resources/applet.icns"
  # Newer macOS prefers the default icon in Assets.car (named by
  # CFBundleIconName) over applet.icns, so drop it, then re-sign ad hoc
  # because the bundle changed.
  rm -f "$app/Contents/Resources/Assets.car"
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$app/Contents/Info.plist" 2> /dev/null || true
  codesign --force --sign - "$app" 2> /dev/null || true
}
if [ -f "$ico" ] && make_icns; then
  touch "$app"   # nudge Finder to refresh the icon
else
  echo "Note: could not set the icon; the app uses the default applet icon." >&2
fi

echo "Created: $app"
