// A quick check without a screen:  node tests/smoke.js
// Makes a world, walks the player into trees, makes the neighbour talk and checks the voice melody.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { Krowns: {}, console, Math, performance: { now: () => 0 } };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['data/game-data.js', 'js/util.js', 'js/data.js', 'js/names.js', 'js/world.js', 'js/combat.js', 'js/voice.js', 'js/npc.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
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
const notes = (txt, mood) => K.voice.plan(txt, mood || 'neutral').filter(Boolean);     // one beep per letter
const q = notes('Are you here?'), d = notes('It is quiet.'), e = notes('What a beautiful day!');
if (q.length !== 10) fail('one beep per letter expected, got ' + q.length);
if (!(q[q.length - 1].mult > q[0].mult * 1.2)) fail('a question should rise at the end');
if (!(d[d.length - 1].mult < d[0].mult)) fail('a statement should fall at the end');
if (!(e[e.length - 1].mult < e[1].mult)) fail('an exclamation should fall at the end');
const avg = (a) => a.reduce((s, x) => s + x.mult, 0) / a.length;
if (!(avg(notes('Hello there', 'sad')) < avg(notes('Hello there', 'happy')))) fail('sad should be lower than happy');
for (const l of K.lines()) {          // the melody has no sudden jumps between neighbouring letters
  for (const sentence of l.text.split(/(?<=[.!?])\s+/)) {
    const pl = notes(sentence, l.mood);
    for (let i = 1; i < pl.length; i++) if (Math.abs(Math.log2(pl[i].mult / pl[i - 1].mult)) > 0.65) fail('pitch jumps inside: ' + sentence);
  }
}
for (const l of K.lines()) {
  const pl = K.voice.plan(l.text, l.mood);
  if (!pl.some(Boolean)) fail('no sound at all in: ' + l.text);
  if (!['neutral', 'happy', 'sad', 'angry'].includes(l.mood)) fail('unknown mood for: ' + l.text);
}

// ---- fighting
{
  const mk = (seed) => {
    const W = K.world.create(seed), [x, y] = K.world.freeTileNear(W, 48, 32, 10);
    const p = K.world.addBody(W, { kind: 'player', name: 'P', fx: x, fy: y });
    return { W, p, n: K.npc.create(W, p) };
  };
  const step = (W, n, p, secs) => { for (let i = 0; i < secs * 60; i++) { W.t += 1 / 60; K.npc.update(W, n, p, 1 / 60); K.combat.update(W, 1 / 60, p); } };
  // a slash is a 90 degree sweep: it hits a slime in front, not one at the side
  {
    const { W, p, n } = mk(11);
    n.fx = p.fx + 20; n.fy = p.fy;                                  // Tero far away
    const open = (b, fx, fy) => { b.fx = fx; b.fy = fy; };
    open(p, 40.5, 30.5);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { W.blk[(30 + dy) * W.w + 40 + dx] = 0; }
    const front = K.combat.spawnSlime(W, p), side = K.combat.spawnSlime(W, p);
    open(front, p.fx + 1.0, p.fy); open(side, p.fx, p.fy + 1.0);
    front.stunUntil = side.stunUntil = 0; front.cd = side.cd = 1e9;   // they sit still
    p.slashReady = 0;
    if (!K.combat.slash(W, p, 0)) fail('player knight could not start a slash');
    for (let i = 0; i < 90; i++) { W.t += 1 / 60; K.combat.update(W, 1 / 60, null); }
    if (!(front.hp < front.maxHp)) fail('a slash should hit a slime in front');
    if (side.hp !== side.maxHp) fail('a slash should not hit a slime 90 degrees to the side');
  }
  // dodging makes you untouchable
  {
    const { W, p, n } = mk(12);
    n.fx = p.fx + 20;
    const s = K.combat.spawnSlime(W, p);
    s.fx = p.fx + 1.5; s.fy = p.fy;
    if (!K.combat.dodge(W, p, 0, -1)) fail('could not dodge');
    p.dodgeReady = 0;
    K.combat.dodge(W, s, -1, 0, { force: true, harm: true, seconds: 0.26, invul: 0.28, cooldown: 0 });
    const hp = p.hp;
    for (let i = 0; i < 20; i++) { W.t += 1 / 60; K.combat.update(W, 1 / 60, null); }
    if (p.hp !== hp) fail('a dodging unit was hurt');
    if (K.combat.canDodge(W, p) && p.dodge) fail('cannot dodge twice at once');
  }
  // slimes appear now and then, never more than the limit, and Tero (a knight) deals with them
  let kills = 0, dodges = 0, hurt = 0;
  for (const seed of [21, 22, 23, 24]) {
    const { W, p, n } = mk(seed);
    const od = K.combat.dodge, oh = K.combat.hurt;
    K.combat.dodge = function (...a) {
      const r = od.apply(this, a);
      if (r && a[1] === n) {         // Tero never dodges for nothing: a slime must be winding up with its jump aimed at him
        dodges++;
        if (!W.bodies.some((s) => s.kind === 'slime' && s.atk && s.atk.state === 'wind' && K.combat.laneDistance(s, s.atk.dir, K.S('slime.lungeDistanceTiles', 2.8), n) < K.S('slime.hitRadiusTiles', 0.65) + 0.31)) fail('Tero dodged for no reason');
      }
      return r;
    };
    K.combat.hurt = function (w, t, ...a) { const r = oh.call(this, w, t, ...a); if (r && t === n) hurt++; if (r && t.dead) kills++; return r; };
    let most = 0;
    for (let i = 0; i < 180 * 60; i++) {
      W.t += 1 / 60; K.npc.update(W, n, p, 1 / 60); K.combat.update(W, 1 / 60, p);
      if (i % 60 === 0) most = Math.max(most, W.bodies.filter((b) => b.kind === 'slime' && !b.dead).length);
      for (const b of W.bodies) if (!(b.fx >= 0 && b.fy >= 0 && b.fx <= W.w - 1 && b.fy <= W.h - 1)) fail('body left the world while fighting');
    }
    K.combat.dodge = od; K.combat.hurt = oh;
    if (most < 1) fail('no slime appeared in 3 minutes (seed ' + seed + ')');
    if (most > K.S('slime.maxAlive', 3)) fail('too many slimes at once');
  }
  if (kills < 1) fail('Tero never killed a slime');
  if (dodges < 4) fail('Tero hardly dodges');
  console.log('fighting: Tero killed ' + kills + ' slimes, dodged ' + dodges + ' times, was hit ' + hurt + ' times');
}
console.log('OK');
