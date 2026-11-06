import fs from "node:fs"
import path from "node:path"

/**
 * The files a 3D model needs next to it to load.
 *
 * A model is rarely one file. A .gltf names its .bin buffers and images, most
 * Kenney .glb files name an external `Textures/colormap.png`, and an .obj names
 * its .mtl, which names its textures. Every such reference is a relative path
 * from the model's own folder, so installing the model means installing those
 * files at the same relative place.
 *
 * Only references that stay inside the model's pack are followed. Absolute
 * paths, URIs with a scheme (`data:`, `http:`, `file:` ...) and `..` that
 * climbs out of the pack are reported and skipped, never read.
 *
 * FBX cannot be resolved this way: the animated-character packs keep skins in
 * a separate `Skins/` folder that the file does not name. modelDependencies
 * returns a hint for those instead.
 */

export const DEPENDENCY_EXTS = [".gltf", ".glb", ".obj", ".mtl"]

const GLB_MAGIC = 0x46546c67 // "glTF"
const GLB_JSON = 0x4e4f534a // "JSON"

/** The parsed JSON of a .gltf, or of a .glb's JSON chunk. Throws on a bad file. */
export function gltfJson(file) {
  const buf = fs.readFileSync(file)
  if (path.extname(file).toLowerCase() === ".gltf") return JSON.parse(buf.toString("utf8"))
  if (buf.length < 20 || buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB file")
  const len = buf.readUInt32LE(12)
  if (buf.readUInt32LE(16) !== GLB_JSON || 20 + len > buf.length) throw new Error("GLB has no JSON chunk")
  return JSON.parse(buf.subarray(20, 20 + len).toString("utf8"))
}

function gltfRefs(file) {
  const json = gltfJson(file)
  return [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((x) => x?.uri)
    .filter((u) => typeof u === "string" && u.length)
    .map((u) => {
      try { return decodeURIComponent(u) } catch { return u }
    })
}

function lines(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
}

function objRefs(file) {
  const out = []
  for (const l of lines(file)) {
    const m = l.match(/^mtllib\s+(.+)$/)
    if (!m) continue
    // The spec separates several libraries with spaces; a single name with
    // spaces in it is also common in exports, so prefer the whole rest when
    // that file exists.
    const whole = m[1].trim()
    if (fs.existsSync(path.join(path.dirname(file), whole.replaceAll("\\", "/")))) out.push(whole)
    else out.push(...whole.split(/\s+/))
  }
  return out
}

// Texture statements in an .mtl, and the options that may precede the file
// name. Options that take one word are listed; the rest take 1-3 numbers.
const MTL_MAP = /^(map_\w+|bump|disp|decal|refl|norm)$/i
const ONE_WORD_OPTS = new Set(["-blendu", "-blendv", "-cc", "-clamp", "-imfchan", "-type", "-texres", "-bm", "-boost"])
const isNum = (s) => /^-?\d*\.?\d+(e-?\d+)?$/i.test(s)

function mtlRefs(file) {
  const out = []
  for (const l of lines(file)) {
    const tokens = l.split(/\s+/)
    if (!MTL_MAP.test(tokens[0])) continue
    let i = 1
    while (i < tokens.length && tokens[i].startsWith("-") && !isNum(tokens[i])) {
      const opt = tokens[i++].toLowerCase()
      if (ONE_WORD_OPTS.has(opt)) i++
      else while (i < tokens.length - 1 && isNum(tokens[i])) i++
    }
    const name = tokens.slice(i).join(" ")
    if (name) out.push(name)
  }
  return out
}

function refsOf(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".gltf": case ".glb": return gltfRefs(file)
    case ".obj": return objRefs(file)
    case ".mtl": return mtlRefs(file)
    default: return []
  }
}

/** Why a reference is not followed, or null when it is a plain relative path. */
function unsafeRef(ref) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return "has a URI scheme" // http:, file:, C: ...
  if (ref.startsWith("/") || ref.startsWith("\\") || path.isAbsolute(ref)) return "is absolute"
  return null
}

function inside(dir, file) {
  const rel = path.relative(dir, file)
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

function real(p) {
  try { return fs.realpathSync(p) } catch { return null }
}

/**
 * Every relative file a model references, recursively (OBJ -> MTL -> textures).
 *
 *   model    absolute path of the model file
 *   packDir  absolute path of its pack; references may not leave it
 *
 * Returns { files, missing, skipped, hint }:
 *   files    [{ abs, rel }] that exist, rel = pack-relative POSIX path,
 *            deduplicated, the model itself excluded
 *   missing  pack-relative paths that are referenced but not on disk
 *   skipped  [{ ref, from, reason }] references that were not followed
 *   hint     a sentence for formats whose dependencies cannot be read (FBX)
 */
export function modelDependencies(model, packDir) {
  const result = { files: [], missing: [], skipped: [], hint: null }
  const ext = path.extname(model).toLowerCase()
  if (ext === ".fbx") {
    const where = fs.existsSync(path.join(packDir, "Skins"))
      ? "this pack keeps its skins in the Skins/ folder"
      : "its textures are separate files in the pack"
    result.hint = `FBX textures are not read from the file; ${where}. Install the skin or texture PNG ` +
      `you want by id too (assets search skin --pack ${path.basename(packDir)}).`
    return result
  }
  if (!DEPENDENCY_EXTS.includes(ext)) return result

  const packReal = real(packDir) ?? path.resolve(packDir)
  const seen = new Set([path.resolve(model).toLowerCase()])
  const queue = [path.resolve(model)]
  const relOf = (abs) => path.relative(packDir, abs).split(path.sep).join("/")

  while (queue.length) {
    const file = queue.shift()
    let refs
    try { refs = refsOf(file) } catch (e) {
      result.skipped.push({ ref: relOf(file), from: relOf(file), reason: `could not be parsed (${e.message})` })
      continue
    }
    for (const raw of refs) {
      const ref = raw.replaceAll("\\", "/")
      if (ref.toLowerCase().startsWith("data:")) continue // embedded, nothing to copy
      const why = unsafeRef(ref)
      if (why) { result.skipped.push({ ref: raw, from: relOf(file), reason: why }); continue }
      const abs = path.resolve(path.dirname(file), ...ref.split("/"))
      if (!inside(path.resolve(packDir), abs)) {
        result.skipped.push({ ref: raw, from: relOf(file), reason: "leaves the pack" })
        continue
      }
      const key = abs.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { result.missing.push(relOf(abs)); continue }
      // A link inside the pack must not lead out of it either.
      const absReal = real(abs)
      if (!absReal || !inside(packReal, absReal)) {
        result.skipped.push({ ref: raw, from: relOf(file), reason: "links out of the pack" })
        continue
      }
      result.files.push({ abs, rel: relOf(abs) })
      if (DEPENDENCY_EXTS.includes(path.extname(abs).toLowerCase())) queue.push(abs)
    }
  }
  return result
}
