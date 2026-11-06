import fs from "node:fs"
import path from "node:path"
import { openDb, setMeta, assertFts5 } from "../../lib/db.mjs"
import { assetsRoot, catalogPath, requireAssetsRoot } from "../../lib/config.mjs"
import { classify, kindForExt } from "../../lib/classify.mjs"
import { readDimensions } from "../../lib/dimensions.mjs"

function loadPacks(db) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath(), "utf-8"))
  const stmt = db.prepare(`
    INSERT INTO packs (slug, name, category, series, download_url, preview_url, tags, file_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, category=excluded.category, series=excluded.series,
      download_url=excluded.download_url, preview_url=excluded.preview_url,
      tags=excluded.tags, file_count=excluded.file_count
  `)
  db.exec("BEGIN")
  for (const p of catalog.packs) {
    stmt.run(p.slug, p.name, p.category ?? null, p.series ?? null,
      p.downloadUrl ?? null, p.previewUrl ?? null,
      JSON.stringify(p.tags ?? []), p.fileCount ?? null)
  }
  db.exec("COMMIT")
  return catalog.packs.length
}

function walk(dir, rel, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    const r = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(abs, r, out)
    else out.push({ abs, rel: r })
  }
}

function loadAssets(db, only) {
  const root = requireAssetsRoot()
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    // Packs may be junctions into the shared corpus (assets link), which
    // Dirent reports as links, not directories -- follow them.
    .filter((d) => !d.name.startsWith(".") && (d.isDirectory() ||
      (d.isSymbolicLink() && fs.statSync(path.join(root, d.name)).isDirectory())))
    .map((d) => d.name)
    .filter((d) => !only || only.includes(d))
    .sort()

  const insert = db.prepare(`
    INSERT INTO assets (pack, path, kind, ext, bytes, width, height, keywords, role, anim_frame, is_atlas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pack, path) DO UPDATE SET
      kind=excluded.kind, ext=excluded.ext, bytes=excluded.bytes,
      width=excluded.width, height=excluded.height, keywords=excluded.keywords,
      role=excluded.role, anim_frame=excluded.anim_frame, is_atlas=excluded.is_atlas
  `)
  const markInstalled = db.prepare("UPDATE packs SET installed=1 WHERE slug=?")
  const ensurePack = db.prepare("INSERT OR IGNORE INTO packs (slug, name) VALUES (?, ?)")

  let total = 0
  for (const pack of dirs) {
    const files = []
    walk(path.join(root, pack), "", files)

    db.exec("BEGIN")
    ensurePack.run(pack, pack)   // a directory with no catalog entry still indexes
    for (const f of files) {
      const ext = path.extname(f.rel).toLowerCase()
      const kind = kindForExt(ext)
      const c = classify(f.rel, kind)
      const dim = kind === "image" ? readDimensions(f.abs) : null
      let bytes = 0
      try { bytes = fs.statSync(f.abs).size } catch {}
      insert.run(pack, f.rel, kind, ext, bytes, dim?.w ?? null, dim?.h ?? null,
        JSON.stringify(c.keywords), c.role, c.animFrame, c.isAtlas ? 1 : 0)
      total++
    }
    markInstalled.run(pack)
    db.exec("COMMIT")
    if (process.stdout.isTTY) process.stdout.write(`\r  indexed ${total} files across ${dirs.indexOf(pack) + 1}/${dirs.length} packs`)
  }
  process.stdout.write("\n")
  return { packs: dirs.length, files: total }
}

/**
 * Rebuild FTS wholesale. rowid is kept aligned to assets.id.
 *
 * `tiers` selects which enrichment layers contribute searchable text, so the
 * eval can measure what each tier is actually worth instead of assuming.
 */
export function rebuildFts(db, tiers = { structural: true, vision: true }) {
  assertFts5(db)
  db.exec("BEGIN")
  db.exec("DELETE FROM assets_fts")
  const rows = db.prepare(`
    SELECT a.id, a.path, a.keywords, a.role, a.anim_frame, a.style, a.observed,
           a.vision_style, p.tags AS pack_tags, p.name AS pack_name, a.pack
    FROM assets a LEFT JOIN packs p ON p.slug = a.pack
  `).all()
  const ins = db.prepare("INSERT INTO assets_fts(rowid, text) VALUES (?, ?)")
  for (const r of rows) {
    const parts = [
      r.pack, r.pack_name,
      r.path.replace(/[\/_-]+/g, " "),
      (JSON.parse(r.keywords || "[]")).join(" "),
      r.role, r.anim_frame,
      (JSON.parse(r.pack_tags || "[]")).join(" "),
      tiers.structural ? r.style : null,
      tiers.vision ? r.observed : null,
      tiers.vision ? r.vision_style : null,
    ]
    ins.run(r.id, parts.filter(Boolean).join(" ").toLowerCase())
  }
  db.exec("COMMIT")
  return rows.length
}

export function build({ packs: only = null, ftsOnly = false } = {}) {
  const db = openDb({ create: true })
  assertFts5(db)
  if (!ftsOnly) {
    const n = loadPacks(db)
    console.log(`  catalog: ${n} packs`)
    const r = loadAssets(db, only)
    console.log(`  corpus:  ${r.files} files across ${r.packs} installed packs`)
  }
  const indexed = rebuildFts(db)
  console.log(`  fts:     ${indexed} rows`)
  setMeta(db, "built_at", new Date().toISOString())
  setMeta(db, "assets_root", assetsRoot())
  db.close()
}
