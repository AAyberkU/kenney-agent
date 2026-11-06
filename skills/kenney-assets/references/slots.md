# Game roles to searches

A starting map from what a game needs to what to type. These are starting
points, not answers — confirm on a contact sheet.

| Need | Query |
|------|-------|
| Player idle | `assets search "character idle stand" --role character` |
| Player walk cycle | `assets search "character walk" --role character` |
| Player jump | `assets search "character jump" --role character` |
| Ground tile | `assets search "terrain ground" --role tile --tileable` |
| Platform | `assets search "platform block" --role tile` |
| Slope | `assets search "diagonal slope ramp" --role tile` |
| Ladder | `assets search "ladder climb" ` |
| Hazard | `assets search "spikes lava saw"` |
| Background | `assets search "sky clouds hills" --role background` |
| Coin / pickup | `assets search "coin gem star" --role pickup` |
| Health | `assets search "heart health"` |
| Key / door | `assets search "key door lock"` |
| Enemy | `assets search "slime enemy" --role enemy` |
| Explosion | `assets search "explosion" --role effect` |
| Button | `assets search "button" --role ui` |
| Panel | `assets search "panel window" --role ui` |
| Health bar | `assets search "bar health progress" --role ui` |
| Cursor | `assets search "cursor crosshair" --role ui` |
| Key prompt | `assets search "keyboard gamepad prompt" --pack input-prompts` |

## Packs worth knowing

| Pack | Why |
|------|-----|
| `new-platformer-pack` | Most complete 2D platformer set; characters, tiles, backgrounds, all described |
| `abstract-platformer` | Clean flat shapes, full character animation sets |
| `1-bit-platformer-pack` | Monochrome, opaque filenames — sheet it and look |
| `pixel-platformer` | Small-tile pixel art |
| `input-prompts` | 3,056 controller/key glyphs, fully described |
| `ui-pack`, `ui-pack-sci-fi`, `ui-pack-adventure`, `ui-pack-pixel-adventure` | HUD and menu furniture |
| `crosshair-pack` | 1,205 reticles |

`assets stats` lists what is actually on disk.
