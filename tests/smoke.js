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
  // defeat: flung away like a ragdoll, flickers and disappears; a knight comes back, a slime does not
  {
    const { W, p, n } = mk(13);
    n.fx = p.fx + 25;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -8; dx <= 8; dx++) { const x = Math.round(p.fx) + dx, y = Math.round(p.fy) + dy; if (x > 0 && y > 0 && x < W.w - 1 && y < W.h - 1) W.blk[y * W.w + x] = 0; }
    const s = K.combat.spawnSlime(W, p); s.fx = p.fx + 1; s.fy = p.fy; s.cd = 1e9; s.hp = 1;
    const x0 = s.fx, tot = K.S('defeat.flySeconds', 0.9) + K.S('defeat.restSeconds', 0.35) + K.S('defeat.flickerSeconds', 0.8);
    if (!K.combat.hurt(W, s, 1, p)) fail('could not hurt the slime');
    if (!s.rag || !s.dead) fail('a defeated slime should become a ragdoll');
    let sawOff = false, sawOn = false, maxZ = 0;
    for (let i = 0; i < (tot + 0.5) * 60; i++) {
      W.t += 1 / 60; K.combat.update(W, 1 / 60, null);
      if (s.rag) { const pose = K.combat.ragPose(W.t, s); maxZ = Math.max(maxZ, pose.z); if (W.t - s.rag.t0 > s.rag.fly + s.rag.rest) { if (pose.visible) sawOn = true; else sawOff = true; } }
    }
    if (!(s.fx - x0 > 2.5)) fail('the ragdoll should be flung away from the hit (moved ' + (s.fx - x0).toFixed(2) + ')');
    if (!(maxZ > 8)) fail('the ragdoll should fly up');
    if (!(sawOn && sawOff)) fail('the body should flicker before it disappears');
    if (W.bodies.includes(s)) fail('the defeated slime should be gone');
    // a knight
    p.hp = 1; p.invulUntil = 0;
    K.combat.hurt(W, p, 1, null);
    if (!p.ko || !p.rag) fail('a defeated knight should be knocked out as a ragdoll');
    let hiddenSeen = false;
    for (let i = 0; i < 20 * 60 && p.ko; i++) { W.t += 1 / 60; K.combat.update(W, 1 / 60, null); if (p.hidden) hiddenSeen = true; }
    if (!hiddenSeen) fail('a defeated knight should disappear for a while');
    if (p.ko || p.hidden || p.hp < 1) fail('a defeated knight should come back');
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
// the player can attack Tero, and he decides who is the bigger threat
{
  const mk = (seed) => {
    const W = K.world.create(seed), [x, y] = K.world.freeTileNear(W, 48, 32, 10);
    const p = K.world.addBody(W, { kind: 'player', name: 'P', fx: x, fy: y });
    return { W, p, n: K.npc.create(W, p) };
  };
  const step = (W, n, p, secs) => { for (let i = 0; i < secs * 60; i++) { W.t += 1 / 60; K.npc.update(W, n, p, 1 / 60); K.combat.update(W, 1 / 60, p); } };
  const clearAround = (W, p) => { for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) { const tx = Math.round(p.fx) + x, ty = Math.round(p.fy) + y; if (tx >= 0 && ty >= 0 && tx < W.w && ty < W.h) W.blk[ty * W.w + tx] = 0; } };
  const slime = (W, fx, fy) => { const s = K.combat.spawnSlime(W, { fx, fy }); s.fx = fx; s.fy = fy; return s; };
  // 1. peaceful: Tero never hurts a player who never attacked him, even with slimes around
  {
    const { W, p, n } = mk(31); clearAround(W, p); n.fx = p.fx + 1.2; n.fy = p.fy;
    const oh = K.combat.hurt; let hitYou = 0;
    K.combat.hurt = function (w, t, ...a) { const r = oh.call(this, w, t, ...a); if (r && t === p) hitYou++; return r; };
    step(W, n, p, 20);
    K.combat.hurt = oh;
    if (K.combat.angry(W, n)) fail('Tero should not be angry at a player who did nothing');
  }
  // 2. you slash Tero: he is hurt, and from then on you are an enemy
  {
    const { W, p, n } = mk(32); clearAround(W, p);
    n.fx = p.fx + 0.9; n.fy = p.fy; n.ai.mode = 'idle'; n.ai.until = 1e9;
    const hp0 = n.hp;
    K.combat.slash(W, p, 0);
    for (let i = 0; i < 40; i++) { W.t += 1 / 60; K.combat.update(W, 1 / 60, p); }
    if (!(n.hp < hp0)) fail('your slash should hurt Tero');
    if (!K.combat.angry(W, n)) fail('Tero should hold a grudge after you hurt him');
    step(W, n, p, K.S('knight.grudgeSeconds', 12) + 30);
    if (K.combat.angry(W, n) && !p.ko) { /* a fight may have renewed nothing: the grudge only renews on your attacks */ fail('Tero should forgive you after a while'); }
  }
  // 3. who does he go for? a close player beats a far slime; a close slime beats a far player
  {
    const { W, p, n } = mk(33); clearAround(W, p);
    n.fx = p.fx + 2.5; n.fy = p.fy; K.combat.provoke(W, n, p, 3);
    const s = slime(W, n.fx + 6.5, n.fy);
    s.stunUntil = 1e9; s.hp = 99;
    step(W, n, p, 0.5);
    if (!n.cb || n.cb.tgt !== p) fail('Tero should go for the close player before the far slime');
  }
  {
    const { W, p, n } = mk(34); clearAround(W, p);
    n.fx = p.fx + 8; n.fy = p.fy; K.combat.provoke(W, n, p, 1);
    const s = slime(W, n.fx - 1.2, n.fy + 0.3);
    s.stunUntil = 1e9; s.hp = 99;
    step(W, n, p, 0.5);
    if (!n.cb || n.cb.tgt !== s) fail('Tero should deal with the slime next to him before the far player');
  }
  // 4. a duel: he fights back, and dodges your slashes only when they would hit him
  {
    let youHit = 0, heHit = 0, slashDodges = 0, hitYouByHim = 0;
    for (const seed of [41, 42, 43, 44, 45, 46]) {
      const { W, p, n } = mk(seed); clearAround(W, p);
      n.fx = p.fx + 1.6; n.fy = p.fy; n.ai.mode = 'idle'; n.ai.until = 1e9;
      K.combat.slash(W, p, 0); step(W, n, p, 0.5); // provoke him with a swing
      if (!K.combat.angry(W, n)) fail('a swing at Tero should anger him');
      const od = K.combat.dodge, oh = K.combat.hurt;
      K.combat.dodge = function (...a) {
        const r = od.apply(this, a);
        if (r && a[1] === n) {
          const slimeThreat = W.bodies.some((s) => s.kind === 'slime' && s.atk && s.atk.state === 'wind');
          const swing = p.slash && K.combat.dist(n, p) <= K.S('slash.rangeTiles', 1.35) + 0.31;
          if (!slimeThreat && !swing) fail('Tero dodged for no reason in a duel');
          if (swing) slashDodges++;
        }
        return r;
      };
      K.combat.hurt = function (w, t, d, src, ...a) { const r = oh.call(this, w, t, d, src, ...a); if (r && t === n && src === p) youHit++; if (r && t === p && src === n) hitYouByHim++; return r; };
      for (let i = 0; i < 40 * 60 && !K.combat.angry(W, n) === false; i++) {
        W.t += 1 / 60;
        // you chase him and swing at him whenever you can
        if (!p.ko && !p.slash && !p.kb) {
          const d = K.combat.dirTo(p, n), dd = K.combat.dist(p, n);
          if (dd < 1.1 && K.combat.canSlash(W, p)) K.combat.slash(W, p, Math.atan2(d.y, d.x)); else if (dd > 0.9) K.world.moveBody(W, p, d.x, d.y, 1 / 60, 3.4);
        }
        K.npc.update(W, n, p, 1 / 60); K.combat.update(W, 1 / 60, p);
        if (i % 60 === 0 && K.combat.angry(W, n) === false) break;
      }
      K.combat.dodge = od; K.combat.hurt = oh;
    }
    if (youHit < 2) fail('you should be able to land hits on Tero (landed ' + youHit + ')');
    if (hitYouByHim < 2) fail('Tero should fight back and hit you (hit ' + hitYouByHim + ')');
    if (slashDodges < 1) fail('Tero should sometimes dodge your slash');
    console.log('duel: you hit Tero ' + youHit + ' times, he hit you ' + hitYouByHim + ' times, he dodged ' + slashDodges + ' of your slashes');
  }
}

