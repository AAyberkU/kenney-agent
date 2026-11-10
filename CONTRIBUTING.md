# Contributing

Thanks for helping. Issues and PRs are welcome.

## Adding Kenney packs

Pack files live in the corpus repository,
[AAyberkU/game-assets](https://github.com/AAyberkU/game-assets), not here.
Send the PR there; its CONTRIBUTING.md says where the folder goes. Nothing in
this repository needs to change: `assets setup --update` detects the new
folder, links it and indexes it. The packs most worth adding are listed under
"Missing packs" in the [README](README.md).

## macOS and Linux

Development and testing happened on Windows. If setup or a command fails on
your platform, an issue with the full output helps; a PR that fixes it helps
more.

## Code changes

- Read [AGENTS.md](AGENTS.md) and [docs/CORPUS.md](docs/CORPUS.md) first.
- Keep machine-specific paths out of the repository.
- Before sending a PR that touches indexing or search, run:

  ```bash
  node bin/assets build
  node bin/assets eval        # recall@10 should not drop
  npx tsc --noEmit
  ```

  and say the eval numbers before and after in the PR.

## Descriptions

Written descriptions (`descriptions/<pack>.json`) are the one part of the
index that cannot be regenerated, and the biggest search win for packs with
opaque file names. `assets describe-sheets <pack> --undescribed` makes
numbered sheets to describe; see the "Describing a pack" section of the skill.
Describe only what is visible, and add the words someone would search for.
