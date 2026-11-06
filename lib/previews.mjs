import fs from "node:fs"
import path from "node:path"
import { ROOT, assetsRoot, mainCheckoutRoot } from "./config.mjs"

/**
 * Pictures for assets that are not pictures.
 *
 * A contact sheet is how a reader chooses, and a 3D model or a font has no
 * pixels of its own. `assets.preview_path` points at an image that shows the
 * asset. Three sources, in order of trust:
 *
 *   1. Kenney's own render shipped in the pack: a same-name PNG
 *      (Previews/coin-gold.png next to Models/GLB format/coin-gold.glb), or an
 *      angle render (Isometric/bed_SE.png).
 *   2. Our headless render of the model (`assets render-previews`), written to
 *      assets/renders/<pack>/<model path>.png.
 *   3. For fonts, a specimen drawn from the font file itself, written to
 *      assets/renders/fonts/<pack>/<font path>.png.
 *
 * Stored paths are portable, never absolute:
 *   assets/experimental/<pack>/<path>  a corpus file, resolved through
 *                                      assetsRoot() (so ASSETS_ROOT applies)
 *   assets/renders/...                 a generated file in this checkout,
 *                                      falling back to the main checkout's
 *
 * The asset row itself stays the model or font: search returns it and install
 * copies it. The preview is only ever looked at.
 */

export const MODEL_EXTS = [".glb", ".gltf", ".fbx", ".obj"]
export const FONT_EXTS = [".ttf", ".otf"]

const CORPUS_PREFIX = "assets/experimental/"
export const RENDERS_DIR = "assets/renders"

const sqlList = (xs) => xs.map((x) => `'${x}'`).join(",")

/** Repo-relative path of the render for one model. */
export function modelRenderRel(pack, relPath) {
  return `${RENDERS_DIR}/${pack}/${relPath}.png`
}

/** Repo-relative path of the specimen for one font. */
export function fontSpecimenRel(pack, relPath) {
  return `${RENDERS_DIR}/fonts/${pack}/${relPath}.png`
}

/** Absolute path where a generated preview is written (always this checkout). */
export function writePath(rel) {
  return path.join(ROOT, ...rel.split("/"))
}

/** Absolute path of a stored preview_path, or null when it is not on disk. */
export function previewFile(stored) {
  if (!stored) return null
  if (path.isAbsolute(stored)) return fs.existsSync(stored) ? stored : null
  const p = stored.replaceAll("\\", "/")
  const candidates = []
  if (p.startsWith(CORPUS_PREFIX)) {
    candidates.push(path.join(assetsRoot(), ...p.slice(CORPUS_PREFIX.length).split("/")))
  } else {
    candidates.push(path.join(ROOT, ...p.split("/")))
    const main = mainCheckoutRoot()
    if (main) candidates.push(path.join(main, ...p.split("/")))
  }
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

function existsGenerated(rel) {
  return previewFile(rel) !== null
}

// Folders whose PNGs are renders of the models, best first. A same-name file
// elsewhere still counts (weapon-pack's Sprites/Render), but a silhouette is
// the last resort and textures never are.
function dirRank(rel) {
  const dir = path.posix.dirname(rel).toLowerCase()
  if (/(^|\/)textures?(\/|$)/.test(dir)) return -1
  if (/preview|render|isometric/.test(dir)) return 0
  if (/silhouette/.test(dir)) return 2
  return 1
}

// Kenney's angle renders (Isometric/<name>_SE.png). SE shows the model's
// front from the right, like Kenney's own pack previews.
const BEARINGS = ["se", "sw", "ne", "nw"]

/**
 * Find the corpus image that shows a model, or null.
 * `images` maps lowercase basename -> [pack-relative image paths].
 */
function corpusPreviewFor(relPath, images) {
  const base = path.posix.parse(relPath).name.toLowerCase()
  const same = (images.get(base) ?? [])
    .map((p) => ({ p, r: dirRank(p) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.p.length - b.p.length || a.p.localeCompare(b.p))
  if (same.length) return same[0].p
  for (const b of BEARINGS) {
    const hit = (images.get(`${base}_${b}`) ?? []).filter((p) => dirRank(p) >= 0).sort()
    if (hit.length) return hit[0]
  }
  return null
}

/**
 * Recompute preview_path for every model and font (optionally only in some
 * packs) from what is on disk. Idempotent and cheap (a few seconds), so the
 * build runs it and a rebuilt index gets its previews back without
 * re-rendering anything.
 */
export function linkPreviews(db, { packs = null } = {}) {
  const packFilter = packs?.length ? ` AND pack IN (${packs.map(() => "?").join(",")})` : ""
  const args = packs?.length ? packs : []

  const imagesByPack = new Map()
  for (const r of db.prepare(`SELECT pack, path FROM assets WHERE kind='image'${packFilter}`).all(...args)) {
    let m = imagesByPack.get(r.pack)
    if (!m) imagesByPack.set(r.pack, (m = new Map()))
    const key = path.posix.parse(r.path).name.toLowerCase()
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(r.path)
  }

  const rows = db.prepare(
    `SELECT id, pack, path, ext, preview_path FROM assets
     WHERE ext IN (${sqlList([...MODEL_EXTS, ...FONT_EXTS])})${packFilter}`).all(...args)
  const set = db.prepare("UPDATE assets SET preview_path=? WHERE id=?")
  const counts = { models: 0, corpus: 0, rendered: 0, fonts: 0, specimens: 0, none: 0, changed: 0 }

  db.exec("BEGIN")
  for (const r of rows) {
    let next = null
    if (FONT_EXTS.includes(r.ext)) {
      counts.fonts++
      const rel = fontSpecimenRel(r.pack, r.path)
      if (existsGenerated(rel)) { next = rel; counts.specimens++ }
    } else {
      counts.models++
      const hit = corpusPreviewFor(r.path, imagesByPack.get(r.pack) ?? new Map())
      if (hit) { next = CORPUS_PREFIX + `${r.pack}/${hit}`; counts.corpus++ }
      else {
        const rel = modelRenderRel(r.pack, r.path)
        if (existsGenerated(rel)) { next = rel; counts.rendered++ }
      }
    }
    if (!next) counts.none++
    if (next !== r.preview_path) { set.run(next, r.id); counts.changed++ }
  }
  db.exec("COMMIT")
  return counts
}
