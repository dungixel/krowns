// Krowns - drawing. EVERY pixel of the game is the same size: sprites are 16x16 and are only ever drawn at a whole-number
// zoom (1x, 2x, 3x ... device pixels per game pixel) with image smoothing off. Positions and animations are NOT snapped to the
// pixel grid: everything glides and stretches smoothly, each sprite is treated like a normal picture.
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
    const names = ['archer', 'axeman', 'bard', 'base', 'bandit', 'bat', 'blacksmith', 'chest', 'farmer', 'joker', 'king', 'knight', 'mage', 'merchant', 'pig', 'prince', 'rat', 'slime', 'snake', 'spearman', 'tree', 'witch'];
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
  R.frac = 0;           // simulated seconds that have passed since the last simulation step (for smooth motion between steps)
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
  // zoom glides to the next whole-number step (pixels are all the same size once it rests)
  R.zoomStep = function (dir, ax, ay) {
    const steps = zoomSteps(), v = R.view;
    const cur = R.zoomAnim ? R.zoomAnim.target : v.S;
    let i = 0, bd = 1e9;
    steps.forEach((x, k) => { const d = Math.abs(x - cur); if (d < bd) { bd = d; i = k; } });
    i = clamp(i + dir, 0, steps.length - 1);
    const axx = ax === undefined ? v.w / 2 : ax, ayy = ay === undefined ? v.h / 2 : ay;
    R.zoomAnim = { target: steps[i], ax: axx, ay: ayy, wx: (axx - v.ox) / v.S, wy: (ayy - v.oy) / v.S };
  };
  function advanceZoom(dt) {
    const z = R.zoomAnim, v = R.view;
    if (!z) return;
    let S1 = v.S + (z.target - v.S) * (1 - Math.exp(-dt * 11));
    if (Math.abs(S1 - z.target) < 0.01) { S1 = z.target; R.zoomAnim = null; }
    v.S = S1;
    v.cx = z.wx - (z.ax - v.w / 2) / S1; v.cy = z.wy - (z.ay - v.h / 2) / S1;
    clampCamera();
  }
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
  // `extra` (any fractional number) stretches the middle row, so the sprite grows smoothly upward; `crop` cuts rows off the top.
  // the row that stretches when a unit breathes: the chest/belly (about two thirds down the drawing), never the face
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
  function blit(img, wx, wyBottom, o) {
    o = o || {};
    const s = V.S, iw = img.width, ih = img.height;
    const crop = o.crop || 0, extra = o.extra || 0;
    const rows = ih - crop;
    const totalH = rows + extra;
    const dx = sxOf(wx), top = syOf(wyBottom - totalH);
    if (o.alpha !== undefined && o.alpha !== 1) ctx.globalAlpha = o.alpha;
    if (o.flip) { ctx.save(); ctx.translate(dx + iw * s, 0); ctx.scale(-1, 1); }
    const x0 = o.flip ? 0 : dx;
    if (Math.abs(extra) < 0.002) ctx.drawImage(img, 0, crop, iw, rows, x0, Math.round(top), iw * s, Math.round(top + rows * s) - Math.round(top));
    else {
      const m = Math.max(crop, Math.min(ih - 2, chestRow(img)));
      const topRows = m - crop;
      const y0 = Math.round(top), y1 = Math.round(top + topRows * s), y2 = Math.round(top + (topRows + 1 + extra) * s), y3 = Math.round(top + totalH * s);
      if (topRows > 0 && y1 > y0) ctx.drawImage(img, 0, crop, iw, topRows, x0, y0, iw * s, y1 - y0);
      if (y2 > y1) ctx.drawImage(img, 0, m, iw, 1, x0, y1, iw * s, y2 - y1);
      const botRows = ih - m - 1;
      if (botRows > 0 && y3 > y2) ctx.drawImage(img, 0, m + 1, iw, botRows, x0, y2, iw * s, y3 - y2);
    }
    if (o.flip) ctx.restore();
    if (o.alpha !== undefined && o.alpha !== 1) ctx.globalAlpha = 1;
  }
  // like blit, but the whole picture leans sideways (the top moves by `lean` game pixels): trees in the wind
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
  function fillWorldRect(wx, wy, w, h, color) { ctx.fillStyle = color; ctx.fillRect(sxOf(wx), syOf(wy), w * V.S, h * V.S); }

  // ------------------------------------------------------------------ shadows: cast away from the sun, never turning with the unit
  let sun = { lean: 0, len: 0.4, alpha: 1 };
  function updateSun(hour) {
    const rise = 6.5, set = 19.5;
    const t = clamp((hour - rise) / (set - rise), 0, 1);
    const f = (t - 0.5) * 2;                         // -1 sun in the east (morning), 0 noon, +1 sun in the west (evening)
    const up = clamp(Math.min((hour - 5.5) / 1.5, (20.5 - hour) / 1.5), 0, 1);
    const night = S('shadow.nightOpacity', 0.35);
    sun = { lean: f * S('shadow.lean', 0.9), len: S('shadow.length', 0.4) * (0.65 + 0.7 * Math.abs(f)), alpha: night + (1 - night) * up };
  }
  // the picture's silhouette is laid flat on the ground, leaning away from the sun. (baseX, baseY) = the feet, in world pixels.
  function castShadow(img, key, baseX, baseY, o) {
    o = o || {};
    const sil = silhouette(img, key, K.C('shadow.purple', '#957fae'));
    const iw = img.width, ih = img.height - (o.crop || 0);
    const ax = o.ax !== undefined ? o.ax : sun.lean, ay = o.ay !== undefined ? o.ay : sun.len * (o.len || 1);   // where the top of the picture falls, per pixel of height
    ctx.save();
    ctx.setTransform(V.S, 0, 0, V.S, V.ox, V.oy);
    ctx.transform(1, 0, -ax, -ay, baseX - iw / 2 + ax * ih, baseY + ay * ih);
    if (o.flip) { ctx.translate(iw, 0); ctx.scale(-1, 1); }
    ctx.drawImage(sil, 0, o.crop || 0, iw, ih, 0, 0, iw, ih);
    ctx.restore();
  }
  // things near a lit torch cast their shadow straight away from the torch; the sun's shadow fades out under the torch light
  let torchList = [], torchDark = 0;
  function casterShadow(img, key, baseX, baseY, o) {
    o = o || {};
    let near = null, nd = 1e9;
    if (torchDark > 0.02) {
      const R = S('torch.lightRadiusTiles', 4.5) * TILE;
      for (const t of torchList) { const d = Math.hypot(baseX - t.x, baseY - t.y); if (d < nd && d < R) { nd = d; near = t; } }
      if (near) {
        const R2 = S('torch.lightRadiusTiles', 4.5) * TILE, infl = clamp(1 - nd / R2, 0, 1) * torchDark;
        const d = Math.max(4, nd), ux = (baseX - near.x) / d, uy = (baseY - near.y) / d, len = S('torch.shadowLength', 0.7) * (o.len || 1);
        const base = ctx.globalAlpha;
        ctx.globalAlpha = base / Math.max(0.01, sun.alpha) * sun.alpha * (1 - infl);
        castShadow(img, key, baseX, baseY, o);
        ctx.globalAlpha = K.C('shadow.opacity', 1) * infl;
        castShadow(img, key, baseX, baseY, Object.assign({}, o, { ax: ux * len, ay: uy * len * 0.75 }));
        ctx.globalAlpha = base;
        return;
      }
    }
    castShadow(img, key, baseX, baseY, o);
  }
  function castBox(wx, wyBottom, w, h) {
    // a flat building: a parallelogram leaning away from the sun
    const hh = h * sun.len * 0.9, dx = sun.lean * h * 0.8;
    ctx.beginPath();
    ctx.moveTo(sxOf(wx), syOf(wyBottom)); ctx.lineTo(sxOf(wx + w), syOf(wyBottom));
    ctx.lineTo(sxOf(wx + w + dx), syOf(wyBottom + hh)); ctx.lineTo(sxOf(wx + dx), syOf(wyBottom + hh));
    ctx.closePath(); ctx.fill();
  }

  // ------------------------------------------------------------------ grass
  function grassPeriod(r) { const an = K.anim('grass_sway'); return an.extra.periodMin + r * (an.extra.periodMax - an.extra.periodMin); }
  function advanceGrass(g, dt) {
    const an = K.anim('grass_sway');
    g.phase += (Math.PI * 2 / g.period) * dt;
    if (g.phase > Math.PI * 2) {
      g.phase -= Math.PI * 2; g.cycles++;
      if (g.cycles >= (an.extra.cyclesBeforeSpeedChange || 3)) { g.cycles = 0; g.period = an.extra.periodMin + Math.random() * (an.extra.periodMax - an.extra.periodMin); }
    }
  }
  function grassExtra(g) { const an = K.anim('grass_sway'); return an.stretch * (0.5 + 0.5 * Math.sin(g.phase)); }

  function ensureEdgeTufts(W) {
    if (R.edgeVersion === W.kmapVersion && R.edgeW === W) return;
    R.edgeVersion = W.kmapVersion; R.edgeW = W;
    const arr = [];
    for (const e of W.edges || []) {
      for (let j = 0; j < 4; j++) {
        const h = ((e.x * 73856093) ^ (e.y * 19349663) ^ (j * 83492791)) >>> 0;
        arr.push({ x: e.x, y: e.y, ox: (h % 11) - 3, oy: ((h >> 8) % 11) - 3, phase: ((h >> 3) % 628) / 100, period: grassPeriod(((h >> 5) % 100) / 100), cycles: 0 });
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

  const FEET = 8;   // units stand with their feet half a tile lower than their tile, so they can walk behind the upper half of trees and structures
  function entityPos(W, e, t) {
    let px = e.x * TILE, py = e.y * TILE, lift = 0, p = 0;
    if (e.hop) {
      p = clamp((e.hop.t + R.frac) / e.hop.dur, 0, 1);
      px = e.hop.fx * TILE + (e.x - e.hop.fx) * TILE * p;
      py = e.hop.fy * TILE + (e.y - e.hop.fy) * TILE * p;
      if (!e.flies) lift = S('unit.hopHeightPx', 2) * Math.sin(Math.PI * p);
    }
    return { px, py: py + FEET, lift, p };
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
    advanceZoom(dt);
    // follow the selected unit (or the knight you walk with)
    if (R.walkId || (R.follow && R.selected && (R.selected.type === 'unit' || R.selected.type === 'creature'))) {
      const u = W.byId.get(R.walkId || R.selected.id);
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

    // ---- 2. grass tufts (green everywhere, purple on kingdom borders): they stand in the same layer as trees, units and buildings
    const gd = images.grassDetail, pg = cache.purpleGrass;
    const vx0 = wx0 - 16, vx1 = wx1 + 16, vy0 = wy0 - 16, vy1 = wy1 + 16;
    items = [];
    for (const g of W.grass) {
      const px = g.x * TILE + 3 + g.ox, py = g.y * TILE + 3 + g.oy;
      if (px < vx0 || px > vx1 || py < vy0 || py > vy1) continue;
      advanceGrass(g, dt);
      items.push({ k: 'grass', y: py + 10, px, py, img: gd, ref: g });
    }
    ensureEdgeTufts(W);
    for (const g of R.edgeTufts) {
      const px = g.x * TILE + 3 + g.ox, py = g.y * TILE + 4 + g.oy;
      if (px < vx0 || px > vx1 || py < vy0 || py > vy1) continue;
      advanceGrass(g, dt);
      items.push({ k: 'grass', y: py + 10, px, py, img: pg, ref: g });
    }

    // ---- 3. collect what stands on the ground, in drawing order (lowest on the screen is drawn last)
    const t = W.t + R.frac;
    R.time = t;
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
      items.push({ k: 'unit', y: p.py + 16 + 0.1, ref: u, px: p.px, py: p.py, lift: p.lift, p: p.p });
    }
    for (const c of W.creatures) {
      if (c.dead) continue;
      const p = entityPos(W, c, t);
      if (!inView(p.px, p.py, 16, 16)) continue;
      items.push({ k: 'creature', y: p.py + 16 + (c.flies ? 40 : 0.1), ref: c, px: p.px, py: p.py, lift: p.lift, p: p.p });
    }
    items.sort((a, b) => a.y - b.y);

    // ---- 4. shadows (multiply, desaturated purple), cast away from the sun; all before the things that cast them
    const clock = R.fixedHour !== undefined ? { hour: R.fixedHour } : K.sim.clockAt(W.t + R.frac);
    updateSun(clock.hour);
    {
      const lc0 = lightColor(clock.hour);
      torchDark = clamp(1 - (lc0[0] * 0.3 + lc0[1] * 0.4 + lc0[2] * 0.3) / 255, 0, 1);
      torchDark = clamp(torchDark * 1.6, 0, 1);
      torchList = [];
      for (const it of items) if (it.k === 'struct' && it.ref.type === 'torch' && !it.ref.building) torchList.push({ x: it.px + 8, y: it.py + 14 });
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = K.C('shadow.purple', '#957fae');
    ctx.globalAlpha = K.C('shadow.opacity', 1) * sun.alpha;
    for (const it of items) {
      if (it.k === 'tree') casterShadow(images.tree, 'tree', it.px + 8, it.py + 15.5, { flip: treeFlip(it.ref), len: 0.9 });
      else if (it.k === 'tomb') castBox(it.px + 4, it.py + 14, 8, 6);
      else if (it.k === 'unit') { const u = it.ref; const sp = spriteFor(u); const lying = u.lying; casterShadow(lying ? rotatedCanvas(sp.img, sp.key) : sp.img, lying ? 'r' + sp.key : sp.key, it.px + 8, it.py + 15.5, { flip: u.face < 0, crop: K.sim.isAdult(W, u) ? 0 : 3, len: lying ? 0.7 : 1 }); }
      else if (it.k === 'creature') { const c = it.ref; const img = images[c.def.sprite] || images.slime; casterShadow(img, c.def.sprite, it.px + 8, it.py + 15.5 + (c.flies ? 3 : 0), { flip: faceFlip(c), len: c.flies ? 0.7 : 1 }); }
      else if (it.k === 'struct') {
        const st = it.ref, def = K.struct(st.type);
        if (st.type === 'torch') castBox(it.px + 7, it.py + 15, 2, 9);
        else if (def.sprite && images[def.sprite]) casterShadow(images[def.sprite], def.sprite, it.px + st.w * 8, it.py + st.h * TILE - 0.5, {});
        else castBox(it.px + 1, it.py + st.h * TILE - 1, st.w * TILE - 2, st.type === 'wall' ? 8 : st.h * TILE * 0.8);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // ---- 5. the things themselves
    const hoverId = R.hover && R.hover.id, selId = R.selected && R.selected.id;
    for (const it of items) {
      if (it.k === 'grass') blit(it.img, it.px, it.py + 10, { extra: grassExtra(it.ref) });
      else if (it.k === 'tree') drawTree(W, it, dt);
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

    // ---- 6. day and night: the whole scene is multiplied by a light map. The map is the colour of the hour (night blue...), and torches
    //         ADD warm light to it, so near a torch the scene shows its real colours again (shadows keep their own colour).
    const lc = lightColor(clock.hour);
    const dark = clamp(1 - (lc[0] * 0.3 + lc[1] * 0.4 + lc[2] * 0.3) / 255, 0, 1);
    const lit = dark > 0.05 ? torchList.length : 0;
    if (lit) {
      if (!R.lightCv) R.lightCv = mkCanvas(v.w, v.h);
      const lcv = R.lightCv; if (lcv.width !== v.w || lcv.height !== v.h) { lcv.width = v.w; lcv.height = v.h; }
      const lg = lcv.getContext('2d');
      lg.globalCompositeOperation = 'source-over'; lg.fillStyle = 'rgb(' + lc[0] + ',' + lc[1] + ',' + lc[2] + ')'; lg.fillRect(0, 0, lcv.width, lcv.height);
      lg.globalCompositeOperation = 'lighter';                         // "add"
      const rad = S('torch.lightRadiusTiles', 4.5) * TILE, strength = clamp(S('torch.glowStrength', 0.7) / 0.7, 0, 2) * Math.min(1, dark * 1.6);
      for (const it of items) {
        if (it.k !== 'struct' || it.ref.type !== 'torch' || it.ref.building) continue;
        const fl = 1 + 0.04 * Math.sin(t * 9 + it.ref.id) + 0.025 * Math.sin(t * 23 + it.ref.id * 2);
        const cx = sxOf(it.px + 8), cy = syOf(it.py + 9), r = rad * fl * s;
        if (cx + r < 0 || cy + r < 0 || cx - r > v.w || cy - r > v.h) continue;
        const gr = lg.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, 'rgba(255,208,150,' + Math.min(1, 1.05 * strength) + ')'); gr.addColorStop(0.35, 'rgba(255,196,134,' + Math.min(1, 0.7 * strength) + ')');
        gr.addColorStop(0.7, 'rgba(250,182,118,' + Math.min(1, 0.3 * strength) + ')'); gr.addColorStop(1, 'rgba(245,172,105,0)');
        lg.fillStyle = gr; lg.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(lcv, 0, 0); ctx.globalCompositeOperation = 'source-over';
    } else if (lc[0] < 255 || lc[1] < 255 || lc[2] < 255) {
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
    const an2 = K.anim('tree_sway');
    const h = ((tr.x * 73856093) ^ (tr.y * 19349663)) >>> 0;
    const period = (an2.extra.periodMin || 2.5) + ((h % 100) / 100) * ((an2.extra.periodMax || 5.5) - (an2.extra.periodMin || 2.5));
    const lean = an2.stretch * (Math.sin(R.time * Math.PI * 2 / period + (h % 628) / 100) * 0.8 + 0.2 * Math.sin(R.time * 1.7 + (h >> 4) % 7));
    blitLean(images.tree, it.px, it.py + 16, { alpha: tr.fade, flip: treeFlip(tr), lean });
  }
  const treeFlip = (tr) => ((tr.x * 7 + tr.y * 3) & 1) === 1;
  const faceFlip = (c) => (c.def && c.def.facesLeft ? c.face > 0 : c.face < 0);

  function drawStructure(W, it, t) {
    const st = it.ref, def = K.struct(st.type), s = V.S;
    const w = st.w * TILE, h = st.h * TILE;
    const flash = st.hurtAt && t - st.hurtAt < 0.15;
    // fade a little when somebody walks behind the upper part of it
    let behind = false;
    if (st.type !== 'torch' && st.type !== 'wall' && st.type !== 'kingdom_chest') {
      for (let yy = st.y - 1; yy < st.y + (st.walkRows || 0) && !behind; yy++) for (let xx = st.x - 1; xx <= st.x + st.w && !behind; xx++) {
        if (yy < 0 || xx < 0 || xx >= W.w || yy >= W.h) continue;
        if (W.unitAt[yy * W.w + xx]) behind = true;
      }
    }
    st.fade = st.fade === undefined ? 1 : st.fade;
    const fr = frameDt / Math.max(0.01, S('tree.fadeSeconds', 0.25));
    st.fade += clamp((behind ? S('tree.fadeOpacity', 0.5) : 1) - st.fade, -fr, fr);
    const alpha = (st.building ? 0.55 : 1) * st.fade;
    ctx.globalAlpha = alpha;
    if (st.type === 'torch') {
      drawTorch(it, t);
    } else if (st.type === 'wall') {
      // placeholder wall: a stone block (no artwork yet)
      const col = def.color || '#b9b6c2', rgb = hexToRgb(col);
      const dark = 'rgb(' + Math.round(rgb[0] * 0.6) + ',' + Math.round(rgb[1] * 0.6) + ',' + Math.round(rgb[2] * 0.6) + ')';
      fillWorldRect(it.px + 1, it.py + 5, 14, 11, dark);
      fillWorldRect(it.px + 2, it.py + 5, 12, 9, col);
      fillWorldRect(it.px + 2, it.py + 5, 12, 2, 'rgba(255,255,255,0.35)');
      fillWorldRect(it.px + 2, it.py + 10, 12, 1, 'rgba(0,0,0,0.12)');
      fillWorldRect(it.px + 7, it.py + 7, 1, 3, 'rgba(0,0,0,0.12)');
    } else if (def.sprite && images[def.sprite]) {
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

  // placeholder torch: a wooden pole with a flickering flame (no artwork yet)
  function drawTorch(it, t) {
    const x = it.px, y = it.py, id = it.ref.id;
    fillWorldRect(x + 7, y + 7, 2, 9, '#6b4423');
    fillWorldRect(x + 7, y + 7, 1, 9, '#8a5a2b');
    fillWorldRect(x + 6, y + 6, 4, 2, '#4a3019');
    const f1 = Math.sin(t * 11 + id) * 0.5 + 0.5, f2 = Math.sin(t * 17 + id * 3) * 0.5 + 0.5;
    const h = 4 + f1 * 1.6, w = 3 + f2 * 0.8;
    fillWorldRect(x + 8 - w / 2, y + 6 - h, w, h, '#ff9a3c');
    fillWorldRect(x + 8 - w / 4, y + 6 - h * 0.65, w / 2, h * 0.65, '#ffd36a');
    fillWorldRect(x + 7.4, y + 6 - h * 0.35, 1.2, h * 0.35, '#fff3b0');
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

  const wave = (t, period, phase) => 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / period + (phase || 0));
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
      blit(img, px, py + 16, { flip: u.face < 0, crop: 0, extra: u.fainted ? 0 : an.stretch * wave(t, an.period, u.phase) });
      if (u.sleeping) drawZ(px + 10, py - 2 + 0, t, u);
    } else {
      let lift = it.lift || 0;
      const talk = u.talkUntil && t < u.talkUntil;
      if (u.cheerUntil && t < u.cheerUntil) {
        const an = K.anim('cheer');
        lift = an.height * Math.abs(Math.sin(t * Math.PI * 2 / an.period));
      } else if (u.act === 'work' && !u.hop) {
        lift = 2 * Math.max(0, Math.sin(t * 9 + u.phase));
      } else if (u.act === 'perform' && !u.hop) {
        lift = 2 * Math.abs(Math.sin(t * 5 + u.phase));
      }
      if (u.hop) { const an = K.anim('hop'); extra = an.stretch * Math.sin(Math.PI * it.p); }
      else if (talk) { const an = K.anim('talk'); extra = an.stretch * wave(t, an.period, u.phase); }
      else { const an = K.anim('breathe'); extra = an.stretch * wave(t, an.period, u.phase); }
      blit(img, px, py + 16 - lift, { flip: u.face < 0, extra, crop });
      if (u.flashT && t - u.flashT < 0.14) blit(silhouette(img, sp.key, 'rgba(255,255,255,0.7)'), px, py + 16 - lift, { flip: u.face < 0, extra, crop });
    }
    // status marks and hearts
    if (u.status === 'burn') drawFlame(px + 6, py - 2, t);
    if (u.status === 'poison') drawDrops(px + 6, py - 2, t);
    const mh = K.sim.maxHearts(u);
    if (u.hearts < mh - 0.01 && !u.lying) {
      fillWorldRect(px + 2, py - 1, 12, 2, 'rgba(47,44,54,0.8)');
      fillWorldRect(px + 2, py - 1, Math.max(1, 12 * clamp(u.hearts / mh, 0, 1)), 2, K.C('bar.hearts', '#ff9fb4'));
    }
  }
  function drawCreature(W, it, t) {
    const c = it.ref;
    const img = images[c.def.sprite] || images.slime;
    const bob = c.flies ? Math.sin(t * 9 + c.phase) * 1.4 - 4 : 0;
    const lift = c.flies ? 0 : (it.lift || 0);
    const an = K.anim(c.hop ? 'hop' : 'breathe');
    const extra = c.hop ? an.stretch * Math.sin(Math.PI * it.p) : an.stretch * wave(t, an.period, c.phase);
    const flip = faceFlip(c);
    blit(img, it.px, it.py + 16 - lift + bob, { flip, extra });
    if (c.flashT && t - c.flashT < 0.14) blit(silhouette(img, c.def.sprite, 'rgba(255,255,255,0.7)'), it.px, it.py + 16 - lift + bob, { flip, extra });
    if (c.hearts < c.maxHearts - 0.01) {
      fillWorldRect(it.px + 2, it.py - 1 + bob, 12, 2, 'rgba(47,44,54,0.8)');
      fillWorldRect(it.px + 2, it.py - 1 + bob, Math.max(1, 12 * clamp(c.hearts / c.maxHearts, 0, 1)), 2, K.C('bar.hearts', '#ff9fb4'));
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
        const show = !W.walk && (s >= 3 || (s === 2 && (e.job === 'king' || e.id === selId || e.id === hovId)) || e.id === selId || e.id === hovId);
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
