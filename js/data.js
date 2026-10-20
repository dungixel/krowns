// Krowns - read access to the game data that comes from Notion (data/game-data.js).
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const D = K.data;
  if (!D) throw new Error('data/game-data.js is missing. Run: node tools/build-data.js');

  // number / text / list setting by key, e.g. K.S('hunger.max')
  K.S = (key, def) => {
    const v = D.settings[key];
    return v === undefined ? def : v;
  };
  K.C = (key, def) => (D.colors[key] === undefined ? def : D.colors[key]);
  K.job = (id) => D.jobs[id];
  K.anim = (id) => D.animations[id] || { stretch: 0, period: 1, height: 0, extra: {} };
  K.struct = (id) => D.structures[id];

  // pick a random speech line and fill in {words}
  K.line = (rng, category, vars) => {
    const list = D.speech[category];
    if (!list || !list.length) return '';
    return K.fill(rng.pick(list), vars);
  };
  K.fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));

  const jobs = Object.values(D.jobs);
  K.jobList = jobs;
  K.jobsWhere = (fn) => jobs.filter(fn);
  K.isFighter = (jobId) => { const j = D.jobs[jobId]; return !!j && j.cls === 'Fight'; };
  K.isRoyal = (jobId) => { const j = D.jobs[jobId]; return !!j && j.cls === 'Royalty'; };
})();
