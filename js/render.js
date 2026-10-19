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
      if (V.world) { const old = V.fitScale; computeFit(); if (Math.abs(V.cam.s - old) < 1e-6) fit(); }
    }
    function computeFit() {
      const w = V.world;
      V.fitScale = Math.min((V.W - 40) / (w.w * TS), (V.H - 120) / (w.h * TS));
    }
    function fit() {
      const w = V.world; if (!w) return;
      computeFit();
      V.cam.s = V.fitScale;
      V.cam.x = (V.W - w.w * TS * V.cam.s) / 2;
      V.cam.y = (V.H - w.h * TS * V.cam.s) / 2 + 24;
    }
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
    const dayOf = (t) => 'Day ' + (Math.floor(t / 120) + 1);

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
      const s = TS * V.cam.s;
      const a01 = clamp(alpha, 0, 1);
      const e = 0.55 * a01 + 0.45 * ease(a01);   // glide between tiles, with a soft start and stop
      ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, V.W, V.H);

      // world edge
      ctx.strokeStyle = '#efefef'; ctx.lineWidth = 1;
      ctx.strokeRect(V.cam.x, V.cam.y, w.w * s, w.h * s);

      // territories
      for (const k of w.kingdoms.values()) {
        const r = (6 + k.members.size * 0.55) * s;
        ctx.beginPath(); ctx.arc(sx(k.cx), sy(k.cy), r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${k.color.hue},70%,80%,0.17)`; ctx.fill();
        ctx.setLineDash([3, 7]); ctx.strokeStyle = `hsla(${k.color.hue},55%,62%,0.38)`; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
      }
      // farms
      for (const k of w.kingdoms.values()) {
        for (const p of k.farms) {
          const x = sx(p.x) - s * 0.5, y = sy(p.y) - s * 0.5;
          ctx.fillStyle = `hsla(${k.color.hue},45%,90%,1)`; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
          ctx.strokeStyle = k.color.line; ctx.lineWidth = 1; ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
          if (p.state === 'growing') {
            const g = clamp(p.growth, 0, 1), r = (s * 0.14) + s * 0.22 * g;
            ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, r, 0, Math.PI * 2); ctx.fillStyle = '#b7dca0'; ctx.fill();
          } else if (p.state === 'ready') {
            ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.3, 0, Math.PI * 2); ctx.fillStyle = '#f0d36a'; ctx.fill();
          }
        }
      }
      // capitals
      for (const k of w.kingdoms.values()) {
        const x = sx(k.cx), y = sy(k.cy);
        drawIcon('building-castle', x, y, s * 1.9, k.color.dark);
        ctx.fillStyle = k.color.dark; ctx.font = `600 ${Math.max(9, Math.min(13, s * 0.5))}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(k.name, x, y + s * 1.0);
        if (k.wars.size) drawIcon('swords', x + s * 1.2, y - s * 0.8, s * 0.9, '#d9534f');
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
        ctx.fillStyle = '#8c6a4a'; ctx.fill();
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
        blob(x, y, R, t, u.id * 1.7, moving ? 0.13 : 0.08);
        ctx.fillStyle = k ? k.color.fill : FREE_COLOR; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = k ? k.color.line : FREE_LINE; ctx.stroke();
        if (u.id === sel) {
          ctx.beginPath(); ctx.arc(x, y, R + 4, 0, Math.PI * 2);
          ctx.strokeStyle = '#3b3b3b'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        // wounded: a thin heart line under the unit
        if (u.hearts < u.maxHearts && s >= 11) {
          const bw = R * 1.9;
          ctx.fillStyle = '#ececec'; ctx.fillRect(x - bw / 2, y + R + 3, bw, 2.5);
          ctx.fillStyle = '#e5484d'; ctx.fillRect(x - bw / 2, y + R + 3, bw * clamp(u.hearts / u.maxHearts, 0, 1), 2.5);
        }
        // little signs above the head
        if (s >= 11) {
          const icons = [];
          if (k && k.ruler === u.id) icons.push(['crown', k.color.dark, 'filled']);
          if (u.fight) icons.push(['swords', '#d9534f']);
          if (u.status.burn > 0) icons.push(['flame', '#f08c00']);
          if (u.status.poison > 0) icons.push(['droplet', '#2f9e44']);
          if (u.status.confused > 0) icons.push(['spiral', '#d9822b']);
          const isz = Math.max(9, Math.min(17, s * 0.62));
          icons.forEach((ico, i) => drawIcon(ico[0], x + (i - (icons.length - 1) / 2) * isz * 1.05, y - R - isz * 0.62, isz, ico[1], ico[2]));
        }
        if (u.id === sel || u.id === hov) {
          ctx.fillStyle = '#555'; ctx.font = `500 ${Math.max(10, Math.min(12, s * 0.5))}px ui-sans-serif, system-ui, sans-serif`;
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
        if (Math.hypot(sx(k.cx) - px, sy(k.cy) - py) < s * 1.2) return { type: 'kingdom', id: k.id };
      }
      return null;
    }

    function zoomAt(px, py, factor) {
      const c = V.cam;
      const ns = clamp(c.s * factor, V.fitScale * 0.7, V.fitScale * 7);
      const k = ns / c.s;
      c.x = px - (px - c.x) * k; c.y = py - (py - c.y) * k; c.s = ns;
    }

    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    canvas.addEventListener('pointerdown', (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      V.drag = { x: ev.clientX, y: ev.clientY, cx: V.cam.x, cy: V.cam.y, moved: false };
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (V.drag) {
        const dx = ev.clientX - V.drag.x, dy = ev.clientY - V.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) V.drag.moved = true;
        if (V.drag.moved) { V.cam.x = V.drag.cx + dx; V.cam.y = V.drag.cy + dy; }
      } else {
        const h = pick(ev.clientX, ev.clientY);
        V.hover = h && h.type === 'unit' ? h.id : null;
        canvas.style.cursor = h ? 'pointer' : 'default';
      }
    });
    canvas.addEventListener('pointerup', (ev) => {
      const d = V.drag; V.drag = null;
      if (d && !d.moved) {
        const h = pick(ev.clientX, ev.clientY);
        K.audio.sfx('click', 1);
        select(h);
      }
    });
    panelEl.addEventListener('click', (ev) => {
      const t = ev.target.closest('.p-x');
      if (t) { select(null); return; }
      const nm = ev.target.closest('.nm');
      if (nm) select({ type: 'unit', id: +nm.dataset.uid });
    });
    panelEl.addEventListener('wheel', (ev) => ev.stopPropagation(), { passive: true });
    globalThis.addEventListener('resize', resize);

    V.resize = resize; V.fit = fit; V.setWorld = setWorld; V.draw = draw; V.handleEvents = handleEvents;
    V.select = select; V.TS = TS;
    resize();
    return V;
  }

  K.createView = createView;
})();
