// Krowns - starts everything: the title screen, choosing a name, the game loop and the keyboard.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S, R = K.render;
  const $ = (id) => document.getElementById(id);
  const game = (K.game = { W: null, player: null, npc: null, playing: false });
  const keys = new Set();
  let last = 0;

  function applyColors() {
    const r = document.documentElement.style;
    const map = { '--panel': 'ui.panel', '--text': 'ui.text', '--soft': 'ui.textSoft', '--line': 'ui.line' };
    for (const k in map) r.setProperty(k, K.C(map[k]));
  }

  // a quiet empty meadow behind the title screen
  function backdrop() {
    game.W = K.world.create(7); game.W.bodies = []; R.follow = null;
    R.view.S = R.fitScale(52); R.view.cx = game.W.w * 8; R.view.cy = game.W.h * 8;
  }

  function begin(name) {
    const W = K.world.create();
    const [tx, ty] = K.world.freeTileNear(W, Math.floor(W.w / 2), Math.floor(W.h / 2), 12);
    const player = K.world.addBody(W, { kind: 'player', name, color: W.rng.int(1, 12), sprite: 'knight', fx: tx, fy: ty, face: 1 });
    game.W = W; game.player = player; game.npc = K.npc.create(W, player);
    R.follow = player; R.zoomTarget = null; R.view.S = R.fitScale(18); R.centerOn(player);
    keys.clear(); game.playing = true;
    document.body.classList.add('playing');
    $('start').classList.remove('show', 'naming');
  }
  function toMenu() {
    game.playing = false; keys.clear();
    document.body.classList.remove('playing');
    backdrop();
    $('start').classList.remove('naming'); $('start').classList.add('show');
  }

  // the distance makes a voice quieter
  R.onChars = function (b, from, to) {
    if (!game.player || !b.voice || !b.bubble) return;
    const d = Math.hypot(b.fx - game.player.fx, b.fy - game.player.fy);
    const gain = Math.max(0.15, 1 - d / 22);
    for (let i = from; i < to; i++) K.voice.say(b.bubble.text[i], b.voice, gain, b.bubble.plan[i]);
  };

  function frame(now) {
    requestAnimationFrame(frame);
    const W = game.W;
    if (!W) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    W.t += dt;
    if (game.playing) {
      const p = game.player;
      const dx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      const dy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
      K.world.moveBody(W, p, dx, dy, dt, S('player.speedTilesPerSecond', 3.4));
      K.npc.update(W, game.npc, p, dt);
    }
    K.voice.newFrame();
    R.draw(W, now / 1000);
  }

  function bindInput() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target.tagName === 'INPUT') return;
      const k = ev.key.toLowerCase();
      if (!game.playing) return;
      if (k === 'escape') { toMenu(); return; }
      if (k === '+' || k === '=') R.zoomStep(1); else if (k === '-') R.zoomStep(-1);
      else if (k === 'e') { if (game.npc.ai.mode !== 'talk') K.npc.sayRandom(game.W, game.npc); }
      else if (k === 'm') { K.voice.setMuted(!K.voice.muted); try { localStorage.setItem('krowns.muted', K.voice.muted ? '1' : '0'); } catch (e) { /* fine */ } }
      else if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { ev.preventDefault(); keys.add(k); }
    });
    window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
    window.addEventListener('blur', () => keys.clear());
    window.addEventListener('resize', () => R.resize());
    let wheel = 0;
    $('game').addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (!game.playing) return;
      wheel += ev.deltaY;
      if (Math.abs(wheel) >= 60) { R.zoomStep(wheel < 0 ? 1 : -1); wheel = 0; }
    }, { passive: false });
  }

  async function boot() {
    applyColors();
    R.init($('game'));
    bindInput();
    $('btn-play').textContent = 'Loading...';
    try { await R.loadAssets(document.documentElement.dataset.v || ''); }
    catch (e) { $('btn-play').textContent = 'Could not load the pictures'; console.error(e); return; }
    backdrop();
    const input = $('name'), go = $('btn-go');
    const clean = () => input.value.replace(/\s+/g, ' ').trim().slice(0, 12);
    input.addEventListener('input', () => { go.disabled = !clean(); });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && clean()) go.click(); });
    $('btn-play').disabled = false; $('btn-play').textContent = 'Play';
    $('btn-play').onclick = () => {
      K.voice.unlock();
      $('start').classList.add('naming');
      try { input.value = localStorage.getItem('krowns.name') || ''; } catch (e) { /* fine */ }
      go.disabled = !clean(); input.focus(); input.select();
    };
    go.onclick = () => {
      const name = clean(); if (!name) return;
      try { localStorage.setItem('krowns.name', name); } catch (e) { /* fine */ }
      K.voice.unlock(); begin(name);
    };
    $('menu').onclick = toMenu;
    const q = new URLSearchParams(location.search);
    if (q.get('name')) { begin(q.get('name').slice(0, 12)); }
    last = performance.now();
    requestAnimationFrame(frame);
  }
  window.addEventListener('DOMContentLoaded', boot);
})();
