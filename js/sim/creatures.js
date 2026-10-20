// Krowns - animals, monsters and trees that grow back.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const sim = K.sim;
  const S = K.S;
  const { cheb, dist } = K.util;

  const defs = () => Object.values(K.data.creatures);

  function spawnCreature(W, def, x, y) {
    const c = {
      id: W.nextId++, kind: 'creature', type: def.id, def, x, y, face: W.rng() < 0.5 ? 1 : -1, hop: null, path: null, pathGoal: null,
      hearts: def.hearts, maxHearts: def.hearts, speed: def.speed, flies: !!def.flies, phase: W.rng() * 6.28,
      nextAct: W.t + W.rng() * 2, atkT: 0, born: W.t, state: 'wander', goal: null,
    };
    W.creatures.push(c); W.byId.set(c.id, c);
    sim.placeEntity(W, c, x, y);
    return c;
  }

  function randomSpawnTile(W, hostile, def) {
    for (let i = 0; i < 30; i++) {
      const x = W.rng.int(1, W.w - 2), y = W.rng.int(1, W.h - 2);
      if (!sim.tileFree(W, x, y) && !(def.flies && W.blk[y * W.w + x] === 0)) continue;
      if (hostile && sim.kingdomAt(W, x, y)) continue;
      return [x, y];
    }
    return null;
  }

  function spawnUpdate(W) {
    const clock = sim.clockAt(W.t);
    const night = sim.isNightHour(clock.hour);
    if (W.creatures.length >= S('world.animalMax', 28)) return;
    const pool = defs().filter((d) => !d.nightOnly || night);
    const def = W.rng.weighted(pool, (d) => d.weight);
    if (!def) return;
    const tile = randomSpawnTile(W, def.behavior === 'Hostile', def);
    if (!tile) return;
    spawnCreature(W, def, tile[0], tile[1]);
  }

  function nearestUnit(W, c, r, test) {
    let best = null, bd = r + 0.001;
    for (const e of sim.near(W, c.x, c.y, r, (o) => o.kind === 'unit' && (!test || test(o)))) {
      const d = dist(c.x, c.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function wanderStep(W, c, radius) {
    if (!c.goal || W.t > c.goalUntil || cheb(c.x, c.y, c.goal[0], c.goal[1]) <= 0) {
      const gx = clampW(W, c.x + W.rng.int(-radius, radius), 'w'), gy = clampW(W, c.y + W.rng.int(-radius, radius), 'h');
      c.goal = [gx, gy]; c.goalUntil = W.t + W.rng.range(4, 9);
      c.pause = W.t + W.rng.range(0.5, 3);
    }
    if (W.t < c.pause) return;
    const r = sim.moveTo(W, c, c.goal[0], c.goal[1], 0, false);
    if (r !== 'moving') c.goal = null;
  }
  const clampW = (W, v, ax) => Math.max(1, Math.min((ax === 'w' ? W.w : W.h) - 2, v));

  function updateCreature(W, c, dt) {
    if (sim.advanceHop(c, dt)) return;
    const def = c.def;
    const clock = sim.clockAt(W.t);
    if (def.nightOnly && !sim.isNightHour(clock.hour)) {
      // bats go home when the sun comes up
      c.leaveT = (c.leaveT || 0) + dt;
      if (c.leaveT > 4) { sim.die(W, c, null, 'despawn'); c.dead = true; return; }
    }
    const aggro = def.nightOnly ? 6 : S('fight.creatureAggroRadius', 3);
    if (def.behavior === 'Hostile') {
      const tgt = nearestUnit(W, c, aggro, (o) => !o.dead);
      if (tgt) {
        c.state = 'hunt'; c.target = tgt.id;
        const r = sim.moveTo(W, c, tgt.x, tgt.y, 1, true);
        if (cheb(c.x, c.y, tgt.x, tgt.y) <= 1) {
          c.atkT -= dt;
          if (c.atkT <= 0) {
            c.atkT = S('fight.attackIntervalSeconds', 0.5);
            sim.damage(W, tgt, def.dps * S('fight.attackIntervalSeconds', 0.5), c, 'creature');
            if (def.status && W.rng() < def.statusChance) sim.applyStatus(W, tgt, def.status);
            c.attackAnimT = W.t;
          }
        }
        return;
      }
      c.state = 'wander';
      wanderStep(W, c, def.flies ? 7 : 5);
      return;
    }
    // prey
    const threat = nearestUnit(W, c, def.id === 'rat' ? 2 : 3, (o) => !o.dead);
    if (threat && (c.hurtBy || W.rng() < 0.6)) {
      c.state = 'flee';
      const gx = clampW(W, c.x + Math.sign(c.x - threat.x) * 6 + W.rng.int(-2, 2), 'w'), gy = clampW(W, c.y + Math.sign(c.y - threat.y) * 6 + W.rng.int(-2, 2), 'h');
      sim.moveTo(W, c, gx, gy, 0, true);
      return;
    }
    if (def.id === 'rat') {
      // rats sneak to the nearest kingdom chest and nibble
      if (!c.chest || !W.structures.has(c.chest)) {
        c.chest = 0; let bd = 20;
        for (const k of W.kingdoms.values()) {
          const s = W.structures.get(k.chestId); if (!s) continue;
          const d = dist(c.x, c.y, s.x, s.y); if (d < bd) { bd = d; c.chest = s.id; }
        }
      }
      const s = c.chest && W.structures.get(c.chest);
      if (s) {
        const r = sim.moveTo(W, c, s.x, s.y, 1, false);
        if (cheb(c.x, c.y, s.x, s.y) <= 1) {
          c.state = 'raid';
          c.nibbleT = (c.nibbleT || 0) + dt;
          if (c.nibbleT >= 3) {
            c.nibbleT = 0;
            const k = W.kingdoms.get(s.kingdom);
            if (k && k.chest.food >= 0.5) { k.chest.food = K.util.one(k.chest.food - 0.5); c.ate = (c.ate || 0) + 1; sim.emit(W, 'ratNibble', { k: k.id }); }
          }
          if (c.ate > 4) { c.chest = 0; c.ate = 0; c.state = 'wander'; }
        }
        return;
      }
    }
    wanderStep(W, c, 4);
  }

  function creaturesUpdate(W, dt) {
    for (const c of W.creatures) if (!c.dead) updateCreature(W, c, dt);
    if (W.creatures.some((c) => c.dead)) W.creatures = W.creatures.filter((c) => !c.dead);
  }

  // ------------------------------------------------------------------ trees grow back, everywhere
  function treeUpdate(W) {
    const max = Math.floor(S('world.treeMaxDensity', 0.11) * W.w * W.h);
    if (W.trees.size >= max) return;
    for (let i = 0; i < 12; i++) {
      const x = W.rng.int(0, W.w - 1), y = W.rng.int(0, W.h - 1);
      if (!sim.tileFree(W, x, y)) continue;
      // keep walkways around buildings clear
      let nearStruct = false;
      for (let dy = -1; dy <= 1 && !nearStruct; dy++) for (let dx = -1; dx <= 1; dx++) if (sim.inb(W, x + dx, y + dy) && W.occ[(y + dy) * W.w + (x + dx)] > 0) { nearStruct = true; break; }
      if (nearStruct) continue;
      sim.addTree(W, x, y);
      sim.emit(W, 'treeGrew', { x, y });
      return;
    }
  }

  Object.assign(sim, { spawnCreature, spawnUpdate, creaturesUpdate, treeUpdate, nearestUnit });
})();
