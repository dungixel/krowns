// Krowns - "Walk around": the world with nothing in it but trees, grass and one knight that you move with WASD / the arrow keys.
// The knight does not walk from tile to tile: he moves freely in any direction and slides along trees.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const walk = (K.walk = { keys: new Set(), W: null, knight: null });
  const sim = K.sim;
  const SPEED = 3.4;                 // tiles per second
  const HALF_W = 0.27, HALF_H = 0.2; // the little box of his feet, in tiles
  const FOOT_Y = 0.62;               // where the box sits inside his tile

  walk.start = function (seed) {
    const W = sim.createWorld({ seed });
    W.walk = true; W.view = {};
    const spot = sim.freeTileNear(W, Math.floor(W.w / 2), Math.floor(W.h / 2), 20, W.rng) || [Math.floor(W.w / 2), Math.floor(W.h / 2)];
    const k = sim.createUnit(W, { x: spot[0], y: spot[1], job: 'knight', ageDays: 4, female: false });
    k.free = true; k.fx = k.x; k.fy = k.y; k.walkP = 0; k.moving = false;
    walk.W = W; walk.knight = k; walk.keys.clear();
    W.view.startX = k.x; W.view.startY = k.y;
    return W;
  };

  // does the box of his feet, standing with its tile corner at (fx, fy), touch a tree?
  function blocked(W, fx, fy) {
    const x0 = fx + 0.5 - HALF_W, x1 = fx + 0.5 + HALF_W, y0 = fy + FOOT_Y - HALF_H, y1 = fy + FOOT_Y + HALF_H;
    if (fx < 0 || fy < 0 || fx > W.w - 1 || fy > W.h - 1) return true;
    for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
      if (tx < 0 || ty < 0 || tx >= W.w || ty >= W.h) return true;
      if (W.blk[ty * W.w + tx]) return true;
    }
    return false;
  }

  walk.update = function (W, dt) {
    const k = walk.knight;
    W.t += dt;
    const ks = walk.keys;
    let dx = 0, dy = 0;
    if (ks.has('a') || ks.has('arrowleft')) dx -= 1;
    if (ks.has('d') || ks.has('arrowright')) dx += 1;
    if (ks.has('w') || ks.has('arrowup')) dy -= 1;
    if (ks.has('s') || ks.has('arrowdown')) dy += 1;
    const len = Math.hypot(dx, dy);
    let moved = 0;
    if (len) {
      dx /= len; dy /= len;
      const n = Math.max(1, Math.ceil(dt * SPEED / 0.2));       // small steps so he never jumps through a tree
      const sx = dx * SPEED * dt / n, sy = dy * SPEED * dt / n;
      for (let i = 0; i < n; i++) {
        const ox = k.fx, oy = k.fy;
        if (sx && !blocked(W, k.fx + sx, k.fy)) k.fx += sx;
        if (sy && !blocked(W, k.fx, k.fy + sy)) k.fy += sy;
        moved += Math.hypot(k.fx - ox, k.fy - oy);
      }
      if (dx) k.face = dx > 0 ? 1 : -1;
    }
    // little hops while walking: one hop per tile walked; when he stops, the hop in progress is finished so he lands softly
    if (moved > 0) k.walkPhase = (k.walkPhase || 0) + moved;
    else if ((k.walkPhase || 0) % 1 > 0) k.walkPhase = Math.min(Math.ceil(k.walkPhase), k.walkPhase + SPEED * dt);
    k.walkP = (k.walkPhase || 0) % 1;
    k.hop = (moved > 0 || k.walkP > 0) ? { fx: k.x, fy: k.y, t: 0, dur: 1 } : null;
    // keep the grid in step with where he stands (nothing else uses it in this mode)
    const nx = Math.round(k.fx), ny = Math.round(k.fy);
    if (nx !== k.x || ny !== k.y) { W.unitAt[k.y * W.w + k.x] = 0; k.x = nx; k.y = ny; W.unitAt[ny * W.w + nx] = k.id; }
  };
})();
