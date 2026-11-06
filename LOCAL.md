# Local corpus integration

This branch (`ayberk/local-integration`) runs the index over a local copy of the
Kenney corpus instead of downloading every pack from kenney.nl.

## Pieces

| Piece | Where | Role |
| --- | --- | --- |
| Corpus | `../KenneyAssets` (clone of `eturner58/game-assets`, Kenney All-in-1 v3.7.0) | The files: 2D, UI, icons, audio, 3D as GLB (FBX for the four character packs), sliced tiles |
| Slug map | `catalog/eturner58-map.json` (committed) | kenney.nl slug -> corpus folder, 256 entries |
| Extra packs | `catalog/extra-packs.json` (committed, hand-kept) | kenney.nl packs newer than the corpus and the scraped catalog |
| Local catalog | `catalog/catalog.local.json` (generated, ignored) | Scraped catalog + corpus vision tags + extra packs; what the index reads |
| Junctions | `assets/experimental/<slug>` (ignored) | Directory junctions into the corpus; nothing is copied |
| Incoming | `incoming/` (ignored) | Pack zips the user downloads by hand |

Set `KENNEY_ASSETS_DIR` if the corpus is not at `../KenneyAssets`.

## Setup from scratch

```bash
npm install
node bin/assets link                # junctions + catalog.local.json
node bin/assets build               # index (seconds)
node bin/assets analyze             # structural tier via sharp (minutes)
node bin/assets descriptions import # committed vision descriptions
node bin/assets audio               # audio facts via ffprobe/ffmpeg (~30 s)
node bin/assets sfx-tags            # vendored Open Game SFX Index tags
node bin/assets render-previews     # 3D renders + font specimens (~1.5 min)
node bin/assets eval                # recall@10
```

`tools/local/make-map.mjs [--site-map <json>]` regenerates the slug map after
the corpus gains packs. The site map used on 2026-11-06 lives outside this
repository, in Ayberk's Brain research notes.

## State on 2026-11-06

- **Indexed:** 77,910 files (63,930 images, 1,342 audio, the rest 3D models,
  fonts and data) from 256 linked packs.
- **Analysis:** all images have the structural tier; 6,690 assets carry
  descriptions (tiny-town's 132 tiles added by hand from contact sheets).
- **Audio:** all 1,342 sounds measured, 0 failures; 971 have integrated LUFS
  (the rest are under 0.4 s and keep peak/mean dB only). 744 carry Open Game
  SFX Index tags.
- **Catalogued but not local (7):** `mini-shop`,
  `scribble-platformer-expansion`, `skyboxes-space`, `tiny-city`,
  `tiny-factory`, `tower-defense-top-down`, `ui-pack-rpg-expansion`.
- **Recall@10 on `eval/queries.json`:** 68.8% lexical only, 68.1% with the
  structural tier, 78.9% with descriptions.
  - Two cases (`key item to unlock door`, `a fence around a farm`) list the
    tiny-town key and fence tiles as accepted answers. They match the
    filename globs' intent but not the globs, and without them the
    semantic tier reads 78.3%.
- **Previews:** all 5,282 3D model files (.glb/.gltf/.fbx/.obj) have one:
  3,836 from Kenney's own renders in the corpus, 1,446 rendered locally in
  79 s with no failures. All 56 fonts have a specimen; 34 are icon fonts
  (Input Prompts), 19 lack `ĞİŞğış` and 3 lack every Turkish letter.

## Missing packs

`assets missing [query]` lists catalogued packs with no local copy.

- `assets fetch <slug>` downloads one pack from kenney.nl, then extracts,
  builds and analyzes it.
- If that fails, the zip goes into `incoming/` by hand and
  `assets ingest [--pack <slug>]` does the same from there.
- A fetched or ingested pack is a real directory. It overrides the junction to
  the older corpus copy; `assets link` leaves it alone.
- `removePack` and re-linking only ever unlink junctions. They never delete
  corpus files.

## Changes from upstream

- `package.json`: removed a `file:` dependency on the author's local
  worktree (unused, broke `npm install`).
- `lib/fetch-pack.mjs`:
  - `extractZip` is shared by fetch and ingest.
  - The zip-slip check uses a path-separator boundary.
  - SVG, fonts and Tiled files are kept.
  - The User-Agent is honest.
  - Linked packs are unlinked, never deleted.
- `tools/index/build.mjs`: follows junctions when listing packs.
- `lib/search.mjs`: the FTS join is a `CROSS JOIN`.
  - With a plain `JOIN`, SQLite sometimes ran the asset table as the outer
    loop and re-ran `MATCH` per row: 122 s for one query over 77,910 rows.
  - Now 10-30 ms. The full 304-case eval runs in about 14 s.
- Corpus vision tags go into a pack's search text only when kenney.nl gave it
  none (bundle-only and sliced packs).
  - Merged into every pack, they measured 78.3% recall@10 against 78.9%
    without.
  - They are kept as `corpusTags`, `style` and `perspective` in
    `catalog.local.json`.
- `lib/config.mjs`: `catalog.local.json` is preferred when present; adds
  corpus and incoming paths.
- `bin/assets`: new commands `link`, `missing`, `fetch`, `ingest`.
- `descriptions/1-bit-platformer-pack.json`: the legacy `1-bit-platformer`
  descriptions under the current slug.
  - `platformer-art-pixel.json` does not match the corpus layout and is not
    imported.
- `skills/kenney-assets/`:
  - Rewritten for this setup: local plus missing search, the missing-pack
    order and credits.
  - References point at slugs that exist.
  - Reads the game's `assets.manifest.json` before choosing; documents audio
    facts and the describe-sheets workflow.
- Audio facts (`tools/index/audio.mjs`, `assets audio`):
  - New nullable `assets` columns: `duration_s`, `sample_rate`, `channels`,
    `loudness_lufs`, `peak_db`, `mean_db`, `audio_at`.
  - ffprobe plus one ffmpeg `volumedetect,ebur128` pass per file.
  - A failure stays NULL and is retried; it is never stored as zero.
  - `--min-duration` / `--max-duration` search filters. Durations show in
    search output.
- Open Game SFX Index (`tools/index/sfx-tags.mjs`, `assets sfx-tags`):
  - The Kenney part of upstream `index.json` (MIT, commit `34bbe8b`) is
    vendored in `vendor/open-game-sfx-index/` with its LICENSE.
  - `tools/local/vendor-sfx-index.mjs` regenerates it.
  - Stored in `sfx_tags` (JSON) and fed into the structural FTS tier.
  - Upstream tags are per pack, not per sound.
  - Upstream used older music-jingles numbering, so 60 files are re-paired by
    duration. 9 changed files get family-level tags only.
  - 32 digital-audio files are newer renders than upstream's (durations
    differ); they are kept by name.
