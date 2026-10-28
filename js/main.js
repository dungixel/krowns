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
    const map = { '--panel': 'ui.panel', '--text': 'ui.text', '--soft': 'ui.textSoft', '--line': 'ui.line', '--crown': 'ui.crown' };
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
    K.npc.populate(W, player, game.npc); K.combat.populate(W, player);
    R.follow = player; R.zoomTarget = null; R.view.S = R.fitScale(18); R.centerOn(player);
    keys.clear(); game.playing = true; game.last = 0; buildLines();
    $('lines').classList.add('closed');
    document.body.classList.add('playing');
    $('start').classList.remove('show', 'naming');
  }
  function toMenu() {
    game.playing = false; keys.clear();
    document.body.classList.remove('playing');
    backdrop();
    $('start').classList.remove('naming'); $('start').classList.add('show');
  }

  // the list of sentences the neighbour can say
  function buildLines() {
    const list = $('lines-list'), lines = K.lines();
    $('lines-title').textContent = S('npc.name', 'Neighbour') + ' says...';
    list.textContent = '';
    lines.forEach((l, i) => {
      const b = document.createElement('button'); b.dataset.i = i;
      const n = document.createElement('b'); n.textContent = i < 10 ? (i + 1) % 10 : '';
      const t = document.createElement('span'); t.textContent = l.text;
      b.append(n, t); b.onclick = () => { say(i); b.blur(); };
      list.appendChild(b);
    });
    $('lines-head').onclick = () => $('lines').classList.toggle('closed');
  }
  function say(i) {
    if (!game.playing || !K.lines()[i]) return;
    game.last = i; K.voice.unlock();
    K.npc.sayLine(game.W, game.npc, i);
    document.querySelectorAll('#lines-list button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === i));
  }

  // proximity chat: every unit is heard by how far away it is (quieter, duller and from its side), and not at all beyond voice.hearTiles
  R.onChars = function (b, from, to) {
    if (!game.player || !b.voice || !b.bubble) return;
    const dx = b.fx - game.player.fx, dy = b.fy - game.player.fy;
    const gain = K.voice.hearing(Math.hypot(dx, dy)), pan = Math.max(-1, Math.min(1, dx / 10)) * 0.8;
    for (let i = from; i < to; i++) K.voice.say(b.bubble.text[i], b.voice, gain, b.bubble.plan[i], pan);
  };

  // every hit shakes the screen a little (more the nearer the hit is to the middle of the screen). content/settings.json: shake.*
  K.combat.onHurt = function (t, src, lethal) {
    const p = game.player;
    if (!(S('shake.others', 1) || src === p || (t === p && S('shake.whenPlayerHurt', 1)))) return;
    R.hitShake(t.fx * 16 + 8, t.fy * 16 + 8 + 10, S('shake.hitPixels', 2.5) * (lethal ? S('shake.defeatMultiplier', 1.8) : 1));
  };

  function frame(now) {
    requestAnimationFrame(frame);
    const W = game.W;
    if (!W) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    W.t += dt;
    if (game.playing) {
      const p = game.player;
      const dx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      const dy = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
      // arrow keys attack: hold an arrow (or two for a diagonal) and you slash that way as often as the slash is ready
      const ax = (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0), ay = (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0);
      if (ax || ay) {
        if (!game.aimSince) game.aimSince = now;
        if (now - game.aimSince >= 50 && !p.ko && K.combat.canSlash(W, p)) K.combat.slash(W, p, Math.atan2(ay, ax));     // 50 ms so two arrows pressed together make a diagonal
      } else game.aimSince = 0;
      if (!p.dodge && !p.kb && !p.ko && !p.slash) K.world.moveBody(W, p, dx, dy, dt, S('player.speedTilesPerSecond', 3.4));
      for (const k of K.npc.all(W)) K.npc.update(W, k, p, dt);
      K.world.growTrees(W);
      K.combat.update(W, dt, p);
    }
    K.voice.newFrame();
    R.draw(W, now / 1000);
  }

  // Shift: dodge toward the direction you hold (W A S D); if you hold nothing, toward the mouse pointer
  function playerDodge() {
    const p = game.player, W = game.W;
    let dx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    let dy = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
    if (!dx && !dy && game.mouse) {
      const m = R.toWorld(game.mouse.x, game.mouse.y);
      dx = m.x - (p.fx + 0.5); dy = m.y - (p.fy + 0.62);
      if (Math.hypot(dx, dy) < 0.3) { dx = p.face; dy = 0; }
    }
    if (!dx && !dy) dx = p.face;
    if (p.slash) { p.slash = null; p.slashFx = null; }               // a dodge cancels a slash
    K.combat.dodge(W, p, dx, dy);
  }
  // click: slash toward the mouse pointer (the arrow keys slash in their own direction, see frame())
  function playerSlash() {
    const p = game.player;
    let dx = p.face, dy = 0;
    if (game.mouse) {
      const m = R.toWorld(game.mouse.x, game.mouse.y), mx = m.x - (p.fx + 0.5), my = m.y - (p.fy + 0.62);
      if (Math.hypot(mx, my) > 0.2) { dx = mx; dy = my; }
    }
    K.combat.slash(game.W, p, Math.atan2(dy, dx));
  }

  function bindInput() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target.tagName === 'INPUT') return;
      const k = ev.key.toLowerCase();
      if (!game.playing) return;
      if (k === 'escape') { toMenu(); return; }
      if (k === '+' || k === '=') R.zoomStep(1); else if (k === '-') R.zoomStep(-1);
      else if (k === ' ') ev.preventDefault();
      else if (k === 'shift') { if (!ev.repeat) playerDodge(); }
      else if (k === 'e') say(game.last);                         // say the same sentence again
      else if (/^[0-9]$/.test(k)) say(k === '0' ? 9 : Number(k) - 1)
      else if (k === 'n') { K.voice.setMuted(!K.voice.muted); try { localStorage.setItem('krowns.muted', K.voice.muted ? '1' : '0'); } catch (e) { /* fine */ } }
      else if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { ev.preventDefault(); keys.add(k); }
    });
    window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
    window.addEventListener('blur', () => keys.clear());
    window.addEventListener('resize', () => R.resize());
    $('game').addEventListener('pointerdown', (ev) => {
      if (!game.playing || ev.button !== 0) return;
      const r = ev.target.getBoundingClientRect(), d = R.view.dpr; game.mouse = { x: (ev.clientX - r.left) * d, y: (ev.clientY - r.top) * d };
      playerSlash();
    });
    $('game').addEventListener('pointermove', (ev) => { const r = ev.target.getBoundingClientRect(), d = R.view.dpr; game.mouse = { x: (ev.clientX - r.left) * d, y: (ev.clientY - r.top) * d }; });
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
    $('ver').textContent = 'v' + (document.documentElement.dataset.v || '');
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
