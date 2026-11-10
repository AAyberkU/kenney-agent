/**
 * `assets pack-index [--out <zip>]`: bundle the built index for a GitHub
 * release, so `assets setup` can skip the slow local build.
 *
 * The archive holds:
 *   index/assets.db          a compacted copy (VACUUM INTO: no -wal/-shm)
 *   index/index-info.json    when it was built and what it holds
 *   assets/renders/**        3D model renders and font specimens the index
 *                            points at (preview_path)
 *
 * Upload it as the release asset `kenney-agent-index.zip`; setup downloads
 * releases/latest/download/kenney-agent-index.zip.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { openDb, getMeta } from "../../lib/db.mjs"
import { ROOT, corpusRepoRoot } from "../../lib/config.mjs"

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export async function packIndex({ out = path.join(ROOT, "release", "kenney-agent-index.zip") } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kenney-agent-index-"))
  const copy = path.join(tmp, "assets.db")
  const db = openDb({ readonly: true })
  const info = {
    builtAt: getMeta(db, "built_at"),
    analyzedAt: getMeta(db, "analyzed_at"),
    assets: db.prepare("SELECT count(*) c FROM assets").get().c,
    packs: db.prepare("SELECT count(DISTINCT pack) c FROM assets").get().c,
    described: db.prepare("SELECT count(*) c FROM assets WHERE observed IS NOT NULL").get().c,
    corpusCommit: null,
  }
  db.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`)
  db.close()
  const git = spawnSync("git", ["-C", corpusRepoRoot(), "rev-parse", "HEAD"], { encoding: "utf-8" })
  if (git.status === 0) info.corpusCommit = git.stdout.trim()

  // The machine-specific corpus path is not worth shipping.
  const { DatabaseSync } = await import("node:sqlite")
  const w = new DatabaseSync(copy)
  w.exec("DELETE FROM meta WHERE key = 'assets_root'")
  w.close()

  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  zip.file("index/assets.db", fs.readFileSync(copy))
  zip.file("index/index-info.json", JSON.stringify(info, null, 2) + "\n")
  const renders = path.join(ROOT, "assets", "renders")
  let previews = 0
  if (fs.existsSync(renders)) {
    for (const f of walk(renders)) {
      zip.file(path.relative(ROOT, f).split(path.sep).join("/"), fs.readFileSync(f))
      previews++
    }
  }
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } })
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, buf)
  fs.rmSync(tmp, { recursive: true, force: true })
  return { out, bytes: buf.length, previews, ...info }
}
