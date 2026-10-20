# Krowns

A tiny medieval-fantasy world of little souls. Press **Create world** and a handful of units appear. Nobody tells them what to do. They find food, found kingdoms, divide the work, fall in love, quarrel, fight wars and remember who wronged them.

Every unit is born with hidden stats (like IVs in Pokémon) and grows hidden training (like EVs). You never see the numbers. Click a unit and the game only tells you in words, and the coloured words really mean something.

## Play it

**On your computer:** download this folder and double-click `index.html`. There is nothing to install.

**Online:** on GitHub open *Settings → Pages*, choose *Deploy from a branch*, pick `main` and the `/ (root)` folder. After a minute the game is live at `https://<your-username>.github.io/krowns/`.

## Controls

| | |
|---|---|
| Click a unit or a castle | See who they are (the panel follows them) |
| Scroll, pinch, or + / - | Smooth zoom toward the pointer |
| Drag, or arrow keys | Move around the map |
| Space | Pause |
| 1 / 2 / 3 | Normal / 2x / 4x speed |
| F | Show the whole world |
| M | Sound on / off |
| Clock-bubble button, bottom left | The history of the world |

The map is a soft grid. Everything sits on whole squares: a unit takes one step (one square) per second, and castles, fields and animals each fill exactly one square. Nothing can walk through them.

Names in blue-ish text inside the panel are clickable and jump to that unit.

## What is in the world right now

- **Time:** one step per second, and every step is 10 minutes of world time. A whole day takes 2 minutes 24 seconds at normal speed. The clock next to the day number shows the time (a new world starts at 08:00). A unit can do one thing per step; some things take longer (eating takes one step per hunger point).
- **Day and night:** the world is white by day, orange at sunrise and sunset, and dark desaturated blue at night. Castles light up at night.
- **Rest:** every soul has a hidden *rest* trait (from "dozy" to "tireless") that decides how fast they tire and how well they sleep. Around 21:00 everyone walks home and goes to sleep (a little *zz* appears above them), and they wake at dawn. Sleepyheads sleep in. A tired soul fights worse: blows go wide and spells fizzle. Someone who is completely exhausted collapses and naps.
- **Night watch:** when a kingdom is at war, its most rested swordsmen stay awake as sentries (an eye icon and a lantern). Keen-eyed sentries spot enemies sooner. When they sound the alarm, everyone wakes up.
- **Night raids:** a kingdom at war may march against its enemy in the dark. Sleepers cannot defend themselves, so a hit on a sleeper does more damage, and a castle with no one awake to defend it can be overrun. Raiders are tired the next day.
- **Hearts** (6 to 20, average 10). They drop from fights, poison, burning and starving. They come back through a mage's healing, or by eating while hungry.
- **Hunger** falls 0.5 every 10 seconds. At 1 to 2 a unit starts looking for food if it is close enough. At 0 it loses a heart every 2 seconds.
- **Hidden stats at birth:** strength, magic, temperament, cooking, farming, poetry, hunting, charisma, sociability, curiosity, loyalty and courage. Children inherit a third from each parent and a third is random.
- **Training:** units get better at what they practice, but someone born with weak talent never catches up to someone born gifted. Interests can change suddenly, and a poet can end up a warrior.
- **Jobs:** farmer, cook, hunter, swordsman, mage, poet. Kingdoms steer their people toward the jobs they need, but a unit may secretly yearn for something else.
- **Mages** learn healing first, then poison, burn and confuse as they practice.
- **Temperament:** hot heads hit back and start brawls. Gentle ones flee or try to talk people down. Friends step in to protect each other.
- **Kingdoms:** free (grey) units who stand together found a kingdom, which gets its own pastel colour. Kingdoms grow, feed their people, go to war, make peace and can fall.
- **Memory:** every unit remembers everyone it has met. Betrayal is remembered, and sometimes forgiven.
- **Speech bubbles** announce each decision and type out letter by letter. Each unit has its own typing voice.

## Not built yet (ideas from the design notes)

Different governments and tyrants, more classes and hidden traits, weather and seasons, saving worlds to an account (Supabase), your own art for the units.

## For tinkerers

```
index.html         the page
css/style.css      how it looks
js/sim.js          the simulation (units, kingdoms, wars, love)   <- the heart of the game
js/words.js        what units say, and how hidden stats become words
js/names.js        names and kingdom colours
js/render.js       drawing, speech bubbles, the follow-panel
js/audio.js        typing sounds (made in the browser, no files)
js/main.js         buttons and the game clock
js/icons.js        the few icons the game uses (generated)
assets/icons/      the complete Tabler icon set (outline + filled)
tools/             tests and the icon builder (optional)
```

Run the tests (optional, needs Node): `node tools/simtest.js` plays several worlds for thousands of seconds and checks that nothing breaks.

## Credits

Icons: [Tabler Icons](https://tabler.io/icons), MIT licence (`assets/icons/LICENSE-tabler.txt`).
