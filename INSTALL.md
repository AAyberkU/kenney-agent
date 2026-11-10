# Installing kenney-agent (instructions for coding agents)

You are installing a local, searchable library of Kenney's CC0 game assets
and a skill that teaches you to use it. Follow these steps in order. Run every
command yourself; ask the user only where a step says so.

## 1. Check the requirements

```bash
node --version   # must be v22.13.0 or newer (the index uses node:sqlite)
git --version
```

If Node is older or missing, stop and tell the user to install Node.js 22.13+
(https://nodejs.org). Setup needs about 1.2 GB of free disk.

## 2. Pick a folder

Install outside any game project, so the 1 GB corpus never ends up in a game's
repository. Use `~/kenney-agent` unless the user named another place. If that
folder already exists and holds a kenney-agent checkout, skip to step 4 and
run the update instead.

## 3. Clone and install dependencies

```bash
git clone https://github.com/AAyberkU/kenney-agent ~/kenney-agent
cd ~/kenney-agent
npm install
```

Warnings about install scripts not being approved (esbuild) are fine: only
the optional web app uses it. If `npm install` fails, show the user the error.

## 4. Run setup

Setup clones the asset corpus (the slow part: about 700 MB), downloads the
prebuilt index, links the packs, and installs the skill. It is safe to re-run.

- **Claude Code:** the default installs the skill into `~/.claude/skills`.

  ```bash
  node bin/assets setup
  ```

- **Any other agent:** pass the folder your agent loads skills (folders with a
  `SKILL.md`) from. Repeat `--skill-dir` to install into several.

  ```bash
  node bin/assets setup --skill-dir <your agent's skills folder>
  ```

  If your agent has no skills folder, run `node bin/assets setup --no-skill`
  and tell the user to add the contents of
  `skills/kenney-assets/SKILL.md` (with `{{KENNEY_AGENT}}` replaced by this
  folder's absolute path) to the agent's instructions.

Updating an existing install: `git pull` in the folder, then
`node bin/assets setup --update`.

Setup prints `[1/5]` to `[5/5]` and ends with `Ready: <n> assets indexed.`

## 5. Check it works

```bash
node bin/assets stats
node bin/assets search "red roof house" --limit 5
```

`stats` should report about 77,900 assets in 256 packs, and the search should
list Tiny Town tiles.

## 6. Tell the user

Say, in a few lines: where it is installed, how many assets are indexed, and
that they need to **start a new agent session** for the `kenney-assets` skill
to load. After that, asking for game art or sounds ("find me a coin pickup
sound", "you pick the tiles") uses the library.

## If something fails

- **Clone fails on Windows with "Filename too long":** run
  `git config --global core.longpaths true` (ask the user first, since it is a
  global setting), delete the half-cloned `corpus` folder, and run setup again.
- **The index download fails:** setup builds the index locally instead. That
  takes several minutes and needs no extra tools; audio facts additionally
  need ffmpeg, and 3D previews need `npx playwright install chromium` then
  `node bin/assets render-previews`.
- **`<path> exists and was not written by kenney-agent`:** a different skill
  named `kenney-assets` is already installed. Ask the user before passing
  `--force`, which replaces it.
- Anything else: show the user the full error and the command that failed.
