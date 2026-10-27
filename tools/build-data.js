// Turns the content files (content/*.json) into data/game-data.js, the one file the game reads.
// Run:  node tools/build-data.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'content', f), 'utf8'));
const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const parseValue = (v) => {
  const s = String(v).trim();
  if (s !== '' && !isNaN(Number(s))) return Number(s);
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    return parts.every((p) => p !== '' && !isNaN(Number(p))) ? parts.map(Number) : parts;
  }
  return s;
};

const out = { generatedAt: new Date().toISOString() };

// settings: { "hunger.max": 10, ... }
out.settings = {};
for (const r of read('settings.json')) out.settings[r.Key.trim()] = parseValue(r.Value);

// colors: { "shadow.purple": "#957fae", ... }
out.colors = {};
for (const r of read('colors.json')) {
  const h = String(r.Hex).trim();
  out.colors[r.Key.trim()] = h.startsWith('#') ? h : Number(h);
}

// animations
out.animations = {};
for (const r of read('animations.json')) {
  const extra = {};
  String(r.Extra || '').split(';').filter(Boolean).forEach((kv) => {
    const [k, v] = kv.split('=');
    extra[k.trim()] = isNaN(Number(v)) ? (v === 'true' ? true : v) : Number(v);
  });
  out.animations[slug(r.Animation)] = { stretch: num(r['Stretch (px)']), period: num(r['Period (s)']), height: num(r['Height (px)']), extra };
}

// speech: [ { text, mood }, ... ] in the order of the file
out.speech = read('speech.json').map((r) => ({ text: String(r.Text).trim(), mood: String(r.Mood || 'neutral').trim() }));

fs.mkdirSync(path.join(root, 'data'), { recursive: true });
const js = '// GENERATED from content/*.json by tools/build-data.js - do not edit by hand.\n' +
  'globalThis.Krowns = globalThis.Krowns || {};\nglobalThis.Krowns.data = ' + JSON.stringify(out, null, 1) + ';\n';
fs.writeFileSync(path.join(root, 'data', 'game-data.js'), js);
console.log('data/game-data.js written:', Object.keys(out.settings).length, 'settings,', Object.keys(out.colors).length, 'colors,',
  Object.keys(out.animations).length, 'animations,', out.speech.length, 'speech lines');
