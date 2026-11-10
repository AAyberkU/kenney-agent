/**
 * `assets link`: expose the local corpus (KenneyAssets) to the index.
 *
 * 1. For every entry in catalog/eturner58-map.json, plus every pack folder
 *    added to the corpus since (kenney/<section>/<Pack Name>/, see
 *    detectNewPacks), create a directory link <assetsRoot>/<slug> ->
 *    <corpus>/<path>. Nothing is copied. On Windows the link is a junction,
 *    which needs no admin rights; elsewhere it is a plain symlink.
 *    - A real directory at <slug> (a pack fetched or ingested later) wins and
 *      is left alone.
 *    - An existing link is re-pointed; links for slugs no longer mapped are
 *      removed (the link only -- never the files behind it).
 * 2. Write catalog/catalog.local.json: the scraped kenney.nl catalog with the
 *    corpus' vision tags merged in, plus the bundle-only packs it lacks.
 *    Packs in the scraped catalog with no local copy stay listed; they are what
 *    `assets missing` reports.
 */
import fs from "node:fs"
import path from "node:path"
import { ROOT, assetsRoot, corpusRepoRoot, scrapedCatalogPath } from "../../lib/config.mjs"
import { norm, slugify } from "./make-map.mjs"

const MAP = path.join(ROOT, "catalog", "eturner58-map.json")
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir"

const SECTION_CATEGORY = {
  "2D assets": "2D", "3D assets": "3D", "Audio": "Audio",
  "UI assets": "2D", "Icons": "2D", "Goodies": "Other", "Other": "Other",
}

/**
 * Pack folders in the corpus that the committed map does not know: packs
 * contributors added to the corpus repository after the map was generated.
 * Each is matched by name against the kenney.nl catalogs (scraped + extra
 * packs), so "kenney/2D assets/Tiny City" becomes the slug tiny-city; a name
 * with no catalog entry gets a slug of its own and is marked localOnly.
 */
