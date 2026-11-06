import fs from "node:fs"
import path from "node:path"
import { openDb } from "../../lib/db.mjs"
import { assetFile } from "../../lib/config.mjs"
import { modelDependencies } from "../../lib/model-deps.mjs"

/**
 * Copy chosen assets out of the corpus into a project, with a typed manifest
 * the game code can import.
 *
 * Takes explicit ids (what `assets search` returned and a contact sheet
 * confirmed) or a whole pack. Copying beats referencing: the corpus lives
 * outside the project and is not something a build should depend on.
 *
 * A 3D model brings the files it references (glTF buffers and images, GLB
 * external textures, OBJ -> MTL -> textures; see lib/model-deps.mjs) at the
 * same path relative to the model, so the references still resolve. A file
 * several models share is copied once.
 *
 * `flat` puts each file at `<pack>_<name>` in one directory. A model with
 * dependencies is the exception: flattening would break its relative
 * references, so it keeps the pack layout and the result says so.
 */
export function install({ ids = null, pack = null, to, manifest = false, flat = false }) {
  if (!to) throw new Error("--to <dir> is required")
  const db = openDb({ readonly: true })

  const rows = ids?.length
    ? ids.map((id) => db.prepare("SELECT * FROM assets WHERE id=?").get(id)).filter(Boolean)
    : db.prepare("SELECT * FROM assets WHERE pack=? AND kind='image'").all(pack)

  if (!rows.length) throw new Error(ids?.length ? "no assets for those ids" : `no assets in pack "${pack}"`)

  const dest = path.resolve(to)
  fs.mkdirSync(dest, { recursive: true })

  const mirrored = (p, rel) => path.join(p, ...rel.split("/"))
  const posix = (rel) => rel.split(path.sep).join("/")
  const written = new Set() // dest-relative paths already copied in this run
  const copy = (src, rel) => {
    const key = rel.toLowerCase()
    if (written.has(key)) return false
    const outFile = path.join(dest, rel)
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.copyFileSync(src, outFile)
    written.add(key)
    return true
  }

  const entries = []
  const warnings = []
  const hints = new Map() // pack -> hint, once per pack
  const keptLayout = []
  let copied = 0, missing = 0, dependencies = 0
  for (const r of rows) {
    const src = assetFile(r.pack, r.path)
    if (!fs.existsSync(src)) { missing++; continue }

    const deps = modelDependencies(src, assetFile(r.pack, ""))
    if (deps.hint && !hints.has(r.pack)) hints.set(r.pack, `${r.pack}: ${deps.hint}`)
    for (const m of deps.missing) warnings.push(`${r.pack}/${r.path}: references ${m}, which is not in the pack`)
    for (const s of deps.skipped) warnings.push(`${r.pack}/${s.from}: did not follow "${s.ref}" (${s.reason})`)

    const keepLayout = flat && deps.files.length > 0
    if (keepLayout) keptLayout.push(`${r.pack}/${r.path}`)
    const rel = flat && !keepLayout ? `${r.pack}_${path.parse(r.path).base}` : mirrored(r.pack, r.path)
    if (copy(src, rel)) copied++

    const depRels = deps.files.map((d) => mirrored(r.pack, d.rel))
    deps.files.forEach((d, i) => { if (copy(d.abs, depRels[i])) dependencies++ })

    entries.push({
      id: r.id, key: path.parse(r.path).name, file: posix(rel),
      pack: r.pack, width: r.width, height: r.height,
      role: r.role, style: r.style, animFrame: r.anim_frame,
      tileable: r.tile_score >= 0.7, description: r.observed ?? undefined,
      dependencies: depRels.length ? depRels.map(posix) : undefined,
    })
  }
  if (keptLayout.length) {
    warnings.push(`--flat: kept the pack layout for ${keptLayout.length} model(s) with dependencies, ` +
      `because flattening would break their relative references: ${keptLayout.slice(0, 5).join(", ")}` +
      (keptLayout.length > 5 ? ", ..." : ""))
  }

  const packs = [...new Set(rows.map((r) => r.pack))]
  if (manifest) {
    const manifestPath = path.join(dest, "assets.manifest.json")
    fs.writeFileSync(manifestPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      license: "CC0-1.0",
      source: "https://kenney.nl",
      attribution: "Assets by Kenney (kenney.nl), CC0. Consider donating: https://kenney.nl/donate",
      packs, assets: entries,
    }, null, 2) + "\n")
  }

  db.close()
  return { copied, missing, dependencies, dest, packs, warnings, hints: [...hints.values()] }
}
