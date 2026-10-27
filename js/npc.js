// Krowns - the one neighbour. For now he stands around, wanders a little, and says a few test sentences so the voice can be heard.
// (His whole personality comes later.)
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const S = K.S;
  const npc = (K.npc = {});

  npc.create = function (W, player) {
    const rng = W.rng;
    const [tx, ty] = K.world.freeTileNear(W, Math.round(player.fx) + 6, Math.round(player.fy) + 2, 12);
    const b = K.world.addBody(W, { kind: 'npc', name: K.names.make(rng), color: rng.int(1, 12), sprite: 'base', fx: tx, fy: ty, face: -1, voice: K.voice.npcVoice() });
    b.ai = { mode: 'idle', until: W.t + rng.range(1, 3), goal: null, nextTalk: W.t + S('npc.firstTalkSeconds', 3) };
    return b;
  };

  // mood: neutral, happy or sad (changes the melody of the voice and how fast he talks)
  npc.say = function (W, b, text, mood) {
    const cps = S('bubble.charsPerSecond', 14) * K.voice.moodSpeed(mood);
    b.bubble = { text, mood, cps, plan: K.voice.plan(text, mood), t0: W.t, dur: text.length / cps + S('bubble.lingerSeconds', 2.2), lines: null, shown: -1 };
    b.talkUntil = b.bubble.t0 + text.length / cps;
    b.ai.mode = 'talk'; b.ai.until = b.bubble.t0 + b.bubble.dur;
  };
  npc.sayRandom = function (W, b) {
    const mood = W.rng.pick(['neutral', 'happy', 'sad']);
    const lines = K.lines('test.' + mood);
    if (lines.length) npc.say(W, b, W.rng.pick(lines), mood);
  };

  npc.update = function (W, b, player, dt) {
    const a = b.ai, rng = W.rng;
    const dxp = player.fx - b.fx, dyp = player.fy - b.fy, dp = Math.hypot(dxp, dyp);
    if (a.mode === 'talk') {                           // stands still and looks at whoever is near
      if (Math.abs(dxp) > 0.5) b.face = dxp > 0 ? 1 : -1;
      K.world.moveBody(W, b, 0, 0, dt, 1);
      if (W.t >= a.until) { b.bubble = null; a.mode = 'idle'; a.until = W.t + rng.range(2, 5); a.nextTalk = W.t + rng.range(S('npc.talkMinSeconds', 6), S('npc.talkMaxSeconds', 12)); }
      return;
    }
    if (W.t >= a.nextTalk && dp < S('npc.hearTiles', 14)) { npc.sayRandom(W, b); return; }
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
