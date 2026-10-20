// Krowns - what units decide to do. A unit always has a task; the task with the highest priority wins.
//   95 faint · 90 fighting / fleeing · 88 war · 85 sleep · 80 starving · 70 eat · 60-65 events (petition, report, mourn, plays)
//   50 job work · 40 social · 30 learn · 10 wander
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const sim = K.sim;
  const S = K.S;
  const { cheb, dist, clamp } = K.util;
  const TICK = (sim.TICK = {});

  // ------------------------------------------------------------------ small helpers
  const rnd = (W) => W.rng;
  const kOf = (W, u) => (u.kingdom ? W.kingdoms.get(u.kingdom) : null);
  const chestOf = (W, k) => (k ? W.structures.get(k.chestId) : null);
  const castleOf = (W, k) => (k ? W.structures.get(k.castleId) : null);
  const houseOf = (W, u) => { const f = W.families.get(u.family); const h = f && f.houseId && W.structures.get(f.houseId); return h && !h.building ? h : null; };
  const kingOf = (W, k) => (k ? W.byId.get(k.king) : null);
  function goto(W, u, x, y, range, run) {
    const r = sim.moveTo(W, u, x, y, range, run);
    if (r === 'stuck') { u.stuck = (u.stuck || 0) + 1; } else u.stuck = 0;
    return r;
  }
  function gotoStruct(W, u, s, run) { const c = sim.structCenter(s); return goto(W, u, c.x, c.y, sim.structRange(s), run); }
  const nearStruct = (u, s) => { const c = sim.structCenter(s); return cheb(u.x, u.y, c.x, c.y) <= sim.structRange(s); };
  function awakeSeconds() { const a = S('time.sleepEndHour', 6), b = S('time.sleepStartHour', 21); return sim.dayLength() * ((b - a) / 24); }
  const canFightUnit = (W, u) => sim.isAdult(W, u) && (sim.isFighterUnit(u) || u.job === 'hunter' || sim.hasTrait(u, 'brave'));
  function maybeSay(W, u, cat, p, prio, vars) { if (W.rng() < p) sim.say(W, u, K.line(W.rng, cat, vars), prio || 0); }

  // a free tile in the kingdom around the castle, between r0 and r1 tiles
  function kingdomSpot(W, k, r0, r1) {
    for (let i = 0; i < 25; i++) {
      const a = W.rng() * Math.PI * 2, r = W.rng.range(r0, r1);
      const x = Math.round(k.cx + Math.cos(a) * r), y = Math.round(k.cy + Math.sin(a) * r);
      if (sim.tileFree(W, x, y) && sim.kingdomAt(W, x, y) === k.id) return [x, y];
    }
    return null;
  }
  function wanderGoal(W, u) {
    const k = kOf(W, u);
    if (k) {
      const out = W.rng() < 0.08;
      if (out) {
        const a = W.rng() * Math.PI * 2, r = k.radius + W.rng.range(2, 8);
        return [clamp(Math.round(k.cx + Math.cos(a) * r), 1, W.w - 2), clamp(Math.round(k.cy + Math.sin(a) * r), 1, W.h - 2)];
      }
      return kingdomSpot(W, k, 1, k.radius * 0.85) || [u.x, u.y];
    }
    // kingdomless: drift toward jobless friends so they can gather and found a kingdom
    let sx = 0, sy = 0, n = 0;
    for (const o of sim.near(W, u.x, u.y, 14, (e) => e.kind === 'unit' && !e.kingdom && e.job === 'villager' && sim.isAdult(W, e))) { sx += o.x; sy += o.y; n++; }
    const cx = n > 1 && W.rng() < 0.6 ? sx / n : u.x, cy = n > 1 && W.rng() < 0.6 ? sy / n : u.y;
    return [clamp(Math.round(cx + W.rng.int(-3, 3)), 1, W.w - 2), clamp(Math.round(cy + W.rng.int(-3, 3)), 1, W.h - 2)];
  }

  // ------------------------------------------------------------------ choosing a task
  function threat(W, u) {
    if (W.t - (u.threatCheck || 0) < 0.45) return null;
    u.threatCheck = W.t;
    const adult = sim.isAdult(W, u);
    const fighterish = canFightUnit(W, u);
    const k = kOf(W, u);
    const fighters = k ? sim.counts(W, k).fighters || 0 : 0;
    const civJoin = adult && k && fighters <= S('fight.civiliansJoinWhenFightersAtOrBelow', 1);
    const R = fighterish ? S('fight.watchRadius', 10) : S('fight.creatureAggroRadius', 3) + 2;
    const hostiles = sim.near(W, u.x, u.y, R, (e) => e.kind === 'creature' && e.def.behavior === 'Hostile' && !e.dead);
    if (hostiles.length) {
      hostiles.sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y));
      const h = hostiles[0];
      // fighters only run to creatures that are near their kingdom or near themselves
      const close = dist(u.x, u.y, h.x, h.y) <= 5 || (k && sim.inKingdom(W, k, h.x, h.y)) || fighterish && !k;
      if ((fighterish || civJoin) && close) return { type: 'attack', prio: 90, target: h.id, mode: 'kill', reason: 'creature', until: W.t + 25 };
      if (dist(u.x, u.y, h.x, h.y) <= S('fight.creatureAggroRadius', 3) + 1 && !sim.hasTrait(u, 'brave')) return { type: 'flee', prio: 90, from: h.id, until: W.t + 5 };
    }
    // rats nibbling at the chest
    if (adult && k && (!u.task || u.task.prio < 60)) {
      const ch = chestOf(W, k);
      if (ch) {
        const rats = sim.near(W, ch.x, ch.y, 2.5, (e) => e.kind === 'creature' && e.type === 'rat' && e.state === 'raid');
        if (rats.length && cheb(u.x, u.y, ch.x, ch.y) < 9) {
          maybeSay(W, u, 'raid', 0.5, 1);
          return { type: 'attack', prio: 90, target: rats[0].id, mode: 'kill', reason: 'creature', until: W.t + 15 };
        }
      }
    }
    return null;
  }

  function nextHour(W) { return sim.clockAt(W.t).hour; }

  function food(W, u) {
    const f = W.families.get(u.family);
    if (f && f.stock >= 1 && houseOf(W, u)) return { kind: 'house', struct: houseOf(W, u), fam: f };
    const k = kOf(W, u);
    if (k && k.chest.food >= 1) return { kind: 'chest', struct: chestOf(W, k), k };
    return null;
  }

  function choose(W, u) {
    const hour = nextHour(W);
    const adult = sim.isAdult(W, u);
    if (u.energy <= 0.01) return { type: 'faint', prio: 95 };
    const th = threat(W, u);
    if (th) return th;
    const role = adult && sim.warRole(W, u);
    if (role) return { type: 'war', prio: 88, role: role.role, enemy: role.enemy, war: role.war.id };
    if (sim.isSleepHour(hour) || (u.energy < 1.2 && !sim.isSleepHour(hour) && W.rng() < 0.2)) return { type: 'sleep', prio: 85 };
    // hunger
    if (u.hunger < S('hunger.eatBelow', 4)) {
      if (W.t > (u.hungrySay || 0)) { u.hungrySay = W.t + 25; maybeSay(W, u, 'hungry', 0.6); }
      const fd = food(W, u);
      if (fd) return { type: 'eat', prio: u.hunger <= 1.5 ? 80 : 70, src: fd.kind };
      if (W.t > (u.forageAfter || 0)) return { type: 'forage', prio: u.hunger <= 1.5 ? 80 : 68 };
    }
    if (u.energy < S('fight.lowEnergyBelow', 3) && W.t > (u.tiredSay || 0)) { u.tiredSay = W.t + 40; maybeSay(W, u, 'tired', 0.5); }
    // rumors worth telling the king
    const k = kOf(W, u);
    if (adult && k && u.job !== 'king' && W.t > (u.nextReport || 0)) {
      u.nextReport = W.t + 15 + W.rng() * 20;
      const king = kingOf(W, k);
      const ru = king && u.rumors.find((x) => x.r.kind === 'crime' && !k.rumors.some((y) => y.id === x.r.id) && x.r.who !== u.id);
      if (ru && (W.rng() < 0.25 * (sim.hasTrait(u, 'gossip') ? S('traits.gossipMultiplier', 2) : 1))) return { type: 'report', prio: 60, rumor: ru.r.id };
    }
    // memory of a play
    if (u.playMemory && W.t >= u.playMemory) { u.playMemory = 0; maybeSay(W, u, 'play_memory', 1, 1); }
    if (!adult) return childTask(W, u);
    return workTask(W, u, k) || { type: 'wander', prio: 10 };
  }

  function childTask(W, u) {
    const par = u.parents.map((id) => W.byId.get(id)).filter((p) => p && !p.dead);
    if (par.length && W.rng() < 0.7) return { type: 'follow', prio: 40, target: W.rng.pick(par).id, dist: 3, until: W.t + W.rng.range(8, 16) };
    return { type: 'wander', prio: 10, small: true };
  }

  function workTask(W, u, k) {
    const job = u.job;
    if (W.t < (u.blockedUntil || 0) && job !== 'villager' && job !== 'king') return { type: 'wander', prio: 10 };
    if (!k) {
      if (job === 'hunter' && u.hunger < 7) return { type: 'hunt', prio: 50, work: true, own: true };
      return { type: 'wander', prio: 10 };
    }
    switch (job) {
      case 'villager': {
        if (!u.learn.job) u.learn.job = pickJobToLearn(W, u, k);
        const helping = [...W.structures.values()].some((s) => s.kingdom === k.id && s.building) && W.rng() < 0.5;
        if (helping) return { type: 'build', prio: 45, work: true };
        return { type: 'learn', prio: 30 };
      }
      case 'farmer': return { type: 'farm', prio: 50, work: true };
      case 'blacksmith': return { type: 'build', prio: 50, work: true };
      case 'bard': return { type: 'busk', prio: 50 };
      case 'merchant': return { type: 'trade', prio: 50, work: true };
      case 'axeman': return { type: 'chop', prio: 50, work: true };
      case 'hunter': return { type: 'hunt', prio: 50, work: true };
      case 'mage': return { type: 'heal', prio: 50 };
      case 'joker': return { type: 'joke', prio: 50 };
      case 'innkeeper': return { type: 'serve', prio: 50 };
      case 'king': return { type: 'rule', prio: 50 };
      case 'prince': return { type: 'rule', prio: 40, light: true };
      default: return { type: 'patrol', prio: 50 };
    }
  }

  // ambition decides which job a jobless citizen wants to learn
  function pickJobToLearn(W, u, k) {
    const c = sim.counts(W, k);
    const pop = c.total;
    const opts = K.jobList.filter((j) => {
      if (j.id === 'villager' || j.cls === 'Royalty') return false;
      if (j.id === 'joker' && !(k.king)) return false;
      if (u.evilGood < j.minGood || u.evilGood > j.maxGood) return false;
      if (j.maxPerKingdom && (c[j.id] || 0) >= j.maxPerKingdom) return false;
      return j.ambition > 0;
    });
    const need = (j) => {
      let m = 1;
      const n = c[j.id] || 0;
      if (j.id === 'farmer') m = n === 0 ? 4 : n < pop / 9 ? 1.8 : 0.5;
      if (j.id === 'blacksmith') m = n === 0 ? 3 : 0.5;
      if (j.id === 'axeman') m = n === 0 ? 3 : n < pop / 12 ? 1.2 : 0.5;
      if (j.id === 'hunter') m = k.chest.food < 8 ? 2 : 0.8;
      if (j.cls === 'Fight') m = (c.fighters || 0) < pop / 7 ? 1.8 : 0.7;
      if (j.id === 'bard' && (c.bard || 0) >= 4) m = 0.4;
      if (j.id === 'merchant' && n >= 2) m = 0.3;
      return m;
    };
    const j = W.rng.weighted(opts, (x) => x.ambition * need(x));
    return j ? j.id : null;
  }

  function startTask(W, u, t) {
    u.task = t; t.t0 = W.t;
    u.path = null; u.pathGoal = null;
    if (u.sleeping || u.lying) { u.sleeping = false; u.lying = false; }
  }
  function think(W, u) {
    u.thinkAt = W.t + 0.35 + W.rng() * 0.2;
    const cand = choose(W, u);
    if (!cand) return;
    if (!u.task) return startTask(W, u, cand);
    if (cand.prio > u.task.prio) return startTask(W, u, cand);
    // war ended, sleep over...: tasks end on their own
  }

  // ------------------------------------------------------------------ general tasks
  TICK.wander = (W, u, t, dt) => {
    if (!t.goal) {
      t.goal = wanderGoal(W, u); t.pause = 0; t.end = W.t + W.rng.range(8, 18);
      if (t.small) { const h = houseOf(W, u); if (h) { const c = sim.structCenter(h); t.goal = [Math.round(c.x) + W.rng.int(-4, 4), Math.round(c.y) + W.rng.int(-4, 4)]; t.goal[0] = clamp(t.goal[0], 1, W.w - 2); t.goal[1] = clamp(t.goal[1], 1, W.h - 2); } }
    }
    if (W.t > t.end) return false;
    if (t.arrived) {
      if (W.t >= t.pause) { t.goal = null; if (W.rng() < 0.35) return false; }
      return true;
    }
    const r = goto(W, u, t.goal[0], t.goal[1], 0, false);
    if (r === 'arrived' || r === 'stuck') {
      t.arrived = true; t.pause = W.t + W.rng.range(1, 4.5);
      maybeSay(W, u, 'idle', 0.08, 0);
    }
    return true;
  };

  TICK.follow = (W, u, t, dt) => {
    const tg = W.byId.get(t.target);
    if (!tg || tg.dead || W.t > t.until) return false;
    if (cheb(u.x, u.y, tg.x, tg.y) > t.dist) goto(W, u, tg.x, tg.y, t.dist - 1, false);
    return true;
  };

  TICK.faint = (W, u, t, dt) => {
    u.fainted = true; u.lying = true;
    if (!t.said) { t.said = true; sim.log(W, u.name + ' fainted from exhaustion.', [u.id]); }
    return u.energy < S('energy.faintRecoverTo', 3);
  };

  TICK.jail = (W, u, t, dt) => W.t < t.until;

  TICK.sleep = (W, u, t, dt) => {
    const hour = nextHour(W);
    if (u.hurtAt > W.t - 1.2 && W.t - t.t0 > 1) return false;
    if (!sim.isSleepHour(hour) && u.energy >= sim.maxEnergy(u) * 0.7) return false;
    if (!sim.isSleepHour(hour) && W.t - t.t0 > 70) return false;
    if (!t.spot) {
      const h = houseOf(W, u);
      if (h) { const c = sim.structCenter(h); t.spot = sim.freeTileNear(W, Math.round(c.x), Math.round(c.y), 3, W.rng, (x, y) => cheb(x, y, c.x, c.y) >= sim.structRange(h) - 0.1); }
      if (!t.spot) {
        // sleep close to family, or right here
        const kin = sim.familyUnits(W, W.families.get(u.family)).find((m) => m !== u && m.sleeping);
        t.spot = kin ? sim.freeTileNear(W, kin.x, kin.y, 2, W.rng) : sim.freeTileNear(W, u.x, u.y, 1, W.rng);
      }
      if (!t.spot) t.spot = [u.x, u.y];
    }
    if (!t.in) {
      if (u.x === t.spot[0] && u.y === t.spot[1]) t.in = true;
      else {
        const r = goto(W, u, t.spot[0], t.spot[1], 0, false);
        if (r === 'stuck' || W.t - t.t0 > 14) t.in = true;
        else if (r === 'arrived') t.in = true;
      }
    }
    if (t.in && !u.hop) { u.sleeping = true; u.lying = true; }
    return true;
  };

  TICK.eat = (W, u, t, dt) => {
    if (!t.src || !t.struct) {
      const fd = food(W, u);
      if (!fd) { u.forageAfter = 0; return false; }
      t.src = fd.kind; t.struct = fd.struct.id; t.k = fd.k ? fd.k.id : 0; t.fam = fd.fam ? fd.fam.id : 0;
    }
    const s = W.structures.get(t.struct);
    if (!s) return false;
    const r = gotoStruct(W, u, s, u.hunger <= 1.5);
    if (r === 'stuck') return false;
    if (nearStruct(u, s)) {
      if (t.src === 'house') { const f = W.families.get(t.fam); if (!f || f.stock < 1) return false; f.stock--; }
      else { const k = W.kingdoms.get(t.k); if (!k || k.chest.food < 1) return false; k.chest.food = K.util.one(k.chest.food - 1); }
      let gain = S('hunger.perFood', 3);
      const k = kOf(W, u);
      if (t.src === 'chest' && k && sim.citizens(W, k).some((x) => x.job === 'innkeeper' && dist(x.x, x.y, s.x, s.y) < 7)) gain *= S('innkeeper.foodBonus', 1.2);
      u.hunger = Math.min(sim.hungerMax(), u.hunger + gain);
      maybeSay(W, u, 'eat', 0.6, 0);
      u.cheerUntil = W.t + 0.5;
      return false;
    }
    return true;
  };

  function nearestFruitTree(W, u) {
    let best = null, bd = 1e9;
    const R = 26;
    for (let y = Math.max(0, u.y - R); y <= Math.min(W.h - 1, u.y + R); y++) for (let x = Math.max(0, u.x - R); x <= Math.min(W.w - 1, u.x + R); x++) {
      const tr = W.trees.get(y * W.w + x);
      if (!tr || tr.fruitAt > W.t) continue;
      const d = Math.abs(x - u.x) + Math.abs(y - u.y);
      if (d < bd) { bd = d; best = tr; }
    }
    return best;
  }
  TICK.forage = (W, u, t, dt) => {
    if (!t.tree) {
      const tr = nearestFruitTree(W, u);
      if (!tr) { u.forageAfter = W.t + 15; return false; }
      t.tree = tr;
    }
    const tr = t.tree;
    if (!W.trees.has(tr.y * W.w + tr.x) || tr.fruitAt > W.t) { t.tree = null; return !!(t.retry = (t.retry || 0) + 1 < 3); }
    if (!t.at) {
      const r = goto(W, u, tr.x, tr.y, 1, u.hunger <= 1.5);
      if (r === 'stuck') { u.forageAfter = W.t + 8; return false; }
      if (r === 'arrived') { t.at = W.t; u.face = tr.x >= u.x ? 1 : -1; }
      return true;
    }
    if (W.t - t.at >= S('forage.seconds', 3)) {
      tr.fruitAt = W.t + S('forage.treeCooldownSeconds', 70);
      u.hunger = Math.min(sim.hungerMax(), u.hunger + S('forage.hunger', 2.5));
      maybeSay(W, u, 'eat', 0.5, 0);
      return false;
    }
    return true;
  };

  TICK.flee = (W, u, t, dt) => {
    if (W.t > t.until) return false;
    const from = W.byId.get(t.from);
    if (!from || from.dead) return false;
    if (dist(u.x, u.y, from.x, from.y) > 8) return false;
    const gx = clamp(Math.round(u.x + Math.sign(u.x - from.x) * 6 + W.rng.int(-2, 2)), 1, W.w - 2);
    const gy = clamp(Math.round(u.y + Math.sign(u.y - from.y) * 6 + W.rng.int(-2, 2)), 1, W.h - 2);
    if (!u.hop && (!u.path || !u.path.length)) goto(W, u, gx, gy, 0, true);
    else goto(W, u, gx, gy, 0, true);
    return true;
  };

  TICK.leave = (W, u, t, dt) => {
    if (!t.goal) {
      const k = W.kingdoms.get(t.from);
      const cx = k ? k.cx : u.x, cy = k ? k.cy : u.y, R = (k ? k.radius : 8) + 5, a = W.rng() * Math.PI * 2;
      t.goal = [clamp(Math.round(cx + Math.cos(a) * R), 1, W.w - 2), clamp(Math.round(cy + Math.sin(a) * R), 1, W.h - 2)];
      t.until = W.t + 60;
    }
    if (W.t > t.until) return false;
    const r = goto(W, u, t.goal[0], t.goal[1], 1, false);
    return r === 'moving';
  };

  // ------------------------------------------------------------------ fighting
  function fightStep(W, u, tgt, dt, o) {
    o = o || {};
    const range = K.job(u.job).range || 1;
    const d = cheb(u.x, u.y, tgt.x, tgt.y);
    if (d > range) { goto(W, u, tgt.x, tgt.y, range, true); return 'moving'; }
    u.atkT = (u.atkT || 0) - dt;
    if (tgt.x !== u.x) u.face = tgt.x > u.x ? 1 : -1;
    if (u.atkT > 0 || u.hop) return 'waiting';
    u.atkT = S('fight.attackIntervalSeconds', 0.5);
    let dmg = o.dmg !== undefined ? o.dmg : sim.damageOf(W, u);
    if (o.nonLethal && tgt.kind === 'unit') dmg = Math.max(0, Math.min(dmg, tgt.hearts - 0.5));
    if (tgt.kind === 'structure') { sim.damageStructure(W, tgt, dmg * S('war.structureDamageMultiplier', 1), u); }
    else {
      sim.damage(W, tgt, dmg, u, 'fight');
      if (tgt.kind === 'unit' || tgt.kind === 'creature') {
        if (u.job === 'witch' && W.rng() < S('status.witchPoisonChance', 0.3) && tgt.kind === 'unit') sim.applyStatus(W, tgt, 'poison');
        if (u.job === 'mage' && W.rng() < S('status.mageBurnChance', 0.3) && tgt.kind === 'unit') sim.applyStatus(W, tgt, 'burn');
      }
    }
    u.attackAnimT = W.t;
    if (range > 1.5) u.shot = { x: tgt.x, y: tgt.y, t: W.t, job: u.job };
    u.fightAcc = (u.fightAcc || 0) + 1;
    if (u.fightAcc >= 10) { u.fightAcc = 0; sim.gainEV(u); }
    return 'attacked';
  }

  TICK.attack = (W, u, t, dt) => {
    const tgt = W.byId.get(t.target);
    if (!tgt || tgt.dead || W.t > t.until) { if (t.reason === 'vengeance' && tgt && tgt.dead) sim.addGood(u, 0); return false; }
    if (tgt.kind === 'unit' && tgt.task && tgt.task.type === 'jail') return false;
    if (t.mode === 'yield' && tgt.kind === 'unit' && tgt.hearts <= (t.yieldAt !== undefined ? t.yieldAt : S('crime.arrestHearts', 3))) {
      sim.onDefeat(W, u, tgt, t.reason);
      if (t.reason === 'duel') { sim.log(W, u.name + ' won the duel against ' + tgt.name + '.', [u.id, tgt.id]); if (tgt.task) tgt.task = null; }
      return false;
    }
    if (t.anchor && !t.engaged) {
      if (cheb(u.x, u.y, t.anchor[0], t.anchor[1]) > 3) { goto(W, u, t.anchor[0], t.anchor[1], 2, false); return true; }
      if (cheb(tgt.x, tgt.y, t.anchor[0], t.anchor[1]) > 5) return true;
      t.engaged = true;
    }
    if (t.mode === 'hits') {
      if ((t.done || 0) >= t.hits) return false;
      const r = fightStep(W, u, tgt, dt, { dmg: S('crime.hitDamage', 1), nonLethal: true });
      if (r === 'attacked') { t.done = (t.done || 0) + 1; sim.provoke(W, tgt, u, t.reason); if (tgt.kind === 'unit' && W.rng() < 0.5) sim.say(W, u, K.line(W.rng, 'vengeance', { who: tgt.name }), 1); }
      return true;
    }
    const r = fightStep(W, u, tgt, dt, { nonLethal: t.mode !== 'kill' });
    if (r === 'attacked' && tgt.kind === 'unit' && t.reason !== 'duel') sim.provoke(W, tgt, u, t.reason === 'crime' ? 'crime' : '');
    return true;
  };

  TICK.war = (W, u, t, dt) => {
    const war = W.wars.find((w) => w.id === t.war);
    if (!war) return false;
    const ek = W.kingdoms.get(t.enemy), mk = kOf(W, u);
    if (!ek || !mk) return false;
    const foes = sim.near(W, u.x, u.y, S('fight.watchRadius', 10), (e) => e.kind === 'unit' && e.kingdom === ek.id && sim.isAdult(W, e) && !e.sleeping);
    if (foes.length) {
      foes.sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y));
      const before = foes[0].hearts;
      fightStep(W, u, foes[0], dt);
      return true;
    }
    if (t.role === 'defend') {
      const c = castleOf(W, mk);
      if (c && cheb(u.x, u.y, c.x + 1, c.y + 1) > 7) goto(W, u, c.x + 1, c.y + 1, 5, true);
      else if (!t.wait || W.t > t.wait) { t.wait = W.t + 2; const g = kingdomSpot(W, mk, 2, 8); if (g) goto(W, u, g[0], g[1], 0, false); }
      return true;
    }
    // attackers march to the enemy castle and raid it
    const castle = castleOf(W, ek);
    if (!castle) return false;
    if (!t.target || !W.structures.has(t.target)) {
      const structs = [...W.structures.values()].filter((s) => s.kingdom === ek.id);
      const nonChest = structs.filter((s) => s.type !== 'kingdom_chest');
      t.target = W.rng() < 0.45 ? ek.chestId : (nonChest.length ? W.rng.pick(nonChest).id : castle.id);
      t.raid = 0;
    }
    const s = W.structures.get(t.target);
    if (!s) return true;
    const range = Math.max(K.job(u.job).range || 1, 1);
    const c = sim.structCenter(s);
    if (cheb(u.x, u.y, c.x, c.y) > sim.structRange(s) + range - 1) { gotoStruct(W, u, s, true); return true; }
    if (s.type === 'kingdom_chest') {
      // raid the chest: steal goods
      const take = S('raid.stealPerSecond', 1) * dt;
      let left = take;
      for (const g of ['food', 'wood', 'gold']) {
        if (left <= 0) break;
        const have = ek.chest[g];
        if (have > 0) { const x = Math.min(have, left); ek.chest[g] = Math.max(0, K.util.one(have - x)); war.loot[g] += x; left -= x; }
      }
      t.raid += dt;
      if (t.raid > 6) { t.target = 0; maybeSay(W, u, 'raid', 0.3, 1); }
      u.cheerUntil = W.t + 0.2;
      return true;
    }
    if (s.type === 'house') { const f = W.families.get(s.family); if (f && f.stock > 0) { const x = Math.min(f.stock, 0.5 * dt * 2); f.stock = K.util.one(f.stock - x); war.loot.food += x; } }
    fightStep(W, u, s, dt);
    return true;
  };

  // ------------------------------------------------------------------ talking to the king, rumours
  TICK.report = (W, u, t, dt) => {
    const k = kOf(W, u), king = kingOf(W, k);
    const ru = u.rumors.find((x) => x.r.id === t.rumor);
    if (!k || !king || king.dead || !ru) return false;
    const r = goto(W, u, king.x, king.y, 2, false);
    if (cheb(u.x, u.y, king.x, king.y) <= 2) {
      sim.say(W, u, K.line(W.rng, 'rumor_king', sim.rumorVars(ru.r)), 2);
      sim.kingHears(W, k, ru.r, u);
      return false;
    }
    return r !== 'stuck' && W.t - t.t0 < 40;
  };
  TICK.petition = (W, u, t, dt) => {
    const k = kOf(W, u), king = kingOf(W, k);
    if (!k || !king || W.t > t.until) { if (k) k.petition = null; return false; }
    const r = goto(W, u, king.x, king.y, 2, false);
    if (cheb(u.x, u.y, king.x, king.y) <= 2) { sim.resolvePetition(W, u, t.kind); return false; }
    return r !== 'stuck';
  };
  TICK.mourn = (W, u, t, dt) => {
    if (W.t > t.until) return false;
    if (!t.at) {
      const r = goto(W, u, t.x, t.y, 1, false);
      if (r === 'arrived') { t.at = W.t; u.face = t.x >= u.x ? 1 : -1; sim.say(W, u, K.line(W.rng, 'tomb', { dead: t.dead }), 2); }
      else if (r === 'stuck') return false;
      return true;
    }
    if (W.t - t.at > S('death.mournSeconds', 25)) return false;
    if (!t.said2 && W.t - t.at > 4) { t.said2 = true; sim.say(W, u, K.line(W.rng, 'mourn', { dead: t.dead }) + ' ' + eulogy(W, t), 2); }
    return true;
  };
  function eulogy(W, t) {
    const st = t.stats || {};
    const cat = t.job === 'farmer' ? 'deed_farmer' : K.isFighter(t.job) ? 'deed_fight' : t.job === 'bard' ? 'deed_bard' : t.job === 'merchant' ? 'deed_merchant' : 'deed_other';
    const n = cat === 'deed_fight' ? st.defended || 0 : cat === 'deed_merchant' ? st.gold || 0 : 0;
    return t.dead + ' ' + K.line(W.rng, cat, { n });
  }

  // ------------------------------------------------------------------ learning a job
  function accrueLearning(W, u, dt) {
    if (u.job !== 'villager' || !u.kingdom || !sim.isAdult(W, u) || !u.learn.job) return;
    const k = kOf(W, u);
    if (!k) return;
    let rate = 1;
    let mentor = null;
    for (const o of sim.near(W, u.x, u.y, 4, (e) => e.kind === 'unit' && e.job === u.learn.job && e.kingdom === u.kingdom && sim.isAdult(W, e))) {
      if (sim.related(u, o) || (u.mentorOk === undefined ? (u.mentorOk = W.rng() < S('learn.nonFamilyMentorChance', 0.8)) : u.mentorOk)) { mentor = o; break; }
    }
    if (mentor) {
      rate = S('learn.selfSeconds', 220) / S('learn.mentorSeconds', 90);
      if (W.rng() < 0.01 * dt * 10) sim.say(W, mentor, K.line(W.rng, 'mentor', { other: u.name }), 0);
    }
    u.learn.progress += dt * rate;
    if (u.learn.progress >= S('learn.selfSeconds', 220)) {
      const job = u.learn.job;
      const c = sim.counts(W, k);
      const j = K.job(job);
      if (j.maxPerKingdom && (c[job] || 0) >= j.maxPerKingdom) { u.learn = { job: null, progress: 0 }; return; }
      sim.setJob(W, u, job);
      if (mentor) for (const key of Object.keys(mentor.ev)) if (key === job) u.ev[key] = K.util.step((mentor.ev[key] || 0) * 0.25);
    }
  }
  TICK.learn = (W, u, t, dt) => {
    if (u.job !== 'villager' || !u.learn.job) return false;
    if (!t.end) { t.end = W.t + W.rng.range(10, 20); t.phase = 0; }
    if (W.t > t.end) return false;
    // find a mentor (a worker of that job) and watch them
    if (!t.mentor || W.t > (t.recheck || 0)) {
      t.recheck = W.t + 4;
      const k = kOf(W, u);
      const m = k && sim.citizens(W, k).find((e) => e.job === u.learn.job && sim.isAdult(W, e) && dist(e.x, e.y, u.x, e.y) < 30);
      t.mentor = m ? m.id : 0;
    }
    const m = t.mentor && W.byId.get(t.mentor);
    if (m && !m.dead) {
      if (cheb(u.x, u.y, m.x, m.y) > 3) goto(W, u, m.x, m.y, 2, false);
      if (!t.said && W.rng() < 0.01) { t.said = true; maybeSay(W, u, 'learn', 1, 0, { job: K.job(u.learn.job).name.toLowerCase() }); }
      return true;
    }
    // study alone: wander gently
    if (!t.goal || t.arrived && W.t >= t.pause) { t.goal = wanderGoal(W, u); t.arrived = false; }
    const r = goto(W, u, t.goal[0], t.goal[1], 0, false);
    if (r !== 'moving') { t.arrived = true; t.pause = t.pause || W.t + 2; if (W.t >= t.pause) { t.pause = W.t + W.rng.range(1, 4); t.goal = null; t.arrived = false; } }
    if (!t.said && W.rng() < 0.004) { t.said = true; maybeSay(W, u, 'learn', 1, 0, { job: K.job(u.learn.job).name.toLowerCase() }); }
    return true;
  };

  // ------------------------------------------------------------------ the update of one unit
  function updateUnit(W, u, dt) {
    sim.updateNeeds(W, u, dt);
    if (u.dead) return;
    sim.processReply(W, u);
    sim.advanceHop(u, dt);
    if (!u.task || W.t >= u.thinkAt) think(W, u);
    const t = u.task;
    if (u.job === 'villager' && u.kingdom && !u.sleeping && !u.fainted && (!t || t.prio <= 70)) accrueLearning(W, u, dt);
    u.sleeping = false; u.lying = false; u.fainted = false; u.act = null;
    if (!t) return;
    const fn = TICK[t.type];
    if (!fn) { u.task = null; return; }
    t.work = t.work || false;
    const cont = fn(W, u, t, dt);
    if (cont === false && u.task === t) { u.task = null; u.thinkAt = 0; }
  }

  // ------------------------------------------------------------------ founding a kingdom (once per second)
  function proclaimUpdate(W) {
    const need = S('kingdom.proclaimNeighbors', 5), R = S('kingdom.proclaimRadius', 6);
    for (const u of W.units) {
      if (u.dead || u.kingdom || u.job !== 'villager' || !sim.isAdult(W, u) || u.sleeping || W.t < u.refusedUntil - sim.dayLength() * 0.5) continue;
      if (W.rng() >= S('kingdom.proclaimChancePerSecond', 0.03)) continue;
      let n = 0;
      for (const o of sim.near(W, u.x, u.y, R, (e) => e.kind === 'unit' && !e.kingdom && e.job === 'villager' && sim.isAdult(W, e))) n++;
      if (n >= need && sim.canFoundAt(W, u.x, u.y)) { sim.foundKingdom(W, u); return; }
    }
  }

  sim.ai = { choose, think, updateUnit, proclaimUpdate, fightStep, goto, gotoStruct, nearStruct, kingdomSpot, wanderGoal, houseOf, chestOf, castleOf, kingOf, kOf, maybeSay, awakeSeconds, accrueLearning, startTask };
})();
