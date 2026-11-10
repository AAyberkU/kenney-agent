# kenney-agent

Give your coding agent all of [Kenney](https://kenney.nl)'s free game assets,
searchable. About 78,000 files (2D sprites, tiles, UI, icons, 3D models,
sound effects, music, fonts) across 256 packs, indexed so an agent can go from
"I need a side-view player walk cycle" to files in your game in three
commands, looking at the candidates before it picks.

> Unofficial. This project is not made or endorsed by Kenney. All the assets
> are Kenney's work, released as CC0. If they help you,
> [support Kenney](https://kenney.nl/donate).

## Install

Tell your agent:

```text
Install https://github.com/AAyberkU/kenney-agent
```

It reads [INSTALL.md](INSTALL.md) and does the rest. By hand:

```bash
git clone https://github.com/AAyberkU/kenney-agent
cd kenney-agent
npm install
node bin/assets setup
```

`setup` clones the asset corpus (78,000 files, about 1 GB), downloads the prebuilt
index from the latest release (about 20 MB), links everything, and installs
the `kenney-assets` skill into `~/.claude/skills`. For another agent, pass the
folder it loads skills from: `node bin/assets setup --skill-dir <folder>`.
Start a new agent session afterwards so the skill loads.

**Needs:** Node.js 22.13 or newer, git, about 1.2 GB of disk. Setup takes
about 4 minutes, mostly cloning the corpus.
**Optional:** ffmpeg (audio facts for packs you add yourself), Playwright
Chromium (3D previews for packs you add yourself). The release index already
has both for every pack in the corpus.

## What your agent does with it

The skill teaches this loop:

```bash
assets search "side-view player walk cycle" --role character   # shortlist
assets missing "side-view player walk cycle"                   # newer packs not on disk
assets sheet 1011 1012 1013 1014 --out candidates.png          # look at them
assets install 1011 1012 1013 --to ./assets/kenney --manifest  # copy into the game
```

- **Search** runs over a SQLite full-text index in 10-30 ms. Filters: role
  (character, tile, ui, pickup...), style (pixel-art, 1-bit...), size,
  tileable edges, audio duration, 3D models and fonts.
- **Contact sheets** put candidates in one numbered image, so the agent picks
  by looking instead of trusting file names. A quarter of Kenney's file names
  (`tile_0147.png`) say nothing. 3D models show a render, fonts a specimen.
- **Install** copies the files with everything they reference (glTF buffers,
  textures, `.mtl` files) and writes `assets.manifest.json`, so later picks
  keep the same look.
- **Missing packs** that are newer than the corpus are known by name, tags and
  link. The agent downloads one from kenney.nl when it is clearly better; if
  that fails, it asks you to download the zip and drops it in `incoming/`.

## What is indexed

| | |
| --- | --- |
| Files | 77,910 in 256 packs (Kenney All-in-1 v3.7.0 content) |
| Images | 63,930, measured from the pixels: size, colours, style, tileability, alpha |
| Audio | 1,342 sounds with duration, sample rate, channels, loudness; 744 with tags |
| 3D models | 5,282, every one with a preview picture |
| Fonts | 56, each with a specimen that marks missing glyphs |
| Descriptions | 6,690 assets with a written description of what they show |
| Search quality | 78.9% recall@10 on a 304-query evaluation (`assets eval`) |

## Missing packs

These Kenney packs are not in the corpus yet. The agent still knows them and
can download them on demand, but having them in the corpus is better for
everyone:

- [Tiny City](https://kenney.nl/assets/tiny-city)
- [Mini Shop](https://kenney.nl/assets/mini-shop) (the corpus has the older Mini Market)
- [Tiny Factory](https://kenney.nl/assets/tiny-factory)
- [Scribble Platformer Expansion](https://kenney.nl/assets/scribble-platformer-expansion)
- [Skyboxes Space](https://kenney.nl/assets/skyboxes-space)
- [Tower Defense (Top-Down)](https://kenney.nl/assets/tower-defense-top-down)
- [UI Pack: RPG Expansion](https://kenney.nl/assets/ui-pack-rpg-expansion)

Mini Skate, City Kit Industrial and City Kit Roads also had updates that the
corpus does not have. **PRs welcome** at
[AAyberkU/game-assets](https://github.com/AAyberkU/game-assets): see its
CONTRIBUTING.md. No change is needed here: `assets setup --update` picks up
new pack folders by themselves.

## Platforms

Built and tested on Windows. macOS and Linux should work (packs are linked
with symlinks instead of junctions there) but have not been tested yet.
Reports and PRs are welcome.

## Updating

```bash
git pull
node bin/assets setup --update
```

This pulls new packs into the corpus, indexes them, and rewrites the skill.

## Other ways in

- **MCP:** `mcp/server.mjs` exposes search, contact sheets, install and stats
  over the Model Context Protocol (`.mcp.json` registers it for this folder).
  It comes from upstream and has not been tested in this distribution.
- **Web app:** `npm run dev` opens a browser over the same index.
- **All commands:** `node bin/assets --help`.

## How it is built

[docs/CORPUS.md](docs/CORPUS.md) covers the corpus, the pack map, missing
packs, building the index yourself, and every change made to upstream.
[eval/README.md](eval/README.md) covers how search quality is measured.

## Credits

- **[Kenney](https://kenney.nl):** every asset. CC0. Please
  [donate](https://kenney.nl/donate).
- **[kenney-asset-intelligence](https://github.com/skinnerboxentertainment/kenney-asset-intelligence)**
  by Donchitos (MIT): the index, search, contact sheets, install, eval, MCP
  server and web app this project is built on.
- **[eturner58/game-assets](https://github.com/eturner58/game-assets):** the
  collected corpus, its pack catalogue and sliced tile sheets. Forked at
  [AAyberkU/game-assets](https://github.com/AAyberkU/game-assets) and cloned
  by setup; this repository does not copy its catalogue.
- **[Open Game SFX Index](https://github.com/Mcamento8/open-game-sfx-index)**
  (MIT): sound tags, vendored in `vendor/open-game-sfx-index/`.

## License

Code: MIT, see [LICENSE](LICENSE). Assets: CC0, by Kenney.

Contact: Ahmet Ayberk Uzun ([AAyberkU](https://github.com/AAyberkU)),
aayberkuzun@gmail.com. Issues and PRs are the best way to reach me about the
project.
