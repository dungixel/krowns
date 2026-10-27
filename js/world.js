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

  // the little box of the feet, in tiles
  const HALF_W = 0.27, HALF_H = 0.2, FOOT_Y = 0.62;
  function blocked(W, fx, fy) {
    const x0 = fx + 0.5 - HALF_W, x1 = fx + 0.5 + HALF_W, y0 = fy + FOOT_Y - HALF_H, y1 = fy + FOOT_Y + HALF_H;
    if (fx < 0 || fy < 0 || fx > W.w - 1 || fy > W.h - 1) return true;
    for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
      if (tx < 0 || ty < 0 || tx >= W.w || ty >= W.h || W.blk[ty * W.w + tx]) return true;
    }
    return false;
  }

  // a new body: { name, sprite, color, fx, fy, face, ... }
  function addBody(W, o) {
    const hearts = S('unit.hearts', 5);
    const b = Object.assign({ face: 1, walkPhase: 0, walkP: 0, moving: false, phase: Math.random() * 6.28, bubble: null, talkUntil: 0, hp: hearts, maxHp: hearts }, o);
    W.bodies.push(b);
    return b;
  }

  // walk in direction (dx, dy) for dt seconds at `speed` tiles per second. Returns how far he really went.
  function moveBody(W, b, dx, dy, dt, speed) {
    const len = Math.hypot(dx, dy);
    let moved = 0;
    if (len) {
      dx /= len; dy /= len;
      const n = Math.max(1, Math.ceil(dt * speed / 0.2));       // small steps so nobody ever jumps through a tree
      const sx = dx * speed * dt / n, sy = dy * speed * dt / n;
      for (let i = 0; i < n; i++) {
        const ox = b.fx, oy = b.fy;
        if (sx && !blocked(W, b.fx + sx, b.fy)) b.fx += sx;
        if (sy && !blocked(W, b.fx, b.fy + sy)) b.fy += sy;
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

  // pushed along by a dodge or a hit: slide `dist` tiles in direction (dx, dy), stopping at trees. Does not turn the body or make it hop.
  function slideBody(W, b, dx, dy, dist) {
    const len = Math.hypot(dx, dy);
    if (!len || dist <= 0) return 0;
    dx /= len; dy /= len;
    const n = Math.max(1, Math.ceil(dist / 0.15)), sx = dx * dist / n, sy = dy * dist / n;
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const ox = b.fx, oy = b.fy;
      if (sx && !blocked(W, b.fx + sx, b.fy)) b.fx += sx;
      if (sy && !blocked(W, b.fx, b.fy + sy)) b.fy += sy;
      moved += Math.hypot(b.fx - ox, b.fy - oy);
    }
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

  K.world = { growTrees, create: createWorld, freeTileNear, addBody, moveBody, slideBody, blocked };
})();
