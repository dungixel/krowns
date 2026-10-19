// How well do worlds survive? node tools/survival.js [numberOfSeeds]
const path = require('path');
['util', 'names', 'words', 'sim'].forEach((f) => require(path.join(__dirname, '..', 'js', f + '.js')));
const K = globalThis.Krowns;
const n = +process.argv[2] || 24;
const marks = [1000, 2000, 3000, 4500];
const rows = [];
for (let seed = 100; seed < 100 + n; seed++) {
  const w = K.sim.createWorld({ seed, units: 20 });
  const pops = [];
  let wars = 0, minK = 99;
  for (let t = 1; t <= marks[marks.length - 1]; t++) {
    K.sim.tick(w);
    for (const e of w.events) if (e.type === 'war') wars++;
    w.events.length = 0;
    if (marks.includes(t)) pops.push(w.alive.length);
  }
  rows.push({ seed, pops, wars, kingdoms: w.kingdoms.size, deaths: w.stats.deaths, births: w.stats.births });
}
const avg = (i) => (rows.reduce((s, r) => s + r.pops[i], 0) / rows.length).toFixed(1);
console.log(`worlds: ${n}`);
console.log('avg population at', marks.join(' / '), '=>', marks.map((_, i) => avg(i)).join(' / '));
console.log('collapsed (<=5 souls) at end:', rows.filter((r) => r.pops[3] <= 5).length, ' with >=15 souls at end:', rows.filter((r) => r.pops[3] >= 15).length);
console.log('avg wars per world:', (rows.reduce((s, r) => s + r.wars, 0) / n).toFixed(1), ' avg births:', (rows.reduce((s, r) => s + r.births, 0) / n).toFixed(1));
const d = {}; for (const r of rows) for (const [k, v] of Object.entries(r.deaths)) d[k] = (d[k] || 0) + v;
console.log('deaths per world:', Object.entries(d).map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join(', '));
console.log('end populations:', rows.map((r) => r.pops[3]).sort((a, b) => a - b).join(' '));
