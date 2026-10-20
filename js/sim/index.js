// Krowns - the simulation: starts a world and moves it forward in small fixed steps.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const sim = K.sim;
  const S = K.S;

  function newGame(opts) {
    opts = opts || {};
    const W = sim.createWorld(opts);
    const rng = W.rng;
    // several small groups of jobless people, far enough from each other that each can found its own kingdom
    const groups = S('world.startGroups', 4), size = S('world.startGroupSize', 5), R = S('world.startClusterRadius', 3);
    const m = Math.ceil(R) + 10;
    let spacing = S('world.startGroupSpacing', 24);
    const centers = [];
    for (let tries = 0; centers.length < groups && tries < 600; tries++) {
      if (tries % 100 === 99) spacing *= 0.85;
      const x = rng.int(m, W.w - 1 - m), y = rng.int(m, W.h - 1 - m);
      if (centers.every((c) => Math.hypot(c[0] - x, c[1] - y) >= spacing)) centers.push([x, y]);
    }
    while (centers.length < groups) centers.push([rng.int(m, W.w - 1 - m), rng.int(m, W.h - 1 - m)]);
    let i = 0;
    for (const [cx0, cy0] of centers) {
      for (let j = 0; j < size; j++, i++) {
        let spot = null;
        for (let tries = 0; tries < 80 && !spot; tries++) {
          const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R;
          const x = Math.round(cx0 + Math.cos(a) * r), y = Math.round(cy0 + Math.sin(a) * r);
          if (sim.tileFree(W, x, y)) spot = [x, y];
        }
        if (!spot) spot = sim.freeTileNear(W, cx0, cy0, 12, rng);
        if (!spot) continue;
        sim.createUnit(W, { x: spot[0], y: spot[1], job: 'villager', ageDays: rng.range(S('unit.adultAgeDays', 2) + 0.5, S('unit.adultAgeDays', 2) + 3), female: i % 2 === 0 });
      }
    }
    const cx = Math.round(centers.reduce((a, c) => a + c[0], 0) / centers.length), cy = Math.round(centers.reduce((a, c) => a + c[1], 0) / centers.length);
    W.view.startX = cx; W.view.startY = cy;
    sim.recomputeKmap(W);
    return W;
  }

  function oneSecond(W) {
    sim.kingdomUpdate(W);
    sim.ai.proclaimUpdate(W);
    sim.familyUpdate(W);
    sim.crimeUpdate(W);
    sim.chatUpdate(W);
    sim.rumorUpdate(W);
    sim.eventsUpdate(W);
    // tombstones fade
    const c = sim.clockAt(W.t);
    W.day = c.day; W.hour = c.hour;
  }

  // dt in world seconds (use 0.1)
  function step(W, dt) {
    W.t += dt; W.step++;
    for (const u of W.units) if (!u.dead) sim.ai.updateUnit(W, u, dt);
    sim.creaturesUpdate(W, dt);
    W.timers.sec = (W.timers.sec || 0) + dt;
    if (W.timers.sec >= 1) { W.timers.sec -= 1; oneSecond(W); }
    W.timers.animal += dt;
    if (W.timers.animal >= S('world.animalSpawnEverySeconds', 8)) { W.timers.animal = 0; sim.spawnUpdate(W); }
    W.timers.tree += dt;
    if (W.timers.tree >= S('world.treeRegrowEverySeconds', 4)) { W.timers.tree = 0; sim.treeUpdate(W); }
    if (W.units.some((u) => u.dead)) W.units = W.units.filter((u) => !u.dead);
    if (W.events.length > 400) W.events.splice(0, W.events.length - 400);
  }

  Object.assign(sim, { newGame, step, STEP: 0.1 });
})();
