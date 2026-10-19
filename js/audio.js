// Krowns - sound. Everything is synthesized in the browser (no sound files needed).
// Each unit gets its own "voice" (pitch + wave), so you can tell who is talking by ear.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});

  let ctx = null, master = null;
  let muted = false;
  const recent = []; // timestamps of recent blips, to keep the sound tidy

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(comp); comp.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : 0.8;
  }
  const isMuted = () => muted;

  // Pentatonic-ish pitches, so overlapping voices still sound pleasant.
  const NOTES = [196.0, 220.0, 246.9, 293.7, 329.6, 392.0, 440.0, 493.9];
  const WAVES = ['square', 'triangle', 'square', 'sawtooth'];
  function voiceFor(unit) {
    const h = K.util.hashStr(unit.name);
    return { base: NOTES[h % NOTES.length] * (((h >> 3) & 1) ? 2 : 1), wave: WAVES[(h >> 5) % WAVES.length] };
  }

  function allowed() {
    const now = performance.now();
    while (recent.length && now - recent[0] > 120) recent.shift();
    if (recent.length >= 5) return false;
    recent.push(now);
    return true;
  }

  // One short typing blip. vol is 0..1.
  function blip(voice, vol) {
    if (!ctx || muted || vol <= 0.01 || !allowed()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = voice.wave;
    o.frequency.value = voice.base * (1 + (Math.random() - 0.5) * 0.14);
    const peak = 0.045 * vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.08);
  }

  function tone(freq, start, dur, type, peak) {
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak || 0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, peak, freq) {
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 900;
    const g = ctx.createGain(); g.gain.value = peak || 0.05;
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t);
  }

  // Small effects, all quiet. vol is 0..1 (distance).
  function sfx(name, vol) {
    if (!ctx || muted || vol <= 0.02 || !allowed()) return;
    const v = vol;
    switch (name) {
      case 'hit': noise(0.07, 0.05 * v, 700); break;
      case 'death': tone(180, 0, 0.5, 'triangle', 0.05 * v); tone(120, 0.15, 0.6, 'triangle', 0.04 * v); break;
      case 'birth': tone(523, 0, 0.15, 'sine', 0.05 * v); tone(784, 0.12, 0.25, 'sine', 0.05 * v); break;
      case 'found': tone(392, 0, 0.18, 'triangle', 0.06 * v); tone(494, 0.14, 0.18, 'triangle', 0.06 * v); tone(659, 0.28, 0.4, 'triangle', 0.06 * v); break;
      case 'war': tone(110, 0, 0.6, 'sawtooth', 0.04); tone(146, 0.25, 0.7, 'sawtooth', 0.04); break;
      case 'peace': tone(440, 0, 0.3, 'sine', 0.05); tone(330, 0.25, 0.5, 'sine', 0.05); break;
      case 'love': tone(660, 0, 0.12, 'sine', 0.04 * v); tone(880, 0.1, 0.3, 'sine', 0.04 * v); break;
      case 'heal': tone(700, 0, 0.1, 'sine', 0.035 * v); tone(930, 0.08, 0.2, 'sine', 0.035 * v); break;
      case 'curse': tone(150, 0, 0.25, 'sawtooth', 0.025 * v); break;
      case 'click': tone(600, 0, 0.04, 'square', 0.025); break;
      default: break;
    }
  }

  K.audio = { unlock, blip, sfx, voiceFor, setMuted, isMuted };
})();
