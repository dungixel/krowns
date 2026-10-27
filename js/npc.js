// Krowns - the one neighbour: Tero the farmer. He strolls around and says the sentences YOU pick (the panel at the bottom left, see main.js).
// (His whole personality comes later.)
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const npc = (K.npc = {});

  npc.create = function (W, player) {
    const rng = W.rng;
    const [tx, ty] = K.world.freeTileNear(W, Math.round(player.fx) + 6, Math.round(player.fy) + 2, 12);
    const b = K.world.addBody(W, { kind: 'npc', name: S('npc.name', 'Tero'), job: S('npc.job', 'farmer'), color: rng.int(1, 12), sprite: 'base', fx: tx, fy: ty, face: -1, voice: K.voice.npcVoice() });
    b.ai = { mode: 'idle', until: W.t + rng.range(1, 3), goal: null };
    return b;
  };

  // say a sentence: mood is neutral, happy, sad or angry (changes the melody of the voice and how fast he talks)
  npc.say = function (W, b, text, mood) {
    const cps = S('bubble.charsPerSecond', 14) * K.voice.moodSpeed(mood);
    b.bubble = { text, mood, cps, plan: K.voice.plan(text, mood), t0: W.t, dur: text.length / cps + S('bubble.lingerSeconds', 2.2), lines: null, shown: -1 };
    b.talkUntil = b.bubble.t0 + text.length / cps;
    b.ai.mode = 'talk'; b.ai.until = b.bubble.t0 + b.bubble.dur;
  };
  // say sentence number i of content/speech.json (the same one again whenever you like)
  npc.sayLine = function (W, b, i) {
    const l = K.lines()[i];
    if (l) npc.say(W, b, l.text, l.mood);
  };

  npc.update = function (W, b, player, dt) {
    const a = b.ai, rng = W.rng;
    const dxp = player.fx - b.fx, dyp = player.fy - b.fy;
    if (a.mode === 'talk') {                           // stands still and looks at whoever is near
      if (Math.abs(dxp) > 0.5) b.face = dxp > 0 ? 1 : -1;
      K.world.moveBody(W, b, 0, 0, dt, 1);
      if (W.t >= a.until) { b.bubble = null; a.mode = 'idle'; a.until = W.t + rng.range(2, 5); }
      return;
    }
    if (a.mode === 'idle') {
      K.world.moveBody(W, b, 0, 0, dt, 1);
      if (W.t >= a.until) {
        const ang = rng() * Math.PI * 2, r = rng.range(1.5, 4);
        a.goal = [b.fx + Math.cos(ang) * r, b.fy + Math.sin(ang) * r]; a.mode = 'walk'; a.until = W.t + 4;
      }
    } else if (a.mode === 'walk') {
      const gx = a.goal[0] - b.fx, gy = a.goal[1] - b.fy;
      const moved = K.world.moveBody(W, b, gx, gy, dt, S('npc.walkTilesPerSecond', 1.3));
      if (Math.hypot(gx, gy) < 0.25 || W.t >= a.until || moved < 1e-4) { a.mode = 'idle'; a.until = W.t + rng.range(2, 6); }
    }
  };
})();
