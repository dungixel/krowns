// Krowns - drawing the world and the little windows on top of it.
// The canvas draws the world; speech bubbles and the unit panel are normal web elements on top.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const { clamp } = K.util;
  const ROLES = K.words.ROLES;

  const TS = 24;                    // tile size in "world pixels"
  const FREE_COLOR = '#d9d9d9';
  const FREE_LINE = '#c4c4c4';
  const MS_PER_CHAR = 34;           // speed of the typing effect

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const ease = (t) => t * t * (3 - 2 * t);
  const ic = (name, size, cls, variant) => K.icons.svg(name, { size, cls, variant });

  function createView(els) {
    const canvas = els.canvas, ctx = canvas.getContext('2d');
    const bubbleLayer = els.bubbleLayer, panelEl = els.panel;
    const V = {
      world: null, cam: { x: 0, y: 0, s: 1 }, fitScale: 1, dpr: 1, W: 0, H: 0,
      sel: null, hover: null, bubbles: new Map(), fx: [], marks: [], bubbleMode: 'all',
      panel: { x: 0, y: 0, shown: false, parts: { head: '', desc: '', life: '' } },
      lastDraw: 0, onSelect: null, drag: null, paused: false,
      zoom: { target: 1, ax: 0, ay: 0 }, hoverTile: null, userMoved: false,
    };
    // -------------------------------------------------- panel skeleton
    panelEl.innerHTML = '<div class="p-head"></div><div class="p-body"><div class="p-desc"></div><div class="p-life"></div></div>';
    const pHead = panelEl.querySelector('.p-head'), pBody = panelEl.querySelector('.p-body');
    const pDesc = panelEl.querySelector('.p-desc'), pLife = panelEl.querySelector('.p-life');

    // -------------------------------------------------- text markup -> html
    function unitName(id) {
      const w = V.world, u = w && w.units.get(+id);
      if (!u) return '?';
      const k = u.kingdom != null ? w.kingdoms.get(u.kingdom) : null;
      const col = k ? k.color.dark : '#666';
      return `<a class="nm${u.alive ? '' : ' dead'}" data-uid="${u.id}" style="color:${col}">${esc(u.name)}${u.alive ? '' : ' †'}</a>`;
    }
    function kingdomName(id) {
      const w = V.world;
      const k = w && (w.kingdoms.get(+id) || (w.fallen && w.fallen.get(+id)));
      if (!k) return '?';
      return `<span class="kn" style="color:${k.color.dark}">${esc(k.name)}</span>`;
    }
    function markup(text) {
      return esc(text)
        .replace(/\[\[(\w+)\|([^|\]]*)\|([^\]]*)\]\]/g, (m, cat, word, tip) => `<span class="w w-${cat}"${tip ? ` data-tip="${tip}"` : ''}>${word}</span>`)
        .replace(/\{u:(\d+)\}/g, (m, id) => unitName(id))
        .replace(/\{k:(\d+)\}/g, (m, id) => kingdomName(id));
    }
    V.markup = markup;

    // -------------------------------------------------- coordinates
    function resize() {
      V.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      V.W = globalThis.innerWidth; V.H = globalThis.innerHeight;
      canvas.width = Math.floor(V.W * V.dpr); canvas.height = Math.floor(V.H * V.dpr);
      canvas.style.width = V.W + 'px'; canvas.style.height = V.H + 'px';
      if (V.world) { computeFit(); if (V.userMoved) clampCam(); else fit(); }
    }
    function computeFit() {
      const w = V.world;
      V.fitScale = Math.min((V.W - 40) / (w.w * TS), (V.H - 120) / (w.h * TS));
    }
    function fit() {
      const w = V.world; if (!w) return;
      computeFit();
      V.cam.s = V.fitScale; V.zoom.target = V.fitScale;
      V.cam.x = (V.W - w.w * TS * V.cam.s) / 2;
      V.cam.y = (V.H - w.h * TS * V.cam.s) / 2 + 24;
      V.userMoved = false;
    }
    // ---- camera: zoom glides toward the pointer, like a tactics-game map
    const maxScale = () => 96 / TS;            // about 96 pixels per tile when fully zoomed in
    const minScale = () => V.fitScale * 0.6;
    function clampCam() {
      const w = V.world; if (!w) return;
      const s = TS * V.cam.s, ww = w.w * s, wh = w.h * s, m = 140;
      V.cam.x = clamp(V.cam.x, m - ww, V.W - m);
      V.cam.y = clamp(V.cam.y, m - wh, V.H - m);
    }
    function zoomTo(scale, ax, ay) {
      V.zoom.target = clamp(scale, minScale(), maxScale());
      V.zoom.ax = ax; V.zoom.ay = ay; V.userMoved = true;
    }
    function zoomBy(f) {
      let ax = V.W / 2, ay = V.H / 2;
      if (V.sel && V.sel.type === 'unit' && V.world) {
        const u = V.world.units.get(V.sel.id);
        if (u && u._sx != null) { ax = u._sx; ay = u._sy; }
      }
      zoomTo(V.zoom.target * f, ax, ay);
    }
    function applyScale(ns) {
      const c = V.cam, z = V.zoom, k = ns / c.s;
      c.x = z.ax - (z.ax - c.x) * k; c.y = z.ay - (z.ay - c.y) * k; c.s = ns;
      clampCam();
    }
    function stepZoom(dt) {
      const z = V.zoom, c = V.cam;
      if (Math.abs(z.target - c.s) < 1e-4) { if (c.s !== z.target) applyScale(z.target); return; }
      applyScale(c.s + (z.target - c.s) * (1 - Math.exp(-dt * 0.016)));
    }
    function pan(dx, dy) { V.cam.x += dx; V.cam.y += dy; V.userMoved = true; clampCam(); }
    const sx = (tx) => V.cam.x + (tx + 0.5) * TS * V.cam.s;
    const sy = (ty) => V.cam.y + (ty + 0.5) * TS * V.cam.s;

    function setWorld(w) {
      V.world = w; V.sel = null; V.hover = null; V.fx = []; V.marks = [];
      for (const b of V.bubbles.values()) b.el.remove();
      V.bubbles.clear();
      panelEl.classList.remove('show'); V.panel.shown = false;
      computeFit(); fit();
    }

    // -------------------------------------------------- selection
    function select(sel) {
      V.sel = sel;
      V.panel.parts = { head: '', desc: '', life: '' };
      if (!sel) { panelEl.classList.remove('show'); V.panel.shown = false; }
      else { V.panel.shown = false; panelEl.classList.add('show'); updatePanel(true); }
      if (V.onSelect) V.onSelect(sel);
    }

    function heartsHTML(u) {
      let h = '';
      for (let i = 0; i < u.maxHearts; i++) {
        const fill = clamp(u.hearts - i, 0, 1);
        h += `<span class="heart">${ic('heart', 15, 'h-empty')}<span class="h-fill" style="width:${Math.round(fill * 100)}%">${ic('heart', 15, 'h-full', 'filled')}</span></span>`;
      }
      return h;
    }
    const dayOf = (t) => { const c = K.util.clock(t); return 'Day ' + c.day + ' ' + c.text; };

    function updatePanel(force) {
      const w = V.world, sel = V.sel;
      if (!w || !sel) return;
      let head = '', desc = '', life = '';
      if (sel.type === 'unit') {
        const u = w.units.get(sel.id);
        if (!u) return;
        const k = u.kingdom != null ? w.kingdoms.get(u.kingdom) : null;
        const col = k ? k.color.dark : '#888';
        const r = ROLES[u.role];
        let tags = '';
        if (k) tags += `<span class="tag" style="color:${col}">${k.ruler === u.id ? ic('crown', 13) : ''}${esc(k.name)}</span>`;
        if (r) tags += `<span class="tag w-${r.cat}">${ic(roleIcon(u.role), 13)}${r.label}</span>`;
        if (u.alive && u.sleep) tags += `<span class="tag w-rest">${ic('zzz', 13)}asleep</span>`;
        else if (u.alive && k && k.watch && k.watch.has(u.id)) tags += `<span class="tag w-status">${ic('eye', 13)}on watch</span>`;
        head = `<div class="p-title"><span class="p-dot" style="background:${k ? k.color.fill : FREE_COLOR};border-color:${k ? k.color.line : FREE_LINE}"></span>` +
          `<span class="p-name">${esc(u.name)}</span><button class="p-x" title="Close">${ic('x', 16)}</button></div>` +
          (tags ? `<div class="p-tags">${tags}</div>` : '') +
          `<div class="p-hearts">${heartsHTML(u)}</div>`;
        if (!u.alive) {
          const why = u.cause === 'hunger' ? 'Starved' : u.cause === 'poison' ? 'Died of poison' : u.cause === 'burn' ? 'Burned' : 'Fell in battle';
          desc = `<p class="p-rip">${ic('ghost', 14)} ${why}, ${dayOf(u.diedAt)}.</p>`;
        } else desc = K.sim.describe(w, u).map((p) => `<p>${markup(p)}</p>`).join('');
        const recent = u.log.slice(-7).reverse();
        life = recent.length ? `<div class="p-lh">Life</div><ul>${recent.map((e) => `<li><span class="when">${dayOf(e.t)}</span> ${markup(e.text)}</li>`).join('')}</ul>` : '';
      } else {
        const k = w.kingdoms.get(sel.id);
        if (!k) { select(null); return; }
        const n = k.members.size, food = K.sim.foodPoints(k) / Math.max(1, n);
        const fw = food < 0.5 ? '<span class="w w-hunger" data-tip="People may starve">empty</span>' : food < 2 ? 'meager' : food < 7 ? 'well stocked' : 'overflowing';
        const wars = [...k.wars].map((id) => `{k:${id}}`).join(', ');
        head = `<div class="p-title"><span class="p-dot" style="background:${k.color.fill};border-color:${k.color.line}"></span><span class="p-name">Kingdom of ${esc(k.name)}</span><button class="p-x" title="Close">${ic('x', 16)}</button></div>`;
        desc = `<p>Ruled by ${markup('{u:' + k.ruler + '}')}.</p><p>${n} souls live here. The granary is ${fw}.</p>` +
          (wars ? `<p><span class="w w-strength" data-tip="Swordsmen march against each other">At war</span> with ${markup(wars)}.</p>` : '<p>At peace.</p>');
        const mine = (w.chronicle || []).filter((c) => c.text.includes(`{k:${k.id}}`)).slice(-6).reverse();
        life = mine.length ? `<div class="p-lh">History</div><ul>${mine.map((e) => `<li><span class="when">${dayOf(e.t)}</span> ${markup(e.text)}</li>`).join('')}</ul>` : '';
      }
      const P = V.panel.parts;
      if (force || head !== P.head) { pHead.innerHTML = head; P.head = head; }
      if (force || desc !== P.desc) { const st = pBody.scrollTop; pDesc.innerHTML = desc; P.desc = desc; pBody.scrollTop = st; }
      if (force || life !== P.life) { const st = pBody.scrollTop; pLife.innerHTML = life; P.life = life; pBody.scrollTop = st; }
    }
    V.updatePanel = () => updatePanel(false);

    function roleIcon(r) {
      return { farmer: 'wheat', cook: 'chef-hat', hunter: 'bow', swordsman: 'sword', mage: 'wand', poet: 'feather' }[r] || 'leaf';
    }

    // The panel glides after the unit it describes, slowly enough to read.
    function placePanel(dt) {
      if (!V.sel || !V.world) return;
      let ax, ay, rad;
      const s = TS * V.cam.s;
      if (V.sel.type === 'unit') {
        const u = V.world.units.get(V.sel.id); if (!u) return;
        ax = u._sx != null ? u._sx : sx(u.x); ay = u._sy != null ? u._sy : sy(u.y); rad = s * 0.45;
      } else {
        const k = V.world.kingdoms.get(V.sel.id); if (!k) return;
        ax = sx(k.cx); ay = sy(k.cy); rad = s * 1.0;
      }
      const pw = panelEl.offsetWidth, ph = panelEl.offsetHeight;
      let tx = ax + rad + 26;
      if (tx + pw > V.W - 12) tx = ax - rad - 26 - pw;
      tx = clamp(tx, 12, Math.max(12, V.W - pw - 12));
      const ty = clamp(ay - ph * 0.35, 64, Math.max(64, V.H - ph - 12));
      const P = V.panel;
      if (!P.shown) { P.x = tx; P.y = ty; P.shown = true; }
      else if (panelEl.matches(':hover')) { /* hold still while being read, so hover tips stay put */ }
      else { const k = 1 - Math.exp(-dt * 0.0028); P.x += (tx - P.x) * k; P.y += (ty - P.y) * k; }
      panelEl.style.transform = `translate3d(${P.x.toFixed(1)}px,${P.y.toFixed(1)}px,0)`;
    }

    // -------------------------------------------------- events from the simulation
    function onScreenVol(x, y) {
      const px = sx(x), py = sy(y);
      if (px < -20 || py < -20 || px > V.W + 20 || py > V.H + 20) return 0;
      let rx = V.W / 2, ry = V.H / 2;
      if (V.sel && V.sel.type === 'unit') { const u = V.world.units.get(V.sel.id); if (u && u._sx != null) { rx = u._sx; ry = u._sy; } }
      const d = Math.hypot(px - rx, py - ry) / (Math.hypot(V.W, V.H) * 0.6);
      return clamp(1 - d, 0.12, 1);
    }

    function addFx(type, x, y, color, dur, maxR) {
      V.fx.push({ type, x, y, color, t0: performance.now(), dur, maxR });
      if (V.fx.length > 80) V.fx.shift();
    }

    function addBubble(id, text) {
      const w = V.world, u = w.units.get(id);
      if (!u || !u.alive) return;
      if (V.bubbleMode === 'selected' && !(V.sel && V.sel.type === 'unit' && V.sel.id === id)) return;
      const px = sx(u.x), py = sy(u.y);
      if (px < -40 || py < -40 || px > V.W + 40 || py > V.H + 40) return;
      const old = V.bubbles.get(id); if (old) old.el.remove();
      const k = u.kingdom != null ? w.kingdoms.get(u.kingdom) : null;
      const el = document.createElement('div');
      el.className = 'bubble';
      el.style.borderColor = k ? k.color.line : '#cfcfcf';
      // Every character exists from the start (hidden), so the text never re-wraps while typing.
      const chars = [];
      for (const ch of text) {
        const sp = document.createElement('span');
        sp.className = 'ch';
        sp.textContent = ch;
        el.appendChild(sp);
        chars.push(sp);
      }
      bubbleLayer.appendChild(el);
      V.bubbles.set(id, { id, el, chars, text, t0: performance.now(), shown: 0, doneAt: 0, voice: K.audio.voiceFor(u), out: false });
    }

    function handleEvents(list) {
      for (const e of list) {
        switch (e.type) {
          case 'say': addBubble(e.id, e.text); break;
          case 'hit': { const v = onScreenVol(e.x, e.y); if (v > 0) { addFx('ring', e.x, e.y, '#f06a6a', 380, 0.7); K.audio.sfx('hit', v); } break; }
          case 'spell': {
            const col = e.spell === 'heal' ? '#4fbf6a' : e.spell === 'poison' ? '#8b5fd6' : e.spell === 'burn' ? '#f59f00' : '#e8c500';
            addFx('ring', e.x, e.y, col, 700, 1.1);
            K.audio.sfx(e.spell === 'heal' ? 'heal' : 'curse', onScreenVol(e.x, e.y));
            break;
          }
          case 'death': {
            V.marks.push({ x: e.x, y: e.y, t0: performance.now() });
            if (V.marks.length > 60) V.marks.shift();
            K.audio.sfx('death', onScreenVol(e.x, e.y));
            const b = V.bubbles.get(e.id); if (b) { b.el.remove(); V.bubbles.delete(e.id); }
            break;
          }
          case 'birth': addFx('ring', e.x, e.y, '#f2b8d4', 900, 1.6); K.audio.sfx('birth', onScreenVol(e.x, e.y)); break;
          case 'love': { const a = V.world.units.get(e.a); if (a) addFx('ring', a.x, a.y, '#f4a6c8', 900, 1.5); K.audio.sfx('love', onScreenVol(a ? a.x : 0, a ? a.y : 0)); break; }
          case 'found': {
            const k = V.world.kingdoms.get(e.k);
            addFx('ring', e.x, e.y, k ? k.color.line : '#999', 1400, 6);
            K.audio.sfx('found', 1);
            break;
          }
          case 'war': K.audio.sfx('war', 1); break;
          case 'alarm': addFx('ring', e.x, e.y, '#e5484d', 1300, 5); K.audio.sfx('war', onScreenVol(e.x, e.y) || 0.4); break;
          case 'raid': K.audio.sfx('war', 0.6); break;
          case 'peace': K.audio.sfx('peace', 1); break;
          default: break;
        }
      }
    }

    // -------------------------------------------------- bubbles each frame
    function updateBubbles(now) {
      const w = V.world;
      for (const [id, b] of V.bubbles) {
        const u = w.units.get(id);
        if (!u || !u.alive) { b.el.remove(); V.bubbles.delete(id); continue; }
        const x = u._sx != null ? u._sx : sx(u.x), y = u._sy != null ? u._sy : sy(u.y);
        const rad = TS * V.cam.s * 0.4;
        b.el.style.transform = `translate3d(${x.toFixed(1)}px,${(y - rad - 12).toFixed(1)}px,0) translate(-50%,-100%)`;
        const target = Math.min(b.chars.length, Math.floor((now - b.t0) / MS_PER_CHAR) + 1);
        while (b.shown < target) {
          const c = b.chars[b.shown];
          c.classList.add('on');
          const isSel = V.sel && V.sel.type === 'unit' && V.sel.id === id;
          if (b.text[b.shown] !== ' ' && b.shown % 2 === 0) {
            const v = isSel ? 1 : onScreenVol(u.x, u.y) * 0.65;
            K.audio.blip(b.voice, v);
          }
          b.shown++;
        }
        if (b.shown >= b.chars.length && !b.doneAt) b.doneAt = now;
        const linger = V.bubbleMode === 'selected' ? 3200 : 2400 + b.chars.length * 16;
        if (b.doneAt && now - b.doneAt > linger && !b.out) { b.out = true; b.el.classList.add('out'); }
        if (b.out && now - b.doneAt > linger + 350) { b.el.remove(); V.bubbles.delete(id); }
      }
    }

    // -------------------------------------------------- drawing
    function blob(x, y, R, t, ph, amp) {
      const n = 20, pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = R * (1 + amp * (0.6 * Math.sin(3 * a + t * 2.2 + ph) + 0.4 * Math.sin(5 * a - t * 1.8 + ph * 1.7)));
        pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
      }
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        if (i === 0) { const l = pts[n - 1]; ctx.moveTo((l[0] + p[0]) / 2, (l[1] + p[1]) / 2); }
        ctx.quadraticCurveTo(p[0], p[1], mx, my);
      }
      ctx.closePath();
    }

    function drawIcon(name, x, y, size, color, variant) {
      const img = K.icons.image(name, color, variant);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    }

    function draw(now, alpha) {
      const w = V.world; if (!w) return;
      const dt = V.lastDraw ? Math.min(100, now - V.lastDraw) : 16;
      V.lastDraw = now;
      const t = now / 1000;
      stepZoom(dt);
      const s = TS * V.cam.s;
      const a01 = clamp(alpha, 0, 1);
      const e = 0.55 * a01 + 0.45 * ease(a01);   // glide between tiles, with a soft start and stop
      ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      // the colour of the sky: white by day, orange at dawn and dusk, dark desaturated blue at night
      const L = K.util.lightAt(K.util.hourOf(w.time - 1 + a01));
      V.light = L;
      const d = L.dark;
      const mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * d)).join(',');
      const gridC = mix([60, 60, 90], [175, 190, 235]);
      const inkC = `rgb(${mix([43, 43, 43], [232, 236, 250])})`;
      const night = d > 0.5;
      ctx.fillStyle = `rgb(${L.rgb.join(',')})`; ctx.fillRect(0, 0, V.W, V.H);

      // soft grid, one square per step a unit can take (fades out when zoomed far away)
      if (s >= 6) {
        const fade = clamp((s - 6) / 14, 0, 1);
        const i0 = clamp(Math.floor(-V.cam.x / s), 0, w.w), i1 = clamp(Math.ceil((V.W - V.cam.x) / s), 0, w.w);
        const j0 = clamp(Math.floor(-V.cam.y / s), 0, w.h), j1 = clamp(Math.ceil((V.H - V.cam.y) / s), 0, w.h);
        const top = Math.max(V.cam.y, 0), bot = Math.min(V.cam.y + w.h * s, V.H);
        const left = Math.max(V.cam.x, 0), right = Math.min(V.cam.x + w.w * s, V.W);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = i0; i <= i1; i++) { if (i % 8 === 0) continue; const x = Math.round(V.cam.x + i * s) + 0.5; ctx.moveTo(x, top); ctx.lineTo(x, bot); }
        for (let j = j0; j <= j1; j++) { if (j % 8 === 0) continue; const y = Math.round(V.cam.y + j * s) + 0.5; ctx.moveTo(left, y); ctx.lineTo(right, y); }
        ctx.strokeStyle = `rgba(${gridC},${(0.055 + 0.02 * d) * fade})`; ctx.stroke();
        // every 8th line a touch stronger, to help the eye on a big map
        ctx.beginPath();
        for (let i = i0; i <= i1; i++) { if (i % 8) continue; const x = Math.round(V.cam.x + i * s) + 0.5; ctx.moveTo(x, top); ctx.lineTo(x, bot); }
        for (let j = j0; j <= j1; j++) { if (j % 8) continue; const y = Math.round(V.cam.y + j * s) + 0.5; ctx.moveTo(left, y); ctx.lineTo(right, y); }
        ctx.strokeStyle = `rgba(${gridC},${(0.1 + 0.04 * d) * fade})`; ctx.stroke();
      }
      // world edge
      ctx.strokeStyle = `rgb(${mix([230, 230, 232], [85, 96, 128])})`; ctx.lineWidth = 1;
      ctx.strokeRect(V.cam.x, V.cam.y, w.w * s, w.h * s);

      // the tile under the pointer, and the tile of the selected unit
      const tileBox = (tx, ty, fill, stroke) => {
        const x = V.cam.x + tx * s, y = V.cam.y + ty * s, r = Math.min(5, s * 0.18);
        ctx.beginPath(); ctx.roundRect(x + 1, y + 1, s - 2, s - 2, r);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
      };
      if (V.hoverTile && s >= 6) tileBox(V.hoverTile.x, V.hoverTile.y, `rgba(${gridC},0.06)`, `rgba(${gridC},0.2)`);
      if (V.sel && V.sel.type === 'unit') {
        const su = w.units.get(V.sel.id);
        if (su && su.alive) {
          const sk = su.kingdom != null ? w.kingdoms.get(su.kingdom) : null;
          tileBox(su.x, su.y, sk ? `hsla(${sk.color.hue},65%,72%,0.28)` : 'rgba(120,120,120,0.14)', sk ? `hsla(${sk.color.hue},50%,50%,0.55)` : 'rgba(90,90,90,0.4)');
        }
      }

      // territories: whole grid squares around each castle, with a soft edge
      for (const k of w.kingdoms.values()) {
        const rad = 6 + k.members.size * 0.55, R = Math.ceil(rad), r2 = rad * rad;
        const inside = (dx, dy) => dx * dx + dy * dy <= r2;
        const hue = k.color.hue;
        ctx.fillStyle = `hsla(${hue},70%,${80 - 14 * d}%,${0.17 + 0.07 * d})`;
        ctx.beginPath();
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (!inside(dx, dy)) continue;
          const tx = k.cx + dx, ty = k.cy + dy;
          if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) continue;
          const x = V.cam.x + tx * s, y = V.cam.y + ty * s;
          if (x > V.W || y > V.H || x + s < 0 || y + s < 0) continue;
          ctx.rect(x, y, s, s);
        }
        ctx.fill();
        ctx.beginPath();
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (!inside(dx, dy)) continue;
          const tx = k.cx + dx, ty = k.cy + dy;
          if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) continue;
          const x = V.cam.x + tx * s, y = V.cam.y + ty * s;
          if (x > V.W || y > V.H || x + s < 0 || y + s < 0) continue;
          if (!inside(dx - 1, dy)) { ctx.moveTo(x, y); ctx.lineTo(x, y + s); }
          if (!inside(dx + 1, dy)) { ctx.moveTo(x + s, y); ctx.lineTo(x + s, y + s); }
          if (!inside(dx, dy - 1)) { ctx.moveTo(x, y); ctx.lineTo(x + s, y); }
          if (!inside(dx, dy + 1)) { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y + s); }
        }
        ctx.strokeStyle = `hsla(${hue},55%,62%,0.55)`; ctx.lineWidth = 1.4; ctx.stroke();
      }
      // farms
      for (const k of w.kingdoms.values()) {
        for (const p of k.farms) {
          const x = sx(p.x) - s * 0.5, y = sy(p.y) - s * 0.5;
          ctx.fillStyle = `hsla(${k.color.hue},45%,${90 - 40 * d}%,1)`; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
          ctx.strokeStyle = k.color.line; ctx.lineWidth = 1; ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
          if (p.state === 'growing') {
            const g = clamp(p.growth, 0, 1), r = (s * 0.14) + s * 0.22 * g;
            ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, r, 0, Math.PI * 2); ctx.fillStyle = '#b7dca0'; ctx.fill();
          } else if (p.state === 'ready') {
            ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.3, 0, Math.PI * 2); ctx.fillStyle = '#f0d36a'; ctx.fill();
          }
        }
      }
      // torchlight around each capital when it gets dark
      if (d > 0.12) {
        for (const k of w.kingdoms.values()) {
          const x = sx(k.cx), y = sy(k.cy), gr = s * (3.2 + (k.watch && k.watch.size ? 1.2 : 0));
          const g = ctx.createRadialGradient(x, y, s * 0.3, x, y, gr);
          g.addColorStop(0, `rgba(255,196,110,${0.5 * d})`); g.addColorStop(1, 'rgba(255,196,110,0)');
          ctx.fillStyle = g; ctx.fillRect(x - gr, y - gr, gr * 2, gr * 2);
        }
      }
      // capitals: one square each
      for (const k of w.kingdoms.values()) {
        const x = sx(k.cx), y = sy(k.cy);
        const nameCol = night ? `hsl(${k.color.hue},65%,80%)` : k.color.dark;
        ctx.beginPath(); ctx.roundRect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2, Math.min(6, s * 0.2));
        ctx.fillStyle = `hsla(${k.color.hue},60%,${84 - 36 * d}%,0.92)`; ctx.fill();
        ctx.strokeStyle = k.color.line; ctx.lineWidth = 1.5; ctx.stroke();
        drawIcon('building-castle', x, y, s * 0.82, nameCol);
        K.icons.image('building-castle', k.color.dark); K.icons.image('building-castle', `hsl(${k.color.hue},65%,80%)`);   // keep both ready
        ctx.fillStyle = nameCol; ctx.font = `600 ${Math.max(9, Math.min(13, s * 0.5))}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(k.name, x, y + s * 0.5 + 3);
        if (k.wars.size) drawIcon('swords', x + s * 0.62, y - s * 0.62, Math.max(10, s * 0.6), '#d9534f');
      }
      // gravestones
      V.marks = V.marks.filter((m) => now - m.t0 < 9000);
      for (const m of V.marks) {
        const a = 1 - (now - m.t0) / 9000;
        ctx.globalAlpha = 0.65 * a;
        drawIcon('x', sx(m.x), sy(m.y), s * 0.7, '#8a8a8a');
        ctx.globalAlpha = 1;
      }
      // animals
      for (const a of w.animals) {
        if (!a.alive) continue;
        const x = sx(a.px + (a.x - a.px) * e), y = sy(a.py + (a.y - a.py) * e);
        const r = s * (a.size === 1 ? 0.2 : a.size === 2 ? 0.3 : 0.45);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${mix([140, 106, 74], [200, 164, 122])})`; ctx.fill();
      }
      // units
      const hov = V.hover, sel = V.sel && V.sel.type === 'unit' ? V.sel.id : null;
      const list = w.alive.slice().sort((a, b) => a.y - b.y);
      const R = Math.max(3, s * 0.4);
      for (const u of list) {
        const vx = u.px + (u.x - u.px) * e, vy = u.py + (u.y - u.py) * e;
        const x = sx(vx), y = sy(vy);
        u._sx = x; u._sy = y;
        const k = u.kingdom != null ? w.kingdoms.get(u.kingdom) : null;
        const moving = u.px !== u.x || u.py !== u.y;
        const asleep = !!u.sleep;
        const sentry = !!(k && k.watch && k.watch.has(u.id));
        if (sentry && s >= 8) {   // a sentry's lantern
          const lr = s * 1.5, g = ctx.createRadialGradient(x, y, R * 0.4, x, y, lr);
          g.addColorStop(0, `rgba(255,205,120,${0.45 * d})`); g.addColorStop(1, 'rgba(255,205,120,0)');
          ctx.fillStyle = g; ctx.fillRect(x - lr, y - lr, lr * 2, lr * 2);
        }
        ctx.globalAlpha = asleep ? 0.62 : 1;
        blob(x, y, R * (asleep ? 0.94 : 1), t, u.id * 1.7, asleep ? 0.035 : moving ? 0.13 : 0.08);
        ctx.fillStyle = k ? k.color.fill : FREE_COLOR; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = k ? k.color.line : FREE_LINE; ctx.stroke();
        ctx.globalAlpha = 1;
        if (u.id === sel) {
          ctx.beginPath(); ctx.arc(x, y, R + 4, 0, Math.PI * 2);
          ctx.strokeStyle = inkC; ctx.lineWidth = 1.5; ctx.stroke();
        }
        // wounded: a thin heart line under the unit
        if (u.hearts < u.maxHearts && s >= 11) {
          const bw = R * 1.9;
          ctx.fillStyle = `rgb(${mix([236, 236, 236], [92, 100, 128])})`; ctx.fillRect(x - bw / 2, y + R + 3, bw, 2.5);
          ctx.fillStyle = '#e5484d'; ctx.fillRect(x - bw / 2, y + R + 3, bw * clamp(u.hearts / u.maxHearts, 0, 1), 2.5);
        }
        // little signs above the head
        if (s >= 11) {
          const icons = [];
          if (k && k.ruler === u.id) icons.push(['crown', k.color.dark, 'filled']);
          if (asleep) icons.push(['zzz', night ? '#c6d0ff' : '#7a86b8']);
          else if (sentry) icons.push(['eye', night ? '#ffd27a' : '#c48a00']);
          if (u.fight) icons.push(['swords', '#d9534f']);
          if (u.status.burn > 0) icons.push(['flame', '#f08c00']);
          if (u.status.poison > 0) icons.push(['droplet', '#2f9e44']);
          if (u.status.confused > 0) icons.push(['spiral', '#d9822b']);
          const isz = Math.max(9, Math.min(17, s * 0.62));
          icons.forEach((ico, i) => drawIcon(ico[0], x + (i - (icons.length - 1) / 2) * isz * 1.05, y - R - isz * 0.62, isz, ico[1], ico[2]));
        }
        if (u.id === sel || u.id === hov) {
          ctx.fillStyle = `rgb(${mix([85, 85, 85], [214, 220, 240])})`; ctx.font = `500 ${Math.max(10, Math.min(12, s * 0.5))}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(u.name, x, y + R + (u.hearts < u.maxHearts ? 9 : 5));
        }
      }
      // effects
      V.fx = V.fx.filter((f) => now - f.t0 < f.dur);
      for (const f of V.fx) {
        const p = (now - f.t0) / f.dur;
        ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), s * (0.25 + f.maxR * p), 0, Math.PI * 2);
        ctx.globalAlpha = (1 - p) * 0.8; ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
      }

      updateBubbles(now);
      placePanel(dt);
    }

    // -------------------------------------------------- picking and camera
    function pick(px, py) {
      const w = V.world; if (!w) return null;
      const s = TS * V.cam.s;
      let best = null, bd = Math.max(14, s * 0.55);
      for (const u of w.alive) {
        if (u._sx == null) continue;
        const d = Math.hypot(u._sx - px, u._sy - py);
        if (d < bd) { bd = d; best = { type: 'unit', id: u.id }; }
      }
      if (best) return best;
      for (const k of w.kingdoms.values()) {
        if (Math.abs(sx(k.cx) - px) < s * 0.6 && Math.abs(sy(k.cy) - py) < s * 0.6) return { type: 'kingdom', id: k.id };
      }
      return null;
    }

    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const dy = clamp(ev.deltaY * (ev.deltaMode === 1 ? 16 : 1), -160, 160);
      zoomTo(V.zoom.target * Math.exp(-dy * (ev.ctrlKey ? 0.012 : 0.0016)), ev.clientX, ev.clientY);
    }, { passive: false });

    const pointers = new Map();
    let pinch = null;
    const tileAt = (px, py) => {
      const s = TS * V.cam.s, tx = Math.floor((px - V.cam.x) / s), ty = Math.floor((py - V.cam.y) / s);
      return V.world && tx >= 0 && ty >= 0 && tx < V.world.w && ty < V.world.h ? { x: tx, y: ty } : null;
    };
    canvas.addEventListener('pointerdown', (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: V.zoom.target };
        if (V.drag) V.drag.moved = true;
      } else if (pointers.size === 1) {
        V.drag = { x: ev.clientX, y: ev.clientY, cx: V.cam.x, cy: V.cam.y, moved: false };
      }
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        zoomTo(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        if (V.drag) V.drag.moved = true;
        return;
      }
      if (V.drag) {
        const dx = ev.clientX - V.drag.x, dy = ev.clientY - V.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) V.drag.moved = true;
        if (V.drag.moved) { V.cam.x = V.drag.cx + dx; V.cam.y = V.drag.cy + dy; V.userMoved = true; clampCam(); }
      } else {
        const h = pick(ev.clientX, ev.clientY);
        V.hover = h && h.type === 'unit' ? h.id : null;
        V.hoverTile = tileAt(ev.clientX, ev.clientY);
        canvas.style.cursor = h ? 'pointer' : 'default';
      }
    });
    const release = (ev) => {
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size > 0) return;
      const d = V.drag; V.drag = null;
      if (d && !d.moved && ev.type === 'pointerup') {
        K.audio.sfx('click', 1);
        select(pick(ev.clientX, ev.clientY));
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => { if (!V.drag) { V.hover = null; V.hoverTile = null; } });
    panelEl.addEventListener('click', (ev) => {
      const t = ev.target.closest('.p-x');
      if (t) { select(null); return; }
      const nm = ev.target.closest('.nm');
      if (nm) select({ type: 'unit', id: +nm.dataset.uid });
    });
    panelEl.addEventListener('wheel', (ev) => ev.stopPropagation(), { passive: true });
    globalThis.addEventListener('resize', resize);

    V.light = K.util.lightAt(8);
    V.zoomBy = zoomBy; V.pan = pan;
    V.resize = resize; V.fit = fit; V.setWorld = setWorld; V.draw = draw; V.handleEvents = handleEvents;
    V.select = select; V.TS = TS;
    resize();
    return V;
  }

  K.createView = createView;
})();
