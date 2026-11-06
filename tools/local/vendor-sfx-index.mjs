#!/usr/bin/env node
/**
 * Re-vendor the Open Game SFX Index (MIT) from a downloaded index.json.
 *
 *   gh api repos/Mcamento8/open-game-sfx-index/contents/index.json \
 *     -H "Accept: application/vnd.github.raw" > <new dir>/index.json
 *   node tools/local/vendor-sfx-index.mjs <new dir>/index.json <commit sha>
 *
 * Keeps only the Kenney sounds and only the fields the index uses, so the
 * vendored file stays small. The download is untrusted data: every field is
 * type-checked and length-capped, and nothing in it is executed.
 * Copy the upstream LICENSE next to the output whenever this is re-run.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { ROOT } from "../../lib/config.mjs"

const [src, commit = "unknown"] = process.argv.slice(2)
if (!src) { console.error("usage: vendor-sfx-index.mjs <index.json> [commit]"); process.exit(1) }

const raw = fs.readFileSync(path.resolve(src))
const data = JSON.parse(raw.toString("utf-8"))
if (!Array.isArray(data.sounds)) throw new Error("index.json has no sounds array")

const str = (v, max = 80) => (typeof v === "string" ? v.slice(0, max) : null)
const words = (v) => (Array.isArray(v) ? v.map((x) => str(x, 60)).filter(Boolean).slice(0, 24) : [])
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const sounds = []
for (const s of data.sounds) {
  const pack = str(s.pack)
  const file = str(s.file_ogg, 200)
  // Kenney entries name a kenney.nl pack page as their source; the
  // OpenGameArt mirrors in the same file are not part of this corpus.
  if (!pack || !SLUG.test(pack) || !file) continue
  if (!/^https:\/\/kenney\.nl\/assets\//.test(str(s.source, 200) ?? "")) continue
  const prefix = `audio/${pack}/`
  if (!file.startsWith(prefix) || file.includes("..")) continue
  sounds.push({
    pack,
    file: file.slice(prefix.length),
    category: str(s.category),
    tags: words(s.tags),
    use_cases: words(s.use_cases),
    mood: words(s.mood),
    duration_sec: Number.isFinite(s.duration_sec) ? s.duration_sec : null,
  })
}

const out = {
  source: {
    repo: "https://github.com/Mcamento8/open-game-sfx-index",
    commit,
    file: "index.json",
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
    generated_at: str(data.generated_at),
    license: "MIT, Copyright (c) 2026 Mcamento8 -- see LICENSE in this directory",
  },
  count: sounds.length,
  sounds,
}
const dir = path.join(ROOT, "vendor", "open-game-sfx-index")
fs.mkdirSync(dir, { recursive: true })
// One sound per line: small, and a re-vendor diffs line by line.
const { sounds: list, ...head } = out
const text = JSON.stringify(head, null, 2).replace(/\n}$/, ',\n  "sounds": [\n') +
  list.map((s) => "    " + JSON.stringify(s)).join(",\n") + "\n  ]\n}\n"
JSON.parse(text)
fs.writeFileSync(path.join(dir, "kenney-tags.json"), text)
console.log(`  wrote ${sounds.length} Kenney sounds to ${path.relative(ROOT, dir)}/kenney-tags.json`)
