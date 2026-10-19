// Krowns - the simulation. One call to tick() is one second of world time.
// Every unit performs at most ONE action per second (some actions need extra
// seconds of cooldown). Nothing in here touches the screen.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const { makeRng, clamp, cheb, dist, sign, cap } = K.util;
  const WD = K.words;
  const ROLES = WD.ROLES;
  const ROLE_KEYS = WD.ROLE_KEYS;

  const IV_KEYS = ['hearts'].concat(WD.TRAIT_KEYS);
  const SKILLS = ['sword', 'magic', 'cooking', 'farming', 'poetry', 'hunting'];
  const SKILL_IV = { sword: 'strength', magic: 'magic', cooking: 'cooking', farming: 'farming', poetry: 'poetry', hunting: 'hunting' };
  const SPELLS = [['heal', 0], ['poison', 4], ['burn', 8], ['confuse', 12]];
  const EV_CAP = 40;

  // ------------------------------------------------------------ small helpers
  const getU = (w, id) => (id == null ? null : w.units.get(id));
  const getK = (w, id) => (id == null ? null : w.kingdoms.get(id));
  const kingdomOf = (w, u) => getK(w, u.kingdom);
  const isMonk = (u) => u.iv.temperament < 8;
  const aff = (u, id) => (u.memory[id] ? u.memory[id].aff : 0);
  function mem(u, id) {
    return u.memory[id] || (u.memory[id] = { aff: 0, betrayer: false, hurt: false, killer: false });
  }
  function like(u, id, d) {
    const m = mem(u, id);
    m.aff = clamp(m.aff + d, -100, 100);
  }
  const foodPoints = (k) => k.granary.bread + k.granary.meat + k.granary.meals.reduce((a, b) => a + b, 0);
  const atWar = (w, a, b) => a != null && b != null && a !== b && !!(getK(w, a) && getK(w, a).wars.has(b));

  function chron(w, text) {
    w.chronicle.push({ t: w.time, text });
    w.events.push({ type: 'log', text });
    if (w.chronicle.length > 400) w.chronicle.shift();
  }
  function lifeLog(w, u, text) {
    u.log.push({ t: w.time, text });
    if (u.log.length > 40) u.log.shift();
  }

  // Speech bubble. Rate limited so nobody chatters constantly.
  function sayText(w, u, text, force) {
    if (!u.alive) return false;
    if (!force && w.time - u.lastSay < 4) return false;
    u.lastSay = w.time;
    w.events.push({ type: 'say', id: u.id, text });
    return true;
  }
  function say(w, u, key, vars, force) {
    return sayText(w, u, WD.line(key, w.rng, vars), force);
  }
  // Announce a decision once, when the goal changes.
  function goal(w, u, goalKey, speechKey, vars, urgent) {
    if (u.goalKey === goalKey) return;
    u.goalKey = goalKey;
    if (speechKey) {
      const gap = urgent ? 3 : 8;
      if (w.time - u.lastSay >= gap) say(w, u, speechKey, vars, true);
    }
  }

  // ------------------------------------------------------------ skills
  const power = (u, skill) => u.iv[SKILL_IV[skill]] * 0.6 + u.ev[skill];
  function train(w, u, skill, mult) {
    const iv = u.iv[SKILL_IV[skill]];
    let g = 0.6 * (0.4 + 1.2 * iv / 31) * (1 - u.ev[skill] / 48) * (mult == null ? 1 : mult);
    if (u.learning && u.learning.skill === skill) g *= 2;
    u.ev[skill] = Math.min(EV_CAP, u.ev[skill] + g);
    if (skill === 'magic' && u.role === 'mage') checkSpells(w, u);
  }
  function checkSpells(w, u) {
    for (const [name, need] of SPELLS) {
      if (u.ev.magic >= need && !u.spells.has(name)) {
        u.spells.add(name);
        lifeLog(w, u, `Learned the ${name} spell.`);
        if (name !== 'heal' || w.time > 5) say(w, u, 'learn_spell', null, true);
      }
    }
  }

  // ------------------------------------------------------------ interests and roles
  function talent(u, role) {
    const ivs = ROLES[role].iv;
    let s = 0;
    for (const k of ivs) s += u.iv[k];
    return s / ivs.length / 31;
  }
  function interestScore(u, role) {
    return talent(u, role) * 0.7 + u.bias[role] + (u.ev[ROLES[role].skill] / EV_CAP) * 0.35;
  }
  function computeInterest(u) {
    let best = null, bs = -1;
    for (const r of ROLE_KEYS) {
      const s = interestScore(u, r);
      if (s > bs) { bs = s; best = r; }
    }
    return best;
  }
  function evaluateRole(w, u, silent) {
    const k = kingdomOf(w, u);
    if (!k) { if (u.role) u.role = null; return; }
    let best = null, bs = -99;
    for (const r of ROLE_KEYS) {
      let s = interestScore(u, r) + (k.need[r] || 0);
      if (u.role === r) s += 0.3;
      if (s > bs) { bs = s; best = r; }
    }
    // people keep a job for a while instead of flip-flopping with every shift in needs
    if (best !== u.role && u.role && w.time - u.roleSince < 150 && (k.need[u.role] || 0) > -0.5) best = u.role;
    if (best !== u.role) {
      const old = u.role;
      u.role = best; u.roleSince = w.time;
      refreshNeeds(w, k);
      lifeLog(w, u, `Became a ${ROLES[best].label}${old ? ` instead of a ${ROLES[old].label}` : ''}.`);
      if (!silent) say(w, u, 'new_role', { w: ROLES[best].label });
      if (old === 'farmer') for (const p of k.farms) if (p.owner === u.id) p.owner = null;
      if (best === 'mage') checkSpells(w, u);
    }
  }

  // ------------------------------------------------------------ creating units
  function rollIVs(w) {
    const rng = w.rng;
    const iv = { hearts: clamp(Math.round(rng.normal(10, 2.6)), 6, 20) };
    for (const k of WD.TRAIT_KEYS) iv[k] = rng.int(0, 31);
    return iv;
  }
  // Children get a third of each parent's IVs, and the last third is random.
  function inheritIVs(w, a, b) {
    const rng = w.rng;
    const fresh = rollIVs(w);
    const keys = rng.shuffle(IV_KEYS.slice());
    const third = Math.floor(keys.length / 3);
    const iv = {};
    keys.forEach((k, i) => {
      if (i < third) iv[k] = a.iv[k];
      else if (i < third * 2) iv[k] = b.iv[k];
      else iv[k] = fresh[k];
    });
    return iv;
  }

  function newUnit(w, x, y, parents) {
    const rng = w.rng;
    const id = w.nextId++;
    const u = {
      id, name: K.names.makeName(rng, w.usedNames),
      x, y, px: x, py: y,
      iv: parents ? inheritIVs(w, parents[0], parents[1]) : rollIVs(w),
      ev: { sword: 0, magic: 0, cooking: 0, farming: 0, poetry: 0, hunting: 0 },
      bias: {},
      hearts: 0, maxHearts: 0, hunger: parents ? 4 : rng.range(3.5, 5), starve: 0, pocket: 0,
      carry: { bread: 0 },
      kingdom: null, role: null, interest: null,
      anger: 0, status: { poison: 0, poisonBy: null, burn: 0, burnBy: null, confused: 0 },
      cd: 0, goalKey: '', lastSay: -99, talkCd: rng.int(0, 6), loveCd: 0,
      fight: null, flee: null, learning: null, visit: null, joining: null, wanderTo: null, mediate: null,
      memory: {}, partner: null, exes: [], children: [], parents: parents ? [parents[0].id, parents[1].id] : [],
      mourning: null, forgave: [], log: [], spells: new Set(),
      noJoin: {}, roleSince: -999, alive: true, born: w.time, lastChild: -999, cause: null, diedAt: null,
    };
    u.maxHearts = u.iv.hearts; u.hearts = u.maxHearts;
    w.usedNames.add(u.name);
    for (const r of ROLE_KEYS) u.bias[r] = rng.range(0, 0.35);
    u.interest = computeInterest(u);
    w.units.set(id, u);
    w.occ.set(y * w.w + x, u);
    w.alive.push(u);
    return u;
  }

  function freeSpotNear(w, x, y, r) {
    for (let i = 0; i < 40; i++) {
      const nx = clamp(x + w.rng.int(-r, r), 0, w.w - 1), ny = clamp(y + w.rng.int(-r, r), 0, w.h - 1);
      if (tileFree(w, nx, ny)) return [nx, ny];
    }
    return null;
  }

  // ------------------------------------------------------------ world creation
  function createWorld(opts) {
    opts = opts || {};
    const seed = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    const rng = makeRng(seed);
    const w = {
      seed, rng, w: opts.w || 64, h: opts.h || 40, time: 0,
      units: new Map(), kingdoms: new Map(), animals: [],
      events: [], chronicle: [], occ: new Map(), alive: [], aggress: [],
      struct: new Set(), animalAt: new Map(),   // castles and fields; animals: one thing per grid square
      usedNames: new Set(), nextId: 1, nextKid: 1, nextAid: 1, maxPop: opts.maxPop || 60,
      stats: { births: 0, deaths: {} }, usedHues: [],
    };
    w.name = K.names.makeName(rng);
    const n = opts.units || 20;
    const groups = Math.max(1, Math.round(n / 5));
    const centers = [];
    for (let g = 0; g < groups; g++) {
      let best = null, bd = -1;
      for (let t = 0; t < 40; t++) {
        const c = [rng.int(8, w.w - 9), rng.int(8, w.h - 9)];
        let d = 999;
        for (const o of centers) d = Math.min(d, cheb(c[0], c[1], o[0], o[1]));
        if (d > bd) { bd = d; best = c; }
      }
      centers.push(best);
    }
    for (let i = 0; i < n; i++) {
      const c = centers[i % groups];
      const spot = freeSpotNear(w, c[0], c[1], 4) || freeSpotNear(w, c[0], c[1], 9);
      if (spot) newUnit(w, spot[0], spot[1], null);
    }
    const animalTarget = Math.round(w.w * w.h / 115);
    for (let i = 0; i < animalTarget; i++) spawnAnimal(w);
    return w;
  }

  // ------------------------------------------------------------ animals
  function spawnAnimal(w) {
    const rng = w.rng;
    const r = rng();
    const size = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    for (let t = 0; t < 20; t++) {
      const x = rng.int(1, w.w - 2), y = rng.int(1, w.h - 2);
      if (!tileFree(w, x, y)) continue;
      const a = { id: w.nextAid++, x, y, px: x, py: y, size, hp: size === 1 ? 2 : size === 2 ? 4 : 7, food: size, alive: true, cd: rng.int(0, 3) };
      w.animals.push(a);
      w.animalAt.set(y * w.w + x, a);
      return;
    }
  }
  function updateAnimals(w) {
    const target = Math.round(w.w * w.h / 110);
    for (const a of w.animals) {
      a.px = a.x; a.py = a.y;
      if (!a.alive) continue;
      if (a.cd > 0) { a.cd--; continue; }
      a.cd = w.rng.int(1, 3);
      const nx = a.x + w.rng.int(-1, 1), ny = a.y + w.rng.int(-1, 1);
      if ((nx !== a.x || ny !== a.y) && tileFree(w, nx, ny)) {
        w.animalAt.delete(a.y * w.w + a.x);
        a.x = nx; a.y = ny;
        w.animalAt.set(ny * w.w + nx, a);
      }
    }
    w.animals = w.animals.filter((a) => a.alive);
    if (w.time % 12 === 0 && w.animals.length < target) spawnAnimal(w);
  }

  // ------------------------------------------------------------ movement
  const inBounds = (w, x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h;
  // A square can hold one unit, one animal or one structure, never two things.
  const tileFree = (w, x, y) => {
    if (!inBounds(w, x, y)) return false;
    const key = y * w.w + x;
    return !w.occ.has(key) && !w.struct.has(key) && !w.animalAt.has(key);
  };
  function moveUnit(w, u, x, y) {
    w.occ.delete(u.y * w.w + u.x);
    u.x = x; u.y = y;
    w.occ.set(y * w.w + x, u);
  }
  function stepToward(w, u, tx, ty) {
    const dx = tx - u.x, dy = ty - u.y;
    const sx = sign(dx), sy = sign(dy);
    if (!sx && !sy) return false;
    const c = [[sx, sy]];
    if (sx && sy) {
      if (Math.abs(dx) >= Math.abs(dy)) c.push([sx, 0], [0, sy]); else c.push([0, sy], [sx, 0]);
    } else if (sx) {
      const s = w.rng.chance(0.5) ? 1 : -1;
      c.push([sx, s], [sx, -s], [0, s], [0, -s]);
    } else {
      const s = w.rng.chance(0.5) ? 1 : -1;
      c.push([s, sy], [-s, sy], [s, 0], [-s, 0]);
    }
    for (const [mx, my] of c) {
      const nx = u.x + mx, ny = u.y + my;
      if (tileFree(w, nx, ny)) { moveUnit(w, u, nx, ny); return true; }
    }
    return false;
  }
  function stepAway(w, u, fx, fy) {
    let best = null, bd = dist(u.x, u.y, fx, fy);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = u.x + dx, ny = u.y + dy;
      if (!tileFree(w, nx, ny)) continue;
      const d = dist(nx, ny, fx, fy) + w.rng() * 0.3;
      if (d > bd) { bd = d; best = [nx, ny]; }
    }
    if (best) { moveUnit(w, u, best[0], best[1]); return true; }
    return false;
  }
  // Walk toward a spot until within r tiles. Returns 'arrived' | 'moving' | 'blocked'.
  function goNear(w, u, tx, ty, r) {
    if (cheb(u.x, u.y, tx, ty) <= r) return 'arrived';
    return stepToward(w, u, tx, ty) ? 'moving' : 'blocked';
  }
  const cost = (u, seconds) => { u.cd = Math.max(0, seconds - 1); };

  // ------------------------------------------------------------ damage and death
  function damage(w, u, amount, cause, by) {
    if (!u.alive) return;
    u.hearts -= amount;
    if (u.hearts <= 0) { u.hearts = 0; die(w, u, cause, by); }
  }

  function die(w, u, cause, by) {
    if (!u.alive) return;
    u.alive = false; u.cause = cause; u.diedAt = w.time;
    w.occ.delete(u.y * w.w + u.x);
    const ai = w.alive.indexOf(u);
    if (ai >= 0) w.alive.splice(ai, 1);
    w.stats.deaths[cause] = (w.stats.deaths[cause] || 0) + 1;
    const killer = getU(w, by);
    const txt = cause === 'hunger' ? `{u:${u.id}} starved to death.`
      : cause === 'poison' ? `{u:${u.id}} succumbed to poison${killer ? ` cast by {u:${killer.id}}` : ''}.`
      : cause === 'burn' ? `{u:${u.id}} burned to death.`
      : killer ? `{u:${u.id}} was slain by {u:${killer.id}}.` : `{u:${u.id}} died.`;
    chron(w, txt);
    lifeLog(w, u, 'Died.');
    w.events.push({ type: 'death', id: u.id, x: u.x, y: u.y });
    // the kingdom loses a member
    if (u.kingdom != null) leaveKingdom(w, u, 'died');
    // the partner mourns
    if (u.partner != null) {
      const p = getU(w, u.partner);
      if (p && p.alive) {
        p.partner = null; p.mourning = u.id;
        lifeLog(w, p, `Lost {u:${u.id}}.`);
        say(w, p, 'mourn', { n: u.name }, true);
      }
    }
    // those who loved the victim never forget the killer
    if (killer && killer.alive) {
      for (const o of w.alive) {
        if (!o.alive || o === killer) continue;
        const m = o.memory[u.id];
        if (m && m.aff >= 35) { like(o, killer.id, -55); mem(o, killer.id).killer = true; }
      }
      if (u.lastKingdom != null || killer.kingdom != null) relMod(w, u.lastKingdom, killer.kingdom, -14);
      if (atWar(w, u.lastKingdom, killer.kingdom)) { const vk = getK(w, u.lastKingdom); if (vk) vk.warDead++; }
    }
    for (const o of w.alive) if (o.fight && o.fight.target === u.id) o.fight = null;
  }

  function relMod(w, ka, kb, d) {
    if (ka == null || kb == null || ka === kb) return;
    const a = getK(w, ka), b = getK(w, kb);
    if (!a || !b) return;
    a.rel.set(kb, clamp((a.rel.get(kb) || 0) + d, -100, 100));
    b.rel.set(ka, clamp((b.rel.get(ka) || 0) + d, -100, 100));
  }

  const meleeDamage = (u) => {
    let d = 0.5 + power(u, 'sword') / 28 + (u.role === 'swordsman' ? 0.5 : 0);
    return clamp(Math.round(d * 2) / 2, 0.5, 3.5);
  };

  // Something hostile happened to `t` caused by `a`.
  function onHit(w, t, a, dmg) {
    const m = mem(t, a.id);
    m.aff = clamp(m.aff - (18 + dmg * 5), -100, 100); m.hurt = true;
    t.anger = Math.min(100, t.anger + (14 + dmg * 9) * (0.4 + 1.2 * t.iv.temperament / 31));
    relMod(w, t.kingdom, a.kingdom, -1.5);
    w.aggress.push({ a: a.id, t: t.id, t0: w.time });
    const th = 30 + (31 - t.iv.temperament) * 1.2;
    const hurtBad = t.hearts < t.maxHearts * 0.35;
    const brave = t.iv.courage >= 12 && !isMonk(t);
    if (!isMonk(t) && t.anger >= th && !(hurtBad && !brave)) {
      if (!t.fight) { t.fight = { target: a.id, reason: 'revenge' }; t.goalKey = 'revenge'; say(w, t, 'revenge', null, true); }
    } else if (!t.fight && (isMonk(t) || hurtBad || t.iv.courage < 8)) {
      t.flee = { from: a.id, until: w.time + 8 };
      if (isMonk(t)) say(w, t, 'monk_flee', null, true); else say(w, t, 'flee', null, true);
    }
  }

  function attack(w, a, t) {
    if (a.status.burn > 0) { damage(w, a, 1, 'burn', a.status.burnBy); if (!a.alive) return; }
    const dmg = meleeDamage(a);
    damage(w, t, dmg, 'combat', a.id);
    train(w, a, 'sword', 0.35);
    cost(a, 2);
    w.events.push({ type: 'hit', x: t.x, y: t.y });
    if (t.alive) onHit(w, t, a, dmg);
  }

  function castSpell(w, u, spell, t) {
    if (u.status.burn > 0) { damage(w, u, 1, 'burn', u.status.burnBy); if (!u.alive) return; }
    train(w, u, 'magic', 0.8);
    w.events.push({ type: 'spell', spell, x: t.x, y: t.y, from: u.id });
    if (spell === 'heal') {
      t.hearts = Math.min(t.maxHearts, t.hearts + 2);
      like(t, u.id, 3);
      cost(u, 3);
      say(w, u, 'heal');
      return;
    }
    const lvl = power(u, 'magic');
    if (spell === 'poison') { t.status.poison = 4 + Math.floor(lvl / 10); t.status.poisonBy = u.id; say(w, u, 'cast_poison'); }
    if (spell === 'burn') { t.status.burn = 10; t.status.burnBy = u.id; say(w, u, 'cast_burn'); }
    if (spell === 'confuse') { t.status.confused = 6; say(w, u, 'cast_confuse'); }
    cost(u, 4);
    onHit(w, t, u, 0.5);
  }

  // ------------------------------------------------------------ kingdoms
  function foundKingdom(w, founder, members, cx, cy) {
    const rng = w.rng;
    const id = w.nextKid++;
    const color = K.names.pickKingdomColor(rng, w.usedHues);
    w.usedHues.push(color.hue);
    const k = {
      id, name: K.names.makeName(rng, w.usedNames), color, cx, cy, ruler: founder.id,
      members: new Set(), granary: { bread: 2 * members.length + 2, meat: 0, meals: [] }, farms: [],
      rel: new Map(), wars: new Set(), warSince: new Map(), lastWarEnd: -999, warDead: 0,
      need: {}, counts: {}, siege: 0, founded: w.time,
    };
    w.kingdoms.set(id, k);
    const castleKey = cy * w.w + cx;
    const squatter = w.animalAt.get(castleKey);   // an animal standing there steps aside
    if (squatter) {
      w.animalAt.delete(castleKey);
      const spot = freeSpotNear(w, cx, cy, 3);
      if (spot) { squatter.x = squatter.px = spot[0]; squatter.y = squatter.py = spot[1]; w.animalAt.set(spot[1] * w.w + spot[0], squatter); }
      else squatter.alive = false;
    }
    w.struct.add(castleKey);
    for (const m of members) joinKingdom(w, m, k, true);
    refreshNeeds(w, k);
    for (const m of w.rng.shuffle(members.slice())) { evaluateRole(w, m, true); refreshNeeds(w, k); }
    chron(w, `{u:${founder.id}} founded the Kingdom of {k:${k.id}}.`);
    lifeLog(w, founder, `Founded the Kingdom of {k:${id}}.`);
    w.events.push({ type: 'found', k: id, x: cx, y: cy });
    return k;
  }

  function joinKingdom(w, u, k, silent) {
    if (u.kingdom === k.id) return;
    if (u.kingdom != null) leaveKingdom(w, u, 'moved');
    u.kingdom = k.id; k.members.add(u.id); u.joining = null;
    if (!silent) lifeLog(w, u, `Joined the Kingdom of {k:${k.id}}.`);
    u.role = null;
  }

  function leaveKingdom(w, u, reason) {
    const k = kingdomOf(w, u);
    if (!k) return;
    u.lastKingdom = k.id;
    k.members.delete(u.id); u.kingdom = null; u.role = null;
    for (const p of k.farms) if (p.owner === u.id) p.owner = null;
    u.carry.bread = 0;
    if (reason !== 'dissolve') {
      if (k.ruler === u.id) succeed(w, k);
      if (k.members.size <= 1) dissolveKingdom(w, k, 'It was too small to survive.');
    }
  }

  function succeed(w, k) {
    let best = null, bs = -1;
    for (const id of k.members) {
      const m = getU(w, id);
      if (!m || !m.alive) continue;
      const s = m.iv.charisma + 0.5 * m.iv.courage + w.rng() * 4;
      if (s > bs) { bs = s; best = m; }
    }
    if (best) {
      k.ruler = best.id;
      chron(w, `{u:${best.id}} now rules the Kingdom of {k:${k.id}}.`);
      lifeLog(w, best, `Became ruler of the Kingdom of {k:${k.id}}.`);
      say(w, best, 'succeed', null, true);
    } else k.ruler = null;
  }

  function removeStructures(w, k) {
    w.struct.delete(k.cy * w.w + k.cx);
    for (const p of k.farms) w.struct.delete(p.y * w.w + p.x);
  }

  function dissolveKingdom(w, k, why) {
    chron(w, `The Kingdom of {k:${k.id}} has fallen. ${why || ''}`.trim());
    for (const id of [...k.members]) {
      const m = getU(w, id);
      if (m && m.alive) leaveKingdom(w, m, 'dissolve');
    }
    for (const o of w.kingdoms.values()) { o.wars.delete(k.id); o.rel.delete(k.id); o.warSince.delete(k.id); }
    w.usedHues = w.usedHues.filter((h) => h !== k.color.hue);
    removeStructures(w, k);
    w.kingdoms.delete(k.id);
    w.events.push({ type: 'fell', k: k.id });
    // keep it findable by name in old chronicle lines
    w.fallen = w.fallen || new Map();
    w.fallen.set(k.id, k);
  }

  function refreshNeeds(w, k) {
    const n = k.members.size;
    const counts = {};
    for (const r of ROLE_KEYS) counts[r] = 0;
    for (const id of k.members) { const m = getU(w, id); if (m && m.role) counts[m.role]++; }
    const war = k.wars.size > 0;
    const food = foodPoints(k);
    const farmShare = food > n * 10 ? 0.15 : food < n * 3 ? 0.45 : 0.32;
    const huntShare = food > n * 10 ? 0.08 : 0.15;
    const target = {
      farmer: Math.max(1, Math.ceil(n * farmShare)),
      cook: n >= 6 ? Math.max(1, Math.ceil(n * 0.1)) : 0,
      hunter: Math.max(1, Math.ceil(n * huntShare)),
      swordsman: n >= 4 ? Math.ceil(n * (war ? 0.45 : 0.2)) : 0,
      mage: n >= 8 ? 1 + Math.floor(n / 12) : 0,
      poet: n >= 7 ? 1 : 0,
    };
    // staying fed matters more than anything: farmers and hunters weigh heavily
    const weight = { farmer: food < n * 3 ? 2.2 : 1.5, hunter: 1.1, cook: 0.8, swordsman: war ? 1.2 : 0.7, mage: 0.7, poet: 0.6 };
    for (const r of ROLE_KEYS) {
      const t = target[r];
      k.need[r] = t === 0 ? -0.9 : clamp((t - counts[r]) / t, -0.4, 1.2) * weight[r];
    }
    k.counts = counts; k.target = target;
  }

  function relations(w, k) {
    const ruler = getU(w, k.ruler);
    const temp = ruler ? ruler.iv.temperament : 15;
    let candidate = null;
    for (const o of w.kingdoms.values()) {
      if (o === k) continue;
      let rel = k.rel.get(o.id) || 0;
      const d = cheb(k.cx, k.cy, o.cx, o.cy);
      let delta = 0;
      if (d < 28) delta -= 0.12 + (temp / 31) * 0.55;
      else delta += 0.2;
      const hungry = foodPoints(k) < k.members.size * 0.6, rich = foodPoints(o) > o.members.size * 2;
      if (hungry && rich && d < 40) delta -= 0.4;
      if (temp < 8) delta += 0.9;
      if (k.wars.has(o.id)) delta += 0.9;
      rel = clamp(rel + delta, -100, 100);
      k.rel.set(o.id, rel);
      if (!k.wars.has(o.id) && !o.wars.has(k.id) && w.time - k.lastWarEnd > 100 && w.time - o.lastWarEnd > 100) {
        const soldiers = (k.counts.swordsman || 0) + (k.counts.mage || 0);
        if (rel < -35 && (temp >= 10 || rel < -60) && k.members.size >= 6 && o.members.size >= 5 && soldiers >= 1 && (!candidate || rel < candidate.rel)) candidate = { o, rel };
      }
      if (k.wars.has(o.id)) {
        const since = w.time - (k.warSince.get(o.id) || 0);
        const ro = getU(w, o.ruler);
        const calm = (temp + (ro ? ro.iv.temperament : 15)) / 2;
        const tired = k.warDead >= Math.max(2, k.members.size * 0.3) && w.rng.chance(0.3);
        const avg = (rel + (o.rel.get(k.id) || 0)) / 2;
        if (tired || avg > -12 || (since > 150 && w.rng.chance(0.04 * (1 - calm / 40)))) endWar(w, k, o);
      }
    }
    // one war at a time
    if (candidate && !k.wars.size && !candidate.o.wars.size && w.rng.chance(0.5)) declareWar(w, k, candidate.o);
  }

  function declareWar(w, a, b) {
    a.wars.add(b.id); b.wars.add(a.id);
    a.warSince.set(b.id, w.time); b.warSince.set(a.id, w.time);
    a.warDead = b.warDead = 0;
    a.rel.set(b.id, Math.min(a.rel.get(b.id) || 0, -50)); b.rel.set(a.id, Math.min(b.rel.get(a.id) || 0, -50));
    chron(w, `The Kingdom of {k:${a.id}} declared war on the Kingdom of {k:${b.id}}!`);
    const r = getU(w, a.ruler);
    if (r) say(w, r, 'war_declare', null, true);
    w.events.push({ type: 'war', a: a.id, b: b.id });
  }
  function endWar(w, a, b) {
    a.wars.delete(b.id); b.wars.delete(a.id);
    a.lastWarEnd = b.lastWarEnd = w.time;
    a.rel.set(b.id, -8); b.rel.set(a.id, -8);
    chron(w, `Peace returns between the Kingdom of {k:${a.id}} and the Kingdom of {k:${b.id}}.`);
    w.events.push({ type: 'peace', a: a.id, b: b.id });
    for (const k of [a, b]) {
      const r = getU(w, k.ruler);
      if (r) say(w, r, 'peace', null, true);
      for (const id of k.members) { const m = getU(w, id); if (m) m.fight = m.fight && m.fight.reason === 'war' ? null : m.fight; }
    }
  }

  function updateKingdoms(w) {
    for (const k of [...w.kingdoms.values()]) {
      if (!w.kingdoms.has(k.id)) continue;
      // crops grow
      for (const p of k.farms) {
        if (p.state === 'growing') {
          const o = getU(w, p.owner);
          const bonus = o && o.alive ? clamp(power(o, 'farming') * 0.25, 0, 12) : 0;
          p.growth += 1 / (32 - bonus);
          if (p.growth >= 1) { p.growth = 1; p.state = 'ready'; }
        }
      }
      if (w.time % 5 === k.id % 5) refreshNeeds(w, k);
      if (w.time % 10 === k.id % 10) relations(w, k);
      // sieges: enemies sit in the capital and nobody defends it
      if (k.wars.size) {
        let enemies = 0, defenders = 0;
        for (const u of w.alive) {
          const d = cheb(u.x, u.y, k.cx, k.cy);
          if (u.kingdom === k.id && d <= 7) defenders++;
          else if (u.kingdom != null && k.wars.has(u.kingdom) && d <= 4) enemies++;
        }
        if (enemies >= 2 && defenders === 0) k.siege++; else k.siege = Math.max(0, k.siege - 1);
        if (k.siege >= 12) { conquer(w, k); continue; }
      }
      if (k.ruler == null || !getU(w, k.ruler) || !getU(w, k.ruler).alive) succeed(w, k);
      if (k.members.size <= 1) dissolveKingdom(w, k, 'Too few were left.');
    }
  }

  function conquer(w, k) {
    // the strongest enemy kingdom present takes the land
    const tally = new Map();
    for (const u of w.alive) {
      if (u.kingdom != null && k.wars.has(u.kingdom) && cheb(u.x, u.y, k.cx, k.cy) <= 6) tally.set(u.kingdom, (tally.get(u.kingdom) || 0) + 1);
    }
    let win = null, wc = 0;
    for (const [kid, c] of tally) if (c > wc) { wc = c; win = getK(w, kid); }
    chron(w, `The Kingdom of {k:${k.id}} was overrun${win ? ` by the Kingdom of {k:${win.id}}` : ''}.`);
    const members = [...k.members].map((id) => getU(w, id)).filter((m) => m && m.alive);
    const name = k.id;
    for (const m of members) leaveKingdom(w, m, 'dissolve');
    for (const m of members) {
      if (win && win.members.size < 34 && m.iv.loyalty < 20 && w.rng.chance(0.55)) {
        joinKingdom(w, m, win);
        lifeLog(w, m, `Bowed to the Kingdom of {k:${win.id}} after {k:${name}} fell.`);
      } else lifeLog(w, m, `Lost their home when {k:${name}} fell.`);
      m.fight = null;
    }
    for (const o of w.kingdoms.values()) { o.wars.delete(k.id); o.rel.delete(k.id); o.warSince.delete(k.id); }
    w.usedHues = w.usedHues.filter((h) => h !== k.color.hue);
    removeStructures(w, k);
    w.kingdoms.delete(k.id);
    w.fallen = w.fallen || new Map();
    w.fallen.set(k.id, k);
    w.events.push({ type: 'fell', k: k.id });
  }

  // free units that stand near each other can raise a kingdom
  function foundingCheck(w) {
    if (w.kingdoms.size >= 9) return;
    const free = w.alive.filter((u) => u.kingdom == null && u.alive);
    const used = new Set();
    w.rng.shuffle(free);
    for (const u of free) {
      if (used.has(u.id)) continue;
      const group = free.filter((v) => v !== u && !used.has(v.id) && cheb(u.x, u.y, v.x, v.y) <= 7 && aff(u, v.id) > -25 && aff(v, u.id) > -25);
      if (group.length < 2) continue;
      if (!w.rng.chance(0.4)) continue;
      const crew = [u].concat(group.slice(0, 7));
      let cx = Math.round(crew.reduce((s, m) => s + m.x, 0) / crew.length);
      let cy = Math.round(crew.reduce((s, m) => s + m.y, 0) / crew.length);
      cx = clamp(cx, 4, w.w - 5); cy = clamp(cy, 4, w.h - 5);
      let ok = true;
      for (const o of w.kingdoms.values()) if (cheb(cx, cy, o.cx, o.cy) < 15) ok = false;
      if (!ok) continue;
      crew.sort((a, b) => b.iv.charisma + b.iv.courage * 0.3 - (a.iv.charisma + a.iv.courage * 0.3));
      const founder = crew[0];
      const k = foundKingdom(w, founder, crew, cx, cy);
      say(w, founder, 'found', null, true);
      for (const m of crew.slice(1, 3)) say(w, m, 'found_reply', null, true);
      for (const m of crew) used.add(m.id);
      for (const m of crew) m.wanderTo = null;
    }
  }

  // ------------------------------------------------------------ unit update
  function updateUnit(w, u) {
    if (u.status.poison > 0) {
      u.status.poison--;
      if (w.time % 2 === 0) damage(w, u, 1, 'poison', u.status.poisonBy);
      if (!u.alive) return;
    }
    if (u.status.burn > 0) u.status.burn--;
    if (u.status.confused > 0) u.status.confused--;
    if (w.time % 10 === 0) u.hunger = Math.max(0, u.hunger - 0.5);
    if (u.hunger <= 0) {
      u.starve++;
      if (u.starve % 2 === 0) damage(w, u, 1, 'hunger');
      if (!u.alive) return;
      if (u.starve === 1) say(w, u, 'starving', null, true);
    } else u.starve = 0;
    u.anger = Math.max(0, u.anger - (u.iv.temperament > 20 ? 0.6 : 1));
    if (u.hunger <= 0 && u.anger < 60) u.anger += 2; // starving makes everyone short-tempered
    if ((w.time + u.id) % 30 === 0) slowUpdate(w, u);
    if (!u.alive) return;
    if (u.cd > 0) { u.cd--; return; }
    act(w, u);
  }

  // Things that change slowly: interests, forgiveness, loyalty, love.
  function slowUpdate(w, u) {
    const rng = w.rng;
    // sudden new interests
    const c = u.iv.curiosity / 31;
    if (rng.chance(0.012 + 0.07 * c * c)) {
      const others = ROLE_KEYS.filter((r) => r !== u.interest);
      const r = rng.pick(others);
      u.bias[r] += rng.range(0.15, 0.5);
      const ni = computeInterest(u);
      if (ni !== u.interest) {
        const old = u.interest;
        u.interest = ni;
        lifeLog(w, u, `Lost interest in ${ROLES[old].likes}, and became drawn to ${ROLES[ni].likes}.`);
        say(w, u, 'new_interest', { w: ROLES[ni].likes });
      }
    }
    // forgiveness
    for (const [id, m] of Object.entries(u.memory)) {
      if (m.aff < 0 && m.aff > -80) {
        m.aff = Math.min(0, m.aff + 1.2);
        if ((m.betrayer || m.hurt) && m.aff > -12 && rng.chance(0.4)) {
          m.betrayer = false; m.hurt = false; m.killer = false;
          const o = getU(w, +id);
          if (o && o.alive) { u.forgave.push(+id); lifeLog(w, u, `Forgave {u:${id}}.`); if (cheb(u.x, u.y, o.x, o.y) < 6) say(w, u, 'forgive', { n: o.name }); }
        }
      }
    }
    // the kingdom
    const k = kingdomOf(w, u);
    if (k) {
      evaluateRole(w, u);
      const ruler = getU(w, k.ruler);
      let hard = 0;
      if (foodPoints(k) < 1 && u.hunger <= 2) hard += 1;
      if (ruler && ruler !== u && aff(u, ruler.id) < -30) hard += 1;
      const l = u.iv.loyalty / 31;
      const p = hard ? Math.pow(1 - l, 1.5) * 0.35 * hard : 0.0007 * (1 - l);
      if (rng.chance(p)) defect(w, u, k);
    } else {
      // free units look for a kingdom to join
      if (!u.joining && w.kingdoms.size && rng.chance(0.28)) {
        let best = null, bd = 99;
        for (const o of w.kingdoms.values()) {
          const d = cheb(u.x, u.y, o.cx, o.cy);
          const ruler = getU(w, o.ruler);
          if (d < 32 && d < bd && o.members.size < 30 && !(u.noJoin[o.id] > w.time) && (!ruler || aff(ruler, u.id) > -20) && !(u.memory[o.ruler] && u.memory[o.ruler].aff < -25)) { best = o; bd = d; }
        }
        if (best) { u.joining = best.id; goal(w, u, 'join', null); }
      }
    }
    // love, quarrels and endings
    if (u.partner != null) {
      const p = getU(w, u.partner);
      if (!p || !p.alive) u.partner = null;
      else if (u.id < p.id) {
        // love needs upkeep: it fades when partners barely see each other or clash
        const apart = cheb(u.x, u.y, p.x, p.y) > 8;
        const wear = (apart ? 2.5 : 0.8) + Math.max(0, ((u.iv.temperament + p.iv.temperament) / 2 - 14) / 5);
        like(u, p.id, -wear); like(p, u.id, -wear);
        const lowest = Math.min(aff(u, p.id), aff(p, u.id));
        if (lowest < 32 && rng.chance(0.4)) {
          u.partner = null; p.partner = null; u.exes.push(p.id); p.exes.push(u.id);
          lifeLog(w, u, `Parted ways with {u:${p.id}}.`); lifeLog(w, p, `Parted ways with {u:${u.id}}.`);
          chron(w, `{u:${u.id}} and {u:${p.id}} parted ways.`);
          say(w, u, 'divorce', null, true);
        }
      }
    }
  }

  function defect(w, u, k) {
    const wasRuler = k.ruler === u.id;
    for (const id of k.members) {
      const m = getU(w, id);
      if (!m || m === u || !m.alive) continue;
      if (aff(m, u.id) >= 15) { like(m, u.id, -35); mem(m, u.id).betrayer = true; }
    }
    const r = getU(w, k.ruler);
    if (r && r !== u) { like(r, u.id, -30); mem(r, u.id).betrayer = true; }
    chron(w, `{u:${u.id}} abandoned the Kingdom of {k:${k.id}}.`);
    say(w, u, 'defect', null, true);
    lifeLog(w, u, `Left the Kingdom of {k:${k.id}}.`);
    leaveKingdom(w, u, 'left');
    u.noJoin[k.id] = w.time + 250;
    if (!wasRuler && r && r.alive) say(w, r, 'traitor');
    u.joining = null;
  }

  // ------------------------------------------------------------ actions
  function act(w, u) {
    if (u.status.confused > 0) return actConfused(w, u);
    if (u.flee && actFlee(w, u)) return;
    if (u.fight && actFight(w, u)) return;
    if (u.hunger <= 2 && actEat(w, u)) return;
    if (actBrawl(w, u)) return;
    if (actIntervene(w, u)) return;
    if (actWar(w, u)) return;
    if (u.role === 'mage' && actHealAlly(w, u)) return;
    if (u.hunger <= 3.5 && u.pocket >= 1 && actEat(w, u)) return;
    if (actSocial(w, u)) return;
    if (actWork(w, u)) return;
    actWander(w, u);
  }

  function actConfused(w, u) {
    goal(w, u, 'confused', 'confused', null, true);
    const near = w.alive.filter((o) => o !== u && cheb(u.x, u.y, o.x, o.y) <= 1);
    if (near.length && w.rng.chance(0.45)) { attack(w, u, w.rng.pick(near)); return; }
    stepToward(w, u, u.x + w.rng.int(-2, 2), u.y + w.rng.int(-2, 2));
    cost(u, 1);
  }

  function actFlee(w, u) {
    const f = u.flee;
    const from = getU(w, f.from);
    if (!from || !from.alive || w.time > f.until || dist(u.x, u.y, from.x, from.y) > 9) { u.flee = null; return false; }
    stepAway(w, u, from.x, from.y);
    cost(u, 1);
    return true;
  }

  function actFight(w, u) {
    const f = u.fight;
    const t = getU(w, f.target);
    if (!t || !t.alive || dist(u.x, u.y, t.x, t.y) > 18) { u.fight = null; return false; }
    if ((f.reason === 'revenge' || f.reason === 'brawl') && u.anger < 15) { u.fight = null; say(w, u, 'calmed'); return false; }
    if (f.reason === 'defend' && t.anger < 15 && !(t.status.confused > 0)) { u.fight = null; return false; }
    // run if badly hurt and not very brave
    const soldier = f.reason === 'war' && u.iv.courage >= 14;
    if (u.hearts < u.maxHearts * 0.3 && u.iv.courage < 22 && !soldier) {
      u.fight = null; u.flee = { from: t.id, until: w.time + 8 };
      say(w, u, 'flee', null, true);
      return actFlee(w, u);
    }
    const d = cheb(u.x, u.y, t.x, t.y);
    // mages use spells from a distance
    if (u.role === 'mage' && u.spells.size && dist(u.x, u.y, t.x, t.y) <= 5) {
      const pick = [];
      if (u.spells.has('poison') && !t.status.poison) pick.push('poison');
      if (u.spells.has('burn') && !t.status.burn) pick.push('burn');
      if (u.spells.has('confuse') && !t.status.confused && w.rng.chance(0.35)) pick.push('confuse');
      if (pick.length) { castSpell(w, u, w.rng.pick(pick), t); return true; }
    }
    if (d > 1) { stepToward(w, u, t.x, t.y); cost(u, 1); return true; }
    attack(w, u, t);
    if (!t.alive) u.fight = null;
    return true;
  }

  // ----- eating
  function eatPoints(w, u, points) {
    const deficit = 5 - u.hunger;
    const gain = Math.min(points, deficit);
    if (gain <= 0) return 0;
    u.hunger += gain;
    u.hearts = Math.min(u.maxHearts, u.hearts + gain); // food heals, but only if they were hungry
    cost(u, Math.max(1, Math.ceil(gain)));
    return gain;
  }
  function takeFood(k, deficit) {
    const g = k.granary;
    if (g.meals.length && deficit >= 2) {
      let idx = -1;
      for (let i = 0; i < g.meals.length; i++) if (g.meals[i] <= deficit + 1 && (idx < 0 || g.meals[i] > g.meals[idx])) idx = i;
      if (idx >= 0) return g.meals.splice(idx, 1)[0];
    }
    if (g.meat > 0) { const p = Math.min(g.meat, Math.ceil(deficit)); g.meat -= p; return p; }
    if (g.bread > 0) { const p = Math.min(g.bread, Math.ceil(deficit)); g.bread -= p; return p; }
    if (g.meals.length) return g.meals.pop();
    return 0;
  }
  function mayBeg(w, u, o) {
    const home = kingdomOf(w, u);
    if (home && (atWar(w, home.id, o.id) || (home.rel.get(o.id) || 0) < -25)) return false;
    const ruler = getU(w, o.ruler);
    if (ruler && aff(ruler, u.id) < -20) return false;
    return foodPoints(o) > o.members.size * 1.2 + 2;
  }

  function actEat(w, u) {
    const deficit = 5 - u.hunger;
    if (u.pocket >= 1 && deficit >= 1) {
      goal(w, u, 'eatpocket', 'eat_pocket');
      const gain = eatPoints(w, u, u.pocket);
      u.pocket = Math.max(0, u.pocket - gain);
      return gain > 0;
    }
    const radius = u.hunger <= 1 ? 50 : u.hunger <= 2 ? 24 : 0;
    if (!radius) return false;
    const home = kingdomOf(w, u);
    let best = null, bd = 1e9;
    if (home && foodPoints(home) > 0) {
      const d = cheb(u.x, u.y, home.cx, home.cy);
      if (d <= radius + 12) { best = { type: 'granary', k: home }; bd = d; }
    }
    for (const o of w.kingdoms.values()) {
      if (o === home || !mayBeg(w, u, o)) continue;
      const d = cheb(u.x, u.y, o.cx, o.cy) + 4;
      if (d <= radius && d < bd) { best = { type: 'granary', k: o, foreign: true }; bd = d; }
    }
    const pen = u.role === 'hunter' ? 0 : 6;
    for (const a of w.animals) {
      if (!a.alive) continue;
      const d = cheb(u.x, u.y, a.x, a.y) + pen;
      if (d <= radius && d < bd) { best = { type: 'animal', a }; bd = d; }
    }
    if (!best) {
      goal(w, u, 'hungry', u.hunger <= 1 ? 'starving' : 'hungry', null, u.hunger <= 1);
      return false;
    }
    if (best.type === 'granary') {
      const k = best.k;
      goal(w, u, 'granary' + k.id, best.foreign ? 'beg' : 'eat_granary', null, u.hunger <= 1);
      const r = goNear(w, u, k.cx, k.cy, 2);
      if (r === 'arrived') {
        const pts = takeFood(k, deficit);
        if (pts > 0) {
          if (best.foreign) { const ruler = getU(w, k.ruler); if (ruler && ruler.alive) say(w, ruler, 'give'); like(u, k.ruler, 5); }
          eatPoints(w, u, pts);
        } else cost(u, 1);
      } else cost(u, 1);
      return true;
    }
    const a = best.a;
    goal(w, u, 'prey' + a.id, 'eat_hunt', null, u.hunger <= 1);
    huntAnimal(w, u, a);
    return true;
  }

  function huntAnimal(w, u, a) {
    const r = goNear(w, u, a.x, a.y, 1);
    if (r !== 'arrived') { cost(u, 1); return; }
    if (u.status.burn > 0) { damage(w, u, 1, 'burn', u.status.burnBy); if (!u.alive) return; }
    const dmg = 1 + power(u, 'hunting') / 22 + (u.role === 'hunter' ? 0.6 : 0.2) + power(u, 'sword') / 60;
    a.hp -= dmg;
    train(w, u, 'hunting', 0.45);
    cost(u, 2);
    w.events.push({ type: 'hit', x: a.x, y: a.y });
    if (a.hp <= 0) {
      a.alive = false;
      if (w.animalAt.get(a.y * w.w + a.x) === a) w.animalAt.delete(a.y * w.w + a.x);
      const limit = u.role === 'hunter' ? 7 : 4;
      u.pocket = Math.min(limit, u.pocket + a.food);
    }
  }

  // Hot tempers: someone already angry picks a fight with a rival standing close by.
  function actBrawl(w, u) {
    if (u.fight || u.anger < 45 || isMonk(u)) return false;
    let best = null, ba = 1e9;
    for (const o of w.alive) {
      if (o === u || cheb(u.x, u.y, o.x, o.y) > 4) continue;
      const a = aff(u, o.id);
      if (a < -15 && a < ba) { ba = a; best = o; }
    }
    if (!best) return false;
    u.fight = { target: best.id, reason: 'brawl' };
    goal(w, u, 'brawl' + best.id, 'brawl', null, true);
    return actFight(w, u);
  }

  // ----- fights between others
  function actIntervene(w, u) {
    if (u.fight || !w.aggress.length) return false;
    for (const g of w.aggress) {
      if (g.a === u.id || g.t === u.id) continue;
      const a = getU(w, g.a), v = getU(w, g.t);
      if (!a || !v || !a.alive || !v.alive) continue;
      if (cheb(u.x, u.y, v.x, v.y) > 8) continue;
      const kin = (u.kingdom != null && v.kingdom === u.kingdom) || aff(u, v.id) >= 35 || u.partner === v.id;
      if (!kin) continue;
      if (a.kingdom != null && a.kingdom !== u.kingdom && atWar(w, u.kingdom, a.kingdom)) continue;
      if (u.partner === a.id || (aff(u, a.id) >= 60 && u.kingdom === a.kingdom && aff(u, v.id) < 60)) continue;
      if (isMonk(u)) { u.mediate = { target: a.id, until: w.time + 12 }; goal(w, u, 'mediate' + a.id, 'mediate', null, true); return actMediate(w, u); }
      if (u.iv.courage < 6 || u.hearts < u.maxHearts * 0.4) continue;
      u.fight = { target: a.id, reason: 'defend' };
      goal(w, u, 'defend' + a.id, 'defend', null, true);
      return actFight(w, u);
    }
    if (u.mediate) return actMediate(w, u);
    return false;
  }
  function actMediate(w, u) {
    const m = u.mediate;
    const t = m && getU(w, m.target);
    if (!t || !t.alive || w.time > m.until) { u.mediate = null; return false; }
    if (t.anger < 15) { u.mediate = null; return false; }
    if (cheb(u.x, u.y, t.x, t.y) > 1) { stepToward(w, u, t.x, t.y); cost(u, 1); return true; }
    t.anger = Math.max(0, t.anger - (14 + u.iv.charisma * 0.5));
    like(t, u.id, 1);
    if (t.anger < 15) { if (t.fight && t.fight.reason !== 'war') { t.fight = null; say(w, t, 'calmed', null, true); } u.mediate = null; }
    train(w, u, 'poetry', 0.1);
    cost(u, 1);
    return true;
  }

  // ----- war
  function actWar(w, u) {
    const k = kingdomOf(w, u);
    if (!k || !k.wars.size) return false;
    const soldier = u.role === 'swordsman' || u.role === 'mage';
    // nearest enemy
    let enemy = null, ed = 1e9;
    for (const o of w.alive) {
      if (o.kingdom == null || !k.wars.has(o.kingdom)) continue;
      const d = cheb(u.x, u.y, o.x, o.y);
      if (d < ed) { ed = d; enemy = o; }
    }
    if (!soldier) {
      if (enemy && ed <= 6) {
        if (u.iv.courage >= 10 && !isMonk(u) && u.hearts > u.maxHearts * 0.5) {
          u.fight = { target: enemy.id, reason: 'war' }; goal(w, u, 'wardefend', 'war_defend', null, true);
          return actFight(w, u);
        }
        stepAway(w, u, enemy.x, enemy.y); cost(u, 1); return true;
      }
      return false;
    }
    if (isMonk(u) && u.role !== 'mage') return false;
    if (u.hearts < u.maxHearts * 0.35 && u.iv.courage < 22) {
      goal(w, u, 'retreat', null);
      if (cheb(u.x, u.y, k.cx, k.cy) > 2) { stepToward(w, u, k.cx, k.cy); cost(u, 1); return true; }
      return false;
    }
    goal(w, u, 'war', 'war_march', null, true);
    if (enemy && ed <= 30) {
      u.fight = { target: enemy.id, reason: 'war' };
      return actFight(w, u);
    }
    // march on the nearest enemy capital
    let tk = null, td = 1e9;
    for (const id of k.wars) { const o = getK(w, id); if (!o) continue; const d = cheb(u.x, u.y, o.cx, o.cy); if (d < td) { td = d; tk = o; } }
    if (tk) { if (td > 3) { stepToward(w, u, tk.cx, tk.cy); cost(u, 1); return true; } }
    return false;
  }

  // ----- mages heal people
  function actHealAlly(w, u) {
    if (!u.spells.has('heal')) return false;
    let best = null, bd = 1e9;
    for (const o of w.alive) {
      if (o.hearts > o.maxHearts - 1.5) continue;
      const kin = o === u || (u.kingdom != null && o.kingdom === u.kingdom) || aff(u, o.id) >= 30;
      if (!kin) continue;
      const d = cheb(u.x, u.y, o.x, o.y) + (o === u ? 2 : 0);
      if (d < bd && d <= 14) { bd = d; best = o; }
    }
    if (!best) return false;
    goal(w, u, 'heal', 'heal');
    if (dist(u.x, u.y, best.x, best.y) <= 3 || best === u) { castSpell(w, u, 'heal', best); return true; }
    stepToward(w, u, best.x, best.y); cost(u, 1);
    return true;
  }

  // ----- social life
  function actSocial(w, u) {
    const rng = w.rng;
    // partners keep each other company
    if (u.partner != null) {
      const p = getU(w, u.partner);
      if (p && p.alive && cheb(u.x, u.y, p.x, p.y) > 7 && rng.chance(0.4) && !u.visit) { stepToward(w, u, p.x, p.y); cost(u, 1); return true; }
    }
    // visiting a friend
    if (u.visit) {
      const f = getU(w, u.visit.id);
      if (!f || !f.alive || w.time > u.visit.until || atWar(w, u.kingdom, f.kingdom)) { u.visit = null; }
      else {
        if (cheb(u.x, u.y, f.x, f.y) <= 2) {
          if (!u.visit.met) { u.visit.met = true; u.visit.until = Math.min(u.visit.until, w.time + 14); }
          chat(w, u, f); return true;
        }
        stepToward(w, u, f.x, f.y); cost(u, 1); return true;
      }
    }
    // chatting with whoever is near
    if (u.talkCd > 0) u.talkCd--;
    if (u.talkCd <= 0) {
      let near = null, nd = 99;
      for (const o of w.alive) {
        if (o === u) continue;
        const d = cheb(u.x, u.y, o.x, o.y);
        if (d <= 2 && d < nd && aff(u, o.id) > -30 && !atWar(w, u.kingdom, o.kingdom) && !o.fight && !o.flee) { nd = d; near = o; }
      }
      if (near && rng.chance(0.2 + 0.5 * u.iv.sociability / 31)) { chat(w, u, near); return true; }
    }
    // go and see an old friend
    if (!u.visit && !u.fight && u.iv.sociability >= 12 && rng.chance(0.004 + 0.01 * u.iv.sociability / 31) && u.hunger > 2.5) {
      let best = null, bd = 0;
      for (const [id, m] of Object.entries(u.memory)) {
        if (m.aff < 40) continue;
        const f = getU(w, +id);
        if (!f || !f.alive || atWar(w, u.kingdom, f.kingdom)) continue;
        const d = cheb(u.x, u.y, f.x, f.y);
        if (d > 14 && d > bd) { bd = d; best = f; }
      }
      if (best) {
        u.visit = { id: best.id, until: w.time + 70, met: false };
        goal(w, u, 'visit' + best.id, 'visit', { n: best.name });
        lifeLog(w, u, `Set out to visit {u:${best.id}}.`);
        stepToward(w, u, best.x, best.y); cost(u, 1);
        return true;
      }
    }
    // a child
    if (u.partner != null && tryChild(w, u)) return true;
    // asking someone to teach them
    if (!u.learning && u.role && w.rng.chance(0.03)) lookForMaster(w, u);
    if (u.learning) {
      const m = getU(w, u.learning.mentor);
      if (!m || !m.alive || w.time > u.learning.until) { u.learning = null; }
      else {
        if (cheb(u.x, u.y, m.x, m.y) > 1) { stepToward(w, u, m.x, m.y); cost(u, 1); return true; }
        train(w, u, u.learning.skill, 1.0);
        train(w, m, u.learning.skill, 0.2);
        like(u, m.id, 0.6); like(m, u.id, 0.4);
        cost(u, 2);
        return true;
      }
    }
    return false;
  }

  function chat(w, u, o) {
    const rng = w.rng;
    u.talkCd = 7 + rng.int(0, 7);
    const gain = (u.partner === o.id ? 1.4 : 1.5) + u.iv.charisma / 31 + (u.iv.sociability / 31);
    like(u, o.id, gain); like(o, u.id, gain * 0.8);
    cost(u, 1);
    // talk about what matters
    if (u.hunger <= 2) say(w, u, 'hungry', null);
    else if (u.partner == null && o.partner == null && aff(u, o.id) >= 45 && aff(o, u.id) >= 30 && u.loveCd <= w.time && rng.chance(0.3)) confess(w, u, o);
    else if (u.partner === o.id && rng.chance(0.18)) {
      const t = (u.iv.temperament + o.iv.temperament) / 62;
      if (rng.chance(0.2 + t * 0.6)) { like(u, o.id, -9); like(o, u.id, -9); u.anger += 8; say(w, u, 'argue'); }
      else say(w, u, 'chat');
    } else if (u.role === 'poet' && rng.chance(0.4)) say(w, u, 'poem');
    else if (rng.chance(0.4)) say(w, u, 'chat');
  }

  function confess(w, u, o) {
    const rng = w.rng;
    u.loveCd = w.time + 120;
    say(w, u, 'love_confess', { n: o.name }, true);
    const p = (aff(o, u.id) - 30) / 60 + (u.iv.charisma / 31) * 0.2;
    if (rng.chance(p)) {
      u.partner = o.id; o.partner = u.id; u.mourning = null; o.mourning = null;
      like(u, o.id, 10); like(o, u.id, 10);
      say(w, o, 'love_accept', null, true);
      lifeLog(w, u, `Fell in love with {u:${o.id}}.`); lifeLog(w, o, `Fell in love with {u:${u.id}}.`);
      chron(w, `{u:${u.id}} and {u:${o.id}} fell in love.`);
      w.events.push({ type: 'love', a: u.id, b: o.id });
    } else {
      like(u, o.id, -6);
      say(w, o, 'love_reject', null, true);
    }
  }

  function tryChild(w, u) {
    const p = getU(w, u.partner);
    if (!p || !p.alive || cheb(u.x, u.y, p.x, p.y) > 3) return false;
    if (u.id > p.id) return false; // only one parent triggers it
    if (w.alive.length >= w.maxPop) return false;
    if (aff(u, p.id) < 60 || aff(p, u.id) < 60) return false;
    if (u.children.length >= 3 || w.time - Math.max(u.lastChild, p.lastChild) < 140) return false;
    if (u.hunger < 2.5 || p.hunger < 2.5) return false;
    const k = kingdomOf(w, u) || kingdomOf(w, p);
    if (k && (foodPoints(k) < k.members.size * 0.8 || k.members.size >= 30)) return false;
    if (!w.rng.chance(0.03)) return false;
    const spot = freeSpotNear(w, u.x, u.y, 2);
    if (!spot) return false;
    const c = newUnit(w, spot[0], spot[1], [u, p]);
    c.hunger = 4.5;
    u.children.push(c.id); p.children.push(c.id);
    u.lastChild = p.lastChild = w.time;
    w.stats.births++;
    if (k) { joinKingdom(w, c, k, true); evaluateRole(w, c, true); }
    like(c, u.id, 40); like(c, p.id, 40); like(u, c.id, 40); like(p, c.id, 40);
    lifeLog(w, c, `Was born to {u:${u.id}} and {u:${p.id}}.`);
    lifeLog(w, u, `Welcomed a child, {u:${c.id}}.`); lifeLog(w, p, `Welcomed a child, {u:${c.id}}.`);
    chron(w, `{u:${c.id}} was born to {u:${u.id}} and {u:${p.id}}.`);
    say(w, u, 'child', null, true);
    w.events.push({ type: 'birth', id: c.id, x: c.x, y: c.y });
    cost(u, 2);
    return true;
  }

  function lookForMaster(w, u) {
    // sometimes they want to learn what they are secretly drawn to, not just their job
    const wantsInterest = u.interest && u.interest !== u.role && w.rng.chance(0.6);
    const skill = ROLES[wantsInterest ? u.interest : u.role].skill;
    const mine = power(u, skill);
    let best = null, bp = mine + 9;
    for (const o of w.alive) {
      if (o === u || cheb(u.x, u.y, o.x, o.y) > 25) continue;
      if (!((u.kingdom != null && o.kingdom === u.kingdom) || aff(u, o.id) >= 30)) continue;
      if (aff(u, o.id) < -10) continue;
      const p = power(o, skill);
      if (p > bp) { bp = p; best = o; }
    }
    if (!best) return false;
    u.learning = { mentor: best.id, skill, until: w.time + 28 };
    goal(w, u, 'learn' + best.id, 'teach_ask', { n: best.name });
    if (cheb(u.x, u.y, best.x, best.y) < 8) say(w, best, 'teach_ok');
    lifeLog(w, u, `Asked {u:${best.id}} to teach them ${WD.SKILL_NOUN[skill]}.`);
    return true;
  }

  // ----- work
  function actWork(w, u) {
    const k = kingdomOf(w, u);
    // wants to join a kingdom?
    if (u.joining) {
      const j = getK(w, u.joining);
      if (!j) u.joining = null;
      else {
        const r = goNear(w, u, j.cx, j.cy, 3);
        if (r === 'arrived') {
          const ruler = getU(w, j.ruler);
          say(w, u, 'join', null, true);
          if (ruler && ruler.alive) say(w, ruler, 'welcome');
          joinKingdom(w, u, j);
          refreshNeeds(w, j); evaluateRole(w, u, true);
          chron(w, `{u:${u.id}} joined the Kingdom of {k:${j.id}}.`);
          cost(u, 1);
          return true;
        }
        goal(w, u, 'join' + j.id, null);
        cost(u, 1);
        return true;
      }
    }
    if (!k) return actFreeLife(w, u);
    let did = false;
    switch (u.role) {
      case 'farmer': did = actFarm(w, u, k); break;
      case 'cook': did = actCook(w, u, k); break;
      case 'hunter': did = actHunt(w, u, k); break;
      case 'swordsman': did = actSoldier(w, u, k); break;
      case 'mage': did = actMage(w, u, k); break;
      case 'poet': did = actPoet(w, u, k); break;
      default: break;
    }
    if (did) return true;
    return actHobby(w, u);
  }

  function claimPlot(w, k, u) {
    let p = k.farms.find((f) => f.owner == null || !(getU(w, f.owner) && getU(w, f.owner).alive && getU(w, f.owner).role === 'farmer'));
    if (p) { p.owner = u.id; return p; }
    if (k.farms.length >= 14) return null;
    for (let t = 0; t < 30; t++) {
      const a = w.rng.range(0, Math.PI * 2), r = w.rng.range(3, 9);
      const x = clamp(Math.round(k.cx + Math.cos(a) * r), 1, w.w - 2), y = clamp(Math.round(k.cy + Math.sin(a) * r), 1, w.h - 2);
      let ok = cheb(x, y, k.cx, k.cy) >= 3 && !w.struct.has(y * w.w + x) && !w.animalAt.has(y * w.w + x);
      for (const o of w.kingdoms.values()) for (const f of o.farms) if (cheb(x, y, f.x, f.y) < 2) ok = false;
      if (!ok) continue;
      p = { x, y, owner: u.id, state: 'empty', growth: 0 };
      k.farms.push(p);
      w.struct.add(y * w.w + x);
      return p;
    }
    return null;
  }

  function actFarm(w, u, k) {
    if (u.carry.bread > 0) {
      goal(w, u, 'deliverbread', 'deliver_bread');
      const r = goNear(w, u, k.cx, k.cy, 2);
      if (r === 'arrived') { k.granary.bread += u.carry.bread; u.carry.bread = 0; train(w, u, 'farming', 0.3); }
      cost(u, 1);
      return true;
    }
    let plot = k.farms.find((p) => p.owner === u.id) || claimPlot(w, k, u);
    if (!plot) return false;
    if (plot.state === 'empty' && foodPoints(k) > k.members.size * 16) return false; // plenty stored
    if (plot.state === 'ready') {
      goal(w, u, 'harvest', 'harvest');
      if (goNear(w, u, plot.x, plot.y, 1) === 'arrived') {
        plot.state = 'empty'; plot.growth = 0;
        u.carry.bread = 4 + Math.floor(power(u, 'farming') / 10);
        train(w, u, 'farming', 1.0);
        cost(u, 3);
      } else cost(u, 1);
      return true;
    }
    if (plot.state === 'empty') {
      goal(w, u, 'plant', 'plant');
      if (goNear(w, u, plot.x, plot.y, 1) === 'arrived') {
        plot.state = 'growing'; plot.growth = 0.02;
        train(w, u, 'farming', 0.5);
        cost(u, 2);
      } else cost(u, 1);
      return true;
    }
    // growing: tend and wait
    goal(w, u, 'tend', 'tend');
    if (cheb(u.x, u.y, plot.x, plot.y) > 2) { stepToward(w, u, plot.x, plot.y); cost(u, 1); return true; }
    if (w.rng.chance(0.5)) { plot.growth = Math.min(1, plot.growth + 0.03); train(w, u, 'farming', 0.35); cost(u, 2); return true; }
    return false;
  }

  function actCook(w, u, k) {
    if (cheb(u.x, u.y, k.cx, k.cy) > 2) { goal(w, u, 'tocook', null); stepToward(w, u, k.cx, k.cy); cost(u, 1); return true; }
    const g = k.granary;
    if (g.bread >= 1 && (g.meat >= 1 || g.bread >= 3)) {
      goal(w, u, 'cook', 'cook');
      if (g.meat >= 1) { g.meat--; g.bread--; } else g.bread -= 2;
      g.meals.push(clamp(3 + Math.round(power(u, 'cooking') / 22), 3, 5));
      train(w, u, 'cooking', 1.0);
      cost(u, 3);
      return true;
    }
    if (w.rng.chance(0.15)) { train(w, u, 'cooking', 0.2); cost(u, 3); return true; }
    return false;
  }

  function actHunt(w, u, k) {
    if (u.pocket >= 2) {
      goal(w, u, 'delivermeat', 'deliver_meat');
      if (goNear(w, u, k.cx, k.cy, 2) === 'arrived') {
        const n = Math.floor(u.pocket);
        k.granary.meat += n; u.pocket -= n;
      }
      cost(u, 1);
      return true;
    }
    let best = null, bd = 36;
    for (const a of w.animals) {
      if (!a.alive) continue;
      const d = cheb(u.x, u.y, a.x, a.y);
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) {
      if (u.pocket >= 1 && cheb(u.x, u.y, k.cx, k.cy) > 2) { stepToward(w, u, k.cx, k.cy); cost(u, 1); return true; }
      return false;
    }
    goal(w, u, 'hunt', 'hunt');
    huntAnimal(w, u, best);
    return true;
  }

  function actSoldier(w, u, k) {
    if (cheb(u.x, u.y, k.cx, k.cy) > 9) { stepToward(w, u, k.cx, k.cy); cost(u, 1); return true; }
    if (w.rng.chance(0.55)) {
      goal(w, u, 'train', 'train');
      // spar with a nearby swordsman when there is one
      let mate = null;
      for (const o of w.alive) if (o !== u && o.role === 'swordsman' && o.kingdom === u.kingdom && cheb(u.x, u.y, o.x, o.y) <= 2) mate = o;
      train(w, u, 'sword', mate ? 0.9 : 0.6);
      cost(u, 2);
      return true;
    }
    return false;
  }

  function actMage(w, u, k) {
    if (cheb(u.x, u.y, k.cx, k.cy) > 10) { stepToward(w, u, k.cx, k.cy); cost(u, 1); return true; }
    if (w.rng.chance(0.55)) {
      goal(w, u, 'study', 'study');
      train(w, u, 'magic', 0.9);
      cost(u, 3);
      return true;
    }
    return false;
  }

  function actPoet(w, u, k) {
    if (cheb(u.x, u.y, k.cx, k.cy) > 10) { stepToward(w, u, k.cx, k.cy); cost(u, 1); return true; }
    if (w.rng.chance(0.4)) {
      goal(w, u, 'poem', 'poem');
      train(w, u, 'poetry', 0.9);
      // verses calm the people around
      for (const o of w.alive) {
        if (o === u || cheb(u.x, u.y, o.x, o.y) > 3) continue;
        o.anger = Math.max(0, o.anger - 6); like(o, u.id, 1);
      }
      cost(u, 3);
      return true;
    }
    return false;
  }

  // Doing what they are interested in, even when it is not their job.
  function actHobby(w, u) {
    if (!u.interest) return false;
    if (u.role && u.interest === u.role) return false;
    if (!w.rng.chance(0.18)) return false;
    const r = ROLES[u.interest];
    const skill = r.skill;
    goal(w, u, 'hobby' + u.interest, null);
    train(w, u, skill, 0.45);
    if (u.interest === 'poet' && w.rng.chance(0.4)) say(w, u, 'poem');
    cost(u, 3);
    return true;
  }

  // Free units: hunt on their own, practice, and wander together
  function actFreeLife(w, u) {
    if (w.rng.chance(0.08) && u.interest) {
      const skill = ROLES[u.interest].skill;
      train(w, u, skill, 0.4);
      cost(u, 3);
      return true;
    }
    return false;
  }

  function actWander(w, u) {
    const rng = w.rng;
    const k = kingdomOf(w, u);
    if (u.wanderTo) {
      const [tx, ty] = u.wanderTo;
      if (cheb(u.x, u.y, tx, ty) <= 0 || rng.chance(0.04)) { u.wanderTo = null; cost(u, rng.int(1, 3)); return true; }
      if (!stepToward(w, u, tx, ty)) u.wanderTo = null;
      cost(u, 1);
      return true;
    }
    let tx, ty;
    if (k) {
      const r = Math.min(14, 5 + k.members.size * 0.5);
      const a = rng.range(0, Math.PI * 2), d = rng.range(1, r);
      tx = Math.round(k.cx + Math.cos(a) * d); ty = Math.round(k.cy + Math.sin(a) * d);
    } else {
      // free units drift toward other free units
      let mate = null, md = 16;
      for (const o of w.alive) {
        if (o === u || o.kingdom != null) continue;
        const d = cheb(u.x, u.y, o.x, o.y);
        if (d > 2 && d < md && aff(u, o.id) > -20) { md = d; mate = o; }
      }
      if (mate && rng.chance(0.65)) { tx = mate.x + rng.int(-2, 2); ty = mate.y + rng.int(-2, 2); }
      else { tx = u.x + rng.int(-8, 8); ty = u.y + rng.int(-8, 8); }
    }
    u.wanderTo = [clamp(tx, 0, w.w - 1), clamp(ty, 0, w.h - 1)];
    cost(u, 1);
    return true;
  }

  // ------------------------------------------------------------ the tick
  function tick(w) {
    w.time++;
    w.alive = w.alive.filter((u) => u.alive);
    for (const u of w.alive) { u.px = u.x; u.py = u.y; }
    w.aggress = w.aggress.filter((g) => w.time - g.t0 <= 3);
    updateAnimals(w);
    updateKingdoms(w);
    if (w.time % 5 === 0) foundingCheck(w);
    const order = w.rng.shuffle(w.alive.slice());
    for (const u of order) if (u.alive) updateUnit(w, u);
  }

  K.sim = {
    createWorld, tick, power, foodPoints, atWar,
    describe: (w, u) => WD.describe(u, w),
    IV_KEYS, SKILLS, ROLES,
  };
})();
