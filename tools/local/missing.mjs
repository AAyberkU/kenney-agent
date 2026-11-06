/**
 * `assets missing [query]`: catalogued packs that have no local copy.
 *
 * Only pack-level facts exist for these (name, category, tags, kenney.nl
 * preview and download links); their files are unknown until the pack is on
 * disk. With a query, packs are ranked by how many query words hit their
 * name, tags or summary; packs with no hit are left out.
 */
import { catalogPacks, isOnDisk } from "../../lib/fetch-pack.mjs"

const STOP = new Set(["a", "an", "the", "of", "for", "and", "or", "with", "in", "on", "to"])

export function missingPacks({ query = "", limit = 20 } = {}) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w))
  const rows = []
  for (const p of catalogPacks()) {
    if (isOnDisk(p.slug)) continue
    const hay = [p.slug, p.name, p.category, p.series, ...(p.tags ?? []), p.summary].join(" ").toLowerCase()
    const hits = words.filter((w) => hay.includes(w)).length
    if (words.length && !hits) continue
    rows.push({
      slug: p.slug, name: p.name, category: p.category ?? null, tags: p.tags ?? [],
      fileCount: p.fileCount ?? null, score: words.length ? hits / words.length : null,
      page: `https://kenney.nl/assets/${p.slug}`,
      previewUrl: p.previewUrl ?? null, downloadUrl: p.downloadUrl ?? null,
    })
  }
  rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.slug.localeCompare(b.slug))
  return { total: rows.length, packs: limit ? rows.slice(0, limit) : rows }
}
