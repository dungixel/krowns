// A quick check without a screen:  node tests/smoke.js
// Makes a world, walks the player into trees, makes the neighbour talk and checks the voice melody.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { Krowns: {}, console, Math, performance: { now: () => 0 } };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['data/game-data.js', 'js/util.js', 'js/data.js', 'js/names.js', 'js/world.js', 'js/voice.js', 'js/npc.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const K = ctx.Krowns;
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

for (const seed of [1, 2, 3, 4, 5]) {
  const W = K.world.create(seed);
  const [x, y] = K.world.freeTileNear(W, 48, 32, 10);
  const p = K.world.addBody(W, { name: 'Test', fx: x, fy: y });
  const n = K.npc.create(W, p);
  for (let i = 0; i < 6000; i++) {                  // 10 minutes of walking in a circle, all four directions
    const a = i / 200;
    K.world.moveBody(W, p, Math.cos(a), Math.sin(a), 0.1, 3.4);
    W.t += 0.1; K.npc.update(W, n, p, 0.1);
    for (const b of [p, n]) {
      const tx = Math.round(b.fx), ty = Math.round(b.fy);
      if (tx < 0 || ty < 0 || tx >= W.w || ty >= W.h) fail('body left the world (seed ' + seed + ')');
    }
  }
  if (!n.name) fail('neighbour has no name');
}
const up = K.voice.plan('Are you here?', 'neutral');
if (!(up[11].mult > up[0].mult)) fail('a question should rise at the end');
const down = K.voice.plan('It is quiet.', 'neutral');
if (!(down[10].mult < down[0].mult)) fail('a statement should fall at the end');
const sad = K.voice.plan('Hello there', 'sad'), happy = K.voice.plan('Hello there', 'happy');
if (!(sad[0].mult < happy[0].mult)) fail('sad should be lower than happy');
console.log('OK');
