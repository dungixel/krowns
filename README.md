# Krowns

A tiny meadow with trees. You are a knight (you choose the name), and one neighbour, Tero, lives here. He is a knight too. Every now and then a slime shows up.
Live: https://dungixel.github.io/krowns/

Move with **WASD / arrow keys** - mouse wheel or **+ / -** zooms - **1-9, 0** or the floating "Tero says..." button at the bottom left (it opens the list) pick what the neighbour says (**E** repeats it) - **Space** dodges (toward the direction you hold, or toward the mouse pointer if you hold nothing) - **M** mutes - **Esc** goes back to the menu.

The earlier, much bigger version (kingdoms, jobs, wars, hunger...) is kept on the branch `v1-full`.

## What is in here

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | The page, the title screen and the name screen |
| `js/world.js` | The meadow (trees, grass) and how bodies walk (freely, sliding along trees) |
| `js/npc.js` | The neighbour: strolls, says the sentences you pick, and fights slimes like a knight (dodges, slashes) |
| `js/combat.js` | Dodge, slash, being hurt, and the slime (spawning, its warning and its jump) |
| `js/voice.js` | The voice: every letter of a speech bubble makes a made-up sound, with intonation |
| `js/render.js` | Drawing: ground, grass, trees, shadows (units turn around the middle of their body, `sprite.pivot.*`), names, speech bubbles |
| `js/main.js` | Start, game loop, keyboard |
| `js/names.js`, `js/data.js`, `js/util.js` | Name making, reading the game content, small helpers |
| `content/*.json`, `data/game-data.js` | All numbers, colours, animations and speech lines (edit these), and the one file the game reads (generated) |
| `tools/build-data.js` | Turns `content` into `data/game-data.js` |
| `tests/smoke.js` | `node tests/smoke.js`: a quick check without a screen |

The whole page is about 100 KB to download.

## Fighting

Three rules: **dodge** (a few tiles in one direction; nothing can hurt the dodger meanwhile), **slash** (a knight's 90 degree sweep) and **the slime attacks by dodging** (it squashes and shakes as a warning, locks its direction, then jumps; the jump hurts whoever it touches). Slimes go for the nearest unit.
Tero only dodges when there is a reason: he sees a slime's warning, and if its jump would really hit him he dodges sideways just before it jumps (he sometimes misses it: `knight.dodgeSkill`). Otherwise he walks up to slimes, circles them and slashes when close.
Hearts are not shown on screen yet: a hit shows a white flash and a push back; at zero hearts a knight is knocked out for a few seconds and then wakes up. Slimes die after 3 slashes. All numbers are in `content/settings.json` (group Combat). The player cannot slash yet.

## The voice

No recordings, and nothing human-like. Every letter that appears makes one very soft, round little beep (spaces and punctuation are silent). The **pitch of a character's voice is just a number** (`voice.npc.pitchHz` in `content/settings.json`) - nothing else decides it. Proximity chat: voices fade out with distance (`voice.hearTiles`), get duller and come from their side.
The **melody** follows the sentence and runs smoothly through all its letters: statements slowly come down, questions go up at the end, exclamations start high and louder, **happy** speech is higher and bouncy, **sad** speech is lower, slower and sinks.
Tero's sentences live in `content/speech.json` (`Text` and `Mood`: neutral, happy, sad or angry). In the game you pick which one he says from the floating "says..." button at the bottom left, as often as you like.

## Changing the game's numbers and words

Everything lives in GitHub, in the `content/` folder (Notion is no longer used).

1. Change a value in `content/settings.json`, `colors.json`, `animations.json` or `speech.json` (or ask Claude to).
2. Run `node tools/build-data.js` (Claude does this for you), raise the `?v=N` number in `index.html`, and push.
3. After about a minute the live page shows the new values.
