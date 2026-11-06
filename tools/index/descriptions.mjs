import fs from "node:fs"
import path from "node:path"
import { openDb } from "../../lib/db.mjs"
import { ROOT } from "../../lib/config.mjs"

/**
 * Descriptions are the only part of the index that cannot be regenerated.
 *
 * Structural analysis re-runs from the pixels in 40 seconds; the lexical tier
 * re-derives from filenames instantly. A description is the product of someone
 * looking at the sprite, and if the database is the only copy then deleting a
 * gitignored file destroys all of it. So they live in the repo as JSON, one
 * file per pack, keyed by pack-relative path rather than row id -- ids are an
 * artifact of insertion order and would not survive a rebuild.
 */

const DIR = path.join(ROOT, "descriptions")

export function exportDescriptions({ packs = null } = {}) {
  const db = openDb({ readonly: true })
  let sql = `SELECT pack, path, observed, vision_style, vision_model, vision_at, audited, audited_at
             FROM assets WHERE observed IS NOT NULL`
  const params = []
  if (packs) { sql += ` AND pack IN (${packs.map(() => "?").join(",")})`; params.push(...packs) }
  const rows = db.prepare(sql + " ORDER BY pack, path").all(...params)
  db.close()

  const byPack = {}
  for (const r of rows) (byPack[r.pack] ??= []).push(r)

  fs.mkdirSync(DIR, { recursive: true })
  let files = 0
  for (const [pack, items] of Object.entries(byPack)) {
    const out = {
      pack,
      count: items.length,
      assets: items.map((r) => ({
        path: r.path,
        observed: r.observed,
        style: r.vision_style ?? undefined,
        model: r.vision_model ?? undefined,
        at: r.vision_at ?? undefined,
        audited: r.audited ? true : undefined,
        auditedAt: r.audited_at ?? undefined,
      })),
    }
    fs.writeFileSync(path.join(DIR, `${pack}.json`), JSON.stringify(out, null, 2) + "\n")
    files++
  }
  console.log(`  exported ${rows.length} descriptions across ${files} packs`)
  console.log(`  -> ${path.relative(ROOT, DIR)}/`)
  return { rows: rows.length, files }
}

export async function importDescriptions({ packs = null } = {}) {
  if (!fs.existsSync(DIR)) throw new Error(`no ${path.relative(ROOT, DIR)}/ to import`)
  const db = openDb()
  const update = db.prepare(
    "UPDATE assets SET observed=?, vision_style=?, vision_model=?, vision_at=?, audited=?, audited_at=? WHERE pack=? AND path=?")

  let applied = 0, missing = 0, files = 0
  db.exec("BEGIN")
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith(".json"))) {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"))
    if (packs && !packs.includes(data.pack)) continue
    files++
    for (const a of data.assets) {
      // An unfilled entry must not blank out a description.
      if (typeof a.observed !== "string" || !a.observed.trim()) { missing++; continue }
      const r = update.run(a.observed, a.style ?? null, a.model ?? null, a.at ?? null,
        a.audited ? 1 : 0, a.auditedAt ?? null, data.pack, a.path)
      if (r.changes) applied++
      else missing++
    }
  }
  db.exec("COMMIT")

  const { rebuildFts } = await import("./build.mjs")
  rebuildFts(db)
  db.close()
  console.log(`  imported ${applied} descriptions from ${files} packs` +
    (missing ? `, ${missing} had no matching asset or no text` : ""))
  return { applied, missing }
}

/**
 * Record that a description was compared against the pixels. A description
 * that ranks confidently but was never checked is worse than none; this is
 * how the record tells the two apart.
 */
export function markAudited({ ids = [], paths = [] } = {}) {
  const db = openDb()
  const now = new Date().toISOString()
  const byId = db.prepare("UPDATE assets SET audited=1, audited_at=? WHERE id=? AND observed IS NOT NULL")
  const byPath = db.prepare("UPDATE assets SET audited=1, audited_at=? WHERE pack=? AND path=? AND observed IS NOT NULL")
  let n = 0
  db.exec("BEGIN")
  for (const id of ids) n += byId.run(now, id).changes
  for (const p of paths) { const [pack, ...rest] = p.split(":"); n += byPath.run(now, pack, rest.join(":")).changes }
  db.exec("COMMIT")
  db.close()
  console.log(`  marked ${n} descriptions audited`)
  return n
}
