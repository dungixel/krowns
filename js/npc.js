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
    b.ai = { mode: 'idle', until: W.t + rng.range(1, 3), goal: null };
    return b;
  };

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
  // He dodges all the time: to close the gap, to get out of the way of a slime jump (he sees the warning and dodges sideways just before
  // the jump), and away after every slash. A slash is a 90 degree sweep at the nearest slime.
  const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
  const free = (W, b, vx, vy, dist) => !K.world.blocked(W, b.fx + vx * dist, b.fy + vy * dist) && !K.world.blocked(W, b.fx + vx * dist * 0.5, b.fy + vy * dist * 0.5);
  // dodge in one of the given directions, the first one that is not blocked by a tree
  function dodgeAny(W, b, dirs) {
    const dist = S('dodge.distanceTiles', 2.2);
    for (const d of dirs) if (free(W, b, d.x, d.y, dist)) return K.combat.dodge(W, b, d.x, d.y);
    return false;
  }
  const rot = (d, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return { x: d.x * c - d.y * s, y: d.x * s + d.y * c }; };

  function fight(W, b, dt) {
    const C = K.combat, rng = W.rng;
    if (b.ko || b.dead) { K.world.moveBody(W, b, 0, 0, dt, 1); return true; }
    if (b.dodge || b.kb) return true;
    if (b.slash) { K.world.moveBody(W, b, 0, 0, dt, 1); return true; }
    const sense = S('knight.senseTiles', 9);
    let tgt = null, td = 1e9;
    const slimes = [];
    for (const s of W.bodies) {
      if (s.kind !== 'slime' || s.dead) continue;
      const d = C.dist(b, s);
      if (d > sense) continue;
      slimes.push(s);
      if (d < td) { td = d; tgt = s; }
    }
    if (!tgt) { b.cb = null; return false; }
    const cb = b.cb || (b.cb = { seen: new Map(), nextTac: 0, mode: 'close', strafe: 1, repos: 0 });
    if (b.ai.mode === 'talk') { b.ai.mode = 'idle'; b.ai.until = W.t + 2; }

    // 1. a slime is winding up and its jump will pass close to me: dodge sideways just before it jumps
    for (const s of slimes) {
      const a = s.atk;
      if (!a || a.state !== 'wind') { cb.seen.delete(s); continue; }
      const len = S('slime.lungeDistanceTiles', 2.8);
      if (C.laneDistance(s, a.dir, len, b) > S('slime.hitRadiusTiles', 0.65) + 0.6) continue;
      let m = cb.seen.get(s);
      if (!m) { m = { at: a.until - rng.range(S('knight.reactionMinSeconds', 0.09), S('knight.reactionMaxSeconds', 0.2)), skilled: rng() < S('knight.dodgeSkill', 0.9) }; cb.seen.set(s, m); }
      if (m.skilled && W.t >= m.at && C.canDodge(W, b)) {
        const n = { x: -a.dir.y, y: a.dir.x }, side = ((cx(b) - cx(s)) * n.x + (cy(b) - cy(s)) * n.y) >= 0 ? 1 : -1;
        const sx = { x: n.x * side, y: n.y * side }, ox = { x: -sx.x, y: -sx.y };
        cb.seen.delete(s);
        if (dodgeAny(W, b, [sx, ox, norm(sx.x - a.dir.x, sx.y - a.dir.y), norm(ox.x - a.dir.x, ox.y - a.dir.y), { x: -a.dir.x, y: -a.dir.y }])) return true;
      }
    }
    const to = C.dirTo(b, tgt);
    const face = () => { if (Math.abs(to.x) > 0.15) b.face = to.x > 0 ? 1 : -1; };

    // 2. hit and run: right after a slash, dodge away
    if (b.slashEnded && cb.repos !== b.slashEnded) {
      cb.repos = b.slashEnded;
      if (rng() < S('knight.dodgeAfterSlash', 0.7) && C.canDodge(W, b)) {
        const s = rng() < 0.5 ? 1 : -1, back = { x: -to.x, y: -to.y };
        if (dodgeAny(W, b, [rot(back, 40 * s), rot(back, -40 * s), back])) return true;
      }
    }
    // 3. close enough and ready: slash (not at a slime that is mid-jump, it cannot be hurt then)
    if (td <= S('slash.rangeTiles', 1.35) * 0.9 && C.canSlash(W, b) && !tgt.dodge) {
      face();
      if (C.slash(W, b, Math.atan2(to.y, to.x))) return true;
    }
    // 4. tactics, chosen every half second or so
    if (W.t >= cb.nextTac) {
      cb.nextTac = W.t + rng.range(0.35, 0.8);
      cb.strafe = rng() < 0.5 ? 1 : -1;
      cb.mode = td > 2.2 || W.t >= (b.slashReady || 0) ? 'close' : 'strafe';
      if (td > S('knight.closeInDodgeTiles', 4) && rng() < 0.5 && C.canDodge(W, b)) {            // dash in
        if (dodgeAny(W, b, [to, rot(to, 30), rot(to, -30)])) return true;
      }
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
    if (fight(W, b, dt)) return;
    const a = b.ai, rng = W.rng;
    const dxp = player.fx - b.fx, dyp = player.fy - b.fy;
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
