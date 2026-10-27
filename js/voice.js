// Krowns - the voice. Every letter of a speech bubble is "spoken" with a tiny made-up sound, a bit like Animal Crossing.
// Nothing is recorded: each letter is a short buzzing tone (the voice) shaped by two filters (the mouth) that make it sound like
// "ah / eh / ee / oh / oo". Consonants add their own sound in front: a hiss for s, a pop for p, a tick for t, a hum for m... The pitch makes each character's voice different.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const voice = (K.voice = { ctx: null, master: null, noise: null, muted: false, budget: 0 });

  // mouth shapes: the two main resonances (Hz) of each vowel
  const VOWEL = { a: [800, 1250], e: [520, 1900], i: [310, 2350], o: [500, 900], u: [330, 850] };
  // every letter is "spelled out" like its name: the vowel it sounds like + a consonant sound in front of it (or none)
  const LETTER = {
    a: ['a'], e: ['e'], i: ['i'], o: ['o'], u: ['u'],
    b: ['i', 'b'], c: ['e', 's'], d: ['i', 'd'], f: ['e', 'f'], g: ['i', 'g'], h: ['a', 'h'], j: ['a', 'g'], k: ['a', 'k'], l: ['e', 'l'],
    m: ['e', 'm'], n: ['e', 'm'], p: ['i', 'p'], q: ['u', 'k'], r: ['a', 'r'], s: ['e', 's'], t: ['i', 't'], v: ['i', 'f'], w: ['u', 'r'],
    x: ['e', 's'], y: ['i', 'r'], z: ['i', 's'],
  };
  // the consonant sounds. noise = a puff of air { hz, q (sharpness), len (s), gain }; voiced = a low hum under it; hum = nasal (m, n); soft = liquid (l, r)
  const CONS = {
    s: { hz: 6800, q: 1.2, len: 0.085, gain: 1.1 },                      // sss
    f: { hz: 4200, q: 0.6, len: 0.07, gain: 1.1 },                       // fff
    h: { hz: 1600, q: 0.5, len: 0.06, gain: 0.8 },                       // hhh
    p: { hz: 1100, q: 0.8, len: 0.03, gain: 2.4, lead: 0.03 },          // pop
    b: { hz: 900, q: 0.8, len: 0.03, gain: 1.8, lead: 0.03, voiced: 1 },
    t: { hz: 4500, q: 1.4, len: 0.022, gain: 2.2, lead: 0.025 },        // tick
    d: { hz: 3000, q: 1.2, len: 0.022, gain: 1.7, lead: 0.025, voiced: 1 },
    k: { hz: 2200, q: 1.2, len: 0.03, gain: 2.1, lead: 0.03 },          // click
    g: { hz: 1700, q: 1.2, len: 0.03, gain: 1.6, lead: 0.03, voiced: 1 },
    m: { hum: 1, lead: 0.035 },                                          // mmm
    l: { soft: 1, lead: 0.02 },
    r: { soft: 1, lead: 0.02 },
  };

  voice.unlock = function () {
    if (voice.ctx) { if (voice.ctx.state === 'suspended') voice.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (voice.ctx = new AC());
      voice.master = c.createGain(); voice.master.gain.value = voice.muted ? 0 : S('voice.volume', 0.5);
      const soft = c.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 5000;       // takes the sharp edge off the buzz
      const comp = c.createDynamicsCompressor();                                                        // letters overlap: keep them from getting loud
      voice.bus = c.createGain(); voice.bus.connect(soft); soft.connect(voice.master);      // the buzzing voice is softened, the hisses and pops are not
      voice.master.connect(comp); comp.connect(c.destination);
      const len = Math.floor(c.sampleRate * 0.12), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      voice.noise = buf;
    } catch (e) { voice.ctx = null; }
  };
  voice.setMuted = function (m) { voice.muted = m; if (voice.master) voice.master.gain.value = m ? 0 : S('voice.volume', 0.5); };
  voice.newFrame = function () { voice.budget = 4; };     // never more than a few letters per frame

  // the voice of a character: { pitch (Hz), formant (1 = grown up, higher = smaller and cuter), bright (0..1.5) }
  voice.npcVoice = () => ({ pitch: S('voice.npc.pitchHz', 280), formant: S('voice.npc.formant', 1.2), bright: S('voice.npc.brightness', 1) });

  // ---- intonation: how the pitch moves across a sentence, so it sounds like it means what it says
  // The pitch of every letter is worked out from: the kind of sentence (statement . question ? exclamation !), the mood of the speaker
  // (neutral, happy, sad), the position in the sentence and in the word.
  const MOOD = {
    neutral: { base: 1, range: 1, bounce: 0, drift: 0, speed: 1, dur: 1, loud: 1 },
    happy: { base: 1.08, range: 1.3, bounce: 0.045, drift: 0, speed: 1.12, dur: 0.9, loud: 1.05 },
    sad: { base: 0.9, range: 0.55, bounce: 0, drift: -0.07, speed: 0.78, dur: 1.3, loud: 0.75 },
  };
  voice.moodSpeed = (mood) => (MOOD[mood] || MOOD.neutral).speed;
  // returns one { mult, loud, dur } per character of the text (null for characters that make no sound)
  voice.plan = function (text, mood) {
    const m = MOOD[mood] || MOOD.neutral, out = new Array(text.length).fill(null);
    const re = /[^.!?…]+[.!?…]*/g;
    let sm;
    while ((sm = re.exec(text))) {
      const sent = sm[0], start = sm.index, end = sent.trim().slice(-1);
      const kind = end === '?' ? 'q' : end === '!' ? 'e' : 'd';
      // the letters of this sentence, grouped in words
      const letters = [];      // { idx, word, li, wlen }
      let wi = -1, inWord = false;
      for (let i = 0; i < sent.length; i++) {
        if (/[a-z]/i.test(sent[i])) {
          if (!inWord) { wi++; inWord = true; }
          letters.push({ idx: start + i, word: wi, li: 0, wlen: 0 });
        } else inWord = false;
      }
      const words = {};
      letters.forEach((l) => { (words[l.word] = words[l.word] || []).push(l); });
      Object.values(words).forEach((w) => w.forEach((l, k) => { l.li = k; l.wlen = w.length; }));
      const L = letters.length, lastWord = wi;
      letters.forEach((l, k) => {
        const pos = L > 1 ? k / (L - 1) : 0, wp = l.wlen > 1 ? l.li / (l.wlen - 1) : 0, last = l.word === lastWord;
        let c = 1, loud = 1;
        if (kind === 'd') c = 1.05 - 0.14 * pos - (last ? 0.07 * wp : 0);                      // a statement slowly comes down
        else if (kind === 'q') c = last ? 0.99 + 0.34 * wp : 0.98 - 0.03 * pos;                // a question stays low and goes up at the end
        else { c = 1.14 + 0.08 * Math.sin(Math.PI * pos) - 0.11 * pos; loud = 1.22; }          // an exclamation starts high, peaks and falls
        c += 0.05 * Math.exp(-l.li * 0.8);                                                     // the start of every word is a little stressed
        c += m.bounce * (l.word % 2 ? 1 : -1) + m.drift * pos;                                 // happy bounces from word to word, sad sinks
        out[l.idx] = { mult: m.base * (1 + (c - 1) * m.range), loud: loud * m.loud, dur: m.dur };
      });
    }
    return out;
  };

  // speak one letter. gain 0..1 (quieter when far away). p = { mult, loud, dur } from voice.plan
  // Letters overlap a little and fade in and out smoothly, so a sentence flows like one stream of sound instead of separate beeps.
  voice.say = function (ch, v, gain, p) {
    const c = voice.ctx;
    if (!c || voice.muted || voice.budget <= 0 || c.state !== 'running') return;
    p = p || { mult: 1, loud: 1, dur: 1 };
    const shape = LETTER[ch.toLowerCase()];
    if (!shape) return;      // spaces and punctuation make no sound
    const [vow, cname] = shape, cons = cname ? CONS[cname] : null, f = VOWEL[vow];
    const bus = voice.bus || voice.master;
    voice.budget--;
    const now = c.currentTime, dur = S('voice.letterSeconds', 0.11) * p.dur;
    const lead = cons && cons.lead !== undefined ? cons.lead : (cons && cons.len ? Math.min(cons.len * 0.6, 0.04) : 0);   // the consonant comes first, then the vowel
    const t0 = now + lead, t1 = t0 + dur;
    const wob = 1 + (Math.random() * 2 - 1) * S('voice.randomness', 0.07);
    const f0 = v.pitch * p.mult * wob;
    const vol = 0.2 * p.loud * Math.max(0.05, Math.min(1, gain === undefined ? 1 : gain));
    // a smooth swell: fade in quickly, stay, then fade out slowly (the next letter starts while this one is still fading)
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(vol * (cons && cons.hum ? 0.8 : 1), t0 + dur * 0.22);
    env.gain.linearRampToValueAtTime(vol * 0.8, t0 + dur * 0.6);
    env.gain.linearRampToValueAtTime(0.0001, t1);
    env.connect(bus);
    // the buzz
    const o = c.createOscillator(); o.type = 'sawtooth';
    const fs = v.formant * (cons && cons.hum ? 0.8 : 1);
    o.frequency.setValueAtTime(f0 * 1.03, now); o.frequency.linearRampToValueAtTime(f0, t0 + dur * 0.5);
    // the mouth
    [[f[0] * fs, 1, 7], [f[1] * fs, 0.65, 9], [2900 * v.formant, 0.22 * v.bright, 6]].forEach(([hz, g, q]) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hz; bp.Q.value = q;
      const gg = c.createGain(); gg.gain.value = g * 3;
      o.connect(bp); bp.connect(gg); gg.connect(env);
    });
    o.start(now); o.stop(t1 + 0.02);
    // the consonant: a burst of air (s, f, h, p, t, k...)
    if (cons && cons.hz) {
      const n = c.createBufferSource(); n.buffer = voice.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = cons.hz * (cons.hz > 3000 ? 1 : v.formant); bp.Q.value = cons.q;
      const g = c.createGain(), len = Math.min(cons.len + lead * 0.5, 0.11);
      const top = vol * cons.gain * v.bright * 2.2;
      g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(top, now + Math.min(0.01, len * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, now + len);
      n.connect(bp); bp.connect(g); g.connect(voice.master);
      n.start(now); n.stop(now + len + 0.01);
    }
  };

  try { voice.muted = localStorage.getItem('krowns.muted') === '1'; } catch (e) { /* not important */ }
})();
