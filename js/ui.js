// Krowns - the interface around the canvas: clock, speed, hover card, side panel (unit / chest / castle), event log.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const sim = K.sim;
  const { clamp, one } = K.util;
  const ui = (K.ui = {});

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (name, size, color) => '<span class="ic" style="color:' + (color || 'currentColor') + '">' + K.icon(name, size || 16) + '</span>';
  const clean = (t) => String(t || '').replace(/\s*\([^)]*guess[^)]*\)/gi, '').trim();   // notes about guesses stay in Notion
  const chip = (name, color) => '<span class="namechip" style="background:' + color + '">' + esc(name) + '</span>';
  const fmt = (v) => (Math.round(v * 10) / 10).toString();

  const TASKS = {
    wander: 'Wandering around', follow: 'Following', faint: 'Fainted', sleep: 'Sleeping', eat: 'Eating', forage: 'Looking for fruit', flee: 'Running away', leave: 'Leaving the kingdom',
    attack: 'Fighting', war: 'At war', report: 'Telling the king a rumor', petition: 'Asking the king', mourn: 'Mourning', learn: 'Learning', farm: 'Farming', chop: 'Chopping wood',
    hunt: 'Hunting', trade: 'Trading', build: 'Building', busk: 'Playing music', perform: 'Performing', watchPlay: 'Watching the show', heal: 'Healing', patrol: 'Patrolling',
    joke: 'Entertaining the king', serve: 'Serving at the inn', rule: 'Ruling', jail: 'Sitting out a punishment',
  };
  const taskText = (u) => {
    if (!u.task) return 'Thinking';
    if (u.task.type === 'learn' && u.learn.job) return 'Learning to be a ' + K.job(u.learn.job).name.toLowerCase();
    if (u.task.type === 'attack') return u.task.reason === 'duel' ? 'In a duel' : u.task.reason === 'crime' ? 'Attacking someone' : u.task.reason === 'vengeance' ? 'Seeking vengeance' : 'Fighting';
    return TASKS[u.task.type] || u.task.type;
  };

  function bar(value, max, color, iconName, label) {
    const pct = clamp(value / max, 0, 1) * 100;
    return '<div class="bar"><span class="bi" style="color:' + color + '">' + K.icon(iconName, 14) + '</span><div class="bt"><i style="width:' + pct + '%;background:' + color + '"></i></div><b>' + fmt(value) + '<small>/' + fmt(max) + '</small></b></div>';
  }
  function good(v) {
    // -10 (evil) ... +10 (good)
    const pct = (clamp(v, -10, 10) + 10) / 20 * 100;
    return '<div class="bar"><span class="bi" style="color:' + K.C('icon.evilgood') + '">' + K.icon('yin-yang', 14) + '</span><div class="bt gd"><i style="left:' + pct + '%"></i></div><b>' + fmt(v) + '</b></div>';
  }

  // ------------------------------------------------------------------ top bar
  ui.init = function (game) {
    ui.game = game;
    $('btn-pause').onclick = () => game.setSpeed(0);
    $('btn-1x').onclick = () => game.setSpeed(1);
    $('btn-2x').onclick = () => game.setSpeed(2);
    $('btn-4x').onclick = () => game.setSpeed(4);
    $('btn-zin').onclick = () => K.render.zoomStep(1);
    $('btn-zout').onclick = () => K.render.zoomStep(-1);
    $('btn-sound').onclick = () => game.toggleSound();
    $('btn-log').onclick = () => $('logbox').classList.toggle('open');
    $('btn-new').onclick = () => game.showStart();
    $('panel-close').onclick = () => ui.select(null);
    $('btn-follow').onclick = () => { K.render.follow = !K.render.follow; ui.refreshPanel(true); };
  };
  ui.updateSpeed = function (speed, muted) {
    for (const [id, v] of [['btn-pause', 0], ['btn-1x', 1], ['btn-2x', 2], ['btn-4x', 4]]) $(id).classList.toggle('on', speed === v);
    $('btn-sound').innerHTML = K.icon(muted ? 'volume-off' : 'volume', 18);
  };

  let lastClock = '';
  ui.update = function (W) {
    const c = sim.clockAt(W.t);
    const night = sim.isNightHour(c.hour);
    const txt = 'Day ' + c.day + ' · ' + c.text;
    if (txt !== lastClock) {
      lastClock = txt;
      $('clock').innerHTML = '<span class="ci">' + K.icon(night ? 'moon' : 'sun', 18) + '</span><b>Day ' + c.day + '</b><span class="tm">' + c.text + '</span>';
    }
    $('pop').innerHTML = ic('users', 15) + ' ' + W.units.length + (W.kingdoms.size ? ' &nbsp;' + ic('crown', 15, K.C('icon.kingdom')) + ' ' + W.kingdoms.size : '');
    // log
    if (ui.logCount !== W.log.length || ui.logLast !== (W.log[W.log.length - 1] || {}).t) {
      ui.logCount = W.log.length; ui.logLast = (W.log[W.log.length - 1] || {}).t;
      const list = W.log.slice(-40).reverse();
      $('loglist').innerHTML = list.map((l) => '<li data-ids="' + l.ids.join(',') + '"><b>D' + l.day + ' ' + l.time + '</b> ' + esc(l.text) + '</li>').join('');
    }
    ui.refreshPanel(false);
  };

  // ------------------------------------------------------------------ hover card
  ui.setHover = function (hit, sx, sy) {
    const el = $('hover');
    const W = K.render.world;
    if (!hit || !W) { el.classList.remove('show'); return; }
    let html = '';
    if (hit.type === 'unit') {
      const u = W.byId.get(hit.id); if (!u) { el.classList.remove('show'); return; }
      const j = K.job(sim.displayJob(u));
      const k = W.kingdoms.get(u.kingdom);
      html = '<div class="h1">' + chip(u.name, K.C('name.pastel.' + u.color)) + '</div><div class="sub">' + ic(j.icon, 14, j.color) + ' ' + esc(j.name) + (k ? ' · ' + esc(k.name) : ' · no kingdom') + (sim.isAdult(W, u) ? '' : ' · child') + '</div>' +
        bar(u.hearts, sim.maxHearts(u), K.C('bar.hearts'), 'heart') + bar(u.energy, sim.maxEnergy(u), K.C('bar.energy'), 'bolt') + bar(u.hunger, sim.hungerMax(), K.C('bar.hunger'), 'meat') +
        '<div class="sub">' + esc(taskText(u)) + '</div>';
    } else if (hit.type === 'creature') {
      const c = W.byId.get(hit.id); if (!c) { el.classList.remove('show'); return; }
      html = '<div class="h1">' + esc(c.def.name) + '</div><div class="sub">' + esc(c.def.behavior) + '</div>' + bar(c.hearts, c.maxHearts, K.C('bar.hearts'), 'heart');
    } else if (hit.type === 'structure') {
      const s = W.structures.get(hit.id); if (!s) { el.classList.remove('show'); return; }
      const def = K.struct(s.type); const k = W.kingdoms.get(s.kingdom);
      html = '<div class="h1">' + ic(def.icon, 16, def.iconColor) + ' ' + esc(def.name) + '</div><div class="sub">' + (k ? esc(k.name) : '') + (s.building ? ' · under construction' : '') + '</div>' + (s.type === 'kingdom_chest' ? '<div class="sub">Click to see what is inside</div>' : '');
    } else if (hit.type === 'tomb') {
      html = '<div class="h1">' + ic('grave-2', 16) + ' ' + esc(hit.ref.name) + '</div><div class="sub">Rest in peace</div>';
    }
    el.innerHTML = html;
    el.classList.add('show');
    const w = el.offsetWidth, h = el.offsetHeight;
    const cssX = sx / K.render.view.dpr, cssY = sy / K.render.view.dpr;
    el.style.left = clamp(cssX + 16, 8, window.innerWidth - w - 8) + 'px';
    el.style.top = clamp(cssY + 16, 8, window.innerHeight - h - 8) + 'px';
  };

  // ------------------------------------------------------------------ side panel
  ui.select = function (hit) {
    K.render.selected = hit;
    if (!hit) K.render.follow = false;
    ui.panelKey = null;
    ui.refreshPanel(true);
  };
  ui.refreshPanel = function (force) {
    const W = K.render.world; const sel = K.render.selected;
    const el = $('panel');
    if (!sel || !W) { el.classList.remove('open'); return; }
    const now = performance.now();
    if (!force && now - (ui.lastPanel || 0) < 250) return;
    ui.lastPanel = now;
    let html = '';
    let showFollow = false;
    if (sel.type === 'unit') { const u = W.byId.get(sel.id); if (!u) { ui.select(null); return; } html = unitPanel(W, u); showFollow = true; }
    else if (sel.type === 'creature') { const c = W.byId.get(sel.id); if (!c) { ui.select(null); return; } html = creaturePanel(W, c); }
    else if (sel.type === 'structure') { const s = W.structures.get(sel.id); if (!s) { ui.select(null); return; } html = structurePanel(W, s); }
    else if (sel.type === 'tomb') html = '<h2>' + ic('grave-2', 20) + ' ' + esc(sel.ref.name) + '</h2><p class="sub">Was a ' + esc(K.job(sel.ref.job).name.toLowerCase()) + '. Rest in peace.</p>';
    $('panel-body').innerHTML = html;
    $('btn-follow').style.display = showFollow ? '' : 'none';
    $('btn-follow').classList.toggle('on', !!K.render.follow);
    el.classList.add('open');
    for (const a of el.querySelectorAll('[data-sel]')) a.onclick = () => { const id = +a.dataset.sel; const t = W.byId.get(id); if (t) { ui.select({ type: t.kind, id }); K.render.centerOn(t.x, t.y); } };
    for (const a of el.querySelectorAll('[data-struct]')) a.onclick = () => { const s = W.structures.get(+a.dataset.struct); if (s) { ui.select({ type: 'structure', id: s.id }); K.render.centerOn(s.x + s.w / 2, s.y + s.h / 2); } };
  };

  const link = (W, id) => { const o = W.byId.get(id); return o ? '<a data-sel="' + id + '">' + esc(o.name) + '</a>' : '<span class="dim">gone</span>'; };

  function unitPanel(W, u) {
    const jid = sim.displayJob(u);
    const j = K.job(jid);
    const k = W.kingdoms.get(u.kingdom);
    const age = sim.ageDays(W, u);
    const fam = W.families.get(u.family);
    const kids = u.children.map((id) => link(W, id)).join(', ');
    const partner = u.partner ? link(W, u.partner) : '<span class="dim">none</span>';
    const parents = u.parents.length ? u.parents.map((id) => link(W, id)).join(', ') : '<span class="dim">unknown</span>';
    const evs = Object.keys(u.ev).filter((e) => u.ev[e] > 0).map((e) => esc(K.job(e).name) + ' <b>' + fmt(u.ev[e]) + '</b>').join(' · ');
    const rumors = u.rumors.slice(-4).map((r) => '<li>' + esc(r.r.whoName + ' ' + r.r.what) + ' <span class="dim">(D' + r.r.day + ' ' + r.r.time + ')</span></li>').join('');
    const traits = u.traits.map((t) => '<span class="chip">' + esc(t.replace(/([A-Z])/g, ' $1').toLowerCase()) + '</span>').join('');
    return '<h2>' + chip(u.name, K.C('name.pastel.' + u.color)) + (u.female ? ' <small>♀</small>' : ' <small>♂</small>') + '</h2>' +
      '<div class="sub">' + ic(j.icon, 15, j.color) + ' ' + esc(j.name) + (k ? ' of ' + '<a data-struct="' + k.castleId + '">' + esc(k.name) + '</a>' : ' · no kingdom') + '</div>' +
      '<p class="desc">' + esc(clean(j.description)) + '</p>' +
      '<div class="now">' + esc(taskText(u)) + (u.status ? ' · <b style="color:' + K.C('icon.status.' + u.status) + '">' + (u.status === 'burn' ? 'burning' : 'poisoned') + '</b>' : '') + '</div>' +
      bar(u.hearts, sim.maxHearts(u), K.C('bar.hearts'), 'heart') + bar(u.energy, sim.maxEnergy(u), K.C('bar.energy'), 'bolt') + bar(u.hunger, sim.hungerMax(), K.C('bar.hunger'), 'meat') + good(u.evilGood) +
      '<div class="grid2"><div>' + ic('barbell', 14, K.C('icon.strength')) + ' Strength <b>' + fmt(u.iv.strength) + '</b></div><div>' + ic('hourglass', 14, K.C('icon.longevity')) + ' Age <b>' + fmt(age) + '</b> / ' + fmt(u.iv.longevity) + ' days</div></div>' +
      '<h3>Born with (IVs)</h3><div class="sub">Hearts <b>' + fmt(u.iv.hearts) + '</b> · Energy <b>' + fmt(u.iv.energy) + '</b> · Evil/good <b>' + fmt(u.iv.evilgood) + '</b> · Strength <b>' + fmt(u.iv.strength) + '</b> · Longevity <b>' + fmt(u.iv.longevity) + '</b></div>' +
      '<h3>Trained (EVs)</h3><div class="sub">' + (evs || '<span class="dim">nothing yet</span>') + '</div>' +
      (u.learn.job && u.job === 'villager' ? '<div class="sub">Wants to become a <b>' + esc(K.job(u.learn.job).name.toLowerCase()) + '</b> · ' + Math.round(clamp(u.learn.progress / S('learn.selfSeconds', 150), 0, 1) * 100) + '%</div>' : '') +
      '<h3>Traits</h3><div>' + (traits || '<span class="dim">none</span>') + '</div>' +
      '<h3>Family</h3><div class="sub">Partner: ' + partner + '<br>Parents: ' + parents + '<br>Children: ' + (kids || '<span class="dim">none</span>') + '</div>' +
      (u.rumors.length ? '<h3>Rumors known</h3><ul class="rl">' + rumors + '</ul>' : '');
  }
  function creaturePanel(W, c) {
    return '<h2>' + esc(c.def.name) + '</h2><div class="sub">' + esc(c.def.behavior) + (c.def.nightOnly ? ' · only at night' : '') + '</div><p class="desc">' + esc(clean(c.def.description)) + '</p>' + bar(c.hearts, c.maxHearts, K.C('bar.hearts'), 'heart') +
      '<div class="sub">Damage <b>' + fmt(c.def.dps) + '</b>/s · Speed <b>' + fmt(c.def.speed) + '</b>' + (c.def.food ? ' · Meat <b>' + fmt(c.def.food) + '</b>' : '') + '</div>';
  }
  function kingdomRows(W, k) {
    const c = sim.counts(W, k);
    const jobs = Object.keys(c).filter((x) => K.job(x)).sort((a, b) => c[b] - c[a]).map((x) => '<div class="row">' + ic(K.job(x).icon, 14, K.job(x).color) + ' ' + esc(K.job(x).name) + '<b>' + c[x] + '</b></div>').join('');
    return jobs;
  }
  function structurePanel(W, s) {
    const def = K.struct(s.type);
    const k = W.kingdoms.get(s.kingdom);
    let html = '<h2>' + ic(def.icon, 20, def.iconColor) + ' ' + esc(def.name) + '</h2>' + (k ? '<div class="sub">' + esc(k.name) + '</div>' : '') + '<p class="desc">' + esc(clean(def.description)) + '</p>';
    if (s.type === 'kingdom_chest' && k) {
      html += '<h3>Inside the chest</h3><div class="inv">' +
        '<div>' + ic('wheat', 20, '#e8c46a') + '<b>' + fmt(k.chest.food) + '</b><small>food</small></div>' +
        '<div>' + ic('wood', 20, '#b58a5a') + '<b>' + fmt(k.chest.wood) + '</b><small>wood</small></div>' +
        '<div>' + ic('coins', 20, '#e6b84a') + '<b>' + fmt(k.chest.gold) + '</b><small>gold</small></div></div>';
      const stock = []; for (const f of W.families.values()) if (f.kingdom === k.id && f.stock) stock.push(f.stock);
      if (stock.length) html += '<div class="sub">Families also keep ' + fmt(stock.reduce((a, b) => a + b, 0)) + ' food at home.</div>';
    } else if (k) {
      const king = W.byId.get(k.king);
      html += '<div class="sub">' + (king ? ic('crown', 14, K.C('icon.kingdom')) + ' ' + (king.female ? 'Queen' : 'King') + ' ' + link(W, king.id) : '') + '</div>';
      if (s.type === 'castle') {
        html += '<div class="sub">' + ic('users', 14) + ' Citizens <b>' + k.citizens.size + '</b> · border radius <b>' + fmt(k.radius) + '</b> tiles</div>';
        html += '<h3>Chest</h3><div class="sub"><a data-struct="' + k.chestId + '">Food ' + fmt(k.chest.food) + ' · Wood ' + fmt(k.chest.wood) + ' · Gold ' + fmt(k.chest.gold) + '</a></div>';
        html += '<h3>Jobs</h3>' + kingdomRows(W, k);
        if (k.war) { const o = W.kingdoms.get(k.war.a === k.id ? k.war.d : k.war.a); html += '<h3>At war</h3><div class="sub">' + (o ? 'with ' + esc(o.name) : '') + (k.war.a === k.id ? ' (attacking)' : ' (defending)') + '</div>'; }
        if (k.plays && k.plays[0]) html += '<div class="sub">' + ic('masks-theater', 14) + ' Play planned on Day ' + k.plays[0].day + ' at ' + k.plays[0].time + '</div>';
      }
      if (s.type === 'house') {
        const f = W.families.get(s.family);
        const mem = f ? sim.familyUnits(W, f).map((m) => link(W, m.id)).join(', ') : '';
        html += '<div class="sub">Lives here: ' + (mem || '<span class="dim">nobody</span>') + '</div>' + (f ? '<div class="sub">Food at home: <b>' + fmt(f.stock) + '</b></div>' : '');
      }
    }
    if (s.building) html += '<div class="sub">Building: <b>' + Math.round(clamp(s.progress / s.buildSeconds, 0, 1) * 100) + '%</b></div>';
    if (s.type !== 'kingdom_chest') html += bar(s.hearts, s.maxHearts, K.C('bar.hearts'), 'heart');
    return html;
  }

  // ------------------------------------------------------------------ log clicks
  ui.bindLog = function () {
    $('loglist').onclick = (ev) => {
      const li = ev.target.closest('li'); if (!li) return;
      const ids = li.dataset.ids.split(',').map(Number).filter(Boolean);
      const W = K.render.world;
      for (const id of ids) { const e = W.byId.get(id); if (e) { ui.select({ type: e.kind, id }); K.render.centerOn(e.x, e.y); break; } }
    };
  };
  ui.toast = function (msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(ui.tt); ui.tt = setTimeout(() => t.classList.remove('show'), 2200); };
})();
