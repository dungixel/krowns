// Krowns - fighting. Three small rules cover everything:
//  1. DODGE: a unit shoots a few tiles in one direction, and while it does, nothing can hurt it. Everybody dodges (the player with Space).
//  2. SLASH: a knight's 90 degree sweep. It hurts every slime it passes over.
//  3. A slime attacks by dodging: it squashes and shakes (the warning), locks its direction, then its dodge is a jump that hurts whoever it touches.
// All numbers are in content/settings.json (groups Combat and Units). Slimes appear every now and then and go for the nearest unit.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const combat = (K.combat = {});
  const DEG = Math.PI / 180;

  // the middle of a body's feet, in tiles
  const cx = (b) => b.fx + 0.5, cy = (b) => b.fy + 0.62;
  combat.dist = (a, b) => Math.hypot(cx(a) - cx(b), cy(a) - cy(b));
  combat.dirTo = (a, b) => { const x = cx(b) - cx(a), y = cy(b) - cy(a), l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

  // how far body `b` is from the path of `from` jumping in direction `dir` for `len` tiles
  combat.laneDistance = function (from, dir, len, b) {
    const px = cx(b) - cx(from), py = cy(b) - cy(from);
    const t = Math.max(0, Math.min(len, px * dir.x + py * dir.y));
    return Math.hypot(px - dir.x * t, py - dir.y * t);
  };

  // ------------------------------------------------------------------ dodging
  combat.canAct = (W, b) => !b.ko && !b.dead && !b.dodge && !b.slash && !b.kb && W.t >= (b.stunUntil || 0);
  combat.canDodge = (W, b) => combat.canAct(W, b) && W.t >= (b.dodgeReady || 0);
  combat.canSlash = (W, b) => combat.canAct(W, b) && W.t >= (b.slashReady || 0);
  combat.vulnerable = (W, b) => !b.dead && !b.ko && W.t >= (b.invulUntil || 0);

  // dodge in direction (dx, dy). Options: distance, seconds, invul, cooldown (all from settings by default), harm: hurts what it touches (the slime jump)
  combat.dodge = function (W, b, dx, dy, o) {
    o = o || {};
    if (!o.force && !combat.canDodge(W, b)) return false;
    const l = Math.hypot(dx, dy);
    if (!l) return false;
    dx /= l; dy /= l;
    const dur = o.seconds || S('dodge.seconds', 0.24);
    b.dodge = { t0: W.t, dur, dx, dy, dist: o.distance || S('dodge.distanceTiles', 2.2), done: 0, harm: !!o.harm, dmg: o.damage || 1, hit: [] };
    b.invulUntil = Math.max(b.invulUntil || 0, W.t + (o.invul === undefined ? S('dodge.invulnerableSeconds', 0.26) : o.invul));
    b.dodgeReady = W.t + dur + (o.cooldown === undefined ? S('dodge.cooldownSeconds', 0.8) : o.cooldown);
    if (Math.abs(dx) > 0.15) b.face = dx > 0 ? 1 : -1;
    b.trail = [];
    return true;
  };

  // ------------------------------------------------------------------ slashing (knights)
  combat.slash = function (W, b, ang) {
    if (!combat.canSlash(W, b)) return false;
    const wind = S('slash.windupSeconds', 0.14), dur = S('slash.seconds', 0.2);
    b.slash = { t0: W.t, ang, wind, dur, hit: [] };
    b.slashFx = { ang, t0: W.t + wind, dur };        // what is drawn (lives a little longer than the slash itself)
    b.slashReady = W.t + wind + dur + S('slash.cooldownSeconds', 0.7);
    if (Math.abs(Math.cos(ang)) > 0.15) b.face = Math.cos(ang) > 0 ? 1 : -1;
    return true;
  };
  // 0..1 how far the visible sweep is (null before it starts or after it ended)
  combat.slashProgress = function (W, b) {
    const s = b.slash;
    if (!s) return null;
    const p = (W.t - s.t0 - s.wind) / s.dur;
    return p < 0 ? null : p;
  };

  // ------------------------------------------------------------------ being hurt
  combat.hurt = function (W, t, dmg, src, kbTiles) {
    if (!combat.vulnerable(W, t)) return false;
    t.hp -= dmg;
    t.invulUntil = W.t + S('hit.invulnerableSeconds', 0.5);
    t.flashUntil = W.t + S('hit.flashSeconds', 0.22);
    t.healAt = W.t + S('unit.healEverySeconds', 10);
    t.slash = null; t.slashFx = null; t.dodge = null; t.atk = null;
    const d = src ? combat.dirTo(src, t) : { x: -t.face, y: 0 };
    t.kb = { t0: W.t, dur: 0.18, dx: d.x, dy: d.y, dist: kbTiles === undefined ? S('hit.knockbackTiles', 0.9) : kbTiles, done: 0 };
    if (t.kind === 'slime') t.stunUntil = W.t + S('slime.stunSeconds', 0.4);
    if (t.hp <= 0) {
      if (t.kind === 'slime') { t.dead = true; t.deadAt = W.t; }
      else { t.ko = true; t.koUntil = W.t + S('unit.knockedOutSeconds', 5); t.bubble = null; }
    }
    return true;
  };

  // ------------------------------------------------------------------ slimes
  combat.spawnSlime = function (W, near) {
    const rng = W.rng, a = rng() * Math.PI * 2, r = rng.range(S('slime.spawnMinTiles', 9), S('slime.spawnMaxTiles', 13));
    const x = Math.max(1, Math.min(W.w - 2, Math.round(near.fx + Math.cos(a) * r))), y = Math.max(1, Math.min(W.h - 2, Math.round(near.fy + Math.sin(a) * r)));
    const [tx, ty] = K.world.freeTileNear(W, x, y, 8);
    const hearts = S('slime.hearts', 3);
    const s = K.world.addBody(W, { kind: 'slime', name: 'Slime', noName: true, color: 1, sprite: 'slime', fx: tx, fy: ty, face: rng() < 0.5 ? -1 : 1, hp: hearts, maxHp: hearts, ai: { goal: null, until: W.t + rng.range(1, 3) } });
    return s;
  };

  function slimeAI(W, s, dt) {
    if (s.dead) return;
    if (s.dodge || s.kb) return;
    if (W.t < (s.stunUntil || 0)) { K.world.moveBody(W, s, 0, 0, dt, 1); return; }
    const a = s.atk, rng = W.rng;
    if (a && a.state === 'wind') {                                 // squashing and shaking: the warning
      K.world.moveBody(W, s, 0, 0, dt, 1);
      if (W.t < a.lockAt) { a.dir = combat.dirTo(s, a.target); if (Math.abs(a.dir.x) > 0.15) s.face = a.dir.x > 0 ? 1 : -1; }
      if (W.t >= a.until) {                                         // the jump is a dodge that hurts
        const sec = S('slime.lungeSeconds', 0.26);
        combat.dodge(W, s, a.dir.x, a.dir.y, { force: true, harm: true, damage: S('slime.damage', 1), distance: S('slime.lungeDistanceTiles', 2.8), seconds: sec, invul: sec + 0.02, cooldown: 0 });
        s.atk = { state: 'lunge' };
        s.cd = W.t + sec + S('slime.cooldownSeconds', 1.8);
      }
      return;
    }
    if (a && a.state === 'lunge') { if (!s.dodge) s.atk = null; return; }
    // the nearest unit is the target
    let tgt = null, td = 1e9;
    for (const b of W.bodies) {
      if (b.kind === 'slime' || b.ko || b.dead) continue;
      const d = combat.dist(s, b);
      if (d < td) { td = d; tgt = b; }
    }
    const speed = S('slime.walkTilesPerSecond', 0.9);
    if (tgt && td <= S('slime.senseTiles', 12)) {
      if (td <= S('slime.lungeRangeTiles', 2.6) && W.t >= (s.cd || 0)) {
        const w = S('slime.windupSeconds', 0.55);
        s.atk = { state: 'wind', target: tgt, t0: W.t, until: W.t + w, lockAt: W.t + w - S('slime.aimLockSeconds', 0.15), dir: combat.dirTo(s, tgt) };
      } else if (td > 0.9) K.world.moveBody(W, s, cx(tgt) - cx(s), cy(tgt) - cy(s), dt, speed);
      else K.world.moveBody(W, s, 0, 0, dt, 1);
    } else {                                                           // nobody near: creeps around
      const ai = s.ai;
      if (!ai.goal) {
        K.world.moveBody(W, s, 0, 0, dt, 1);
        if (W.t >= ai.until) { const ang = rng() * Math.PI * 2, r = rng.range(1.5, 4); ai.goal = [s.fx + Math.cos(ang) * r, s.fy + Math.sin(ang) * r]; ai.until = W.t + 5; }
      } else {
        const gx = ai.goal[0] - s.fx, gy = ai.goal[1] - s.fy;
        const moved = K.world.moveBody(W, s, gx, gy, dt, speed * 0.7);
        if (Math.hypot(gx, gy) < 0.25 || W.t >= ai.until || moved < 1e-4) { ai.goal = null; ai.until = W.t + rng.range(2, 6); }
      }
    }
  }

  // ------------------------------------------------------------------ every frame
  function stopHopping(b) { b.moving = false; b.walkP = 0; b.walkPhase = Math.round(b.walkPhase); }

  combat.update = function (W, dt, player) {
    const rng = W.rng;
    // slimes show up every now and then, a little way off
    const c = W.combat || (W.combat = { nextSpawn: W.t + S('slime.firstSpawnSeconds', 6) });
    if (player && W.t >= c.nextSpawn) {
      c.nextSpawn = W.t + rng.range(S('slime.spawnMinSeconds', 18), S('slime.spawnMaxSeconds', 35));
      if (W.bodies.filter((b) => b.kind === 'slime' && !b.dead).length < S('slime.maxAlive', 3)) combat.spawnSlime(W, player);
    }
    for (const b of W.bodies) if (b.kind === 'slime') slimeAI(W, b, dt);

    for (const b of W.bodies) {
      // knocked out units wake up
      if (b.ko && W.t >= b.koUntil) { b.ko = false; b.hp = Math.ceil(b.maxHp * 0.6); b.invulUntil = W.t + 1; b.healAt = W.t + S('unit.healEverySeconds', 10); }
      // hearts come back slowly
      if (!b.dead && !b.ko && b.maxHp && b.kind !== 'slime' && b.hp < b.maxHp && W.t >= (b.healAt || 0)) { b.hp++; b.healAt = W.t + S('unit.healEverySeconds', 10); }
      // dodge: slide, and a hurting dodge (the slime jump) hits whoever it touches
      const d = b.dodge;
      if (d) {
        const want = Math.min(1, (W.t - d.t0) / d.dur) * d.dist, step = want - d.done;
        K.world.slideBody(W, b, d.dx, d.dy, step); d.done = want; stopHopping(b);
        (b.trail = b.trail || []).push({ fx: b.fx, fy: b.fy, t: W.t, face: b.face }); if (b.trail.length > 12) b.trail.shift();
        if (d.harm) for (const o of W.bodies) {
          if (o === b || o.kind === b.kind || d.hit.includes(o)) continue;
          if (combat.dist(b, o) <= S('slime.hitRadiusTiles', 0.65) && combat.hurt(W, o, d.dmg, b)) d.hit.push(o);
        }
        if (W.t >= d.t0 + d.dur) { b.dodge = null; b.dodgeEnded = W.t; }
      }
      // being pushed back
      const k = b.kb;
      if (k) {
        const want = Math.min(1, (W.t - k.t0) / k.dur) * k.dist, step = want - k.done;
        K.world.slideBody(W, b, k.dx, k.dy, step); k.done = want; stopHopping(b);
        if (W.t >= k.t0 + k.dur) b.kb = null;
      }
      // the slash: hurts every slime the sweep has passed over
      const s = b.slash;
      if (s) {
        const p = combat.slashProgress(W, b);
        if (p !== null) {
          const half = S('slash.arcDegrees', 90) * DEG / 2, head = -half + 2 * half * Math.min(1, p);
          for (const e of W.bodies) {
            if (e.kind !== 'slime' || e.dead || s.hit.includes(e)) continue;
            if (combat.dist(b, e) > S('slash.rangeTiles', 1.35) + 0.25) continue;
            const off = angDiff(Math.atan2(cy(e) - cy(b), cx(e) - cx(b)), s.ang);
            if (Math.abs(off) <= half + 8 * DEG && off <= head + 4 * DEG && combat.hurt(W, e, S('slash.damage', 1), b, S('slash.knockbackTiles', 1.0))) s.hit.push(e);
          }
        }
        if (W.t >= s.t0 + s.wind + s.dur) { b.slash = null; b.slashEnded = W.t; }
      }
    }
    // slimes that died have faded
    if (W.bodies.some((b) => b.dead && W.t - b.deadAt > 0.5)) W.bodies = W.bodies.filter((b) => !(b.dead && W.t - b.deadAt > 0.5));
  };
})();
