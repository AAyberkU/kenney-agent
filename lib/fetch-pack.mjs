import fs from "node:fs"
import https from "node:https"
import path from "node:path"
import { assetsRoot, catalogPath } from "./config.mjs"

/**
 * Download and extract one pack into the corpus.
 *
 * Extracted from tools/extract.mjs so the dev server can call it too. The old
 * version parsed src/kenney/catalog.ts with a regex to find download URLs;
 * catalog.json is now the source of truth and catalog.ts is generated from it,
 * so there is nothing to parse.
 */

export function catalogPacks() {
  return JSON.parse(fs.readFileSync(catalogPath(), "utf-8")).packs
}

export function findPack(slug) {
  return catalogPacks().find((p) => p.slug === slug)
}

function download(url, onProgress) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "kenney-agent/1.0 (local CC0 asset index; https://github.com/AAyberkU/kenney-agent)" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return download(res.headers.location, onProgress).then(resolve, reject)
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        const total = parseInt(res.headers["content-length"] ?? "0", 10)
        const chunks = []
        let got = 0
        res.on("data", (c) => {
          chunks.push(c)
          got += c.length
          onProgress?.(got, total)
        })
        res.on("end", () => resolve(Buffer.concat(chunks)))
      })
      .on("error", reject)
  })
}

// Keep sidecars, not just media: the old filter discarded every spritesheet
// XML atlas, every License.txt, and the models in all 3D packs. SVG, fonts and
// Tiled maps are kept too, so a pack extracted here matches the local corpus.
const KEEP = /.(png|jpg|jpeg|gif|svg|wav|mp3|ogg|webm|xml|txt|json|fnt|csv|glb|gltf|obj|mtl|fbx|dae|bin|ttf|otf|tmx|tsx)$/i

/** True when a corpus entry is a junction or symlink into the shared corpus. */
export function isLinked(slug) {
  try {
    return fs.lstatSync(path.join(assetsRoot(), slug)).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Extract a pack zip into the corpus as <assetsRoot>/<slug>/.
 *
 * Used by fetchPack (download) and by `assets ingest` (a zip the user dropped
 * into incoming/). If the slug is currently a junction into the shared corpus,
 * only the link is removed -- never the files it points at -- and the new zip
 * becomes a real directory that overrides it.
 */
export async function extractZip(buffer, slug) {
  const { default: JSZip } = await import("jszip")
  const zip = await JSZip.loadAsync(buffer)
  const dest = path.join(assetsRoot(), slug)
  if (isLinked(slug)) fs.unlinkSync(dest)
  const destRoot = path.resolve(dest) + path.sep

  let count = 0
  let bytes = 0
  for (const [filePath, file] of Object.entries(zip.files)) {
    if (file.dir || !KEEP.test(file.name)) continue
    const out = path.resolve(dest, filePath)
    // Never let a zip entry escape the destination directory.
    if (!out.startsWith(destRoot)) continue
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const buf = await file.async("nodebuffer")
    fs.writeFileSync(out, buf)
    count++
    bytes += buf.length
  }

  return { slug, dest, files: count, bytes, zipBytes: buffer.length }
}

export async function fetchPack(slug, { onProgress } = {}) {
  const pack = findPack(slug)
  if (!pack) throw new Error(`unknown pack: ${slug}`)
  if (!pack.downloadUrl) throw new Error(`no download URL for ${slug}`)

  const buffer = await download(pack.downloadUrl, onProgress)
  return extractZip(buffer, slug)
}

export function isOnDisk(slug) {
  const dir = path.join(assetsRoot(), slug)
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0
}

export function removePack(slug) {
  const dir = path.join(assetsRoot(), slug)
  if (!fs.existsSync(dir)) return false
  // A linked pack belongs to the shared corpus: drop the link, keep the files.
  if (isLinked(slug)) { fs.unlinkSync(dir); return true }
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}