export function detectNewPacks(corpus, map, catalogPacks) {
  const known = new Set(map.map((e) => e.path))
  const used = new Set(map.map((e) => e.slug))
  const byNorm = new Map(catalogPacks.map((p) => [norm(p.name), p]))
  const bySlug = new Map(catalogPacks.map((p) => [p.slug, p]))
  const found = []
  const base = path.join(corpus, "kenney")
  if (!fs.existsSync(base)) return found
  for (const section of fs.readdirSync(base, { withFileTypes: true })) {
    if (!section.isDirectory() || section.name.startsWith(".")) continue
    for (const d of fs.readdirSync(path.join(base, section.name), { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue
      const rel = `kenney/${section.name}/${d.name}`
      if (known.has(rel)) continue
      const hit = byNorm.get(norm(d.name)) ?? bySlug.get(slugify(d.name))
      let slug = hit && !used.has(hit.slug) ? hit.slug : slugify(d.name)
      if (used.has(slug)) slug = `${slug}-${slugify(section.name)}`
      used.add(slug)
      found.push({
        slug, name: d.name, section: section.name,
        category: hit?.category ?? SECTION_CATEGORY[section.name] ?? "Other",
        path: rel, match: hit ? "detected" : "detected-slugified",
        inScrapedCatalog: !!hit, localOnly: !hit, detected: true,
      })
    }
  }
  return found
}

function uniq(list) {
  return [...new Set(list.filter(Boolean).map((t) => String(t).toLowerCase().trim()).filter(Boolean))]
}

export function link({ dryRun = false } = {}) {
  const corpus = corpusRepoRoot()
  if (!fs.existsSync(path.join(corpus, "catalog", "library.json"))) {
    throw new Error(`Local corpus not found at ${corpus}\nSet KENNEY_ASSETS_DIR to the KenneyAssets clone.`)
  }
  const scraped = JSON.parse(fs.readFileSync(scrapedCatalogPath(), "utf-8")).packs
  const extraFile = path.join(ROOT, "catalog", "extra-packs.json")
  const extra = fs.existsSync(extraFile) ? JSON.parse(fs.readFileSync(extraFile, "utf-8")).packs : []
  const committed = JSON.parse(fs.readFileSync(MAP, "utf-8")).packs
  const detected = detectNewPacks(corpus, committed, [...scraped, ...extra])
  const map = [...committed, ...detected]
  const root = assetsRoot()
  fs.mkdirSync(root, { recursive: true })

  // -- 1. junctions --
  const wanted = new Map(map.map((e) => [e.slug, path.join(corpus, ...e.path.split("/"))]))
  let created = 0, kept = 0, realDirs = 0, removed = 0, missingTargets = 0
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isSymbolicLink() || wanted.has(d.name)) continue
    if (!dryRun) fs.unlinkSync(path.join(root, d.name))
    removed++
  }
  for (const [slug, target] of wanted) {
    if (!fs.existsSync(target)) { missingTargets++; continue }
    const at = path.join(root, slug)
    let st = null
    try { st = fs.lstatSync(at) } catch {}
    if (st && !st.isSymbolicLink()) { realDirs++; continue }
    if (st) {
      if (path.resolve(fs.readlinkSync(at)) === path.resolve(target)) { kept++; continue }
      if (!dryRun) fs.unlinkSync(at)
    }
    if (!dryRun) fs.symlinkSync(target, at, LINK_TYPE)
    created++
  }

  // -- 2. merged catalog --
  const lib = JSON.parse(fs.readFileSync(path.join(corpus, "catalog", "library.json"), "utf-8"))
  const libByPath = new Map(lib.map((p) => [p.path, p]))
  const bySlug = new Map(scraped.map((p) => [p.slug, { ...p }]))
  for (const p of extra) {
    if (!bySlug.has(p.slug)) bySlug.set(p.slug, { previewUrl: null, fileCount: null, ...p })
  }

  for (const e of map) {
    const meta = libByPath.get(e.path) ?? (e.slicedFrom ? libByPath.get(map.find((m) => m.slug === e.slicedFrom)?.path) : null)
    const corpusTags = meta ? [meta.style, meta.perspective, ...(meta.genres ?? []), ...(meta.subjects ?? []), ...(meta.tags ?? [])] : []
    const base = bySlug.get(e.slug) ?? {
      slug: e.slug, name: e.name, category: e.category, series: "",
      downloadUrl: null, previewUrl: null, tags: [], fileCount: meta?.files ?? null,
    }
    bySlug.set(e.slug, {
      ...base,
      // Corpus vision tags go into the per-file search text, so they are used
      // only where kenney.nl gave none (bundle-only and sliced packs). Merging
      // them into every pack measured 78.3% recall@10 against 78.9% without.
      // style and perspective stay available as their own fields.
      tags: (base.tags ?? []).length
        ? uniq(base.tags)
        : uniq([...corpusTags, e.section === "sliced" ? "sliced" : null, e.section === "sliced" ? "tile" : null]),
      corpusTags: uniq(corpusTags),
      summary: meta?.description || base.summary || "",
      bestFor: meta?.best_for ?? null,
      style: meta?.style ?? null,
      perspective: meta?.perspective ?? null,
      localPath: e.path,
      previewLocal: meta?.preview ?? null,
      localOnly: !!e.localOnly,
    })
  }

  const packs = [...bySlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  const out = path.join(ROOT, "catalog", "catalog.local.json")
  if (!dryRun) {
    fs.writeFileSync(out, JSON.stringify({
      _doc: "Generated by `assets link`: scraped kenney.nl catalog + local corpus (KenneyAssets). Do not edit.",
      totalPacks: packs.length,
      localPacks: packs.filter((p) => p.localPath).length,
      packs,
    }, null, 2) + "\n")
  }
  return { created, kept, realDirs, removed, missingTargets, detected: detected.map((e) => e.slug), catalogPacks: packs.length,
    localPacks: packs.filter((p) => p.localPath).length, notLocal: packs.filter((p) => !p.localPath).length }
}
