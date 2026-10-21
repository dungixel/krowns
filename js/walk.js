// Krowns - "Walk around": the world with nothing in it but trees, grass and one knight that you move with WASD / the arrow keys.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const walk = (K.walk = { keys: new Set(), W: null, knight: null });
  const sim = K.sim;

  walk.start = function (seed) {
    const W = sim.createWorld({ seed });
    W.walk = true; W.view = {};
    const spot = sim.freeTileNear(W, Math.floor(W.w / 2), Math.floor(W.h / 2), 20, W.rng) || [Math.floor(W.w / 2), Math.floor(W.h / 2)];
    const k = sim.createUnit(W, { x: spot[0], y: spot[1], job: 'knight', ageDays: 4, female: false });
    walk.W = W; walk.knight = k; walk.keys.clear();
    W.view.startX = k.x; W.view.startY = k.y;
    return W;
  };

  // one frame: advance the walking hop, and when a hop ends start the next one in the direction of the keys (so the walk never stops between tiles)
  walk.update = function (W, dt) {
    const k = walk.knight;
    W.t += dt;
    sim.advanceHop(k, dt);
    if (k.hop) return;
    const K_ = walk.keys;
    let dx = 0, dy = 0;
    if (K_.has('a') || K_.has('arrowleft')) dx -= 1;
    if (K_.has('d') || K_.has('arrowright')) dx += 1;
    if (K_.has('w') || K_.has('arrowup')) dy -= 1;
    if (K_.has('s') || K_.has('arrowdown')) dy += 1;
    if (!dx && !dy) { k.hopOver = 0; return; }
    const free = (x, y) => sim.tileFree(W, x, y);
    let nx = k.x, ny = k.y;
    if (dx && dy && free(k.x + dx, k.y + dy) && free(k.x + dx, k.y) && free(k.x, k.y + dy)) { nx += dx; ny += dy; }
    else if (dx && free(k.x + dx, k.y)) nx += dx;
    else if (dy && free(k.x, k.y + dy)) ny += dy;
    else if (dx) { k.face = dx; return; }
    else return;
    sim.startHop(W, k, nx, ny, true);
  };
})();