- `assets describe-sheets <pack>` writes numbered contact sheets and a key to
  `index/describe/<pack>/` (ignored). `--apply` merges numbered descriptions
  into `descriptions/<pack>.json`.
- `descriptions import` skips entries with empty text.
- `lib/db.mjs`: a read-only open migrates an older index first, because
  queries name the added columns.
- Previews for non-image assets (`lib/previews.mjs`, `tools/render/`):
  - New nullable columns on `assets`, added by `migrate()`: `preview_path`
    (an image that shows the asset) and `glyphs_missing` (fonts: specimen
    characters without a glyph, `""` when none).
  - `preview_path` is `assets/experimental/<pack>/<path>` for a corpus image
    (resolved through `assetsRoot()`) or `assets/renders/...` for a generated
    one (this checkout first, then the main checkout).
  - Corpus previews: a same-name PNG in the pack (`Previews/`, `Isometric/`,
    `Sprites/Render/`; silhouettes last, `Textures/` never), else an angle
    render `<name>_SE.png` (then SW, NE, NW). `assets build` relinks them, and
    any existing renders, every time.
  - `assets render-previews [--packs a,b] [--force] [--only models|fonts]
    [--concurrency 4]`: renders only models without a preview and is
    resumable (existing PNGs are linked, not redrawn). Failures and texture
    load errors go to `assets/renders/failures.json`.
  - Models: Playwright 1.64.1 (Chromium 1248 from the local cache, SwiftShader
    WebGL) + three.js 0.186.1 GLTF/FBX/OBJ loaders. A loopback HTTP server
    serves the page, three.js and the corpus; every other request is blocked.
    Orthographic three-quarter view (azimuth 45, elevation 30), auto-framed,
    256x256 transparent PNG at `assets/renders/<pack>/<model path>.png`.
  - Animated-character FBX packs get a skin from the pack's `Skins/` folder
    (gender from the file name, `casual`/`human` first; animal parts take
    `Skins/Animals/`); other accessories keep their own colours. Animation
    files are drawn posed at 30% of their clip.
  - Fonts: opentype.js 2.0.0 glyph outlines to SVG, rasterised by sharp, at
    `assets/renders/fonts/<pack>/<font path>.png` (512x256). Missing glyphs are
    red boxes and listed. Icon fonts show their first 24 glyphs.
  - `assets sheet` and the MCP `contact_sheet` share `buildSheet`, which draws
    models and fonts from `preview_path`, rasterises SVGs, and labels cells
    with nothing to show. MCP `search_assets` gained `kind`; `show` and
    `get_asset` print `preview_file`; `stats` counts previews.
  - `assets/renders/` is gitignored.
