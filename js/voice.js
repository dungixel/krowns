// Krowns - the voice. Every letter of a speech bubble makes a tiny soft musical "blip", a bit like Animal Crossing, Undertale or Banjo-Kazooie.
// Nothing is recorded. Fake human speech sounds creepy, so this does not try to sound human: each letter is a clean, round little note.
// Which note depends on the letter and on the melody of the sentence (see voice.plan), and the notes always come from one happy scale.
// The vowels only change how bright the blip is ("a" mellow, "i" bright). The pitch of a character's voice is just a number.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const voice = (K.voice = { ctx: null, master: null, wave: null, muted: false, budget: 0 });

  // how open (bright) each vowel sounds: the cut-off (Hz) of the soft filter
  const VOWEL = { a: 2300, e: 3000, i: 3800, o: 1900, u: 1500 };
  // every letter "sounds like" a vowel and sits on its own step of the scale, so the same letter is always the same note
  const SOUND = {
    a: 'a', e: 'e', i: 'i', o: 'o', u: 'u',
    b: 'u', c: 'e', d: 'o', f: 'e', g: 'o', h: 'a', j: 'a', k: 'a', l: 'o', m: 'u', n: 'o', p: 'u', q: 'u', r: 'a', s: 'e', t: 'i', v: 'i', w: 'u', x: 'e', y: 'i', z: 'i',
  };
  const STEP = [0, 2, 4, 7, 9];            // the happy scale (major pentatonic): every combination of its notes sounds nice
  const snap = (semis) => {                // nearest note of the scale, in semitones above the base pitch
    const oct = Math.floor(semis / 12), r = semis - oct * 12;
    let best = 0, bd = 99;
    [0, 2, 4, 7, 9, 12].forEach((n) => { const d = Math.abs(n - r); if (d < bd) { bd = d; best = n; } });
    return oct * 12 + best;
  };

  voice.unlock = function () {
    if (voice.ctx) { if (voice.ctx.state === 'suspended') voice.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (voice.ctx = new AC());
      voice.master = c.createGain(); voice.master.gain.value = voice.muted ? 0 : S('voice.volume', 0.5);
      const comp = c.createDynamicsCompressor();                                                        // letters overlap: keep them from getting loud
      voice.master.connect(comp); comp.connect(c.destination);
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
    const lc = ch.toLowerCase(), vow = SOUND[lc];
    if (!vow) return;      // spaces and punctuation make no sound
    voice.budget--;
    // which note: the sentence melody (p.mult) plus this letter's own step of the scale, snapped to the scale
    const letterStep = STEP[(lc.charCodeAt(0) * 7) % 5];
    const semis = snap(Math.round(12 * Math.log2(Math.max(0.3, p.mult)) + (letterStep - 4.5) * 0.45));
    const f0 = v.pitch * Math.pow(2, semis / 12) * (1 + (Math.random() * 2 - 1) * S('voice.randomness', 0.01));
    const now = c.currentTime, dur = S('voice.letterSeconds', 0.1) * p.dur, t1 = now + dur;
    const vol = 0.3 * p.loud * Math.max(0.05, Math.min(1, gain === undefined ? 1 : gain));
    // a round little note: quick soft start, a short body, a gentle tail (the next letter starts while this one is still fading)
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(vol, now + 0.008);
    env.gain.exponentialRampToValueAtTime(vol * 0.55, now + dur * 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    // a soft filter: this is the only thing the vowel changes
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.value = VOWEL[vow] * v.formant * v.bright;
    lp.connect(env); env.connect(voice.master);
    // the note: a triangle wave (round and warm) plus a quiet octave above it (a bit of sparkle)
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0 * 1.015, now); o.frequency.exponentialRampToValueAtTime(f0, now + 0.02);       // the tiniest "bloop" at the start
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f0 * 2;
    const g2 = c.createGain(); g2.gain.value = 0.22;
    o.connect(lp); o2.connect(g2); g2.connect(lp);
    o.start(now); o2.start(now); o.stop(t1 + 0.02); o2.stop(t1 + 0.02);
  };

  try { voice.muted = localStorage.getItem('krowns.muted') === '1'; } catch (e) { /* not important */ }
})();
