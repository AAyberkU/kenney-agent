import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Start the app and open it. Nothing to type, nothing to read.
 *
 * Port handling is deliberately paranoid. An earlier version asked only
 * "does anything answer on this port?", found an unrelated dev server on 5173,
 * and would have opened the browser onto someone else's app. Liveness is not
 * identity: a port only counts as ours if /api/stats answers with our JSON.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")
const LOG = path.join(HERE, "server.log")

// Uncommon by default so a collision is unlikely in the first place; the
// fallbacks cover the case where it happens anyway.
const PORTS = process.env.KENNEY_PORT
  ? [Number(process.env.KENNEY_PORT)]
  : [7823, 7824, 7825, 7826]

// Vite binds ::1 on this machine, not 127.0.0.1. Probing or binding a single
// hardcoded loopback address disagrees with reality: a 127.0.0.1 probe finds
// nothing while a 127.0.0.1 bind succeeds, so the launcher concluded both
// "not running" and "port free" about a port that was neither.
const LOOPBACK = ["::1", "127.0.0.1"]

function get(host, port, urlPath, timeout = 1200) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: urlPath, timeout }, (res) => {
      let body = ""
      res.setEncoding("utf-8")
      res.on("data", (c) => { if (body.length < 4096) body += c })
      res.on("end", () => resolve({ status: res.statusCode, body }))
    })
    req.on("error", () => resolve(null))
    req.on("timeout", () => { req.destroy(); resolve(null) })
  })
}

/** Ours, or something else wearing the same port number? Checks both stacks. */
async function isOurs(port) {
  for (const host of LOOPBACK) {
    const res = await get(host, port, "/api/stats")
    if (!res || res.status !== 200) continue
    try {
      if (typeof JSON.parse(res.body)?.assetsRoot === "string") return true
    } catch {
      // Something answered but is not us; keep checking the other stack.
    }
  }
  return false
}

function bindFree(host, port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => resolve(false))
    srv.once("listening", () => srv.close(() => resolve(true)))
    srv.listen(port, host)
  })
}

/** Free only when every loopback address is free -- one is not enough. */
async function portFree(port) {
  for (const host of LOOPBACK) if (!(await bindFree(host, port))) return false
  return true
}

function detach(cmd, args) {
  // A missing opener must not crash the launcher: swallow the spawn error.
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true })
  child.on("error", () => {})
  child.unref()
  return child
}

function openBrowser(url) {
  if (process.platform === "darwin") return void detach("open", [url])
  if (process.platform !== "win32") return void detach("xdg-open", [url])
  // `start` is a cmd builtin. The empty string is the window title it expects
  // before a quoted argument; without it the URL is consumed as the title.
  detach("cmd", ["/c", "start", "", url])
}

function fail(message) {
  // There is no console to print to, so say it where it will be seen.
  if (process.platform === "darwin") {
    // The message travels as argv, never spliced into the script, so quotes
    // or backslashes in it cannot be read as AppleScript.
    detach("osascript", [
      "-e", "on run argv",
      "-e", 'display dialog (item 1 of argv) with title "Kenney Asset Index" buttons {"OK"} default button "OK" with icon stop',
      "-e", "end run",
      message,
    ])
    return
  }
  if (process.platform !== "win32") {
    // No zenity (or no display): stderr is all that is left.
    detach("zenity", ["--error", "--title=Kenney Asset Index", "--no-markup", "--text=" + message])
      .on("error", () => console.error(message))
    return
  }
  detach("mshta", [
    `javascript:var s=new ActiveXObject("WScript.Shell");s.Popup(${JSON.stringify(message)},0,"Kenney Asset Index",16);close()`,
  ])
}

const vite = path.join(ROOT, "node_modules", "vite", "bin", "vite.js")
if (!fs.existsSync(vite)) {
  fail("Dependencies are missing.\n\nOpen a terminal in:\n" + ROOT + "\n\nand run:  npm install")
  process.exit(1)
}

// Already running? Just show it.
for (const port of PORTS) {
  if (await isOurs(port)) {
    openBrowser(`http://localhost:${port}/`)
    process.exit(0)
  }
}

const port = await (async () => {
  for (const p of PORTS) if (await portFree(p)) return p
  return null
})()

if (!port) {
  fail("Could not find a free port.\n\nTried: " + PORTS.join(", ") +
       "\n\nClose whatever is using them, or set KENNEY_PORT.")
  process.exit(1)
}

fs.appendFileSync(LOG, `
--- ${new Date().toISOString()} starting on port ${port} ---
`)
const out = fs.openSync(LOG, "a")
spawn(process.execPath, [vite, "--port", String(port), "--strictPort"], {
  cwd: ROOT,
  detached: true,
  windowsHide: true,
  stdio: ["ignore", out, out],
}).unref()

// Wait for it to actually answer as itself, rather than guessing a delay.
const deadline = Date.now() + 90_000
let up = false
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 400))
  if (await isOurs(port)) { up = true; break }
}

if (up) {
  openBrowser(`http://localhost:${port}/`)
} else {
  const tail = fs.existsSync(LOG)
    ? fs.readFileSync(LOG, "utf-8").split("\n").filter(Boolean).slice(-12).join("\n")
    : "(no output)"
  fail("The server did not come up within 90 seconds.\n\nLast output:\n\n" + tail)
  process.exit(1)
}
