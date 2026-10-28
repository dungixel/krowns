# Krowns

A tiny meadow with trees. You are a knight (you choose the name), and one neighbour, Tero, lives here. He is a knight too. Every now and then a slime shows up.
Live: https://dungixel.github.io/krowns/

Move with **WASD** - mouse wheel or **+ / -** zooms - **1-9, 0** or the floating "Tero says..." button at the bottom left (it opens the list) pick what the neighbour says (**E** repeats it) - **click** slashes toward the mouse pointer - the **arrow keys** slash in their direction (hold two for a diagonal, hold one to keep slashing) - **Shift** dodges (toward the direction you hold with WASD, or toward the mouse pointer if you hold nothing) - **H** shows the hitboxes - **N** mutes - **Esc** goes back to the menu.

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
Every unit has a small pixel health bar over its head (red = hearts left, black = gone; `hpbar.*` in settings, `hp.*` colours). A hit shows a white flash and a push back. **Defeated** (zero hearts): the body is flung away like a ragdoll (it spins perfectly smoothly and hops twice; its pixels turn with it, so they look slanted while it spins and are square again when it lies still. `spin.snapToPixelGrid` 1 re-paints it onto the game pixels instead, keeping every pixel square but with shimmering edges), lies still, flickers and disappears. On its way it **smashes through trees and grass**: they are flung off too, but much weaker (about a third as far, only 2-3 quarter turns of spin) and flicker out; grass grows back after 30 s, trees stay gone (`defeat.*`). Grass tufts are drawn a bit darker than the ground (`grass.darken`). A slime is gone for good (3 slashes); a knight comes back a few seconds later where it landed, flickering. Every hit on screen **shakes the screen** a little, more the nearer the hit is to the middle of the screen (`shake.*` in settings: by default only hits **you** land shake it; `shake.others` 1 brings back every hit, `shake.whenPlayerHurt` 1 shakes it when you are hit too; it is on now). All numbers are in `content/settings.json` (group Combat).
**You can attack Tero.** Your slash (click or the arrow keys) hurts him, and even a swing at him makes him treat you as an enemy for `knight.grudgeSeconds`; every new attack renews it. He never hurts you before that. Once you are an enemy he **weighs the threats**: every slime nearby and you each get a threat number (closer = worse; a slime whose jump is about to land on him = much worse; you swinging at him = much worse, you being nearly defeated = easy to finish; you count by `knight.playerThreat`). He deals with the biggest threat first and only switches when another is clearly worse, so he can decide to eliminate you before the slimes, or ignore you while a slime is about to jump on him. He dodges your slash only if it would really hit him (`knight.dodgeSkillVsPlayer`). The fight ends when the grudge runs out or one of you is defeated.

**A living world.** There are always **10 knights** (`knight.count`: Tero and nine others with their own names, who do not talk) and **10 slimes** (`slime.maxAlive`). Tero stays near you (`npc.leashTiles`) so you can always hear him; the others roam freely. The knights start in the middle of the map (`knight.spawnRadiusTiles`), then wander, hunt the nearest slime (`knight.huntTiles`) and fight like Tero (they all hold a grudge against you if you attack them). Whenever a slime is defeated, another one shows up somewhere on the map a few seconds later; a defeated knight comes back after a few seconds, so there are still 10. **Trees grow at random**: every few seconds (`tree.growEverySeconds`) a new tree fades in on a free tile, until there are 10% more than at the start (`tree.maxFactor`), which also refills the holes smashed by flung bodies.

**Hitboxes.** Everything has a hitbox and every hitbox is a **square** (`hitbox.*` in settings): a unit's square sits at its feet, a tree's square is only its trunk (the leaves are decoration you can walk behind). Units are solid for each other and for trees. Press **H** in the game to see all the squares (lime = units, yellow = slimes, red = trunks). Attacks hit squares too: a slash hits whoever's square its sweep touches, a slime's jump hurts whoever's square it touches.
**A dodge pushes**: a unit in the way of a dodger is shoved along (and the ones behind it).
**Going around things.** Knights and slimes walk around trees and other units (they plan a route on the tile grid and plan again every half second, because units move) when they hunt, return to you, wander or close in on a target.
**Reactions.** A knight you hit (or swing at) does not hit back in the same moment: a yellow **"!"** shows over his head for a fraction of a second (`knight.alertMinSeconds`..`Max`) and only then he fights. The "!" only shows at the *start* of a fight (also when a knight first sees a slime, or a slime first notices somebody) and goes away; it is never a warning before an attack. In a fight he **feints** now and then (`knight.feintsPerSecond`: a quick dodge sideways) and he does not dodge every slash of yours: he reads about half of them, and not instantly (`knight.dodgeSkillVsPlayer`, `knight.playerReactionMin/MaxSeconds`).
**Bouncing.** A defeated body bounces off trees, other units (they are bumped, not hurt) and the edge of the map, losing speed each time (`defeat.bounceKeep`). Grass is still flung away.

## The voice

No recordings, and nothing human-like. Every letter that appears makes one very soft, round little beep (spaces and punctuation are silent). The **pitch of a character's voice is just a number** (`voice.npc.pitchHz` in `content/settings.json`) - nothing else decides it. Proximity chat: voices fade out with distance (`voice.hearTiles`), get duller and come from their side.
The **melody** follows the sentence and runs smoothly through all its letters: statements slowly come down, questions go up at the end (`voice.questionRise`: 1 = gentle, 1.4 = default, higher = more), exclamations start high and louder, **happy** speech is higher and bouncy, **sad** speech is lower, slower and sinks.
Tero's sentences live in `content/speech.json` (`Text` and `Mood`: neutral, happy, sad or angry). In the game you pick which one he says from the floating "says..." button at the bottom left, as often as you like.

## Changing the game's numbers and words

Everything lives in GitHub, in the `content/` folder (Notion is no longer used).

1. Change a value in `content/settings.json`, `colors.json`, `animations.json` or `speech.json` (or ask Claude to).
2. Run `node tools/build-data.js` (Claude does this for you), raise the version number `N` in `index.html` (`data-v="N"` and every `?v=N`), and push. The number is shown small and gray next to the logo on the title screen ("v33"), so you can see which version of the game you are running; Claude tells you the number with every update.
3. After about a minute the live page shows the new values.
