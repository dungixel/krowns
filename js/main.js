// Krowns - starts everything and runs the game loop.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const sim = K.sim, R = K.render, ui = K.ui;
  const $ = (id) => document.getElementById(id);

  const game = (K.game = { W: null, speed: 1, acc: 0, last: 0, running: false, mode: 'sim' });

  function applyColors() {
    const r = document.documentElement.style;
    const map = { '--panel': 'ui.panel', '--text': 'ui.text', '--soft': 'ui.textSoft', '--line': 'ui.line', '--barback': 'ui.barBack' };
    for (const k in map) r.setProperty(k, K.C(map[k]));
  }

  game.setSpeed = function (s) { game.speed = s; ui.updateSpeed(s, K.audio.muted); };
  game.toggleSound = function () { K.audio.unlock(); K.audio.setMuted(!K.audio.muted); ui.updateSpeed(game.speed, K.audio.muted); };
  game.showStart = function () { $('start').classList.add('show'); game.prevSpeed = game.speed; game.setSpeed(0); };

  game.begin = function (seedText) {
    K.audio.unlock();
    const seed = seedText && /^\d+$/.test(seedText.trim()) ? +seedText.trim() >>> 0 : undefined;
    game.W = sim.newGame({ seed });
    R.world = game.W;
    ui.select(null);
    const W = game.W;
    R.resize();
    R.view.S = R.fitScale(52);
    R.centerOn(W.view.startX, W.view.startY);
    game.acc = 0; game.last = performance.now();
    $('start').classList.remove('show');
    $('seedlabel').textContent = 'Seed ' + W.seed;
    game.setSpeed(1);
    ui.logCount = -1;
  };

  // ---- the "walk around" mode: nothing but the map and one knight
  game.beginWalk = function (seedText) {
    K.audio.unlock();
    const seed = seedText && /^\d+$/.test(seedText.trim()) ? +seedText.trim() >>> 0 : undefined;
    game.mode = 'walk';
    document.body.classList.add('walkmode');
    const W = K.walk.start(seed);
    game.W = W; R.world = W;
    ui.select(null); R.follow = false;
    const kn = K.walk.knight, bar = (v, m, c, ic) => '<div class="bar"><span class="bi" style="color:' + c + '">' + K.icon(ic, 14) + '</span><div class="bt"><i style="width:' + Math.max(0, Math.min(1, v / m)) * 100 + '%;background:' + c + '"></i></div><b>' + (Math.round(v * 2) / 2) + '<small>/' + m + '</small></b></div>';
    $('walkhud').innerHTML = bar(kn.hearts, sim.maxHearts(kn), K.C('bar.hearts'), 'heart') + bar(kn.hunger, sim.hungerMax(), K.C('bar.hunger'), 'meat');
    R.walkId = K.walk.knight.id; R.fixedHour = 10; R.frac = 0;
    R.resize();
    R.view.S = R.fitScale(18);
    R.centerOn(W.view.startX, W.view.startY);
    game.last = performance.now();
    $('start').classList.remove('show');
    game.setSpeed(1);
  };
  game.toMenu = function () {
    if (game.mode !== 'walk') return;
    game.mode = 'sim';
    document.body.classList.remove('walkmode');
    R.walkId = null; R.fixedHour = undefined;
    game.W = sim.newGame({ seed: 7 }); R.world = game.W; R.view.S = R.fitScale(52); R.centerOn(game.W.view.startX, game.W.view.startY);
    for (let i = 0; i < 50; i++) sim.step(game.W, sim.STEP);
    game.showStart();
  };

  function frame(now) {
    requestAnimationFrame(frame);
    const W = game.W;
    if (!W) return;
    const dt = Math.min(0.25, (now - game.last) / 1000); game.last = now;
    if (game.mode === 'walk') {
      if (!$('start').classList.contains('show')) K.walk.update(W, dt);
      R.frac = 0; R.draw(W, now / 1000);
      return;
    }
    if (game.speed > 0) {
      game.acc += dt * game.speed;
      let n = 0;
      while (game.acc >= sim.STEP && n < 60) { sim.step(W, sim.STEP); game.acc -= sim.STEP; n++; }
      if (n >= 60) game.acc = 0;
    }
    R.frac = game.speed > 0 ? Math.min(game.acc, sim.STEP) : 0;
    K.audio.newFrame();
    R.draw(W, now / 1000);
    W.events.length = 0;
    ui.update(W);
  }

  // sound of the typed letters
  R.onChars = function (e, from, to) {
    if (e.kind !== 'unit') return;
    const v = R.view;
    const dx = (e.x * 16 + 8 - v.cx) * v.S, dy = (e.y * 16 + 8 - v.cy) * v.S;
    if (Math.abs(dx) > v.w * 0.6 || Math.abs(dy) > v.h * 0.6) return;
    const gain = 1 - Math.min(1, Math.hypot(dx, dy) / Math.hypot(v.w, v.h));
    if (to > from) K.audio.blip(e, gain);
  };

  // ------------------------------------------------------------------ input: mouse, touch, keyboard
  function bindInput() {
    const cv = $('game');
    const pointers = new Map();
    let drag = null, pinch = null, moved = 0;
    const cssToDev = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * R.view.dpr, y: (ev.clientY - r.top) * R.view.dpr }; };

    cv.addEventListener('pointerdown', (ev) => {
      K.audio.unlock();
      if (game.mode === 'walk') return;
      cv.setPointerCapture(ev.pointerId);
      const p = cssToDev(ev); pointers.set(ev.pointerId, p);
      if (pointers.size === 1) { drag = { x: p.x, y: p.y, sx: p.x, sy: p.y }; moved = 0; }
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), acc: 0 }; drag = null; }
    });
    cv.addEventListener('pointermove', (ev) => {
      if (game.mode === 'walk') return;
      const p = cssToDev(ev);
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > pinch.d * 1.35) { R.zoomStep(1, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch.d = d; }
        else if (d < pinch.d / 1.35) { R.zoomStep(-1, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch.d = d; }
        return;
      }
      if (drag && pointers.size === 1) {
        const dx = p.x - drag.x, dy = p.y - drag.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 8 * R.view.dpr) { R.panBy(dx, dy); R.follow = false; cv.style.cursor = 'grabbing'; }
        drag.x = p.x; drag.y = p.y;
      } else if (ev.pointerType === 'mouse') {
        const hit = R.pick(p.x, p.y);
        R.hover = hit && (hit.type === 'tomb' ? null : { id: hit.id });
        ui.setHover(hit, p.x, p.y);
        cv.style.cursor = hit ? 'pointer' : 'default';
      }
    });
    const up = (ev) => {
      if (game.mode === 'walk') return;
      const p = cssToDev(ev);
      const wasDrag = drag && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 8 * R.view.dpr;
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && pointers.size === 0 && !wasDrag && ev.type === 'pointerup') {
        const hit = R.pick(p.x, p.y);
        ui.select(hit);
        if (ev.pointerType !== 'mouse') ui.setHover(null);
      }
      if (pointers.size === 0) { drag = null; cv.style.cursor = 'default'; }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { R.hover = null; ui.setHover(null); });
    let wheelAcc = 0;
    cv.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      wheelAcc += ev.deltaY;
      if (Math.abs(wheelAcc) >= 60) { const p = cssToDev(ev); R.zoomStep(wheelAcc < 0 ? 1 : -1, p.x, p.y); wheelAcc = 0; }
    }, { passive: false });
    const keys = new Set();
    window.addEventListener('keydown', (ev) => {
      if (ev.target.tagName === 'INPUT') return;
      if (game.mode === 'walk') {
        const k = ev.key.toLowerCase();
        if (k === 'escape') { game.toMenu(); return; }
        if (k === '+' || k === '=') R.zoomStep(1); else if (k === '-') R.zoomStep(-1);
        else if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { ev.preventDefault(); K.walk.keys.add(k); }
        return;
      }
      keys.add(ev.key.toLowerCase());
      if (ev.key === ' ') { ev.preventDefault(); game.setSpeed(game.speed === 0 ? 1 : 0); }
      if (ev.key === '+' || ev.key === '=') R.zoomStep(1);
      if (ev.key === '-') R.zoomStep(-1);
      if (ev.key === 'Escape') ui.select(null);
      if (ev.key.toLowerCase() === 'f') { R.follow = !R.follow; ui.refreshPanel(true); }
      if (ev.key === '1') game.setSpeed(1); if (ev.key === '2') game.setSpeed(2); if (ev.key === '3') game.setSpeed(4);
    });
    window.addEventListener('keyup', (ev) => { keys.delete(ev.key.toLowerCase()); K.walk.keys.delete(ev.key.toLowerCase()); });
    window.addEventListener('blur', () => { keys.clear(); K.walk.keys.clear(); });
    setInterval(() => {
      let dx = 0, dy = 0;
      if (keys.has('arrowleft') || keys.has('a')) dx += 1; if (keys.has('arrowright') || keys.has('d')) dx -= 1;
      if (keys.has('arrowup') || keys.has('w')) dy += 1; if (keys.has('arrowdown') || keys.has('s')) dy -= 1;
      if (dx || dy) { R.panBy(dx * 14 * R.view.dpr, dy * 14 * R.view.dpr); R.follow = false; }
    }, 16);
    window.addEventListener('resize', () => R.resize());
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    applyColors();
    ui.init(game); ui.bindLog();
    R.init($('game'));
    bindInput();
    $('btn-start').disabled = true; $('btn-start').textContent = 'Loading...';
    try { await R.loadAssets('', document.documentElement.dataset.v || ''); }
    catch (e) { $('btn-start').textContent = 'Could not load the images'; console.error(e); return; }
    $('btn-start').disabled = false; $('btn-start').textContent = 'Generate world';
    $('btn-start').onclick = () => game.begin($('seed').value);
    $('btn-walk').onclick = () => game.beginWalk($('seed').value);
    $('btn-walkback').onclick = () => game.toMenu();
    $('btn-dice').onclick = () => { $('seed').value = String((Math.random() * 1e9) >>> 0); };
    const q = new URLSearchParams(location.search);
    if (q.get('seed')) $('seed').value = q.get('seed');
    if (q.get('auto') !== null) game.begin($('seed').value);
    if (q.get('walk') !== null) game.beginWalk($('seed').value);
    game.setSpeed(1);
    requestAnimationFrame(frame);
    // a quiet little world in the background of the start screen
    if (!game.W) { game.W = sim.newGame({ seed: 7 }); R.world = game.W; R.view.S = R.fitScale(52); R.centerOn(game.W.view.startX, game.W.view.startY); for (let i = 0; i < 50; i++) sim.step(game.W, sim.STEP); }
  }
  window.addEventListener('DOMContentLoaded', boot);
})();
