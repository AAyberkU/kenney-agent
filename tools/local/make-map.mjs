#!/usr/bin/env node
/**
 * Generate catalog/eturner58-map.json: which kenney.nl slug each pack folder in
 * the local corpus (eturner58/game-assets, "KenneyAssets") belongs to.
 *
 *   node tools/local/make-map.mjs [--site-map <slug->name json>]
 *
 * Matching order, per local pack:
 *   1. ALIASES below (hand-checked)
 *   2. --site-map: { slug: [All-in-1 pack name, category] } (optional input)
 *   3. a normalised name match against the scraped catalog
 *   4. otherwise a slug made from the pack name; the pack is marked localOnly
 *      (bundle-only packs that have no kenney.nl page)
 *
 * Packs that ship only a sheet were sliced by eturner58 into sliced/<Pack>/;
 * each becomes an extra corpus entry "<slug>-sliced".
 *
 * The output is committed, so `assets link` needs neither this script nor the
 * site map. Re-run it after the corpus gains packs.
 */
import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { ROOT, corpusRepoRoot, scrapedCatalogPath } from "../../lib/config.mjs"

const ALIASES = {
  "Fish Pack": "fish-pack",
  "Topdown Shooter": "top-down-shooter",
}

const SECTION_CATEGORY = {
  "2D assets": "2D", "3D assets": "3D", "Audio": "Audio",
  "UI assets": "2D", "Icons": "2D", "Goodies": "Other", "Other": "Other",
}

// Parenthesised words are kept: "Nature Kit (Classic)" and "Block Pack (Pixel)"
// are different packs from "Nature Kit" and "Block Pack".
export const norm = (s) => String(s).toLowerCase()
  .replace(/\bpack\b|\bassets?\b/g, " ").replace(/[^a-z0-9]+/g, "")
export const slugify = (s) => String(s).toLowerCase().replace(/[()]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

export function makeMap({ siteMapPath = null } = {}) {
  const corpus = corpusRepoRoot()
  const lib = JSON.parse(fs.readFileSync(path.join(corpus, "catalog", "library.json"), "utf-8"))
  const scraped = JSON.parse(fs.readFileSync(scrapedCatalogPath(), "utf-8")).packs
  const scrapedSlugs = new Set(scraped.map((p) => p.slug))
  const byNorm = new Map(scraped.map((p) => [norm(p.name), p.slug]))

  const nameToSlugs = new Map()
  if (siteMapPath) {
    const site = JSON.parse(fs.readFileSync(siteMapPath, "utf-8"))
    for (const [slug, [name]] of Object.entries(site)) {
      if (!nameToSlugs.has(name)) nameToSlugs.set(name, [])
      nameToSlugs.get(name).push(slug)
    }
  }

  const local = lib.filter((p) => p.library !== "limezu" && p.redistributable !== false &&
    p.path && fs.existsSync(path.join(corpus, p.path)))

  // Packs the site map or an alias identifies go first, so a looser name match
  // can never take their slug.
  const strong = (p) => !!ALIASES[p.pack] || nameToSlugs.has(p.pack)
  const ordered = [...local.filter(strong), ...local.filter((p) => !strong(p))]

  const used = new Set()
  const entries = []
  for (const p of ordered) {
    let slug = ALIASES[p.pack], how = "alias"
    if (!slug && nameToSlugs.has(p.pack)) {
      const cands = nameToSlugs.get(p.pack)
      // Some names map to two site slugs ("UI Pack - Adventure" is served by
      // ui-pack-adventure and ui-pack-rpg-expansion): prefer the slug whose
      // scraped name is exactly this pack's name.
      const exact = cands.find((s) => scraped.find((q) => q.slug === s)?.name === p.pack)
      slug = [exact, ...cands.filter((s) => scrapedSlugs.has(s)), cands[0]].find((s) => s && !used.has(s)) ?? cands[0]
      how = "site-map"
    }
    if (!slug && byNorm.has(norm(p.pack)) && !used.has(byNorm.get(norm(p.pack)))) { slug = byNorm.get(norm(p.pack)); how = "name" }
    let localOnly = false
    if (!slug) { slug = slugify(p.pack); how = "slugified"; localOnly = !scrapedSlugs.has(slug) }
    if (used.has(slug)) slug = `${slug}-${slugify(p.section)}`
    used.add(slug)
    entries.push({
      slug, name: p.pack, section: p.section,
      category: SECTION_CATEGORY[p.section] ?? "Other",
      path: p.path.split(path.sep).join("/"),
      match: how, inScrapedCatalog: scrapedSlugs.has(slug), localOnly,
    })
  }

  const slicedRoot = path.join(corpus, "sliced")
  if (fs.existsSync(slicedRoot)) {
    for (const d of fs.readdirSync(slicedRoot, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const base = entries.find((e) => e.name === d.name)
      const slug = `${base ? base.slug : slugify(d.name)}-sliced`
      entries.push({
        slug, name: `${d.name} (sliced tiles)`, section: "sliced", category: "2D",
        path: `sliced/${d.name}`, match: "sliced", inScrapedCatalog: false, localOnly: true,
        slicedFrom: base?.slug ?? null,
      })
    }
  }

  entries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  return entries
}

if (process.argv[1]?.endsWith("make-map.mjs")) {
  const { values } = parseArgs({ options: { "site-map": { type: "string" } } })
  const entries = makeMap({ siteMapPath: values["site-map"] ?? null })
  const out = path.join(ROOT, "catalog", "eturner58-map.json")
  fs.writeFileSync(out, JSON.stringify({
    _doc: "kenney.nl slug -> pack folder in the local corpus (KenneyAssets). Generated by tools/local/make-map.mjs.",
    corpus: "https://github.com/eturner58/game-assets (All-in-1 v3.7.0)",
    packs: entries,
  }, null, 2) + "\n")
  const counts = entries.reduce((m, e) => ((m[e.match] = (m[e.match] ?? 0) + 1), m), {})
  console.log(`wrote ${entries.length} entries to ${path.relative(ROOT, out)}`, counts)
}
