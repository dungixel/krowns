// Krowns - the world: an empty meadow with trees and grass, and how bodies (the player, the neighbour) walk around in it.
// Bodies do not walk from tile to tile: they have a free position (fx, fy, in tiles) and slide along trees.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;

  function createWorld(seed) {
    seed = seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed;
    const rng = K.util.makeRng(seed);
    const w = S('world.width', 96), h = S('world.height', 64);
    const W = { seed, rng, w, h, t: 0, blk: new Uint8Array(w * h), trees: [], grass: [], bodies: [] };
    // trees, scattered everywhere with gentle clumps
    const phase = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
    const dens = S('world.treeDensity', 0.08);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = 0.5 + 0.25 * Math.sin(x * 0.21 + phase[0]) * Math.cos(y * 0.17 + phase[1]) + 0.25 * Math.sin((x + y) * 0.11 + phase[2]);
      if (rng() < dens * (0.45 + n * 1.1)) { W.trees.push({ x, y, fade: 1 }); W.blk[y * w + x] = 1; }
    }
    // grass tufts (only for drawing); every tuft knows its tile and a small offset
    const an = K.anim('grass_sway'), gd = S('world.grassDetailDensity', 0.24);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (rng() < gd) W.grass.push({ x, y, ox: rng.int(-3, 3), oy: rng.int(-3, 3), phase: rng() * 6.28, period: rng.range(an.extra.periodMin, an.extra.periodMax), cycles: 0 });
    }
    return W;
  }

  // a free tile close to (x, y)
  function freeTileNear(W, x, y, maxR) {
    for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = x + dx, ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < W.w && ty < W.h && !W.blk[ty * W.w + tx]) return [tx, ty];
    }
    return [x, y];
  }

  // ------------------------------------------------------------------ hitboxes: everything is a SQUARE
  // A body's square is centred on its feet (fx + 0.5, fy + 0.62); a tree's square is its trunk (the leaves are only decoration you walk behind).
  // content/settings.json: hitbox.unitHalfTiles, hitbox.slimeHalfTiles, hitbox.treeHalfTiles (half the side of the square, in tiles).
  const FOOT_Y = 0.62, TREE_CX = 0.47, TREE_CY = 0.78;
  const halfOf = (b) => b.half || (b.kind === 'slime' ? S('hitbox.slimeHalfTiles', 0.25) : S('hitbox.unitHalfTiles', 0.22));
  const solid = (o) => !o.dead && !o.ko && !o.hidden && !o.rag;                  // flung or fallen bodies are not in the way
  // the square of a body: { x, y, h } (centre and half side, in tiles)
  const squareOf = (b) => ({ x: b.fx + 0.5, y: b.fy + FOOT_Y, h: halfOf(b) });
  // do the squares of two bodies overlap (margin makes them a little bigger: the reach of a hit)
  const overlap = (a, b, margin) => { const m = (margin || 0) + halfOf(a) + halfOf(b); return Math.abs(a.fx - b.fx) < m && Math.abs(a.fy - b.fy) < m; };
  // the map edge and tree trunks
  function blocked(W, fx, fy, h) {
    if (fx < 0 || fy < 0 || fx > W.w - 1 || fy > W.h - 1) return true;
    h = h || S('hitbox.unitHalfTiles', 0.22);
    const cx = fx + 0.5, cy = fy + FOOT_Y, th = S('hitbox.treeHalfTiles', 0.22);
    for (let ty = Math.floor(cy - h - 1); ty <= Math.floor(cy + h); ty++) for (let tx = Math.floor(cx - h - 0.7); tx <= Math.floor(cx + h); tx++) {
      if (tx < 0 || ty < 0 || tx >= W.w || ty >= W.h || !W.blk[ty * W.w + tx]) continue;
      if (Math.abs(cx - (tx + TREE_CX)) < h + th && Math.abs(cy - (ty + TREE_CY)) < h + th) return true;
    }
    return false;
  }
  // the solid body that `self` would run into at (fx, fy) (null if none). Bodies that already overlap may still move apart.
  function bodyAt(W, self, fx, fy, ignore) {
    const h = halfOf(self), cx = fx + 0.5, cy = fy + FOOT_Y, ox = self.fx + 0.5, oy = self.fy + FOOT_Y;
    for (const o of W.bodies) {
      if (o === self || o === ignore || !solid(o)) continue;
      const hh = h + halfOf(o), dx = Math.abs(cx - (o.fx + 0.5)), dy = Math.abs(cy - (o.fy + FOOT_Y));
      if (dx >= hh || dy >= hh) continue;
      const d0x = Math.abs(ox - (o.fx + 0.5)), d0y = Math.abs(oy - (o.fy + FOOT_Y));
      if (d0x < hh && d0y < hh && Math.max(dx, dy) >= Math.max(d0x, d0y)) continue;      // already inside each other: moving apart is fine
      return o;
    }
    return null;
  }
  // one small step (ax, ay). With push, a body in the way is pushed along (and the ones behind it, up to 3). Fills info with what stopped it.
  function tryMove(W, b, ax, ay, push, depth, info) {
    const nx = b.fx + ax, ny = b.fy + ay, h = halfOf(b);
    if (blocked(W, nx, ny, h)) { if (info) info.tree = true; return false; }
    let o = bodyAt(W, b, nx, ny);
    if (o) {
      if (push && depth < 3 && tryMove(W, o, ax, ay, true, depth + 1, null)) { o.pushedAt = W.t; o = bodyAt(W, b, nx, ny); }
      if (o) { if (info) info.body = o; return false; }
    }
    b.fx = nx; b.fy = ny;
    return true;
  }

  // a new body: { name, sprite, color, fx, fy, face, ... }
  function addBody(W, o) {
    const hearts = S('unit.hearts', 5);
    const b = Object.assign({ face: 1, walkPhase: 0, walkP: 0, moving: false, phase: Math.random() * 6.28, bubble: null, talkUntil: 0, hp: hearts, maxHp: hearts }, o);
    W.bodies.push(b);
    return b;
  }

  // walk in direction (dx, dy) for dt seconds at `speed` tiles per second. Trees and other units are solid. Returns how far he really went.
  function moveBody(W, b, dx, dy, dt, speed) {
    const len = Math.hypot(dx, dy);
    let moved = 0;
    if (len) {
      dx /= len; dy /= len;
      const n = Math.max(1, Math.ceil(dt * speed / 0.2));       // small steps so nobody ever jumps through a tree
      const sx = dx * speed * dt / n, sy = dy * speed * dt / n;
      for (let i = 0; i < n; i++) {
        const ox = b.fx, oy = b.fy;
        if (sx) tryMove(W, b, sx, 0, false, 0, null);
        if (sy) tryMove(W, b, 0, sy, false, 0, null);
        moved += Math.hypot(b.fx - ox, b.fy - oy);
      }
      if (dx) b.face = dx > 0 ? 1 : -1;
    }
    // little hops while walking: one hop per tile walked; when he stops, the hop in progress is finished so he lands softly
    if (moved > 0) b.walkPhase += moved;
    else if (b.walkPhase % 1 > 0) b.walkPhase = Math.min(Math.ceil(b.walkPhase), b.walkPhase + speed * dt);
    b.walkP = b.walkPhase % 1;
    b.moving = moved > 0 || b.walkP > 0;
    return moved;
  }

  // pushed along by a dodge, a hit or a flight: slide `dist` tiles in direction (dx, dy). Does not turn the body or make it hop.
  // push = true: bodies in the way are shoved along (a dodge). info (optional) says what it ran into: { tree, body, nx, ny } (nx, ny = the way back from the wall).
  function slideBody(W, b, dx, dy, dist, push, info) {
    const len = Math.hypot(dx, dy);
    if (!len || dist <= 0) return 0;
    dx /= len; dy /= len;
    const n = Math.max(1, Math.ceil(dist / 0.15)), sx = dx * dist / n, sy = dy * dist / n;
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const ox = b.fx, oy = b.fy;
      if (sx && !tryMove(W, b, sx, 0, push, 0, info) && info) info.nx = -Math.sign(sx);
      if (sy && !tryMove(W, b, 0, sy, push, 0, info) && info) info.ny = -Math.sign(sy);
      moved += Math.hypot(b.fx - ox, b.fy - oy);
    }
    return moved;
  }

  // ------------------------------------------------------------------ finding a way around trees and units
  // steer(W, b, gx, gy, dt, speed): walk toward the spot (gx, gy) (body coordinates, like fx, fy). If something solid is in the straight way
  // it looks for a way around (A* on the tile grid; trees and nearby units are walls, and it looks again every half second, because units move).
  const tileOf = (fx, fy) => [Math.round(fx), Math.floor(fy + FOOT_Y)];
  function lineClear(W, b, gx, gy, ignore) {
    const dx = gx - b.fx, dy = gy - b.fy, d = Math.hypot(dx, dy), n = Math.max(1, Math.ceil(d / 0.2)), h = halfOf(b);
    for (let i = 1; i <= n; i++) {
      const x = b.fx + dx * i / n, y = b.fy + dy * i / n;
      if (blocked(W, x, y, h)) return false;
      const o = bodyAt(W, b, x, y, ignore);
      if (o) return false;
    }
    return true;
  }
  function findPath(W, b, gx, gy, ignore) {
    const w = W.w, hgt = W.h, N = w * hgt;
    const P = W._ps || (W._ps = { g: new Float32Array(N), from: new Int32Array(N), seen: new Uint32Array(N), stamp: 0 });
    const stamp = ++P.stamp;
    const [sx, sy] = tileOf(b.fx, b.fy);
    let [tx, ty] = tileOf(gx, gy);
    tx = Math.max(0, Math.min(w - 1, tx)); ty = Math.max(0, Math.min(hgt - 1, ty));
    const dyn = new Set();
    for (const o of W.bodies) {                                         // nearby units are walls too (not the one we are going to)
      if (o === b || o === ignore || !solid(o) || Math.hypot(o.fx - b.fx, o.fy - b.fy) > 7) continue;
      const [ox, oy] = tileOf(o.fx, o.fy); dyn.add(oy * w + ox);
    }
    const wall = (x, y) => x < 0 || y < 0 || x >= w || y >= hgt || W.blk[y * w + x] || dyn.has(y * w + x);
    if (wall(tx, ty)) { const f = freeTileNear(W, tx, ty, 4); tx = f[0]; ty = f[1]; }
    const goalI = ty * w + tx, startI = sy * w + sx;
    const heap = [];
    const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { let l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    const hf = (x, y) => { const ax = Math.abs(x - tx), ay = Math.abs(y - ty); return Math.max(ax, ay) + 0.414 * Math.min(ax, ay); };
    P.g[startI] = 0; P.seen[startI] = stamp; P.from[startI] = -1; push(hf(sx, sy), startI);
    let best = startI, bestH = hf(sx, sy), expand = 0;
    while (heap.length && expand++ < 3000) {
      const [, cur] = pop(), cx = cur % w, cy = (cur / w) | 0;
      if (cur === goalI) { best = cur; break; }
      const hh = hf(cx, cy); if (hh < bestH) { bestH = hh; best = cur; }
      for (let k = 0; k < 8; k++) {
        const ddx = [1, -1, 0, 0, 1, 1, -1, -1][k], ddy = [0, 0, 1, -1, 1, -1, 1, -1][k], nx = cx + ddx, ny = cy + ddy;
        if (wall(nx, ny)) continue;
        if (ddx && ddy && (wall(cx + ddx, cy) || wall(cx, cy + ddy))) continue;        // no cutting corners
        const ni = ny * w + nx, g = P.g[cur] + (ddx && ddy ? 1.414 : 1);
        if (P.seen[ni] === stamp && P.g[ni] <= g) continue;
        P.seen[ni] = stamp; P.g[ni] = g; P.from[ni] = cur; push(g + hf(nx, ny), ni);
      }
    }
    const pts = [];
    for (let i = best; i !== -1 && i !== startI; i = P.from[i]) pts.push([i % w, ((i / w) | 0) - FOOT_Y + 0.5]);
    return pts.reverse();
  }
  function steer(W, b, gx, gy, dt, speed, ignore) {
    const d = Math.hypot(gx - b.fx, gy - b.fy);
    if (d < 0.05) return 0;
    // where to head is worked out about 8 times a second (looking at the map is the expensive part), the walking itself every frame
    let sd = b.sd;
    if (!sd || W.t - sd.t > 0.12 || Math.hypot(sd.gx - gx, sd.gy - gy) > 0.6 || sd.tx === undefined) {
      let tx = gx, ty = gy;
      if (!lineClear(W, b, gx, gy, ignore)) {
        let p = b.path;
        if (!p || W.t - p.t > 0.5 || Math.hypot(p.gx - gx, p.gy - gy) > 1.2) { p = b.path = { gx, gy, t: W.t, i: 0, pts: findPath(W, b, gx, gy, ignore) }; }
        while (p.i < p.pts.length - 1 && Math.hypot(p.pts[p.i][0] - b.fx, p.pts[p.i][1] - b.fy) < 0.4) p.i++;
        if (p.pts.length) {
          let j = p.i;
          for (let k = Math.min(p.pts.length - 1, p.i + 6); k > p.i; k--) if (lineClear(W, b, p.pts[k][0], p.pts[k][1], ignore)) { j = k; break; }     // cut straight where it is clear
          tx = p.pts[j][0]; ty = p.pts[j][1];
        }
      } else b.path = null;
      sd = b.sd = { t: W.t, gx, gy, tx, ty };
    }
    const moved = moveBody(W, b, sd.tx - b.fx, sd.ty - b.fy, dt, speed);
    b.stuck = moved < speed * dt * 0.25 ? (b.stuck || 0) + dt : 0;
    if (b.stuck > 0.35) { b.stuck = 0; b.sd = null; if (b.path) b.path.t = -9; moveBody(W, b, -(sd.ty - b.fy), sd.tx - b.fx, dt * 2, speed); }        // wedged: look again and shuffle sideways
    return moved;
  }

  // trees grow at random: now and then a new tree appears on a free tile (never next to anybody), until there are about treeMaxFactor times
  // as many as at the start. (Trees smashed by a flung body get replaced this way.)
  function growTrees(W) {
    if (!W.treeCap) W.treeCap = Math.round(W.trees.length * S('tree.maxFactor', 1.1));
    if (W.nextTree === undefined) W.nextTree = W.t + 1;
    if (W.t < W.nextTree) return false;
    W.nextTree = W.t + W.rng.range(0.5, 1.5) * S('tree.growEverySeconds', 3);
    if (W.trees.length >= W.treeCap) return false;
    for (let i = 0; i < 25; i++) {
      const x = W.rng.int(0, W.w - 1), y = W.rng.int(0, W.h - 1);
      if (W.blk[y * W.w + x]) continue;
      if (W.bodies.some((b) => !b.dead && Math.hypot(b.fx - x, b.fy - y) < 1.8)) continue;
      W.blk[y * W.w + x] = 1; W.trees.push({ x, y, fade: 1, born: W.t });
      return true;
    }
    return false;
  }

  K.world = { growTrees, create: createWorld, freeTileNear, addBody, moveBody, slideBody, blocked, bodyAt, overlap, squareOf, halfOf, solid, steer, lineClear, TREE_CX, TREE_CY };
})();
