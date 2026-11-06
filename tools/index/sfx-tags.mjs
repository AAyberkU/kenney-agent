import fs from "node:fs"
import path from "node:path"
import { openDb } from "../../lib/db.mjs"
import { ROOT } from "../../lib/config.mjs"

/**
 * Tags from the Open Game SFX Index (MIT, vendored in
 * vendor/open-game-sfx-index/) for the Kenney sounds it covers.
 *
 * What the data is worth: `category`, `use_cases` and `mood` are set per pack,
 * not per sound (every music-jingles file reads "win fanfare, lose sting,
 * level complete"), and `tags` are the pack's category words plus the file
 * name's own tokens. So they route a query to the right pack ("win jingle" ->
 * music-jingles) but do not rank sounds within a pack. They are stored as an
 * unverified third-party claim and feed the structural FTS tier.
 *
 * Matching is by pack and file name. Upstream drops the "Audio (Female)"
 * wrapper folders and uses the older music-jingles names; those are mapped
 * below. Upstream also lists durations, which check every pair: the older
 * music-jingles numbering differs from the corpus, so those files are
 * re-paired by duration. A name match whose duration still disagrees is kept
 * and reported.
 */

const FILE = path.join(ROOT, "vendor", "open-game-sfx-index", "kenney-tags.json")

// Older music-jingles file families -> the corpus folder names. NES -> retro
// is inferred (both are the 8-bit family of 17 files); the duration check
// below confirms each pair.
const JINGLE_FAMILY = { hit: "hit", nes: "retro", pizzi: "pizzicato", sax: "saxophone", steel: "steel" }

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")

function oursKey(p) {
  const parts = p.split("/")
  const stem = path.posix.parse(parts.pop()).name
  // "Audio", "Audio (Female)" -> "", "female"
  const dirs = parts.map((d) => { const m = d.match(/^audio(?:\s*\((.+)\))?$/i); return m ? (m[1] ?? "") : d })
  return { dir: norm(dirs.join("/")), stem: norm(stem) }
}

function theirsKey(pack, file) {
  const parts = file.split("/")
  let stem = norm(path.posix.parse(parts.pop()).name)
  if (pack === "music-jingles") {
    const m = stem.match(/^jingles(hit|nes|pizzi|sax|steel)(\d+)$/)
    if (m) stem = "jingles" + JINGLE_FAMILY[m[1]] + m[2]
  }
  return { dir: norm(parts.join("/")), stem }
}

// File-name tokens carry upstream's numbering ("hit00", "nes04"), which is not
// the corpus numbering; keep the word ("nes") and drop the number.
const clean = (list) => [...new Set((list ?? [])
  .filter((w) => typeof w === "string")
  .map((w) => w.toLowerCase().replace(/\d+$/, ""))
  .filter(Boolean))]

