import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import sharp from "sharp"
import { openDb } from "../../lib/db.mjs"
import { ROOT, assetsRoot } from "../../lib/config.mjs"
import { MODEL_EXTS, RENDERS_DIR, linkPreviews, modelRenderRel, writePath } from "../../lib/previews.mjs"

/**
 * `assets render-previews`: draw a preview for every 3D model that has none.
 *
 * Headless Chromium (Playwright, using an already-cached browser) runs
 * three.js with GLTFLoader / FBXLoader / OBJLoader. Node serves the page,
 * three.js and the corpus from a loopback HTTP server, and the page is
 * forbidden every other request, so a model can only pull in files that sit
 * in its own pack (textures such as Kenney's shared colormap.png). Corpus
 * files are only ever parsed as models and images, never executed.
 *
 * Output: assets/renders/<pack>/<model path>.png, 256x256, transparent.
 * Resumable: a model whose render already exists is linked, not re-rendered,
 * unless --force. Models with a Kenney-made preview are never rendered.
 */

const OUT_SIZE = 256
const ITEM_TIMEOUT_MS = 60_000

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
  ".fbx": "application/octet-stream", ".obj": "text/plain", ".mtl": "text/plain",
  ".tga": "application/octet-stream",
}

/** Resolve `rel` under `base`, refusing anything that escapes it. */
function inside(base, rel) {
  const abs = path.resolve(base, ...rel.split("/").filter(Boolean))
  const b = path.resolve(base)
  return abs === b || abs.startsWith(b + path.sep) ? abs : null
}

function startServer() {
  const mounts = {
    page: path.join(ROOT, "tools", "render", "page"),
    three: path.join(ROOT, "node_modules", "three"),
    corpus: assetsRoot(),
  }
  const server = http.createServer((req, res) => {
    try {
      if (req.method !== "GET") { res.writeHead(405).end(); return }
      const url = new URL(req.url, "http://localhost")
      const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean)
      const base = mounts[parts[0]]
      const file = base && inside(base, parts.slice(1).join("/"))
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return }
      res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" })
      fs.createReadStream(file).pipe(res)
    } catch {
      res.writeHead(500).end()
    }
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)))
}

export const enc = (pack, rel) => "/corpus/" + [pack, ...rel.split("/")].map(encodeURIComponent).join("/")

// ---------------------------------------------------------- character packs --
// Kenney's animated characters ship an untextured FBX plus a folder of skin
// PNGs that all share one UV layout. Pick a skin that fits the model's name.
const isFemale = (s) => /female/i.test(s)
const isMale = (s) => /male/i.test(s) && !/female/i.test(s)
const PREFERRED_SKIN = /^(casual|human|survivor|criminal|skater|animal)/i

