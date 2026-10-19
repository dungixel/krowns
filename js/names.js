// Krowns - names and kingdom colours.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});

  const SYLLABLES = ('na, sa, ta, ca, ne, se, te, ni, no, nu, ma, me, mi, mo, mu, da, de, di, do, du, ' +
    'ba, be, bi, bo, bu, nae, sae, tae, cae, ya, ye, yi, yo, yu, ke, ki, co, fe, fi, pa, pae, pe, ' +
    'tra, tre, tri, tro, tru, cra, cre, cri, cro, cru, bra, bre, bri, bro, bru, la, lae, leo, lu, li')
    .split(',').map((s) => s.trim());

  // A unit name is 2 or 3 random syllables.
  function makeName(rng, taken) {
    for (let tries = 0; tries < 50; tries++) {
      const n = rng.chance(0.55) ? 2 : 3;
      let s = '';
      for (let i = 0; i < n; i++) s += rng.pick(SYLLABLES);
      s = s.charAt(0).toUpperCase() + s.slice(1);
      if (!taken || !taken.has(s)) return s;
    }
    return 'Nameless';
  }

  // Pastel colour that no other kingdom in this world is using yet.
  function pickKingdomColor(rng, usedHues) {
    let best = null, bestGap = -1;
    for (let i = 0; i < 40; i++) {
      const h = rng.range(0, 360);
      let gap = 360;
      for (const u of usedHues) {
        const d = Math.abs(h - u);
        gap = Math.min(gap, Math.min(d, 360 - d));
      }
      if (gap > bestGap) { bestGap = gap; best = h; }
    }
    const h = Math.round(best);
    return { hue: h, fill: `hsl(${h} 70% 78%)`, soft: `hsl(${h} 70% 82%)`, dark: `hsl(${h} 45% 45%)`, line: `hsl(${h} 55% 62%)` };
  }

  K.names = { SYLLABLES, makeName, pickKingdomColor };
})();
