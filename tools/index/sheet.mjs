import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"
import { openDb } from "../../lib/db.mjs"
import { assetFile } from "../../lib/config.mjs"
import { previewFile } from "../../lib/previews.mjs"

/**
 * Composite a set of assets into one labelled contact sheet.
 *
 * This is the step the whole redesign turns on. The index does not have to be
 * a faithful substitute for sight -- it only has to produce a good shortlist,
 * because whoever asked can then look at the sheet and choose. It is also the
 * unit of work for the vision tier: one sheet describes ~64 sprites in one
 * request instead of 64.
 */

const LABEL_H = 16
const PAD = 4

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

/**
 * What to draw for one asset. Images are drawn from themselves; models and
 * fonts from their preview_path (lib/previews.mjs); SVGs are rasterised.
 * `smooth` marks rendered previews, which are downscaled with a smooth kernel
 * (nearest-neighbour is for pixel art) and trimmed of their empty margins.
 */
function sourceFor(r) {
  const file = assetFile(r.pack, r.path)
  const kind = r.kind ?? "image"
  if (kind === "image") return { file }
  const pv = previewFile(r.preview_path)
  if (pv) return { file: pv, smooth: true }
  if ((r.ext ?? path.extname(r.path).toLowerCase()) === ".svg") return { file, smooth: true, svg: true }
  return null
}

export async function buildSheet({ ids, rows: rowsIn, out, cols = 8, cell = 128, label = "id", trim = false }) {
  const db = rowsIn ? null : openDb({ readonly: true })
  const rows = rowsIn ?? ids.map((id) =>
    db.prepare("SELECT id, pack, path, kind, ext, width, height, preview_path FROM assets WHERE id=?").get(id)).filter(Boolean)
  if (db) db.close()
  if (!rows.length) throw new Error("no assets to composite")

  const cols2 = Math.min(cols, rows.length)
  const rowCount = Math.ceil(rows.length / cols2)
  const W = cols2 * cell
  const H = rowCount * cell

  const art = Math.max(16, cell - LABEL_H - PAD * 2)
  const composites = []
  const labels = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const cx = (i % cols2) * cell
    const cy = Math.floor(i / cols2) * cell
    const src0 = sourceFor(r)
    if (!src0) {
      // Nothing to show (a data file, or a model nobody has rendered yet):
      // say so in the cell rather than leaving a silent gap.
      labels.push(
        `<text x="${cx + cell / 2}" y="${cy + cell / 2}" font-family="monospace" font-size="11" ` +
        `fill="#d8d8de" text-anchor="middle">${escapeXml((r.ext ?? path.extname(r.path)) + " - no preview")}</text>`)
    } else try {
      const { file, smooth, svg } = src0
      // Isometric model renders sit small inside a large transparent canvas;
      // without trimming they arrive a few pixels wide and unidentifiable.
      let src = svg ? sharp(file, { density: 144 }) : sharp(file)
      if (trim || smooth) {
        try { src = sharp(await src.trim({ threshold: 1 }).toBuffer()) }
        catch { src = svg ? sharp(file, { density: 144 }) : sharp(file) }   // fully-uniform image: nothing to trim
      }
      // Nearest-neighbour: enlarging pixel art with a smooth kernel destroys
      // exactly the detail a viewer is being asked to judge. Rendered
      // previews are not pixel art and alias badly with it.
      const buf = await src
        .resize(art, art, { fit: "contain", kernel: smooth ? "lanczos3" : "nearest",
                            background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
      composites.push({ input: buf, left: cx + Math.round((cell - art) / 2), top: cy + PAD })
    } catch {
      continue
    }
    const text = label === "id" ? String(r.id) : path.parse(r.path).name
    labels.push(
      `<text x="${cx + cell / 2}" y="${cy + cell - PAD}" font-family="monospace" ` +
      `font-size="10" fill="#ffffff" text-anchor="middle">${escapeXml(text.slice(0, 18))}</text>`,
    )
  }

  // Mid-grey ground so both near-black and near-white sprites stay visible,
  // with cell separators so the eye can tell one sprite from the next.
  const grid = []
  for (let c = 1; c < cols2; c++) grid.push(`<line x1="${c * cell}" y1="0" x2="${c * cell}" y2="${H}" stroke="#5a5a5a" stroke-width="1"/>`)
  for (let r = 1; r < rowCount; r++) grid.push(`<line x1="0" y1="${r * cell}" x2="${W}" y2="${r * cell}" stroke="#5a5a5a" stroke-width="1"/>`)

  const overlay = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${grid.join("")}${labels.join("")}</svg>`,
  )

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 112, g: 112, b: 118, alpha: 1 } } })
    .composite([...composites, { input: overlay, top: 0, left: 0 }])
    .png()
    .toFile(out)

  return { out, count: composites.length, width: W, height: H }
}
