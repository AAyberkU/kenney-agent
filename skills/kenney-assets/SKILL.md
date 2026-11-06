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

0. **For an existing game, read its `assets.manifest.json` first** (written
   by `assets install`). It lists the packs, sizes and styles the game already
   uses; choose new assets that keep that look.

1. **Search the local files** for what the game needs:

   ```bash
   assets search "side-view player walk cycle" --role character --limit 20
   assets search "button click" --kind audio --max-duration 0.5
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

   3D models and fonts show on sheets too: a model is drawn from Kenney's own
   preview render or a local three.js render, a font as a specimen that marks
   missing glyphs (most Kenney fonts lack `Ğ İ Ş ğ ı ş`). The id still means
   the model or font file, so `install` copies that file, not the picture.
   `assets show <id>` gives `preview_path`, and for fonts `glyphs_missing`.

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
`--min-duration` / `--max-duration` seconds (audio)
`--limit` (default 20) · `--json` · `--atlas` (include sprite sheets)

Other commands: `assets show <id>` (full record), `assets stats` (what is
indexed), `assets render-previews` (render previews for new models and fonts
after a pack is added), `assets link` (re-link the corpus after it changes, then
`assets build && assets analyze`).

## Audio

Every sound has measured facts: `duration_s`, `sample_rate`, `channels`,
`peak_db` and `mean_db` (dBFS), and `loudness_lufs` (EBU R128 integrated;
empty for clips under 0.4 s, which are too short to measure that way).
Search results show the duration; `assets show <id>` shows the rest.
Match loudness across a game's sounds: prefer clips with similar mean or LUFS
levels, or note which ones need gain.

About 740 Kenney sounds also carry `sfx_tags` (category, use cases, mood) from
the Open Game SFX Index. They are set per pack, not per sound: good for
finding the right pack ("win jingle" -> music-jingles), not for telling two
sounds in a pack apart. Listen before choosing.

## Describing a pack with opaque names

When a pack's file names say nothing (`tile_0047.png`) and it has no
descriptions, describe it once so search can find its parts:

1. `assets describe-sheets <pack> --undescribed` writes numbered sheets and
   `key.json` (number -> path) to `index/describe/<pack>/`. Use `--trim` for
   3D renders.
2. Read every sheet. Write `{"<n>": "<description>", ...}` to a file, one
   entry per number. Keep each short and factual: what is visibly there,
   then `Used as:` search words (`"Red tiled roof, top-left corner. Used as:
   red roof, roof, house."`). Never claim a facing, colour or action you did
   not see. Also read the pack's `Sample.png` to see how parts fit together.
3. `assets describe-sheets <pack> --apply <file>` merges them into
   `descriptions/<pack>.json` (model `claude-code-subagent`; add
   `--style pixel-art` where it fits).
4. `assets descriptions import --packs <pack>`, then search to check.

## What to trust

- **Measured from the pixels, reliable:** `width`/`height`, `style`,
  `tileable` and colours.
- **Measured from the audio, reliable:** duration, sample rate, channels and
  levels.
- **Inferred from file and folder names, not authoritative:** `role` and
  `keywords`.
- **Written descriptions:** about 6,700 assets have one. Where none exists,
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
