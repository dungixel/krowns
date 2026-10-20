// Krowns - the world: grid, time, entities, path finding and movement.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const sim = (K.sim = K.sim || {});
  const { clamp, cheb, dist } = K.util;
  const S = K.S;

  // ------------------------------------------------------------------ time
  // One real second at 1x = 5 world minutes (time.minutesPerSecond), so a day is 288 seconds. The clock shows whole steps of time.displayStepMinutes.
  function dayLength() { return 1440 / S('time.minutesPerSecond', 5); }
  function clockAt(t) {
    const mins = t * S('time.minutesPerSecond', 5) + S('time.startHour', 8) * 60;
    const day = Math.floor(mins / 1440) + 1;
    const hour = (mins % 1440) / 60;
    const stp = Math.max(1, S('time.displayStepMinutes', 5));
    const m = Math.floor((mins % 1440) / stp) * stp;
    return { day, hour, text: K.util.pad2(Math.floor(m / 60)) + ':' + K.util.pad2(m % 60), abs: mins };
  }
  // world seconds from now until a given day/hour
  function timeOf(day, hour) {
    const mins = (day - 1) * 1440 + hour * 60 - S('time.startHour', 8) * 60;
    return mins / S('time.minutesPerSecond', 5);
  }
  const isSleepHour = (h) => (S('time.sleepStartHour', 21) > S('time.sleepEndHour', 6) ? (h >= S('time.sleepStartHour', 21) || h < S('time.sleepEndHour', 6)) : (h >= S('time.sleepStartHour') && h < S('time.sleepEndHour')));
  const isNightHour = (h) => h >= S('time.nightStartHour', 20) || h < S('time.nightEndHour', 5.5);

  // ------------------------------------------------------------------ the world
  function createWorld(opts) {
    opts = opts || {};
    const seed = opts.seed === undefined ? (Math.random() * 4294967296) >>> 0 : opts.seed;
    const rng = K.util.makeRng(seed);
    const w0 = S('world.width', 96), h0 = S('world.height', 64);
    const W = {
      seed, rng, w: w0, h: h0, t: 0, step: 0, nextId: 1,
      occ: new Int32Array(w0 * h0),        // 0 free, -1 tree, >0 structure id
      blk: new Uint8Array(w0 * h0),         // 1 = units cannot walk here (trees, and the lower part of structures)
      unitAt: new Int32Array(w0 * h0),     // id of the unit/creature standing on the tile
      units: [], byId: new Map(), creatures: [], structures: new Map(), trees: new Map(),
      kingdoms: new Map(), families: new Map(), wars: [], events: [], log: [], tombstones: [],
      namer: K.names.createNamer(rng),
      timers: { tree: 0, animal: 0, regrow: 0 },
      stats: { born: 0, died: 0, kingdoms: 0, wars: 0, plays: 0 },
      day: 1, hour: S('time.startHour', 8), view: {},
    };
    // trees, scattered everywhere with gentle clumps
    const phase = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
    const dens = S('world.treeDensity', 0.08);
    for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
      const n = 0.5 + 0.25 * Math.sin(x * 0.21 + phase[0]) * Math.cos(y * 0.17 + phase[1]) + 0.25 * Math.sin((x + y) * 0.11 + phase[2]);
      if (rng() < dens * (0.45 + n * 1.1)) addTree(W, x, y);
    }
    // grass tufts (only for drawing); every tuft knows its tile and a small offset
    W.grass = [];
    const gd = S('world.grassDetailDensity', 0.1);
    for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
      if (rng() < gd) W.grass.push({ x, y, ox: rng.int(-3, 3), oy: rng.int(-3, 3), phase: rng() * 6.28, period: rng.range(K.anim('grass_sway').extra.periodMin, K.anim('grass_sway').extra.periodMax), cycles: 0 });
    }
    return W;
  }

  // ------------------------------------------------------------------ grid helpers
  const idx = (W, x, y) => y * W.w + x;
  const inb = (W, x, y) => x >= 0 && y >= 0 && x < W.w && y < W.h;
  const terrainFree = (W, x, y) => inb(W, x, y) && W.blk[y * W.w + x] === 0;
  const tileFree = (W, x, y) => inb(W, x, y) && W.blk[y * W.w + x] === 0 && W.unitAt[y * W.w + x] === 0;

  function addTree(W, x, y) {
    const i = idx(W, x, y);
    if (W.occ[i] !== 0) return null;
    const tr = { x, y, fruitAt: 0, fade: 1, id: W.nextId++, variant: (x * 7 + y * 13) % 4 };
    W.trees.set(i, tr); W.occ[i] = -1; W.blk[i] = 1;
    return tr;
  }
  function removeTree(W, x, y) {
    const i = idx(W, x, y);
    if (W.occ[i] === -1) { W.occ[i] = 0; W.blk[i] = 0; W.trees.delete(i); return true; }
    return false;
  }
  const treeAt = (W, x, y) => (inb(W, x, y) ? W.trees.get(idx(W, x, y)) : undefined);

  // every entity standing within r tiles (units and creatures)
  function near(W, x, y, r, fn) {
    const out = [];
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W.w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(W.h - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const id = W.unitAt[yy * W.w + xx];
        if (!id) continue;
        const e = W.byId.get(id);
        if (!e || e.dead) continue;
        if (dist(e.x, e.y, x, y) > r) continue;
        if (!fn || fn(e)) out.push(e);
      }
    }
    return out;
  }

  // a random free tile near (x,y); tries rings outward
  function freeTileNear(W, x, y, maxR, rng, test) {
    rng = rng || W.rng;
    for (let r = 0; r <= maxR; r++) {
      const cells = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = x + dx, yy = y + dy;
        if (tileFree(W, xx, yy) && (!test || test(xx, yy))) cells.push([xx, yy]);
      }
      if (cells.length) return rng.pick(cells);
    }
    return null;
  }

  // ------------------------------------------------------------------ path finding (A*, 8 directions)
  const NODE_CAP = 2600;
  let stamp = 1, gStamp = null, gCost = null, gFrom = null, closed = null, gSize = 0;
  function ensureBuffers(n) {
    if (gSize !== n) { gStamp = new Int32Array(n); gCost = new Float32Array(n); gFrom = new Int32Array(n); closed = new Int32Array(n); gSize = n; stamp = 1; }
  }
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

  // returns an array of [x,y] steps (excluding the start) reaching a tile within `range` of the goal, or null.
  // opts.avoid: Set of tile indexes treated as blocked, opts.fly: ignore trees and structures
  function findPath(W, sx, sy, gx, gy, range, opts) {
    opts = opts || {};
    if (cheb(sx, sy, gx, gy) <= range) return [];
    ensureBuffers(W.w * W.h);
    stamp++;
    const heap = new K.util.Heap();
    const s = idx(W, sx, sy);
    gStamp[s] = stamp; gCost[s] = 0; gFrom[s] = -1;
    heap.push(s, 0);
    let nodes = 0, best = s, bestH = Math.hypot(sx - gx, sy - gy);
    const goalOk = (x, y) => cheb(x, y, gx, gy) <= range;
    while (heap.size && nodes++ < NODE_CAP) {
      const c = heap.pop();
      if (closed[c] === stamp) continue;
      closed[c] = stamp;
      const cx = c % W.w, cy = (c / W.w) | 0;
      if (goalOk(cx, cy) && (opts.fly || W.blk[c] === 0)) { best = c; bestH = -1; break; }
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!inb(W, nx, ny)) continue;
        const ni = ny * W.w + nx;
        if (!opts.fly && W.blk[ni] !== 0) continue;
        if (opts.avoid && opts.avoid.has(ni)) continue;
        if (dx !== 0 && dy !== 0 && !opts.fly && (W.blk[cy * W.w + nx] !== 0 || W.blk[ny * W.w + cx] !== 0)) continue; // no cutting corners
        const g = gCost[c] + cost + (W.unitAt[ni] && !goalOk(nx, ny) ? 0.6 : 0);
        if (gStamp[ni] === stamp && gCost[ni] <= g) continue;
        gStamp[ni] = stamp; gCost[ni] = g; gFrom[ni] = c;
        const hh = Math.max(Math.abs(nx - gx), Math.abs(ny - gy)) - range;
        heap.push(ni, g + Math.max(0, hh) * 1.0 + 0.4 * Math.min(Math.abs(nx - gx), Math.abs(ny - gy)) * 0);
        const hd = Math.hypot(nx - gx, ny - gy);
        if (hd < bestH) { bestH = hd; best = ni; }
      }
    }
    if (best === s) return null;
    const path = [];
    for (let c = best; c !== s && c >= 0; c = gFrom[c]) path.push([c % W.w, (c / W.w) | 0]);
    path.reverse();
    return path;
  }

  // ------------------------------------------------------------------ movement (one tile per hop)
  function hopSecondsFor(e, run) {
    let d = K.S('unit.hopSeconds', 0.5);
    if (e.kind === 'creature') d = 1 / (e.speed || 1) * 0.5;
    if (run) d /= K.S('unit.runMultiplier', 1.5);
    return d;
  }
  function startHop(W, e, nx, ny, run) {
    const fx = e.x, fy = e.y;
    if (!e.flies) { W.unitAt[idx(W, fx, fy)] = 0; W.unitAt[idx(W, nx, ny)] = e.id; }
    e.x = nx; e.y = ny;
    e.hop = { fx, fy, t: Math.min(e.hopOver || 0, 0.12), dur: hopSecondsFor(e, run) };
    e.hopOver = 0;
    if (nx !== fx) e.face = nx > fx ? 1 : -1;
  }
  function placeEntity(W, e, x, y) {
    if (!e.flies) W.unitAt[idx(W, x, y)] = e.id;
    e.x = x; e.y = y; e.hop = null;
  }
  function removeEntityFromGrid(W, e) {
    const i = idx(W, e.x, e.y);
    if (W.unitAt[i] === e.id) W.unitAt[i] = 0;
    if (e.hop) { const j = idx(W, e.hop.fx, e.hop.fy); if (W.unitAt[j] === e.id) W.unitAt[j] = 0; }
  }
  function advanceHop(e, dt) {
    if (!e.hop) { e.hopOver = 0; return false; }
    e.hop.t += dt;
    if (e.hop.t >= e.hop.dur) { e.hopOver = e.hop.t - e.hop.dur; e.hop = null; return false; }
    return true;
  }

  // Walk toward (gx,gy) until within `range` tiles. Returns 'arrived' | 'moving' | 'stuck'.
  function moveTo(W, e, gx, gy, range, run, opts) {
    if (e.hop) return 'moving';
    if (cheb(e.x, e.y, gx, gy) <= range) { e.path = null; return 'arrived'; }
    const goalKey = gx + ',' + gy + ',' + range;
    if (!e.path || e.pathGoal !== goalKey || e.path.length === 0) {
      e.path = findPath(W, e.x, e.y, gx, gy, range, Object.assign({ fly: e.flies }, opts));
      e.pathGoal = goalKey; e.pathBlocked = 0;
      if (!e.path) { e.pathGoal = null; return 'stuck'; }
      if (e.path.length === 0) return 'arrived';
    }
    const nxt = e.path[0];
    const ni = idx(W, nxt[0], nxt[1]);
    const blockedTerrain = !e.flies && W.blk[ni] !== 0;
    if (blockedTerrain || (!e.flies && W.unitAt[ni] && W.unitAt[ni] !== e.id)) {
      e.pathBlocked = (e.pathBlocked || 0) + 1;
      if (e.pathBlocked > (blockedTerrain ? 0 : 3)) {
        const avoid = new Set([ni]);
        e.path = findPath(W, e.x, e.y, gx, gy, range, Object.assign({ fly: e.flies, avoid }, opts));
        e.pathBlocked = 0;
        if (!e.path || e.path.length === 0) { e.pathGoal = null; return e.path && e.path.length === 0 ? 'arrived' : 'stuck'; }
      } else return 'moving'; // wait a moment for the other unit to move
    }
    const first = e.path[0];
    const fi = idx(W, first[0], first[1]);
    if (!e.flies && (W.blk[fi] !== 0 || (W.unitAt[fi] && W.unitAt[fi] !== e.id))) return 'moving';   // wait for the way to clear
    const step = e.path.shift();
    startHop(W, e, step[0], step[1], run);
    return 'moving';
  }

  // ------------------------------------------------------------------ events, log and speech
  function emit(W, type, data) { W.events.push(Object.assign({ type }, data)); }
  function log(W, text, ids) {
    const c = clockAt(W.t);
    // remember who is named, so the log can colour and link the names even after they die
    const who = (ids || []).map((id) => { const e = W.byId.get(id); return e && e.kind === 'unit' ? { id, name: e.name, color: e.color } : null; }).filter(Boolean);
    W.log.push({ t: W.t, day: c.day, time: c.text, text, ids: ids || [], who });
    if (W.log.length > 400) W.log.shift();
    emit(W, 'log', { text, ids });
  }

  // Makes a unit say something. Bubbles type out letter by letter. prio: 0 chatter, 1 normal, 2 important
  function say(W, e, text, prio) {
    if (!text || e.dead) return false;
    prio = prio || 0;
    if (text.indexOf('{') >= 0) {
      const k = e.kingdom && W.kingdoms.get(e.kingdom);
      text = text.replace(/\{(\w+)\}/g, (m, key) => (key === 'kingdom' ? (k ? k.name : 'this land') : key === 'job' ? 'hero' : key === 'n' ? 'many' : key === 'time' ? 'noon' : key === 'day' ? 'tomorrow' : 'someone'));
    }
    const active = W.units.filter((u) => u.bubble && W.t - u.bubble.t0 < u.bubble.dur).length;
    if (e.bubble && W.t - e.bubble.t0 < e.bubble.dur) { if ((e.bubble.prio || 0) > prio) return false; }
    else if (prio < 2 && active >= K.S('bubble.maxAtOnce', 12)) return false;
    const cps = K.S('bubble.charsPerSecond', 28);
    const typing = text.length / cps;
    e.bubble = { text, t0: W.t, typing, dur: typing + K.S('bubble.holdSeconds', 2.5), prio, seed: W.step };
    e.talkUntil = W.t + typing;
    return true;
  }
  const isTalking = (W, e) => e.talkUntil && W.t < e.talkUntil;

  Object.assign(sim, {
    dayLength, clockAt, timeOf, isSleepHour, isNightHour, createWorld, idx, inb, terrainFree, tileFree, addTree, removeTree, treeAt,
    near, freeTileNear, findPath, startHop, placeEntity, removeEntityFromGrid, advanceHop, moveTo, emit, log, say, isTalking,
  });
})();
