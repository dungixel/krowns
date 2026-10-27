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
const notes = (txt, mood) => K.voice.plan(txt, mood || 'neutral').filter(Boolean);
const endPitch = (x) => x.mult * x.glide;
const q = notes('Are you here?'), d = notes('It is quiet.'), e = notes('What a beautiful day!');
if (!(endPitch(q[q.length - 1]) > q[0].mult * 1.2)) fail('a question should rise at the end');
if (!(endPitch(d[d.length - 1]) < d[0].mult)) fail('a statement should fall at the end');
if (!(endPitch(e[e.length - 1]) < e[1].mult)) fail('an exclamation should fall at the end');
const avg = (a) => a.reduce((s, x) => s + x.mult, 0) / a.length;
if (!(avg(notes('Hello there', 'sad')) < avg(notes('Hello there', 'happy')))) fail('sad should be lower than happy');
const words = K.voice.plan('beautiful', 'neutral').filter(Boolean).length;
if (words !== 3) fail('beautiful should have 3 syllables, got ' + words);
if (K.voice.plan('my', 'neutral').filter(Boolean).length !== 1) fail('"my" should have one sound (y counts as a vowel)');
console.log('OK');
