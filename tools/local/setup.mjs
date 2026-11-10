/**
 * `assets setup`: everything a fresh clone needs, in one idempotent command.
 *
 *   1. Corpus: clone the game-assets repository (shallow) unless one is found
 *      (see corpusRepoRoot in lib/config.mjs). --update pulls it.
 *   2. Index: download the prebuilt index (index/assets.db + assets/renders/)
 *      from the latest GitHub release, unless an index already exists. If the
 *      download fails, build the index locally instead (slower).
 *   3. Link: `assets link` (pack folders -> assets/experimental/<slug>).
 *   4. New packs: index and analyze any pack on disk that the index lacks
 *      (packs added to the corpus after the release was built).
 *   5. Skill: write the kenney-assets skill into each skills folder, with this
 *      checkout's path filled in.
 *
 * Re-run it after `git pull` to update the skill and pick up new packs.
 * Settings it was given (corpus path, skills folders, --append file) are kept
 * in .kenney-agent.json, so a bare re-run repeats them.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { openDb } from "../../lib/db.mjs"
import { ROOT, DEFAULT_CORPUS_DIR, assetsRoot, corpusRepoRoot, dbPath, readSettings, writeSettings } from "../../lib/config.mjs"

export const CORPUS_URL = "https://github.com/AAyberkU/game-assets.git"
export const INDEX_URL = "https://github.com/AAyberkU/kenney-agent/releases/latest/download/kenney-agent-index.zip"
const SKILL_NAME = "kenney-assets"
const SKILL_SRC = path.join(ROOT, "skills", SKILL_NAME)
const MARKER = ".kenney-agent-skill"

const log = (s = "") => console.log(s)
const step = (n, s) => log(`\n[${n}/5] ${s}`)
const slash = (p) => p.split(path.sep).join("/")

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`)
}

function have(cmd, args = ["--version"]) {
  try { return spawnSync(cmd, args, { stdio: "ignore" }).status === 0 } catch { return false }
}

function checkNode() {
  const [maj, min] = process.versions.node.split(".").map(Number)
  if (maj < 22 || (maj === 22 && min < 13)) {
    throw new Error(`Node ${process.versions.node} is too old: the index needs node:sqlite (Node 22.13 or newer).`)
  }
}

// -- 1. corpus --------------------------------------------------------------
function ensureCorpus({ corpus, corpusUrl, update }) {
  if (corpus) {
    const dir = path.resolve(corpus)
    if (!fs.existsSync(path.join(dir, "catalog", "library.json"))) {
      throw new Error(`--corpus ${dir} is not a game-assets checkout (no catalog/library.json)`)
    }
    writeSettings({ corpus: path.relative(ROOT, dir) || "." })
  }
  let dir = corpusRepoRoot()
  if (fs.existsSync(path.join(dir, "catalog", "library.json"))) {
    log(`  corpus: ${dir}`)
    if (update && fs.existsSync(path.join(dir, ".git"))) {
      run("git", ["-C", dir, "pull", "--ff-only"])
    }
    return dir
  }
  dir = DEFAULT_CORPUS_DIR
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    throw new Error(`${dir} exists but is not a game-assets checkout; move it away or pass --corpus <path>`)
  }
  if (!have("git")) throw new Error("git is not installed; install it, or clone the corpus yourself and pass --corpus <path>")
  log(`  cloning ${corpusUrl} -> ${dir}`)
  log("  (about 700 MB, 78,000 files; this is the slow step)")
  run("git", ["-c", "core.longpaths=true", "clone", "--depth", "1", corpusUrl, dir])
  if (process.platform === "win32") run("git", ["-C", dir, "config", "core.longpaths", "true"])
  return dir
}

// -- 2. index ---------------------------------------------------------------
function hasIndex() {
  try {
    const db = openDb({ readonly: true })
    const n = db.prepare("SELECT count(*) c FROM assets").get().c
    db.close()
    return n > 0
  } catch {
    return false
  }
}

async function downloadIndex({ indexUrl, indexFile }) {
  let buf
  if (indexFile) {
    buf = fs.readFileSync(path.resolve(indexFile))
    log(`  index: ${indexFile}`)
  } else {
    log(`  downloading ${indexUrl}`)
    const res = await fetch(indexUrl, { headers: { "User-Agent": "kenney-agent-setup" } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
    log(`  ${(buf.length / 1048576).toFixed(1)} MB`)
  }
  const { default: JSZip } = await import("jszip")
  const zip = await JSZip.loadAsync(buf)
  const allowed = [/^index\/assets\.db$/, /^index\/index-info\.json$/, /^assets\/renders\//]
  const rootPrefix = path.resolve(ROOT) + path.sep
  let files = 0
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !allowed.some((re) => re.test(name))) continue
    const out = path.resolve(ROOT, name)
    if (!out.startsWith(rootPrefix)) continue
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, await entry.async("nodebuffer"))
    files++
  }
  for (const ext of ["-wal", "-shm"]) fs.rmSync(dbPath() + ext, { force: true })
  if (!fs.existsSync(dbPath())) throw new Error("the archive holds no index/assets.db")
  const infoFile = path.join(ROOT, "index", "index-info.json")
  if (fs.existsSync(infoFile)) {
    const info = JSON.parse(fs.readFileSync(infoFile, "utf-8"))
    log(`  index built ${info.builtAt}: ${info.assets.toLocaleString()} assets, ${info.packs} packs`)
  }
  return files
}

async function buildIndexLocally() {
  log("  building the index locally (several minutes)")
  const { build } = await import("../index/build.mjs")
  build({})
  const { analyze } = await import("../index/analyze.mjs")
  await analyze({ concurrency: 12 })
  const { importDescriptions } = await import("../index/descriptions.mjs")
  await importDescriptions({})
  const { importSfxTags } = await import("../index/sfx-tags.mjs")
  await importSfxTags()
  if (have("ffprobe", ["-version"]) && have("ffmpeg", ["-version"])) {
    const { measureAudio } = await import("../index/audio.mjs")
    await measureAudio({ concurrency: 6 })
  } else {
    log("  skipped audio facts: ffmpeg/ffprobe not found (install them, then run: assets audio)")
  }
  log("  3D previews: run `assets render-previews` (needs `npx playwright install chromium`)")
}

// -- 4. packs on disk that the index lacks ---------------------------------
function unindexedPacks() {
  const root = assetsRoot()
  if (!fs.existsSync(root)) return []
  const onDisk = fs.readdirSync(root).filter((n) => !n.startsWith(".")).filter((n) => {
    try { return fs.statSync(path.join(root, n)).isDirectory() } catch { return false }
  })
  const db = openDb({ readonly: true })
  const indexed = new Set(db.prepare("SELECT DISTINCT pack FROM assets").all().map((r) => r.pack))
  db.close()
  return onDisk.filter((n) => !indexed.has(n))
}

// -- 5. skill ---------------------------------------------------------------
export function defaultSkillDirs() {
  const claude = path.join(os.homedir(), ".claude")
  return fs.existsSync(claude) ? [path.join(claude, "skills")] : []
}

function copyDir(src, dst, transform) {
  fs.mkdirSync(dst, { recursive: true })
  for (const d of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, d.name), t = path.join(dst, d.name)
    if (d.isDirectory()) copyDir(s, t, transform)
    else fs.writeFileSync(t, transform(d.name, fs.readFileSync(s)))
  }
}

export function installSkill(skillsDir, { append = null, force = false } = {}) {
  const dest = path.join(path.resolve(skillsDir), SKILL_NAME)
  let st = null
  try { st = fs.lstatSync(dest) } catch {}
  if (st?.isSymbolicLink()) fs.unlinkSync(dest) // an old link to this repo: drop the link only
  else if (st && !fs.existsSync(path.join(dest, MARKER)) && !force) {
    throw new Error(`${dest} exists and was not written by kenney-agent; pass --force to replace it`)
  }
  const extra = append ? fs.readFileSync(path.resolve(ROOT, append), "utf-8").trim() : ""
  const here = slash(ROOT)
  copyDir(SKILL_SRC, dest, (name, buf) => {
    if (!name.endsWith(".md")) return buf
    let text = buf.toString("utf-8").replaceAll("{{KENNEY_AGENT}}", here)
    if (name === "SKILL.md" && extra) text = text.trimEnd() + "\n\n## Local rules\n\nThese override the rest of this skill where they differ.\n\n" + extra + "\n"
    return text
  })
  fs.writeFileSync(path.join(dest, MARKER), `Written by ${here} (assets setup). Re-run setup to update; edits here are overwritten.\n`)
  return dest
}

// ---------------------------------------------------------------------------
export async function setup(opts = {}) {
  checkNode()
  const saved = readSettings()
  const skillDirs = opts.skillDirs?.length ? opts.skillDirs : saved.skillDirs ?? defaultSkillDirs()
  const append = opts.append ?? saved.append ?? null
  if (!fs.existsSync(path.join(ROOT, "node_modules", "jszip"))) {
    throw new Error("dependencies are missing: run `npm install` in this folder first")
  }

  step(1, "corpus")
  ensureCorpus({ corpus: opts.corpus, corpusUrl: opts.corpusUrl ?? CORPUS_URL, update: !!opts.update })

  step(2, "index")
  if (hasIndex() && !opts.freshIndex) {
    log(`  index present: ${dbPath()} (pass --fresh-index to replace it)`)
  } else {
    try {
      await downloadIndex({ indexUrl: opts.indexUrl ?? INDEX_URL, indexFile: opts.indexFile })
    } catch (err) {
      log(`  could not get the prebuilt index (${err.message})`)
      opts.buildLocally = true
    }
  }

  step(3, "link")
  const { link } = await import("./link.mjs")
  const r = link({})
  log(`  ${r.localPacks} packs linked into ${assetsRoot()}${r.detected.length ? `; new in the corpus: ${r.detected.join(", ")}` : ""}`)

  step(4, "new packs")
  if (opts.buildLocally) {
    await buildIndexLocally()
  } else {
    const { build } = await import("../index/build.mjs")
    const fresh = unindexedPacks()
    // build() also refreshes the pack table from the catalog link just wrote.
    build({ packs: fresh.length ? fresh : ["__none__"] })
    if (fresh.length) {
      log(`  indexing ${fresh.length} pack(s) the index lacks: ${fresh.join(", ")}`)
      const { analyze } = await import("../index/analyze.mjs")
      await analyze({ packs: fresh })
    } else {
      log("  none")
    }
  }

  step(5, "skill")
  const written = []
  if (opts.noSkill) log("  skipped (--no-skill)")
  else if (!skillDirs.length) log("  no skills folder found: pass --skill-dir <your agent's skills folder>")
  for (const dir of opts.noSkill ? [] : skillDirs) {
    written.push(installSkill(dir, { append, force: !!opts.force }))
    log(`  ${written.at(-1)}`)
  }
  writeSettings({
    skillDirs: opts.noSkill ? saved.skillDirs ?? [] : skillDirs.map((d) => path.resolve(d)),
    ...(append ? { append } : {}),
  })

  const db = openDb({ readonly: true })
  const n = db.prepare("SELECT count(*) c FROM assets").get().c
  db.close()
  log(`\nReady: ${n.toLocaleString()} assets indexed.`)
  log(`Try:   node ${slash(path.relative(process.cwd(), path.join(ROOT, "bin", "assets"))) || "bin/assets"} search "red roof house"`)
  return { assets: n, skills: written }
}
