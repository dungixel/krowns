// Krowns - kingdoms: founding, borders, structures, building orders, citizens, succession.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const sim = K.sim;
  const S = K.S;
  const { clamp, cheb, dist } = K.util;
  const TAU = Math.PI * 2, NANG = 64;

  // ------------------------------------------------------------------ borders
  function radiusFor(W, k) {
    const n = k.citizens.size;
    return clamp(S('kingdom.baseRadius', 8) + S('kingdom.radiusPerCitizen', 0.25) * n, 3, S('kingdom.maxRadius', 15));
  }
  function ownerRadiusAt(k, x, y) {
    const a = Math.atan2(y - k.cy, x - k.cx);
    const i = ((Math.round((a / TAU) * NANG) % NANG) + NANG) % NANG;
    return k.radius + k.wob[i];
  }
  function recomputeKmap(W) {
    W.kmap = W.kmap || new Int32Array(W.w * W.h);
    W.kmap.fill(0);
    const best = new Float32Array(W.w * W.h).fill(1e9);
    for (const k of W.kingdoms.values()) {
      const R = k.radius + S('kingdom.borderWobble', 2) + 1;
      for (let y = Math.max(0, Math.floor(k.cy - R)); y <= Math.min(W.h - 1, Math.ceil(k.cy + R)); y++) {
        for (let x = Math.max(0, Math.floor(k.cx - R)); x <= Math.min(W.w - 1, Math.ceil(k.cx + R)); x++) {
          const d = dist(x, y, k.cx, k.cy);
          if (d <= ownerRadiusAt(k, x, y)) {
            const i = y * W.w + x;
            if (d < best[i]) { best[i] = d; W.kmap[i] = k.id; }
          }
        }
      }
    }
    // border tiles (the purple grass)
    const edges = [];
    for (let y = 0; y < W.h; y++) for (let x = 0; x < W.w; x++) {
      const o = W.kmap[y * W.w + x];
      if (!o) continue;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W.w || ny >= W.h) continue;
        if (W.kmap[ny * W.w + nx] !== o) { edge = true; break; }
      }
      if (edge) edges.push({ x, y, k: o });
    }
    W.edges = edges;
    W.kmapVersion = (W.kmapVersion || 0) + 1;
  }
  const kingdomAt = (W, x, y) => (sim.inb(W, x, y) && W.kmap ? W.kmap[y * W.w + x] : 0);
  const inKingdom = (W, k, x, y) => kingdomAt(W, x, y) === k.id;

  // ------------------------------------------------------------------ structures
  function structCenter(s) { return { x: s.x + (s.w - 1) / 2, y: s.y + (s.h - 1) / 2 }; }
  const structRange = (s) => (Math.max(s.w, s.h) - 1) / 2 + 1;

  function relocateOccupants(W, x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (!sim.inb(W, xx, yy)) continue;
      const id = W.unitAt[yy * W.w + xx];
      if (!id) continue;
      const e = W.byId.get(id);
      if (!e) { W.unitAt[yy * W.w + xx] = 0; continue; }
      const spot = sim.freeTileNear(W, xx, yy, 6, W.rng, (tx, ty) => tx < x || ty < y || tx >= x + w || ty >= y + h);
      sim.removeEntityFromGrid(W, e);
      if (spot) sim.placeEntity(W, e, spot[0], spot[1]); else sim.placeEntity(W, e, xx, yy);
      e.path = null;
    }
  }
  function createStructure(W, type, kid, x, y, o) {
    o = o || {};
    const def = K.struct(type);
    const w = def.w, h = def.h;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) sim.removeTree(W, xx, yy);
    relocateOccupants(W, x, y, w, h);
    const s = {
      id: W.nextId++, type, kingdom: kid, x, y, w, h, hearts: o.building ? 1 : def.hearts, maxHearts: def.hearts,
      building: !!o.building, progress: 0, buildSeconds: def.buildSeconds || 1, family: o.family || 0, stock: 0, hurtAt: -99,
    };
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) W.occ[yy * W.w + xx] = s.id;
    W.structures.set(s.id, s);
    sim.emit(W, 'structure', { id: s.id, type });
    return s;
  }
  function destroyStructure(W, s, why) {
    if (!W.structures.has(s.id)) return;
    for (let yy = s.y; yy < s.y + s.h; yy++) for (let xx = s.x; xx < s.x + s.w; xx++) if (W.occ[yy * W.w + xx] === s.id) W.occ[yy * W.w + xx] = 0;
    W.structures.delete(s.id);
    const k = W.kingdoms.get(s.kingdom);
    if (s.type === 'house') {
      const f = W.families.get(s.family);
      if (f && f.houseId === s.id) f.houseId = 0;
      for (const u of W.units) if (u.task && u.task.struct === s.id) u.task = null;
    }
    if (k) {
      if (k.theaterId === s.id) k.theaterId = 0;
      if (k.coliseumId === s.id) k.coliseumId = 0;
      k.orders = k.orders.filter((o) => o.structId !== s.id);
      if (s.type === 'castle') dissolveKingdom(W, k, why || 'its castle fell');
    }
    sim.log(W, 'A ' + K.struct(s.type).name.toLowerCase() + (k ? ' of ' + k.name : '') + ' was destroyed.', []);
    sim.emit(W, 'structureGone', { id: s.id });
  }
  function damageStructure(W, s, amount, src) {
    if (s.type === 'kingdom_chest' || s.hearts <= 0) return;
    s.hearts -= amount; s.hurtAt = W.t;
    if (s.hearts <= 0) destroyStructure(W, s, 'was conquered');
  }

  // does a w*h footprint fit at (x,y) with a free 1-tile margin of walkways?
  function footprintOk(W, x, y, w, h, kid) {
    if (x < 1 || y < 1 || x + w > W.w - 1 || y + h > W.h - 1) return false;
    for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) {
      if (!sim.inb(W, xx, yy)) continue;
      if (W.occ[yy * W.w + xx] > 0) return false;
    }
    if (kid) for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (kingdomAt(W, xx, yy) !== kid) return false;
    return true;
  }
  function treesIn(W, x, y, w, h) {
    let n = 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (W.occ[yy * W.w + xx] === -1) n++;
    return n;
  }
  function findSpot(W, k, type, minR) {
    const def = K.struct(type), w = def.w, h = def.h;
    for (let r = minR || 3; r <= Math.floor(k.radius) - 1; r++) {
      let best = null, bestScore = 1e9;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(k.cx + dx - (w - 1) / 2), y = Math.round(k.cy + dy - (h - 1) / 2);
        if (!footprintOk(W, x, y, w, h, k.id)) continue;
        const score = treesIn(W, x, y, w, h) * 2 + W.rng();
        if (score < bestScore) { bestScore = score; best = [x, y]; }
      }
      if (best) return best;
    }
    return null;
  }

  // ------------------------------------------------------------------ founding
  function canFoundAt(W, x, y) {
    const R = S('kingdom.baseRadius', 8) + S('kingdom.minGapBetweenBorders', 3);
    if (kingdomAt(W, x, y)) return false;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const px = Math.round(x + Math.cos(a) * R), py = Math.round(y + Math.sin(a) * R);
      if (kingdomAt(W, px, py)) return false;
      const px2 = Math.round(x + Math.cos(a) * R * 0.5), py2 = Math.round(y + Math.sin(a) * R * 0.5);
      if (kingdomAt(W, px2, py2)) return false;
    }
    return true;
  }
  function foundKingdom(W, u) {
    if (!canFoundAt(W, u.x, u.y)) return null;
    let spot = null;
    for (let r = 1; r <= 7 && !spot; r++) {
      const cells = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = u.x + dx - 1, y = u.y + dy - 1;
        if (footprintOk(W, x, y, 3, 3, 0) && x >= 2 && y >= 2 && x + 4 < W.w && y + 4 < W.h) cells.push([x, y]);
      }
      if (cells.length) spot = W.rng.pick(cells);
    }
    if (!spot) return null;
    const rng = W.rng;
    const k = {
      id: W.nextId++, name: K.names.kingdomName(W.namer), king: u.id, citizens: new Set(), chest: { food: S('kingdom.startFood', 12), wood: S('kingdom.startWood', 6), gold: S('kingdom.startGold', 0) },
      orders: [], theaterId: 0, coliseumId: 0, castleId: 0, chestId: 0, rumors: [], plays: [], arenas: [], war: null, lastWarEnd: -1e9, founded: W.t,
      hue: rng.int(1, 12), wob: [], radius: S('kingdom.baseRadius', 8), cx: spot[0] + 1, cy: spot[1] + 1, deeds: { fed: 0, defended: 0, gold: 0 }, log: [],
    };
    const wob = S('kingdom.borderWobble', 2), ph = [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)];
    for (let i = 0; i < NANG; i++) {
      const a = (i / NANG) * TAU;
      k.wob.push(wob * (0.5 * Math.sin(a * 2 + ph[0]) + 0.3 * Math.sin(a * 3 + ph[1]) + 0.2 * Math.sin(a * 5 + ph[2])));
    }
    W.kingdoms.set(k.id, k);
    const castle = createStructure(W, 'castle', k.id, spot[0], spot[1]);
    k.castleId = castle.id;
    // the kingdom chest appears right beside the castle
    const cands = [[spot[0] + 3, spot[1] + 2], [spot[0] + 3, spot[1]], [spot[0] - 1, spot[1] + 2], [spot[0] + 1, spot[1] + 3], [spot[0] + 1, spot[1] - 1]];
    let cp = cands.find((c) => sim.inb(W, c[0], c[1]) && W.occ[c[1] * W.w + c[0]] <= 0) || cands[0];
    const chest = createStructure(W, 'kingdom_chest', k.id, cp[0], cp[1]);
    k.chestId = chest.id;
    u.kingdom = k.id; k.citizens.add(u.id);
    sim.setJob(W, u, 'king', true);
    k.radius = radiusFor(W, k);
    recomputeKmap(W);
    W.stats.kingdoms++;
    sim.log(W, u.name + ' proclaimed the kingdom of ' + k.name + '!', [u.id]);
    sim.say(W, u, K.line(rng, 'proclaim'), 2);
    sim.emit(W, 'kingdomFounded', { id: k.id });
    return k;
  }

  // ------------------------------------------------------------------ citizens
  const citizens = (W, k) => { const out = []; for (const id of k.citizens) { const u = W.byId.get(id); if (u && !u.dead) out.push(u); } return out; };
  function addCitizen(W, k, u) {
    if (u.kingdom === k.id) return;
    if (u.kingdom) removeCitizen(W, u);
    u.kingdom = k.id; k.citizens.add(u.id);
    const f = W.families.get(u.family);
    if (f) f.kingdom = k.id;
    // children follow their parent
    for (const cid of u.children) { const c = W.byId.get(cid); if (c && !c.dead && !sim.isAdult(W, c) && !c.kingdom) addCitizen(W, k, c); }
  }
  function removeCitizen(W, u) {
    const k = W.kingdoms.get(u.kingdom);
    if (k) k.citizens.delete(u.id);
    u.kingdom = 0;
  }
  function counts(W, k) {
    const c = { total: 0, adults: 0 };
    for (const u of citizens(W, k)) {
      c.total++; if (sim.isAdult(W, u)) c.adults++;
      const j = u.job; c[j] = (c[j] || 0) + 1;
      if (K.isFighter(j)) c.fighters = (c.fighters || 0) + 1;
    }
    return c;
  }

  function dissolveKingdom(W, k, why) {
    sim.log(W, 'The kingdom of ' + k.name + ' is no more (' + why + ').', []);
    for (const u of citizens(W, k)) { u.kingdom = 0; u.task = null; if (u.job === 'king' || u.job === 'prince') u.job = 'villager'; }
    k.citizens.clear();
    for (const s of Array.from(W.structures.values())) if (s.kingdom === k.id && s.type !== 'castle') destroyStructure(W, s, 'dissolved');
    const castle = W.structures.get(k.castleId);
    if (castle) { for (let yy = castle.y; yy < castle.y + castle.h; yy++) for (let xx = castle.x; xx < castle.x + castle.w; xx++) if (W.occ[yy * W.w + xx] === castle.id) W.occ[yy * W.w + xx] = 0; W.structures.delete(castle.id); }
    for (const f of W.families.values()) if (f.kingdom === k.id) { f.kingdom = 0; f.houseId = 0; }
    if (k.war) sim.endWar && sim.endWar(W, k.war, true);
    W.kingdoms.delete(k.id);
    recomputeKmap(W);
    sim.emit(W, 'kingdomGone', { id: k.id });
  }

  // ------------------------------------------------------------------ succession
  function pickHeir(W, k) {
    const list = citizens(W, k).filter((u) => sim.isAdult(W, u) && u.job !== 'king');
    if (!list.length) return null;
    const prince = list.find((u) => u.job === 'prince');
    if (prince) return prince;
    list.sort((a, b) => sim.ageSeconds(W, b) - sim.ageSeconds(W, a));
    return list[0];
  }
  function crown(W, k, heir) {
    heir.task = null;
    k.king = heir.id;
    sim.setJob(W, heir, 'king', true);
    sim.log(W, heir.name + ' is the new ' + (heir.female ? 'queen' : 'king') + ' of ' + k.name + '.', [heir.id]);
    sim.say(W, heir, K.line(W.rng, 'proclaim'), 2);
    // a new prince: the ruler's oldest adult child
    const kids = heir.children.map((id) => W.byId.get(id)).filter((c) => c && !c.dead);
    kids.sort((a, b) => sim.ageSeconds(W, b) - sim.ageSeconds(W, a));
    if (kids[0] && kids[0].job === 'villager') sim.setJob(W, kids[0], 'prince', true);
  }
  function onKingDeath(W, k, king) {
    k.citizens.delete(king.id);
    const heir = pickHeir(W, k);
    if (!heir) { dissolveKingdom(W, k, 'no one was left to rule'); return; }
    crown(W, k, heir);
  }

  // ------------------------------------------------------------------ build orders
  function familyNeedsHouse(W, k) {
    for (const f of W.families.values()) {
      if (f.kingdom !== k.id || f.houseId) continue;
      if (f.members.size < 2) continue;
      if (k.orders.some((o) => o.family === f.id)) continue;
      return f;
    }
    return null;
  }
  function updateOrders(W, k) {
    // finish / drop
    k.orders = k.orders.filter((o) => {
      if (o.structId) { const s = W.structures.get(o.structId); return !!s && s.building; }
      return true;
    });
    const active = k.orders.find((o) => !o.structId);
    if (active) {
      const def = K.struct(active.type);
      if (k.chest.wood >= (def.wood || 0) && k.chest.gold >= (def.gold || 0)) {
        const spot = findSpot(W, k, active.type, active.type === 'house' ? 3 : 4);
        if (!spot) { k.orders.splice(k.orders.indexOf(active), 1); return; }
        k.chest.wood -= def.wood || 0; k.chest.gold -= def.gold || 0;
        const s = createStructure(W, active.type, k.id, spot[0], spot[1], { building: true, family: active.family });
        active.structId = s.id;
        if (active.type === 'house' && active.family) { const f = W.families.get(active.family); if (f) f.houseId = s.id; }
        sim.log(W, 'Construction of a ' + def.name.toLowerCase() + ' began in ' + k.name + '.', []);
      }
      return;
    }
    if (k.orders.length >= 2) return;
    const c = counts(W, k);
    const smith = c.blacksmith || 0;
    if (!k.theaterId && !k.orders.some((o) => o.type === 'theater') && (c.bard || 0) >= S('theater.minBards', 2) && smith >= 1) { k.orders.push({ type: 'theater' }); return; }
    if (!k.coliseumId && k.coliseumApproved && !k.orders.some((o) => o.type === 'coliseum') && (c.knight || 0) >= S('coliseum.minKnights', 4) && smith >= 1) { k.orders.push({ type: 'coliseum' }); return; }
    const f = familyNeedsHouse(W, k);
    if (f) {
      // an empty house left behind by another household can be moved into
      const empty = [...W.structures.values()].find((s) => s.type === 'house' && s.kingdom === k.id && !s.building && !(W.families.get(s.family) && W.families.get(s.family).members.size));
      if (empty) { empty.family = f.id; f.houseId = empty.id; return; }
      k.orders.push({ type: 'house', family: f.id });
    }
  }
  function finishBuilding(W, s) {
    s.building = false; s.hearts = s.maxHearts;
    const k = W.kingdoms.get(s.kingdom);
    if (s.type === 'theater' && k) k.theaterId = s.id;
    if (s.type === 'coliseum' && k) k.coliseumId = s.id;
    sim.log(W, 'A new ' + K.struct(s.type).name.toLowerCase() + ' was finished' + (k ? ' in ' + k.name : '') + '.', []);
    sim.emit(W, 'built', { id: s.id });
  }

  // ------------------------------------------------------------------ the kingdom heartbeat (once per second)
  function update(W) {
    const dayLen = sim.dayLength();
    for (const k of Array.from(W.kingdoms.values())) {
      if (!W.kingdoms.has(k.id)) continue;
      for (const id of Array.from(k.citizens)) { const u = W.byId.get(id); if (!u || u.dead) k.citizens.delete(id); }
      const king = W.byId.get(k.king);
      if (!king || king.dead || king.kingdom !== k.id) {
        const heir = pickHeir(W, k);
        if (!heir) { dissolveKingdom(W, k, 'no one was left to rule'); continue; }
        crown(W, k, heir);
      }
      const r = radiusFor(W, k);
      if (Math.round(r * 2) !== Math.round(k.radius * 2)) { k.radius = r; recomputeKmap(W); }
      updateOrders(W, k);
      // leaving
      const baseLeave = S('kingdom.leaveChancePerDay', 0.05) + (sim.isTyrantKing(W, k) ? S('kingdom.leaveTyrantBonus', 0.2) : 0);
      for (const u of citizens(W, k)) {
        if (u.job === 'king' || u.job === 'prince' || !sim.isAdult(W, u)) continue;
        if (W.rng() < baseLeave / dayLen) leaveKingdom(W, u);
      }
    }
    // joining
    for (const u of W.units) {
      if (u.dead || u.kingdom || !sim.isAdult(W, u) || W.t < u.refusedUntil) continue;
      const kid = kingdomAt(W, u.x, u.y);
      if (!kid) continue;
      const k = W.kingdoms.get(kid);
      if (!k) continue;
      if (W.rng() < S('kingdom.joinChance', 0.5)) { addCitizen(W, k, u); sim.log(W, u.name + ' joined ' + k.name + '.', [u.id]); }
      else u.refusedUntil = W.t + dayLen * 0.5;
    }
    // old tombstones fade away
    if (W.tombstones.length) W.tombstones = W.tombstones.filter((t) => W.t < t.until + S('animation.tombstoneFadeSeconds', 3));
  }
  function leaveKingdom(W, u) {
    const k = W.kingdoms.get(u.kingdom);
    if (!k) return;
    sim.say(W, u, K.line(W.rng, 'leave'), 1);
    removeCitizen(W, u);
    u.refusedUntil = W.t + sim.dayLength() * 1.5;
    u.task = { type: 'leave', prio: 62, from: k.id };
    sim.log(W, u.name + ' left ' + k.name + '.', [u.id]);
  }

  Object.assign(sim, {
    radiusFor, recomputeKmap, kingdomAt, inKingdom, structCenter, structRange, createStructure, destroyStructure, damageStructure,
    footprintOk, findSpot, canFoundAt, foundKingdom, citizens, addCitizen, removeCitizen, counts, dissolveKingdom, pickHeir, crown,
    onKingDeath, finishBuilding, kingdomUpdate: update, leaveKingdom,
  });
})();
