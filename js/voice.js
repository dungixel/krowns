// Krowns - the voice. Every letter that appears in a speech bubble makes one very soft, cute little beep (nothing human-like).
// Nothing is recorded. The beep is a pure round tone with a tiny "boop" up at the start and a soft fade.
// The pitch is NOT random: it follows the melody of the sentence (voice.plan): statements come down, questions go up at the end,
// exclamations start high, commas lift a little, important words get a small peak, happy is higher and bouncy, sad is lower and sinks.
// The pitch of a character's voice is just a number.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const voice = (K.voice = { ctx: null, master: null, muted: false, budget: 0 });

  voice.unlock = function () {
    if (voice.ctx) { if (voice.ctx.state === 'suspended') voice.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (voice.ctx = new AC());
      voice.master = c.createGain(); voice.master.gain.value = voice.muted ? 0 : S('voice.volume', 0.5);
      const comp = c.createDynamicsCompressor();                                                        // beeps overlap a little: keep them from getting loud
      voice.master.connect(comp); comp.connect(c.destination);
    } catch (e) { voice.ctx = null; }
  };
  voice.setMuted = function (m) { voice.muted = m; if (voice.master) voice.master.gain.value = m ? 0 : S('voice.volume', 0.5); };
  voice.newFrame = function () { voice.budget = 4; };     // never more than a few letters per frame

  // the voice of a character: { pitch (Hz), bright (0..1.5: how much sparkle the beep has) }
  voice.npcVoice = () => ({ pitch: S('voice.npc.pitchHz', 330), bright: S('voice.npc.brightness', 1) });

  // ---- intonation: how the pitch moves across a sentence, so it sounds like it means what it says
  const MOOD = {
    neutral: { base: 0, range: 1, bounce: 0, drift: 0, speed: 1, dur: 1, loud: 1, end: 0 },
    happy: { base: 1.6, range: 1.3, bounce: 0.6, drift: 0, speed: 1.1, dur: 0.9, loud: 1.05, end: 0 },
    angry: { base: 0.5, range: 1.5, bounce: 0, drift: 0, speed: 1.25, dur: 0.8, loud: 1.35, end: 0 },
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
        if (k === 0 && WH.has(wd.t.toLowerCase()) && !/(\.\.\.|…)/.test(tail)) wh = true;      // "What...?" is a confused yes/no style rise
        wd.last = k === words.length - 1;
        let groups = [], g, re = /[aeiou]+/gi;
        while ((g = re.exec(wd.t))) groups.push({ at: wd.at + g.index });
        if (!groups.length) { const y = wd.t.search(/y/i); if (y >= 0) groups.push({ at: wd.at + y }); }
        groups.forEach((gr, j) => syl.push({ idx: base + gr.at, word: k, j, nj: groups.length, wd, small: SMALL.has(wd.t.toLowerCase()) }));
      });
      const letters = [];
      for (let i = 0; i < sent.length; i++) if (/[A-Za-z0-9]/.test(sent[i])) letters.push(base + i);
      const n = syl.length;
      if (!n) { letters.forEach((i) => { out[i] = { mult: semi(m.base), loud: m.loud, dur: m.dur }; }); continue; }
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
        y.end = 1;
      });
      // the ends: of a phrase (comma), and of the sentence
      syl.forEach((y, k) => {
        const lastOfWord = y.j === y.nj - 1;
        if (y.wd.endsPhrase && lastOfWord) { y.s += 1.2; y.end = 1.06; }          // a comma: lifts a little, "more to come"
      });
      const L = syl[n - 1];
      if (kind === 'q' && !wh) {
        const lw = syl.filter((y) => y.word === lastWord);
        lw.forEach((y, i) => { if (i < lw.length - 1) y.s += 0.5; });
        L.s += 5; L.end = 1.22;                                       // a yes/no question climbs on its last syllable
      } else if (kind === 'q') { L.s -= 1.2; L.end = 1.06 + m.end; }   // "what / where / why" questions fall, then lift a little
      else if (kind === 'e') { L.s -= 1.5; L.end = 0.89; L.loud *= 1.05; }
      else { L.s -= 2.2; L.end = 0.9 + m.end; if (trailing) { L.s -= 1.5; L.end = 0.86; } }
      // every sound leans toward the pitch of the NEXT sound: up if the next one is higher, down if it is lower
      const lean = S('voice.glideToNext', 0.8);
      const anchors = syl.map((y, k) => {
        let glide = y.end;
        if (glide === 1 && k < n - 1) {
          const diff = syl[k + 1].s - y.s;          // semitones up (+) or down (-) to the next vowel
          glide = Math.abs(diff) < 0.25 ? 1 : semi(Math.max(-6, Math.min(6, Math.sign(diff) * Math.max(1.3, Math.abs(diff) * lean))));
        }
        const P = semi(m.base + y.s);
        return { idx: y.idx, P, Q: P * glide, loud: y.loud * m.loud * (kind === 'e' ? 1.2 : 1) };
      });
      // the melody runs through the whole sentence: every letter gets the pitch of the melody at its place
      // (a vowel is the "note"; the letters around it slide from one note to the next, and after the last note to the sentence's ending)
      const endIdx = letters[letters.length - 1];
      letters.forEach((i) => {
        let k = 0; while (k + 1 < anchors.length && anchors[k + 1].idx <= i) k++;
        const a = anchors[k], nx = anchors[k + 1];
        let pitch;
        if (i < anchors[0].idx) pitch = anchors[0].P;
        else if (nx) { const t = (i - a.idx) / (nx.idx - a.idx); pitch = a.P * Math.pow(nx.P / a.P, t * t * (3 - 2 * t)); }      // a smooth slide from one note to the next
        else { const t = endIdx > a.idx ? (i - a.idx) / (endIdx - a.idx) : 0; pitch = a.P * Math.pow(a.Q / a.P, t); }
        out[i] = { mult: pitch, loud: a.loud, dur: m.dur };
      });
    }
    return out;
  };

  // how loud a voice is for a listener `d` tiles away: full when close, nothing at voice.hearTiles and beyond
  voice.hearing = function (d) { const x = Math.max(0, 1 - d / S('voice.hearTiles', 16)); return x * Math.sqrt(x); };

  // beep for one letter. gain 0..1 (from voice.hearing: quieter when far away), pan -1 (left) .. 1 (right) = where the speaker is.
  // p = one entry of voice.plan (spaces and punctuation have none, so they stay silent)
  voice.say = function (ch, v, gain, p, pan) {
    const c = voice.ctx;
    if (!p || !c || voice.muted || voice.budget <= 0 || c.state !== 'running') return;
    gain = gain === undefined ? 1 : gain;
    if (gain < 0.015) return;      // too far away to be heard
    voice.budget--;
    const f0 = v.pitch * p.mult;
    const now = c.currentTime, dur = S('voice.beepSeconds', 0.08) * p.dur, t1 = now + dur;
    const vol = 0.15 * p.loud * Math.min(1, gain);
    // very soft: a gentle start and a smooth fade
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(vol, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    const soft = c.createBiquadFilter(); soft.type = 'lowpass'; soft.Q.value = 0.5;
    soft.frequency.value = 3600 * (0.4 + 0.6 * Math.min(1, gain));      // far beeps are duller
    env.connect(soft);
    if (c.createStereoPanner && pan) { const sp = c.createStereoPanner(); sp.pan.value = Math.max(-1, Math.min(1, pan)); soft.connect(sp); sp.connect(voice.master); }      // and come from their side
    else soft.connect(voice.master);
    // a pure round tone with a faint sparkle an octave above, and a tiny "boop" up at the start
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0 * 0.96, now); o.frequency.linearRampToValueAtTime(f0, now + 0.02);
    const o2 = c.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(f0 * 1.92, now); o2.frequency.linearRampToValueAtTime(f0 * 2, now + 0.02);
    const g2 = c.createGain(); g2.gain.value = 0.14 * v.bright;
    o.connect(env); o2.connect(g2); g2.connect(env);
    o.start(now); o2.start(now); o.stop(t1 + 0.02); o2.stop(t1 + 0.02);
  };

  try { voice.muted = localStorage.getItem('krowns.muted') === '1'; } catch (e) { /* not important */ }
})();
