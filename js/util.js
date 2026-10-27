// Krowns - small shared helpers.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});

  // seeded random generator, so a world can be reproduced from its number
  function makeRng(seed) {
    let a = seed >>> 0;
    function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));      // inclusive
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.chance = (p) => next() < p;
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    return next;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  K.util = { makeRng, clamp, cap, hexToRgb };
})();
