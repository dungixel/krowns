// Turns the Notion export (notion-export/*.json) into data/game-data.js, the one file the game reads.
// Run:  node tools/build-data.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'notion-export', f), 'utf8'));
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

// jobs
out.jobs = {};
for (const r of read('jobs.json')) {
  if (r.Available === false) continue;          // not in the game yet (Notion: Available unchecked)
  const id = slug(r.Name);
  out.jobs[id] = {
    id, name: r.Name, cls: r.Class, dps: num(r['Damage per second (in hearts)']), range: num(r['Range (tiles)']) || 1,
    sprite: r.Sprite, tint: r.Tint || '', icon: r.Icon, color: r.Color, ambition: num(r['Ambition weight']),
    minGood: r['Min evil-good'] === undefined || r['Min evil-good'] === '' ? -10 : num(r['Min evil-good']),
    maxGood: r['Max evil-good'] === undefined || r['Max evil-good'] === '' ? 10 : num(r['Max evil-good']),
    maxPerKingdom: num(r['Max per kingdom']), work: r.Work, variantOf: r['Variant of'] ? slug(r['Variant of']) : '',
    guessed: !!r.Guessed, description: r.description || '',
  };
}

// creatures
out.creatures = {};
for (const r of read('creatures.json')) {
  const id = slug(r.Name);
  const st = String(r['Status on hit'] || '').split(':');
  out.creatures[id] = {
    id, name: r.Name, sprite: r.Sprite, behavior: r.Behavior, hearts: num(r.Hearts), dps: num(r['Damage per second (in hearts)']),
    speed: num(r['Speed (tiles/s)']) || 1, food: num(r['Food drop']), weight: num(r['Spawn weight']), nightOnly: !!r['Night only'],
    flies: !!r.Flies, status: st[0] || '', statusChance: st[1] ? Number(st[1]) : 0, guessed: !!r.Guessed, description: r.description || '',
  };
}

// structures and items
out.structures = {};
for (const r of read('structures.json')) {
  const id = slug(r.Name);
  out.structures[id] = {
    id, name: r.Name, kind: r.Kind, sprite: r.Sprite || '', color: r['Placeholder color'] || r.Color, label: r.Label || '',
    w: num(r['Width (tiles)']) || 1, h: num(r['Height (tiles)']) || 1, hearts: num(r.Hearts), wood: num(r['Wood cost']),
    gold: num(r['Gold cost']), buildSeconds: num(r['Build seconds']), icon: r.Icon, iconColor: r.Color, description: r.Description || '',
  };
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

// speech: { idle: [..], ... }
out.speech = {};
for (const r of read('speech.json')) (out.speech[r.Category] = out.speech[r.Category] || []).push(r.Text);

fs.mkdirSync(path.join(root, 'data'), { recursive: true });
const js = '// GENERATED from the Notion page "krowns 1.0" by tools/build-data.js - do not edit by hand.\n' +
  'globalThis.Krowns = globalThis.Krowns || {};\nglobalThis.Krowns.data = ' + JSON.stringify(out, null, 1) + ';\n';
fs.writeFileSync(path.join(root, 'data', 'game-data.js'), js);
console.log('data/game-data.js written:', Object.keys(out.settings).length, 'settings,', Object.keys(out.jobs).length, 'jobs,',
  Object.keys(out.creatures).length, 'creatures,', Object.keys(out.structures).length, 'structures,', Object.keys(out.colors).length, 'colors,',
  Object.values(out.speech).reduce((a, b) => a + b.length, 0), 'speech lines');
