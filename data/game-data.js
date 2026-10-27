// GENERATED from content/*.json by tools/build-data.js - do not edit by hand.
globalThis.Krowns = globalThis.Krowns || {};
globalThis.Krowns.data = {
 "generatedAt": "2026-10-27T15:40:28.751Z",
 "settings": {
  "world.width": 96,
  "world.height": 64,
  "world.treeDensity": 0.11,
  "world.grassDetailDensity": 0.24,
  "render.zoomSteps": [
   1,
   2,
   3,
   4,
   6,
   8
  ],
  "render.nameFontMinPx": 9,
  "render.nameFontWorldPx": 5.5,
  "shadow.lean": -0.4,
  "shadow.length": 0.4,
  "tree.fadeOpacity": 0.5,
  "tree.fadeSeconds": 0.25,
  "unit.hopHeightPx": 2,
  "sprite.pivot.knight": 4.5,
  "sprite.pivot.base": 4.5,
  "sprite.pivot.farmer": 6.5,
  "bubble.charsPerSecond": 14,
  "names.syllables": [
   "na",
   "sa",
   "ta",
   "ca",
   "ne",
   "se",
   "te",
   "ni",
   "no",
   "nu",
   "ma",
   "me",
   "mi",
   "mo",
   "mu",
   "da",
   "de",
   "di",
   "do",
   "du",
   "ba",
   "be",
   "bi",
   "bo",
   "bu",
   "nae",
   "sae",
   "tae",
   "cae",
   "ya",
   "ye",
   "yi",
   "yo",
   "yu",
   "ke",
   "ki",
   "co",
   "fe",
   "fi",
   "pa",
   "pae",
   "pe",
   "tra",
   "tre",
   "tri",
   "tro",
   "tru",
   "cra",
   "cre",
   "cri",
   "cro",
   "cru",
   "bra",
   "bre",
   "bri",
   "bro",
   "bru",
   "la",
   "lae",
   "leo",
   "lu",
   "li",
   "pi",
   "po",
   "pu",
   "ga",
   "ge",
   "gi",
   "go",
   "gu",
   "dae"
  ],
  "names.banned": [
   "buyate",
   "tula",
   "peo",
   "pedo",
   "put",
   "puss",
   "pene",
   "pija",
   "pito",
   "pipi",
   "cono",
   "cona",
   "caca",
   "cago",
   "culo",
   "teta",
   "nig",
   "meo",
   "mear"
  ],
  "names.endingConsonants": [
   "s",
   "n",
   "r",
   "l"
  ],
  "names.twoSyllableChance": 33,
  "names.threeSyllableChance": 33,
  "names.twoWithEndingChance": 33,
  "player.speedTilesPerSecond": 3.4,
  "npc.name": "Tero",
  "npc.job": "farmer",
  "npc.sprite": "farmer",
  "npc.walkTilesPerSecond": 1.3,
  "bubble.lingerSeconds": 2.2,
  "voice.volume": 0.5,
  "voice.hearTiles": 16,
  "voice.letterSeconds": 0.2,
  "voice.randomness": 0.004,
  "voice.glideToNext": 0.8,
  "voice.npc.pitchHz": 330,
  "voice.npc.formant": 1.3,
  "voice.npc.brightness": 1
 },
 "colors": {
  "shadow.purple": "#957fae",
  "shadow.opacity": 1,
  "ui.panel": "#ffffff",
  "ui.text": "#2f2c36",
  "ui.textSoft": "#8a8593",
  "ui.line": "#ece8f0",
  "ui.bubble": "#ffffff",
  "ui.bubbleText": "#2f2c36",
  "ui.nameOutline": "#2a2433",
  "name.pastel.1": "#ffc9de",
  "name.pastel.2": "#ffd9b3",
  "name.pastel.3": "#fff0b3",
  "name.pastel.4": "#d3f2b8",
  "name.pastel.5": "#b8f0dc",
  "name.pastel.6": "#b8e6ff",
  "name.pastel.7": "#c9d3ff",
  "name.pastel.8": "#e1c9ff",
  "name.pastel.9": "#ffc9f0",
  "name.pastel.10": "#ffd0c9",
  "name.pastel.11": "#c9f5f2",
  "name.pastel.12": "#f3e3c2"
 },
 "animations": {
  "grass_sway": {
   "stretch": 2,
   "period": 8,
   "height": 0,
   "extra": {
    "cyclesBeforeSpeedChange": 3,
    "periodMin": 5,
    "periodMax": 11
   }
  },
  "breathe": {
   "stretch": 1,
   "period": 1.8,
   "height": 0,
   "extra": {}
  },
  "hop": {
   "stretch": 1,
   "period": 0.5,
   "height": 2,
   "extra": {}
  },
  "talk": {
   "stretch": 1,
   "period": 0.34,
   "height": 0,
   "extra": {}
  },
  "tree_sway": {
   "stretch": 1.5,
   "period": 4,
   "height": 0,
   "extra": {
    "periodMin": 2.5,
    "periodMax": 5.5
   }
  },
  "tree_fade": {
   "stretch": 0,
   "period": 0.25,
   "height": 0,
   "extra": {
    "opacity": 0.5
   }
  }
 },
 "speech": [
  {
   "text": "Hello, you should be my neighbor!",
   "mood": "happy"
  },
  {
   "text": "How come it's still hot in this meadow? It should be winter by now!",
   "mood": "neutral"
  },
  {
   "text": "How are you, sir?",
   "mood": "neutral"
  },
  {
   "text": "My name's Tero, and I'm a humble farmer.",
   "mood": "neutral"
  },
  {
   "text": "Get out of my crops!",
   "mood": "angry"
  },
  {
   "text": "What!",
   "mood": "angry"
  },
  {
   "text": "What...?",
   "mood": "neutral"
  },
  {
   "text": "Uhum.",
   "mood": "neutral"
  },
  {
   "text": "Oh, wow...",
   "mood": "neutral"
  },
  {
   "text": "Interesting...",
   "mood": "neutral"
  },
  {
   "text": "Nope, I don't want that trade. Guys, this guy wants to trick me!",
   "mood": "angry"
  },
  {
   "text": "I love taking care of my crops. Just look at them.",
   "mood": "happy"
  }
 ]
};
