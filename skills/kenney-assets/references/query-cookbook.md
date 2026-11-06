# Query patterns

## Start broad, filter down

`--role` is the strongest filter and costs nothing:

```bash
assets search "walk" --role character --limit 30
assets search "ground" --role tile --tileable
```

## Animation frames

Frames are separate files sharing a stem. Find one, then search its stem:

```bash
assets search "character walk" --role character
assets search "character_beige" --pack new-platformer-pack --limit 20
```

Sort by `path` mentally — `_a`, `_b`, `_1`, `_2` are frame order.

## Tiles that actually tile

`--tileable` means opposite edges match on real pixels. It is not a naming
guess, and transparent borders do not count as a match:

```bash
assets search "grass terrain" --role tile --tileable --limit 20
```

## Matching an art style across a project

Pick one pack and stay in it — mixing packs mixes outline weight and palette:

```bash
assets search "character" --pack new-platformer-pack
assets search "terrain"   --pack new-platformer-pack
```

Or pin the style across packs:

```bash
assets search "player" --style pixel-art
assets search "tile"   --style 1-bit
```

## When the filename says nothing

Packs like `1-bit-platformer-pack` and `pico-8-platformer` name files
`tile_0000.png`. Filter to the pack, sheet a range, and look:

```bash
assets search "tile" --pack 1-bit-platformer-pack --limit 64 --json
assets sheet <ids> --out /tmp/tiles.png --cols 8 --label name
```

## Size constraints

```bash
assets search "icon" --role ui --max-size 64
assets search "background" --role background --min-size 512
```

## Machine-readable

`--json` emits full rows for scripting:

```bash
assets search "coin" --json | jq '.[].id'
```
