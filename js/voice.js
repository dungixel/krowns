// Krowns - the voice. Every letter of a speech bubble is "spoken" with a tiny made-up sound, a bit like Animal Crossing.
// Nothing is recorded: each letter is a short buzzing tone (the voice) shaped by two filters (the mouth) that make it sound like
// "ah / eh / ee / oh / oo". Consonants make no hiss or pop; they only shape the mouth on the way into the vowel (lips closed for b/p/m, tongue up for t/d/n...). The pitch makes each character's voice different.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const voice = (K.voice = { ctx: null, master: null, wave: null, muted: false, budget: 0 });

  // mouth shapes: the two main resonances (Hz) of each vowel
  const VOWEL = { a: [800, 1250], e: [520, 1900], i: [310, 2350], o: [500, 900], u: [330, 850] };
  // every letter is "spelled out" like its name: the vowel it sounds like, plus the consonant that shapes how it starts
  const LETTER = {
    a: ['a'], e: ['e'], i: ['i'], o: ['o'], u: ['u'],
    b: ['i', 'b'], c: ['e', 's'], d: ['i', 'd'], f: ['e', 'f'], g: ['i', 'g'], h: ['a', 'h'], j: ['a', 'g'], k: ['a', 'k'], l: ['e', 'l'],
    m: ['e', 'm'], n: ['e', 'n'], p: ['i', 'p'], q: ['u', 'k'], r: ['a', 'r'], s: ['e', 's'], t: ['i', 't'], v: ['i', 'f'], w: ['u', 'w'],
    x: ['e', 's'], y: ['i', 'y'], z: ['i', 's'],
  };
  // consonants only change how the mouth moves into the vowel: where the two resonances (Hz) start, and how soft the start is
  // (no noise at all, so nothing hisses). soft = how much quieter the very first moment is.
  const CONS = {
    p: { from: [350, 900], soft: 0.5 }, b: { from: [350, 900], soft: 0.5 }, m: { from: [300, 800], soft: 0.6, nasal: 1 },
    t: { from: [400, 2000], soft: 0.5 }, d: { from: [400, 1900], soft: 0.5 }, n: { from: [320, 1700], soft: 0.6, nasal: 1 },
    k: { from: [450, 1500], soft: 0.5 }, g: { from: [420, 1400], soft: 0.5 },
    s: { from: [350, 2400], soft: 0.7 }, f: { from: [400, 1200], soft: 0.7 }, h: { from: [650, 1300], soft: 0.7 },
    l: { from: [400, 1100], soft: 0.8 }, r: { from: [450, 1250], soft: 0.8 }, w: { from: [320, 700], soft: 0.8 }, y: { from: [300, 2300], soft: 0.8 },
  };

  voice.unlock = function () {
    if (voice.ctx) { if (voice.ctx.state === 'suspended') voice.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (voice.ctx = new AC());
      voice.master = c.createGain(); voice.master.gain.value = voice.muted ? 0 : S('voice.volume', 0.5);
      const soft = c.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 4200;       // takes the sharp edge off the buzz
      const comp = c.createDynamicsCompressor();                                                        // letters overlap: keep them from getting loud
      voice.bus = c.createGain(); voice.bus.connect(soft); soft.connect(voice.master);      // the buzzing voice is softened, the hisses and pops are not
      voice.master.connect(comp); comp.connect(c.destination);
      const re = new Float32Array(26), im = new Float32Array(26);      // a warm, soft buzz (the higher tones fade out quickly)
      for (let n = 1; n < 26; n++) im[n] = 1 / (n * n * 0.6 + n);
      voice.wave = c.createPeriodicWave(re, im);
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
  // Every letter also gets its own small pitch (the same letter always a bit higher or lower than another) plus a little chance,
  // and the mouth slides from the consonant shape into the vowel shape: that is what keeps it from sounding like a machine.
  voice.say = function (ch, v, gain, p) {
    const c = voice.ctx;
    if (!c || voice.muted || voice.budget <= 0 || c.state !== 'running') return;
    p = p || { mult: 1, loud: 1, dur: 1 };
    const lc = ch.toLowerCase(), shape = LETTER[lc];
    if (!shape) return;      // spaces and punctuation make no sound
    const [vow, cname] = shape, cons = cname ? CONS[cname] : null, f = VOWEL[vow];
    const bus = voice.bus || voice.master;
    voice.budget--;
    const now = c.currentTime, dur = S('voice.letterSeconds', 0.11) * p.dur * (0.9 + Math.random() * 0.25), t1 = now + dur;
    const rnd = S('voice.randomness', 0.12);
    const own = ((lc.charCodeAt(0) * 37) % 13) / 12 - 0.5;                       // this letter's own little pitch, -0.5 .. 0.5
    const f0 = v.pitch * p.mult * (1 + own * 0.14) * (1 + (Math.random() * 2 - 1) * rnd);
    const vol = 0.22 * p.loud * Math.max(0.05, Math.min(1, gain === undefined ? 1 : gain));
    // a smooth swell: fade in, stay, then fade out slowly (the next letter starts while this one is still fading)
    const soft = cons ? cons.soft : 1;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(vol * soft, now + dur * 0.12);
    env.gain.linearRampToValueAtTime(vol, now + dur * 0.35);
    env.gain.linearRampToValueAtTime(vol * 0.75, now + dur * 0.65);
    env.gain.linearRampToValueAtTime(0.0001, t1);
    env.connect(bus);
    // the buzz: pitch slides a little up or down during each letter, like a real voice
    const o = c.createOscillator(); o.setPeriodicWave(voice.wave);
    const glide = 1 + (Math.random() * 2 - 1) * 0.07 + (p.mult >= 1.02 ? 0.02 : 0);
    o.frequency.setValueAtTime(f0 * glide, now); o.frequency.linearRampToValueAtTime(f0, now + dur * 0.7);
    // the mouth: both resonances slide from the consonant shape into the vowel shape (a little different every time)
    const fs = v.formant * (cons && cons.nasal ? 0.85 : 1) * (1 + (Math.random() * 2 - 1) * 0.06);
    [[0, 1, 7], [1, 0.65, 9]].forEach(([k, g, q]) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
      if (cons) { bp.frequency.setValueAtTime(cons.from[k] * v.formant, now); bp.frequency.linearRampToValueAtTime(f[k] * fs, now + Math.min(0.05, dur * 0.45)); }
      else bp.frequency.value = f[k] * fs;
      const gg = c.createGain(); gg.gain.value = g * 3;
      o.connect(bp); bp.connect(gg); gg.connect(env);
    });
    const air = c.createBiquadFilter(); air.type = 'bandpass'; air.frequency.value = 2900 * v.formant; air.Q.value = 6;
    const ag = c.createGain(); ag.gain.value = 0.5 * v.bright; o.connect(air); air.connect(ag); ag.connect(env);
    o.start(now); o.stop(t1 + 0.02);
  };

  try { voice.muted = localStorage.getItem('krowns.muted') === '1'; } catch (e) { /* not important */ }
})();
