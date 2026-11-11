# Desktop launcher

Double-click **Kenney Asset Index** on the desktop (a shortcut on Windows, an
app on macOS). It starts the server if it is not already running, waits for it
to answer, and opens the browser. No console window appears.

| file | what it is |
|------|------------|
| `Kenney Asset Index.vbs` | hidden-window wrapper; the shortcut targets this |
| `launch.mjs` | finds a port, starts the server, waits, opens the browser |
| `make-icon.mjs` | builds `kenney-assets.ico` from an asset in the library |
| `install-shortcut.ps1` | (re)creates the desktop shortcut (Windows) |
| `install-shortcut-mac.sh` | (re)creates the desktop app (macOS) |
| `server.log` | last run's server output; read this if it fails to open |

## Windows

Re-create the shortcut after moving the repo:

```powershell
powershell -ExecutionPolicy Bypass -File launcher\install-shortcut.ps1
```

## macOS

```bash
bash launcher/install-shortcut-mac.sh
```

This builds `~/Desktop/Kenney Asset Index.app` (an AppleScript applet, with
the icon converted from `kenney-assets.ico`). Apps started from Finder do not
inherit your shell's PATH, so the script bakes in the absolute path of the
`node` it finds when you run it. Re-run it after moving the repo or switching
node versions (nvm, Homebrew); it replaces the existing app. Problems are
shown in a dialog, as on Windows.

On Linux there is no installer; run `node launcher/launch.mjs` (it uses
`xdg-open`, and `zenity` for error dialogs when present).

## Notes

**Port.** Defaults to 7823, falling back to 7824-7826. It is not 5173 because
something else on this machine already uses that. Override with `KENNEY_PORT`.

**Identity, not liveness.** A port is only treated as "already ours" when
`/api/stats` answers with this app's JSON. An earlier version checked only
whether *something* answered, found an unrelated dev server on 5173, and would
have opened the browser onto the wrong app.

**Both loopback stacks.** Vite binds `::1`, not `127.0.0.1`. Probing or
binding a single hardcoded loopback address disagrees with reality -- a
127.0.0.1 probe finds nothing while a 127.0.0.1 bind succeeds, so the launcher
concluded both "not running" and "port is free" about a port that was neither,
then died with `Port 7823 is already in use`. Both `::1` and `127.0.0.1` are
now checked, and a port counts as free only when every one of them is.

**Stopping it.** The server keeps running in the background until you log out.
To stop it sooner, end the node process whose command line mentions `vite`
(Windows: the `node.exe` task in Task Manager; macOS: Activity Monitor, or
`pkill -f "vite.*--port 782"`), or just leave it -- it is idle when nothing is
using it.

**Failures are visible.** If dependencies are missing or the server does not
come up in 90 seconds, a dialog explains why rather than the icon appearing to
do nothing.
