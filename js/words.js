// Krowns - the words of the world: speech lines and the hidden-stat descriptions.
// The player never sees numbers. Hidden stats are turned into words here.
//
// Description text uses two tiny markups, turned into HTML by the renderer:
//   [[category|word|tooltip]]  a coloured word that really means something
//   {u:12} / {k:3}             the name of unit 12 / kingdom 3
(function () {
  const K = (globalThis.Krowns = globalThis.Krowns || {});
  const { cap } = K.util;

  // 0..31 -> tier 0..4
  const tierOf = (v) => (v < 6 ? 0 : v < 12 ? 1 : v < 20 ? 2 : v < 26 ? 3 : 4);

  // For each hidden stat: one word per tier, the colour category, and what it means.
  const TRAITS = {
    strength: {
      cat: 'strength', words: ['frail', 'weak', 'steady', 'strong', 'mighty'],
      tipHi: 'Hits hard in battle', tipLo: 'Hits softly in battle',
    },
    magic: {
      cat: 'magic', words: ['spell-deaf', 'unmagical', 'curious', 'gifted', 'arcane'],
      tipHi: 'Has a natural talent for magic', tipLo: 'Has very little talent for magic',
    },
    temperament: {
      cat: 'temper', words: ['serene', 'gentle', 'even-tempered', 'hot-headed', 'fiery'],
      tipHi: 'Gets angry easily, and hits back', tipLo: 'Rarely angers. Prefers words over swords',
    },
    cooking: {
      cat: 'cooking', words: ['hopeless-in-the-kitchen', 'plain', 'handy', 'tasteful', 'delicious'],
      tipHi: 'Has a talent for cooking', tipLo: 'Is poor at cooking',
    },
    farming: {
      cat: 'farming', words: ['seedless', 'unlucky', 'patient', 'green-thumbed', 'bountiful'],
      tipHi: 'Has a talent for farming', tipLo: 'Is poor at farming',
    },
    poetry: {
      cat: 'poetry', words: ['tongue-tied', 'plain-spoken', 'wordy', 'dreamy', 'lyrical'],
      tipHi: 'Has a talent for poetry', tipLo: 'Is poor with words',
    },
    hunting: {
      cat: 'hunting', words: ['noisy', 'slow', 'watchful', 'keen-eyed', 'unerring'],
      tipHi: 'Has a talent for hunting', tipLo: 'Is poor at hunting',
    },
    charisma: {
      cat: 'charisma', words: ['awkward', 'shy', 'likeable', 'charming', 'commanding'],
      tipHi: 'Others listen to them. Natural leader', tipLo: 'Struggles to win others over',
    },
    sociability: {
      cat: 'social', words: ['solitary', 'reserved', 'friendly', 'chatty', 'warm-hearted'],
      tipHi: 'Loves company, friends and visiting', tipLo: 'Prefers to be alone',
    },
    curiosity: {
      cat: 'curious', words: ['set-in-their-ways', 'steady', 'inquisitive', 'restless', 'wandering-minded'],
      tipHi: 'May suddenly take interest in something new', tipLo: 'Rarely changes their mind about life',
    },
    loyalty: {
      cat: 'loyal', words: ['fickle', 'wavering', 'faithful', 'loyal', 'unshakable'],
      tipHi: 'Sticks with their kingdom, even in hard times', tipLo: 'May abandon their kingdom',
    },
    courage: {
      cat: 'courage', words: ['fearful', 'timid', 'steady-nerved', 'brave', 'fearless'],
      tipHi: 'Does not run from danger', tipLo: 'Runs from danger',
    },
    rest: {
      cat: 'rest', words: ['dozy', 'drowsy', 'steady-paced', 'hardy', 'tireless'],
      tipHi: 'Needs little sleep and rarely tires, so fights well on a short night', tipLo: 'Tires quickly and needs a long sleep. Fights badly when worn out',
    },
  };
  const TRAIT_KEYS = Object.keys(TRAITS);

  // What a unit can do in a kingdom. interest phrase = "likes to ...".
  const ROLES = {
    farmer:    { label: 'farmer',    cat: 'farming', likes: 'tend the fields',  skill: 'farming', iv: ['farming'],               tip: 'Grows crops and bakes bread for the kingdom' },
    cook:      { label: 'cook',      cat: 'cooking', likes: 'cook',             skill: 'cooking', iv: ['cooking'],               tip: 'Turns plain food into filling meals' },
    hunter:    { label: 'hunter',    cat: 'hunting', likes: 'hunt',             skill: 'hunting', iv: ['hunting'],               tip: 'Brings meat to the kingdom' },
    swordsman: { label: 'swordsman', cat: 'strength', likes: 'swing a blade',   skill: 'sword',   iv: ['strength', 'courage'],   tip: 'Guards the kingdom and fights its wars' },
    mage:      { label: 'mage',      cat: 'magic',   likes: 'weave spells',     skill: 'magic',   iv: ['magic'],                 tip: 'Heals allies and casts curses on foes' },
    poet:      { label: 'poet',      cat: 'poetry',  likes: 'write poetry',     skill: 'poetry',  iv: ['poetry', 'charisma'],    tip: 'Lifts spirits and calms tempers with verse' },
  };
  const ROLE_KEYS = Object.keys(ROLES);

  const SKILL_NOUN = { sword: 'fighting', magic: 'magic', cooking: 'cooking', farming: 'farming', poetry: 'poetry', hunting: 'hunting' };
  const SKILL_CAT = { sword: 'strength', magic: 'magic', cooking: 'cooking', farming: 'farming', poetry: 'poetry', hunting: 'hunting' };

  const mark = (cat, word, tip) => `[[${cat}|${word}|${tip || ''}]]`;
  const aAn = (word) => (/^[aeiou]/i.test(word) ? 'An' : 'A');

  function traitWord(key, iv) {
    const t = TRAITS[key];
    const tier = tierOf(iv);
    return { word: t.words[tier], cat: t.cat, tip: tier >= 3 ? t.tipHi : t.tipLo, tier };
  }

  function hungerWord(h) {
    if (h <= 0) return mark('hunger', 'starving', 'Losing hearts to hunger');
    if (h <= 1.5) return mark('hunger', 'famished', 'Looking hard for food');
    if (h <= 2.5) return mark('hunger', 'hungry', 'Looking for food');
    if (h <= 3.5) return 'peckish';
    if (h <= 4.5) return 'content';
    return 'well fed';
  }

  // How rested a unit is (energy 0-100), in words. Tired units fight worse.
  function energyWord(e) {
    if (e <= 8) return mark('rest', 'exhausted', 'Can barely stand. Fights very badly and may collapse');
    if (e <= 20) return mark('rest', 'worn out', 'Fights badly until they have slept');
    if (e <= 38) return mark('rest', 'tired', 'Starting to fight worse. Wants to sleep');
    if (e <= 60) return 'a little sleepy';
    if (e <= 85) return 'rested';
    return 'well rested';
  }

  // Build the description as a list of paragraphs (strings with the markup above).
  function describe(u, world) {
    const out = [];
    const traits = TRAIT_KEYS.map((k) => ({ k, v: u.iv[k], z: Math.abs(u.iv[k] - 15.5) }));
    traits.sort((a, b) => b.z - a.z);

    // 1. The headline: the most outstanding trait + what the soul likes
    const top = traits[0];
    const tw = traitWord(top.k, top.v);
    const interest = ROLES[u.interest];
    let p1 = `${aAn(tw.word)} ${mark(tw.cat, tw.word, tw.tip)} soul`;
    if (interest) p1 += ` that likes to ${mark(interest.cat, interest.likes, 'Their true calling: ' + interest.tip)}`;
    p1 += '.';
    out.push(p1);

    // 2. A second quality and a flaw
    const second = traits.slice(1).find((t) => t.v >= 20) || null;
    const flaw = traits.slice(1).find((t) => t.v < 12 && (!second || t.k !== second.k)) || null;
    if (second && flaw) {
      const a = traitWord(second.k, second.v), b = traitWord(flaw.k, flaw.v);
      out.push(`${mark(a.cat, cap(a.word), a.tip)}, though ${mark(b.cat, b.word, b.tip)}.`);
    } else if (second) {
      const a = traitWord(second.k, second.v);
      out.push(`Also ${mark(a.cat, a.word, a.tip)}.`);
    } else if (flaw) {
      const b = traitWord(flaw.k, flaw.v);
      out.push(`Rather ${mark(b.cat, b.word, b.tip)}.`);
    }

    // 3. Kingdom and work
    const kingdom = u.kingdom != null ? world.kingdoms.get(u.kingdom) : null;
    if (kingdom) {
      const isRuler = kingdom.ruler === u.id;
      let s = isRuler ? `Rules the Kingdom of {k:${kingdom.id}}` : `Citizen of {k:${kingdom.id}}`;
      const r = ROLES[u.role];
      if (r && !isRuler) s += `, working as a ${mark(r.cat, r.label, r.tip)}`;
      else if (r) s += `, and works as a ${mark(r.cat, r.label, r.tip)}`;
      out.push(s + '.');
      if (r && u.interest && u.interest !== u.role) {
        const ir = ROLES[u.interest];
        out.push(`Secretly yearns to ${mark(ir.cat, ir.likes, 'Does not match their current work')}.`);
      }
    } else {
      out.push('Wanders without a kingdom.');
    }

    if (u.learning && world.units.get(u.learning.mentor)) {
      out.push(`Is learning ${SKILL_NOUN[u.learning.skill]} from {u:${u.learning.mentor}}.`);
    }

    // 4. What life has taught
    const trained = Object.keys(u.ev).filter((s) => u.ev[s] >= 6).sort((a, b) => u.ev[b] - u.ev[a]).slice(0, 2);
    if (trained.length) {
      const bits = trained.map((s) => {
        const e = u.ev[s];
        const lvl = e >= 26 ? 'a master of' : e >= 16 ? 'skilled in' : 'practiced in';
        return `${lvl} ${mark(SKILL_CAT[s], SKILL_NOUN[s], 'Learned through effort, not birth')}`;
      });
      out.push(`Has become ${bits.join(' and ')}.`);
    }

    // 5. Spells
    if (u.spells && u.spells.size) {
      out.push(`Knows ${[...u.spells].map((s) => mark('magic', s, 'A spell this mage has learned')).join(', ')}.`);
    }

    // 6. Body and mind right now
    const state = [];
    if (u.sleep) state.push(mark('rest', 'asleep', 'Resting. Wakes if attacked, or when an alarm sounds'));
    else {
      if (kingdom && kingdom.watch && kingdom.watch.has(u.id)) state.push(mark('status', 'on night watch', 'Stays awake at night, guarding the kingdom and raising the alarm'));
      else if (kingdom && kingdom.raid && kingdom.raid.ids.has(u.id)) state.push(mark('status', 'on a night raid', 'Marching against a sleeping enemy'));
    }
    state.push(hungerWord(u.hunger));
    state.push(energyWord(u.energy));
    if (u.anger >= 60) state.push(mark('temper', 'furious', 'About to lash out'));
    else if (u.anger >= 30) state.push(mark('temper', 'angry', 'Ready to hit back'));
    else if (u.anger >= 12) state.push('irritated');
    if (u.status.poison > 0) state.push(mark('status', 'poisoned', 'Loses a heart every 2 seconds'));
    if (u.status.burn > 0) state.push(mark('status', 'burning', 'Loses a heart whenever they attack or cast'));
    if (u.status.confused > 0) state.push(mark('status', 'confused', 'Stumbles around and strikes at random'));
    out.push(`Right now: ${state.join(', ')}.`);

    // 7. Hearts and relationships
    const rel = [];
    if (u.partner != null) rel.push(`In love with {u:${u.partner}}.`);
    if (u.mourning != null) rel.push(`Still mourns {u:${u.mourning}}.`);
    if (u.exes.length) rel.push(`Once shared life with ${u.exes.map((id) => `{u:${id}}`).join(' and ')}.`);
    if (u.children.length) rel.push(`Parent of ${u.children.map((id) => `{u:${id}}`).join(', ')}.`);
    if (u.parents.length) rel.push(`Child of ${u.parents.map((id) => `{u:${id}}`).join(' and ')}.`);
    const friends = [], rivals = [];
    for (const [id, m] of Object.entries(u.memory)) {
      if (+id === u.partner) continue;
      if (m.aff >= 55) friends.push([id, m.aff]);
      else if (m.aff <= -45) rivals.push([id, m.aff]);
    }
    friends.sort((a, b) => b[1] - a[1]); rivals.sort((a, b) => a[1] - b[1]);
    if (friends.length) rel.push(`Close to ${friends.slice(0, 3).map(([id]) => `{u:${id}}`).join(', ')}.`);
    if (rivals.length) rel.push(`Does not trust ${rivals.slice(0, 3).map(([id]) => `{u:${id}}`).join(', ')}.`);
    const traitors = Object.entries(u.memory).filter(([, m]) => m.betrayer).map(([id]) => `{u:${id}}`);
    if (traitors.length) rel.push(`Remembers the betrayal of ${traitors.slice(0, 3).join(', ')}.`);
    if (u.forgave.length) rel.push(`Has forgiven ${u.forgave.slice(-2).map((id) => `{u:${id}}`).join(', ')}.`);
    if (rel.length) out.push(rel.join(' '));

    return out;
  }

  // ---------------------------------------------------------------- speech
  const BANK = {
    hungry: ['My belly is empty...', 'I should find something to eat.', 'Hunger gnaws at me.', 'Food. I need food.'],
    starving: ["I can't last much longer...", 'So hungry... anything...', 'The world is spinning...'],
    eat_granary: ['To the granary, then.', 'There must be bread stored.', 'The granary will have something.'],
    eat_hunt: ["I'll hunt for my supper.", 'That beast will make a meal.', 'Time to catch something.'],
    eat_pocket: ['Time for a bite.', 'I saved something for later.'],
    hunt: ['Fresh meat for the kingdom!', 'Quiet... the prey is near.', "I'll bring back a good catch."],
    deliver_meat: ['The granary needs this.', 'Bringing meat home.'],
    plant: ['Time to sow some seeds.', 'The soil is ready.', 'Let the planting begin.'],
    tend: ['Grow well, little crops.', 'Sun, rain and patience.'],
    harvest: ['The crops are ripe!', 'A fine harvest this time.', 'Time to bake some bread.'],
    deliver_bread: ['Fresh bread for everyone!', 'Off to the granary with this.'],
    cook: ['Let me cook something special.', 'A real meal, coming up.', "I'll turn this into a feast."],
    train: ['Back to my training.', 'Again. Once more.', 'My arm grows stronger.'],
    study: ['The old words of power...', 'More practice with spells.', 'I must sharpen my craft.'],
    revenge: ["You'll pay for that!", 'Nobody strikes me and walks away!', "Now you've done it!"],
    brawl: ["I've had enough of you!", 'You again? Right.', 'Say that to my face!'],
    defend: ['Leave them alone!', 'Stand down, now!', 'Back off, brute!'],
    flee: ["I can't take much more!", 'Retreat! Retreat!', 'Not worth dying for!'],
    monk_flee: ['Please, I want no fight.', 'Peace, friend. Peace.', 'Violence solves nothing.'],
    mediate: ['Calm yourself, friend.', 'Let us use words, not fists.', 'Breathe. This is not worth it.'],
    calmed: ["...You're right. Enough.", 'I lost my temper. Sorry.', "Fine. I'm calm now."],
    confused: ['Wha... who are you?!', 'Everything is spinning!', 'Why are there three of you?'],
    war_declare: ['We will not be threatened!', 'Gather the swordsmen. This is war!', 'They have pushed us too far.'],
    war_march: ['For the kingdom!', 'To arms!', 'They will not take our home.'],
    war_defend: ['Defend our home!', 'They are at our gates!'],
    peace: ['Enough blood. Let there be peace.', 'Let the swords rest.'],
    found: ['Let us raise a kingdom here!', 'This land shall be ours.', 'Together we are stronger!'],
    found_reply: ["Aye, I'm with you.", 'Gladly!', 'Lead the way.'],
    join: ['May I join your kingdom?', 'I seek a home among you.', 'Your banner looks welcoming.'],
    welcome: ['Welcome, friend.', 'Come, there is room.', 'A new hand is always welcome.'],
    love_confess: ['{n}, my heart beats for you.', '{n}... I think I love you.'],
    love_accept: ['I feel the same way.', "Yes. I'd hoped you'd say that."],
    love_reject: ["I'm sorry. I don't feel that way.", "Perhaps we're better as friends."],
    argue: ['You never listen!', 'Here we go again!', "I can't believe you!"],
    divorce: ["It's over between us.", 'We want different lives now.'],
    child: ['A new soul joins us!', 'Our family grows.'],
    chat: ['Lovely day, is it not?', 'Have you eaten yet?', 'I heard a rumor from the east.', 'The animals are restless lately.', 'What a quiet world.', 'I dreamed of a golden field.', 'Do you ever wonder why we are here?'],
    teach_ask: ['{n}, would you teach me?', 'Master {n}, show me how.'],
    teach_ok: ['Watch closely.', 'Let me show you.', 'Good. Pay attention.'],
    visit: ["I'll go see my old friend {n}.", "It's been too long since I saw {n}."],
    beg: ['Could you spare some food?', 'Please... I am starving.'],
    give: ['Take it, traveler.', 'No one should starve.'],
    refuse: ['We have none to spare.', 'Not from our stores.'],
    defect: ["I can't stay here anymore.", 'This kingdom is no longer my home.'],
    traitor: ['Traitor!', 'How could you leave us?'],
    forgive: ['I forgive you, {n}.', 'The past is the past.'],
    succeed: ["I'll lead now.", 'The crown passes to me.'],
    mourn: ['{n}... no...', 'I will never forget {n}.'],
    heal: ["Hold still, I'll mend you.", 'Healing light, come forth.'],
    cast_poison: ['Taste the venom!', 'Wither, foe!'],
    cast_burn: ['Burn!', 'Feel the flame!'],
    cast_confuse: ['Lose your way!', 'Spin, spin, spin!'],
    learn_spell: ['I learned a new spell!', 'A new spell is mine!'],
    new_interest: ["I'm suddenly curious about {w}.", 'I feel pulled toward {w} now.', 'Maybe {w} is my true calling.'],
    new_role: ['I shall be a {w}.', 'The kingdom needs a {w}.', '{W} it is, then.'],
    celebrate: ['What a day!', 'Good times.'],
    sleepy: ['Time to rest.', 'My bed is calling.', 'What a long day...', 'Goodnight, everyone.'],
    dream: ['Mmm... bread...', 'Zzz...', '...golden fields...', 'No... five more minutes...', '...so many stars...', 'Zzz... zzz...'],
    watch: ['I have the watch tonight.', 'Sleep well. I will guard the walls.', 'My eyes stay open till dawn.'],
    alarm: ['Enemies at the gates!', 'Wake up! We are under attack!', 'To arms! Raiders!'],
    woken: ['Raiders?! In the dark?!', 'Not now... I was sleeping!', 'To arms, even half-asleep!', 'Who attacks at night?!'],
    raid: ['Strike while they sleep!', 'We march under the moon.', 'The night is ours.'],
    tired_fight: ['So... tired...', "I can't lift my sword...", 'My arms are lead.'],
    yawn: ['*yawn*', 'So sleepy...'],
  };

  const POEM_A = ['The wind', 'A star', 'The river', 'Our home', 'The moon', 'My heart', 'The field'];
  const POEM_B = ['sleeps beneath the hill', 'sings of days gone by', 'remembers every name', 'waits for morning light', 'carries all our dreams', 'dances with the rain', 'hums an old, soft song'];

  function line(key, rng, vars) {
    if (key === 'poem') return `${rng.pick(POEM_A)} ${rng.pick(POEM_B)}...`;
    const arr = BANK[key] || ['...'];
    let s = rng.pick(arr);
    if (vars) {
      s = s.replace(/\{n\}/g, vars.n || '').replace(/\{w\}/g, vars.w || '').replace(/\{W\}/g, cap(vars.w || ''));
    }
    return s;
  }

  K.words = { tierOf, TRAITS, TRAIT_KEYS, ROLES, ROLE_KEYS, SKILL_NOUN, describe, line, BANK, hungerWord, energyWord };
})();
