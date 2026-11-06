import fs from "node:fs"
import path from "node:path"
import { openDb } from "../../lib/db.mjs"
import { ROOT } from "../../lib/config.mjs"
import { buildSheet } from "./sheet.mjs"

/**
 * Contact sheets for writing descriptions by eye, one pack at a time.
 *
 * Packs with opaque file names (tile_0047.png) are only findable through
 * descriptions. This renders the pack's images onto numbered sheets and
 * writes a key from each printed number to the asset's pack-relative path,
 * so whoever looks at the sheets (an agent reading the PNGs) can write
 * descriptions/<pack>.json without touching row ids, which do not survive a
 * rebuild. `assets descriptions import --packs <pack>` then loads them.
 *
 * Numbers run 1..N across the whole pack, so each is unique across sheets.
 * Nothing is sent anywhere; this only writes files under index/describe/.
 */

// Overview renders show the whole pack and carry the Kenney logo; they are
// not game art and are not worth describing.
const OVERVIEW = /^(preview|sample)\b/i

export async function describeSheets({ pack, undescribed = false, perSheet = 48, cols = 8, cell = 128, trim = false } = {}) {
  if (!Number.isInteger(perSheet) || perSheet < 1 || perSheet > 256) throw new Error("--per-sheet must be 1..256")
  const db = openDb({ readonly: true })
  if (!db.prepare("SELECT 1 FROM packs WHERE slug=?").get(pack)) { db.close(); throw new Error(`unknown pack: ${pack}`) }
  let sql = "SELECT id, pack, path, width, height, observed FROM assets WHERE pack=? AND kind='image' AND is_atlas=0"
  if (undescribed) sql += " AND observed IS NULL"
  const rows = db.prepare(sql + " ORDER BY path").all(pack)
    .filter((r) => !OVERVIEW.test(path.posix.basename(r.path)))
  db.close()
  if (!rows.length) throw new Error(`no ${undescribed ? "undescribed " : ""}images in ${pack}`)

  const dir = path.join(ROOT, "index", "describe", pack)
  fs.mkdirSync(dir, { recursive: true })
  // A previous run's sheets would carry different numbers; remove only files
  // this command writes.
  for (const f of fs.readdirSync(dir)) {
    if (/^sheet-\d+\.png$/.test(f) || f === "key.json") fs.unlinkSync(path.join(dir, f))
  }

  const sheets = []
  for (let i = 0; i < rows.length; i += perSheet) {
    const chunk = rows.slice(i, i + perSheet).map((r, j) => ({ ...r, n: i + j + 1 }))
    const file = `sheet-${String(sheets.length + 1).padStart(2, "0")}.png`
    // buildSheet prints row.id under each cell; the sheet number goes there.
    const r = await buildSheet({
      rows: chunk.map((c) => ({ id: c.n, pack: c.pack, path: c.path })),
      out: path.join(dir, file), cols, cell, label: "id", trim,
    })
    if (r.count !== chunk.length) console.log(`  warning: ${file} drew ${r.count} of ${chunk.length} images (unreadable files are left blank)`)
    sheets.push({
      file,
      items: chunk.map((c) => ({ n: c.n, path: c.path, width: c.width, height: c.height, described: c.observed != null })),
    })
  }

  const key = {
    pack,
    generated_at: new Date().toISOString(),
    count: rows.length,
    undescribed_only: undescribed,
    sheet: { per_sheet: perSheet, cols, cell, trim },
    output: `descriptions/${pack}.json`,
    sheets,
  }
  fs.writeFileSync(path.join(dir, "key.json"), JSON.stringify(key, null, 2) + "\n")

  const rel = path.relative(ROOT, dir).replaceAll("\\", "/")
  console.log(`  ${rows.length} images on ${sheets.length} sheets -> ${rel}/`)
  for (const s of sheets) console.log(`    ${s.file}  #${s.items[0].n}-${s.items.at(-1).n}`)
  console.log(`  key: ${rel}/key.json (number -> path)`)
  console.log(`  next: read each sheet, write {"<n>": "description", ...} to a file, then`)
  console.log(`        assets describe-sheets ${pack} --apply <file> && assets descriptions import --packs ${pack}`)
  return { dir, count: rows.length, sheets: sheets.length }
}

/**
 * Turn numbered descriptions into descriptions/<pack>.json via key.json.
 *
 * Input: { "<n>": "description", ... } or [{ n, observed, style? }, ...],
 * numbers as printed on the sheets. Entries are merged into the pack's
 * existing file by path (a new description replaces an old one and is
 * unaudited again); nothing else in the file changes.
 */
export function applyNumbered({ pack, file, model = "claude-code-subagent", style = null } = {}) {
  const keyFile = path.join(ROOT, "index", "describe", pack, "key.json")
  if (!fs.existsSync(keyFile)) throw new Error(`no ${path.relative(ROOT, keyFile)}; run assets describe-sheets ${pack} first`)
  const key = JSON.parse(fs.readFileSync(keyFile, "utf-8"))
  const byN = new Map(key.sheets.flatMap((s) => s.items).map((i) => [i.n, i.path]))

  const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"))
  const list = Array.isArray(raw)
    ? raw.map((e) => ({ n: Number(e.n), observed: e.observed, style: e.style }))
    : Object.entries(raw).map(([n, observed]) => ({ n: Number(n), observed }))

  const outFile = path.join(ROOT, "descriptions", `${pack}.json`)
  const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf-8")) : { pack, assets: [] }
  const byPath = new Map(existing.assets.map((a) => [a.path, a]))
  const at = new Date().toISOString()
  const bad = []
  let added = 0
  for (const e of list) {
    const p = byN.get(e.n)
    const text = typeof e.observed === "string" ? e.observed.trim() : ""
    if (!p || !text) { bad.push(e.n); continue }
    byPath.set(p, { path: p, observed: text, style: e.style ?? style ?? undefined, model, at })
    added++
  }
  const assets = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify({ pack, count: assets.length, assets }, null, 2) + "\n")
  console.log(`  wrote ${added} descriptions into ${path.relative(ROOT, outFile).replaceAll("\\", "/")} (${assets.length} total)`)
  if (bad.length) console.log(`  skipped ${bad.length} entries with an unknown number or empty text: ${bad.slice(0, 10).join(", ")}`)
  const missing = [...byN.keys()].filter((n) => !list.some((e) => e.n === n))
  if (missing.length) console.log(`  ${missing.length} sheet numbers have no description yet`)
  console.log(`  next: assets descriptions import --packs ${pack}`)
  return { added, skipped: bad.length, total: assets.length }
}
