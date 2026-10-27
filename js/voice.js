// Krowns - the voice. Every letter of a speech bubble is "spoken" with a tiny made-up sound, a bit like Animal Crossing.
// Nothing is recorded: each letter is a short buzzing tone (the voice) shaped by two filters (the mouth) that make it sound like
// "ah / eh / ee / oh / oo". Consonants add a little puff of air in front. The pitch makes each character's voice different.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const voice = (K.voice = { ctx: null, master: null, noise: null, muted: false, budget: 0 });

  // mouth shapes: the two main resonances (Hz) of each vowel
  const VOWEL = { a: [800, 1250], e: [520, 1900], i: [310, 2350], o: [500, 900], u: [330, 850] };
  // every letter is "spelled out" like its name: the vowel it sounds like + what happens in front of it
  // p = pop (b, d, g, k, p, t...), f = hiss (f, s, h, x, z...), n = hum (m, n), l = soft (l, r, w, y), v = plain vowel
  const LETTER = {
    a: ['a', 'v'], e: ['e', 'v'], i: ['i', 'v'], o: ['o', 'v'], u: ['u', 'v'],
    b: ['i', 'p'], c: ['i', 'f'], d: ['i', 'p'], f: ['e', 'f'], g: ['i', 'p'], h: ['a', 'f'], j: ['a', 'p'], k: ['a', 'p'], l: ['e', 'l'],
    m: ['e', 'n'], n: ['e', 'n'], p: ['i', 'p'], q: ['u', 'p'], r: ['a', 'l'], s: ['e', 'f'], t: ['i', 'p'], v: ['i', 'f'], w: ['u', 'l'],
    x: ['e', 'f'], y: ['i', 'l'], z: ['i', 'f'],
  };

  voice.unlock = function () {
    if (voice.ctx) { if (voice.ctx.state === 'suspended') voice.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (voice.ctx = new AC());
      voice.master = c.createGain(); voice.master.gain.value = voice.muted ? 0 : S('voice.volume', 0.5);
      const soft = c.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 6000;       // takes the sharp edge off
      const comp = c.createDynamicsCompressor();                                                        // letters overlap: keep them from getting loud
      voice.master.connect(soft); soft.connect(comp); comp.connect(c.destination);
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
  voice.say = function (ch, v, gain, p) {
    const c = voice.ctx;
    if (!c || voice.muted || voice.budget <= 0 || c.state !== 'running') return;
    p = p || { mult: 1, loud: 1, dur: 1 };
    const shape = LETTER[ch.toLowerCase()];
    if (!shape) return;      // spaces and punctuation make no sound
    const rise = 1, loud = p.loud, dur = S('voice.letterSeconds', 0.08) * p.dur;
    voice.budget--;
    const now = c.currentTime, [vow, kind] = shape, f = VOWEL[vow];
    const wob = 1 + (Math.random() * 2 - 1) * S('voice.randomness', 0.07);
    const f0 = v.pitch * p.mult * wob * (kind === 'n' ? 0.94 : 1);
    const vol = 0.2 * loud * Math.max(0.05, Math.min(1, gain === undefined ? 1 : gain));
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(vol, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    env.connect(voice.master);
    // the buzz
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 1.04, now); o.frequency.exponentialRampToValueAtTime(f0 * rise, now + dur * 0.6);   // a tiny drop at the start of each letter
    // the mouth
    const sh = v.formant * (kind === 'n' ? 0.82 : 1);
    [[f[0] * sh, 1, 7], [f[1] * sh, 0.65, 9], [2900 * v.formant, 0.22 * v.bright, 6]].forEach(([hz, g, q]) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hz; bp.Q.value = q;
      const gg = c.createGain(); gg.gain.value = g * 3;
      o.connect(bp); bp.connect(gg); gg.connect(env);
    });
    o.start(now); o.stop(now + dur + 0.02);
    // the puff of air in front of the consonants
    if (kind === 'p' || kind === 'f') {
      const n = c.createBufferSource(); n.buffer = voice.noise;
      const bp = c.createBiquadFilter(); bp.type = kind === 'p' ? 'bandpass' : 'highpass';
      bp.frequency.value = kind === 'p' ? 2300 * v.formant : 5200; bp.Q.value = kind === 'p' ? 1.2 : 0.7;
      const g = c.createGain(), len = kind === 'p' ? 0.022 : 0.05;
      g.gain.setValueAtTime(vol * (kind === 'p' ? 1.4 : 0.8) * v.bright, now); g.gain.exponentialRampToValueAtTime(0.0001, now + len);
      n.connect(bp); bp.connect(g); g.connect(voice.master);
      n.start(now); n.stop(now + len + 0.01);
    }
  };

  try { voice.muted = localStorage.getItem('krowns.muted') === '1'; } catch (e) { /* not important */ }
})();
