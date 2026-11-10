import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Where the extracted Kenney corpus lives.
 *
 * The corpus is ~188 MB of gitignored data, so it does not travel with a
 * clone or a worktree. Treat it as data with a configurable location rather
 * than assuming it sits inside the repo.
 *   ASSETS_ROOT=/path/to/experimental assets build
 */
export function assetsRoot() {
  const env = process.env.ASSETS_ROOT
  if (env) return path.resolve(env)

  const local = path.join(ROOT, "assets", "experimental")
  if (hasContent(local)) return local

  // The corpus is gitignored, so it does not travel into a git worktree. If
  // the local one is empty, fall back to the main checkout's copy rather than
  // serving an index whose every image 404s.
  const main = mainCheckoutRoot()
  if (main) {
    const shared = path.join(main, "assets", "experimental")
    if (hasContent(shared)) return shared
  }
  return local
}

function hasContent(dir) {
  try {
    return fs.readdirSync(dir).some((n) => !n.startsWith("."))
  } catch {
    return false
  }
}

/** For a linked worktree, .git is a file pointing at <main>/.git/worktrees/<name>. */
export function mainCheckoutRoot() {
  try {
    const dotGit = path.join(ROOT, ".git")
    if (!fs.statSync(dotGit).isFile()) return null
    const m = fs.readFileSync(dotGit, "utf-8").match(/gitdir:\s*(.+)/)
    if (!m) return null
    // git writes this pointer with forward slashes even on Windows, where
    // path.sep is a backslash -- so normalise before looking for the marker.
    const gitDir = m[1].trim().replaceAll(String.fromCharCode(92), "/")
    const idx = gitDir.indexOf("/.git/worktrees/")
    return idx === -1 ? null : gitDir.slice(0, idx)
  } catch {
    return null
  }
}

export function dbPath() {
  return process.env.ASSETS_DB
    ? path.resolve(process.env.ASSETS_DB)
    : path.join(ROOT, "index", "assets.db")
}

/**
 * The catalog the index reads. `assets link` writes catalog.local.json: the
 * scraped kenney.nl catalog merged with the local corpus (KenneyAssets). Fall
 * back to the scraped one when no local catalog exists yet.
 */
export function catalogPath() {
  const local = path.join(ROOT, "catalog", "catalog.local.json")
  return fs.existsSync(local) ? local : path.join(ROOT, "catalog", "catalog.json")
}

/** The scraped kenney.nl catalog, as committed. */
export function scrapedCatalogPath() {
  return path.join(ROOT, "catalog", "catalog.json")
}

/** Local settings written by `assets setup` (gitignored). */
export const SETTINGS_FILE = path.join(ROOT, ".kenney-agent.json")

export function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"))
  } catch {
    return {}
  }
}

export function writeSettings(patch) {
  const next = { ...readSettings(), ...patch }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + "\n")
  return next
}

/** Where `assets setup` clones the corpus when nothing else is configured. */
export const DEFAULT_CORPUS_DIR = path.join(ROOT, "corpus")

/**
 * The corpus repository: a clone of the game-assets repository
 * (https://github.com/AAyberkU/game-assets, a fork of eturner58/game-assets).
 *
 * Order: KENNEY_ASSETS_DIR, the path `assets setup` saved, ./corpus, then the
 * sibling folders ../game-assets and ../KenneyAssets (older layouts).
 */
export function corpusRepoRoot() {
  if (process.env.KENNEY_ASSETS_DIR) return path.resolve(process.env.KENNEY_ASSETS_DIR)
  const saved = readSettings().corpus
  if (saved) return path.resolve(ROOT, saved)
  for (const dir of [DEFAULT_CORPUS_DIR, path.resolve(ROOT, "..", "game-assets"), path.resolve(ROOT, "..", "KenneyAssets")]) {
    if (fs.existsSync(path.join(dir, "catalog", "library.json"))) return dir
  }
  return DEFAULT_CORPUS_DIR
}

/** Where the user drops pack zips for `assets ingest`. */
export function incomingDir() {
  return path.join(ROOT, "incoming")
}

/** Absolute path to one asset on disk. */
export function assetFile(pack, relPath) {
  return path.join(assetsRoot(), pack, relPath.split("/").join(path.sep))
}

export function requireAssetsRoot() {
  const root = assetsRoot()
  if (!fs.existsSync(root)) {
    throw new Error(
      `Asset corpus not found at ${root}\n` +
        `Set ASSETS_ROOT to the directory holding the extracted packs, e.g.\n` +
        `  ASSETS_ROOT="/path/to/assets/experimental" assets build`,
    )
  }
  return root
}
