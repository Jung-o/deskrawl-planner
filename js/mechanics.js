// Game mechanics model for the Deskrawl planner.
//
// The data files (data/deskrawl-data.js) hold every number the game publishes: ability
// percentages, talent values, affix ranges, runes, gems, legendary texts. What they do NOT hold
// is how those numbers combine (stat scaling, armor curve, base stats...). Everything that is a
// guess lives in DEFAULT_MECH below and is editable from the "Assumptions" tab.
'use strict';

window.MECH = (function () {
  // ---------------------------------------------------------------- assumptions (editable)
  const DEFAULT_MECH = [
    // [key, default, label, help, group]
    ['dmgPerMainStat', 0.01, 'Damage per main stat point', 'Confirmed in game: each point of the main stat (STR Warrior, DEX Hunter/Monk, INT Sorcerer) adds 1% increased damage.', 'Offense'],
    ['baseCritChance', 0.05, 'Base critical hit chance', 'Crit chance before any bonus.', 'Offense'],
    ['baseCritDamage', 0.5, 'Base critical hit damage', 'Confirmed in game: a naked character shows 150% Critical Hit Damage (crits deal 150%, i.e. +50%).', 'Offense'],
    ['vulnerableBase', 0.2, 'Vulnerable bonus damage', 'Extra damage taken by [Vulnerable] enemies before "Damage vs Vulnerable" (which the game says is added to it).', 'Offense'],
    ['noWeaponDamage', 10, 'Weapon damage with no weapon', 'Weapon damage used when the weapon slot is empty.', 'Offense'],
    ['noWeaponSpeed', 1.0, 'Weapon speed with no weapon', 'Confirmed in game: 1.0 (naked Monk with +24% attack speed shows 1.2).', 'Offense'],
    ['bleedPct', 2.5, 'Bleeding total damage', 'Bleeding deals this x weapon damage over its duration (abilities say 250%).', 'Damage over time'],
    ['bleedDur', 5, 'Bleeding duration (s)', '', 'Damage over time'],
    ['poisonPctPerSec', 0.15, 'Poisoned damage / second / stack', 'Not published. Weapon damage dealt each second by one stack of [Poisoned].', 'Damage over time'],
    ['poisonDur', 4, 'Poisoned duration (s)', 'Not published.', 'Damage over time'],
    ['poisonMaxStacks', 10, 'Poisoned max stacks', 'Not published.', 'Damage over time'],
    ['burnPctPerSec', 0.2, 'Burn damage / second', 'Not published. Weapon damage dealt each second by [Burn].', 'Damage over time'],
    ['abilityLevelPerRune', 1, 'Ability levels per linked rune', 'Runes that "raise the level of" an ability add this many levels. Levels above 10 are extrapolated.', 'Offense'],
    ['baseHealth', 100, 'Base health at level 1', 'Fits the game: a level-24 Monk with no gear (no life talents) has 468 life = 100 + 16 x 23.', 'Base stats'],
    ['healthPerLevel', 16, 'Base health per level', 'Fits the game (see base health). One data point so far: check at another level.', 'Base stats'],
    ['baseDodge', 0.05, 'Base dodge chance', 'Confirmed in game: a level-24 Monk with no gear shows 17% dodge with the 8/8 Dodge Chance talent (12%), so 5% base.', 'Base stats'],
    ['baseMana', 100, 'Base max mana', 'Confirmed in game: 100.', 'Base stats'],
    ['baseManaRegen', 2, 'Base mana regeneration / s', '', 'Base stats'],
    ['baseMainStat', 10, 'Base main stat', 'Confirmed for the Monk: 10 Dexterity with no gear and no Dexterity talent. Assumed the same for the other classes.', 'Base stats'],
    ['mainStatPerLevel', 0, 'Main stat gained per level', 'Confirmed in game: none — the main stat only comes from items, talents, gems and runes.', 'Base stats'],
    ['baseArmor', 0, 'Base armor', '', 'Base stats'],
    ['baseMagicResist', 0, 'Base magic resist', '', 'Base stats'],
    ['armorPerStr', 1, 'Armor per Strength', 'Strength "also grants X Armor".', 'Defense'],
    ['dodgePerDex', 0, 'Dodge chance per Dexterity', 'Confirmed in game: Dexterity grants no dodge (it grants Critical Damage Reduction instead).', 'Defense'],
    ['critDrPerDex', 0.0005, 'Critical damage reduction per Dexterity', 'Fits the game: 38 Dexterity tooltip says "+2%" (1.9%), and 10 Dexterity + 0.2% base = 0.7% on a gearless Monk.', 'Defense'],
    ['baseCritDR', 0.002, 'Base critical damage reduction', 'Fits the game together with 0.05% per Dexterity (see above). To confirm: the Dexterity tooltip with 10 Dexterity should say 0.5%.', 'Defense'],
    ['mrPerInt', 1, 'Magic resist per Intelligence', 'Intelligence "also grants X Magic Resist".', 'Defense'],
    ['armorK', 50, 'Armor constant (x enemy level)', 'Confirmed in game: reduction = Armor / (Armor + 50 x enemy level). 983 armor = 45% at level 24.', 'Defense'],
    ['mrK', 50, 'Magic resist constant (x enemy level)', 'Confirmed in game: same curve as armor. 146 magic resist = 11% at level 24.', 'Defense'],
    ['drCap', 0.75, 'Damage reduction cap', 'Cap for each separate reduction (armor, resist, typed reductions).', 'Defense'],
    ['dodgeCap', 0.75, 'Dodge chance cap', '', 'Defense'],
    ['cdrCap', 0.75, 'Cooldown reduction cap', '', 'Offense'],
    ['electrostaticPerStack', 0.05, 'Electrostatic: lightning damage taken per stack', 'Not published: [Electrostatic] makes the enemy take increased Lightning damage.', 'Offense'],
    ['enemyCritMulti', 1.5, 'Enemy critical hit multiplier', 'Used for the "crit hit" EHP line; reduced by Critical Damage Reduction.', 'Defense'],
  ];

  // ---------------------------------------------------------------- configuration (PoB "Config" tab)
  const CONFIG_DEFS = [
    ['General', [
      ['enemies', 'number', 1, 'Enemies hit by area skills', 'Used for the AoE DPS line.'],
      ['buffMode', 'select', 'uptime', 'Self-buffs from Special abilities', 'Average by uptime, or treat as always active.', [['uptime', 'Average by uptime'], ['always', 'Always active'], ['never', 'Ignore']]],
      ['killsPerSec', 'number', 0, 'Kills per second', 'For Life/Mana on Kill.'],
      ['manaFull', 'number', 50, 'Mana % full', 'For Charged Ring.'],
    ]],
    ['Enemy', [
      ['enemyLevel', 'number', 0, 'Enemy level (0 = hero level)', 'Used by the armor / resist curve.'],
      ['enemyElite', 'check', true, 'Enemy is Elite / Boss', ''],
      ['enemyHealthy', 'check', false, 'Enemy is Healthy (>80% HP)', ''],
      ['enemyInjured', 'check', false, 'Enemy is Injured (<30% HP)', ''],
      ['enemyDistant', 'check', true, 'Enemy is Distant (>6 units)', ''],
      ['enemyVulnerable', 'check', false, 'Enemy is [Vulnerable]', ''],
      ['enemyPoisoned', 'check', false, 'Enemy is [Poisoned]', ''],
      ['enemyBleeding', 'check', false, 'Enemy is [Bleeding]', ''],
      ['enemyBurning', 'check', false, 'Enemy is [Burning]', ''],
      ['enemySlowed', 'check', false, 'Enemy is Slowed / Chilled', ''],
      ['enemyImmobilized', 'check', false, 'Enemy is Immobilized', ''],
      ['enemyStunned', 'check', false, 'Enemy is Stunned', ''],
      ['enemyDazed', 'check', false, 'Enemy is [Dazed]', ''],
      ['enemyFrozen', 'check', false, 'Enemy is [Frozen]', ''],
      ['enemyHit', 'number', 1000, 'Enemy raw hit damage', 'One hit before your mitigation. Hits to die = Toughness / this.'],
      ['electrostatic', 'number', 0, 'Electrostatic stacks on the enemy', 'Each stack: more Lightning damage taken (see Assumptions). Max 5 before Thundering consumes them.'],
      ['enemyAttackRate', 'number', 1, 'Enemy hits on you per second', 'Drives on-dodge effects (Mirror Steps, Zephyr’s Flow).'],
    ]],
    ['Player', [
      ['playerHealthy', 'check', true, 'You are Healthy (>80% HP)', ''],
      ['surrounded', 'check', false, 'At least 3 enemies nearby', ''],
      ['noEnemiesNearby', 'check', false, 'No enemies nearby', 'Lone Hunter.'],
      ['singleEnemy', 'check', true, 'Only one living enemy left', 'Ring of Dragonslayer.'],
      ['standingStill', 'check', true, 'Standing still', 'Ring of Revelation (20 stacks).'],
      ['recentKill', 'check', false, 'Killed recently', 'Crown of the Fallen King.'],
      ['recentPotion', 'check', false, 'Drank a potion recently', 'Battle Draught Belt, Greaves of the Stalwart Tonic.'],
      ['furiousStacks', 'number', 20, 'Furious Fist stacks', ''],
      ['arcaneCharge', 'number', 20, 'Arcane Charge stacks', ''],
      ['bloodlust', 'number', 10, 'Bloodlust stacks', ''],
      ['crescentMomentum', 'number', 10, 'Crescent Momentum stacks', ''],
    ]],
  ];

  // ---------------------------------------------------------------- abilities
  // Damage parts per ability. v = value key in the data (or `fixed`), el = element,
  // hits = hits on the main target per cast, aoe = hits every enemy, cap = max targets,
  // channel = seconds the cast occupies. Anything marked `guess` is not published.
  const P = (v, el, o) => Object.assign({ v, el, hits: 1 }, o || {});
  const ABILITY_META = {
    // Warrior
    'valiant-strike': { parts: [P('weaponDamage', 'physical')], applies: ['Vulnerable'] },
    'cleave': { parts: [P('weaponDamage', 'physical', { aoe: true })] },
    'bloodblade': { parts: [P('weaponDamage', 'physical')], bleed: 1, applies: ['Bleeding'] },
    'steady-blow': { parts: [P('weaponDamage', 'physical')] },
    'flame-strike': { parts: [P('weaponDamage', 'fire')] },
    'half-moon-slash': { parts: [P('weaponDamage', 'physical', { aoe: true })] },
    'whirlwind': { parts: [P('weaponDamage', 'physical', { aoe: true, hits: 3 })], guess: 'Hits per cast (3) not published.' },
    'rending-onslaught': { parts: [P('weaponDamage', 'physical', { aoe: true, hits: 3 })], bleed: 1, applies: ['Bleeding'] },
    'rage-shout': { buff: { dur: 4, mods: v => [{ s: 'attack-speed-pct', v: v.attackSpeed }] } },
    'rage-shield': { buff: { durKey: 'duration', shieldKey: 'shield' } },
    'deadly-hook': { parts: [P('weaponDamage', 'physical', { aoe: true })], applies: ['Vulnerable'] },
    'earthstrike': { parts: [P('weaponDamage', 'physical', { aoe: true })], applies: ['Stunned'] },
    'iron-thorn': { thornPulse: true, buff: { durKey: 'duration', mods: v => [{ s: 'thorns-pct', v: v.thorns }] }, guess: 'Pulse = 100% of Thorns per second (value not published).' },
    'molten-might': { manaPctOnCast: 'rage', buff: { durKey: 'duration', mods: v => [{ s: 'strong-attack-damage-pct', v: v.damage }, { s: 'mana-cost-reduction-pct', v: v.costReduction }] } },
    // Hunter
    'poison-shot': { parts: [P('weaponDamage', 'poison')], poison: { chanceKey: 'chance', stacks: 1 }, applies: ['Poisoned'] },
    'arcane-bomb': { parts: [P('weaponDamage', 'arcane', { aoe: true })] },
    'knife-barrage': { parts: [P('weaponDamage', 'physical', { cap: 3 })] },
    'twin-arrows': { parts: [P('weaponDamage', 'physical', { hits: 2, cap: 2 })] },
    'steady-shot': { parts: [P('value', 'physical', { aoe: true })] },
    'multishot': { parts: [P('weaponDamage', 'arcane', { aoe: true })] },
    'rapid-fire': { parts: [P('weaponDamage', 'physical', { hits: 10 })], channel: 2, guess: '10 arrows per 2 s channel (not published).' },
    'venom-bolt': { parts: [P('weaponDamage', 'poison', { aoe: true })], poison: { chance: 1, stacks: 1 }, applies: ['Poisoned'] },
    'poison-trap': { parts: [P('weaponDamage', 'poison', { aoe: true })], poison: { chanceKey: 'chance', stacks: 2 }, applies: ['Poisoned'] },
    'shockwave': { parts: [P('weaponDamage', 'physical', { aoe: true })], applies: ['Stunned'] },
    'flare': { applies: ['Vulnerable'] },
    'arcane-arrowstorm': { parts: [P('weaponDamage', 'arcane', { aoe: true, hits: 6 })], guess: '6 hits per cast (not published).' },
    'phantom-form': { buff: { durKey: 'duration', mods: v => [{ s: 'dodge-chance-pct', v: v.dodge }, { s: 'attack-speed-pct', v: v.attackSpeed }] } },
    'frost-trap': { parts: [P('weaponDamage', 'cold', { aoe: true })], applies: ['Frozen'] },
    // Sorcerer
    'fire-ball': { parts: [P('weaponDamage', 'fire', { aoe: true })] },
    'ice-shards': { parts: [P('weaponDamage', 'cold')] },
    'electrocute': { parts: [P('weaponDamage', 'lightning', { aoe: true })] },
    'flame-lightning': { parts: [P('fireDamage', 'fire'), P('lightningDamage', 'lightning')] },
    'flame-breath': { parts: [P('weaponDamage', 'fire', { aoe: true })], burn: true, applies: ['Burning'] },
    'ice-meteor': { parts: [P('weaponDamage', 'cold', { aoe: true, hits: 6 })], applies: ['Slowed'], guess: '6 ticks over the 3 s field (not published).' },
    'lightning-storm': { parts: [P('weaponDamage', 'lightning', { cap: 3 })] },
    'frost-beam': { parts: [P('weaponDamage', 'cold', { aoe: true, hits: 6 })], channel: 3, applies: ['Slowed'], guess: '6 ticks over the 3 s channel (not published).' },
    'ice-nova': { parts: [P(null, 'cold', { aoe: true, fixed: 0.1 })], applies: ['Frozen'] },
    'fire-elemental': { parts: [P(null, 'fire', { fixed: 1, hits: 10 })], summon: true, guess: 'Elemental: 100% weapon damage x 10 shots per cast (not published).' },
    'ice-block': { channelKey: 'duration' },
    'fire-meteor': { parts: [P('weaponDamage', 'fire', { aoe: true })], burn: true, applies: ['Burning'] },
    'flame-aura': { buff: { durKey: 'duration', mods: v => [{ s: 'critical-hit-chance-pct', v: v.critChance }, { s: 'critical-hit-damage-pct', v: v.critDamage }] } },
    'lightning-cloud': { parts: [P('weaponDamage', 'lightning', { aoe: true, hits: 8 })] },
    // Monk
    'threefold-strike': { parts: [P('damage', 'physical', { hits: 2 / 3 }), P('damage2', 'physical', { hits: 1 / 3 })] },
    'furious-fist': { parts: [P('damage', 'physical')], stackBuff: true },
    'seismic-strike': { parts: [P('damage', 'physical'), P('damage2', 'physical', { aoe: true, hits: 1 / 3 })] },
    'chi-bolt': { parts: [P('damage', 'physical')] },
    'sacred-judgment': { parts: [P('damage', 'lightning'), P('damage2', 'lightning', { aoe: true, others: true })] },
    'piercing-lunge': { parts: [P('damage', 'physical', { aoe: true })] },
    'whirlwind-staff': { parts: [P('damage', 'physical', { aoe: true, hits: 4 })], guess: '4 tornado hits per cast on one enemy (not published).' },
    'golden-palms': { parts: [P('damage', 'physical', { aoe: true })] },
    'sacred-orbs': { parts: [P('damage', 'lightning', { aoe: true, hits: 5 })], guess: '5 orb hits per enemy per cast (not published).' },
    'spirit-stream': {},
    'charge': { parts: [P('weaponDamage', 'physical', { aoe: true })], applies: ['Stunned'] },
    'spirit-twin': { twin: true },
    'wind-steps': { buff: { durKey: 'duration', mods: v => [{ s: 'dodge-chance-pct', v: v.dodge }] } },
    'divine-thunder': { parts: [P('damage', 'lightning', { aoe: true, hits: 4 })], applies: ['Dazed'], guess: '4 pulses per cast (not published).' },
  };

  // ---------------------------------------------------------------- talent values missing from the game data
  // Filled in from in-game tooltips. Same shape as the data: per point, last entry = max points.
  const perPoint = (n, step) => Array.from({ length: n }, (_, i) => +(step * (i + 1)).toFixed(4));
  const TALENT_VALUES = {
    'mirror-steps': { value: { f: 'pct', s: '', v: [0.6] }, duration: { f: 'number', s: 's', v: [4] } },
    'sheltering-breath': { value: { f: 'pct', s: '', v: perPoint(5, 0.03) }, duration: { f: 'number', s: 's', v: perPoint(5, 3) } },
    'iron-constitution': { reduction: { f: 'pct', s: '', v: [0.2] }, duration: { f: 'number', s: 's', v: [3] } },
    'chain-force': { casts: { f: 'number', s: '', v: [7] } },
    'gathered-force': { casts: { f: 'number', s: '', v: [3] } },
  };

  // ---------------------------------------------------------------- talents
  // id -> (v) => mods. `v` holds every value of the talent at its current points.
  // Mod: { s: stat, v: value, ab?: [ability ids], tag?: ability tag, role?: basic|strong|special,
  //        cond?: config flag, up?: 'buff:<ability id>' (scaled by that buff's uptime) }
  const T = {
    // Hunter
    'dexterity': v => [{ s: 'dexterity', v: v.value }],
    'dodge-chance': v => [{ s: 'dodge-chance-pct', v: v.value }],
    'attack-speed': v => [{ s: 'attack-speed-pct', v: v.value1 }, { s: 'damage', v: v.value2 }],
    'long-shot': v => [{ s: 'damage-vs-distant-pct', v: v.value }],
    'fleet-footed': v => [{ s: 'bonus-move-speed-pct', v: v.value }],
    'sharpshooter': v => [{ s: 'critical-hit-chance-pct', v: v.value, cond: 'enemyDistant' }],
    'venom-lore': v => [{ s: 'damage-vs-poisoned-pct', v: v.value1 }, { s: 'poison-damage-reduction-pct', v: v.value2 }],
    'hardened-hide': v => [{ s: 'critical-damage-reduction-pct', v: v.value }],
    'survival-instinct': v => [{ s: 'dodge-chance-pct', v: v.value, cond: 'surrounded' }],
    'quick-traps': (v, t) => [{ s: 'cooldown-reduction-pct', v: v.value, ab: t.hit }],
    'arcane-knowledge': v => [{ s: 'arcane-damage-pct', v: v.value1 }, { s: 'bonus-magic-resist-pct', v: v.value2 }],
    'double-tap': v => [{ s: 'more', v: v.chance, role: 'basic', label: 'Double Tap' }],
    'lone-hunter': v => ['attack-speed-pct'].map(s => ({ s, v: v.attackSpeed, cond: 'noEnemiesNearby' }))
      .concat(['physical-damage-pct', 'poison-damage-pct', 'arcane-damage-pct'].map(s => ({ s, v: v.damage, cond: 'noEnemiesNearby' }))),
    'rapid-reset': (v, t) => [{ s: 'cd-per-strong', v: v.value, ab: t.hit }],
    'efficient-assault': (v, t) => [{ s: 'mana-cost-pct', v: v.value, ab: t.hit }],
    'improved-poison-shot': (v, t) => [{ s: 'poison-chance', v: v.chance, ab: t.hit }],
    'deadly-traps': (v, t) => [{ s: 'critical-hit-chance-pct', v: v.value, ab: t.hit }],
    'deadly-knife-barrage': (v, t) => [{ s: 'critical-hit-chance-pct', v: v.value, ab: t.hit }],
    'knife-storm': (v, t) => [{ s: 'targets-add', v: v.value, ab: t.hit }],
    'improved-twin-arrows': (v, t) => [{ s: 'more', v: v.damage, ab: t.hit, label: 'Improved Twin Arrows' }],
    'physical-brutality': (v, t) => [{ s: 'critical-hit-damage-pct', v: v.value, ab: t.hit }],
    'sustained-fire': (v, t) => [{ s: 'channel-more', v: v.value, ab: t.hit }],
    'dazzling-recovery': v => [{ s: 'mana-per-cast', v: v.mana, tag: 'Blinding Shot' }],
    'rapid-flare': (v, t) => [{ s: 'cooldown-reduction-pct', v: v.value, ab: t.hit }],
    'arcane-charge': (v, t, c) => [{ s: 'arcane-damage-pct', v: v.value * Math.min(50, c.arcaneCharge || 0) }],
    // Monk
    'dexterity-2': v => [{ s: 'dexterity', v: v.value }],
    'dodge-chance-2': v => [{ s: 'dodge-chance-pct', v: v.value }],
    'movement-speed': v => [{ s: 'bonus-move-speed-pct', v: v.value }],
    'vitality': v => [{ s: 'max-health', v: v.value }],
    'max-mana': v => [{ s: 'max-mana', v: v.value }],
    'attack-speed-2': v => [{ s: 'attack-speed-pct', v: v.value }],
    'physical-damage': v => [{ s: 'physical-damage-pct', v: v.value }],
    'healing-magic-resist': v => [{ s: 'healing-received-pct', v: v.value }, { s: 'magic-resist', v: v.resistance }],
    'mana-on-kill': v => [{ s: 'mana-on-kill', v: v.value }],
    'sweeping-discipline': (v, t) => [{ s: 'ability-damage-pct', v: v.value, ab: t.hit }],
    'enhance-lightning-abilities-critical-hit-chance': (v, t) => [{ s: 'critical-hit-chance-pct', v: v.value, ab: t.hit }],
    'lightning-damage': v => [{ s: 'lightning-damage-pct', v: v.value }],
    'chain-force': v => [{ s: 'more', v: v.value / v.casts, role: 'basic', label: `Chain Force (1 in ${v.casts} casts)` }],
    'enhance-threefold-strike-critical-damage': (v, t) => [{ s: 'critical-hit-damage-pct', v: v.value, ab: t.hit }],
    'exploit-weakness': v => [{ s: 'damage-vs-dazed-pct', v: v.value }],
    'enhance-piercing-lunge-damage': (v, t) => [{ s: 'ability-damage-pct', v: v.value, ab: t.hit }],
    'gathered-force': v => [{ s: 'gathered', v: v.value, per: v.casts }],
    'sheltering-breath': v => [{ s: 'damage-taken-less', v: v.value, upCast: ['spirit-stream', v.duration] }],
    'mirror-steps': v => [{ s: 'physical-damage-pct', v: v.value, upDodge: v.duration }],
    'iron-constitution': v => [{ s: 'cheat-death', v: v.reduction, dur: v.duration, cd: v.cooldown }],
    'enhance-sacred-orbs-speed': (v, t) => [{ s: 'hits-more', v: v.value, ab: ['sacred-orbs'] }],
    'zephyrs-flow': v => [{ s: 'mana-per-dodge', v: v.value }],
    'heavy-hands': (v, t) => [{ s: 'critical-hit-damage-pct', v: v.value, ab: t.hit }],
    'slipstream': v => [{ s: 'dodge-chance-pct', v: v.value, upCast: ['charge', v.duration] }],
    'enhance-spirit-twin-duration': (v, t) => [{ s: 'duration-more', v: v.value, ab: t.hit }],
    'vigor': (v, t) => [{ s: 'critical-hit-chance-pct', v: v.value, ab: t.hit }],
    'fundamentals': (v, t) => [{ s: 'ability-damage-pct', v: v.value, ab: t.hit }],
    'enhance-golden-palms-damage-mana-cost': (v, t) => [{ s: 'ability-damage-pct', v: v.damage, ab: t.hit }, { s: 'mana-cost-pct', v: v.mana, ab: t.hit }],
    'formless': v => [{ s: 'critical-hit-damage-pct', derived: st => v.value * st.dodge }],
    'enhance-divine-thunder-damage': (v, t) => [{ s: 'ability-damage-pct', v: v.value, ab: t.hit }],
    // Sorcerer
    'arcane-insight': v => [{ s: 'intelligence', v: v.value }],
    'mana-flow': v => [{ s: 'max-mana', v: v.value }],
    'frost-armor': v => [{ s: 'armor', v: v.value }, { s: 'bonus-armor-pct', v: v.armor }],
    'searing-edge': (v, t) => [{ s: 'critical-hit-chance-pct', v: v.value, ab: t.hit }],
    'cold-retribution': v => [{ s: 'bonus-armor-pct', v: v.armor }],
    'shattering-ice': v => [{ s: 'critical-hit-chance-pct', v: v.value, cond: 'enemyFrozen' }],
    'frost-mastery': v => [{ s: 'cold-damage-pct', v: v.value }],
    'conflagration': v => [{ s: 'damage-vs-burned-pct', v: v.value }],
    'mana-regeneration': v => [{ s: 'mana-regen', v: v.value }],
    'mana-conduit': (v, t) => [{ s: 'mana-gen-flat', v: v.value, ab: t.hit }],
    'electrical-shield': v => [{ s: 'bonus-armor-pct', v: v.armor }],
    'storm-executioner': v => [{ s: 'lightning-damage-pct', v: v.lightning }, { s: 'damage-vs-elite-pct', v: v.elite }],
    'flame-ward': v => [{ s: 'fire-damage-pct', v: v.fire }, { s: 'bonus-magic-resist-pct', v: v.magicResist }],
    'enhance-ice-shards-damage': (v, t) => [{ s: 'ability-damage-pct', v: v.value, ab: t.hit }],
    'enhance-electrocute-mana-gain': (v, t) => [{ s: 'mana-gen-flat', v: v.value, ab: t.hit }],
    'enhance-ice-meteor-mana-cost': (v, t) => [{ s: 'mana-cost-pct', v: v.value, ab: t.hit }],
    'enhance-flame-breath-crit-damage': (v, t) => [{ s: 'critical-hit-damage-pct', v: v.value, ab: t.hit }],
    'storm-conduit': v => [{ s: 'proc', v: v.chance, from: ['electrocute'], cast: 'lightning-storm', label: 'Storm Conduit' }],
    'frost-alacrity': (v, t) => [{ s: 'cooldown-reduction-pct', v: v.value, ab: t.hit }],
    'plasma-conduction': (v, t, c) => [{ s: 'ability-damage-pct', v: v.burningDamage, ab: ['flame-lightning'], cond: 'enemyBurning' },
      { s: 'ability-damage-pct', v: v.electrostaticDamage * (c.electrostatic || 0), ab: ['flame-lightning'] }],
    'frozen-reservoir': v => [{ s: 'mana-per-cast', v: v.value * v.chance, ab: ['ice-nova'] }],
    'elemental-fury': (v, t) => [{ s: 'more', v: v.value, ab: t.hit, label: 'Elemental Fury' }],
    'cataclysm': (v, t) => [{ s: 'more', v: v.damage, ab: t.hit, label: 'Cataclysm' }, { s: 'cd-more', v: -v.cooldown, ab: t.hit }],
    'flame-ward-2': v => [{ s: 'bonus-armor-pct', v: v.value, up: 'buff:flame-aura' }, { s: 'bonus-magic-resist-pct', v: v.value, up: 'buff:flame-aura' }],
    'lingering-storm': (v, t) => [{ s: 'hits-more', v: v.value, ab: t.hit }],
    'arcane-reservoir': v => [{ s: 'intelligence', derived: st => v.value * st.maxMana }],
    'arcane-momentum': v => [{ s: 'basic-attack-damage-pct', v: v.value, upSpecial: v.duration }],
    'storm-mastery': (v, t) => [{ s: 'critical-hit-damage-pct', v: v.critDamage, ab: t.hit }, { s: 'lightning-damage-reduction-pct', v: v.resistance }],
    // Warrior
    'strength': v => [{ s: 'strength', v: v.value }],
    'vitality-2': v => [{ s: 'max-health', v: v.value }, { s: 'life-regeneration', v: v.regen }],
    'armor': v => [{ s: 'armor', v: v.value1 }, { s: 'magic-resist', v: v.value2 }],
    'hold-the-line': v => [{ s: 'damage-taken-less', v: v.value, cond: 'surrounded' }],
    'critical-hit-chance': v => [{ s: 'critical-hit-chance-pct', v: v.value }],
    'critical-hit-damage': v => [{ s: 'critical-hit-damage-pct', v: v.value }],
    'thorn': v => [{ s: 'thorns', v: v.value }],
    'weakness-mastery': v => [{ s: 'damage-vs-vulnerable-pct', v: v.value }],
    'thorn-boost': v => [{ s: 'thorns-pct', v: v.value }],
    'enhance-strong-attack-mana': (v, t) => [{ s: 'mana-cost-pct', v: v.value, ab: t.hit }],
    'rage-infusion': (v, t) => [{ s: 'ability-damage-pct', v: v.strongAttackDamage, ab: t.hit }, { s: 'mana-cost-pct', v: v.strongAttackManaCost, ab: t.hit }],
    'enhance-warcry-cooldown': (v, t) => [{ s: 'cooldown-reduction-pct', v: v.value, ab: t.hit }],
    'rage-channeling': v => [{ s: 'mana-per-cast', v: v.value, ab: ['rage-shield'] }],
    'defensive-stance': v => [{ s: 'bonus-armor-pct', v: v.value }],
    'press-the-advantage': v => [{ s: 'damage-vs-stunned-pct', v: v.value }],
    'enhance-valiant-strike-mana-gain': (v, t) => [{ s: 'mana-gen-flat', v: v.value, ab: t.hit }],
    'crescent-harvest': (v, t) => [{ s: 'ability-damage-pct', v: v.damage, ab: t.hit }],
    'peak-condition': v => [{ s: 'bonus-all-damage-pct', v: v.value, cond: 'playerHealthy' }],
    'returning-fury': v => [{ s: 'mana-per-hit-pct', v: v.mana }],
    'butchers-rhythm': (v, t) => [{ s: 'hits-more', v: v.value / 3, ab: t.hit }],
    'focused-technique': (v, t) => [{ s: 'ability-damage-pct', v: v.damage, ab: t.hit }, { s: 'mana-gen-pct', v: v.manaGain, ab: t.hit }],
    'forge-within': v => [{ s: 'strong-attack-damage-pct', v: v.damage }, { s: 'mana-cost-reduction-pct', v: v.costReduction }, { s: 'mana-drain-pct', v: v.mana }],
    'bloodlust': (v, t, c) => [{ s: 'bonus-all-damage-pct', v: v.value * Math.min(10, c.bloodlust || 0) }],
    'counterattack-storm': v => [{ s: 'proc-hit', v: v.damage, el: 'physical', aoe: true, perHits: v.hits, label: 'Counterattack Storm' }],
    'ironblood': v => [{ s: 'thorns', derived: st => v.value * st.maxHealth }],
    'reapers-toll': (v, t) => [{ s: 'hits-more', v: v.value, ab: t.hit }],
  };

  // ---------------------------------------------------------------- legendary / divine effects
  const ITEM_FX = {
    'amber-skull-staff': () => [{ s: 'critical-hit-damage-pct', v: 1, cond: c => c.enemyImmobilized || c.enemySlowed }],
    'battle-draught-belt': () => [{ s: 'bonus-all-damage-pct', v: 0.35, cond: 'recentPotion' }],
    'blackcrow-recurve': () => [{ s: 'proc-hit', v: 7.2, el: 'poison', chance: 0.15, onTag: 'Poison', label: 'Blackcrow flock' }],
    'bulwark-of-wrath': () => [{ s: 'pulse', v: 2.1 / 3, el: 'physical', aoe: true, up: 'buff:rage-shield', label: 'Bulwark of Wrath' }],
    'charged-ring': (c) => [{ s: 'more', v: 0.5 * Math.max(0, Math.min(100, c.manaFull)) / 100, label: 'Charged Ring' }],
    'circlet-of-focus': () => [{ s: 'focus', v: 0.2 }],
    'crown-of-the-fallen-king': () => [{ s: 'attack-speed-pct', v: 0.3, cond: 'recentKill' }],
    'deflecting-handwraps': (c) => [{ s: 'dodge-chance-pct', v: 0.01 * Math.min(20, c.furiousStacks || 0), needAb: 'furious-fist' }],
    'elemental-burst-pauldron': () => ['fire-damage-pct', 'lightning-damage-pct', 'arcane-damage-pct'].map(s => ({ s, v: 0.2, stackStrong: 5 })),
    'evasive-cuirass': () => [{ s: 'physical-damage-reduction-pct', derived: st => 0.5 * st.dodge }],
    'festering-gauntlets': () => [{ s: 'damage-over-time-pct', v: 0.8 }],
    'greaves-of-the-arcane-edge': () => ['Fire', 'Lightning', 'Arcane'].map(tag => ({ s: 'critical-hit-damage-pct', v: 1.5, tag })),
    'greaves-of-the-stalwart-tonic': () => [{ s: 'damage-taken-less', v: 0.3, cond: 'recentPotion' }],
    'hellstorm-mace': () => [{ s: 'proc-hit', v: 10, el: 'lightning', perBasic: 10, label: 'Hellstorm Lightning Strike' }],
    'kabuto-of-the-crimson-tempest': () => [{ s: 'bleed-from', v: 0.3, ab: ['whirlwind'] }],
    'northern-giants-great-axe': () => [{ s: 'extra-part', v: 0.5, el: 'cold', role: 'basic' }],
    'pendant-of-the-surging-mind': () => [{ s: 'critical-hit-chance-pct', v: 0.2, upMana: [100, 4] }],
    'pendant-of-vigor': () => [{ s: 'bonus-all-damage-pct', v: 0.75, cond: 'playerHealthy' }],
    'phantom-mask': () => [{ s: 'arcane-damage-pct', v: 1, up: 'buff:phantom-form' }, { s: 'poison-damage-pct', v: 1, up: 'buff:phantom-form' }],
    'ragefire-gauntlets': () => [{ s: 'mana-cost-pct', v: -0.3, ab: ['flame-strike'] }],
    'raincaller-bow': () => [{ s: 'proc', v: 0.1, fromRole: 'basic', cast: 'arcane-arrowstorm', label: 'Raincaller Bow' }],
    'ring-of-arcane-precision': () => [{ s: 'critical-hit-chance-pct', v: 0.09, tag: 'Arcane' }],
    'ring-of-dragonslayer': () => [{ s: 'attack-speed-pct', v: 0.35, cond: 'singleEnemy' }],
    'ring-of-revelation': () => [{ s: 'basic-attack-damage-pct', v: 2, cond: 'standingStill' }],
    'ring-of-the-third-eye': () => [{ s: 'hits-more', v: 1, ab: ['sacred-orbs'] }],
    'fire-lords-necklace': () => [{ s: 'hits-more', v: 1, ab: ['fire-elemental'] }],
    'serrated-greatsword-of-agony': () => [{ s: 'critical-hit-chance-pct', v: 0.3, cond: 'enemyVulnerable' }],
    'shell-spike-pauldron': () => [{ s: 'thorns', derived: st => 0.1 * st.armor }],
    'soulrender': () => [{ s: 'proc-hit', v: 8, el: 'physical', aoe: true, perHits: 100, label: 'Soul Impact' }],
    'stormcaller-gauntlets': () => [{ s: 'critical-hit-damage-pct', v: 1.5, ab: ['lightning-storm'] }],
    'the-grandmother': () => [{ s: 'critical-hit-chance-pct', v: 0.05 }, { s: 'critical-hit-damage-pct', v: 1.2 }],
    'thornheart-cuirass': () => [{ s: 'thorns-pct', v: 5 }, { s: 'max-health-more', v: -0.15 }],
    'treads-of-the-falling-leaf': () => [{ s: 'attack-speed-pct', v: 0.3, up: 'buff:wind-steps' }],
    'unstoppable-gauntlets': () => [{ s: 'bonus-armor-pct', derived: (st, r) => 0.01 * Math.min(100, 5 * (r.hitsPerSec || 0)) }],
    'vessel-of-the-endless-stream': () => [{ s: 'cast-damage', v: 1.6, hits: 4, el: 'lightning', aoe: true, ab: ['spirit-stream'], label: 'Vessel pulses' }],
    'visage-of-the-undying': () => [{ s: 'damage-taken-less', v: 0.25 }],
    'remnant-of-the-elder-sage': () => [{ s: 'ability-level', v: 10 }],
    'bottomless-potion-belt': () => [{ s: 'bonus-potion-charges', v: 4 }],
  };

  // ---------------------------------------------------------------- rune set bonuses not in the numeric data
  const SET_FX = {
    'trapper-s-legacy': { 2: () => [{ s: 'more', v: 0.6, tag: 'Trap', label: "Trapper's Legacy (2)" }], 4: () => [{ s: 'critical-hit-chance-pct', v: 0.3, tag: 'Trap' }] },
    'deadeye-s-resolve': { 4: () => [{ s: 'damage-taken-less', v: 0.25, upChannel: 'rapid-fire' }] },
    'venomfang': { 6: () => [{ s: 'proc-hit', v: 1.2, el: 'poison', aoe: true, chance: 0.5, fromAb: 'poison-shot', label: 'Venomfang projectile' }] },
    'hundred-hands': { 4: (c) => [{ s: 'physical-damage-pct', v: 0.03 * Math.min(20, c.furiousStacks || 0), needAb: 'furious-fist' }],
      6: () => [{ s: 'proc', v: 0.25, from: ['furious-fist'], cast: 'golden-palms', label: 'Hundred Hands' }] },
    'wheel-of-nine-heavens': { 4: () => [{ s: 'hits-more', v: 1, ab: ['sacred-orbs'] }],
      6: () => [{ s: 'cast-damage', v: 3, el: 'lightning', aoe: true, ab: ['sacred-orbs'], label: 'Orb burst' }] },
    'serpents-tongue': { 4: () => [{ s: 'mana-cost-pct', v: -0.5, ab: ['piercing-lunge'] }] },
    'eye-of-the-storm': { 4: () => [{ s: 'hits-more', v: 0.25, ab: ['whirlwind'] }] },
    'weight-of-the-mountain': { 4: () => [{ s: 'cd-per-basic', v: 0.8, ab: ['earthstrike'] }] },
    'harvest-moon': { 4: (c) => [{ s: 'critical-hit-chance-pct', v: 0.01 * Math.min(20, c.crescentMomentum || 0), needAb: 'half-moon-slash' }, { s: 'mana-regen', v: Math.min(20, c.crescentMomentum || 0), needAb: 'half-moon-slash' }] },
    'strong-shield-of-the-atheron': { 6: () => [{ s: 'critical-hit-chance-pct', v: 0.2, up: 'buff:rage-shield' }, { s: 'critical-hit-damage-pct', v: 0.5, up: 'buff:rage-shield' }] },
  };

  // ---------------------------------------------------------------- text -> stat (minion passives, custom lines)
  // [regex, flat stat, percent stat]
  const TEXT_STATS = [
    [/^(max(imum)? (health|hp))$/, 'max-health', 'bonus-health-pct'],
    [/^(health|hp)$/, 'max-health', 'bonus-health-pct'],
    [/^bonus health$/, null, 'bonus-health-pct'],
    [/^armou?r$/, 'armor', 'bonus-armor-pct'],
    [/^bonus armou?r$/, null, 'bonus-armor-pct'],
    [/^magic resist(ance)?$/, 'magic-resist', 'bonus-magic-resist-pct'],
    [/^(max(imum)? )?mana$/, 'max-mana', 'max-mana-pct'],
    [/^(strength|str)$/, 'strength', null], [/^(dexterity|dex)$/, 'dexterity', null], [/^(intelligence|int)$/, 'intelligence', null],
    [/^(flat )?damage$/, 'damage', 'bonus-all-damage-pct'],
    [/^all damage$/, null, 'bonus-all-damage-pct'],
    [/^(physical|fire|cold|lightning|poison|arcane) damage$/, null, m => m[1] + '-damage-pct'],
    [/^(physical|fire|cold|lightning|poison|arcane) damage reduction$/, null, m => m[1] + '-damage-reduction-pct'],
    [/^basic attack damage$/, null, 'basic-attack-damage-pct'],
    [/^strong attack damage$/, null, 'strong-attack-damage-pct'],
    [/^special ability (bonus )?damage$/, null, 'special-ability-bonus-damage-pct'],
    [/^damage (to|vs\.?|against) (healthy|injured|slowed|immobilized|bleeding|poisoned|vulnerable|stunned|dazed|distant) (enemies|targets)?$/, null, m => 'damage-vs-' + m[2] + '-pct'],
    [/^damage (to|vs\.?|against) (burning|burned) (enemies|targets)?$/, null, 'damage-vs-burned-pct'],
    [/^damage (to|vs\.?|against) elite( and boss)? (enemies)?$/, null, 'damage-vs-elite-pct'],
    [/^damage to enemies more than 6 units away from you$/, null, 'damage-vs-distant-pct'],
    [/^damage over time$/, null, 'damage-over-time-pct'],
    [/^crit(ical)?( hit)? chance$/, null, 'critical-hit-chance-pct'],
    [/^crit(ical)?( hit)? damage$/, null, 'critical-hit-damage-pct'],
    [/^crit(ical)? damage reduction$/, null, 'critical-damage-reduction-pct'],
    [/^attack speed$/, null, 'attack-speed-pct'],
    [/^(move(ment)? speed)$/, null, 'bonus-move-speed-pct'],
    [/^dodge( chance)?$/, null, 'dodge-chance-pct'],
    [/^cooldown reduction$/, null, 'cooldown-reduction-pct'],
    [/^mana cost reduction$/, null, 'mana-cost-reduction-pct'],
    [/^life on hit$/, 'life-on-hit', null], [/^life on kill$/, 'life-on-kill', null], [/^mana on kill$/, 'mana-on-kill', null],
    [/^(life|health) regen(eration)?( per second)?$/, 'life-regeneration', null],
    [/^mana regen(eration)?( per second)?$/, 'mana-regen', null],
    [/^thorns?$/, 'thorns', 'thorns-pct'],
    [/^healing received( from all sources)?$/, null, 'healing-received-pct'],
    [/^(health )?potion charges$/, 'bonus-potion-charges', null],
    [/^damage taken$/, null, 'damage-taken-less'],
  ];

  function textToStat(phrase, isPct) {
    const p = phrase.toLowerCase().replace(/[.\[\]]/g, '').replace(/\s+/g, ' ').trim();
    for (const [re, flat, pct] of TEXT_STATS) {
      const m = p.match(re);
      if (!m) continue;
      const key = isPct ? pct : flat;
      if (!key) return isPct ? null : null;
      return typeof key === 'function' ? key(m) : key;
    }
    return null;
  }

  // Minion passive description -> mods
  function minionMods(m) {
    const out = [];
    for (const p of m.passive) {
      const val = p.vals && p.vals.value;
      if (!val) continue;
      const v = val.v[val.v.length - 1];
      const isPct = val.f === 'pct';
      let d = p.desc.replace(/\{value\}/, '#');
      let s = null, sign = 1;
      let mm;
      if ((mm = d.match(/^\+#\s*(.+)$/))) s = textToStat(mm[1], isPct);
      else if ((mm = d.match(/^Increase # (.+)$/))) s = textToStat(mm[1], isPct);
      else if ((mm = d.match(/^Reduces (\w+) damage taken by #/))) s = textToStat(mm[1] + ' damage reduction', true);
      else if ((mm = d.match(/^Take # less (\w+) damage/))) s = textToStat(mm[1] + ' damage reduction', true);
      else if (/^Restores # Health per second/.test(d)) s = 'life-regeneration';
      else if (/^Restores # Mana per second/.test(d)) s = 'mana-regen';
      else if (/^Restores # Mana per kill/.test(d)) s = 'mana-on-kill';
      else if (/^Restores # Health per kill/.test(d)) s = 'life-on-kill';
      if (s) out.push({ s, v: v * sign, src: 'Minion: ' + p.name });
    }
    return out;
  }

  // Custom modifier lines, e.g. "+50% Physical Damage", "+200 Armor", "25% less damage taken"
  function parseCustom(text) {
    const mods = [], bad = [];
    String(text || '').split(/\n/).forEach(line => {
      const l = line.trim();
      if (!l || l.startsWith('#')) return;
      let m = l.match(/^([+-]?\d+(?:\.\d+)?)\s*(%?)\s*(more|less)?\s*(.+)$/i);
      if (!m) return bad.push(l);
      const num = parseFloat(m[1]), pct = m[2] === '%', word = (m[3] || '').toLowerCase();
      if (word === 'more' && /damage$/i.test(m[4].trim()) && !/taken/i.test(m[4])) {
        mods.push({ s: 'more', v: num / 100, src: 'Custom', label: l });
        return;
      }
      if (word === 'less' && /damage taken/i.test(m[4])) {
        mods.push({ s: 'damage-taken-less', v: num / 100, src: 'Custom' });
        return;
      }
      const s = textToStat(m[4], pct);
      if (!s) return bad.push(l);
      mods.push({ s, v: pct ? num / 100 : num, src: 'Custom' });
    });
    return { mods, bad };
  }

  // Merge the confirmed values into the talent data, so tooltips and calculations both see them.
  for (const t of Object.values(window.DESKRAWL.talents).flat()) {
    if (TALENT_VALUES[t.id]) t.vals = Object.assign({}, t.vals, TALENT_VALUES[t.id]);
  }

  return { DEFAULT_MECH, CONFIG_DEFS, ABILITY_META, TALENT_FX: T, TALENT_VALUES, ITEM_FX, SET_FX, minionMods, parseCustom, textToStat };
})();
