// Runs the simulation without any drawing, for many days, and checks that nothing breaks.
globalThis.Krowns = {};
const path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['data/game-data.js', 'js/util.js', 'js/data.js', 'js/names.js', 'js/sim/core.js', 'js/sim/units.js', 'js/sim/kingdom.js', 'js/sim/social.js', 'js/sim/creatures.js', 'js/sim/events.js', 'js/sim/ai.js', 'js/sim/jobs.js', 'js/sim/index.js']) require(path.join(root, f));
const K = globalThis.Krowns, sim = K.sim;
const days = +process.argv[2] || 6, seed = process.argv[3] !== undefined ? +process.argv[3] : 1;
const W = sim.newGame({ seed });
const dayLen = sim.dayLength();
let nextReport = 0;
const t0 = Date.now();
function check() {
  const errs = [];
  for (const u of W.units) {
    if (u.x < 0 || u.y < 0 || u.x >= W.w || u.y >= W.h) errs.push('out of bounds ' + u.name);
    if (!u.hop && W.unitAt[u.y * W.w + u.x] !== u.id) errs.push('unitAt mismatch ' + u.name + ' ' + u.x + ',' + u.y + ' has ' + W.unitAt[u.y * W.w + u.x] + ' job ' + u.job + ' task ' + (u.task && u.task.type));
    if (W.blk[u.y * W.w + u.x] !== 0) errs.push('unit inside obstacle ' + u.name + ' occ=' + W.occ[u.y * W.w + u.x]);
    for (const v of [u.hearts, u.energy, u.hunger, u.evilGood]) if (!Number.isFinite(v)) errs.push('NaN on ' + u.name);
    const rd = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
    for (const k of sim.IV_KEYS) if (!rd(u.iv[k]) || Math.abs(u.iv[k] * 2 - Math.round(u.iv[k] * 2)) > 1e-6) errs.push('IV not 0.5 step ' + k + ' ' + u.iv[k]);
  }
  return errs;
}
let bad = [];
const steps = Math.round(days * dayLen / sim.STEP);
for (let i = 0; i < steps; i++) {
  sim.step(W, sim.STEP);
  W.events.length = 0;
  if (i % 50 === 0) { const e = check(); if (e.length) { bad.push(...e.slice(0, 3)); if (bad.length > 12) break; } }
  if (W.t >= nextReport) {
    nextReport += dayLen / 2;
    const c = sim.clockAt(W.t);
    const ks = [...W.kingdoms.values()].map((k) => k.name + '(' + k.citizens.size + ')').join(',');
    const jobs = {}; for (const u of W.units) jobs[u.job] = (jobs[u.job] || 0) + 1;
    console.log('day ' + c.day + ' ' + c.text + ' units ' + W.units.length + ' creatures ' + W.creatures.length + ' trees ' + W.trees.size + ' kingdoms ' + ks + ' born ' + W.stats.born + ' died ' + W.stats.died + ' ' + JSON.stringify(jobs));
  }
}
console.log('finished in ' + (Date.now() - t0) + ' ms; sim time ' + W.t.toFixed(0) + ' s');
for (const k of W.kingdoms.values()) console.log(k.name, JSON.stringify(k.chest), 'structures', [...W.structures.values()].filter((s) => s.kingdom === k.id).map((s) => s.type + (s.building ? '*' : '')).join(','), 'plays', W.stats.plays, 'wars', W.stats.wars);
console.log('log tail:\n' + W.log.slice(-25).map((l) => 'D' + l.day + ' ' + l.time + ' ' + l.text).join('\n'));
if (bad.length) { console.log('PROBLEMS:\n' + bad.join('\n')); process.exit(1); }
console.log('OK');