// a body flung through trees and grass smashes them, but the pieces fly much weaker than the body
{
  const W = K.world.create(51), [x, y] = K.world.freeTileNear(W, 48, 32, 10);
  const p = K.world.addBody(W, { kind: 'player', name: 'P', fx: x, fy: y });
  for (let i = 1; i <= 5; i++) { const tx = Math.round(p.fx) + i; if (tx < W.w - 1 && !W.blk[Math.round(p.fy) * W.w + tx]) { W.trees.push({ x: tx, y: Math.round(p.fy), fade: 1 }); W.blk[Math.round(p.fy) * W.w + tx] = 1; } }
  for (let i = 1; i <= 4; i++) W.grass.push({ x: Math.round(p.fx) + i, y: Math.round(p.fy), ox: 0, oy: 0, phase: 0, period: 3, cycles: 0 });
  const trees0 = W.trees.length, grass0 = W.grass.length;
  p.hp = 1; p.invulUntil = 0;
  const x0 = p.fx;
  K.combat.hurt(W, p, 1, { fx: p.fx - 1, fy: p.fy, kind: 'slime' });
  let maxDebris = 0;
  for (let i = 0; i < 70; i++) { W.t += 1 / 60; K.combat.update(W, 1 / 60, null); maxDebris = Math.max(maxDebris, (W.debris || []).length); }
  if (W.trees.length >= trees0) fail('a flung body should smash the trees in its way');
  if (W.grass.length >= grass0) fail('a flung body should smash grass in its way');
  if (!(p.fx - x0 > 2)) fail('the body should fly through where the trees were (flew ' + (p.fx - x0).toFixed(2) + ')');
  for (const d of W.debris || []) if (d.dist > K.S('defeat.flyTiles', 5) * 16 * 0.45) fail('smashed pieces should fly much weaker than the body');
  for (let i = 0; i < 120; i++) { W.t += 1 / 60; K.combat.update(W, 1 / 60, null); }
  if ((W.debris || []).length) fail('flung pieces should be gone after a moment');
  console.log('smash: body flew ' + (p.fx - x0).toFixed(1) + ' tiles, smashed ' + (trees0 - W.trees.length) + ' trees and ' + (grass0 - W.grass.length) + ' grass tufts');
}

