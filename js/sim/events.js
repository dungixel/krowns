// Krowns - events: wars between kingdoms, plays in the theater, duels in the coliseum, petitions to the king.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const sim = K.sim;
  const S = K.S;
  const { dist, cheb } = K.util;

  // ------------------------------------------------------------------ war
  function declareWar(W, a, d, rumor) {
    if (!a || !d || a === d || a.war || d.war) return null;
    const cd = S('war.cooldownDays', 2) * sim.dayLength();
    if (W.t - a.lastWarEnd < cd || W.t - d.lastWarEnd < cd) return null;
    const war = { id: W.nextId++, a: a.id, d: d.id, t0: W.t, endsT: W.t + S('war.durationSeconds', 110), loot: { food: 0, wood: 0, gold: 0 }, deaths: 0 };
    a.war = war; d.war = war;
    W.wars.push(war); W.stats.wars++;
    const king = W.byId.get(a.king);
    if (king) sim.say(W, king, K.line(W.rng, 'war_declare', { kingdom: d.name }), 2);
    sim.log(W, a.name + ' declared war on ' + d.name + (rumor ? ' because of ' + rumor.whoName + '.' : '.'), []);
    for (const k of [a, d]) for (const u of sim.citizens(W, k)) if (sim.isFighterUnit(u) && sim.isAdult(W, u) && W.rng() < 0.5) sim.say(W, u, K.line(W.rng, 'war'), 1);
    sim.emit(W, 'war', { id: war.id });
    return war;
  }
  function endWar(W, war, silent) {
    if (war.over) return;
    war.over = true;
    const a = W.kingdoms.get(war.a), d = W.kingdoms.get(war.d);
    for (const k of [a, d]) if (k) { k.war = null; k.lastWarEnd = W.t; }
    if (a) { a.chest.food += war.loot.food; a.chest.wood += war.loot.wood; a.chest.gold += war.loot.gold; }
    W.wars = W.wars.filter((w) => w !== war);
    if (!silent) sim.log(W, 'The war between ' + (a ? a.name : '?') + ' and ' + (d ? d.name : '?') + ' is over.', []);
    for (const u of W.units) if (u.task && u.task.type === 'war') u.task = null;
  }
  function warUpdate(W) {
    for (const war of W.wars.slice()) {
      const a = W.kingdoms.get(war.a), d = W.kingdoms.get(war.d);
      if (!a || !d) { endWar(W, war, true); continue; }
      const aFight = sim.citizens(W, a).filter((u) => sim.isFighterUnit(u) && sim.isAdult(W, u)).length;
      if (W.t >= war.endsT || aFight === 0) endWar(W, war);
    }
  }
  // what role does this unit have in its kingdom's war?
  function warRole(W, u) {
    const k = u.kingdom && W.kingdoms.get(u.kingdom);
    if (!k || !k.war || !sim.isAdult(W, u)) return null;
    const war = k.war;
    const fighter = sim.isFighterUnit(u);
    if (k.id === war.a) return fighter ? { war, role: 'attack', enemy: war.d } : null;
    if (fighter || u.job === 'king') return { war, role: 'defend', enemy: war.a };
    let fighters = 0;
    for (const c of sim.citizens(W, k)) if (sim.isFighterUnit(c) && sim.isAdult(W, c)) fighters++;
    if (fighters <= S('fight.civiliansJoinWhenFightersAtOrBelow', 1)) return { war, role: 'defend', enemy: war.a };
    return null;
  }

  // ------------------------------------------------------------------ petitions (asking the king)
  const keenKing = (king) => sim.hasTrait(king, 'theaterLover') ? S('theater.kingKeenBonus', 0.3) : 0;
  function allowChance(king) {
    return Math.max(0.05, Math.min(0.95, S('theater.kingAllowBase', 0.35) + S('theater.kingAllowPerGood', 0.04) * king.evilGood + keenKing(king)));
  }
  function petitioner(W, k, kind) {
    const jobId = kind === 'play' ? 'bard' : 'knight';
    const minG = kind === 'play' ? S('eg.bardsMinEvilGood', 3) : S('eg.coliseumMinEvilGood', 2);
    const list = sim.citizens(W, k).filter((u) => u.job === jobId && sim.isAdult(W, u) && u.evilGood >= minG && !u.sleeping && (!u.task || u.task.prio < 60));
    return list.length ? W.rng.pick(list) : null;
  }
  // called by the AI when the petitioner stands before the king
  function resolvePetition(W, u, kind) {
    const k = W.kingdoms.get(u.kingdom);
    const king = k && W.byId.get(k.king);
    if (!k || !king) return;
    k.petition = null;
    const ok = W.rng() < allowChance(king);
    if (kind === 'play') {
      const minD = S('theater.planDaysMin', 1), maxD = S('theater.planDaysMax', 3);
      const c = sim.clockAt(W.t);
      const day = c.day + W.rng.int(minD, maxD), hour = W.rng.int(Math.ceil(S('time.eventEarliestHour', 9)), 17);
      sim.say(W, u, K.line(W.rng, 'request_play', { day, time: K.util.pad2(hour) + ':00' }), 2);
      if (ok) {
        k.plays.push({ id: W.nextId++, day, hour, status: 'planned', startT: sim.timeOf(day, hour), endT: 0, time: K.util.pad2(hour) + ':00', performers: [], audience: [] });
        sim.say(W, king, K.line(W.rng, 'play_announce', { day, time: K.util.pad2(hour) + ':00' }), 2);
        sim.say(W, u, K.line(W.rng, 'play_allowed'), 1);
        sim.log(W, 'A play is planned in ' + k.name + ' on Day ' + day + ' at ' + K.util.pad2(hour) + ':00.', [u.id]);
      } else {
        sim.say(W, u, K.line(W.rng, 'play_rejected'), 1);
        sim.addGood(u, S('eg.bardsRejected', -2));
        k.noPlayUntil = W.t + sim.dayLength() * 0.6;
      }
    } else {
      sim.say(W, u, K.line(W.rng, 'request_arena'), 2);
      if (ok) { k.coliseumApproved = true; sim.say(W, king, 'So be it. Build it!', 2); sim.log(W, 'The king of ' + k.name + ' approved a coliseum.', [king.id]); }
      else { sim.say(W, u, K.line(W.rng, 'play_rejected'), 1); k.noArenaUntil = W.t + sim.dayLength() * 0.8; }
    }
  }

  // ------------------------------------------------------------------ plays and duels
  function theaterFront(W, s, n) {
    const out = [];
    for (let r = 1; r <= 4 && out.length < n + 4; r++) {
      for (let dy = -r; dy <= s.h - 1 + r; dy++) for (let dx = -r; dx <= s.w - 1 + r; dx++) {
        if (Math.max(dx < 0 ? -dx : dx > s.w - 1 ? dx - (s.w - 1) : 0, dy < 0 ? -dy : dy > s.h - 1 ? dy - (s.h - 1) : 0) !== r) continue;
        const x = s.x + dx, y = s.y + dy;
        if (sim.inb(W, x, y) && W.occ[y * W.w + x] === 0) out.push([x, y]);
      }
    }
    return out;
  }
  function startPlay(W, k, play) {
    const s = W.structures.get(k.theaterId);
    if (!s || s.building) { play.status = 'done'; return; }
    const cits = sim.citizens(W, k);
    const bards = cits.filter((u) => u.job === 'bard' && sim.isAdult(W, u) && !u.sleeping);
    if (bards.length < 1) { play.status = 'done'; return; }
    play.status = 'running'; play.endT = W.t + S('theater.durationSeconds', 24);
    const spots = theaterFront(W, s, cits.length);
    W.rng.shuffle(spots);
    let si = 0;
    const perform = (u) => { u.task = { type: 'perform', prio: 70, struct: s.id, spot: spots[si++ % Math.max(1, spots.length)], until: play.endT, play: play.id, work: false }; play.performers.push(u.id); };
    for (const b of bards) perform(b);
    const joker = cits.find((u) => u.job === 'joker');
    if (joker && W.rng() < S('theater.jokerJoinChance', 0.5)) perform(joker);
    for (const u of cits) {
      if (play.performers.includes(u.id) || u.sleeping || u.fainted || (u.task && u.task.prio >= 80)) continue;
      const p = sim.hasTrait(u, 'theaterLover') ? 1 : 0.5;
      if (u.job === 'king' || W.rng() > p) continue;
      u.task = { type: 'watchPlay', prio: 65, struct: s.id, spot: spots[si++ % Math.max(1, spots.length)], until: play.endT, play: play.id };
      play.audience.push(u.id);
    }
    const king = W.byId.get(k.king);
    if (king && !sim.hasTrait(king, 'sleepy')) king.task = { type: 'watchPlay', prio: 65, struct: s.id, spot: spots[si++ % Math.max(1, spots.length)], until: play.endT, play: play.id };
    sim.log(W, 'The play begins in ' + k.name + '!', []);
    sim.emit(W, 'play', { id: play.id, k: k.id });
  }
  function endPlay(W, k, play) {
    play.status = 'done';
    W.stats.plays++;
    for (const id of play.audience) {
      const u = W.byId.get(id);
      if (!u || u.dead) continue;
      if (W.rng() < S('eg.playEnjoyChance', 0.7)) {
        sim.addGood(u, W.rng.int(S('eg.playEnjoyMin', 1), S('eg.playEnjoyMax', 2)));
        sim.say(W, u, K.line(W.rng, 'play_like'), 1);
        u.playMemory = W.t + W.rng.range(S('eg.playMemoryDaysMin', 1), S('eg.playMemoryDaysMax', 3)) * sim.dayLength();
      } else sim.say(W, u, K.line(W.rng, 'play_dislike'), 1);
    }
    for (const id of play.performers) {
      const u = W.byId.get(id);
      if (!u || u.dead) continue;
      sim.gainEV(u, S('ev.perWorkCycle', 0.5) * 2);
      u.stats.plays++;
      if (u.task && u.task.type === 'perform') u.task = null;
    }
    k.plays = k.plays.filter((p) => p.status !== 'done');
    sim.log(W, 'The play in ' + k.name + ' ended with applause.', []);
  }

  function startDuel(W, k, duel) {
    const s = W.structures.get(k.coliseumId);
    if (!s || s.building) return false;
    const knights = sim.citizens(W, k).filter((u) => u.job === 'knight' && sim.isAdult(W, u) && !u.sleeping && (!u.task || u.task.prio < 80));
    if (knights.length < 2) return false;
    W.rng.shuffle(knights);
    const [a, b] = knights;
    const spots = theaterFront(W, s, 20);
    W.rng.shuffle(spots);
    const anchor = spots[0] || [s.x, s.y + s.h];
    const mk = (me, other) => ({ type: 'attack', prio: 90, target: other.id, mode: 'yield', yieldAt: S('coliseum.duelEndsAtHearts', 3), reason: 'duel', anchor, until: W.t + 40, duel: duel.id });
    a.task = mk(a, b); b.task = mk(b, a);
    duel.status = 'running'; duel.endT = W.t + 40; duel.fighters = [a.id, b.id]; duel.audience = [];
    let si = 1;
    for (const u of sim.citizens(W, k)) {
      if (u === a || u === b || u.sleeping || u.fainted || (u.task && u.task.prio >= 80) || u.job === 'king') continue;
      if (W.rng() > 0.45) continue;
      u.task = { type: 'watchPlay', prio: 65, struct: s.id, spot: spots[si++ % Math.max(1, spots.length)], until: W.t + 40, play: duel.id, cheer: 'arena_cheer' };
      duel.audience.push(u.id);
    }
    sim.log(W, 'A duel begins in the coliseum of ' + k.name + ': ' + a.name + ' against ' + b.name + '.', [a.id, b.id]);
    return true;
  }

  function eventsUpdate(W) {
    const dayLen = sim.dayLength();
    const c = sim.clockAt(W.t);
    for (const k of W.kingdoms.values()) {
      if (k.war) continue;
      const king = W.byId.get(k.king);
      if (!king) continue;
      const counts = sim.counts(W, k);
      // ---- plays
      const theater = W.structures.get(k.theaterId);
      if (theater && !theater.building) {
        let play = k.plays[0];
        if (!play && !k.petition && W.t > (k.noPlayUntil || 0) && (counts.bard || 0) >= S('theater.minBards', 2) && W.rng() < 1.5 / dayLen) {
          const u = petitioner(W, k, 'play');
          if (u) { k.petition = { kind: 'play', unit: u.id, t: W.t }; u.task = { type: 'petition', kind: 'play', prio: 62, until: W.t + 40 }; }
        }
        if (play && play.status === 'planned' && W.t >= play.startT) startPlay(W, k, play);
        else if (play && play.status === 'planned' && W.t > play.startT + 30) k.plays.shift();
        if (play && play.status === 'running' && W.t >= play.endT) endPlay(W, k, play);
      }
      if (k.petition && W.t - k.petition.t > 60) k.petition = null;
      // ---- coliseum
      if (!k.coliseumId && !k.coliseumApproved && !k.petition && W.t > (k.noArenaUntil || 0) && (counts.knight || 0) >= S('coliseum.minKnights', 4) && (counts.blacksmith || 0) >= 1 && W.rng() < 1.5 / dayLen) {
        const u = petitioner(W, k, 'arena');
        if (u) { k.petition = { kind: 'arena', unit: u.id, t: W.t }; u.task = { type: 'petition', kind: 'arena', prio: 62, until: W.t + 40 }; }
      }
      const col = W.structures.get(k.coliseumId);
      if (col && !col.building) {
        const duel = k.duel;
        if (!duel && c.hour >= 10 && c.hour < 18 && W.rng() < 0.6 / dayLen) {
          const d = { id: W.nextId++, status: 'planned' };
          if (startDuel(W, k, d)) k.duel = d;
        } else if (duel && duel.status === 'running') {
          const fighters = duel.fighters.map((id) => W.byId.get(id));
          const over = W.t >= duel.endT || fighters.some((f) => !f || f.dead || !f.task || f.task.duel !== duel.id);
          if (over) {
            for (const id of duel.audience) { const u = W.byId.get(id); if (u && u.task && u.task.type === 'watchPlay') u.task = null; }
            for (const f of fighters) if (f && f.task && f.task.duel === duel.id) f.task = null;
            k.duel = null;
            sim.log(W, 'The duel in ' + k.name + ' is over.', []);
          }
        }
      }
    }
    warUpdate(W);
  }

  Object.assign(sim, { declareWar, endWar, warUpdate, warRole, resolvePetition, eventsUpdate, theaterFront, allowChance });
})();
