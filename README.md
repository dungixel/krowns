# Krowns 1.0

A tiny kingdom simulation. Open **https://dungixel.github.io/krowns/** and press *Generate world*.

Everything you can tune lives in Notion (page **krowns 1.0**). The game never talks to Notion while it runs;
instead the numbers are copied into this repository when you ask for it (see "Updating the game from Notion").

## How the game is organised

| Folder / file | What it is |
|---|---|
| `index.html`, `css/style.css` | The page and its look |
| `assets/` | Sprites (`sprites/`), grass (`world/`), font (`fonts/`) - all pixel art is 16x16 |
| `notion-export/*.json` | A copy of the Notion tables: Jobs, Creatures, Structures, Settings, Colors, Animations, Speech |
| `data/game-data.js` | **Generated** from `notion-export` - this is what the game reads. Do not edit by hand |
| `tools/build-data.js` | Turns `notion-export` into `data/game-data.js` (`node tools/build-data.js`) |
| `tools/make-icons.js` | Builds `js/icons-data.js` (the Tabler icons named in Notion) |
| `js/sim/*.js` | The simulation (world, units, kingdoms, families, events, creatures, what units decide to do, jobs) |
| `js/render.js` | Drawing (pixel-perfect: every game pixel is the same size, zoom is whole numbers only) |
| `js/ui.js`, `js/audio.js`, `js/main.js` | Panels, sound, game loop |
| `tests/` | Automatic checks (`node tests/headless.js 20` plays 20 game days with no screen) |

## Updating the game from Notion

1. Change numbers, descriptions, colors or icons in the Notion tables of **krowns 1.0**.
2. Tell Claude: **"sync Notion"**. Claude reads the tables, rewrites `notion-export/*.json`, regenerates `data/game-data.js`,
   raises the version number (`?v=N` on every file in `index.html`, so browsers never show an old copy) and pushes to GitHub.
3. After about a minute the live page shows the new values.

Optional: with a Notion integration token stored as a GitHub secret, a GitHub Action could do the same thing automatically every few minutes.

## What lives in which Notion table

* **Jobs** - every job (and the villager with no job): class, damage, range, sprite, tint, icon, color, ambition, evil/good limits, how many per kingdom.
* **Settings** - every number of the world (time, hunger, energy, hearts, fights, kingdoms, wars, plays...). Each row says what it does.
* **Colors** - interface colors, name colors, shadow purple, day/night light.
* **Animations** - how many pixels things stretch, hop or sway, and how fast.
* **Creatures** - animals and monsters.
* **Structures and items** - castle, houses, theater, coliseum, chest, trees, food, wood, gold.
* **Speech** - every sentence units can say (with `{placeholders}`).
* **Rules** (page) - the rules in plain English, with every guess marked.

Rows marked **Guessed** in Notion were not in your original page; I invented them. Change them freely.
