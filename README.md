# Krowns

A tiny meadow with trees. You are a knight (you choose the name), and one neighbour lives here.
Live: https://dungixel.github.io/krowns/

Move with **WASD / arrow keys** - mouse wheel or **+ / -** zooms - **E** makes the neighbour talk - **M** mutes - **Esc** goes back to the menu.

The earlier, much bigger version (kingdoms, jobs, wars, hunger...) is kept on the branch `v1-full`.

## What is in here

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | The page, the title screen and the name screen |
| `js/world.js` | The meadow (trees, grass) and how bodies walk (freely, sliding along trees) |
| `js/npc.js` | The neighbour: strolls, and says test sentences (his personality comes later) |
| `js/voice.js` | The voice: every letter of a speech bubble makes a made-up sound, with intonation |
| `js/render.js` | Drawing: ground, grass, trees, shadows, names, speech bubbles |
| `js/main.js` | Start, game loop, keyboard |
| `js/names.js`, `js/data.js`, `js/util.js` | Name making, reading the Notion data, small helpers |
| `notion-export/*.json`, `data/game-data.js` | The Notion tables (Settings, Colors, Animations, Speech) and the one file the game reads |
| `tools/build-data.js` | Turns `notion-export` into `data/game-data.js` |
| `tests/smoke.js` | `node tests/smoke.js`: a quick check without a screen |

The whole page is about 100 KB to download.

## The voice

No recordings. Each letter is a short buzzing tone shaped by two filters so it sounds like "ah / eh / ee / oh / oo" (letters are "spelled out" like their names, so `b` is a pop + "ee"). The **pitch of a character is just a number** (`voice.npc.pitchHz`, `voice.npc.formant` in Settings) - nothing else decides it.
The **melody** follows the sentence: statements slowly come down, questions go up at the end, exclamations start high and louder, **happy** speech is higher and bouncy, **sad** speech is lower, slower and sinks.
Speech lines live in the Notion **Speech** table, category `test.neutral`, `test.happy` or `test.sad`.

## Updating the game from Notion

1. Change numbers, colours or sentences in the Notion tables of **krowns 1.0**.
2. Tell Claude: **"sync Notion"**. Claude rewrites `notion-export/*.json`, runs `node tools/build-data.js`, raises the `?v=N` number in `index.html` and pushes.
3. After about a minute the live page shows the new values.

Optional: with a Notion integration token stored as a GitHub secret, a GitHub Action could do the same automatically.
(The Notion tables Jobs, Creatures and Structures are not read by this version; they stay in Notion untouched.)
