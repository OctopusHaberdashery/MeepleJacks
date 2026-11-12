# MeepleJacks

**[⬇ Download the latest APK](https://github.com/OctopusHaberdashery/MeepleJacks/releases/latest/download/MeepleJacks.apk)** · [All releases](https://github.com/OctopusHaberdashery/MeepleJacks/releases)

<img src="icon-512.png" width="128" alt="MeepleJacks icon">

A cozy pixel-art logging camp for Android tablets, in the spirit of
[Meeple Meadows](https://github.com/OctopusHaberdashery/meeple-meadows).

![The Lumber Yard, two cabins and their crew](screenshot.png)

You start with a rusty hatchet and a Lumber Yard in the middle of a big forest.

- **Chop your own tree.** Tap a pine and your Meeple walks over, fells it and carries the logs to the yard.
- **Sell the wood**, but keep some back: the first Lumberjack Cabin costs coins *and* logs.
- **Hire a crew.** Lumberjacks cut every tree they can within reach of their cabin; haulers carry the log piles in.
- **Push outward.** The forest grows in rings around the yard. Each ring is tougher to cut, needs a better axe,
  and sells for more:

  | Tree | From the yard | Chops (matching axe) | Coins a log |
  |---|---|---|---|
  | Pine | all around it | 4 | 2 |
  | Birch | ~21 tiles | 5 | 5 |
  | Oak | ~35 tiles | 6 | 12 |
  | Maple | ~49 tiles | 7 | 28 |
  | Cherry | ~62 tiles | 8 | 65 |
  | Redwood | ~74 tiles | 9 | 150 |
  | Ebony | ~85 tiles | 11 | 340 |

- Stumps grow back into trees after a few minutes.
- A Workshop for axes (yours and the crew's), boots, slings and hauling sleds.
- A goal list that walks you through the early game, a map of the whole 192 × 192 forest, three save slots,
  generated music, forest ambience and sound effects, and a settings menu.

The camp only works while the game is open on screen. There is no offline progress.

## Install on your tablet

1. Copy `MeepleJacks.apk` to the tablet (USB, Google Drive, email to yourself, etc.).
2. Open it from the tablet's Files app.
3. If Android asks, allow your Files app to "Install unknown apps", then tap **Install**.

## Layout

- `web/`: the game itself (HTML5 canvas, plain JavaScript, no dependencies)
  - `js/data.js`: trees, ring distances, axes, upgrades, costs and goals. Tune the game here.
  - `js/art.js`: all pixel art, drawn in code at load (trees, Meeples, buildings, icons)
  - `js/world.js`: forest generation, you, lumberjacks, haulers, pathfinding, saving
  - `js/render.js`: renderer (one canvas pixel per art pixel, scaled up crisply by the browser)
  - `js/ui.js`, `js/audio.js`, `js/main.js`
- `android/`: WebView wrapper (`MainActivity.java`), manifest, icons, `build.sh`

## Building

No Gradle. `android/build.sh` runs aapt2 → javac → d8 → zipalign → apksigner from a plain JDK plus the Android
build-tools and platform jar, and inlines every script into one page (`android/bundle.py`) because some WebViews
refuse to load separate local files.

```bash
VERSION_CODE=1 VERSION_NAME=1.0 bash android/build.sh
```

The signing keystore and its password (`android/signing.env`) are git-ignored and must be kept to ship updates.

To play in a desktop browser, serve `web/` with any static server (add `?dev=4` to run time four times faster).
