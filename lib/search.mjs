/**
 * The one asset query.
 *
 * This existed three times -- in bin/assets, in the dev-server API, and in the
 * eval harness -- and the copies had drifted: the CLI grew --max-size, the web
 * API grew minSize, and the eval had neither plus a hardcoded kind. Which meant
 * the number the eval reported was measured against a query nobody actually
 * ran. One implementation, so a filter added here reaches every surface and the
 * measurement matches the product.
 */

// Words that carry no signal about an asset and match nearly every row.
// Kept short and conservative: "player" and "up" are real filename tokens
// (playerBlue, jump_up) and stay in.
const STOP = new Set(["a", "an", "the", "of", "for", "to", "that", "this", "with",
  "on", "in", "and", "or", "it", "is", "be", "at", "by", "from", "as", "into",
  "something", "someone", "would", "want", "can", "when", "what", "like", "looks",
  "get", "some", "any", "one", "way", "make", "makes", "show", "shows", "how"])

// Compass phrases collapse to the letters filenames use: "north west" -> nw.
const PHRASE = [[/\bnorth\s*west\b/g, "nw"], [/\bnorth\s*east\b/g, "ne"],
                [/\bsouth\s*west\b/g, "sw"], [/\bsouth\s*east\b/g, "se"]]

export function queryTerms(raw) {
  let text = (raw ?? "").toLowerCase()
  for (const [re, to] of PHRASE) text = text.replace(re, to)
  const all = text.match(/[a-z0-9]+/g) ?? []
  const kept = all.filter((t) => !STOP.has(t))
  // If stopwords ate everything ("a way to get to it"), fall back to all terms
  // rather than matching nothing.
  return kept.length ? kept : all
}

/**
 * FTS5 MATCH is a query language, so user text must never reach it raw.
 *
 * Two forms. AND requires every term -- the document that matches all of
 * "stone ledge right" should outrank the thousands that match only "right".
 * OR is the recall fallback, used only to fill the page when AND finds too
 * few. Under pure OR, common terms drowned specific files; measured on the
 * 304-case suite, that was the single largest source of misses.
 */
// Vocabulary gaps measured on the suite: users say "hurt", files say "hit";
// "three" against "players_3". Kept tiny and symmetrical. Stemming was tried
// here too ("wooden" -> "wood") and measured 3.3 points *worse*: short stems
// prefix-match far more noise than they recover.
const SYNONYM = { hurt: ["hit"], hit: ["hurt"], three: ["3"], two: ["2"],
                  dead: ["death", "die"], death: ["dead"], centre: ["center"], center: ["centre"],
                  grey: ["gray"], gray: ["grey"],
                  // each pair below is the word a query used vs. the word the
                  // file on disk uses (fence_woodCorner, bar_round_gloss,
                  // slide_horizontal, zoom.png, arrow_nw)
                  wooden: ["wood"], glossy: ["gloss"], slider: ["slide"],
                  magnifying: ["zoom", "magnifier"], magnifier: ["zoom"] }



export function ftsQuery(raw, mode = "or") {
  const terms = queryTerms(raw)
  if (!terms.length) return null
  const alt = (t) => {
    const vs = [t, ...(SYNONYM[t] ?? [])].map((v) => `"${v}"*`)
    return vs.length === 1 ? vs[0] : "(" + vs.join(" OR ") + ")"
  }
  return terms.map(alt).join(mode === "and" ? " AND " : " OR ")
}

const COLUMNS = `a.id, a.pack, a.path, a.width, a.height, a.role, a.style,
                 a.anim_frame, a.tile_score, a.observed, a.top_colors, a.audited`

/** Build the FROM/WHERE/ORDER shared by counting and fetching. */
function compile(opts, mode = "or") {
  const where = []
  const params = []
  let from = "assets a"
  // Pack overview renders (Preview.png, Sample.png) match many terms and
  // answer none of them; they sort after everything else.
  let order = "a.pack, a.path"

  const match = ftsQuery(opts.q, mode)
  if (match) {
    // CROSS JOIN pins the FTS table as the outer loop. With a plain JOIN the
    // planner can pick assets as the outer loop and re-run MATCH once per row:
    // measured 122 s for one four-term query over 77,910 rows, against
    // milliseconds this way.
    from = "assets_fts f CROSS JOIN assets a ON a.id = f.rowid"
    where.push("assets_fts MATCH ?")
    params.push(match)
    order = "bm25(assets_fts)"
  }

  if (opts.pack) { where.push("a.pack = ?"); params.push(opts.pack) }
  if (opts.role) { where.push("a.role = ?"); params.push(opts.role) }
  if (opts.style) { where.push("a.style = ?"); params.push(opts.style) }
  if (opts.kind !== null) { where.push("a.kind = ?"); params.push(opts.kind ?? "image") }
  if (opts.tileable) where.push("a.tile_score >= 0.7")
  if (opts.described === true) where.push("a.observed IS NOT NULL")
  if (opts.described === false) where.push("a.observed IS NULL")
  if (opts.audited) where.push("a.audited = 1")
  if (!opts.atlas) where.push("a.is_atlas = 0")
  if (opts.minSize) { where.push("a.width >= ? AND a.height >= ?"); params.push(+opts.minSize, +opts.minSize) }
  if (opts.maxSize) { where.push("a.width <= ? AND a.height <= ?"); params.push(+opts.maxSize, +opts.maxSize) }

  return { from, clause: where.length ? "WHERE " + where.join(" AND ") : "", params, order }
}

/**
 * @param db      open database
 * @param opts    q, pack, role, style, kind (null = any), tileable, described
 *                (true/false/undefined), atlas, minSize, maxSize, limit, offset
 * @param total   also count every match, not just this page
 */
export function searchAssets(db, opts = {}, { total = false } = {}) {
  const limit = Math.max(1, Math.min(500, +(opts.limit ?? 20)))
  const offset = Math.max(0, +(opts.offset ?? 0))
  const hasQuery = queryTerms(opts.q).length > 0

  const page = (mode, lim, off) => {
    const { from, clause, params, order } = compile(opts, mode)
    return db.prepare(
      `SELECT ${COLUMNS} FROM ${from} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`
    ).all(...params, lim, off)
  }

  let assets
  if (!hasQuery) {
    assets = page("or", limit, offset)
  } else {
    // Everything that matches every term comes first, then OR fills the rest
    // of the page. Paging is over this combined order.
    const strict = page("and", limit + offset, 0)
    if (strict.length >= limit + offset) {
      assets = strict.slice(offset, offset + limit)
    } else {
      const seen = new Set(strict.map((r) => r.id))
      const loose = page("or", limit + offset + strict.length, 0).filter((r) => !seen.has(r.id))
      assets = strict.concat(loose).slice(offset, offset + limit)
    }
  }

  if (!total) return { assets }
  // Total is the OR count: the size of everything the query touches.
  const { from, clause, params } = compile(opts, "or")
  return {
    assets,
    total: db.prepare(`SELECT count(*) c FROM ${from} ${clause}`).get(...params).c,
  }
}
