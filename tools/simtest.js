// Headless test of the simulation: node tools/simtest.js [seeds] [ticks]
// Runs worlds for a long time and checks nothing breaks (no NaN, nobody off the map, no stacking).
const path = require('path');
['util', 'names', 'words', 'sim'].forEach((f) => require(path.join(__dirname, '..', 'js', f + '.js')));
const K = globalThis.Krowns;

const seeds = (process.argv[2] || '1,2,3,4,5,6').split(',').map(Number);
const ticks = Number(process.argv[3] || 3000);
let problems = 0;
const fail = (m) => { problems++; if (problems < 25) console.log('  PROBLEM:', m); };

for (const seed of seeds) {
  const w = K.sim.createWorld({ seed, units: 20 });
  const seen = { say: 0, hit: 0, spell: 0, war: 0, birth: 0, love: 0, found: 0, fell: 0, death: 0 };
  const roleHist = {};
  let maxPop = 0, maxK = 0, peakSay = 0;
  const t0 = Date.now();
  for (let i = 1; i <= ticks; i++) {
    try { K.sim.tick(w); } catch (e) { fail(`seed ${seed} tick ${i}: ${e.stack}`); break; }
    let sayThisTick = 0;
    for (const ev of w.events) { if (seen[ev.type] !== undefined) seen[ev.type]++; if (ev.type === 'say') sayThisTick++; }
    peakSay = Math.max(peakSay, sayThisTick);
    w.events.length = 0;
    maxPop = Math.max(maxPop, w.alive.length); maxK = Math.max(maxK, w.kingdoms.size);
    // invariants
    const spots = new Set();
    for (const u of w.alive) {
      if (!u.alive) fail('dead unit in alive list');
      if (![u.x, u.y, u.hearts, u.hunger, u.anger].every(Number.isFinite)) fail(`NaN on ${u.name}`);
      if (u.x < 0 || u.y < 0 || u.x >= w.w || u.y >= w.h) fail(`${u.name} off map ${u.x},${u.y}`);
      if (u.hearts > u.maxHearts + 1e-9 || u.hearts <= 0) fail(`${u.name} hearts ${u.hearts}/${u.maxHearts}`);
      if (u.hunger < 0 || u.hunger > 5) fail(`${u.name} hunger ${u.hunger}`);
      if (u.maxHearts < 6 || u.maxHearts > 20) fail(`${u.name} maxHearts ${u.maxHearts}`);
      const key = u.x + ',' + u.y;
      if (spots.has(key)) fail(`stacked units at ${key} t=${i}`);
      spots.add(key);
      if (u.kingdom != null && !w.kingdoms.has(u.kingdom)) fail(`${u.name} in missing kingdom ${u.kingdom}`);
      if (u.kingdom != null && !w.kingdoms.get(u.kingdom).members.has(u.id)) fail(`${u.name} not in member set`);
      if (u.partner != null) { const p = w.units.get(u.partner); if (!p || p.partner !== u.id) fail(`${u.name} partner mismatch`); }
      if (!w.occ.get(u.y * w.w + u.x) || w.occ.get(u.y * w.w + u.x) !== u) fail(`occupancy mismatch ${u.name}`);
      if (w.animalAt.has(u.y * w.w + u.x)) fail(`${u.name} shares a square with an animal`);
    }
    const aspots = new Set();
    for (const a of w.animals) {
      if (!a.alive) continue;
      const key = a.y * w.w + a.x;
      if (aspots.has(key)) fail(`two animals on one square ${a.x},${a.y}`);
      aspots.add(key);
      if (w.struct.has(key)) fail('animal inside a structure');
      if (w.animalAt.get(key) !== a) fail('animal map mismatch');
    }
    for (const k of w.kingdoms.values()) if (!w.struct.has(k.cy * w.w + k.cx)) fail(`castle of ${k.name} not registered`);
    for (const k of w.kingdoms.values()) {
      for (const id of k.members) { const m = w.units.get(id); if (!m || !m.alive || m.kingdom !== k.id) fail(`kingdom ${k.name} bad member ${id}`); }
      if (k.ruler != null && !k.members.has(k.ruler)) fail(`ruler of ${k.name} not a member`);
      const g = k.granary;
      if (g.bread < 0 || g.meat < 0) fail(`negative food in ${k.name}`);
    }
    if (i % 1000 === 0) {
      for (const u of w.alive) if (u.role) roleHist[u.role] = (roleHist[u.role] || 0) + 1;
    }
  }
  const ms = Date.now() - t0;
  const kings = [...w.kingdoms.values()].map((k) => `${k.name}(${k.members.size}, food ${K.sim.foodPoints(k)}, farms ${k.farms.length}${k.wars.size ? ', WAR' : ''})`).join(' ');
  console.log(`seed ${seed}: pop ${w.alive.length} (peak ${maxPop}), kingdoms ${w.kingdoms.size} (peak ${maxK}), time ${w.time}s, ${ms}ms`);
  console.log('   ', kings || '(none)');
  console.log('    deaths', JSON.stringify(w.stats.deaths), 'births', w.stats.births, 'events', JSON.stringify(seen), 'peak bubbles/tick', peakSay);
  const spellers = w.alive.filter((u) => u.spells.size > 1).length;
  const lovers = w.alive.filter((u) => u.partner != null).length;
  const exes = w.alive.filter((u) => u.exes.length).length;
  console.log('    mages w/ spells', spellers, 'coupled', lovers, 'with exes', exes, 'roles@end', JSON.stringify(roleHist));
}
console.log(problems ? `\n${problems} problem(s)` : '\nAll invariants held.');
process.exit(problems ? 1 : 0);
