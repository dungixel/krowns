// Krowns - wires everything together: title screen, buttons, and the game clock.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const $ = (id) => document.getElementById(id);
  const icon = (n, s, v) => K.icons.svg(n, { size: s || 18, variant: v });

  const startEl = $('start'), gameEl = $('game');
  let view = null, world = null;
  let speed = 1, paused = false, acc = 0, last = 0, ended = false, holdAlpha = 1;
  let lastClockHtml = '', lastDark = -1;
  const TICK_MS = 1000;           // one second of world time per tick at 1x
  const POP = 20;                 // souls in a new world

  // ---------------------------------------------------------- buttons and icons
  $('logo').innerHTML = icon('crown', 44, 'filled');
  $('btn-sound').innerHTML = icon('volume', 18);
  $('btn-fit').innerHTML = icon('arrows-maximize', 18);
  $('btn-zin').innerHTML = icon('zoom-in', 18);
  $('btn-zout').innerHTML = icon('zoom-out', 18);
  $('btn-new').innerHTML = icon('refresh', 18);
  $('btn-history').innerHTML = icon('messages', 18);
  setPaused(false);

  function setPaused(p) {
    paused = p;
    $('btn-pause').innerHTML = icon(p ? 'player-play' : 'player-pause', 18);
  }
  function setSpeed(s) {
    speed = s;
    for (const [id, v] of [['btn-s1', 1], ['btn-s2', 2], ['btn-s4', 4]]) $(id).classList.toggle('on', v === s);
    if (view) view.bubbleMode = s >= 4 ? 'selected' : 'all';
  }
  setSpeed(1);

  $('btn-create').addEventListener('click', () => { K.audio.unlock(); startWorld(); });
  $('btn-new').addEventListener('click', () => {
    if (!world || ended || confirm('Create a new world? The current one will be lost.')) { K.audio.unlock(); startWorld(); }
  });
  $('btn-pause').addEventListener('click', () => setPaused(!paused));
  $('btn-s1').addEventListener('click', () => setSpeed(1));
  $('btn-s2').addEventListener('click', () => setSpeed(2));
  $('btn-s4').addEventListener('click', () => setSpeed(4));
  $('btn-fit').addEventListener('click', () => view && view.fit());
  $('btn-zin').addEventListener('click', () => view && view.zoomBy(1.45));
  $('btn-zout').addEventListener('click', () => view && view.zoomBy(1 / 1.45));
  $('btn-sound').addEventListener('click', toggleSound);
  histEl_click();
  function histEl_click() {
    $('history').addEventListener('click', (ev) => {
      const nm = ev.target.closest('.nm');
      if (nm && view) view.select({ type: 'unit', id: +nm.dataset.uid });
    });
  }
  $('btn-history').addEventListener('click', () => { $('history').hidden = !$('history').hidden; scrollHistory(); });

  function toggleSound() {
    K.audio.unlock();
    K.audio.setMuted(!K.audio.isMuted());
    $('btn-sound').innerHTML = icon(K.audio.isMuted() ? 'volume-off' : 'volume', 18);
  }

  globalThis.addEventListener('keydown', (e) => {
    if (gameEl.hidden || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
    else if (e.key === '1') setSpeed(1);
    else if (e.key === '2') setSpeed(2);
    else if (e.key === '3') setSpeed(4);
    else if (e.key === 'f' || e.key === 'F') view.fit();
    else if (e.key === '+' || e.key === '=') view.zoomBy(1.45);
    else if (e.key === '-' || e.key === '_') view.zoomBy(1 / 1.45);
    else if (e.key === 'ArrowLeft') { e.preventDefault(); view.pan(110, 0); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); view.pan(-110, 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); view.pan(0, 110); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); view.pan(0, -110); }
    else if (e.key === 'm' || e.key === 'M') toggleSound();
    else if (e.key === 'Escape') view.select(null);
  });

  // ---------------------------------------------------------- the chronicle
  const feedEl = $('feed'), histEl = $('history');
  const day = (t) => { const c = K.util.clock(t); return 'Day ' + c.day + ' ' + c.text; };
  function scrollHistory() { histEl.scrollTop = histEl.scrollHeight; }
  function pushLog(text) {
    const html = view.markup(text);
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.innerHTML = html;
    feedEl.appendChild(line);
    while (feedEl.children.length > 4) feedEl.firstChild.remove();
    setTimeout(() => { line.classList.add('out'); setTimeout(() => line.remove(), 600); }, 14000);
    const h = document.createElement('div');
    h.className = 'hist-line';
    h.innerHTML = `<span class="when">${day(world.time)}</span> ${html}`;
    histEl.appendChild(h);
    while (histEl.children.length > 120) histEl.firstChild.remove();
    if (!histEl.hidden) scrollHistory();
  }

  // ---------------------------------------------------------- starting a world
  function startWorld() {
    startEl.hidden = true; gameEl.hidden = false;
    if (!view) {
      view = K.createView({ canvas: $('canvas'), bubbleLayer: $('bubbles'), panel: $('panel') });
      requestAnimationFrame(frame);
    }
    world = K.sim.createWorld({ units: POP });
    ended = false; acc = 0; last = performance.now();
    feedEl.innerHTML = ''; histEl.innerHTML = '';
    view.setWorld(world);
    view.resize();
    view.bubbleMode = speed >= 4 ? 'selected' : 'all';
    setPaused(false);
    $('hud-world').textContent = 'World of ' + world.name;
    const hint = $('hint'); hint.classList.remove('gone'); void hint.offsetWidth;
    setTimeout(() => hint.classList.add('gone'), 12000);
    updateHud();
    globalThis.krowns = { world, view, K };   // handy for experiments in the browser console
  }

  function updateHud() {
    const c = K.util.clock(world.time), h = c.hour;
    const ico = h >= 5.5 && h < 7.5 ? 'sunrise' : h >= 7.5 && h < 18 ? 'sun' : h >= 18 && h < 20.5 ? 'sunset' : 'moon-stars';
    const html = `${icon(ico, 14)}<span>Day ${c.day} · ${c.text}</span>`;
    if (html !== lastClockHtml) { lastClockHtml = html; $('hud-time').innerHTML = html; }
    const n = world.alive.length, kn = world.kingdoms.size;
    $('hud-count').textContent = `${n} soul${n === 1 ? '' : 's'} · ${kn} kingdom${kn === 1 ? '' : 's'}`;
  }

  // ---------------------------------------------------------- the clock
  function doTick() {
    K.sim.tick(world);
    const events = world.events;
    world.events = [];
    const rest = [];
    for (const e of events) { if (e.type === 'log') pushLog(e.text); else rest.push(e); }
    view.handleEvents(rest);
    updateHud();
    view.updatePanel();
    if (!ended && world.alive.length === 0) {
      ended = true;
      const line = document.createElement('div');
      line.className = 'feed-line'; line.textContent = 'The world has fallen silent. Create a new world to begin again.';
      feedEl.appendChild(line);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!world) return;
    const dt = Math.min(250, now - (last || now));
    last = now;
    if (!paused && !ended) {
      acc += dt * speed;
      let n = 0;
      while (acc >= TICK_MS && n < 6) { doTick(); acc -= TICK_MS; n++; }
      if (n === 6) acc = 0;
    }
    if (!paused && !ended) holdAlpha = Math.min(1, acc / TICK_MS);
    view.draw(now, holdAlpha);
    // keep the on-screen text readable when the world turns dark
    const dk = view.light.dark > 0.55 ? 2 : view.light.dark > 0.1 ? 1 : 0;   // day, twilight, night
    if (dk !== lastDark) {
      lastDark = dk;
      gameEl.style.setProperty('--hud-ink', dk === 2 ? 'rgb(236,240,252)' : dk === 1 ? 'rgb(30,30,30)' : '');
      gameEl.style.setProperty('--hud-soft', dk === 2 ? 'rgb(176,186,212)' : dk === 1 ? 'rgb(62,58,64)' : '');
    }
  }
})();
