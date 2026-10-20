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

  // ---- the clock. One tick is 10 minutes of world time, so a day is 144 ticks (2 min 24 s at 1x).
  // A new world starts at 08:00 on Day 1.
  const DAY_TICKS = 144, TICKS_PER_HOUR = 6, START_TICK = 48;
  const pad2 = (n) => String(n).padStart(2, '0');
  // t is world time in ticks (may be fractional for smooth light). Returns day number, hour as a
  // decimal (0-24) and text like "16:30".
  function clock(t) {
    const a = Math.max(0, t) + START_TICK;
    const day = Math.floor(a / DAY_TICKS) + 1;
    const hour = (a % DAY_TICKS) / TICKS_PER_HOUR;
    const mins = Math.floor(hour * 60 + 1e-6);
    return { day, hour, text: pad2(Math.floor(mins / 60) % 24) + ':' + pad2(mins % 60) };
  }
  const hourOf = (t) => ((Math.max(0, t) + START_TICK) % DAY_TICKS) / TICKS_PER_HOUR;

  // Colour of the world through the day: white by day, orange at sunrise and sunset,
  // dark desaturated blue at night. Keyframes are [hour, [r, g, b]].
  const NIGHT = [46, 54, 80], ORANGE = [255, 211, 166], ROSE = [196, 146, 146];
  const LIGHT_KEYS = [
    [0, NIGHT], [4.5, NIGHT], [5.4, ROSE], [6.3, ORANGE], [7.8, [255, 255, 255]],
    [17.2, [255, 255, 255]], [18.2, ORANGE], [19.2, ROSE], [20.6, NIGHT], [24, NIGHT],
  ];
  // Returns { rgb: [r,g,b], dark: 0 (full day) .. 1 (full night) }
  function lightAt(hour) {
    let i = 0;
    while (i < LIGHT_KEYS.length - 2 && hour >= LIGHT_KEYS[i + 1][0]) i++;
    const [h0, c0] = LIGHT_KEYS[i], [h1, c1] = LIGHT_KEYS[i + 1];
    const f = clamp((hour - h0) / (h1 - h0), 0, 1), e = f * f * (3 - 2 * f);
    const rgb = [0, 1, 2].map((j) => Math.round(lerp(c0[j], c1[j], e)));
    const lum = (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;
    return { rgb, dark: clamp((1 - lum) / (1 - 0.23), 0, 1) };
  }

  K.util = { makeRng, clamp, lerp, cheb, dist, sign, cap, hashStr, clock, hourOf, lightAt, DAY_TICKS, TICKS_PER_HOUR, START_TICK };
})();
