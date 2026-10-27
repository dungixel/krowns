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
    // swinging at Tero (even if you miss) makes him treat you as an enemy
    if (b.kind === 'player') for (const e of W.bodies) {
      if (e.kind !== 'npc' || e.dead || e.ko || combat.dist(b, e) > S('slash.rangeTiles', 1.35) + 0.8) continue;
      const to = Math.atan2(cy(e) - cy(b), cx(e) - cx(b));
      if (Math.abs(angDiff(to, ang)) <= S('slash.arcDegrees', 90) * DEG / 2 + 25 * DEG) combat.provoke(W, e, b, 0.3);
    }
    b.slashFx = { ang, t0: W.t + wind, dur };        // what is drawn (lives a little longer than the slash itself)
    b.slashReady = W.t + wind + dur + S('slash.cooldownSeconds', 0.7);
    if (Math.abs(Math.cos(ang)) > 0.15) b.face = Math.cos(ang) > 0 ? 1 : -1;
    return true;
  };
  // who a slash may hurt: slimes (by anyone who is not a slime), Tero (by you, any time), you (by Tero, only while he holds a grudge)
  combat.canHarm = function (W, a, e) {
    if (e === a || e.dead || e.ko || a.kind === 'slime') return false;
    if (e.kind === 'slime') return true;
    if (a.kind === 'player') return e.kind === 'npc';
    return a.kind === 'npc' && e.kind === 'player' && combat.angry(W, a);
  };
  // Tero's grudge against the player: set by an attack, forgotten after knight.grudgeSeconds
  combat.angry = (W, b) => !!(b.grudge && W.t < b.grudge.until);
  combat.provoke = function (W, t, by, weight) {
    if (t.kind !== 'npc' || !by || by.kind !== 'player') return;
    const g = combat.angry(W, t) ? t.grudge : (t.grudge = { hits: 0, until: 0 });
    g.until = W.t + S('knight.grudgeSeconds', 12); g.hits += weight;
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
    const lethal = t.hp <= 0;
    if (src && src.kind === 'player') combat.provoke(W, t, src, 1);
    if (lethal) { defeat(W, t, d); t.grudge = null; if (t.kind === 'player' && src) src.grudge = null; }
    if (combat.onHurt) combat.onHurt(t, src, lethal);
    return true;
  };

  // defeated: the body is flung away like a ragdoll (it tumbles in quarter turns, hops twice), lies there a moment, flickers and disappears.
  // A slime is gone for good. A knight comes back after a few seconds, where it landed, flickering, with some hearts.
  function defeat(W, t, d) {
    const fly = S('defeat.flySeconds', 0.9), rest = S('defeat.restSeconds', 0.35), flick = S('defeat.flickerSeconds', 0.8);
    t.kb = null; t.bubble = null;
    t.rag = { t0: W.t, fly, rest, flick, total: fly + rest + flick, dx: d.x, dy: d.y, dist: S('defeat.flyTiles', 5), done: 0, n: W.rng() < 0.5 ? 9 : 11, sign: d.x >= 0 ? 1 : -1 };
    if (t.kind === 'slime') { t.dead = true; t.deadAt = W.t; }
    else { t.ko = true; t.koUntil = W.t + t.rag.total + S('unit.knockedOutSeconds', 3); }
  }
  // a body flung through the scenery smashes it: trees and grass tufts along its path are flung away too (Dragon Ball), tumbling off and
  // flickering out. Grass grows back after defeat.grassRegrowSeconds, trees after defeat.treeRegrowSeconds (0 = never).
  function distToSegment(px, py, x0, y0, x1, y1) {
    const vx = x1 - x0, vy = y1 - y0, l2 = vx * vx + vy * vy;
    const u = l2 ? Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / l2)) : 0;
    return Math.hypot(px - (x0 + vx * u), py - (y0 + vy * u));
  }
  function fling(W, kind, item, px, py, rg) {
    const rng = W.rng, len = Math.hypot(rg.dx, rg.dy) || 1, a = Math.atan2(rg.dy / len, rg.dx / len) + rng.range(-0.5, 0.5);
    (W.debris = W.debris || []).push({ kind, t0: W.t, dur: S('defeat.flySeconds', 0.9) * 0.7, px, py, dx: Math.cos(a), dy: Math.sin(a), dist: S('defeat.flyTiles', 5) * S('defeat.debrisStrength', 0.3) * 16 * rng.range(0.7, 1.2), n: rng() < 0.5 ? 2 : 3, sign: rng() < 0.5 ? 1 : -1 });
    const secs = S(kind === 'tree' ? 'defeat.treeRegrowSeconds' : 'defeat.grassRegrowSeconds', kind === 'tree' ? 0 : 30);
    if (secs > 0) (W.regrow = W.regrow || []).push({ at: W.t + secs, kind, item });
  }
  function smash(W, b, rg, step) {
    const len = Math.hypot(rg.dx, rg.dy) || 1, x0 = cx(b), y0 = cy(b), x1 = x0 + rg.dx / len * step, y1 = y0 + rg.dy / len * step;
    const rad = S('defeat.smashRadiusTiles', 0.85);
    for (const tr of W.trees.slice()) {
      if (distToSegment(tr.x + 0.5, tr.y + 0.5, x0, y0, x1, y1) > rad) continue;
      W.trees.splice(W.trees.indexOf(tr), 1); W.blk[tr.y * W.w + tr.x] = 0;
      fling(W, 'tree', tr, tr.x * 16 + 8, tr.y * 16 + 16, rg);
    }
    for (const g of W.grass.slice()) {
      if (distToSegment(g.x + (8 + g.ox) / 16, g.y + (8 + g.oy) / 16, x0, y0, x1, y1) > rad * 0.8) continue;
      W.grass.splice(W.grass.indexOf(g), 1);
      fling(W, 'grass', g, g.x * 16 + 8 + g.ox, g.y * 16 + 13 + g.oy, rg);
    }
  }
  // where a flung piece is at time t (game pixels): ground position, height, quarter turns, and whether it is still seen
  combat.debrisPose = function (t, d) {
    const e = t - d.t0, pf = Math.min(1, Math.max(0, e / d.dur)), ease = 1 - (1 - pf) * (1 - pf);
    return { x: d.px + d.dx * d.dist * ease, y: d.py + d.dy * d.dist * ease, z: 8 * 4 * pf * (1 - pf), quarter: Math.floor(d.n * ease) * d.sign, visible: e < d.dur && (pf < 0.75 || Math.floor(e * 16) % 2 === 0) };
  };
  // how a ragdoll looks at time t: z = height in pixels, quarter = turns in 90 degree steps (signed), visible (false while it flickers off or is gone)
  combat.ragPose = function (t, b) {
    const r = b.rag, e = t - r.t0, pf = Math.min(1, Math.max(0, e / r.fly)), ease = 1 - (1 - pf) * (1 - pf);
    let z = 0;
    if (pf < 0.65) { const u = pf / 0.65; z = 18 * 4 * u * (1 - u); } else if (pf < 1) { const u = (pf - 0.65) / 0.35; z = 5 * 4 * u * (1 - u); }
    const flicker = e >= r.fly + r.rest;
    return { z, quarter: Math.floor(r.n * ease) * r.sign, visible: e < r.total && (!flicker || Math.floor((e - r.fly - r.rest) * 14) % 2 === 0), done: e >= r.total };
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
      if (b.ko && W.t >= b.koUntil) { b.ko = false; b.rag = null; b.hidden = false; b.flickerIn = W.t + 0.9; b.hp = Math.ceil(b.maxHp * 0.6); b.invulUntil = W.t + 1.5; b.healAt = W.t + S('unit.healEverySeconds', 10); }
      // a ragdoll flies (fast first, then slower), then lies still
      const rg = b.rag;
      if (rg) {
        const e = W.t - rg.t0, pf = Math.min(1, e / rg.fly), want = (1 - (1 - pf) * (1 - pf)) * rg.dist, step = want - rg.done;
        if (step > 0) { if (S('defeat.smashScenery', 1)) smash(W, b, rg, step); K.world.slideBody(W, b, rg.dx, rg.dy, step); rg.done = want; }
        stopHopping(b);
        if (e >= rg.total) b.hidden = true;
      }
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
      // the slash: hurts everyone it may hurt (see canHarm) that the sweep has passed over
      const s = b.slash;
      if (s) {
        const p = combat.slashProgress(W, b);
        if (p !== null) {
          const half = S('slash.arcDegrees', 90) * DEG / 2, head = -half + 2 * half * Math.min(1, p);
          for (const e of W.bodies) {
            if (s.hit.includes(e) || !combat.canHarm(W, b, e)) continue;
            if (combat.dist(b, e) > S('slash.rangeTiles', 1.35) + 0.25) continue;
            const off = angDiff(Math.atan2(cy(e) - cy(b), cx(e) - cx(b)), s.ang);
            if (Math.abs(off) <= half + 8 * DEG && off <= head + 4 * DEG && combat.hurt(W, e, S('slash.damage', 1), b, S('slash.knockbackTiles', 1.0))) s.hit.push(e);
          }
        }
        if (W.t >= s.t0 + s.wind + s.dur) { b.slash = null; b.slashEnded = W.t; }
      }
    }
    // flung trees and grass: gone when done; they grow back later (a tree only where nobody stands)
    if (W.debris && W.debris.length) W.debris = W.debris.filter((d) => W.t - d.t0 < d.dur);
    if (W.regrow && W.regrow.length) {
      const keep = [];
      for (const r of W.regrow) {
        if (W.t < r.at) { keep.push(r); continue; }
        if (r.kind === 'tree') {
          const x = r.item.x, y = r.item.y;
          if (W.blk[y * W.w + x] || W.bodies.some((o) => !o.dead && Math.hypot(cx(o) - (x + 0.5), cy(o) - (y + 0.5)) < 1.1)) { r.at = W.t + 2; keep.push(r); continue; }
          W.blk[y * W.w + x] = 1; r.item.fade = 1; W.trees.push(r.item);
        } else W.grass.push(r.item);
      }
      W.regrow = keep;
    }
    // slimes that died have faded
    if (W.bodies.some((b) => b.dead && W.t - b.deadAt > (b.rag ? b.rag.total : 0.5))) W.bodies = W.bodies.filter((b) => !(b.dead && W.t - b.deadAt > (b.rag ? b.rag.total : 0.5)));
  };
})();
