// Krowns - sound. Every letter of a speech bubble makes a tiny blip. Units that live longer have a lower voice.
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const audio = (K.audio = { muted: false, ctx: null, master: null, budget: 0 });

  audio.unlock = function () {
    if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = audio.muted ? 0 : 0.5;
      audio.master.connect(audio.ctx.destination);
    } catch (e) { audio.ctx = null; }
  };
  audio.setMuted = function (m) { audio.muted = m; if (audio.master) audio.master.gain.value = m ? 0 : 0.5; try { localStorage.setItem('krowns.muted', m ? '1' : '0'); } catch (e) { /* ignore */ } };
  // call once per frame: how many blips may play this frame
  audio.newFrame = function () { audio.budget = 3; };

  // pitch in Hz for a unit: longer life = lower voice
  audio.pitchFor = function (u) {
    const lo = S('audio.pitchLowHz', 300), hi = S('audio.pitchHighHz', 520);
    const a = S('iv.longevity.min', 10), b = S('iv.longevity.max', 15);
    const t = Math.min(1, Math.max(0, (u.iv.longevity - a) / (b - a || 1)));
    return hi - t * (hi - lo);
  };
  // gain 0..1 (louder when the unit is near the middle of the screen)
  audio.blip = function (u, gain) {
    if (!audio.ctx || audio.muted || audio.budget <= 0 || audio.ctx.state !== 'running') return;
    audio.budget--;
    const c = audio.ctx, now = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square';
    o.frequency.value = audio.pitchFor(u) * (0.97 + Math.random() * 0.06);
    const vol = 0.045 * Math.max(0.05, Math.min(1, gain === undefined ? 1 : gain));
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(vol, now + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    o.connect(g); g.connect(audio.master);
    o.start(now); o.stop(now + 0.06);
  };
  try { audio.muted = localStorage.getItem('krowns.muted') === '1'; } catch (e) { /* ignore */ }
})();
