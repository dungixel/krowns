// Krowns - drawing. EVERY pixel of the game is the same size: sprites are 16x16 and are only ever drawn at a whole-number
// zoom (1x, 2x, 3x ... device pixels per game pixel), at whole-number positions, with image smoothing off.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const { clamp, hexToRgb } = K.util;
  const TILE = 16;
  const R = (K.render = {});

  // ------------------------------------------------------------------ assets
  const images = {};
  function loadImage(url) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not load ' + url)); im.src = url; });
  }
  R.loadAssets = async function (base, version) {
    const v = version ? '?v=' + version : '';
    const names = ['archer', 'axeman', 'bard', 'base', 'bat', 'blacksmith', 'chest', 'farmer', 'joker', 'king', 'knight', 'mage', 'merchant', 'pig', 'prince', 'rat', 'slime', 'snake', 'spearman', 'tree', 'witch'];
    await Promise.all(names.map(async (n) => { images[n] = await loadImage(base + 'assets/sprites/' + n + '.png' + v); }));
    images.grassDetail = await loadImage(base + 'assets/world/grass-detail.png' + v);
    images.grassMap = await loadImage(base + 'assets/world/grass-map.png' + v);
    try { await document.fonts.load('700 16px Lexend'); await document.fonts.load('400 16px Lexend'); } catch (e) { /* the browser will use a fallback font */ }
    buildCaches();
  };

  // ------------------------------------------------------------------ cached variants of the sprites
  const cache = { tint: {}, rot: {}, sil: {}, purpleGrass: null, kid: {} };
  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tintedCanvas(img, hex) {
    const key = img.src + hex;
    if (cache.tint[key]) return cache.tint[key];
    const c = mkCanvas(img.width, img.height), g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = hex; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(img, 0, 0);
    return (cache.tint[key] = c);
  }
  function rotatedCanvas(src, key) {
    if (cache.rot[key]) return cache.rot[key];
    const c = mkCanvas(src.height, src.width), g = c.getContext('2d');
    g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(src, 0, 0);
    return (cache.rot[key] = c);
  }
  function silhouette(src, key, color) {
    const k2 = key + color;
    if (cache.sil[k2]) return cache.sil[k2];
    const c = mkCanvas(src.width, src.height), g = c.getContext('2d');
    g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    return (cache.sil[k2] = c);
  }
  function buildCaches() {
    cache.purpleGrass = tintedCanvas(images.grassDetail, K.C('shadow.purple', '#957fae'));
  }

  // ------------------------------------------------------------------ pixel font (3x5), used for the labels on placeholder buildings
  const GLYPHS = {
    A: '.#.|#.#|###|#.#|#.#', B: '##.|#.#|##.|#.#|##.', C: '.##|#..|#..|#..|.##', D: '##.|#.#|#.#|#.#|##.', E: '###|#..|##.|#..|###', F: '###|#..|##.|#..|#..',
    G: '.##|#..|#.#|#.#|.##', H: '#.#|#.#|###|#.#|#.#', I: '###|.#.|.#.|.#.|###', J: '..#|..#|..#|#.#|.#.', K: '#.#|#.#|##.|#.#|#.#', L: '#..|#..|#..|#..|###',
    M: '#.#|###|###|#.#|#.#', N: '##.|#.#|#.#|#.#|#.#', O: '.#.|#.#|#.#|#.#|.#.', P: '##.|#.#|##.|#..|#..', Q: '.#.|#.#|#.#|##.|.##', R: '##.|#.#|##.|#.#|#.#',
    S: '.##|#..|.#.|..#|##.', T: '###|.#.|.#.|.#.|.#.', U: '#.#|#.#|#.#|#.#|###', V: '#.#|#.#|#.#|#.#|.#.', W: '#.#|#.#|###|###|#.#', X: '#.#|#.#|.#.|#.#|#.#',
    Y: '#.#|#.#|.#.|.#.|.#.', Z: '###|..#|.#.|#..|###', 0: '###|#.#|#.#|#.#|###', 1: '.#.|##.|.#.|.#.|###', 2: '##.|..#|.#.|#..|###', 3: '##.|..#|.#.|..#|##.',
    4: '#.#|#.#|###|..#|..#', 5: '###|#..|##.|..#|##.', 6: '.##|#..|###|#.#|###', 7: '###|..#|.#.|.#.|.#.', 8: '###|#.#|###|#.#|###', 9: '###|#.#|###|..#|##.',
    '-': '...|...|###|...|...', '!': '.#.|.#.|.#.|...|.#.', '?': '##.|..#|.#.|...|.#.', '.': '...|...|...|...|.#.', ':': '...|.#.|...|.#.|...', ' ': '...|...|...|...|...',
  };
  function pixelTextWidth(t) { return t.length * 4 - 1; }
  function drawPixelText(ctx, text, wx, wy, color, S_, ox, oy) {
    ctx.fillStyle = color;
    let x = wx;
    for (const ch of text.toUpperCase()) {
      const g = GLYPHS[ch] || GLYPHS['?'];
      const rows = g.split('|');
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (rows[r][c] === '#') ctx.fillRect((x + c) * S_ + ox, (wy + r) * S_ + oy, S_, S_);
      x += 4;
    }
  }

  // ------------------------------------------------------------------ state of the view
  R.view = { cx: 0, cy: 0, S: 3, w: 800, h: 600, dpr: 1, ox: 0, oy: 0 };
  R.hover = null; R.selected = null; R.follow = false;
  let canvas, ctx, lastT = 0, frameDt = 0.016;
  let items = [];
  const zoomSteps = () => S('render.zoomSteps', [1, 2, 3, 4, 6, 8]);

  R.init = function (cv) {
    canvas = cv; ctx = cv.getContext('2d', { alpha: false });
    R.resize();
  };
  R.resize = function () {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || window.innerWidth, cssH = canvas.clientHeight || window.innerHeight;
    const w = Math.max(1, Math.floor(cssW * dpr)), h = Math.max(1, Math.floor(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    R.view.w = w; R.view.h = h; R.view.dpr = dpr;
    ctx.imageSmoothingEnabled = false;
  };
  // best whole-number zoom so that about `tiles` tiles fit across the screen
  R.fitScale = function (tiles) {
    const want = R.view.w / (tiles * TILE);
    const steps = zoomSteps();
    let best = steps[0];
    for (const s of steps) if (s <= want * 1.15) best = s;
    return best;
  };
  R.setScale = function (s, anchorSx, anchorSy) {
    const v = R.view;
    const ax = anchorSx === undefined ? v.w / 2 : anchorSx, ay = anchorSy === undefined ? v.h / 2 : anchorSy;
    const wx = (ax - v.ox) / v.S, wy = (ay - v.oy) / v.S;
    v.S = s;
    v.cx = wx - (ax - v.w / 2) / s; v.cy = wy - (ay - v.h / 2) / s;
    clampCamera();
  };
  R.zoomStep = function (dir, ax, ay) {
    const steps = zoomSteps();
    let i = steps.indexOf(R.view.S);
    if (i < 0) i = 0;
    i = clamp(i + dir, 0, steps.length - 1);
    R.setScale(steps[i], ax, ay);
  };
  function clampCamera() {
    const v = R.view, W = R.world;
    if (!W) return;
    const m = 4 * TILE;
    v.cx = clamp(v.cx, -m, W.w * TILE + m); v.cy = clamp(v.cy, -m, W.h * TILE + m);
  }
  R.panBy = function (dxDevice, dyDevice) { const v = R.view; v.cx -= dxDevice / v.S; v.cy -= dyDevice / v.S; clampCamera(); };
  R.centerOn = function (tx, ty) { R.view.cx = tx * TILE + 8; R.view.cy = ty * TILE + 8; clampCamera(); };
  R.screenToWorld = function (sx, sy) { const v = R.view; return { x: (sx - v.ox) / v.S, y: (sy - v.oy) / v.S }; };

  // ------------------------------------------------------------------ drawing helpers (everything lands on whole device pixels)
  let V; // current view
  const sxOf = (wx) => wx * V.S + V.ox;
  const syOf = (wy) => wy * V.S + V.oy;

  // draws `img` (16x16 or any size) with its bottom edge at world y = wyBottom, left edge at world x = wx.
  // `extra` duplicates the middle row that many times (a stretch of whole pixels); `crop` cuts rows off the top.
  function blit(img, wx, wyBottom, o) {
    o = o || {};
    const s = V.S, iw = img.width, ih = img.height;
    const crop = o.crop || 0, extra = o.extra || 0;
    const rows = ih - crop;
    const totalH = rows + extra;
    const dx = sxOf(wx), dyTop = syOf(wyBottom - totalH);
    if (o.alpha !== undefined && o.alpha !== 1) ctx.globalAlpha = o.alpha;
    if (o.flip) { ctx.save(); ctx.translate(dx + iw * s, 0); ctx.scale(-1, 1); }
    const x0 = o.flip ? 0 : dx;
    if (extra <= 0) ctx.drawImage(img, 0, crop, iw, rows, x0, dyTop, iw * s, rows * s);
    else {
      const m = crop + Math.floor(rows / 2);
      const topRows = m - crop;
      if (topRows > 0) ctx.drawImage(img, 0, crop, iw, topRows, x0, dyTop, iw * s, topRows * s);
      ctx.drawImage(img, 0, m, iw, 1, x0, dyTop + topRows * s, iw * s, (1 + extra) * s);
      const botRows = ih - m - 1;
      if (botRows > 0) ctx.drawImage(img, 0, m + 1, iw, botRows, x0, dyTop + (topRows + 1 + extra) * s, iw * s, botRows * s);
    }
    if (o.flip) ctx.restore();
    if (o.alpha !== undefined && o.alpha !== 1) ctx.globalAlpha = 1;
  }
  function fillWorldRect(wx, wy, w, h, color) { ctx.fillStyle = color; ctx.fillRect(sxOf(wx), syOf(wy), w * V.S, h * V.S); }

  // pixel-art ellipse shadow, 12x3 game pixels
  function shadow(cwx, bottomWy, wide) {
    const w = wide || 12;
    const rows = w >= 14 ? [w - 4, w, w - 4] : [w - 4, w, w - 4];
    for (let r = 0; r < 3; r++) ctx.fillRect(sxOf(cwx - rows[r] / 2), syOf(bottomWy - 2 + r), rows[r] * V.S, V.S);
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
  function grassExtra(g) { const an = K.anim('grass_sway'); return Math.round(an.stretch * (0.5 + 0.5 * Math.sin(g.phase))); }

  function ensureEdgeTufts(W) {
    if (R.edgeVersion === W.kmapVersion && R.edgeW === W) return;
    R.edgeVersion = W.kmapVersion; R.edgeW = W;
    const arr = [];
    for (const e of W.edges || []) {
      for (let j = 0; j < 4; j++) {
        const h = ((e.x * 73856093) ^ (e.y * 19349663) ^ (j * 83492791)) >>> 0;
        arr.push({ x: e.x, y: e.y, ox: (h % 11) - 3, oy: ((h >> 8) % 11) - 3, phase: ((h >> 3) % 628) / 100, period: 2.5 + ((h >> 5) % 35) / 10, cycles: 0 });
      }
    }
    R.edgeTufts = arr;
  }

  // the background is painted once per world, at 1 pixel = 1 game pixel, then only ever copied at whole-number zoom
  function ensureBackground(W) {
    if (R.bgWorld === W) return;
    R.bgWorld = W;
    const gm = images.grassMap;
    // the most common opaque colour of the patch = the base green behind the patches
    const probe = mkCanvas(gm.width, gm.height), pg = probe.getContext('2d');
    pg.drawImage(gm, 0, 0);
    const d = pg.getImageData(0, 0, gm.width, gm.height).data, counts = {};
    let best = '127,176,96', bn = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) { const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2]; counts[k] = (counts[k] || 0) + 1; if (counts[k] > bn) { bn = counts[k]; best = k; } }
    R.baseColor = 'rgb(' + best + ')';
    const m = 20 * TILE; R.bgMargin = m;
    const c = mkCanvas(W.w * TILE + m * 2, W.h * TILE + m * 2), g = c.getContext('2d');
    g.fillStyle = R.baseColor; g.fillRect(0, 0, c.width, c.height);
    const rng = K.util.makeRng((W.seed ^ 0x9e3779b9) >>> 0);
    const step = 84;
    for (let y = -gm.height; y < c.height; y += step) for (let x = -gm.width; x < c.width; x += step) {
      const px = x + rng.int(-22, 22) + ((Math.floor(y / step) & 1) ? 42 : 0), py = y + rng.int(-22, 22);
      g.save();
      if (rng.chance(0.5)) { g.translate(px + gm.width, 0); g.scale(-1, 1); g.drawImage(gm, 0, py); } else g.drawImage(gm, px, py);
      g.restore();
    }
    R.bg = c;
  }

  // ------------------------------------------------------------------ one frame
  function lightColor(hour) {
    const day = hexToRgb(K.C('light.day', '#ffffff')), orange = hexToRgb(K.C('light.orange', '#ffd3a6')), rose = hexToRgb(K.C('light.rose', '#c49292')), night = hexToRgb(K.C('light.night', '#2e3650'));
    const stops = [[0, night], [5, night], [6.5, rose], [8, day], [17, day], [18.5, orange], [20, rose], [21.5, night], [24, night]];
    for (let i = 0; i < stops.length - 1; i++) {
      const [h0, c0] = stops[i], [h1, c1] = stops[i + 1];
      if (hour >= h0 && hour <= h1) { const t = (hour - h0) / (h1 - h0 || 1); return c0.map((v, k) => Math.round(v + (c1[k] - v) * t)); }
    }
    return day;
  }

  function entityPos(W, e, t) {
    let px = e.x * TILE, py = e.y * TILE, lift = 0;
    if (e.hop) {
      const p = clamp(e.hop.t / e.hop.dur, 0, 1);
      px = Math.round(e.hop.fx * TILE + (e.x - e.hop.fx) * TILE * p);
      py = Math.round(e.hop.fy * TILE + (e.y - e.hop.fy) * TILE * p);
      if (!e.flies) lift = Math.round(S('unit.hopHeightPx', 3) * Math.sin(Math.PI * p));
    }
    return { px, py, lift };
  }

  function spriteFor(u) {
    const id = K.sim.displayJob(u);
    const j = K.job(id);
    let img = images[j.sprite] || images.base;
    if (j.tint) img = tintedCanvas(img, j.tint);
    return { img, key: j.sprite + (j.tint || '') };
  }

  R.draw = function (W, now) {
    if (!ctx) return;
    R.world = W;
    const dt = Math.min(0.1, Math.max(0, now - lastT)); lastT = now; frameDt = dt;
    const v = R.view; V = v;
    // follow the selected unit
    if (R.follow && R.selected && R.selected.type === 'unit') {
      const u = W.byId.get(R.selected.id);
      if (u) { const p = entityPos(W, u, W.t); v.cx += (p.px + 8 - v.cx) * Math.min(1, dt * 6); v.cy += (p.py + 8 - v.cy) * Math.min(1, dt * 6); }
    }
    v.ox = Math.round(v.w / 2 - v.cx * v.S); v.oy = Math.round(v.h / 2 - v.cy * v.S);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const s = v.S;

    // ---- 1. the grass map is the background of everything: its patches are laid over a base green until the whole world is covered
    ensureBackground(W);
    ctx.fillStyle = R.baseColor; ctx.fillRect(0, 0, v.w, v.h);
    const wx0 = Math.floor(-v.ox / s), wy0 = Math.floor(-v.oy / s);
    const wx1 = Math.ceil((v.w - v.ox) / s), wy1 = Math.ceil((v.h - v.oy) / s);
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

    // ---- 2. grass tufts (green everywhere, purple on kingdom borders)
    const gd = images.grassDetail, pg = cache.purpleGrass;
    const vx0 = wx0 - 16, vx1 = wx1 + 16, vy0 = wy0 - 16, vy1 = wy1 + 16;
    for (const g of W.grass) {
      const px = g.x * TILE + 3 + g.ox, py = g.y * TILE + 3 + g.oy;
      if (px < vx0 || px > vx1 || py < vy0 || py > vy1) continue;
      advanceGrass(g, dt);
      blit(gd, px, py + 10, { extra: grassExtra(g) });
    }
    ensureEdgeTufts(W);
    for (const g of R.edgeTufts) {
      const px = g.x * TILE + 3 + g.ox, py = g.y * TILE + 4 + g.oy;
      if (px < vx0 || px > vx1 || py < vy0 || py > vy1) continue;
      advanceGrass(g, dt);
      blit(pg, px, py + 10, { extra: grassExtra(g) });
    }

    // ---- 3. collect what stands on the ground, in drawing order (lowest on the screen is drawn last)
    items = [];
    const t = W.t;
    const inView = (px, py, w, h) => px + w >= vx0 && px <= vx1 && py + h >= vy0 - 8 && py <= vy1 + 8;
    for (const tr of W.trees.values()) {
      const px = tr.x * TILE, py = tr.y * TILE;
      if (!inView(px, py, 16, 16)) continue;
      items.push({ k: 'tree', y: py + 16, ref: tr, px, py });
    }
    for (const st of W.structures.values()) {
      const px = st.x * TILE, py = st.y * TILE;
      if (!inView(px, py, st.w * TILE, st.h * TILE)) continue;
      items.push({ k: 'struct', y: py + st.h * TILE - 0.5, ref: st, px, py });
    }
    for (const tb of W.tombstones) {
      const px = tb.x * TILE, py = tb.y * TILE;
      if (!inView(px, py, 16, 16)) continue;
      items.push({ k: 'tomb', y: py + 15, ref: tb, px, py });
    }
    for (const u of W.units) {
      if (u.dead) continue;
      const p = entityPos(W, u, t);
      if (!inView(p.px, p.py, 16, 16)) continue;
      items.push({ k: 'unit', y: p.py + 16 + 0.1, ref: u, px: p.px, py: p.py, lift: p.lift });
    }
    for (const c of W.creatures) {
      if (c.dead) continue;
      const p = entityPos(W, c, t);
      if (!inView(p.px, p.py, 16, 16)) continue;
      items.push({ k: 'creature', y: p.py + 16 + (c.flies ? 40 : 0.1), ref: c, px: p.px, py: p.py, lift: p.lift });
    }
    items.sort((a, b) => a.y - b.y);

    // ---- 4. shadows (multiply, desaturated purple), all before the things that cast them
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = K.C('shadow.purple', '#957fae');
    ctx.globalAlpha = K.C('shadow.opacity', 1);
    for (const it of items) {
      if (it.k === 'tree') shadow(it.px + 8, it.py + 16, 14);
      else if (it.k === 'tomb') shadow(it.px + 8, it.py + 15, 10);
      else if (it.k === 'unit') shadow(it.px + 8, it.py + 15 + (it.ref.lying ? 0 : 0), it.ref.lying ? 14 : 12);
      else if (it.k === 'creature') shadow(it.px + 8, it.py + 15 + (it.ref.flies ? 2 : 0), it.ref.flies ? 8 : 12);
      else if (it.k === 'struct') {
        const st = it.ref;
        ctx.fillRect(sxOf(it.px + 2), syOf(it.py + st.h * TILE - 2), st.w * TILE * s, 3 * s);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // ---- 5. the things themselves
    const hoverId = R.hover && R.hover.id, selId = R.selected && R.selected.id;
    for (const it of items) {
      if (it.k === 'tree') drawTree(W, it, dt);
      else if (it.k === 'struct') drawStructure(W, it, t);
      else if (it.k === 'tomb') drawTomb(W, it, t);
      else if (it.k === 'unit') drawUnit(W, it, t);
      else drawCreature(W, it, t);
    }
    // selection marker
    for (const it of items) {
      if ((it.k === 'unit' || it.k === 'creature') && (it.ref.id === selId || it.ref.id === hoverId)) drawBrackets(it.px, it.py, it.ref.id === selId);
      if (it.k === 'struct' && (it.ref.id === selId || it.ref.id === hoverId)) drawBracketsRect(it.px, it.py, it.ref.w * TILE, it.ref.h * TILE, it.ref.id === selId);
    }
    // shots and little effects
    for (const it of items) if (it.k === 'unit' && it.ref.shot && t - it.ref.shot.t < 0.18) drawShot(it);

    // ---- 6. day and night
    const clock = K.sim.clockAt(W.t);
    const lc = lightColor(clock.hour);
    if (lc[0] < 255 || lc[1] < 255 || lc[2] < 255) {
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(' + lc[0] + ',' + lc[1] + ',' + lc[2] + ')';
      ctx.fillRect(0, 0, v.w, v.h); ctx.globalCompositeOperation = 'source-over';
    }

    // ---- 7. words (names, kingdom names, speech bubbles) - drawn after the light so they stay readable
    drawTexts(W, t);
  };

  // ------------------------------------------------------------------ things
  function drawTree(W, it, dt) {
    const tr = it.ref;
    // fade when something stands behind the tree
    let behind = false;
    for (let dx = -1; dx <= 1 && !behind; dx++) {
      const x = tr.x + dx, y = tr.y - 1;
      if (x < 0 || y < 0 || x >= W.w) continue;
      if (W.unitAt[y * W.w + x]) behind = true;
    }
    const an = K.anim('tree_fade');
    const target = behind ? (an.extra.opacity || S('tree.fadeOpacity', 0.5)) : 1;
    const rate = dt / Math.max(0.01, S('tree.fadeSeconds', 0.25));
    tr.fade += clamp(target - tr.fade, -rate, rate);
    const flip = ((tr.x * 7 + tr.y * 3) & 1) === 1;
    blit(images.tree, it.px, it.py + 16, { alpha: tr.fade, flip });
  }

  function drawStructure(W, it, t) {
    const st = it.ref, def = K.struct(st.type), s = V.S;
    const w = st.w * TILE, h = st.h * TILE;
    const flash = st.hurtAt && t - st.hurtAt < 0.15;
    const alpha = st.building ? 0.55 : 1;
    ctx.globalAlpha = alpha;
    if (def.sprite && images[def.sprite]) {
      blit(images[def.sprite], it.px, it.py + h, { alpha });
    } else {
      // placeholder drawing: a labelled square (no artwork yet)
      const col = def.color || '#cccccc';
      const rgb = hexToRgb(col);
      const dark = 'rgb(' + Math.round(rgb[0] * 0.62) + ',' + Math.round(rgb[1] * 0.62) + ',' + Math.round(rgb[2] * 0.62) + ')';
      const light = 'rgb(' + Math.min(255, Math.round(rgb[0] * 1.08 + 8)) + ',' + Math.min(255, Math.round(rgb[1] * 1.08 + 8)) + ',' + Math.min(255, Math.round(rgb[2] * 1.08 + 8)) + ')';
      fillWorldRect(it.px, it.py, w, h, dark);
      fillWorldRect(it.px + 1, it.py + 1, w - 2, h - 2, col);
      fillWorldRect(it.px + 1, it.py + 1, w - 2, 3, light);
      fillWorldRect(it.px + 1, it.py + h - 3, w - 2, 2, 'rgba(0,0,0,0.12)');
      const label = def.label || def.name;
      if (label) drawPixelText(ctx, label, it.px + Math.floor((w - pixelTextWidth(label)) / 2), it.py + Math.floor(h / 2) - 2, dark, s, V.ox, V.oy);
    }
    ctx.globalAlpha = 1;
    if (flash) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(sxOf(it.px), syOf(it.py), w * s, h * s); }
    if (st.building) {
      const frac = clamp(st.progress / st.buildSeconds, 0, 1);
      fillWorldRect(it.px + 2, it.py + h - 4, w - 4, 2, 'rgba(47,44,54,0.8)');
      fillWorldRect(it.px + 2, it.py + h - 4, Math.round((w - 4) * frac), 2, '#ffe08a');
    } else if (st.hearts < st.maxHearts && st.type !== 'kingdom_chest') {
      const frac = clamp(st.hearts / st.maxHearts, 0, 1);
      fillWorldRect(it.px + 2, it.py - 3, w - 4, 2, 'rgba(47,44,54,0.8)');
      fillWorldRect(it.px + 2, it.py - 3, Math.max(1, Math.round((w - 4) * frac)), 2, K.C('bar.hearts', '#ff9fb4'));
    }
  }

  const TOMB = ['..####..', '.######.', '.##..##.', '.######.', '.##..##.', '.######.', '.######.', '.######.'];
  function drawTomb(W, it, t) {
    const tb = it.ref;
    const fadeSecs = K.anim('tombstone_fade').period || 3;
    const alpha = t > tb.until ? clamp(1 - (t - tb.until) / fadeSecs, 0, 1) : 1;
    ctx.globalAlpha = alpha;
    const x0 = it.px + 4, y0 = it.py + 6;
    for (let r = 0; r < TOMB.length; r++) for (let c = 0; c < 8; c++) {
      const ch = TOMB[r][c];
      if (ch === '#') fillWorldRect(x0 + c, y0 + r, 1, 1, r === 0 || c === 0 || c === 7 ? '#8d8699' : '#c9c3d4');
      else if (ch === '.' && r >= 2 && r <= 4 && c >= 2 && c <= 5) fillWorldRect(x0 + c, y0 + r, 1, 1, '#a39cb0');
    }
    ctx.globalAlpha = 1;
  }

  function drawUnit(W, it, t) {
    const u = it.ref, s = V.S;
    const sp = spriteFor(u);
    let img = sp.img;
    let extra = 0, crop = 0, py = it.py, px = it.px;
    const adult = K.sim.isAdult(W, u);
    if (!adult) crop = 3;
    if (u.lying) {
      img = rotatedCanvas(img, sp.key + (crop ? 'k' : ''));
      const an = K.anim(u.fainted ? 'faint' : 'sleep');
      // lying flat: shifted down so it rests on the ground
      blit(img, px, py + 16, { flip: u.face < 0, crop: 0, extra: u.fainted ? 0 : Math.round(an.stretch * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 / an.period + u.phase))) });
      if (u.sleeping) drawZ(px + 10, py - 2 + 0, t, u);
    } else {
      let lift = it.lift || 0;
      const talk = u.talkUntil && t < u.talkUntil;
      if (u.cheerUntil && t < u.cheerUntil) {
        const an = K.anim('cheer');
        lift = Math.round(an.height * Math.abs(Math.sin(t * Math.PI * 2 / an.period)));
      } else if (u.act === 'work' && !u.hop) {
        lift = Math.round(2 * Math.max(0, Math.sin(t * 9 + u.phase)));
      } else if (u.act === 'perform' && !u.hop) {
        lift = Math.round(2 * Math.abs(Math.sin(t * 5 + u.phase)));
      }
      if (!u.hop) {
        if (talk) { const an = K.anim('talk'); extra = Math.floor((t * 2 / an.period + u.phase) % 2) ? 0 : an.stretch; }
        else { const an = K.anim('breathe'); extra = Math.round(an.stretch * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 / an.period + u.phase))); }
      }
      blit(img, px, py + 16 - lift, { flip: u.face < 0, extra, crop });
      if (u.flashT && t - u.flashT < 0.14) blit(silhouette(img, sp.key, 'rgba(255,255,255,0.7)'), px, py + 16 - lift, { flip: u.face < 0, extra, crop });
    }
    // status marks and hearts
    if (u.status === 'burn') drawFlame(px + 6, py - 2, t);
    if (u.status === 'poison') drawDrops(px + 6, py - 2, t);
    const mh = K.sim.maxHearts(u);
    if (u.hearts < mh - 0.01 && !u.lying) {
      fillWorldRect(px + 2, py - 1, 12, 2, 'rgba(47,44,54,0.8)');
      fillWorldRect(px + 2, py - 1, Math.max(1, Math.round(12 * clamp(u.hearts / mh, 0, 1))), 2, K.C('bar.hearts', '#ff9fb4'));
    }
  }
  function drawCreature(W, it, t) {
    const c = it.ref;
    const img = images[c.def.sprite] || images.slime;
    const bob = c.flies ? Math.round(Math.sin(t * 9 + c.phase) * 1.4) - 4 : 0;
    const lift = c.flies ? 0 : (it.lift || 0);
    const an = K.anim('breathe');
    const extra = c.hop ? 0 : Math.round(an.stretch * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 / an.period + c.phase)));
    blit(img, it.px, it.py + 16 - lift + bob, { flip: c.face < 0, extra });
    if (c.flashT && t - c.flashT < 0.14) blit(silhouette(img, c.def.sprite, 'rgba(255,255,255,0.7)'), it.px, it.py + 16 - lift + bob, { flip: c.face < 0, extra });
    if (c.hearts < c.maxHearts - 0.01) {
      fillWorldRect(it.px + 2, it.py - 1 + bob, 12, 2, 'rgba(47,44,54,0.8)');
      fillWorldRect(it.px + 2, it.py - 1 + bob, Math.max(1, Math.round(12 * clamp(c.hearts / c.maxHearts, 0, 1))), 2, K.C('bar.hearts', '#ff9fb4'));
    }
  }

  const FLAME = ['..#..', '.##.#', '.###.', '#####', '.###.'];
  function drawFlame(wx, wy, t) {
    const fr = Math.floor(t * 8) % 2;
    for (let r = 0; r < FLAME.length; r++) for (let c = 0; c < 5; c++) if (FLAME[r][c] === '#') fillWorldRect(wx + c - (fr && r < 2 ? 1 : 0), wy - 4 + r, 1, 1, r > 2 ? '#ffd27a' : K.C('icon.status.burn', '#ff9c7a'));
  }
  function drawDrops(wx, wy, t) {
    const col = K.C('icon.status.poison', '#b7e07a');
    for (let i = 0; i < 3; i++) { const yy = wy - 1 - ((Math.floor(t * 4) + i * 2) % 5); fillWorldRect(wx + i * 2, yy, 1, 2, col); }
  }
  function drawZ(wx, wy, t, u) {
    const col = K.C('icon.status.sleep', '#b9c4ff');
    const k = Math.floor(t * 1.2 + u.phase) % 3;
    for (let i = 0; i <= k; i++) drawPixelText(ctx, 'Z', wx + i * 3, wy - i * 4 - 3, col, V.S, V.ox, V.oy);
  }
  function drawBrackets(px, py, strong) {
    const col = strong ? '#ffffff' : 'rgba(255,255,255,0.75)';
    const x0 = px - 1, y0 = py - 1, x1 = px + 16, y1 = py + 16;
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      fillWorldRect(Math.min(x, x + dx * 3), y, 4, 1, col); fillWorldRect(x, Math.min(y, y + dy * 3), 1, 4, col);
    }
  }
  function drawBracketsRect(px, py, w, h, strong) {
    const col = strong ? '#ffffff' : 'rgba(255,255,255,0.75)';
    const x0 = px - 1, y0 = py - 1, x1 = px + w, y1 = py + h;
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      fillWorldRect(Math.min(x, x + dx * 4), y, 5, 1, col); fillWorldRect(x, Math.min(y, y + dy * 4), 1, 5, col);
    }
  }
  function drawShot(it) {
    const u = it.ref, sh = u.shot;
    const x0 = it.px + 8, y0 = it.py + 6, x1 = sh.x * TILE + 8, y1 = sh.y * TILE + 8;
    const col = sh.job === 'archer' ? '#e8c9a0' : sh.job === 'mage' ? '#ffb27a' : sh.job === 'witch' ? '#b7e07a' : sh.job === 'heal' ? '#ff9fb4' : '#ffffff';
    const n = Math.max(2, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 4));
    for (let i = 1; i < n; i++) {
      const k = i / n;
      if (sh.job === 'archer' || (i + Math.floor(u.shot.t * 20)) % 2 === 0) fillWorldRect(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), 1, 1, col);
    }
  }

  // ------------------------------------------------------------------ texts
  function wrap(text, maxChars) {
    const words = text.split(' '); const lines = []; let cur = '';
    for (const w of words) {
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
  R.charEvents = [];
  function drawTexts(W, t) {
    const s = V.S;
    const namePx = Math.max(S('render.nameFontMinPx', 9), Math.round(S('render.nameFontWorldPx', 5.5) * s));
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const selId = R.selected && R.selected.id, hovId = R.hover && R.hover.id;
    const outline = K.C('ui.nameOutline', '#2a2433');
    const bubbles = [];
    for (const it of items) {
      if (it.k === 'struct' && it.ref.type === 'castle') {
        const k = W.kingdoms.get(it.ref.kingdom);
        if (k) {
          ctx.font = '700 ' + Math.round(namePx * 1.15) + 'px Lexend, system-ui, sans-serif';
          outlinedText(k.name, sxOf(it.px + it.ref.w * 8), syOf(it.py - 5), K.C('name.pastel.' + k.hue, '#ffe08a'), outline, Math.max(2, s * 0.9));
        }
        continue;
      }
      if (it.k !== 'unit' && it.k !== 'creature') continue;
      const e = it.ref;
      const lift = it.lift || 0;
      let top = it.py + (e.kind === 'unit' && !K.sim.isAdult(W, e) ? 3 : 0) - lift - (e.flies ? 6 : 0);
      if (e.lying) top += 8;
      const cx = sxOf(it.px + 8);
      let nameY = syOf(top - 3);
      if (e.kind === 'unit') {
        const show = s >= 3 || (s === 2 && (e.job === 'king' || e.id === selId || e.id === hovId)) || e.id === selId || e.id === hovId;
        if (show) {
          ctx.font = '700 ' + namePx + 'px Lexend, system-ui, sans-serif';
          const kingMark = e.job === 'king' ? '♕ ' : '';
          outlinedText(kingMark + e.name, cx, nameY, K.C('name.pastel.' + e.color, '#ffffff'), outline, Math.max(2, s * 0.8));
          nameY -= Math.round(namePx * 1.05);
        }
      } else if (e.id === selId || e.id === hovId) {
        ctx.font = '700 ' + namePx + 'px Lexend, system-ui, sans-serif';
        outlinedText(e.def.id[0].toUpperCase() + e.def.id.slice(1), cx, nameY, '#ffffff', outline, Math.max(2, s * 0.8));
        nameY -= Math.round(namePx * 1.05);
      }
      if (e.bubble && t - e.bubble.t0 < e.bubble.dur) bubbles.push({ e, cx, y: nameY });
    }
    // speech bubbles typed out letter by letter
    const bpx = Math.max(10, Math.round(3.4 * s));
    ctx.font = '400 ' + bpx + 'px Lexend, system-ui, sans-serif';
    for (const b of bubbles) {
      const bub = b.e.bubble;
      if (!bub.lines) bub.lines = wrap(bub.text, 22);
      const total = bub.text.length;
      const shown = Math.min(total, Math.floor((t - bub.t0) * S('bubble.charsPerSecond', 28)) + 1);
      if (shown !== bub.shown) { if (R.onChars) R.onChars(b.e, bub.shown || 0, shown); bub.shown = shown; }
      let wmax = 0;
      for (const l of bub.lines) wmax = Math.max(wmax, ctx.measureText(l).width);
      const pad = Math.round(bpx * 0.5), lh = Math.round(bpx * 1.25);
      const bw = Math.ceil(wmax + pad * 2), bh = bub.lines.length * lh + pad;
      let bx = Math.round(b.cx - bw / 2), by = Math.round(b.y - bh - Math.round(bpx * 0.5));
      bx = clamp(bx, 4, V.w - bw - 4);
      ctx.fillStyle = K.C('ui.bubble', '#ffffff'); ctx.strokeStyle = 'rgba(47,44,54,0.35)'; ctx.lineWidth = Math.max(1, Math.round(s * 0.5));
      roundedRect(bx, by, bw, bh, Math.round(bpx * 0.55)); ctx.fill(); ctx.stroke();
      // little tail
      ctx.beginPath(); ctx.moveTo(b.cx - bpx * 0.3, by + bh - 1); ctx.lineTo(b.cx + bpx * 0.3, by + bh - 1); ctx.lineTo(b.cx, by + bh + bpx * 0.45); ctx.closePath(); ctx.fill();
      ctx.fillStyle = K.C('ui.bubbleText', '#2f2c36'); ctx.textAlign = 'left';
      let left = shown;
      for (let i = 0; i < bub.lines.length; i++) {
        const l = bub.lines[i];
        const part = l.slice(0, Math.max(0, left));
        left -= l.length + 1;
        if (part) ctx.fillText(part, bx + pad, by + pad * 0.5 + lh * (i + 0.85));
        if (left <= 0) break;
      }
      ctx.textAlign = 'center';
    }
  }

  // ------------------------------------------------------------------ picking (what is under the cursor?)
  R._items = () => items;
  R.pick = function (sx, sy) {
    const s = V.S;
    const wx = (sx - V.ox) / s, wy = (sy - V.oy) / s;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.k === 'unit' || it.k === 'creature') {
        const e = it.ref;
        const top = it.py - (it.lift || 0) - (e.flies ? 6 : 0);
        if (wx >= it.px && wx < it.px + 16 && wy >= top && wy < top + 16) return { type: e.kind, id: e.id };
      } else if (it.k === 'struct') {
        const st = it.ref;
        if (wx >= it.px && wx < it.px + st.w * TILE && wy >= it.py && wy < it.py + st.h * TILE) return { type: 'structure', id: st.id };
      } else if (it.k === 'tomb') {
        if (wx >= it.px + 3 && wx < it.px + 13 && wy >= it.py + 5 && wy < it.py + 15) return { type: 'tomb', ref: it.ref };
      }
    }
    return null;
  };
})();
