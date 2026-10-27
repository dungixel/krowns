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
    await Promise.all(['knight', 'base', 'farmer', 'slime', 'tree'].map(async (n) => { images[n] = await loadImage('assets/sprites/' + n + '.png' + v); }));
    images.grassDetail = darken(await loadImage('assets/world/grass-detail.png' + v), S('grass.darken', 0.14));   // tufts a little darker than the ground, so they show
    images.grassMap = await loadImage('assets/world/grass-map.png' + v);
    try { await document.fonts.load('700 16px Lexend'); await document.fonts.load('400 16px Lexend'); } catch (e) { /* a fallback font is used */ }
  };
  // the same picture with every colour darker by `amount` (0..1), pixel for pixel (no new colours are invented beyond the darker shade)
  function darken(img, amount) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), f = 1 - amount;
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.round(d.data[i] * f); d.data[i + 1] = Math.round(d.data[i + 1] * f); d.data[i + 2] = Math.round(d.data[i + 2] * f); }
    g.putImageData(d, 0, 0);
    return c;
  }
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
  R.shake = { power: 0, x: 0, y: 0, next: 0 };
  // a hit at world pixel (wx, wy) shakes the screen: the nearer it is to the middle of the screen the stronger (nothing for hits off screen)
  R.hitShake = function (wx, wy, strength) {
    const v = R.view, half = Math.hypot(v.w, v.h) / 2 / v.S, f = Math.max(0, 1 - Math.hypot(wx - v.cx, wy - v.cy) / half);
    if (f > 0) R.shake.power = Math.max(R.shake.power, strength * f);
  };
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
  // a point on the canvas (device pixels) to a place in the world, in tiles
  R.toWorld = (px, py) => ({ x: ((px - R.view.ox) / R.view.S) / TILE, y: ((py - R.view.oy) / R.view.S) / TILE });
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
  // (with o.pivot: the picture's pivot, the middle of the BODY in picture pixels, is put at wx, and a flipped picture turns around that pivot)
  function blit(img, wx, wyBottom, o) {
    o = o || {};
    const s = V.S, iw = img.width, ih = img.height, extra = o.extra || 0;
    const dx = sxOf(o.pivot === undefined ? wx : wx - (o.flip ? iw - o.pivot : o.pivot)), top = syOf(wyBottom - ih - extra);
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
  function castShadow(img, key, baseX, baseY, flip, pivot) {
    const sil = silhouette(img, key, K.C('shadow.purple', '#957fae'));
    const iw = img.width, ih = img.height, ax = S('shadow.lean', -0.4), ay = S('shadow.length', 0.4);
    ctx.save();
    ctx.setTransform(V.S, 0, 0, V.S, V.ox, V.oy);
    ctx.transform(1, 0, -ax, -ay, baseX - (pivot === undefined ? iw / 2 : flip ? iw - pivot : pivot) + ax * ih, baseY + ay * ih);
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
  function bodyPos(b, t) {
    let lift = b.walkP > 0 || b.moving ? S('unit.hopHeightPx', 2) * Math.sin(Math.PI * b.walkP) : 0;
    if (b.dodge) lift = 4 * Math.sin(Math.PI * clamp((t - b.dodge.t0) / b.dodge.dur, 0, 1));          // a dodge is a little leap
    if (b.rag) lift = K.combat.ragPose(t, b).z;
    return { px: b.fx * TILE, py: b.fy * TILE + FEET, lift };
  }

  R.draw = function (W, now) {
    if (!ctx) return;
    const dt = Math.min(0.1, Math.max(0, now - lastT)); lastT = now;
    const v = R.view; V = v;
    advanceZoom(dt);
    if (R.follow) {     // the camera follows smoothly
      const p = bodyPos(R.follow, W.t);
      v.cx += (p.px + 8 - v.cx) * Math.min(1, dt * 6); v.cy += (p.py + 8 - v.cy) * Math.min(1, dt * 6);
    }
    // screen shake: whole game pixels, changes about 40 times a second, dies down smoothly
    const sh = R.shake;
    sh.power *= Math.exp(-dt / Math.max(0.01, S('shake.decaySeconds', 0.22)));
    if (sh.power < 0.35) { sh.power = 0; sh.x = sh.y = 0; }
    else if (now >= sh.next) { sh.next = now + 1 / 40; sh.x = Math.round((Math.random() * 2 - 1) * sh.power); sh.y = Math.round((Math.random() * 2 - 1) * sh.power); }
    v.ox = Math.round(v.w / 2 - v.cx * v.S) + Math.round(sh.x * v.S); v.oy = Math.round(v.h / 2 - v.cy * v.S) + Math.round(sh.y * v.S);
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
    for (const b of W.bodies) { if (b.hidden) continue; const p = bodyPos(b, W.t); items.push({ k: 'body', y: p.py + 16.1, px: p.px, py: p.py, lift: p.lift, ref: b }); }
    for (const d of W.debris || []) { const pz = K.combat.debrisPose(t, d); if (pz.visible) items.push({ k: 'debris', y: pz.y, px: pz.x, py: pz.y, lift: pz.z, ref: d, pose: pz }); }
    items.sort((a, b) => a.y - b.y);

    // 3. shadows (multiply, desaturated purple), before the things that cast them
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = K.C('shadow.purple', '#957fae');
    ctx.globalAlpha = K.C('shadow.opacity', 1);
    for (const it of items) {
      if (it.k === 'tree') castShadow(images.tree, 'tree', it.px + 8, it.py + 15.5, treeFlip(it.ref));
      else if (it.k === 'debris') { if (it.ref.kind === 'tree') groundBlob({ px: it.px - 8, py: it.py - 16, lift: it.lift }); }
      else if (it.k === 'body' && it.ref.rag) { if (K.combat.ragPose(t, it.ref).visible) groundBlob(it); }
      else if (it.k === 'body') castShadow(images[it.ref.sprite], it.ref.sprite, it.px + 8, it.py + 15.5, it.ref.face < 0, pivotOf(it.ref.sprite));
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // 4. the things themselves
    for (const it of items) {
      if (it.k === 'grass') blit(images.grassDetail, it.px, it.py + 10, { extra: grassExtra(it.ref) });
      else if (it.k === 'tree') drawTree(W, it, dt, t);
      else if (it.k === 'debris') drawDebris(it);
      else drawBody(it, t);
    }
    drawSlashes(W, t);

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

  // the middle of a unit's body inside its picture (content/settings.json: sprite.pivot.<name>); the picture turns around it
  const pivotOf = (name) => S('sprite.pivot.' + name, 8);
  // a flat little shadow under a ragdoll (it gets smaller the higher the body is); the standing shadow would be wrong for a tumbling body
  function groundBlob(it) {
    const z = it.lift, w = Math.max(4, 2 * Math.round(5 - z * 0.12)), x = Math.round(it.px + 8), y = Math.round(it.py + 14);
    const row = (ww, yy) => { const sx0 = Math.round(sxOf(x - ww / 2)), sy0 = Math.round(syOf(yy)); ctx.fillRect(sx0, sy0, Math.round(sxOf(x + ww / 2)) - sx0, Math.round(syOf(yy + 1)) - sy0); };
    row(w - 4, y); row(w, y + 1); row(w - 4, y + 2);
  }
  // a defeated body tumbling: turns only in exact quarter turns, so every pixel stays a pixel (no slanted ones)
  function drawRagdoll(it, t) {
    const b = it.ref, pose = K.combat.ragPose(t, b);
    if (!pose.visible) return;
    const img = images[b.sprite], pv = pivotOf(b.sprite), s = V.S, mid = (spriteTop(img) + img.height) / 2;
    const q = ((pose.quarter % 4) + 4) % 4, c = [1, 0, -1, 0][q], sn = [0, 1, 0, -1][q];
    ctx.save();
    ctx.translate(Math.round(sxOf(it.px + 8)), Math.round(syOf(it.py + 16 - it.lift - (img.height - mid))));
    ctx.transform(c, sn, -sn, c, 0, 0);
    if (b.face < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, img.width, img.height, -Math.round(pv * s), -Math.round(mid * s), img.width * s, img.height * s);
    ctx.restore();
  }
  // a flung tree or grass tuft tumbling away: quarter turns only, like the ragdolls
  function drawDebris(it) {
    const img = it.ref.kind === 'tree' ? images.tree : images.grassDetail, s = V.S, pv = img.width / 2, mid = (spriteTop(img) + img.height) / 2;
    const q = ((it.pose.quarter % 4) + 4) % 4, c = [1, 0, -1, 0][q], sn = [0, 1, 0, -1][q];
    ctx.save();
    ctx.translate(Math.round(sxOf(it.px)), Math.round(syOf(it.py - it.lift - (img.height - mid))));
    ctx.transform(c, sn, -sn, c, 0, 0);
    ctx.drawImage(img, 0, 0, img.width, img.height, -Math.round(pv * s), -Math.round(mid * s), img.width * s, img.height * s);
    ctx.restore();
  }
  function drawBody(it, t) {
    if (it.ref.rag) { drawRagdoll(it, t); return; }
    const b = it.ref, img = images[b.sprite], pivot = pivotOf(b.sprite);
    let extra, ox = 0;
    // a slime that is about to jump squashes and shakes (the warning)
    const wind = b.atk && b.atk.state === 'wind' ? clamp((t - b.atk.t0) / Math.max(0.01, b.atk.until - b.atk.t0), 0, 1) : 0;
    if (b.dodge) extra = 1.2 * Math.sin(Math.PI * clamp((t - b.dodge.t0) / b.dodge.dur, 0, 1));
    else if (wind) { extra = -0.9 * wind; ox = Math.sin(t * 70) * 0.6 * wind; }
    else if (b.moving) extra = K.anim('hop').stretch * Math.sin(Math.PI * b.walkP);
    else if (b.talkUntil && t < b.talkUntil) { const an = K.anim('talk'); extra = an.stretch * wave(t, an.period, b.phase); }
    else { const an = K.anim('breathe'); extra = an.stretch * wave(t, an.period, b.phase); }
    const alpha = t < (b.flickerIn || 0) ? (Math.floor(t * 14) % 2 === 0 ? 1 : 0.15) : 1;      // flickers when it comes back
    const wy = it.py + 16 - it.lift, wx = it.px + 8 + ox, flip = b.face < 0;
    // afterimages behind a dodging unit
    if (b.trail && b.trail.length) {
      const last = b.trail[b.trail.length - 1];
      if (t - last.t > 0.3) b.trail = [];
      else for (let i = 0; i < b.trail.length - 1; i += 3) {
        const e = b.trail[i], age = t - e.t;
        if (age > 0.22) continue;
        blit(img, e.fx * TILE + 8, e.fy * TILE + FEET + 16 - it.lift, { flip: e.face < 0, extra: extra * 0.5, pivot, alpha: 0.38 * (1 - age / 0.22) });
      }
    }
    blit(img, wx, wy, { flip, extra, pivot, alpha });
    // a white flash when hurt, and just before a slime jumps
    const flash = t < (b.flashUntil || 0) ? (b.flashUntil - t) / S('hit.flashSeconds', 0.22) : wind > 0.7 ? 0.55 * (0.5 + 0.5 * Math.sin(t * 50)) : 0;
    if (flash > 0) blit(silhouette(img, b.sprite, '#ffffff'), wx, wy, { flip, extra, pivot, alpha: Math.min(0.85, flash) * alpha });
  }

  // the slash of a knight: a 90 degree sweep made of whole game pixels (like everything else), brightest at the head, fading behind it
  function drawSlashes(W, t) {
    const half = S('slash.arcDegrees', 90) * Math.PI / 360, r1 = S('slash.rangeTiles', 1.35) * TILE * 0.95, color = K.C('fx.slash', '#ffffff');
    for (const b of W.bodies) {
      const f = b.slashFx;
      if (!f) continue;
      const p = (t - f.t0) / f.dur;
      if (p < 0) continue;
      if (p > 1.5) { b.slashFx = null; continue; }
      const head = -half + 2 * half * Math.min(1, p), fade = p > 1 ? 1 - (p - 1) / 0.5 : 1;
      const pos = bodyPos(b, t), wx = pos.px + 8, wy = pos.py + 16 - pos.lift - 6;
      const px = new Map();
      for (let a = -half; a <= head; a += Math.PI / 180) {
        const age = (head - a) / (2 * half), al = (1 - age * 0.85) * fade;
        for (let r = r1 - 3.2; r <= r1; r += 0.5) {
          const x = Math.floor(wx + Math.cos(f.ang + a) * r), y = Math.floor(wy + Math.sin(f.ang + a) * r), k = x * 4096 + y;
          if (!(px.get(k) >= al)) px.set(k, al);
        }
      }
      ctx.fillStyle = color;
      for (const [k, al] of px) {
        const x = Math.floor(k / 4096), y = k - x * 4096;
        ctx.globalAlpha = Math.max(0.15, al);
        const sx0 = Math.round(sxOf(x)), sy0 = Math.round(syOf(y));
        ctx.fillRect(sx0, sy0, Math.round(sxOf(x + 1)) - sx0, Math.round(syOf(y + 1)) - sy0);
      }
      ctx.globalAlpha = 1;
    }
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
  // ------------------------------------------------------------------ the health bar over a head: red for the hearts left, black for the part that is gone
  // (made of whole game pixels: 2 px per heart, 2 px high, with a 1 px black frame). Returns the screen y of its top, or null when there is none.
  const tops = new WeakMap();
  function spriteTop(img) {          // the first row of the picture that is not empty
    if (tops.has(img)) return tops.get(img);
    let top = 0;
    try {
      const c = mkCanvas(img.width, img.height), g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      outer: for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (d[(y * img.width + x) * 4 + 3] > 0) { top = y; break outer; }
    } catch (e) { /* keep 0 */ }
    tops.set(img, top);
    return top;
  }
  function drawHpBar(it) {
    const b = it.ref;
    if (b.dead || b.rag || !b.maxHp) return null;
    const img = images[b.sprite], ppx = S('hpbar.pixelsPerHeart', 2), h = S('hpbar.heightPx', 2), w = b.maxHp * ppx;
    // it glides with the unit exactly like the picture does (not snapped to the pixel grid and not hopping), and every game pixel of it
    // is drawn the same whole number of screen pixels wide, so it never shivers
    const u = Math.max(1, Math.round(V.S));
    const L = Math.round(sxOf(it.px + 8 - w / 2)), T = Math.round(syOf(it.py + 16 - img.height + spriteTop(img) - 2 - h));
    ctx.fillStyle = K.C('hp.empty', '#000000');
    ctx.fillRect(L - u, T - u, (w + 2) * u, (h + 2) * u);                        // the frame, and the part that is gone
    if (b.hp > 0) { ctx.fillStyle = K.C('hp.fill', '#e0453f'); ctx.fillRect(L, T, Math.max(0, b.hp) * ppx * u, h * u); }
    return T - u;
  }

  function drawTexts(W, t) {
    const s = V.S, outline = K.C('ui.nameOutline', '#2a2433');
    const namePx = Math.max(S('render.nameFontMinPx', 9), Math.round(S('render.nameFontWorldPx', 5.5) * s));
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const bubbles = [];
    for (const it of items) {
      if (it.k !== 'body') continue;
      const b = it.ref, cx = sxOf(it.px + 8);
      if (b.rag) continue;
      const barTop = drawHpBar(it);
      if (b.noName) continue;
      let nameY = barTop !== null ? barTop - Math.round(s * 1.5) : syOf(it.py - it.lift - 3);
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
