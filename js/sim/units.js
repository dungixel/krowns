// Krowns - units: birth, stats (IVs/EVs), needs, damage, status effects and death.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const sim = K.sim;
  const S = K.S;
  const { clamp, step, one } = K.util;

  const IV_KEYS = ['hearts', 'energy', 'evilgood', 'strength', 'longevity'];

  // ------------------------------------------------------------------ IVs, EVs and traits
  function makeIVs(rng, p1, p2) {
    const iv = {};
    for (const k of IV_KEYS) {
      const lo = S('iv.' + k + '.min'), hi = S('iv.' + k + '.max');
      let v;
      if (p1 && p2) {
        const mut = S('iv.' + k + '.mutation', k === 'evilgood' ? 2 : 1);
        v = (p1.iv[k] + p2.iv[k]) / 2 + rng.range(-mut, mut);
      } else if (k === 'evilgood') {
        const sp = S('iv.evilgood.startSpread', 7);
        v = rng.range(-sp, sp);
      } else v = rng.range(lo, hi);
      iv[k] = clamp(step(v), lo, hi);
    }
    return iv;
  }
  function makeEVs(p1, p2) {
    const ev = {};
    if (!p1 || !p2) return ev;
    const share = S('ev.inheritShare', 0.3333);
    const jobs = new Set([...Object.keys(p1.ev), ...Object.keys(p2.ev)]);
    for (const j of jobs) {
      const v = step(share * (((p1.ev[j] || 0) + (p2.ev[j] || 0)) / 2));
      if (v > 0) ev[j] = Math.min(v, S('ev.max', 20));
    }
    return ev;
  }
  function randomTrait(rng) {
    const list = S('traits.list', []);
    return rng.chance(S('trait.theaterLoverChance', 0.15)) ? 'theaterLover' : rng.pick(list);
  }
  function makeTraits(rng, p1, p2) {
    const list = S('traits.list', []);
    if (!p1 || !p2) return rng.shuffle(list.slice()).slice(0, S('traits.startCount', 2));
    const t = new Set();
    if (p1.traits.length) t.add(rng.pick(p1.traits));
    if (p2.traits.length) t.add(rng.pick(p2.traits));
    t.add(randomTrait(rng));
    return [...t];
  }
  const hasTrait = (u, t) => u.traits.indexOf(t) >= 0;

  // ------------------------------------------------------------------ derived values
  const maxHearts = (u) => u.iv.hearts + (hasTrait(u, 'brave') ? S('traits.braveHeartsBonus', 2) : 0);
  const maxEnergy = (u) => u.iv.energy;
  const hungerMax = () => S('hunger.max', 10);
  const ageSeconds = (W, u) => W.t - u.bornAt;
  const ageDays = (W, u) => ageSeconds(W, u) / sim.dayLength();
  const isAdult = (W, u) => ageDays(W, u) >= S('unit.adultAgeDays', 2);
  const lifespanSeconds = (u) => u.iv.longevity * sim.dayLength();
  const kingdomOf = (W, u) => (u.kingdom ? W.kingdoms.get(u.kingdom) : null);
  const isTyrantKing = (W, k) => { const ki = k && W.byId.get(k.king); return !!ki && ki.evilGood <= S('tyrant.evilGoodAtOrBelow', -4); };
  const underTyrant = (W, u) => isTyrantKing(W, kingdomOf(W, u));
  function displayJob(u) {
    if (u.female) {
      for (const j of K.jobList) if (j.variantOf === u.job) return j.id;
    }
    return u.job;
  }
  function workMult(W, u) {
    let m = 1 + (u.ev[u.job] || 0) * S('ev.effectPerPoint', 0.03);
    if (hasTrait(u, 'hardworker')) m *= S('traits.hardworkerMultiplier', 1.1);
    if (underTyrant(W, u) && u.job !== 'king') m *= S('tyrant.workMultiplier', 1.25);
    return m;
  }
  function gainEV(u, amount) {
    const mx = S('ev.max', 20);
    u.ev[u.job] = Math.min(mx, one((u.ev[u.job] || 0) + (amount === undefined ? S('ev.perWorkCycle', 0.5) : amount)));
  }
  function addGood(u, d) { u.evilGood = clamp(one(u.evilGood + d), -10, 10); }
  const isFighterUnit = (u) => K.isFighter(u.job);
  const damageOf = (W, u) => {
    const j = K.job(u.job);
    let d = j.dps * S('fight.attackIntervalSeconds', 0.5) * (1 + u.iv.strength * S('fight.strengthEffect', 0.1));
    if (u.energy < S('fight.lowEnergyBelow', 3)) d *= S('fight.lowEnergyMultiplier', 0.5);
    if (u.evilGood < 0) d *= 1 + (-u.evilGood) * S('evil.damagePerPoint', 0.04);       // being evil makes you hit harder
    return d;
  };

  // ------------------------------------------------------------------ the pocket: every unit can carry a few things (food, wood, gold)
  const pocketCount = (u) => { let n = 0; for (const k in u.pocket) n += u.pocket[k]; return n; };
  const pocketRoom = (u) => Math.max(0, S('pocket.capacity', 6) - pocketCount(u));
  function pocketAdd(u, kind, n) {
    const add = Math.min(n, pocketRoom(u));
    if (add > 0) u.pocket[kind] = K.util.one((u.pocket[kind] || 0) + add);
    return add;
  }

  // ------------------------------------------------------------------ creating units
  // opts: x,y,job,parents[],ageDays,female,kingdom
  function createUnit(W, o) {
    const rng = W.rng;
    const p1 = o.parents && o.parents[0], p2 = o.parents && o.parents[1];
    const u = {
      id: W.nextId++, kind: 'unit', name: K.names.takeName(W.namer, new Set(W.units.map((x) => x.name))),
      female: o.female !== undefined ? o.female : rng.chance(0.5),
      x: o.x, y: o.y, face: rng.chance(0.5) ? 1 : -1, hop: null, path: null, pathGoal: null,
      job: o.job || 'villager', ev: makeEVs(p1, p2), iv: makeIVs(rng, p1, p2), traits: makeTraits(rng, p1, p2),
      kingdom: o.kingdom || 0, family: 0, parents: o.parents ? o.parents.map((p) => p.id) : [], children: [],
      pocket: {}, status: null, statusT: 0, task: null, thinkAt: W.t + rng() * 0.5, bubble: null, talkUntil: 0,
      rumors: [], rumorSaid: 0, learn: { job: null, progress: 0 }, grudge: 0, hurtAt: -99, hurtBy: 0,
      stats: { kills: 0, defended: 0, gold: 0, food: 0, plays: 0, built: 0 }, color: rng.int(1, 12), phase: rng() * 6.28,
      sleeping: false, lying: false, refusedUntil: 0, born: o.ageDays === undefined,
      bornAt: W.t - (o.ageDays === undefined ? 0 : o.ageDays) * sim.dayLength(),
    };
    u.evilGood = u.iv.evilgood;
    u.hearts = maxHearts(u);
    u.energy = maxEnergy(u);
    u.hunger = o.hunger !== undefined ? o.hunger : hungerMax() * rng.range(0.6, 1);
    u.deathAge = lifespanSeconds(u) * rng.range(1, 1.15);
    W.units.push(u); W.byId.set(u.id, u);
    (W.nameInfo = W.nameInfo || new Map()).set(u.name, { id: u.id, color: u.color });
    sim.placeEntity(W, u, o.x, o.y);
    // everyone starts as their own family
    sim.newFamily(W, u);
    return u;
  }

  function setJob(W, u, job, quiet) {
    if (u.job === job) return;
    u.job = job; u.task = null; u.thinkAt = 0;
    u.learn = { job: null, progress: 0 };
    if (!quiet) { const jn = K.job(displayJob(u)).name.toLowerCase(); sim.log(W, u.name + ' became ' + (/^[aeiou]/.test(jn) ? 'an ' : 'a ') + jn + '.', [u.id]); }
    sim.emit(W, 'job', { id: u.id, job });
  }

  // ------------------------------------------------------------------ damage, healing, status
  function damage(W, e, amount, src, how) {
    if (e.dead || amount <= 0) return;
    e.hearts -= amount;
    e.hurtAt = W.t; e.hurtBy = src ? src.id : 0;
    e.flashT = W.t;
    if (e.kind === 'unit' && e.hearts > 0 && W.rng() < 0.12) sim.say(W, e, K.line(W.rng, 'hit'), 0);
    if (e.hearts <= 0) die(W, e, src, how || 'fight');
  }
  function applyStatus(W, e, type) {
    if (e.dead || e.status === type || e.kind !== 'unit') return;
    e.status = type; e.statusT = 0;
    sim.say(W, e, K.line(W.rng, type), 1);
  }
  function healUnit(W, healer, t) {
    if (t.dead) return;
    t.hearts = Math.min(maxHearts(t), t.hearts + S('status.healAmount', 1.5));
    t.status = null;
    healer.stats.healed = (healer.stats.healed || 0) + 1;
    gainEV(healer);
    if (healer !== t && W.rng() < 0.6) sim.say(W, t, K.line(W.rng, 'thanks'), 0);
  }

  function die(W, e, src, how) {
    if (e.dead) return;
    e.dead = true; e.diedAt = W.t;
    sim.removeEntityFromGrid(W, e);
    W.byId.delete(e.id);
    if (e.kind === 'creature') { W.stats.creaturesKilled = (W.stats.creaturesKilled || 0) + 1; sim.emit(W, 'creatureDied', { id: e.id }); return; }
    W.stats.died++;
    const cause = how === 'age' ? 'of old age' : how === 'hunger' ? 'of hunger' : how === 'status' ? 'of sickness' : src ? 'in a fight' : 'suddenly';
    sim.log(W, e.name + ' died ' + cause + '.', [e.id]);
    W.tombstones.push({ x: e.x, y: e.y, name: e.name, t: W.t, until: W.t + S('death.tombstoneDays', 1) * sim.dayLength(), job: e.job });
    sim.emit(W, 'death', { id: e.id, x: e.x, y: e.y });
    if (sim.onDeath) sim.onDeath(W, e, src, how);
  }

  // ------------------------------------------------------------------ per-step needs and status
  function updateNeeds(W, u, dt) {
    const working = u.task && u.task.work;
    const sleeping = u.sleeping;
    let hDrain = S('hunger.drainPerSecond', 0.03);
    if (working) hDrain *= S('hunger.actionMultiplier', 1.6);
    if (sleeping) hDrain *= 0.5;
    if (hasTrait(u, 'glutton')) hDrain *= S('traits.gluttonDrainMultiplier', 1.2);
    if (underTyrant(W, u)) hDrain *= S('tyrant.drainMultiplier', 1.25);
    const evilPerk = u.evilGood <= S('evil.perkAtOrBelow', -4) ? S('evil.drainMultiplier', 0.85) : 1;      // evil units tire and hunger a bit slower
    hDrain *= evilPerk;
    u.hunger = Math.max(0, u.hunger - hDrain * dt);

    if (sleeping || u.fainted) {
      u.energy = Math.min(maxEnergy(u), u.energy + S('energy.sleepRegenPerSecond', 0.3) * dt);
    } else {
      let eDrain = S('energy.drainPerSecond', 0.05);
      if (working) eDrain *= S('energy.actionMultiplier', 1.5);
      if (hasTrait(u, 'sleepy')) eDrain *= S('traits.sleepyDrainMultiplier', 1.2);
      if (underTyrant(W, u)) eDrain *= S('tyrant.drainMultiplier', 1.25);
      eDrain *= evilPerk;
      u.energy = Math.max(0, u.energy - eDrain * dt);
    }

    // moods settle back toward the unit's own nature
    const relax = S('eg.relaxPerDay', 1) / sim.dayLength() * dt;
    if (Math.abs(u.evilGood - u.iv.evilgood) > 0.01) u.evilGood += clamp(u.iv.evilgood - u.evilGood, -relax, relax);

    if (u.hunger <= 0) {
      u.starveAcc = (u.starveAcc || 0) + S('hunger.starveDamagePerSecond', 0.15) * dt;
      if (u.starveAcc >= 0.5) { damage(W, u, u.starveAcc, null, 'hunger'); u.starveAcc = 0; }
    } else if (u.hearts < maxHearts(u) && !u.status && u.hunger > 2) {
      u.hearts = Math.min(maxHearts(u), u.hearts + S('heal.passivePerSecond', 0.04) * dt * (sleeping ? S('heal.sleepMultiplier', 2) : 1));
    }

    if (u.status) {
      u.statusT += dt;
      if (u.statusT >= S('status.dotIntervalSeconds', 2)) {
        u.statusT = 0;
        const minH = S('status.minHearts', 1);
        if (u.hearts > minH) u.hearts = Math.max(minH, u.hearts - S('status.dotHearts', 1));
        if (u.hearts <= minH) u.status = null;              // auto-heal at the last heart
      }
    }
    if (W.t - u.bornAt >= u.deathAge) die(W, u, null, 'age');
  }

  Object.assign(sim, {
    IV_KEYS, createUnit, setJob, makeIVs, hasTrait, maxHearts, maxEnergy, hungerMax, ageSeconds, ageDays, isAdult, lifespanSeconds,
    kingdomOf, isTyrantKing, underTyrant, displayJob, workMult, gainEV, addGood, isFighterUnit, damageOf, damage, applyStatus, healUnit,
    die, updateNeeds, pocketCount, pocketRoom, pocketAdd,
  });
})();
