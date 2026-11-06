import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { ROOT, dbPath } from "./config.mjs"

/**
 * node:sqlite is bundled with Node 22+ and ships FTS5, so the index needs no
 * native dependency and no build step on Windows. Verified: SQLite 3.50.2 on
 * Node 22.18 with FTS5 available.
 */
export function openDb({ create = false, readonly = false } = {}) {
  const file = dbPath()
  if (!fs.existsSync(file)) {
    if (!create) {
      throw new Error(`No index at ${file}\nRun: assets build`)
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  const db = new DatabaseSync(file, { readOnly: readonly && fs.existsSync(file) })
  if (create) applySchema(db)
  else if (!readonly) migrate(db)
  return db
}

export function applySchema(db) {
  db.exec(fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf-8"))
  migrate(db)
}

/**
 * CREATE TABLE IF NOT EXISTS never adds a column to an existing table, so
 * columns introduced after the first build are added here. Each entry is
 * idempotent: skipped when the column already exists.
 */
const ADDED_COLUMNS = [
  ["assets", "audited", "INTEGER NOT NULL DEFAULT 0"],
  ["assets", "audited_at", "TEXT"],
  // An image that shows a non-image asset (3D model render, font specimen);
  // see lib/previews.mjs for the stored path forms.
  ["assets", "preview_path", "TEXT"],
  // Fonts only: specimen characters the font has no glyph for, as one string
  // ("" = all present, NULL = not checked).
  ["assets", "glyphs_missing", "TEXT"],
]
export function migrate(db) {
  for (const [table, col, type] of ADDED_COLUMNS) {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)
    if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
  }
}

export function setMeta(db, key, value) {
  db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, String(value))
}

export function getMeta(db, key) {
  return db.prepare("SELECT value FROM meta WHERE key=?").get(key)?.value ?? null
}

/** Guard against a silently-missing FTS5 build. */
export function assertFts5(db) {
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x)")
    db.exec("DROP TABLE IF EXISTS _fts_probe")
  } catch (err) {
    throw new Error(`This Node build has no SQLite FTS5 support: ${err.message}`)
  }
}
