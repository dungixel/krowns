// Krowns - the voice. Every vowel of a speech bubble makes a soft musical "blip" (one blip per syllable), a bit like Animal Crossing.
// Nothing is recorded, and it does not try to sound human (fake speech sounds creepy). Consonants are silent.
// The pitch is NOT random: it follows the melody of the sentence (voice.plan): statements come down, questions go up at the end,
// exclamations start high, commas lift a little, important words get a small peak, happy is higher and bouncy, sad is lower and sinks.
// The pitch of a character's voice is just a number.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const voice = (K.voice = { ctx: null, master: null, wave: null, muted: false, budget: 0 });

  // how open (bright) each vowel sounds: the cut-off (Hz) of the soft filter. The vowel never changes the pitch.
  const VOWEL = { a: 2300, e: 3000, i: 3800, o: 1900, u: 1500, y: 3400 };

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
  const MOOD = {
    neutral: { base: 0, range: 1, bounce: 0, drift: 0, speed: 1, dur: 1, loud: 1, end: 0 },
    happy: { base: 1.6, range: 1.3, bounce: 0.6, drift: 0, speed: 1.1, dur: 0.9, loud: 1.05, end: 0 },
    sad: { base: -1.8, range: 0.5, bounce: 0, drift: -2.5, speed: 0.78, dur: 1.3, loud: 0.75, end: -0.04 },
  };
  voice.moodSpeed = (mood) => (MOOD[mood] || MOOD.neutral).speed;
  const SMALL = new Set(['a', 'an', 'the', 'to', 'of', 'is', 'it', 'in', 'on', 'at', 'and', 'but', 'or', 'i', 'me', 'my', 'so', 'be', 'am', 'are', 'was', 'with', 'for', 'that', 'this', 'you', 'we', 'do', 'did']);
  const WH = new Set(['what', 'where', 'why', 'who', 'whom', 'whose', 'how', 'when', 'which']);
  const semi = (x) => Math.pow(2, x / 12);
  // returns, for every character of the text, null (silent) or { mult, glide, loud, dur, vow } for the first vowel of each syllable.
  // mult = pitch relative to the character's base pitch, glide = how much the pitch moves during the note (1 = stays)
  voice.plan = function (text, mood) {
    const m = MOOD[mood] || MOOD.neutral, out = new Array(text.length).fill(null);
    const sre = /[^.!?…]+[.!?…]*/g;
    let sm;
    while ((sm = sre.exec(text))) {
      const sent = sm[0], base = sm.index, tail = sent.trim();
      const kind = /\?$/.test(tail) ? 'q' : /!$/.test(tail) ? 'e' : 'd';
      const trailing = /(\.\.\.|…)$/.test(tail);
      // words -> syllables (a syllable = a run of vowels; "y" counts only in words with no other vowel)
      const syl = []; let wi = -1, phrase = 0, firstWord = true, wh = false;
      const wre = /[A-Za-z']+|[,;:]/g; let w;
      const words = [];
      while ((w = wre.exec(sent))) { if (/[,;:]/.test(w[0])) { if (words.length) words[words.length - 1].endsPhrase = true; } else words.push({ t: w[0], at: w.index, endsPhrase: false }); }
      words.forEach((wd, k) => {
        if (k === 0 && WH.has(wd.t.toLowerCase())) wh = true;
        wd.last = k === words.length - 1;
        let groups = [], g, re = /[aeiou]+/gi;
        while ((g = re.exec(wd.t))) groups.push({ at: wd.at + g.index, v: g[0][0].toLowerCase() });
        if (!groups.length) { const y = wd.t.search(/y/i); if (y >= 0) groups.push({ at: wd.at + y, v: 'y' }); }
        groups.forEach((gr, j) => syl.push({ idx: base + gr.at, vow: gr.v, word: k, j, nj: groups.length, wd, small: SMALL.has(wd.t.toLowerCase()) }));
      });
      const n = syl.length; if (!n) continue;
      // the pitch of every syllable, in semitones above the base pitch
      const acc = kind === 'q' ? 0.6 : kind === 'e' ? 1.8 : 1;
      let pk = 0;
      const lastWord = words.length - 1;
      syl.forEach((y, k) => {
        const pos = n > 1 ? k / (n - 1) : 0;
        let s = kind === 'e' ? 3.2 - 4 * pos : kind === 'q' && !wh ? 0.6 - 1 * pos : (wh ? 3 : 2) - 4.5 * pos;      // the general slope of the sentence
        if (!y.small && y.j === 0) s += 1.8 * acc;                                  // important words get a small peak
        else if (y.j > 0) s -= 0.6;                                                  // the rest of a word sits a little lower
        else s -= 0.5;
        if (y.word === lastWord && !y.small && y.j === 0) s += kind === 'd' ? 0.8 : 0;   // the last important word stands out
        s += m.bounce * (k % 2 ? 1 : -1) + m.drift * pos;                                // happy bounces, sad sinks
        y.s = s * m.range;
        y.loud = (y.small ? 0.82 : 1) * (y.j === 0 ? 1.08 : 1);
        y.dur = 1; y.end = 1;
      });
      // the ends: of a phrase (comma), and of the sentence
      syl.forEach((y, k) => {
        const lastOfWord = y.j === y.nj - 1;
        if (y.wd.endsPhrase && lastOfWord) { y.s += 1.2; y.end = 1.06; y.dur = 1.25; }          // a comma: lifts a little, "more to come"
      });
      const L = syl[n - 1];
      if (kind === 'q' && !wh) {
        const lw = syl.filter((y) => y.word === lastWord);
        lw.forEach((y, i) => { if (i < lw.length - 1) y.s += 0.5; });
        L.s += 5; L.end = 1.22; L.dur = 1.7;                                       // a yes/no question climbs on its last syllable
      } else if (kind === 'q') { L.s -= 1.2; L.end = 1.06 + m.end; L.dur = 1.4; }   // "what / where / why" questions fall, then lift a little
      else if (kind === 'e') { L.s -= 1.5; L.end = 0.89; L.dur = 1.5; L.loud *= 1.05; }
      else { L.s -= 2.2; L.end = 0.9 + m.end; L.dur = trailing ? 2.2 : 1.6; if (trailing) { L.s -= 1.5; L.end = 0.86; } }
      syl.forEach((y, k) => {
        let glide = y.end;
        if (glide === 1 && k < n - 1 && syl[k + 1].word === y.word) glide = Math.max(0.93, Math.min(1.07, semi(0.35 * (syl[k + 1].s - y.s))));   // glide toward the next syllable of the same word
        else if (glide === 1 && k < n - 1) glide = Math.max(0.94, Math.min(1.06, semi(0.25 * (syl[k + 1].s - y.s))));
        out[y.idx] = { mult: semi(m.base + y.s), glide, loud: y.loud * m.loud * (kind === 'e' ? 1.2 : 1), dur: y.dur * m.dur, vow: y.vow };
      });
    }
    return out;
  };

  // speak one blip. gain 0..1 (quieter when far away). p = one entry of voice.plan (silent characters have none)
  voice.say = function (ch, v, gain, p) {
    const c = voice.ctx;
    if (!p || !c || voice.muted || voice.budget <= 0 || c.state !== 'running') return;
    voice.budget--;
    const f0 = v.pitch * p.mult * (1 + (Math.random() * 2 - 1) * S('voice.randomness', 0.004));
    const now = c.currentTime, dur = S('voice.letterSeconds', 0.13) * p.dur, t1 = now + dur;
    const vol = 0.3 * p.loud * Math.max(0.05, Math.min(1, gain === undefined ? 1 : gain));
    // a round little note: quick soft start, a body that stays, a gentle tail
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(vol, now + 0.012);
    env.gain.linearRampToValueAtTime(vol * 0.8, now + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    // a soft filter: this is the only thing the vowel changes
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.value = (VOWEL[p.vow] || 2500) * v.formant * v.bright;
    lp.connect(env); env.connect(voice.master);
    // the note: a triangle wave (round and warm) plus a quiet octave above it (a bit of sparkle); the pitch glides as the plan says
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0 * 0.985, now); o.frequency.linearRampToValueAtTime(f0, now + 0.025); o.frequency.linearRampToValueAtTime(f0 * p.glide, t1);
    const o2 = c.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(f0 * 1.97, now); o2.frequency.linearRampToValueAtTime(f0 * 2, now + 0.025); o2.frequency.linearRampToValueAtTime(f0 * 2 * p.glide, t1);
    const g2 = c.createGain(); g2.gain.value = 0.2;
    o.connect(lp); o2.connect(g2); g2.connect(lp);
    o.start(now); o2.start(now); o.stop(t1 + 0.02); o2.stop(t1 + 0.02);
  };

  try { voice.muted = localStorage.getItem('krowns.muted') === '1'; } catch (e) { /* not important */ }
})();
