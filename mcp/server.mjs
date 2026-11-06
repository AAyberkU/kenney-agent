#!/usr/bin/env node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { openDb } from "../lib/db.mjs"
import { searchAssets } from "../lib/search.mjs"
import { assetFile, assetsRoot, dbPath } from "../lib/config.mjs"
import { previewFile } from "../lib/previews.mjs"
import { catalogPacks, isOnDisk } from "../lib/fetch-pack.mjs"
import { buildSheet } from "../tools/index/sheet.mjs"
import { install } from "../tools/index/install.mjs"

/**
 * Kenney asset index over MCP.
 *
 * The point of exposing this over MCP rather than only as a CLI is
 * `contact_sheet`: MCP tools may return images, so any client can run the loop
 * this whole project is built around -- narrow tens of thousands of sprites to
 * twenty by search, then *look* at them and choose. A text-only asset search
 * would just be a worse `ls`.
 *
 * Every tool reads through lib/search.mjs, the same query the CLI, the web app
 * and the eval harness use, so what a client gets back is what the measured
 * 95.7% recall was measured on.
 *
 * Read-only by default. install_assets writes, and only inside a directory the
 * caller names.
 */

const server = new McpServer({ name: "kenney-assets", version: "1.0.0" })

function requireIndex() {
  if (!fs.existsSync(dbPath())) {
    throw new Error(
      `No index at ${dbPath()}.\n` +
      `Build one: node bin/assets build && node bin/assets analyze\n` +
      `Set ASSETS_ROOT if the extracted packs live elsewhere.`)
  }
}

const fmt = (r) => {
  const size = r.width ? `${r.width}x${r.height}` : "-"
  const bits = [r.role, r.style, r.anim_frame].filter(Boolean).join("/")
  const line = `${r.id}  ${r.pack}  ${size}  ${bits}  ${r.path}`
  if (!r.observed) return line
  // A description that was never checked ranks just as confidently as one
  // that was; the label is how a reader tells them apart.
  return `${line}\n      ${r.audited ? "[audited] " : "[unchecked] "}${r.observed}`
}

// ---------------------------------------------------------------- search ---
server.registerTool(
  "search_assets",
  {
    title: "Search game assets",
    description:
      "Find CC0 game sprites by description. Returns candidates as text; follow up with " +
      "contact_sheet to actually look at them before choosing. Searches filenames, " +
      "inferred roles, pack tags and written descriptions.",
    inputSchema: {
      query: z.string().describe('What you need, e.g. "side-view player walk cycle" or "seamless grass tile"'),
      role: z.enum(["character", "enemy", "tile", "background", "ui", "effect", "pickup", "weapon", "audio"]).optional(),
      pack: z.string().optional().describe("Restrict to one pack slug"),
      style: z.enum(["1-bit", "indexed", "pixel-art", "full-color"]).optional(),
      kind: z.enum(["image", "audio", "other"]).optional()
        .describe('Default "image". "other" = 3D models (.glb/.gltf/.fbx), fonts and data files; models and fonts show a preview on contact_sheet'),
      tileable: z.boolean().optional().describe("Only assets whose edges genuinely match"),
      described: z.boolean().optional().describe("true = only assets carrying a written description"),
      audited: z.boolean().optional().describe("true = only descriptions someone has checked against the pixels"),
      minSize: z.number().optional(),
      maxSize: z.number().optional(),
      limit: z.number().min(1).max(100).optional(),
    },
  },
  async (a) => {
    requireIndex()
    const db = openDb({ readonly: true })
    const { assets, total } = searchAssets(db, { ...a, q: a.query, limit: a.limit ?? 20 }, { total: true })
    db.close()
    if (!assets.length) {
      return { content: [{ type: "text", text: `No matches for "${a.query}". Try fewer filters or broader wording.` }] }
    }
    return {
      content: [{
        type: "text",
        text: `${assets.length} of ${total.toLocaleString()} matches:\n\n` +
              assets.map(fmt).join("\n") +
              `\n\nPass these ids to contact_sheet to see them.`,
      }],
    }
  },
)

// --------------------------------------------------------- contact sheet ---
server.registerTool(
  "contact_sheet",
  {
    title: "View assets as one image",
    description:
      "Composite up to 64 assets into a single labelled grid image and return it, so you can " +
      "see what they actually look like before committing. This is the step that makes the " +
      "index trustworthy: search narrows, looking decides. 3D models and fonts are drawn from " +
      "their preview (a render or a font specimen); the id still refers to the model or font file.",
    inputSchema: {
      ids: z.array(z.number()).min(1).max(64).describe("Asset ids from search_assets"),
      columns: z.number().min(1).max(12).optional(),
      cell: z.number().min(48).max(256).optional().describe("Pixel size per cell; larger reads better for tiny sprites"),
      label: z.enum(["id", "name"]).optional(),
    },
  },
  async ({ ids, columns, cell, label }) => {
    requireIndex()
    const out = path.join(os.tmpdir(), `kenney-sheet-${Date.now()}.png`)
    const r = await buildSheet({
      ids, out,
      cols: columns ?? Math.min(8, ids.length),
      cell: cell ?? 128,
      label: label ?? "id",
    })
    const data = fs.readFileSync(out).toString("base64")
    fs.rmSync(out, { force: true })
    return {
      content: [
        { type: "text", text: `${r.count} sprites, ${r.width}x${r.height}. Labels are asset ids.` },
        { type: "image", data, mimeType: "image/png" },
      ],
    }
  },
)

