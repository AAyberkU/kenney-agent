import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"
import opentype from "opentype.js"
import { openDb } from "../../lib/db.mjs"
import { assetFile } from "../../lib/config.mjs"
import { FONT_EXTS, fontSpecimenRel, writePath } from "../../lib/previews.mjs"

/**
 * Font specimens: a PNG drawn from the font's own glyph outlines (opentype.js
 * turns them into SVG paths, sharp rasterises them), so the sheet shows what
 * the font really looks like and which characters it lacks.
 *
 * Output: assets/renders/fonts/<pack>/<font path>.png, 512x256.
 * Sets preview_path, and glyphs_missing to the specimen characters the font
 * has no glyph for ("" when it has them all). Missing characters are drawn as
 * red boxes and listed under the specimen.
 */

const W = 512, H = 256, PAD = 16
const LINES = [
  { text: null, max: 44 },                                    // the font's name
  { text: "AaBbCc 0123 ÇĞİÖŞÜ çğıöşü", max: 34 },
  { text: "The quick brown fox jumps over the lazy dog.", max: 24 },
]
const CHECKED = [...new Set([...LINES[1].text, ...LINES[2].text].filter((c) => c.trim()))]

// SVG path data built here rather than with Path.toPathData(): opentype.js
// 2.0's number formatting returned "NaN" for some coordinates (a boxed "u"
// lost its outer contour). Each contour is closed explicitly.
const n = (v) => (Math.round(v * 100) / 100).toString()
function pathD(p) {
  let d = "", open = false
  for (const c of p.commands) {
    if (c.type === "M") { if (open) d += "Z"; d += `M${n(c.x)} ${n(c.y)}`; open = true }
    else if (c.type === "L") d += `L${n(c.x)} ${n(c.y)}`
    else if (c.type === "Q") d += `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
    else if (c.type === "C") d += `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`
    else if (c.type === "Z") { d += "Z"; open = false }
  }
  return open ? d + "Z" : d
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function parseFont(file) {
  const b = fs.readFileSync(file)
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

function fontName(font, file) {
  for (const k of ["fullName", "fontFamily"]) {
    try { const n = font.getEnglishName(k); if (n) return n } catch {}
  }
  return path.basename(file, path.extname(file))
}

/** One line of text as SVG, fitted to the width; missing glyphs become red boxes. */
function lineSvg(font, text, y, maxSize) {
  const units = font.unitsPerEm || 1000
  const glyphs = [...text].map((c) => {
    const g = font.charToGlyph(c)
    const missing = c.trim() !== "" && (!g || g.index === 0)
    const adv = missing ? units * 0.6 : (g.advanceWidth ?? units * 0.5)
    return { c, g, missing, adv }
  })
  const totalUnits = glyphs.reduce((s, g) => s + g.adv, 0) || units
  const size = Math.min(maxSize, (W - PAD * 2) / totalUnits * units)
  const scale = size / units
  let x = PAD
  const paths = [], boxes = []
  for (const g of glyphs) {
    if (g.missing) {
      boxes.push(`<rect x="${(x + size * 0.06).toFixed(1)}" y="${(y - size * 0.7).toFixed(1)}" ` +
        `width="${(g.adv * scale - size * 0.12).toFixed(1)}" height="${(size * 0.7).toFixed(1)}" ` +
        `fill="none" stroke="#d0342c" stroke-width="1.5"/>`)
    } else if (g.c.trim()) {
      const d = pathD(font.getPath(g.c, x, y, size))
      if (d) paths.push(d)
    }
    x += g.adv * scale
  }
  // One <path> per glyph: librsvg silently stopped drawing a single combined
  // path part-way through long lines of blocky glyphs.
  return `<g fill="#1e1e24">${paths.map((d) => `<path d="${d}"/>`).join("")}</g>${boxes.join("")}`
}

/** Icon fonts (Kenney's input prompts) have no Latin: show their first glyphs instead. */
function iconGridSvg(font) {
  const cells = []
  for (let i = 0; i < font.glyphs.length && cells.length < 24; i++) {
    const g = font.glyphs.get(i)
    if (g.unicode !== undefined && g.index !== 0) cells.push(g)
  }
  const cols = 12, cell = (W - PAD * 2) / cols, size = cell * 0.8
  return cells.map((g, i) => {
    const cx = PAD + (i % cols) * cell, top = 64 + Math.floor(i / cols) * (cell + 8)
    const scale = size / (font.unitsPerEm || 1000)
    const x = cx + (cell - (g.advanceWidth ?? font.unitsPerEm) * scale) / 2
    return `<path d="${pathD(font.getPath(String.fromCodePoint(g.unicode), x, top + size * 0.85, size))}" fill="#1e1e24"/>`
  }).join("")
}

export async function renderSpecimen(file, outFile) {
  const font = parseFont(file)
  const name = fontName(font, file)
  const missing = CHECKED.filter((c) => { const g = font.charToGlyph(c); return !g || g.index === 0 })
  const latinMissing = [..."AaBbCc"].filter((c) => missing.includes(c)).length
  const icon = latinMissing >= 3

  let body
  let footer
  if (icon) {
    body = `<text x="${PAD}" y="40" font-family="sans-serif" font-size="22" font-weight="bold" fill="#1e1e24">${esc(name)}</text>` +
           iconGridSvg(font)
    footer = `icon font, ${font.glyphs.length} glyphs, no Latin text`
  } else {
    body = lineSvg(font, name, 62, LINES[0].max) +
           lineSvg(font, LINES[1].text, 122, LINES[1].max) +
           lineSvg(font, LINES[2].text, 176, LINES[2].max)
    footer = missing.length ? `missing: ${missing.join(" ")}` : "all specimen glyphs present (incl. Turkish)"
  }
  const svg =
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${W}" height="${H}" rx="10" fill="#f4f3ee"/>${body}` +
    `<text x="${PAD}" y="${H - 18}" font-family="sans-serif" font-size="14" ` +
    `fill="${missing.length && !icon ? "#b3261e" : "#55555c"}">${esc(footer)}</text></svg>`

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  // Supersampled (2x, then downscaled) for cleaner small text.
  await sharp(Buffer.from(svg), { density: 144 }).resize(W, H, { kernel: "lanczos3" }).png().toFile(outFile)
  return { name, missing: missing.join(""), icon }
}

export async function renderFontSpecimens({ packs = null, force = false, log = console.log } = {}) {
  const db = openDb()
  const packFilter = packs?.length ? ` AND pack IN (${packs.map(() => "?").join(",")})` : ""
  const rows = db.prepare(
    `SELECT id, pack, path FROM assets WHERE ext IN (${FONT_EXTS.map((e) => `'${e}'`).join(",")})${packFilter} ORDER BY pack, path`,
  ).all(...(packs ?? []))
  const set = db.prepare("UPDATE assets SET preview_path=?, glyphs_missing=? WHERE id=?")
  const r = { fonts: rows.length, rendered: 0, reused: 0, failed: [], icon: 0, missingTurkish: 0 }
  for (const row of rows) {
    const rel = fontSpecimenRel(row.pack, row.path)
    const out = writePath(rel)
    try {
      // The glyph check is cheap, so it is redone even when the PNG exists.
      if (!force && fs.existsSync(out)) {
        const font = parseFont(assetFile(row.pack, row.path))
        const miss = CHECKED.filter((c) => { const g = font.charToGlyph(c); return !g || g.index === 0 }).join("")
        set.run(rel, miss, row.id); r.reused++
        if (/[ÇĞİÖŞÜçğıöşü]/.test(miss)) r.missingTurkish++
        if ([..."AaBbCc"].filter((c) => miss.includes(c)).length >= 3) r.icon++
        continue
      }
      const s = await renderSpecimen(assetFile(row.pack, row.path), out)
      set.run(rel, s.missing, row.id)
      r.rendered++
      if (s.icon) r.icon++
      if (/[ÇĞİÖŞÜçğıöşü]/.test(s.missing)) r.missingTurkish++
    } catch (err) {
      r.failed.push({ id: row.id, pack: row.pack, path: row.path, error: String(err.message ?? err) })
    }
  }
  db.close()
  log(`  fonts: ${r.rendered} specimens rendered, ${r.reused} kept, ${r.failed.length} failed` +
      ` (${r.icon} icon fonts; ${r.missingTurkish} lack some Turkish glyphs)`)
  for (const f of r.failed) log(`    FAILED ${f.pack}/${f.path}: ${f.error}`)
  return r
}
