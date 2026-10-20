// Krowns - social life: families, pairs, births, rumors, crimes, vengeance, mourning and chatting.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const sim = K.sim;
  const S = K.S;
  const { cheb, dist, clamp } = K.util;

  // ------------------------------------------------------------------ families
  function newFamily(W, u) {
    const f = { id: W.nextId++, members: new Set([u.id]), houseId: 0, kingdom: u.kingdom || 0, stock: 0 };
    W.families.set(f.id, f); u.family = f.id;
    return f;
  }
  function leaveFamily(W, u) {
    const f = W.families.get(u.family);
    if (!f) return;
    f.members.delete(u.id);
    if (!f.members.size) { if (f.houseId) { const h = W.structures.get(f.houseId); if (h) h.family = 0; } W.families.delete(f.id); }
  }
  function joinFamily(W, u, f) {
    if (u.family === f.id) return;
    leaveFamily(W, u);
    f.members.add(u.id); u.family = f.id;
    if (u.kingdom) f.kingdom = f.kingdom || u.kingdom;
  }
  function mergeFamilies(W, a, b) {
    if (a.id === b.id) return a;
    for (const id of b.members) { const m = W.byId.get(id); if (m) m.family = a.id; a.members.add(id); }
    a.stock += b.stock;
    if (!a.houseId && b.houseId) { a.houseId = b.houseId; const h = W.structures.get(b.houseId); if (h) h.family = a.id; }
    else if (b.houseId) { const h = W.structures.get(b.houseId); if (h) sim.destroyStructure(W, h, 'merged'); }
    W.families.delete(b.id);
    return a;
  }
  const familyUnits = (W, f) => { const out = []; if (!f) return out; for (const id of f.members) { const m = W.byId.get(id); if (m && !m.dead) out.push(m); } return out; };
  // kin: parents, children, brothers and sisters (a "family" in the game is a household, not the whole tree)
  function related(a, b) {
    if (a.id === b.id) return true;
    if (a.parents.includes(b.id) || b.parents.includes(a.id)) return true;
    return a.parents.length > 0 && b.parents.length > 0 && a.parents.some((p) => b.parents.includes(p));
  }

  // ------------------------------------------------------------------ pairs and births (once per second)
  function pairUp(W, a, b) {
    const ka = a.kingdom && W.kingdoms.get(a.kingdom), kb = b.kingdom && W.kingdoms.get(b.kingdom);
    if (ka && kb && ka !== kb) return false;
    const k = ka || kb;
    // a new household: the couple (plus any young children of either one)
    const dependents = [];
    for (const x of [a, b]) for (const cid of x.children) { const c = W.byId.get(cid); if (c && !c.dead && !sim.isAdult(W, c)) dependents.push(c); }
    const f = newFamily(W, a);
    for (const m of [b].concat(dependents)) joinFamily(W, m, f);
    // the old household leaves its house empty if nobody remains; the house stays and can be adopted
    a.partner = b.id; b.partner = a.id;
    if (k) { sim.addCitizen(W, k, a); sim.addCitizen(W, k, b); f.kingdom = k.id; }
    sim.say(W, a, K.line(W.rng, 'family', { kid: b.name }), 1);
    sim.log(W, a.name + ' and ' + b.name + ' became a family.', [a.id, b.id]);
    return true;
  }
  function tryBirth(W, mother, father) {
    if (W.units.length >= S('unit.maxPopulation', 120)) return;
    const f = W.families.get(mother.family);
    if (!f) return;
    const kids = mother.children.filter((cid) => { const c = W.byId.get(cid); return !c || c.parents.includes(father.id); }).length;
    if (kids >= S('family.maxChildren', 2)) return;
    const spot = sim.freeTileNear(W, mother.x, mother.y, 3, W.rng);
    if (!spot) return;
    const c = sim.createUnit(W, { x: spot[0], y: spot[1], job: 'villager', parents: [mother, father], ageDays: 0, kingdom: 0 });
    joinFamily(W, c, f);
    mother.children.push(c.id); father.children.push(c.id);
    mother.lastBirth = W.t;
    const k = mother.kingdom && W.kingdoms.get(mother.kingdom);
    if (k) {
      sim.addCitizen(W, k, c);
      const royal = [mother, father].some((p) => p.job === 'king');
      const hasPrince = sim.citizens(W, k).some((x) => x.job === 'prince');
      if (royal && !hasPrince) sim.setJob(W, c, 'prince', true);
    }
    sim.addGood(mother, S('eg.haveKid', 3)); sim.addGood(father, S('eg.haveKid', 3));
    W.stats.born++;
    sim.say(W, mother, K.line(W.rng, 'birth', { kid: c.name }), 2);
    sim.log(W, c.name + ' was born to ' + mother.name + ' and ' + father.name + '.', [c.id]);
    sim.emit(W, 'birth', { id: c.id });
  }
  function familyUpdate(W) {
    const rng = W.rng;
    for (const a of W.units) {
      if (a.dead || a.partner || !sim.isAdult(W, a)) continue;
      if (rng() >= S('family.pairChancePerSecond', 0.01)) continue;
      let best = null, bd = 17;
      for (const b of sim.near(W, a.x, a.y, 16, (o) => o.kind === 'unit' && o !== a && !o.partner && o.female !== a.female && sim.isAdult(W, o) && !related(a, o))) {
        const d = dist(a.x, a.y, b.x, b.y);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) pairUp(W, a, best);
    }
    const birth = S('family.birthChancePerSecond', 0.02), minH = S('family.birthMinHunger', 4);
    for (const m of W.units) {
      if (m.dead || !m.female || !m.partner) continue;
      const f = W.byId.get(m.partner);
      if (!f || f.dead) { m.partner = 0; continue; }
      if (W.t - (m.lastBirth || -1e9) < sim.dayLength() * 0.7) continue;
      if (m.hunger < minH || f.hunger < minH) continue;
      if (cheb(m.x, m.y, f.x, f.y) > 12) continue;
      if (rng() < birth) tryBirth(W, m, f);
    }
  }

  // ------------------------------------------------------------------ rumors
  function clockStr(W, t) { return sim.clockAt(t).text; }
  function createRumor(W, kind, who, what, victim, ctx) {
    const c = sim.clockAt(W.t);
    return {
      id: W.nextId++, kind, who: who.id, whoName: who.name, whoKingdom: who.kingdom, what, victim: victim ? victim.id : 0,
      victimKingdom: victim ? victim.kingdom : 0, day: c.day, time: c.text, t: W.t, ctx: ctx || '',
    };
  }
  function knows(u, r) { return u.rumors.some((x) => x.r.id === r.id); }
  function learnRumor(W, u, r) {
    if (knows(u, r)) return false;
    u.rumors.push({ r, at: W.t, told: {} });
    if (u.rumors.length > 8) u.rumors.shift();
    return true;
  }
  function rumorVars(r) { return { who: r.whoName, what: r.what, day: r.day, time: r.time }; }
  function spreadRumorAt(W, r, x, y, exclude) {
    for (const o of sim.near(W, x, y, S('fight.watchRadius', 10), (e) => e.kind === 'unit' && e.id !== exclude)) learnRumor(W, o, r);
  }
  function rumorUpdate(W) {
    const dayLen = sim.dayLength();
    for (const u of W.units) {
      if (u.dead || !u.rumors.length) continue;
      const p = clamp(S('rumor.forgetPerDayBase', 0.3) - S('rumor.forgiveGoodFactor', 0.05) * Math.max(0, u.evilGood) + 0.0, 0.03, 0.9) / dayLen;
      for (let i = u.rumors.length - 1; i >= 0; i--) {
        if (W.rng() < p) {
          if (W.rng() < 0.1 && u.evilGood > 0) sim.say(W, u, K.line(W.rng, 'rumor_forgive'), 0);
          u.rumors.splice(i, 1);
        }
      }
    }
  }
  // the king hears a rumor from a citizen
  function kingHears(W, k, r, teller) {
    if (k.rumors.some((x) => x.id === r.id)) return;
    k.rumors.push(r);
    if (k.rumors.length > 30) k.rumors.shift();
    const king = W.byId.get(k.king);
    if (!king) return;
    const crim = W.byId.get(r.who);
    sim.log(W, (teller ? teller.name : 'Someone') + ' told ' + king.name + ' that ' + r.whoName + ' ' + r.what + '.', [king.id]);
    if (r.kind !== 'crime' || !crim || crim.dead) return;
    const sameKingdom = crim.kingdom === k.id;
    if (sameKingdom || !crim.kingdom) {
      if (king.evilGood >= S('crime.punishMinKingGood', 0)) sim.orderArrest && sim.orderArrest(W, k, crim, r);
    } else if (r.victimKingdom === k.id) {
      k.grievances = k.grievances || {};
      k.grievances[crim.kingdom] = (k.grievances[crim.kingdom] || 0) + 1;
      const evilBoost = king.evilGood < 0 ? 1 + Math.abs(king.evilGood) * 0.1 : 1;
      if (W.rng() < k.grievances[crim.kingdom] * S('rumor.warFactor', 0.07) * evilBoost * 2) sim.declareWar && sim.declareWar(W, k, W.kingdoms.get(crim.kingdom), r);
    }
  }

  // ------------------------------------------------------------------ crimes
  function crimeUpdate(W) {
    const rng = W.rng;
    const lim = S('eg.crimeWitnessEvilGood', -3);
    for (const u of W.units) {
      if (u.dead || u.evilGood > lim || !sim.isAdult(W, u) || u.job === 'king') continue;
      if (u.task && u.task.prio >= 90) continue;
      if (rng() >= S('eg.crimeChancePerSecond', 0.004) * (Math.abs(u.evilGood) / 5)) continue;
      const vs = sim.near(W, u.x, u.y, 6, (o) => o.kind === 'unit' && o !== u && !related(u, o) && !o.dead && !o.sleeping && sim.isAdult(W, o));
      if (!vs.length) continue;
      const v = rng.pick(vs);
      u.task = { type: 'attack', prio: 90, target: v.id, mode: 'hits', hits: 3, reason: 'crime', until: W.t + 20 };
      sim.log(W, u.name + ' attacked ' + v.name + '!', [u.id, v.id]);
    }
  }
  // called when a unit (the attacker) hits another unit; gives the victim a chance to react and witnesses a rumor
  function provoke(W, victim, attacker, reason) {
    if (victim.dead || !attacker || attacker.kind !== 'unit') return;
    if (reason === 'crime') {
      if (!victim.crimeRumor || W.t - victim.crimeRumor > 10) {
        victim.crimeRumor = W.t;
        attacker.hunger = Math.min(sim.hungerMax(), attacker.hunger + S('crime.lootHunger', 2));    // the loot: crime pays a little
        const r = createRumor(W, 'crime', attacker, 'hit ' + victim.name, victim);
        learnRumor(W, victim, r);
        spreadRumorAt(W, r, victim.x, victim.y, attacker.id);
        // brave neighbours and fighters step in
        for (const o of sim.near(W, victim.x, victim.y, S('fight.watchRadius', 10), (e) => e.kind === 'unit' && e !== attacker && e !== victim && sim.isFighterUnit(e) && (!e.task || e.task.prio < 90))) {
          if (o.kingdom === victim.kingdom || o.kingdom === attacker.kingdom) o.task = { type: 'attack', prio: 90, target: attacker.id, mode: attacker.evilGood <= S('crime.defeatMaxEvilGood', -7) ? 'kill' : 'yield', reason: 'defend', until: W.t + 25 };
        }
      }
    }
    if (victim.task && victim.task.prio >= 90 && victim.task.type === 'attack') return;
    const fight = sim.isFighterUnit(victim) || sim.hasTrait(victim, 'brave') || victim.evilGood < -2 || W.rng() < 0.3;
    victim.task = fight
      ? { type: 'attack', prio: 90, target: attacker.id, mode: 'yield', reason: 'retaliate', until: W.t + 20 }
      : { type: 'flee', prio: 90, from: attacker.id, until: W.t + 6 };
  }
  // a loser of a "to the yield" fight gives up
  function onDefeat(W, winner, loser, reason) {
    for (const o of sim.near(W, loser.x, loser.y, S('fight.watchRadius', 10), (e) => e.kind === 'unit' && e !== winner && e !== loser)) {
      if (W.rng() < 0.3) sim.addGood(o, S('eg.witnessDefeat', -1));
    }
    if (reason === 'crime' || reason === 'defend' || reason === 'arrest') {
      if (loser.evilGood < 0 || reason === 'arrest') {
        loser.task = { type: 'jail', prio: 95, until: W.t + sim.dayLength() * 0.4 };
        sim.log(W, loser.name + ' was stopped by ' + winner.name + ' and sat down to think.', [loser.id, winner.id]);
      } else loser.task = null;
    }
    if (winner.kind === 'unit') {
      const bad = winner.evilGood < 0;
      sim.addGood(winner, bad ? S('eg.defenseWinEvil', -2) : S('eg.defenseWinGood', 2));
      winner.stats.defended++;
      const k = winner.kingdom && W.kingdoms.get(winner.kingdom);
      if (k) k.deeds.defended++;
    }
  }
  function orderArrest(W, k, crim, r) {
    const fighters = sim.citizens(W, k).filter((u) => sim.isFighterUnit(u) && u.id !== crim.id && (!u.task || u.task.prio < 90));
    fighters.sort((a, b) => dist(a.x, a.y, crim.x, crim.y) - dist(b.x, b.y, crim.x, crim.y));
    const mode = crim.evilGood <= S('crime.defeatMaxEvilGood', -7) ? 'kill' : 'yield';
    for (const f of fighters.slice(0, 3)) f.task = { type: 'attack', prio: 90, target: crim.id, mode, reason: 'arrest', until: W.t + 40 };
    const king = W.byId.get(k.king);
    if (king && fighters.length) sim.say(W, king, 'Arrest ' + crim.name + '!', 2);
  }

  // ------------------------------------------------------------------ death consequences
  function onDeath(W, e, src, how) {
    // kingdom and family
    const k = e.kingdom && W.kingdoms.get(e.kingdom);
    const f = W.families.get(e.family);
    const relatives = f ? familyUnits(W, f).filter((m) => m.id !== e.id) : [];
    if (e.partner) { const p = W.byId.get(e.partner); if (p) p.partner = 0; }
    leaveFamily(W, e);
    if (k) {
      if (k.king === e.id) sim.onKingDeath(W, k, e); else k.citizens.delete(e.id);
    }
    // grief, vengeance, mourning
    const killer = src && src.kind === 'unit' ? src : null;
    const unjust = !!killer && !!killer.task && ['crime', 'vengeance', 'retaliate'].includes(killer.task.reason);
    const war = killer && k && killer.kingdom && k.war && W.kingdoms.get(killer.kingdom) && (k.war.a === killer.kingdom || k.war.d === killer.kingdom);
    for (const m of relatives) {
      sim.addGood(m, S('eg.loseFamily', -3));
      if (unjust && m !== killer && !killer.dead && !war && sim.isAdult(W, m) && m.evilGood < S('eg.avoidConflictAbove', 5) && W.rng() < 0.7) {
        m.task = { type: 'attack', prio: 90, target: killer.id, mode: m.evilGood <= S('eg.deepVengeanceBelow', -6) ? 'kill' : 'yield', reason: 'vengeance', until: W.t + sim.dayLength() * 0.8 };
        sim.say(W, m, K.line(W.rng, 'vengeance', { who: killer.name }), 2);
      }
    }
    const mourners = relatives.concat(sim.near(W, e.x, e.y, 6, (o) => o.kind === 'unit' && o.kingdom === e.kingdom && !relatives.includes(o)));
    for (const m of mourners) {
      if (m.dead || (m.task && m.task.prio >= 90)) continue;
      const p = relatives.includes(m) ? 1 : S('death.mournChance', 0.7) * 0.3;
      if (W.rng() < p) m.task = { type: 'mourn', prio: 64, x: e.x, y: e.y, dead: e.name, job: e.job, t0: 0, until: W.t + sim.dayLength() * 0.6, stats: e.stats };
    }
    if (unjust && !war) {
      const r = createRumor(W, 'crime', killer, 'killed ' + e.name, e);
      r.victimKingdom = e.kingdom;
      learnRumor(W, killer, r);
      spreadRumorAt(W, r, e.x, e.y, killer.id);
      killer.stats.kills++;
      if (killer.kingdom === e.kingdom && k) { /* inside crime: the king will hear of it */ }
    }
    if (killer && war) killer.stats.kills++;
    if (killer) for (const o of sim.near(W, e.x, e.y, S('fight.watchRadius', 10), (x) => x.kind === 'unit' && x !== killer && x.id !== e.id)) if (W.rng() < 0.3) sim.addGood(o, S('eg.witnessDefeat', -1));
  }

  // ------------------------------------------------------------------ chatting
  function chatUpdate(W) {
    const rng = W.rng;
    const p = S('unit.chatChancePerSecond', 0.05);
    for (const u of W.units) {
      if (u.dead || u.sleeping || u.fainted || u.hop) continue;
      if (u.task && u.task.prio > 40) continue;
      if (rng() >= p) continue;
      const others = sim.near(W, u.x, u.y, S('unit.talkRadius', 4), (o) => o.kind === 'unit' && o !== u && !o.sleeping && !o.fainted && (!o.task || o.task.prio <= 40));
      if (!others.length) continue;
      const v = rng.pick(others);
      const now = W.t;
      if (sim.isTalking(W, u) || sim.isTalking(W, v)) continue;
      u.face = v.x >= u.x ? 1 : -1; v.face = u.x >= v.x ? 1 : -1;
      const gossip = sim.hasTrait(u, 'gossip') ? S('traits.gossipMultiplier', 2) : 1;
      if (u.rumors.length && now - u.rumorSaid > S('rumor.repeatSeconds', 30) && rng() < 0.3 * gossip) {
        const ru = u.rumors[rng.int(0, u.rumors.length - 1)];
        const first = !ru.told[v.id];
        ru.told[v.id] = true; u.rumorSaid = now;
        sim.say(W, u, K.line(rng, first ? 'rumor' : 'rumor_repeat', rumorVars(ru.r)), 1);
        if (learnRumor(W, v, ru.r)) v.reply = { at: now + 1.6, cat: 'witness', vars: {} };
      } else {
        const cat = rng() < 0.55 ? 'greet' : (rng() < 0.5 ? 'day' : 'idle');
        sim.say(W, u, K.line(rng, cat, { other: v.name }), 0);
        v.reply = { at: now + 1.5, cat: rng() < 0.5 ? 'idle' : 'greet', vars: { other: u.name } };
      }
      // jokers and friends linger for a moment
      u.chatT = now + 2.5; v.chatT = now + 2.5;
    }
  }
  function processReply(W, u) {
    if (u.reply && W.t >= u.reply.at) {
      const r = u.reply; u.reply = null;
      if (!u.dead && !u.sleeping) sim.say(W, u, K.line(W.rng, r.cat, r.vars), 0);
    }
  }

  Object.assign(sim, {
    newFamily, leaveFamily, joinFamily, mergeFamilies, familyUnits, related, pairUp, tryBirth, familyUpdate, createRumor, learnRumor, knows,
    rumorVars, spreadRumorAt, rumorUpdate, kingHears, crimeUpdate, provoke, onDefeat, orderArrest, onDeath, chatUpdate, processReply,
  });
})();