export async function importSfxTags({ file = FILE } = {}) {
  const data = JSON.parse(fs.readFileSync(file, "utf-8"))
  const db = openDb()
  const ours = db.prepare("SELECT id, pack, path, duration_s FROM assets WHERE kind='audio'").all()

  const byPack = new Map()
  for (const r of ours) {
    const k = oursKey(r.path)
    const p = byPack.get(r.pack) ?? { full: new Map(), stem: new Map() }
    byPack.set(r.pack, p)
    p.full.set(k.dir + "|" + k.stem, r)
    p.stem.set(k.stem, p.stem.has(k.stem) ? null : r)   // null = ambiguous
  }

  const update = db.prepare("UPDATE assets SET sfx_tags=? WHERE id=?")
  const unmatched = []
  const durationMismatch = []
  const claimed = new Map()   // our asset id -> upstream sound
  const dur = (r, s) => (r.duration_s != null && Number.isFinite(s.duration_sec)
    ? Math.abs(r.duration_s - s.duration_sec) : null)
  const nameMatch = (s) => {
    const p = byPack.get(s.pack)
    const k = theirsKey(s.pack, s.file)
    return p && (p.full.get(k.dir + "|" + k.stem) ?? p.stem.get(k.stem))
  }
  const family = (stem) => stem.replace(/\d+$/, "")

  // Pass 1: name matches whose durations agree (or cannot be compared).
  const pending = []
  for (const s of data.sounds) {
    const r = nameMatch(s)
    const d = r ? dur(r, s) : null
    if (r && !claimed.has(r.id) && (d === null || d <= 0.05)) claimed.set(r.id, s)
    else pending.push({ s, r })
  }
  // Pass 2: a pack renumbered between versions (music-jingles) keeps the
  // durations: pair with the unclaimed file of the same family and folder
  // whose length agrees within 10 ms.
  let repaired = 0
  const rest = []
  for (const { s, r } of pending) {
    const k = theirsKey(s.pack, s.file)
    let best = null, bestD = 0.01
    for (const c of byPack.get(s.pack)?.full.values() ?? []) {
      if (claimed.has(c.id)) continue
      const ck = oursKey(c.path)
      if (family(ck.stem) !== family(k.stem)) continue
      const d = dur(c, s)
      if (d !== null && d < bestD) { best = c; bestD = d }
    }
    if (best) { claimed.set(best.id, s); repaired++ }
    else rest.push({ s, r })
  }
  // Pass 3: a name match with no duration twin is kept, but reported.
  const leftover = []
  for (const { s, r } of rest) {
    if (!r || claimed.has(r.id)) { leftover.push(s); continue }
    claimed.set(r.id, s)
    durationMismatch.push(`${s.pack}/${r.path}: ours ${r.duration_s.toFixed(3)} s, theirs ${s.duration_sec} s`)
  }
  // Pass 4: a file whose audio changed between versions has no twin at all.
  // Its family's tags still hold (and carry no file number), so it goes to
  // the closest unclaimed file of the same family, marked match: "family".
  const familyOnly = new Set()
  for (const s of leftover) {
    const k = theirsKey(s.pack, s.file)
    let best = null, bestD = Infinity
    for (const c of byPack.get(s.pack)?.full.values() ?? []) {
      if (claimed.has(c.id) || family(oursKey(c.path).stem) !== family(k.stem)) continue
      const d = dur(c, s) ?? 1e9
      if (d < bestD) { best = c; bestD = d }
    }
    if (!best) { unmatched.push(`${s.pack}/${s.file}`); continue }
    claimed.set(best.id, s)
    familyOnly.add(best.id)
  }

  db.exec("BEGIN")
  db.exec("UPDATE assets SET sfx_tags=NULL WHERE sfx_tags IS NOT NULL")
  for (const [id, s] of claimed) {
    update.run(JSON.stringify({
      category: s.category ?? null,
      tags: clean(s.tags),
      match: familyOnly.has(id) ? "family" : undefined,
      use_cases: clean(s.use_cases),
      mood: clean(s.mood),
      source: "open-game-sfx-index",
    }), id)
  }
  const applied = claimed.size
  db.exec("COMMIT")

  const { rebuildFts } = await import("./build.mjs")
  rebuildFts(db)
  db.close()
  console.log(`  sfx tags: ${applied} of ${data.sounds.length} upstream sounds matched; ${applied} of ${ours.length} local audio assets tagged`)
  if (repaired) console.log(`  re-paired by duration (renumbered files): ${repaired}`)
  if (familyOnly.size) console.log(`  family-level only (audio changed upstream, no twin): ${familyOnly.size}`)
  if (unmatched.length) console.log(`  unmatched upstream: ${unmatched.length}  e.g. ${unmatched.slice(0, 5).join(", ")}`)
  if (durationMismatch.length) {
    console.log(`  duration mismatch > 0.05 s: ${durationMismatch.length}`)
    for (const m of durationMismatch.slice(0, 10)) console.log("    " + m)
  }
  return { applied, repaired, familyOnly: familyOnly.size, unmatched, durationMismatch }
}
