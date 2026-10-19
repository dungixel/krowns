// Runs the real index.html inside a simulated browser (jsdom) with a recording canvas.
// Usage: node tools/pagetest.js     (needs: npm i jsdom, in any folder Node can resolve it from)
// It cannot show how things LOOK, but it catches script errors and checks bubbles, panel and drawing calls.
const fs = require('fs');
const path = require('path');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch (e) {
  ({ JSDOM, VirtualConsole } = require(path.join(process.env.JSDOM_DIR || '/tmp/krowns-work', 'node_modules/jsdom')));
}
const root = path.join(__dirname, '..');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail && e.detail.stack || e.message)));
vc.on('error', (e) => errors.push('console.error: ' + e));

let fakeNow = 1000;
const rafs = [];
const calls = { fillText: 0, arc: 0, drawImage: 0, fillRect: 0, quadraticCurveTo: 0, stroke: 0 };

const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  url: 'file://' + path.join(root, 'index.html'), runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(win) {
    win.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
    win.performance.now = () => fakeNow;
    win.confirm = () => true;
    win.HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy({}, {
        get(t, p) {
          if (p === 'measureText') return () => ({ width: 10 });
          if (p in t) return t[p];
          return (...a) => { if (p in calls) calls[p]++; };
        },
        set(t, p, v) { t[p] = v; return true; },
      });
    };
    win.addEventListener('error', (e) => errors.push('window error: ' + e.message));
  },
});
const win = dom.window;

function step(n, dtMs) {
  for (let i = 0; i < n; i++) {
    fakeNow += dtMs;
    const list = rafs.splice(0, rafs.length);
    for (const cb of list) { try { cb(fakeNow); } catch (e) { errors.push('frame error: ' + e.stack); } }
  }
}
const $ = (id) => win.document.getElementById(id);
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL:', msg); } else console.log('ok  :', msg); };

win.addEventListener('load', () => {
  try {
    check(!$('start').hidden && $('game').hidden, 'title screen shows first');
    $('btn-create').click();
    check($('start').hidden && !$('game').hidden, 'Create world swaps to the game');
    check(!!win.krowns && win.krowns.world.alive.length === 20, 'a world with 20 souls exists');
    step(2, 16);

    // fast forward: speed 4, big time steps
    $('btn-s4').click();
    step(1500, 250);
    const w = win.krowns.world, view = win.krowns.view;
    check(w.time > 1400, `world advanced (${w.time}s)`);
    check(w.kingdoms.size >= 1, `kingdoms exist (${w.kingdoms.size})`);
    check(calls.arc > 1000 && calls.quadraticCurveTo > 1000 && calls.fillRect > 100, `canvas was drawn on (arcs ${calls.arc}, blobs ${calls.quadraticCurveTo})`);
    check($('hud-count').textContent.includes('soul'), 'HUD shows counts: ' + $('hud-count').textContent + ' / ' + $('hud-time').textContent);
    check($('history').children.length > 3, `chronicle collected ${$('history').children.length} lines`);

    // select a unit, check the panel
    const u = w.alive.find((x) => x.kingdom != null) || w.alive[0];
    view.select({ type: 'unit', id: u.id });
    step(2, 16);
    const html = $('panel').innerHTML;
    check($('panel').classList.contains('show'), 'panel opens');
    check(html.includes(u.name), 'panel shows the name ' + u.name);
    check(/class="w w-[a-z]+"/.test(html), 'panel has coloured meaningful words');
    const visible = $('panel').textContent;
    const bad = visible.match(/.{0,30}(\d+\.\d|NaN|undefined|null).{0,20}/);
    if (bad) console.log('   suspicious text:', bad[0]);
    check(!bad, 'panel shows no raw numbers or NaN/undefined');
    const hearts = $('panel').querySelectorAll('.heart').length;
    check(hearts === u.maxHearts, `panel draws ${hearts} hearts (max ${u.maxHearts})`);
    console.log('\n   DESCRIPTION OF', u.name + ':\n   ' + $('panel').querySelector('.p-desc').textContent.replace(/\s+/g, ' ').trim().slice(0, 700));
    console.log('   LIFE:', $('panel').querySelector('.p-life').textContent.replace(/\s+/g, ' ').trim().slice(0, 300), '\n');

    // kingdom panel
    const k = [...w.kingdoms.values()][0];
    view.select({ type: 'kingdom', id: k.id });
    check($('panel').textContent.includes('Kingdom of ' + k.name), 'kingdom panel opens for ' + k.name);
    view.select(null);
    check(!$('panel').classList.contains('show'), 'panel closes');

    // speech bubbles at normal speed
    $('btn-s1').click();
    let sawBubble = 0, maxLen = 0, typedOk = true;
    for (let i = 0; i < 1200; i++) {
      step(1, 100);
      const bs = win.document.querySelectorAll('#bubbles .bubble');
      if (bs.length) sawBubble++;
      for (const b of bs) {
        const total = b.querySelectorAll('.ch').length, on = b.querySelectorAll('.ch.on').length;
        maxLen = Math.max(maxLen, total);
        if (on > total) typedOk = false;
      }
    }
    check(sawBubble > 50, `speech bubbles appeared (${sawBubble} of 1200 frames)`);
    check(typedOk && maxLen > 5, `bubbles reveal characters in place (longest ${maxLen} chars)`);

    // pause
    $('btn-pause').click();
    const t1 = w.time; step(50, 250);
    check(w.time === t1, 'pause stops time');
    $('btn-pause').click();

    // new world
    const old = win.krowns.world;
    $('btn-new').click();
    check(win.krowns.world !== old && win.krowns.world.time === 0, 'new world button starts a fresh world');
    step(100, 250);
  } catch (e) { errors.push('test error: ' + e.stack); }

  console.log(errors.length ? '\nERRORS:\n' + errors.slice(0, 8).join('\n') : '\nNo script errors.');
  process.exit(errors.length || failed ? 1 : 0);
});
