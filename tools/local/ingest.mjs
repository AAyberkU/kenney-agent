/**
 * `assets ingest [--pack <slug>]`: add pack zips the user dropped into incoming/.
 *
 * Each zip is extracted into <assetsRoot>/<slug>/ as a real directory (it
 * overrides a junction to an older copy in the shared corpus), then moved to
 * incoming/done/. The slug comes from --pack (single zip only) or from the
 * kenney.nl file name pattern kenney_<slug>.zip (also "kenney_<slug>_1.2.zip").
 * Archive content is untrusted data: entries are written only inside the
 * pack directory and nothing in it is ever executed.
 *
 * Run `assets build --packs <slugs>` and `assets analyze --packs <slugs>`
 * afterwards; the CLI does that automatically.
 */
import fs from "node:fs"
import path from "node:path"
import { incomingDir } from "../../lib/config.mjs"
import { extractZip, catalogPacks } from "../../lib/fetch-pack.mjs"

export function slugFromZipName(file) {
  const base = path.basename(file, path.extname(file)).toLowerCase()
  return base.replace(/^kenney[_-]/, "").replace(/[_-]v?\d+(\.\d+)*$/, "").replace(/_/g, "-")
}

export async function ingest({ pack = null } = {}) {
  const dir = incomingDir()
  fs.mkdirSync(path.join(dir, "done"), { recursive: true })
  const zips = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".zip"))
  if (!zips.length) return { dir, results: [] }
  if (pack && zips.length > 1) throw new Error("--pack works with exactly one zip in incoming/")

  const known = new Set(catalogPacks().map((p) => p.slug))
  const results = []
  for (const z of zips) {
    const slug = pack ?? slugFromZipName(z)
    try {
      const r = await extractZip(fs.readFileSync(path.join(dir, z)), slug)
      fs.renameSync(path.join(dir, z), path.join(dir, "done", z))
      results.push({ zip: z, slug, files: r.files, bytes: r.bytes, catalogued: known.has(slug) })
    } catch (err) {
      results.push({ zip: z, slug, error: err.message })
    }
  }
  return { dir, results }
}
