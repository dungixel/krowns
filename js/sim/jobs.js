// Krowns - what each job does while working.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const sim = K.sim;
  const S = K.S;
  const { cheb, dist, clamp } = K.util;
  const TICK = sim.TICK;
  const A = sim.ai;
  const { goto, gotoStruct, nearStruct, kingdomSpot, chestOf, castleOf, kingOf, kOf, maybeSay } = A;

  const blocked = (u, secs) => { u.blockedUntil = u.task ? u.task.t0 + secs : 0; };

  // ------------------------------------------------------------------ farmer
  TICK.farm = (W, u, t, dt) => {
    const k = kOf(W, u);
    if (!k) return false;
    if (!t.spot) {
      t.spot = kingdomSpot(W, k, 3, 7);
      if (!t.spot) return false;
      t.end = W.t + W.rng.range(20, 35); t.acc = 0;
    }
    if (W.t > t.end) return false;
    if (!t.at) {
      const r = goto(W, u, t.spot[0], t.spot[1], 0, false);
      if (r === 'arrived') t.at = true; else if (r === 'stuck') return false;
      return true;
    }
    u.act = 'work';
    const cycle = A.awakeSeconds() / S('farmer.foodPerDay', 15);
    t.acc += dt * sim.workMult(W, u);
    if (t.acc >= cycle) {
      t.acc -= cycle;
      const f = W.families.get(u.family);
      const h = A.houseOf(W, u);
      // the family eats first, the rest goes to the kingdom chest
      if (f && h && f.stock < f.members.size * 2) f.stock++;
      else k.chest.food += 1;
      k.deeds.fed++; u.stats.food++;
      sim.gainEV(u);
    }
    return true;
  };

  // ------------------------------------------------------------------ axeman
  function findTree(W, u, k) {
    const ch = chestOf(W, k);
    const cx = ch ? ch.x : u.x, cy = ch ? ch.y : u.y;
    const R = Math.floor(k.radius) + 6;
    let best = null, bd = 1e9;
    for (let y = Math.max(0, cy - R); y <= Math.min(W.h - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(W.w - 1, cx + R); x++) {
      const tr = W.trees.get(y * W.w + x);
      if (!tr || (tr.taken && tr.taken !== u.id && W.t < tr.takenUntil)) continue;
      const d = Math.abs(x - u.x) + Math.abs(y - u.y);
      if (d < bd) { bd = d; best = tr; }
    }
    return best;
  }
  TICK.chop = (W, u, t, dt) => {
    const k = kOf(W, u);
    const ch = k && chestOf(W, k);
    if (!k || !ch) return false;
    if (t.carry) {
      const r = gotoStruct(W, u, ch, false);
      if (nearStruct(u, ch)) {
        k.chest.wood += t.carry; u.stats.wood = (u.stats.wood || 0) + t.carry; sim.gainEV(u);
        return false;
      }
      if (r === 'stuck') return false;
      return true;
    }
    if (!t.tree) {
      t.tree = findTree(W, u, k);
      if (!t.tree) { blocked(u, 10); return false; }
      t.tree.taken = u.id; t.tree.takenUntil = W.t + 40;
    }
    const tr = t.tree;
    if (!W.trees.has(tr.y * W.w + tr.x)) { t.tree = null; return W.t - t.t0 < 30; }
    if (!t.at) {
      const r = goto(W, u, tr.x, tr.y, 1, false);
      if (r === 'arrived') { t.at = true; t.acc = 0; u.face = tr.x >= u.x ? 1 : -1; } else if (r === 'stuck') { tr.taken = 0; t.tree = null; blocked(u, 4); return false; }
      return true;
    }
    u.act = 'work';
    t.acc += dt * sim.workMult(W, u);
    if (!t.said && t.acc > 1) { t.said = true; maybeSay(W, u, 'chop', 0.4, 0); }
    if (t.acc >= S('axeman.chopSeconds', 4)) {
      sim.removeTree(W, tr.x, tr.y);
      sim.emit(W, 'treeChopped', { x: tr.x, y: tr.y });
      t.carry = S('axeman.woodPerTree', 3);
    }
    return true;
  };

  // ------------------------------------------------------------------ hunter
  TICK.hunt = (W, u, t, dt) => {
    const k = kOf(W, u);
    const ch = k && chestOf(W, k);
    if (W.t - t.t0 > 90) return false;
    if (t.carry) {
      if (t.own || !ch) { u.hunger = Math.min(sim.hungerMax(), u.hunger + t.carry * 1.5); maybeSay(W, u, 'eat', 0.6, 0); return false; }
      gotoStruct(W, u, ch, false);
      if (nearStruct(u, ch)) { k.chest.food += t.carry; k.deeds.fed += t.carry; sim.gainEV(u); return false; }
      return true;
    }
    let tgt = t.target && W.byId.get(t.target);
    if (!tgt || tgt.dead) {
      if (t.target && tgt && tgt.dead && tgt.hurtBy === u.id) { t.carry = tgt.def.food; return true; }
      t.target = 0;
      const R = S('hunter.huntRadius', 16);
      const list = sim.near(W, u.x, u.y, R, (e) => e.kind === 'creature' && e.def.behavior === 'Prey' && !e.dead && e.def.food > 0);
      if (!list.length) { blocked(u, 10); return false; }
      list.sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y));
      tgt = list[0]; t.target = tgt.id;
      maybeSay(W, u, 'hunt', 0.4, 0);
    }
    A.fightStep(W, u, tgt, dt);
    if (tgt.dead && tgt.hurtBy === u.id) t.carry = tgt.def.food;
    return true;
  };

  // ------------------------------------------------------------------ merchant
  TICK.trade = (W, u, t, dt) => {
    const k = kOf(W, u);
    const ch = k && chestOf(W, k);
    if (!k || !ch) return false;
    if (W.t - t.t0 > 160) return false;
    if (!t.phase) {
      let best = null, bd = 1e9;
      for (const o of W.kingdoms.values()) {
        if (o === k || (k.war && k.war.id === (o.war && o.war.id))) continue;
        const d = dist(k.cx, k.cy, o.cx, o.cy);
        if (d < bd) { bd = d; best = o; }
      }
      t.other = best ? best.id : 0;
      if (best) { const c = chestOf(W, best); t.dest = [c.x, c.y]; }
      else {
        const a = W.rng() * Math.PI * 2, r = W.rng.range(18, 26);
        t.dest = [clamp(Math.round(k.cx + Math.cos(a) * r), 2, W.w - 3), clamp(Math.round(k.cy + Math.sin(a) * r), 2, W.h - 3)];
      }
      t.phase = 'out';
    }
    if (t.phase === 'out') {
      const r = goto(W, u, t.dest[0], t.dest[1], 2, false);
      if (r === 'arrived') { t.phase = 'wait'; t.wait = W.t + 3; maybeSay(W, u, 'trade', 0.8, 1); }
      else if (r === 'stuck') t.phase = 'back';
      return true;
    }
    if (t.phase === 'wait') { u.act = 'work'; if (W.t > t.wait) t.phase = 'back'; return true; }
    gotoStruct(W, u, ch, false);
    if (nearStruct(u, ch)) {
      const g = t.other ? S('merchant.goldPerTrip', 3) : S('merchant.goldPerTripAlone', 1);
      k.chest.gold += g; u.stats.gold += g; k.deeds.gold += g; sim.gainEV(u);
      return false;
    }
    return true;
  };

  // ------------------------------------------------------------------ blacksmith (and helpers): build and repair
  TICK.build = (W, u, t, dt) => {
    const k = kOf(W, u);
    if (!k) return false;
    const smith = u.job === 'blacksmith';
    if (!t.struct || !W.structures.has(t.struct)) {
      let best = null, bd = 1e9;
      for (const s of W.structures.values()) {
        if (s.kingdom !== k.id) continue;
        const wants = s.building || (smith && s.type !== 'kingdom_chest' && s.hearts < s.maxHearts);
        if (!wants) continue;
        const d = dist(u.x, u.y, s.x, s.y) - (s.building ? 6 : 0);
        if (d < bd) { bd = d; best = s; }
      }
      if (!best) { blocked(u, 6); return false; }
      t.struct = best.id;
    }
    const s = W.structures.get(t.struct);
    gotoStruct(W, u, s, false);
    if (!nearStruct(u, s)) return W.t - t.t0 < 40;
    u.act = 'work';
    u.face = s.x + s.w / 2 >= u.x ? 1 : -1;
    if (s.building) {
      s.progress += dt * (smith ? S('build.blacksmithSpeed', 1) : S('build.otherSpeed', 0.4)) * sim.workMult(W, u);
      s.hearts = Math.max(1, s.maxHearts * (s.progress / s.buildSeconds));
      t.sayT = (t.sayT || 0) + dt;
      if (t.sayT > 6) { t.sayT = 0; maybeSay(W, u, 'build', 0.5, 0); }
      if (s.progress >= s.buildSeconds) { s.progress = s.buildSeconds; sim.finishBuilding(W, s); u.stats.built++; sim.gainEV(u, 1); return false; }
    } else if (s.hearts < s.maxHearts) {
      s.hearts = Math.min(s.maxHearts, s.hearts + S('repair.heartsPerSecond', 1) * dt * sim.workMult(W, u));
      t.rep = (t.rep || 0) + dt;
      if (t.rep > 10) { t.rep = 0; sim.gainEV(u); }
    } else return false;
    return true;
  };

  // ------------------------------------------------------------------ bard: plays music in the street
  TICK.busk = (W, u, t, dt) => {
    const k = kOf(W, u);
    if (!k) return false;
    if (!t.spot) {
      const th = W.structures.get(k.theaterId);
      const spots = th && !th.building ? sim.theaterFront(W, th, 6) : null;
      t.spot = spots && spots.length ? W.rng.pick(spots) : kingdomSpot(W, k, 2, 6);
      if (!t.spot) return false;
      t.end = W.t + W.rng.range(18, 32); t.next = W.t + 3;
    }
    if (W.t > t.end) { sim.gainEV(u); return false; }
    if (!t.at) {
      const r = goto(W, u, t.spot[0], t.spot[1], 0, false);
      if (r === 'arrived') t.at = true; else if (r === 'stuck') return false;
      return true;
    }
    u.act = 'perform';
    if (W.t > t.next) { t.next = W.t + W.rng.range(5, 9); sim.say(W, u, K.line(W.rng, 'music'), 0); u.cheerUntil = W.t + 0.8; }
    return true;
  };
  TICK.perform = (W, u, t, dt) => {
    if (W.t > t.until) return false;
    const s = W.structures.get(t.struct);
    if (!s) return false;
    if (!t.at) {
      const r = goto(W, u, t.spot[0], t.spot[1], 0, false);
      if (r === 'arrived' || r === 'stuck') { t.at = true; t.next = W.t + 0.5; }
      return true;
    }
    u.act = 'perform'; u.face = s.x + s.w / 2 >= u.x ? 1 : -1;
    if (W.t > t.next) {
      t.next = W.t + W.rng.range(3.5, 6);
      sim.say(W, u, u.job === 'joker' ? K.line(W.rng, 'joke') : K.line(W.rng, 'music'), 1);
      u.cheerUntil = W.t + 0.9;
    }
    return true;
  };
  TICK.watchPlay = (W, u, t, dt) => {
    if (W.t > t.until) return false;
    const s = W.structures.get(t.struct);
    if (!s) return false;
    if (!t.at) {
      const r = goto(W, u, t.spot[0], t.spot[1], 0, false);
      if (r === 'arrived' || r === 'stuck') { t.at = true; t.next = W.t + W.rng.range(1, 5); }
      return true;
    }
    u.face = s.x + s.w / 2 >= u.x ? 1 : -1;
    if (W.t > t.next) {
      t.next = W.t + W.rng.range(4, 8);
      if (W.rng() < 0.35) { sim.say(W, u, K.line(W.rng, t.cheer || 'play_like'), 0); u.cheerUntil = W.t + 0.8; }
    }
    return true;
  };

  // ------------------------------------------------------------------ mage
  TICK.heal = (W, u, t, dt) => {
    if (!t.end) { t.end = W.t + W.rng.range(10, 20); }
    if (W.t > t.end) return false;
    const range = S('status.healRange', 5);
    const needy = sim.near(W, u.x, u.y, 18, (e) => e.kind === 'unit' && !e.dead && (e.hearts < sim.maxHearts(e) * 0.7 || e.status) && (e.kingdom === u.kingdom || !e.kingdom));
    if (needy.length) {
      needy.sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y));
      const tg = needy[0];
      if (cheb(u.x, u.y, tg.x, tg.y) > range) { goto(W, u, tg.x, tg.y, range - 1, true); return true; }
      t.cd = (t.cd || 0) - dt;
      if (t.cd <= 0 && !u.hop) {
        t.cd = S('status.healCooldownSeconds', 2.5);
        sim.say(W, u, K.line(W.rng, 'heal'), 1);
        sim.healUnit(W, u, tg);
        u.shot = { x: tg.x, y: tg.y, t: W.t, job: 'heal' };
        u.cheerUntil = W.t + 0.5;
        t.end = W.t + 12;
      }
      return true;
    }
    return TICK.patrol(W, u, t, dt);
  };

  // ------------------------------------------------------------------ knights, archers, witches: patrol the kingdom
  TICK.patrol = (W, u, t, dt) => {
    const k = kOf(W, u);
    if (!t.end) { t.end = W.t + W.rng.range(10, 20); t.goal = null; }
    if (W.t > t.end) return false;
    if (!t.goal) {
      t.goal = k ? kingdomSpot(W, k, 2, k.radius * 0.95) : A.wanderGoal(W, u);
      if (!t.goal) return false;
      t.arrived = false;
    }
    if (t.arrived) { if (W.t >= t.pause) { t.goal = null; sim.gainEV(u, 0.1); } return true; }
    const r = goto(W, u, t.goal[0], t.goal[1], 0, false);
    if (r !== 'moving') { t.arrived = true; t.pause = W.t + W.rng.range(1.5, 4); maybeSay(W, u, 'idle', 0.05, 0); }
    return true;
  };

  // ------------------------------------------------------------------ joker: stays by the king, makes him laugh, brings him rumors
  TICK.joke = (W, u, t, dt) => {
    const k = kOf(W, u), king = kingOf(W, k);
    if (!k || !king || king.dead) return false;
    if (!t.end) { t.end = W.t + W.rng.range(12, 20); t.nextJoke = W.t + W.rng.range(3, 8); t.mode = 'follow'; }
    if (W.t > t.end) return false;
    const fd = S('joker.followDistance', 3);
    if (t.mode === 'gather') {
      const src = t.src && W.byId.get(t.src);
      if (!src || src.dead || W.t - t.modeT > 20) { t.mode = 'follow'; return true; }
      if (cheb(u.x, u.y, src.x, src.y) > 2) { goto(W, u, src.x, src.y, 1, false); return true; }
      for (const x of src.rumors) sim.learnRumor(W, u, x.r);
      sim.say(W, u, K.line(W.rng, 'rumor_repeat', sim.rumorVars(src.rumors[0] ? src.rumors[0].r : { whoName: '?', what: '', day: 1, time: '' })), 0);
      t.mode = 'tell'; t.modeT = W.t; return true;
    }
    if (t.mode === 'tell') {
      if (W.t - t.modeT > 25) { t.mode = 'follow'; return true; }
      if (cheb(u.x, u.y, king.x, king.y) > 2) { goto(W, u, king.x, king.y, 2, false); return true; }
      if (W.rng() < S('joker.tellKingChance', 0.8)) for (const x of u.rumors) if (x.r.kind === 'crime' && !k.rumors.some((y) => y.id === x.r.id)) { sim.say(W, u, K.line(W.rng, 'rumor_king', sim.rumorVars(x.r)), 2); sim.kingHears(W, k, x.r, u); break; }
      t.mode = 'follow'; t.next = W.t + 20; return true;
    }
    if (cheb(u.x, u.y, king.x, king.y) > fd) goto(W, u, king.x, king.y, fd - 1, false);
    else {
      if (W.t > t.nextJoke) { t.nextJoke = W.t + W.rng.range(12, 22); if (sim.isTalking(W, king) || true) { sim.say(W, u, K.line(W.rng, 'joke'), 1); u.cheerUntil = W.t + 0.9; } }
      u.face = king.x >= u.x ? 1 : -1;
    }
    // jokers like rumors
    if (W.t > (t.next || 0) && t.mode === 'follow') {
      t.next = W.t + 18;
      const src = sim.near(W, u.x, u.y, 14, (e) => e.kind === 'unit' && e !== u && e.rumors.some((x) => !sim.knows(u, x.r)))[0];
      if (src) { t.mode = 'gather'; t.src = src.id; t.modeT = W.t; }
    }
    return true;
  };

  // ------------------------------------------------------------------ innkeeper: waits near the chest and greets everyone
  TICK.serve = (W, u, t, dt) => {
    const k = kOf(W, u), ch = k && chestOf(W, k);
    if (!k || !ch) return false;
    if (!t.spot) { t.spot = sim.freeTileNear(W, ch.x, ch.y, 3, W.rng, (x, y) => cheb(x, y, ch.x, ch.y) >= 2); t.end = W.t + W.rng.range(14, 24); t.next = W.t + 4; if (!t.spot) return false; }
    if (W.t > t.end) return false;
    if (!t.at) { const r = goto(W, u, t.spot[0], t.spot[1], 0, false); if (r === 'arrived') t.at = true; else if (r === 'stuck') return false; return true; }
    u.act = 'work';
    if (W.t > t.next) {
      t.next = W.t + W.rng.range(6, 12);
      const o = sim.near(W, u.x, u.y, 5, (e) => e.kind === 'unit' && e !== u)[0];
      if (o) sim.say(W, u, K.line(W.rng, 'greet', { other: o.name }), 0);
    }
    return true;
  };

  // ------------------------------------------------------------------ king / prince: stays around the castle
  TICK.rule = (W, u, t, dt) => {
    const k = kOf(W, u), c = k && castleOf(W, k);
    if (!k || !c) return false;
    if (!t.end) { t.end = W.t + W.rng.range(8, 16); t.goal = null; t.next = W.t + W.rng.range(4, 10); }
    if (W.t > t.end) return false;
    if (!t.goal) {
      const R = t.light ? 7 : 4;
      t.goal = sim.freeTileNear(W, c.x + 1 + W.rng.int(-R, R), c.y + 1 + W.rng.int(-R, R), 2, W.rng);
      t.arrived = false;
      if (!t.goal) return false;
    }
    if (!t.arrived) { const r = goto(W, u, t.goal[0], t.goal[1], 0, false); if (r !== 'moving') { t.arrived = true; t.pause = W.t + W.rng.range(2, 6); } return true; }
    if (W.t > t.pause) t.goal = null;
    if (W.t > t.next && !t.light) {
      t.next = W.t + W.rng.range(14, 26);
      const tyrant = u.evilGood <= S('tyrant.evilGoodAtOrBelow', -4);
      sim.say(W, u, K.line(W.rng, tyrant ? 'tyrant' : 'ruler'), 0);
    }
    return true;
  };
})();
