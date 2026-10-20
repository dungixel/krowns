// Krowns - name making. Units and kingdoms get 2-3 random syllables.
// A world keeps a list of 100 names and starts a new list in the background after 60 are used.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});

  const lower = (a) => (a || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const isBanned = (nm) => { const l = nm.toLowerCase(); return lower(K.S('names.banned', [])).some((w) => l.includes(w)); };

  // one name: a third 2 syllables, a third 3 syllables, a third 2 syllables with a closing consonant (the chances are in Settings)
  function makeOne(rng) {
    const syl = K.S('names.syllables');
    const w2 = K.S('names.twoSyllableChance', 33), w3 = K.S('names.threeSyllableChance', 33), we = K.S('names.twoWithEndingChance', 33);
    const ends = lower(K.S('names.endingConsonants', ['s', 'n', 'r', 'l']));
    for (let tries = 0; tries < 200; tries++) {
      let r = rng() * (w2 + w3 + we), n = 2, end = false;
      if (r >= w2 + w3 && ends.length) end = true; else if (r >= w2) n = 3;
      let s = '';
      for (let i = 0; i < n; i++) s += rng.pick(syl);
      if (end) s += rng.pick(ends);
      s = K.util.cap(s);
      if (!isBanned(s)) return s;
    }
    return K.util.cap(rng.pick(syl) + rng.pick(syl));
  }

  function makeBatch(rng, count, avoid) {
    const out = [], seen = new Set();
    let guard = 0;
    while (out.length < count && guard++ < count * 40) {
      const nm = makeOne(rng);
      if (seen.has(nm) || (avoid && avoid.has(nm))) continue;
      seen.add(nm); out.push(nm);
    }
    return out;
  }

  function createNamer(rng) {
    const size = K.S('names.poolSize', 100), refill = K.S('names.refillAfterUsed', 60);
    return { rng, size, refill, current: makeBatch(rng, size), next: null, usedFromCurrent: 0, all: new Set() };
  }

  // the next unit name from the world's list
  function takeName(namer, taken) {
    if (!namer.current.length) { namer.current = namer.next || makeBatch(namer.rng, namer.size); namer.next = null; namer.usedFromCurrent = 0; }
    let nm = namer.current.shift();
    namer.usedFromCurrent++;
    if (namer.usedFromCurrent >= namer.refill && !namer.next) namer.next = makeBatch(namer.rng, namer.size, namer.all);   // "in the background"
    let guard = 0;
    while (taken && taken.has(nm) && guard++ < 20) { nm = namer.current.length ? namer.current.shift() : makeOne(namer.rng); }
    namer.all.add(nm);
    return nm;
  }

  // a kingdom name: same syllables, own random draw
  function kingdomName(namer, taken) {
    let nm = makeOne(namer.rng), guard = 0;
    while (((taken && taken.has(nm)) || namer.all.has(nm)) && guard++ < 30) nm = makeOne(namer.rng);
    namer.all.add(nm);
    return nm;
  }

  K.names = { makeOne, makeBatch, createNamer, takeName, kingdomName };
})();