function chooseSkin(relPath, images) {
  const skins = images.filter((p) => /(^|\/)skins\//i.test(p) && !/(^|\/)source\//i.test(p))
  if (!skins.length) return null
  const animal = /(^|\/)animals?\//i.test(relPath)
  const pool = skins.filter((p) => /(^|\/)animals?\//i.test(p) === animal)
  if (!pool.length) return null
  const name = path.posix.basename(relPath)
  const rank = (p) => {
    const b = path.posix.basename(p)
    let r = 0
    if (isFemale(name)) r += isFemale(b) ? 0 : 4
    else if (isMale(name)) r += isMale(b) ? 0 : 4
    else r += isFemale(b) ? 2 : 0
    if (!PREFERRED_SKIN.test(b)) r += 1
    return r
  }
  return [...pool].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0]
}

function baseModelFor(models) {
  const cands = models.filter((p) => /(^|\/)models?\//i.test(p) && p.toLowerCase().endsWith(".fbx"))
  return cands.find((p) => /medium/i.test(p)) ?? cands.sort()[0] ?? null
}

/** Work items: one per model that lacks any preview (or every render with --force). */
export function planJobs(db, { packs, force, limit }) {
  const packFilter = packs?.length ? ` AND pack IN (${packs.map(() => "?").join(",")})` : ""
  const args = packs?.length ? packs : []
  const exts = MODEL_EXTS.map((e) => `'${e}'`).join(",")
  const rows = db.prepare(
    `SELECT id, pack, path, ext, preview_path FROM assets WHERE ext IN (${exts})${packFilter} ORDER BY pack, path`).all(...args)
  const todo = rows.filter((r) => r.preview_path == null ||
    (force && r.preview_path.startsWith(RENDERS_DIR + "/")))

  const packInfo = new Map()
  const info = (pack) => {
    if (!packInfo.has(pack)) {
      const images = db.prepare("SELECT path FROM assets WHERE pack=? AND kind='image'").all(pack).map((r) => r.path)
      const models = rows.filter((r) => r.pack === pack).map((r) => r.path)
      packInfo.set(pack, { images, base: baseModelFor(models) })
    }
    return packInfo.get(pack)
  }

  const jobs = todo.map((r) => {
    const rel = modelRenderRel(r.pack, r.path)
    const job = { id: r.id, pack: r.pack, path: r.path, rel, out: writePath(rel), url: enc(r.pack, r.path) }
    if (r.ext === ".fbx") {
      const { images, base } = info(r.pack)
      // Accessories carry their own material colours, except the animal ears,
      // tails and mouths, which take the animal skins.
      const ownColours = /(^|\/)accessories\//i.test(r.path) && !/(^|\/)animals?\//i.test(r.path)
      const skin = ownColours ? null : chooseSkin(r.path, images)
      if (skin) { job.skin = enc(r.pack, skin); job.skinPath = skin }
      if (/(^|\/)animations\//i.test(r.path)) {
        job.pose = true
        if (base) job.baseModel = enc(r.pack, base)
      }
    }
    return job
  })
  return limit ? jobs.slice(0, limit) : jobs
}

async function withTimeout(p, ms, what) {
  let t
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout after ${ms / 1000}s: ${what}`)), ms) })
  try { return await Promise.race([p, timer]) } finally { clearTimeout(t) }
}

/**
 * One headless browser serving model renders. render(page, job) resolves to
 * { png (256x256 Buffer), failed (urls that did not load), meshes, posed }.
 */
export async function openRenderer() {
  const { chromium } = await import("playwright")
  const server = await startServer()
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({
    headless: true,
    // SwiftShader keeps WebGL deterministic and independent of the GPU.
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  })
  const context = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 })
  // Nothing leaves the machine: only the loopback server is reachable.
  await context.route("**/*", (route) =>
    route.request().url().startsWith(origin + "/") ? route.continue() : route.abort())

  const newPage = async () => {
    const page = await context.newPage()
    await page.goto(`${origin}/page/index.html`)
    await page.waitForFunction(() => window.rendererReady === true, null, { timeout: 30_000 })
    return page
  }

  const render = async (page, j) => {
    const r = await withTimeout(page.evaluate((o) => window.renderModel(o), {
      url: origin + j.url,
      skin: j.skin ? origin + j.skin : undefined,
      baseModel: j.baseModel ? origin + j.baseModel : undefined,
      pose: !!j.pose,
      azimuth: j.azimuth, elevation: j.elevation,
    }), ITEM_TIMEOUT_MS, j.path)
    const img = sharp(Buffer.from(r.dataUrl.split(",")[1], "base64"))
      .resize(OUT_SIZE, OUT_SIZE, { fit: "contain", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    const { data, info } = await img.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let opaque = 0
    for (let i = 3; i < data.length; i += info.channels) if (data[i] > 8) opaque++
    if (opaque < 20) throw new Error("empty render (nothing visible)")
    return { png: await img.png().toBuffer(), failed: r.failed.map((u) => u.replace(origin, "")),
             meshes: r.meshes, posed: r.posed }
  }

  const close = async () => { await browser.close(); server.close() }
  return { newPage, render, close }
}

export async function renderModelPreviews({ packs = null, force = false, concurrency = 4, limit = 0, log = console.log } = {}) {
  const db = openDb()
  linkPreviews(db, { packs })
  const before = db.prepare(`SELECT count(*) c FROM assets WHERE ext IN (${MODEL_EXTS.map((e) => `'${e}'`).join(",")}) AND preview_path IS NOT NULL`).get().c
  const jobs = planJobs(db, { packs, force, limit })
  const setPreview = db.prepare("UPDATE assets SET preview_path=? WHERE id=?")

  // Resumable: an existing render is only linked.
  const pending = []
  let reused = 0
  for (const j of jobs) {
    if (!force && fs.existsSync(j.out)) { setPreview.run(j.rel, j.id); reused++ }
    else pending.push(j)
  }
  log(`  models without a preview: ${jobs.length} (${reused} already rendered, ${pending.length} to render)`)
  const failures = []
  let rendered = 0
  const t0 = Date.now()

  if (pending.length) {
    const renderer = await openRenderer()
    let next = 0
    const worker = async () => {
      let page = await renderer.newPage()
      while (next < pending.length) {
        const j = pending[next++]
        try {
          const r = await renderer.render(page, j)
          fs.mkdirSync(path.dirname(j.out), { recursive: true })
          fs.writeFileSync(j.out, r.png)
          setPreview.run(j.rel, j.id)
          rendered++
          // A texture that failed to load still yields a picture (untextured);
          // keep it, but list it so it can be checked.
          if (r.failed.length) failures.push({ id: j.id, pack: j.pack, path: j.path, warning: "rendered, but files failed to load", urls: r.failed })
        } catch (err) {
          failures.push({ id: j.id, pack: j.pack, path: j.path, error: String(err.message ?? err).split("\n")[0] })
          // A crashed or wedged page is replaced rather than trusted again.
          try { await page.close() } catch {}
          page = await renderer.newPage()
        }
        const done = rendered + failures.filter((f) => f.error).length
        if (done % 50 === 0 || done === pending.length) {
          const s = (Date.now() - t0) / 1000
          log(`  ${done}/${pending.length}  ${s.toFixed(0)}s  (${(done / s).toFixed(1)}/s)`)
        }
      }
      await page.close()
    }
    try {
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, pending.length)) }, worker))
    } finally {
      await renderer.close()
    }
  }

  const after = db.prepare(`SELECT count(*) c FROM assets WHERE ext IN (${MODEL_EXTS.map((e) => `'${e}'`).join(",")}) AND preview_path IS NOT NULL`).get().c
  const total = db.prepare(`SELECT count(*) c FROM assets WHERE ext IN (${MODEL_EXTS.map((e) => `'${e}'`).join(",")})`).get().c
  db.close()

  const errors = failures.filter((f) => f.error)
  const warnings = failures.filter((f) => !f.error)
  const report = path.join(ROOT, RENDERS_DIR, "failures.json")
  fs.mkdirSync(path.dirname(report), { recursive: true })
  fs.writeFileSync(report, JSON.stringify({ at: new Date().toISOString(), errors, warnings }, null, 2) + "\n")

  return { total, before, after, planned: jobs.length, reused, rendered, failed: errors.length,
           warnings: warnings.length, seconds: Math.round((Date.now() - t0) / 1000), report }
}
