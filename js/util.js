// Krowns - small shared helpers (random numbers, math). Plain script, no build step needed.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});

  // Seeded random generator, so a world can be reproduced from its seed.
  function makeRng(seed) {
    let a = seed >>> 0;
    function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)); // inclusive
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.chance = (p) => next() < p;
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    };
    // roughly bell-shaped number (sum of uniforms)
    next.normal = (mean, sd) => {
      const n = (next() + next() + next() + next() - 2) * 1.732; // ~ N(0,1)
      return mean + n * sd;
    };
    return next;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  K.util = { makeRng, clamp, lerp, cheb, dist, sign, cap, hashStr };
})();
