// Krowns - drawing. EVERY pixel of the game is the same size: sprites are 16x16 and are only ever drawn at a whole-number
// zoom (1x, 2x, 3x ...) with image smoothing off. Zooming glides to the next whole step; walking, stretching and swaying are smooth.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const { clamp } = K.util;
  const TILE = 16;
  const FEET = 8;      // bodies stand with their feet half a tile lower than their tile, so they can walk behind the upper half of trees
  const R = (K.render = {});

  // ------------------------------------------------------------------ pictures
  const images = {};
  const loadImage = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not load ' + url)); im.src = url; });
  R.loadAssets = async function (version) {
    const v = version ? '?v=' + version : '';
    await Promise.all(['knight', 'base', 'tree'].map(async (n) => { images[n] = await loadImage('assets/sprites/' + n + '.png' + v); }));
    images.grassDetail = await loadImage('assets/world/grass-detail.png' + v);
    images.grassMap = await loadImage('assets/world/grass-map.png' + v);
    try { await document.fonts.load('700 16px Lexend'); await document.fonts.load('400 16px Lexend'); } catch (e) { /* a fallback font is used */ }
  };
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const silCache = {};
  function silhouette(src, key, color) {
    const k2 = key + color;
    if (silCache[k2]) return silCache[k2];
    const c = mkCanvas(src.width, src.height), g = c.getContext('2d');
    g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    return (silCache[k2] = c);
  }

  // ------------------------------------------------------------------ the view
  R.view = { cx: 0, cy: 0, S: 3, w: 800, h: 600, dpr: 1, ox: 0, oy: 0 };
  R.follow = null;         // the body the camera follows
  let canvas, ctx, lastT = 0, V, items = [];
  const zoomSteps = () => S('render.zoomSteps', [1, 2, 3, 4, 6, 8]);

  R.init = function (cv) { canvas = cv; ctx = cv.getContext('2d', { alpha: false }); R.resize(); };
  R.resize = function () {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor((canvas.clientWidth || window.innerWidth) * dpr)), h = Math.max(1, Math.floor((canvas.clientHeight || window.innerHeight) * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    R.view.w = w; R.view.h = h; R.view.dpr = dpr;
    ctx.imageSmoothingEnabled = false;
  };
  // best whole-number zoom so that about `tiles` tiles fit across the screen
  R.fitScale = function (tiles) {
    const want = R.view.w / (tiles * TILE);
    let best = zoomSteps()[0];
    for (const s of zoomSteps()) if (s <= want * 1.15) best = s;
    return best;
  };
  R.zoomStep = function (dir) {         // glides to the next whole-number zoom
    const steps = zoomSteps(), cur = R.zoomTarget || R.view.S;
    let i = 0, bd = 1e9;
    steps.forEach((x, k) => { const d = Math.abs(x - cur); if (d < bd) { bd = d; i = k; } });
    R.zoomTarget = steps[clamp(i + dir, 0, steps.length - 1)];
  };
  function advanceZoom(dt) {
    if (!R.zoomTarget) return;
    const v = R.view;
    let s = v.S + (R.zoomTarget - v.S) * (1 - Math.exp(-dt * 11));
    if (Math.abs(s - R.zoomTarget) < 0.01) { s = R.zoomTarget; R.zoomTarget = null; }
    v.S = s;
  }
  R.centerOn = (b) => { R.view.cx = b.fx * TILE + 8; R.view.cy = b.fy * TILE + 8 + FEET; };
  const sxOf = (wx) => wx * V.S + V.ox, syOf = (wy) => wy * V.S + V.oy;

  // ------------------------------------------------------------------ drawing a picture (with a stretch)
  // `extra` (any fractional number) stretches one row, so the picture grows smoothly upward; that row is the chest, never the face
  const chestRows = new WeakMap();
  function chestRow(img) {
    if (chestRows.has(img)) return chestRows.get(img);
    let row = Math.floor(img.height / 2);
    try {
      const c = mkCanvas(img.width, img.height), g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      let top = -1, bot = -1;
      for (let y = 0; y < img.height; y++) {
        let any = false;
        for (let x = 0; x < img.width && !any; x++) any = d[(y * img.width + x) * 4 + 3] > 0;
        if (any) { if (top < 0) top = y; bot = y; }
      }
      if (top >= 0) row = Math.min(bot - 1, top + Math.round((bot - top) * 0.68));
    } catch (e) { /* keep the middle row */ }
    chestRows.set(img, row);
    return row;
  }
  // draws `img` with its bottom edge at world y = wyBottom and its left edge at world x = wx
  function blit(img, wx, wyBottom, o) {
    o = o || {};
    const s = V.S, iw = img.width, ih = img.height, extra = o.extra || 0;
    const dx = sxOf(wx), top = syOf(wyBottom - ih - extra);
    if (o.alpha !== undefined && o.alpha !== 1) ctx.globalAlpha = o.alpha;
    if (o.flip) { ctx.save(); ctx.translate(dx + iw * s, 0); ctx.scale(-1, 1); }
    const x0 = o.flip ? 0 : dx;
    if (Math.abs(extra) < 0.002) ctx.drawImage(img, 0, 0, iw, ih, x0, Math.round(top), iw * s, Math.round(top + ih * s) - Math.round(top));
    else {
      const m = Math.max(0, Math.min(ih - 2, chestRow(img))), topRows = m;
      const y0 = Math.round(top), y1 = Math.round(top + topRows * s), y2 = Math.round(top + (topRows + 1 + extra) * s), y3 = Math.round(top + (ih + extra) * s);
      if (topRows > 0 && y1 > y0) ctx.drawImage(img, 0, 0, iw, topRows, x0, y0, iw * s, y1 - y0);
      if (y2 > y1) ctx.drawImage(img, 0, m, iw, 1, x0, y1, iw * s, y2 - y1);
      const botRows = ih - m - 1;
      if (botRows > 0 && y3 > y2) ctx.drawImage(img, 0, m + 1, iw, botRows, x0, y2, iw * s, y3 - y2);
    }
    if (o.flip) ctx.restore();
    if (o.alpha !== undefined && o.alpha !== 1) ctx.globalAlpha = 1;
  }
  // the whole picture leans sideways (its top moves by `lean` game pixels): trees in the wind
  function blitLean(img, wx, wyBottom, o) {
    const s = V.S, iw = img.width, ih = img.height;
    if (o.alpha !== undefined && o.alpha !== 1) ctx.globalAlpha = o.alpha;
    ctx.save();
    ctx.translate(sxOf(wx) + (o.flip ? iw * s : 0), syOf(wyBottom));
    if (o.flip) ctx.scale(-1, 1);
    ctx.transform(1, 0, -o.lean / ih, 1, 0, 0);
    ctx.drawImage(img, 0, 0, iw, ih, 0, -ih * s, iw * s, ih * s);
    ctx.restore();
    if (o.alpha !== undefined && o.alpha !== 1) ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ shadows: the sun is always in the same place
  // the picture's silhouette is laid flat on the ground, leaning away from the sun. (baseX, baseY) = the feet, in world pixels.
  function castShadow(img, key, baseX, baseY, flip) {
    const sil = silhouette(img, key, K.C('shadow.purple', '#957fae'));
    const iw = img.width, ih = img.height, ax = S('shadow.lean', -0.4), ay = S('shadow.length', 0.4);
    ctx.save();
    ctx.setTransform(V.S, 0, 0, V.S, V.ox, V.oy);
    ctx.transform(1, 0, -ax, -ay, baseX - iw / 2 + ax * ih, baseY + ay * ih);
    if (flip) { ctx.translate(iw, 0); ctx.scale(-1, 1); }
    ctx.drawImage(sil, 0, 0, iw, ih, 0, 0, iw, ih);
    ctx.restore();
  }

  // ------------------------------------------------------------------ grass
  function advanceGrass(g, dt) {
    const an = K.anim('grass_sway');
    g.phase += (Math.PI * 2 / g.period) * dt;
    if (g.phase > Math.PI * 2) {
      g.phase -= Math.PI * 2; g.cycles++;
      if (g.cycles >= (an.extra.cyclesBeforeSpeedChange || 3)) { g.cycles = 0; g.period = an.extra.periodMin + Math.random() * (an.extra.periodMax - an.extra.periodMin); }
    }
  }
  const grassExtra = (g) => K.anim('grass_sway').stretch * (0.5 + 0.5 * Math.sin(g.phase));

  // the ground is painted once per world, at 1 pixel = 1 game pixel, then only ever copied at whole-number zoom
  function ensureBackground(W) {
    if (R.bgWorld === W) return;
    R.bgWorld = W;
    const gm = images.grassMap;
    const probe = mkCanvas(gm.width, gm.height), pg = probe.getContext('2d');
    pg.drawImage(gm, 0, 0);
    const d = pg.getImageData(0, 0, gm.width, gm.height).data, counts = {};
    let best = '127,176,96', bn = 0;      // the most common opaque colour of the patch = the base green behind the patches
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) { const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2]; counts[k] = (counts[k] || 0) + 1; if (counts[k] > bn) { bn = counts[k]; best = k; } }
    R.baseColor = 'rgb(' + best + ')';
    const m = 20 * TILE; R.bgMargin = m;
    const c = mkCanvas(W.w * TILE + m * 2, W.h * TILE + m * 2), g = c.getContext('2d');
    g.fillStyle = R.baseColor; g.fillRect(0, 0, c.width, c.height);
    const rng = K.util.makeRng((W.seed ^ 0x9e3779b9) >>> 0), step = 84;
    for (let y = -gm.height; y < c.height; y += step) for (let x = -gm.width; x < c.width; x += step) {
      const px = x + rng.int(-22, 22) + ((Math.floor(y / step) & 1) ? 42 : 0), py = y + rng.int(-22, 22);
      g.save();
      if (rng.chance(0.5)) { g.translate(px + gm.width, 0); g.scale(-1, 1); g.drawImage(gm, 0, py); } else g.drawImage(gm, px, py);
      g.restore();
    }
    R.bg = c;
  }

  // ------------------------------------------------------------------ one frame
  const wave = (t, period, phase) => 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / period + (phase || 0));
  const treeFlip = (tr) => ((tr.x * 7 + tr.y * 3) & 1) === 1;
  function bodyPos(b) {
    const lift = b.walkP > 0 || b.moving ? S('unit.hopHeightPx', 2) * Math.sin(Math.PI * b.walkP) : 0;
    return { px: b.fx * TILE, py: b.fy * TILE + FEET, lift };
  }

  R.draw = function (W, now) {
    if (!ctx) return;
    const dt = Math.min(0.1, Math.max(0, now - lastT)); lastT = now;
    const v = R.view; V = v;
    advanceZoom(dt);
    if (R.follow) {     // the camera follows smoothly
      const p = bodyPos(R.follow);
      v.cx += (p.px + 8 - v.cx) * Math.min(1, dt * 6); v.cy += (p.py + 8 - v.cy) * Math.min(1, dt * 6);
    }
    v.ox = Math.round(v.w / 2 - v.cx * v.S); v.oy = Math.round(v.h / 2 - v.cy * v.S);
    const s = v.S, t = W.t;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // 1. the ground
    ensureBackground(W);
    ctx.fillStyle = R.baseColor; ctx.fillRect(0, 0, v.w, v.h);
    const wx0 = Math.floor(-v.ox / s), wy0 = Math.floor(-v.oy / s), wx1 = Math.ceil((v.w - v.ox) / s), wy1 = Math.ceil((v.h - v.oy) / s);
    {
      const m = R.bgMargin, bc = R.bg;
      const a0 = Math.max(0, wx0 + m), b0 = Math.max(0, wy0 + m), a1 = Math.min(bc.width, wx1 + m), b1 = Math.min(bc.height, wy1 + m);
      if (a1 > a0 && b1 > b0) ctx.drawImage(bc, a0, b0, a1 - a0, b1 - b0, sxOf(a0 - m), syOf(b0 - m), (a1 - a0) * s, (b1 - b0) * s);
    }
    // outside of the world is dimmed
    const mapL = sxOf(0), mapT = syOf(0), mapR = sxOf(W.w * TILE), mapB = syOf(W.h * TILE);
    ctx.fillStyle = 'rgba(34,28,48,0.55)';
    ctx.fillRect(0, 0, v.w, Math.max(0, mapT));
    ctx.fillRect(0, Math.min(v.h, mapB), v.w, Math.max(0, v.h - mapB));
    ctx.fillRect(0, Math.max(0, mapT), Math.max(0, mapL), Math.max(0, Math.min(v.h, mapB) - Math.max(0, mapT)));
    ctx.fillRect(Math.min(v.w, mapR), Math.max(0, mapT), Math.max(0, v.w - mapR), Math.max(0, Math.min(v.h, mapB) - Math.max(0, mapT)));

    // 2. everything that stands on the ground, lowest on the screen drawn last (grass, trees, bodies share one layer)
    const vx0 = wx0 - 16, vx1 = wx1 + 16, vy0 = wy0 - 16, vy1 = wy1 + 16;
    items = [];
    for (const g of W.grass) {
      const px = g.x * TILE + 3 + g.ox, py = g.y * TILE + 3 + g.oy;
      if (px < vx0 || px > vx1 || py < vy0 || py > vy1) continue;
      advanceGrass(g, dt);
      items.push({ k: 'grass', y: py + 10, px, py, ref: g });
    }
    for (const tr of W.trees) {
      const px = tr.x * TILE, py = tr.y * TILE;
      if (px + 16 < vx0 || px > vx1 || py + 16 < vy0 - 8 || py > vy1 + 8) continue;
      items.push({ k: 'tree', y: py + 16, px, py, ref: tr });
    }
    for (const b of W.bodies) { const p = bodyPos(b); items.push({ k: 'body', y: p.py + 16.1, px: p.px, py: p.py, lift: p.lift, ref: b }); }
    items.sort((a, b) => a.y - b.y);

    // 3. shadows (multiply, desaturated purple), before the things that cast them
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = K.C('shadow.purple', '#957fae');
    ctx.globalAlpha = K.C('shadow.opacity', 1);
    for (const it of items) {
      if (it.k === 'tree') castShadow(images.tree, 'tree', it.px + 8, it.py + 15.5, treeFlip(it.ref));
      else if (it.k === 'body') castShadow(images[it.ref.sprite], it.ref.sprite, it.px + 8, it.py + 15.5, it.ref.face < 0);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // 4. the things themselves
    for (const it of items) {
      if (it.k === 'grass') blit(images.grassDetail, it.px, it.py + 10, { extra: grassExtra(it.ref) });
      else if (it.k === 'tree') drawTree(W, it, dt, t);
      else drawBody(it, t);
    }

    // 5. words: names and speech bubbles
    drawTexts(W, t);
  };

  function drawTree(W, it, dt, t) {
    const tr = it.ref;
    let behind = false;      // fades when somebody stands behind it
    for (const b of W.bodies) { const bx = Math.round(b.fx), by = Math.round(b.fy); if (by === tr.y - 1 && Math.abs(bx - tr.x) <= 1) behind = true; }
    const target = behind ? S('tree.fadeOpacity', 0.5) : 1, rate = dt / Math.max(0.01, S('tree.fadeSeconds', 0.25));
    tr.fade += clamp(target - tr.fade, -rate, rate);
    const an = K.anim('tree_sway'), h = ((tr.x * 73856093) ^ (tr.y * 19349663)) >>> 0;
    const period = (an.extra.periodMin || 2.5) + ((h % 100) / 100) * ((an.extra.periodMax || 5.5) - (an.extra.periodMin || 2.5));
    const lean = an.stretch * (Math.sin(t * Math.PI * 2 / period + (h % 628) / 100) * 0.8 + 0.2 * Math.sin(t * 1.7 + (h >> 4) % 7));
    blitLean(images.tree, it.px, it.py + 16, { alpha: tr.fade, flip: treeFlip(tr), lean });
  }

  function drawBody(it, t) {
    const b = it.ref;
    let extra;
    if (b.moving) extra = K.anim('hop').stretch * Math.sin(Math.PI * b.walkP);
    else if (b.talkUntil && t < b.talkUntil) { const an = K.anim('talk'); extra = an.stretch * wave(t, an.period, b.phase); }
    else { const an = K.anim('breathe'); extra = an.stretch * wave(t, an.period, b.phase); }
    blit(images[b.sprite], it.px, it.py + 16 - it.lift, { flip: b.face < 0, extra });
  }

  // ------------------------------------------------------------------ names and speech bubbles
  function wrap(text, maxChars) {
    const lines = []; let cur = '';
    for (const w of text.split(' ')) {
      if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function roundedRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function outlinedText(txt, x, y, fill, outline, lw) {
    ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = outline; ctx.strokeText(txt, x, y); ctx.fillStyle = fill; ctx.fillText(txt, x, y);
  }
  function drawTexts(W, t) {
    const s = V.S, outline = K.C('ui.nameOutline', '#2a2433');
    const namePx = Math.max(S('render.nameFontMinPx', 9), Math.round(S('render.nameFontWorldPx', 5.5) * s));
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const bubbles = [];
    for (const it of items) {
      if (it.k !== 'body') continue;
      const b = it.ref, cx = sxOf(it.px + 8);
      let nameY = syOf(it.py - it.lift - 3);
      ctx.font = '700 ' + namePx + 'px Lexend, system-ui, sans-serif';
      outlinedText(b.name, cx, nameY, K.C('name.pastel.' + b.color, '#ffffff'), outline, Math.max(2, s * 0.8));
      nameY -= Math.round(namePx * 1.05);
      if (b.bubble && t - b.bubble.t0 < b.bubble.dur) bubbles.push({ b, cx, y: nameY });
    }
    // speech bubbles, typed out letter by letter
    const bpx = Math.max(12, Math.round(4.2 * s));
    ctx.font = '400 ' + bpx + 'px Lexend, system-ui, sans-serif';
    for (const o of bubbles) {
      const bub = o.b.bubble;
      if (!bub.lines) bub.lines = wrap(bub.text, 22);
      const shown = Math.min(bub.text.length, Math.floor((t - bub.t0) * bub.cps) + 1);
      if (shown !== bub.shown) { if (R.onChars) R.onChars(o.b, Math.max(0, bub.shown), shown); bub.shown = shown; }
      let wmax = 0;
      for (const l of bub.lines) wmax = Math.max(wmax, ctx.measureText(l).width);
      const pad = Math.round(bpx * 0.5), lh = Math.round(bpx * 1.25);
      const bw = Math.ceil(wmax + pad * 2), bh = bub.lines.length * lh + pad;
      let bx = Math.round(o.cx - bw / 2); const by = Math.round(o.y - bh - Math.round(bpx * 0.5));
      bx = clamp(bx, 4, V.w - bw - 4);
      ctx.fillStyle = K.C('ui.bubble', '#ffffff'); ctx.strokeStyle = 'rgba(47,44,54,0.35)'; ctx.lineWidth = Math.max(1, Math.round(s * 0.5));
      roundedRect(bx, by, bw, bh, Math.round(bpx * 0.55)); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(o.cx - bpx * 0.3, by + bh - 1); ctx.lineTo(o.cx + bpx * 0.3, by + bh - 1); ctx.lineTo(o.cx, by + bh + bpx * 0.45); ctx.closePath(); ctx.fill();   // little tail
      ctx.fillStyle = K.C('ui.bubbleText', '#2f2c36'); ctx.textAlign = 'left';
      let left = shown;
      for (let i = 0; i < bub.lines.length; i++) {
        const l = bub.lines[i], part = l.slice(0, Math.max(0, left));
        left -= l.length + 1;
        if (part) ctx.fillText(part, bx + pad, by + pad * 0.5 + lh * (i + 0.85));
        if (left <= 0) break;
      }
      ctx.textAlign = 'center';
    }
  }
})();