// ------------------------------------------------------------ one asset ---
server.registerTool(
  "get_asset",
  {
    title: "Full record for one asset",
    description: "Everything known about a single asset: measured properties, inferred role, " +
                 "description if any, and which model wrote it.",
    inputSchema: { id: z.number() },
  },
  async ({ id }) => {
    requireIndex()
    const db = openDb({ readonly: true })
    const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id)
    db.close()
    if (!row) return { content: [{ type: "text", text: `No asset with id ${id}.` }], isError: true }
    row.file = assetFile(row.pack, row.path)
    if (row.preview_path) row.preview_file = previewFile(row.preview_path)
    for (const k of ["keywords", "top_colors"]) {
      if (row[k]) { try { row[k] = JSON.parse(row[k]) } catch { /* leave as stored */ } }
    }
    return { content: [{ type: "text", text: JSON.stringify(row, null, 2) }] }
  },
)

// -------------------------------------------------------------- install ---
server.registerTool(
  "install_assets",
  {
    title: "Copy assets into a project",
    description:
      "Copy chosen assets to a directory, optionally with a typed manifest listing keys, " +
      "dimensions, roles, tileability and CC0 attribution. The only tool here that writes.",
    inputSchema: {
      ids: z.array(z.number()).min(1).describe("Asset ids to copy"),
      destination: z.string().describe("Directory to copy into; created if absent"),
      manifest: z.boolean().optional().describe("Also write assets.manifest.json"),
      flat: z.boolean().optional().describe("Flatten into one directory instead of mirroring pack paths"),
    },
  },
  async ({ ids, destination, manifest, flat }) => {
    requireIndex()
    const r = install({ ids, to: destination, manifest: !!manifest, flat: !!flat })
    return {
      content: [{
        type: "text",
        text: `Copied ${r.copied} files to ${r.dest}` +
              (r.missing ? ` (${r.missing} missing from the corpus)` : "") +
              (manifest ? `\nWrote ${r.dest}/assets.manifest.json` : "") +
              `\nAssets are CC0 from kenney.nl — a donation link belongs in what you ship.`,
      }],
    }
  },
)

// ---------------------------------------------------------------- packs ---
server.registerTool(
  "list_packs",
  {
    title: "List asset packs",
    description: "Every known pack with its category, tags, and whether it is downloaded and indexed.",
    inputSchema: {
      onDisk: z.boolean().optional().describe("Only packs already downloaded"),
      search: z.string().optional().describe("Filter by name, slug or tag"),
    },
  },
  async ({ onDisk, search }) => {
    let packs = catalogPacks().map((p) => ({ ...p, onDisk: isOnDisk(p.slug) }))
    if (onDisk) packs = packs.filter((p) => p.onDisk)
    if (search) {
      const q = search.toLowerCase()
      packs = packs.filter((p) =>
        p.slug.includes(q) || p.name.toLowerCase().includes(q) ||
        (p.tags ?? []).some((t) => t.includes(q)))
    }
    const lines = packs.map((p) =>
      `${p.onDisk ? "*" : " "} ${p.slug.padEnd(30)} ${String(p.category).padEnd(9)} ${(p.tags ?? []).slice(0, 4).join(", ")}`)
    return {
      content: [{
        type: "text",
        text: `${packs.length} packs ("*" = downloaded and searchable):\n\n${lines.join("\n")}`,
      }],
    }
  },
)

// ---------------------------------------------------------------- stats ---
server.registerTool(
  "index_stats",
  {
    title: "What the index actually contains",
    description: "Coverage per enrichment tier, so you know how much to trust a result before relying on it.",
    inputSchema: {},
  },
  async () => {
    requireIndex()
    const db = openDb({ readonly: true })
    const g = (q) => db.prepare(q).get().c
    const img = "kind='image' AND is_atlas=0"
    const text =
      `corpus            ${assetsRoot()}\n` +
      `packs on disk     ${g("SELECT count(*) c FROM packs WHERE installed=1")} of ${g("SELECT count(*) c FROM packs")}\n` +
      `assets            ${g("SELECT count(*) c FROM assets").toLocaleString()}\n` +
      `  images          ${g(`SELECT count(*) c FROM assets WHERE ${img}`).toLocaleString()}\n` +
      `  audio           ${g("SELECT count(*) c FROM assets WHERE kind='audio'").toLocaleString()}\n` +
      `measured props    ${g("SELECT count(*) c FROM assets WHERE unique_colors IS NOT NULL").toLocaleString()} (from pixels — trustworthy)\n` +
      `inferred roles    ${g("SELECT count(*) c FROM assets WHERE role IS NOT NULL").toLocaleString()} (from filenames — a heuristic)\n` +
      `written descrs    ${g("SELECT count(*) c FROM assets WHERE observed IS NOT NULL").toLocaleString()} (someone looked — the rest have none)\n` +
      `  audited         ${g("SELECT count(*) c FROM assets WHERE audited=1").toLocaleString()} (compared against the pixels afterwards; the rest are unchecked claims)\n`
    db.close()
    return { content: [{ type: "text", text }] }
  },
)

await server.connect(new StdioServerTransport())
