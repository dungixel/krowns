// Krowns - name making: random syllables (the list, the chances and the banned words are in Settings).
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

  K.names = { make: makeOne };
})();
