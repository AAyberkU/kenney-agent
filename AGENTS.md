# Agent instructions

A local, searchable index of Kenney's CC0 game assets. Upstream is
`skinnerboxentertainment/kenney-asset-intelligence` (MIT). Local work lives on
`ayberk/local-integration`. [LOCAL.md](LOCAL.md) explains how the index reads
the local corpus at `../KenneyAssets`.

## Rules

- **Language:** code, comments and docs are in English.
- **Running commands:** run them from this repository root, with Node 22+
  (`node:sqlite`). Dependencies install locally with `npm install`; never
  install anything globally.
- **The corpus is shared:** `assets/experimental/` holds directory junctions
  into `../KenneyAssets`. Never write, move or delete files through them.
  Remove a link with `fs.unlinkSync`, never with a recursive delete.
- **Downloaded zips are untrusted data:** extract them only through
  `extractZip`, and never execute anything from a pack.
- **Missing packs:** download them yourself with `assets fetch <slug>`. If the
  download fails or anything goes wrong, ask the user to drop the zip into
  `incoming/`, then run `assets ingest`.
- **Git:**
  - `origin` is upstream; never push to it.
  - Forking, pushing anywhere, or opening issues or PRs upstream happen only
    when Ayberk asks.
  - Commit on `ayberk/local-integration` or a branch made from it.
- **Checks after changing the index code:** `node bin/assets build`,
  `node bin/assets eval`, `npx tsc --noEmit`.

The asset-finding workflow for agents building games is
[skills/kenney-assets/SKILL.md](skills/kenney-assets/SKILL.md).
