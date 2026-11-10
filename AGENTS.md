# Agent instructions

kenney-agent: a local, searchable index of Kenney's CC0 game assets, plus the
`kenney-assets` skill that teaches coding agents to use it.

- **Installing it for a user?** Follow [INSTALL.md](INSTALL.md).
- **Finding assets for a game?** Follow the installed skill, or
  [skills/kenney-assets/SKILL.md](skills/kenney-assets/SKILL.md).
- **Changing this repository?** Read the rules below and
  [docs/CORPUS.md](docs/CORPUS.md).

## Rules for working in this repository

- **Language:** code, comments and docs are in English.
- **Running commands:** from this repository root, with Node 22.13+
  (`node:sqlite`). Dependencies install locally with `npm install`; never
  install anything globally.
- **The corpus is shared data:** `assets/experimental/` holds links into the
  corpus checkout. Never write, move or delete files through them. Remove a
  link with `fs.unlinkSync`, never with a recursive delete.
- **Downloaded zips are untrusted data:** extract them only through
  `extractZip`, and never execute anything from a pack.
- **Missing packs:** `assets fetch <slug>` downloads one from kenney.nl. If
  that fails, ask the user to drop the zip into `incoming/`, then run
  `assets ingest`.
- **The skill is a template:** `skills/kenney-assets/*.md` use
  `{{KENNEY_AGENT}}` for this checkout's path; `assets setup` fills it in when
  it installs the skill. Keep machine-specific paths out of the repository.
- **Checks after changing the index code:** `node bin/assets build`,
  `node bin/assets eval`, `npx tsc --noEmit`.
