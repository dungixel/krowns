// Krowns - read access to the game game content (numbers, colours, animations, speech) (data/game-data.js).
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const D = K.data;
  if (!D) throw new Error('data/game-data.js is missing. Run: node tools/build-data.js');

  K.S = (key, def) => (D.settings[key] === undefined ? def : D.settings[key]);       // a setting, e.g. K.S('world.width')
  K.C = (key, def) => (D.colors[key] === undefined ? def : D.colors[key]);           // a colour, e.g. K.C('shadow.purple')
  K.anim = (id) => D.animations[id] || { stretch: 0, period: 1, height: 0, extra: {} };
  K.lines = (category) => D.speech[category] || [];                                  // the sentences of one speech category
})();