// a living world: 10 knights, 10 slimes (a defeated one is replaced), trees grow at random
{
  const W = K.world.create(61), [x, y] = K.world.freeTileNear(W, 48, 32, 10);
  const p = K.world.addBody(W, { kind: 'player', name: 'P', fx: x, fy: y });
  const n = K.npc.create(W, p); K.npc.populate(W, p, n); K.combat.populate(W, p);
  const knights = () => W.bodies.filter((b) => b.kind === 'npc'), slimes = () => W.bodies.filter((b) => b.kind === 'slime' && !b.dead);
  if (knights().length !== K.S('knight.count', 10)) fail('there should be ' + K.S('knight.count', 10) + ' knights, not ' + knights().length);
  if (slimes().length !== K.S('slime.maxAlive', 10)) fail('there should be ' + K.S('slime.maxAlive', 10) + ' slimes at the start, not ' + slimes().length);
  for (const k of knights()) if (Math.hypot(k.fx - W.w / 2, k.fy - W.h / 2) > K.S('knight.spawnRadiusTiles', 6) + 9) fail('knights should start in the middle of the map');
  if (new Set(knights().map((k) => k.name)).size !== knights().length) fail('knights should have different names');
  const trees0 = W.trees.length;
  for (const t of W.trees.splice(0, 25)) W.blk[t.y * W.w + t.x] = 0;          // 25 trees are gone (smashed)
  let kills = 0, minSlimes = 99, ko = 0;
  const oh = K.combat.hurt;
  K.combat.hurt = function (w, t, ...a) { const r = oh.call(this, w, t, ...a); if (r && t.kind === 'slime' && t.dead) kills++; if (r && t.kind === 'npc' && t.ko) ko++; return r; };
  const t0 = Date.now();
  for (let i = 0; i < 300 * 60; i++) {
    W.t += 1 / 60;
    for (const k of K.npc.all(W)) K.npc.update(W, k, p, 1 / 60);
    K.combat.update(W, 1 / 60, p); K.world.growTrees(W);
    if (i > 30 * 60) minSlimes = Math.min(minSlimes, slimes().length);
    if (i % 600 === 0) for (const b of W.bodies) if (!(b.fx >= 0 && b.fy >= 0 && b.fx <= W.w - 1 && b.fy <= W.h - 1)) fail('body left the world');
  }
  K.combat.hurt = oh;
  if (knights().length !== 10) fail('knights should never be lost, there are ' + knights().length);
  if (kills < 10) fail('the knights should keep defeating slimes (' + kills + ')');
  if (slimes().length < 8) fail('defeated slimes should be replaced (' + slimes().length + ' alive, ' + kills + ' defeated)');
  if (W.trees.length <= trees0 - 25 + 15) fail('trees should grow back at random (' + W.trees.length + ' of ' + trees0 + ')');
  if (W.trees.length > W.treeCap) fail('too many trees');
  for (const t of W.trees) if (!W.blk[t.y * W.w + t.x]) fail('a tree should block its tile');
  console.log('world: 5 minutes with 10 knights and 10 slimes: ' + kills + ' slimes defeated, ' + ko + ' knight knock-outs, ' + slimes().length + ' slimes alive, trees ' + (trees0 - 25) + ' -> ' + W.trees.length + ' (cap ' + W.treeCap + '), simulated in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}

console.log('OK');
