// Krowns - the one neighbour: Tero the farmer. He strolls around and says the sentences YOU pick (the panel at the bottom left, see main.js).
// (His whole personality comes later.)
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const npc = (K.npc = {});

  npc.create = function (W, player) {
    const rng = W.rng;
    const [tx, ty] = K.world.freeTileNear(W, Math.round(player.fx) + 6, Math.round(player.fy) + 2, 12);
    const b = K.world.addBody(W, { kind: 'npc', name: S('npc.name', 'Tero'), job: S('npc.job', 'farmer'), color: rng.int(1, 12), sprite: S('npc.sprite', 'farmer'), fx: tx, fy: ty, face: -1, voice: K.voice.npcVoice() });
    b.speaker = true;                                              // the one you talk to: he stays near you so you can hear him
    b.ai = { mode: 'idle', until: W.t + rng.range(1, 3), goal: null };
    return b;
  };

  // the other knights: they have a name and a colour, wander, hunt slimes and fight like Tero (they do not talk). Tero is one of knight.count.
  npc.populate = function (W, player, tero) {
    const rng = W.rng, names = new Set([tero.name, player.name]);
    for (let i = 1; i < S('knight.count', 10); i++) {
      let name = K.names.make(rng); for (let k = 0; k < 20 && names.has(name); k++) name = K.names.make(rng);
      names.add(name);
      const a = rng() * Math.PI * 2, r = rng.range(1.5, S('knight.spawnRadiusTiles', 6));                          // they start in the middle of the map
      const [tx, ty] = K.world.freeTileNear(W, Math.round(W.w / 2 + Math.cos(a) * r), Math.round(W.h / 2 + Math.sin(a) * r), 8);
      const b = K.world.addBody(W, { kind: 'npc', name, job: 'knight', color: rng.int(1, 12), sprite: 'knight', fx: tx, fy: ty, face: rng() < 0.5 ? -1 : 1 });
      b.ai = { mode: 'idle', until: W.t + rng.range(0.5, 3), goal: null };
    }
  };
  npc.all = (W) => W.bodies.filter((b) => b.kind === 'npc');

  // say a sentence: mood is neutral, happy, sad or angry (changes the melody of the voice and how fast he talks)
  npc.say = function (W, b, text, mood) {
    const cps = S('bubble.charsPerSecond', 14) * K.voice.moodSpeed(mood);
    b.bubble = { text, mood, cps, plan: K.voice.plan(text, mood), t0: W.t, dur: text.length / cps + S('bubble.lingerSeconds', 2.2), lines: null, shown: -1 };
    b.talkUntil = b.bubble.t0 + text.length / cps;
    b.ai.mode = 'talk'; b.ai.until = b.bubble.t0 + b.bubble.dur;
  };
  // say sentence number i of content/speech.json (the same one again whenever you like)
  npc.sayLine = function (W, b, i) {
    const l = K.lines()[i];
    if (l) npc.say(W, b, l.text, l.mood);
  };

  // ------------------------------------------------------------------ fighting (he is a knight)
  // He only dodges when there is a reason: a slime is winding up and its jump would really hit him (he sees the warning and dodges
  // sideways just before the jump). Otherwise he walks. A slash is a 90 degree sweep at the nearest slime.
  const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
  const free = (W, b, vx, vy, dist) => !K.world.blocked(W, b.fx + vx * dist, b.fy + vy * dist) && !K.world.blocked(W, b.fx + vx * dist * 0.5, b.fy + vy * dist * 0.5);
  // dodge in one of the given directions, the first one that is not blocked by a tree
  function dodgeAny(W, b, dirs) {
    const dist = S('dodge.distanceTiles', 2.2);
    for (const d of dirs) if (free(W, b, d.x, d.y, dist)) return K.combat.dodge(W, b, d.x, d.y);
    return false;
  }

  // How dangerous is each one for me right now? (a number; the biggest is dealt with first)
  //  - a slime: a little, more the closer it is, a lot when its jump is about to land on me
  //  - you (only once you have attacked him): more the closer you are and the more you hit him, a lot when your slash is coming at him,
  //    a bonus when you are nearly defeated (easy to finish) - all scaled by knight.playerThreat
  function threatOf(W, b, who, sense) {
    const C = K.combat, d = C.dist(b, who), prox = Math.max(0, 1 - d / sense);
    if (who.kind === 'slime') {
      let t = 0.6 + prox;
      const a = who.atk;
      if (a && a.state === 'wind' && a.dir && C.laneDistance(who, a.dir, S('slime.lungeDistanceTiles', 2.8), b) <= S('slime.hitRadiusTiles', 0.65) + 0.3) t += 1.5;
      return t;
    }
    let t = 0.9 + 1.2 * prox + Math.min(1, (b.grudge ? b.grudge.hits : 0) / 3) * 0.6;
    if (who.slash && d <= S('slash.rangeTiles', 1.35) + 0.6) t += 1.5;
    if (who.hp <= 1) t += 0.8;
    return t * S('knight.playerThreat', 1);
  }

  // the player's slash is coming at me: dodge it (only if it would really hit, with a reaction time, and not always)
  function dodgePlayerSlash(W, b, p, cb) {
    const C = K.combat, s = p.slash;
    if (!s) { cb.ps = null; return false; }
    const half = S('slash.arcDegrees', 90) * Math.PI / 360;
    let off = Math.atan2(cy(b) - cy(p), cx(b) - cx(p)) - s.ang;
    while (off > Math.PI) off -= 2 * Math.PI; while (off < -Math.PI) off += 2 * Math.PI;
    if (C.dist(b, p) > S('slash.rangeTiles', 1.35) + 0.3 || Math.abs(off) > half + 0.2) { return false; }       // it would miss me anyway
    if (!cb.ps || cb.ps.s !== s) cb.ps = { s, at: s.t0 + W.rng.range(S('knight.reactionMinSeconds', 0.09), S('knight.reactionMaxSeconds', 0.2)), skilled: W.rng() < S('knight.dodgeSkillVsPlayer', 0.7) };
    if (!cb.ps.skilled || W.t < cb.ps.at || !C.canDodge(W, b)) return false;
    cb.ps = { s, at: 1e9, skilled: false };
    const away = C.dirTo(p, b), n = { x: -away.y, y: away.x }, side = off >= 0 ? 1 : -1;
    const sd = { x: n.x * side, y: n.y * side }, od = { x: -sd.x, y: -sd.y };
    return dodgeAny(W, b, [away, norm(away.x + sd.x, away.y + sd.y), norm(away.x + od.x, away.y + od.y), sd, od]);
  }

  function fight(W, b, dt, player) {
    const C = K.combat, rng = W.rng;
    if (b.ko || b.dead) { K.world.moveBody(W, b, 0, 0, dt, 1); return true; }
    if (b.dodge || b.kb) return true;
    if (b.slash) { K.world.moveBody(W, b, 0, 0, dt, 1); return true; }
    const sense = S('knight.senseTiles', 9);
    const slimes = [], foes = [];
    for (const s of W.bodies) {
      if (s.kind !== 'slime' || s.dead || C.dist(b, s) > sense) continue;
      slimes.push(s); foes.push(s);
    }
    const angry = C.angry(W, b) && player && !player.dead && !player.ko;
    if (angry && C.dist(b, player) <= sense * 1.25) foes.push(player);
    if (!foes.length) { b.cb = null; return false; }
    const cb = b.cb || (b.cb = { seen: new Map(), nextTac: 0, mode: 'close', strafe: 1, tgt: null, nextPick: 0 });
    if (b.ai.mode === 'talk') { b.ai.mode = 'idle'; b.ai.until = W.t + 2; }

    // 0. you are swinging at me: dodge it if it would hit
    if (angry && dodgePlayerSlash(W, b, player, cb)) return true;

    // 1. a slime is winding up and its jump will pass close to me: dodge sideways just before it jumps
    for (const s of slimes) {
      const a = s.atk;
      if (!a || a.state !== 'wind') { cb.seen.delete(s); continue; }
      const len = S('slime.lungeDistanceTiles', 2.8);
      if (C.laneDistance(s, a.dir, len, b) > S('slime.hitRadiusTiles', 0.65) + 0.3) { cb.seen.delete(s); continue; }      // the jump would miss me anyway
      let m = cb.seen.get(s);
      // he reacts a moment before the jump, never before the slime has chosen its direction (so the dodge is not wasted)
      if (!m) { m = { at: Math.max(a.lockAt, a.until - rng.range(S('knight.reactionMinSeconds', 0.09), S('knight.reactionMaxSeconds', 0.2))), skilled: rng() < S('knight.dodgeSkill', 0.9) }; cb.seen.set(s, m); }
      if (m.skilled && W.t >= m.at && C.canDodge(W, b)) {
        const n = { x: -a.dir.y, y: a.dir.x }, side = ((cx(b) - cx(s)) * n.x + (cy(b) - cy(s)) * n.y) >= 0 ? 1 : -1;
        const sx = { x: n.x * side, y: n.y * side }, ox = { x: -sx.x, y: -sx.y };
        cb.seen.delete(s);
        if (dodgeAny(W, b, [sx, ox, norm(sx.x - a.dir.x, sx.y - a.dir.y), norm(ox.x - a.dir.x, ox.y - a.dir.y), { x: -a.dir.x, y: -a.dir.y }])) return true;
      }
    }

    // 2. decide who to deal with first: the biggest threat. He sticks with his choice unless another one is clearly worse (no flip-flopping).
    if (W.t >= cb.nextPick || !foes.includes(cb.tgt)) {
      cb.nextPick = W.t + 0.3;
      let best = null, bs = -1, cur = foes.includes(cb.tgt) ? threatOf(W, b, cb.tgt, sense) : -1;
      for (const f of foes) { const t = threatOf(W, b, f, sense); if (t > bs) { bs = t; best = f; } }
      if (cur < 0 || bs > cur * 1.2) cb.tgt = best;
      b.target = cb.tgt;                                                       // (readable by tests)
    }
    const tgt = cb.tgt, td = C.dist(b, tgt);
    const to = C.dirTo(b, tgt);
    const face = () => { if (Math.abs(to.x) > 0.15) b.face = to.x > 0 ? 1 : -1; };

    // 3. close enough and ready: slash (not at somebody who cannot be hurt right now: mid-jump, or just hit)
    if (td <= S('slash.rangeTiles', 1.35) * 0.9 && C.canSlash(W, b) && !tgt.dodge && C.vulnerable(W, tgt)) {
      face();
      if (C.slash(W, b, Math.atan2(to.y, to.x))) return true;
    }
    // 4. tactics, chosen every half second or so
    if (W.t >= cb.nextTac) {
      cb.nextTac = W.t + rng.range(0.35, 0.8);
      cb.strafe = rng() < 0.5 ? 1 : -1;
      cb.mode = td > 2.2 || W.t >= (b.slashReady || 0) ? 'close' : 'strafe';
    }
    const speed = S('npc.combatTilesPerSecond', 2.6);
    if (cb.mode === 'strafe' || (td < 1.0 && !C.canSlash(W, b))) {                          // circle around it while the slash is not ready
      const tang = { x: -to.y * cb.strafe, y: to.x * cb.strafe };
      const push = td < 1.5 ? -0.7 : td > 2.1 ? 0.5 : 0;
      K.world.moveBody(W, b, tang.x + to.x * push, tang.y + to.y * push, dt, speed * 0.8);
    } else if (td > 1.0) K.world.moveBody(W, b, to.x, to.y, dt, speed);
    else K.world.moveBody(W, b, 0, 0, dt, 1);
    face();
    return true;
  }
  const cx = (b) => b.fx + 0.5, cy = (b) => b.fy + 0.62;

  npc.update = function (W, b, player, dt) {
    if (fight(W, b, dt, player)) return;
    const a = b.ai, rng = W.rng;
    const dxp = player.fx - b.fx, dyp = player.fy - b.fy;
    // no slime close enough to fight, but one somewhere not too far: go and find it
    const leash = S('npc.leashTiles', 7);
    if (a.mode !== 'talk') {
      // Tero (the one who talks) never goes far from you: he only hunts slimes that are near you, and walks back when he has strayed
      if (b.speaker && Math.hypot(dxp, dyp) > leash + 1) {
        a.mode = 'idle'; a.until = W.t + 0.5;
        const moved = K.world.moveBody(W, b, dxp, dyp, dt, S('npc.huntTilesPerSecond', 2.2));
        if (moved < 1e-4) K.world.moveBody(W, b, -dyp, dxp, dt, S('npc.huntTilesPerSecond', 2.2));
        return;
      }
      let prey = null, pd = S('knight.huntTiles', 14);
      for (const s of W.bodies) { if (s.kind !== 'slime' || s.dead) continue; if (b.speaker && K.combat.dist(player, s) > leash) continue; const d = K.combat.dist(b, s); if (d < pd) { pd = d; prey = s; } }
      if (prey) {
        a.mode = 'hunt';
        const to = K.combat.dirTo(b, prey);
        const moved = K.world.moveBody(W, b, to.x, to.y, dt, S('npc.huntTilesPerSecond', 2.2));
        if (moved < 1e-4) K.world.moveBody(W, b, -to.y, to.x, dt, S('npc.huntTilesPerSecond', 2.2));       // a tree in the way: slide along it
        return;
      }
      if (a.mode === 'hunt') { a.mode = 'idle'; a.until = W.t + rng.range(1, 3); }
    }
    if (a.mode === 'talk') {                           // stands still and looks at whoever is near
      if (Math.abs(dxp) > 0.5) b.face = dxp > 0 ? 1 : -1;
      K.world.moveBody(W, b, 0, 0, dt, 1);
      if (W.t >= a.until) { b.bubble = null; a.mode = 'idle'; a.until = W.t + rng.range(2, 5); }
      return;
    }
    if (a.mode === 'idle') {
      K.world.moveBody(W, b, 0, 0, dt, 1);
      if (W.t >= a.until) {
        const ang = rng() * Math.PI * 2, r = rng.range(1.5, 4);
        a.goal = [b.fx + Math.cos(ang) * r, b.fy + Math.sin(ang) * r]; a.mode = 'walk'; a.until = W.t + 4;
      }
    } else if (a.mode === 'walk') {
      const gx = a.goal[0] - b.fx, gy = a.goal[1] - b.fy;
      const moved = K.world.moveBody(W, b, gx, gy, dt, S('npc.walkTilesPerSecond', 1.3));
      if (Math.hypot(gx, gy) < 0.25 || W.t >= a.until || moved < 1e-4) { a.mode = 'idle'; a.until = W.t + rng.range(2, 6); }
    }
  };
})();
