---
name: kenney-assets
description: Find, look at and install CC0 Kenney game assets from a local index of ~78,000 files (2D sprites, tiles, UI, icons, 3D models, sound effects, music, fonts) across 256 packs, plus pack-level knowledge of newer Kenney packs that are not on disk yet. Use when building or prototyping a game and you need real art or audio - characters, tiles, backgrounds, HUD and menu parts, pickups, effects, 3D kits, UI sounds, jingles - or when the user says "find me an asset" or "you pick the art". Also use before drawing procedural placeholder graphics, to check what already exists.
---

# Kenney asset library

A local index over Kenney's CC0 game assets. The files live in a local corpus
(`C:\Brain\workspace\KenneyAssets`, linked in as `assets/experimental/<slug>`);
the index knows every file's size, role, style and, for some packs, a written
description. Packs that are catalogued but not on disk are known at pack level
only: name, category, tags and kenney.nl links.

**Do not browse the corpus by hand.** Listing directories burns context and
filenames lie: a quarter of them (`tile_0147.png`) say nothing. Query the index.

## Command

Run from any directory:

```bash
node C:/Brain/workspace/KenneyAssetIntelligence/bin/assets <command> ...
```

Below, `assets` stands for that command.

## The loop

1. **Search the local files** for what the game needs:

   ```bash
   assets search "side-view player walk cycle" --role character --limit 20
   assets search "button click" --kind audio
   assets search "car glb" --kind other          # 3D models, fonts
   ```

2. **Search the missing packs too, every time**, with the same words:

   ```bash
   assets missing "side-view player walk cycle"
   ```

   This lists catalogued packs that are not on disk, with their kenney.nl page,
   preview image and download link. It costs almost nothing.

3. **Look before you choose.** Composite the local candidates into one image,
   then read that image:

   ```bash
   assets sheet 1011 1012 1013 1014 --out <tmp>/candidates.png
   ```

   For a missing pack, look at its preview image before choosing it. If you
   cannot open the preview, judge it by name and tags.

4. **Decide** between local and missing:

   - **The local result is good enough:** use it.
   - **A missing pack is clearly better:** get it.
     1. Download it from kenney.nl: `assets fetch <slug>`. This downloads,
        extracts, indexes and analyzes the pack.
     2. If the download fails or anything goes wrong, ask the user for it.
        Give the pack name and page link, and ask them to drop the zip into
        `C:/Brain/workspace/KenneyAssetIntelligence/incoming/`.
     3. When the zip is there, run `assets ingest`, then search again.
   - **A missing pack looks about as good, or "not bad":** use the local result.
     Tell the user the missing pack exists, with its link, and that it may be
     worth a look.
   - **No missing pack fits:** do not mention missing packs.

5. **Install** what you chose into the game:

   ```bash
   assets install 1011 1012 1013 --to <game>/assets/kenney --manifest
   ```

   This copies the files and writes `assets.manifest.json` (keys, sizes,
   roles, tileability, licence). Never edit files under `assets/experimental/`:
   they are the shared corpus.

## When the user says "you pick"

Choose from the game's genre, camera and existing art. Keep one look:

- Stay inside one pack or series where you can. Mixing packs mixes outline
  weight, palette and tile size.
- Check pack `style` and `perspective` (side-view, top-down, isometric) and the
  pixel size against what the game already uses.

Say which pack you picked and why, in one line.

## Filters

`--role` character | enemy | tile | background | ui | effect | pickup | weapon | audio
`--pack <slug>` · `--style` 1-bit | indexed | pixel-art | full-color
`--tileable` (edges actually match) · `--min-size` / `--max-size` px
`--described` / `--undescribed` · `--kind` image | audio | other
`--limit` (default 20) · `--json` · `--atlas` (include sprite sheets)

Other commands: `assets show <id>` (full record), `assets stats` (what is
indexed), `assets link` (re-link the corpus after it changes, then
`assets build && assets analyze`).

## What to trust

- **Measured from the pixels, reliable:** `width`/`height`, `style`,
  `tileable` and colours.
- **Inferred from file and folder names, not authoritative:** `role` and
  `keywords`.
- **Written descriptions:** about 6,500 assets have one. Where none exists,
  look at a sheet.
- **Pack tags and summaries for local packs:** from a vision pass over each
  pack's preview image.

Never state that a sprite faces a direction, has a colour or shows an action
unless a description says so or you saw it on a sheet.

## Licence and credits

All Kenney game assets are CC0: free for commercial use, attribution optional.

- Add `Art by Kenney (www.kenney.nl), CC0` to the game's credits anyway, plus
  any co-author named in the pack's `License.txt`.
- Flag these to the user before shipping:
  - Input Prompts packs: console glyphs are third-party trademarks.
  - Kenney Fonts: the TTF metadata says CC BY-SA 3.0, which contradicts its
    CC0 licence.
  - `Preview.png` files: they carry the Kenney logo, so do not use them as
    game art.

More: `references/query-cookbook.md` for query patterns, `references/slots.md`
for mapping game roles to searches.
