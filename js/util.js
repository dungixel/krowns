// Krowns - small shared helpers: random numbers, math, colours, the game data accessors.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});

  // ---- seeded random generator, so a world can be reproduced from its seed
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
    next.shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
      return arr;
    };
    next.weighted = (items, wf) => {
      let total = 0;
      for (const it of items) total += wf(it);
      if (total <= 0) return null;
      let r = next() * total;
      for (const it of items) { r -= wf(it); if (r <= 0) return it; }
      return items[items.length - 1];
    };
    return next;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pad2 = (n) => String(n).padStart(2, '0');

  // "Nothing in this game has more than 1 decimal... always rounding in 0.5 steps"
  function step(v, st) {
    st = st || (K.S ? K.S('iv.step', 0.5) : 0.5);
    return Math.round(Math.round(v / st) * st * 10) / 10;
  }
  const one = (v) => Math.round(v * 10) / 10;                 // at most one decimal

  // ---- colours
  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbToCss = (c, a) => (a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);

  // ---- small binary heap used by the path finder
  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(item, pri) {
      const a = this.a; a.push([pri, item]);
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; const t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
    }
    pop() {
      const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
        }
      }
      return top[1];
    }
  }

  K.util = { makeRng, clamp, lerp, cheb, dist, sign, cap, pad2, step, one, hexToRgb, rgbToCss, Heap };
})();
