// Calculation engine: build -> stats, per-ability damage, rotation DPS and effective hit pool.
'use strict';

window.Calc = (function () {
  const D = window.DESKRAWL;
  const M = window.MECH;
  const MAIN = { warrior: 'strength', hunter: 'dexterity', monk: 'dexterity', sorcerer: 'intelligence' };
  const ROLE_STAT = { basic: 'basic-attack-damage-pct', strong: 'strong-attack-damage-pct', special: 'special-ability-bonus-damage-pct' };
  const ELEMENTS = ['physical', 'fire', 'cold', 'lightning', 'poison', 'arcane'];
  const COND_DMG = [
    ['enemyHealthy', 'damage-vs-healthy-pct'], ['enemyInjured', 'damage-vs-injured-pct'],
    ['enemySlowed', 'damage-vs-slowed-pct'], ['enemyImmobilized', 'damage-vs-immobilized-pct'],
    ['enemyElite', 'damage-vs-elite-pct'], ['enemyBleeding', 'damage-vs-bleeding-pct'],
    ['enemyDistant', 'damage-vs-distant-pct'], ['enemyPoisoned', 'damage-vs-poisoned-pct'],
    ['enemyBurning', 'damage-vs-burned-pct'], ['enemyStunned', 'damage-vs-stunned-pct'],
    ['enemyDazed', 'damage-vs-dazed-pct'],
  ];
  const STATUS_FLAG = { Vulnerable: 'enemyVulnerable', Poisoned: 'enemyPoisoned', Bleeding: 'enemyBleeding', Burning: 'enemyBurning',
    Slowed: 'enemySlowed', Stunned: 'enemyStunned', Dazed: 'enemyDazed', Frozen: 'enemyFrozen' };

  // ------------------------------------------------------------------ helpers
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function defaults() {
    const mech = {}, cfg = {};
    M.DEFAULT_MECH.forEach(([k, v]) => (mech[k] = v));
    M.CONFIG_DEFS.forEach(([, rows]) => rows.forEach(([k, , v]) => (cfg[k] = v)));
    cfg.autoStatus = true;
    return { mech, cfg };
  }

  function blankBuild(cls) {
    const d = defaults();
    return { v: 1, name: 'New build', cls: cls || 'warrior', level: D.maxLevel, talents: {}, gear: {}, runes: [],
      abilities: [null, null, null, null], abLv: [10, 10, 10, 10], minion: null, cfg: d.cfg, mech: d.mech, custom: '' };
  }

  // value of an ability/talent value table at a level, extrapolating past the table
  function tableVal(arr, lvl) {
    if (!arr || !arr.length) return 0;
    const n = arr.length;
    if (lvl <= n) return arr[Math.max(1, lvl) - 1];
    const step = n > 1 ? arr[n - 1] - arr[n - 2] : 0;
    return arr[n - 1] + step * (lvl - n);
  }

  function abilityValues(ab, lvl) {
    const v = {};
    for (const [k, t] of Object.entries(ab.vals || {})) v[k] = tableVal(t.v, lvl);
    return v;
  }

  function talentValues(t, pts) {
    const v = {};
    for (const [k, tv] of Object.entries(t.vals || {})) v[k] = tv.v[Math.min(pts, tv.v.length) - 1];
    return v;
  }

  // ------------------------------------------------------------------ items
  function itemRarity(it) { return it.item ? (D.items[it.item] || {}).rarity : it.rar; }
  function slotDef(slotId) { return D.slots.find(s => s.id === slotId); }
  function rolls(it, slotId) {
    const s = slotDef(slotId), r = itemRarity(it);
    return !!(s && (s.imp.length + s.pri.length + s.sec.length) && D.rolled.includes(r));
  }
  function range(stat, rar, q, anc) {
    const table = anc ? D.ancient : D.ranges;
    const r = table[stat] && table[stat][rar] && table[stat][rar][q - 1];
    if (r == null || r === 0) return null;
    return typeof r === 'number' ? [r, r] : r;
  }
  function canAncient(rar, q) { return !!(D.bands[q - 1] && D.bands[q - 1][2] && D.ancRar.includes(rar)); }
  function sockets(it, slotId) {
    const s = slotDef(slotId);
    if (!s || !s.sock) return 0;
    if (itemRarity(it) === 'divine') return s.sock;
    if (!rolls(it, slotId)) return 0;
    return it.q && D.bands[it.q - 1] && D.bands[it.q - 1][1] >= D.minSock ? s.sock : 0;
  }

  // ------------------------------------------------------------------ modifier collection
  function equippedAbilities(b) {
    const out = [];
    (b.abilities || []).forEach((id, i) => {
      const ab = id && D.abilities[id];
      if (ab && ab.cls === b.cls) out.push({ id, ab, slot: i, lvl: b.abLv[i] || ab.maxLv });
    });
    return out;
  }

  function collect(b) {
    const mods = [];
    const mech = b.mech, cfg = b.cfg;
    const add = (src, list) => list.forEach(m => m && mods.push(Object.assign({ src }, m)));
    const main = MAIN[b.cls];
    const L = b.level;

    // base stats (assumptions)
    add('Base', [
      { s: main, v: mech.baseMainStat + mech.mainStatPerLevel * L },
      { s: 'max-health', v: mech.baseHealth + mech.healthPerLevel * (L - 1) },
      { s: 'max-mana', v: mech.baseMana },
      { s: 'mana-regen', v: mech.baseManaRegen },
      { s: 'critical-hit-chance-pct', v: mech.baseCritChance },
      { s: 'dodge-chance-pct', v: mech.baseDodge },
      { s: 'critical-hit-damage-pct', v: mech.baseCritDamage },
      { s: 'armor', v: mech.baseArmor },
      { s: 'magic-resist', v: mech.baseMagicResist },
    ]);

    // gear
    const weapon = { damage: null, speed: null };
    const equippedItems = [];
    for (const s of D.slots) {
      const it = b.gear[s.id];
      if (!it || !(it.item || it.rar)) continue;
      const rar = itemRarity(it);
      const name = it.item ? D.items[it.item].name : (D.rarities.find(r => r.id === rar) || {}).name + ' ' + s.name;
      const src = s.name + ': ' + name;
      if (it.item) equippedItems.push(it.item);
      if (rolls(it, s.id) && it.q) {
        for (const st of s.imp) {
          const r = range(st, rar, it.q, it.anc);
          if (!r) continue;
          const raw = it.imp && it.imp[st] != null ? it.imp[st] : r[1];
          const val = raw / D.scale[st];
          if (st === 'weapon-damage') weapon.damage = val;
          else if (st === 'weapon-speed') weapon.speed = val;
          else add(src, [{ s: D.statGroup[st], v: val }]);
        }
        for (const [st, raw0] of it.aff || []) {
          const r = range(st, rar, it.q, it.anc);
          if (!r) continue;
          const raw = raw0 == null ? r[1] : raw0;
          add(src, [{ s: D.statGroup[st], v: raw / D.scale[st] }]);
        }
      }
      const place = D.gemPlace[s.id];
      for (const g of it.gems || []) {
        const gem = gemById(g);
        if (gem && place) add(src + ' (' + gem.name + ')', (gem.bonus[place] || []).map(([st, v]) => ({ s: st, v })));
      }
    }

    // runes & sets
    const setCount = {};
    const runeLevels = {};
    for (const [rid, rl] of b.runes || []) {
      const r = D.runes[rid];
      if (!r) continue;
      add('Rune: ' + r.name, r.attrs.map(([st, vals]) => ({ s: st, v: vals[Math.min(rl, vals.length) - 1] })));
      setCount[r.set] = (setCount[r.set] || 0) + 1;
      for (const a of r.abilities) runeLevels[a] = (runeLevels[a] || 0) + mech.abilityLevelPerRune;
    }
    const activeSets = [];
    for (const [sid, n] of Object.entries(setCount)) {
      const set = D.sets[sid];
      if (!set) continue;
      for (const [pieces, stats] of set.stats) if (n >= pieces) add(set.name + ' (' + pieces + ')', stats.map(([st, v]) => ({ s: st, v })));
      const fx = M.SET_FX[sid] || {};
      for (const bo of set.bonuses) {
        const on = n >= bo.pieces;
        const modeled = !!fx[bo.pieces] || (set.stats.find(x => x[0] === bo.pieces) || [0, []])[1].length > 0;
        activeSets.push({ set: set.name, pieces: bo.pieces, have: n, on, text: bo.text.join(' '), modeled });
        if (on && fx[bo.pieces]) add(set.name + ' (' + bo.pieces + ')', fx[bo.pieces](cfg));
      }
    }

    // talents
    const tree = D.talents[b.cls] || [];
    const talentInfo = [];
    for (const t of tree) {
      const pts = b.talents[t.id] || 0;
      if (!pts) continue;
      const fx = M.TALENT_FX[t.id];
      if (fx) add('Talent: ' + t.name, fx(talentValues(t, pts), t, cfg, pts));
      else talentInfo.push(t.name);
    }

    // legendary / divine effects
    const itemInfo = [];
    for (const id of equippedItems) {
      const it = D.items[id];
      if (!it.effect) continue;
      const fx = M.ITEM_FX[id];
      if (fx) add('Effect: ' + it.name, fx(cfg));
      itemInfo.push({ name: it.name, text: it.effect, modeled: !!fx });
    }

    // ability levels (runes, Remnant of the Elder Sage)
    const extraLv = mods.filter(m => m.s === 'ability-level').reduce((a, m) => a + m.v, 0);
    const abilities = equippedAbilities(b).map(e => Object.assign(e, { lvl: e.lvl + (runeLevels[e.id] || 0) + extraLv }));

    // self-buffs from equipped abilities
    for (const e of abilities) {
      const meta = M.ABILITY_META[e.id] || {};
      const v = abilityValues(e.ab, e.lvl);
      if (meta.buff && meta.buff.mods) add(e.ab.name + ' (buff)', meta.buff.mods(v).map(m => Object.assign(m, { up: 'buff:' + e.id })));
      if (meta.twin) add(e.ab.name, ['basic', 'strong'].map(role => ({ s: 'more', v: 1, role, up: 'buff:' + e.id, label: 'Spirit Twin' })));
      if (meta.stackBuff) add(e.ab.name + ' (stacks)', [{ s: 'attack-speed-pct', v: v.attackSpeed * Math.min(20, cfg.furiousStacks || 0) }]);
    }

    // minion
    const minion = b.minion && D.minions.find(m => m.id === b.minion);
    if (minion) add('Minion: ' + minion.name, M.minionMods(minion));

    // custom
    const custom = M.parseCustom(b.custom);
    add('Custom', custom.mods);

    return { mods, weapon, abilities, activeSets, talentInfo, itemInfo, customBad: custom.bad, runeLevels };
  }

  let GEMS = null;
  function gemById(id) {
    if (!GEMS) { GEMS = {}; D.gems.forEach(g => g.tiers.forEach(t => (GEMS[t.id] = Object.assign({ color: g.id }, t)))); }
    return GEMS[id];
  }

  // ------------------------------------------------------------------ evaluation
  function makeEval(b, col, rot, cfgEff) {
    const equipped = new Set(col.abilities.map(a => a.id));
    const mode = b.cfg.buffMode;
    function uptime(m) {
      if (m.up || m.upCast || m.upSpecial || m.upMana || m.upChannel || m.upDodge) {
        if (mode === 'always') return 1;
        if (mode === 'never') return 0;
      }
      if (m.up) {
        const id = m.up.slice(5);
        return equipped.has(id) ? (rot.uptime[id] || 0) : 0;
      }
      if (m.upCast) return equipped.has(m.upCast[0]) ? clamp(m.upCast[1] * (rot.rate[m.upCast[0]] || 0), 0, 1) : 0;
      if (m.upSpecial) return clamp(m.upSpecial * (rot.specialRate || 0), 0, 1);
      if (m.upMana) return clamp(m.upMana[1] * (rot.manaSpent || 0) / m.upMana[0], 0, 1);
      if (m.upChannel) return clamp(rot.channelFrac[m.upChannel] || 0, 0, 1);
      if (m.upDodge) return 1 - Math.exp(-(rot.dodgeRate || 0) * m.upDodge);
      return 1;
    }
    function active(m, ab) {
      if (m.ab && (!ab || !m.ab.includes(ab.id))) return false;
      if (m.tag && (!ab || !ab.tags.includes(m.tag))) return false;
      if (m.role && (!ab || ab.role !== m.role)) return false;
      if (m.needAb && !equipped.has(m.needAb)) return false;
      if (m.cond) {
        if (typeof m.cond === 'function') { if (!m.cond(cfgEff)) return false; }
        else if (!cfgEff[m.cond]) return false;
      }
      return true;
    }
    function value(m, st) {
      let v = m.derived ? m.derived(st || {}, rot) : m.v;
      if (m.stackStrong) v *= Math.min(m.stackStrong, 6 * (rot.strongRate || 0));
      return v * uptime(m);
    }
    // sum of a stat; `ab` limits scoped mods to that ability (unscoped mods always count)
    function sum(stat, ab, st) {
      let t = 0;
      for (const m of col.mods) if (m.s === stat && active(m, ab)) t += value(m, st);
      return t;
    }
    function product(stat, ab, st) {
      let t = 1;
      for (const m of col.mods) if (m.s === stat && active(m, ab)) t *= 1 + value(m, st);
      return t;
    }
    function list(stat, ab, st) {
      return col.mods.filter(m => m.s === stat && active(m, ab)).map(m => ({ src: m.src, label: m.label, v: value(m, st), m }));
    }
    return { sum, product, list, active, value, uptime, equipped };
  }

  function coreStats(b, E) {
    const mech = b.mech, main = MAIN[b.cls];
    const st = {};
    for (let pass = 0; pass < 2; pass++) {
      st.str = E.sum('strength', null, st);
      st.dex = E.sum('dexterity', null, st);
      st.int = E.sum('intelligence', null, st);
      st.main = { strength: st.str, dexterity: st.dex, intelligence: st.int }[main];
      st.maxHealth = E.sum('max-health', null, st) * (1 + E.sum('bonus-health-pct', null, st)) * E.product('max-health-more', null, st);
      st.maxMana = E.sum('max-mana', null, st) * (1 + E.sum('max-mana-pct', null, st));
      st.armor = (E.sum('armor', null, st) + st.str * mech.armorPerStr) * (1 + E.sum('bonus-armor-pct', null, st));
      st.magicResist = (E.sum('magic-resist', null, st) + st.int * mech.mrPerInt) * (1 + E.sum('bonus-magic-resist-pct', null, st));
      st.dodge = clamp(E.sum('dodge-chance-pct', null, st) + st.dex * mech.dodgePerDex, 0, mech.dodgeCap);
      st.thorns = E.sum('thorns', null, st) * (1 + E.sum('thorns-pct', null, st));
    }
    st.attackSpeedPct = E.sum('attack-speed-pct', null, st);
    st.cdr = E.sum('cooldown-reduction-pct', null, st);
    st.manaRegen = E.sum('mana-regen', null, st) * (1 + E.sum('mana-regeneration-pct', null, st));
    st.lifeRegen = E.sum('life-regeneration', null, st);
    st.lifeOnHit = E.sum('life-on-hit', null, st);
    st.lifeOnKill = E.sum('life-on-kill', null, st);
    st.manaOnKill = E.sum('mana-on-kill', null, st);
    st.moveSpeed = E.sum('bonus-move-speed-pct', null, st);
    st.critChance = E.sum('critical-hit-chance-pct', null, st);
    st.critDamage = E.sum('critical-hit-damage-pct', null, st);
    st.mainMult = 1 + st.main * mech.dmgPerMainStat;
    return st;
  }

  // ------------------------------------------------------------------ damage of one ability part
  function partDamage(b, E, st, wb, ab, el, pct, opts) {
    const mech = b.mech, cfg = E.cfgEff;
    opts = opts || {};
    const role = opts.noRole ? null : ab && ab.role;
    const base = (wb.damage + E.sum('damage', ab, st)) * pct;
    const elemInc = E.sum(el + '-damage-pct', ab, st);
    const roleInc = role ? E.sum(ROLE_STAT[role], ab, st) + (role === 'special' ? E.sum('special-ability-bonus-damage', ab, st) : 0) + E.sum('ability-damage-pct', ab, st) : 0;
    const allInc = E.sum('bonus-all-damage-pct', ab, st);
    let condInc = 0;
    for (const [flag, stat] of COND_DMG) if (cfg[flag]) condInc += E.sum(stat, ab, st);
    const dotInc = opts.dot ? E.sum('damage-over-time-pct', ab, st) : 0;
    const more = opts.noMore ? 1 : E.product('more', ab, st) * (opts.extraMore || 1);
    const vuln = cfg.enemyVulnerable ? 1 + mech.vulnerableBase + E.sum('damage-vs-vulnerable-pct', ab, st) : 1;
    const estatic = el === 'lightning' && cfg.electrostatic > 0 ? 1 + Math.min(5, cfg.electrostatic) * mech.electrostaticPerStack : 1;
    const hit = base * st.mainMult * (1 + elemInc) * (1 + roleInc) * (1 + allInc) * (1 + condInc) * (1 + dotInc) * more * vuln * estatic;
    const cc = opts.dot ? 0 : clamp(E.sum('critical-hit-chance-pct', ab, st), 0, 1);
    const cd = opts.dot ? 0 : E.sum('critical-hit-damage-pct', ab, st);
    return {
      base, mainMult: st.mainMult, estatic, elemInc, roleInc, allInc, condInc, dotInc, more, vuln, hit, cc, cd,
      avg: hit * (1 + cc * cd), el,
    };
  }

  // per-cast damage of an ability: {single, aoe, hits, parts}
  function castDamage(b, E, st, wb, e, extraMore) {
    const meta = M.ABILITY_META[e.id] || {};
    const v = abilityValues(e.ab, e.lvl);
    const N = Math.max(1, b.cfg.enemies || 1);
    const hitsMore = 1 + E.sum('hits-more', e.ab, st) + E.sum('channel-more', e.ab, st);
    const targetsAdd = E.sum('targets-add', e.ab, st);
    const parts = [];
    let single = 0, aoe = 0, hits = 0;
    const allParts = (meta.parts || []).slice();
    if (e.ab.role === 'basic') for (const c of E.list('extra-part', e.ab, st)) allParts.push({ v: null, fixed: c.v, el: c.m.el, hits: 1, label: c.src });
    for (const p of allParts) {
      const pct = p.fixed != null ? p.fixed : v[p.v] || 0;
      if (!pct) continue;
      const d = partDamage(b, E, st, wb, e.ab, p.el, pct, { extraMore });
      const h = p.hits * hitsMore;
      const targets = p.aoe ? N : Math.min(N, (p.cap || 1) + (p.cap ? targetsAdd : 0));
      const main = p.others ? 0 : h;
      const tot = p.others ? h * Math.max(0, N - 1) : h * targets;
      single += d.avg * main;
      aoe += d.avg * tot;
      hits += main;
      parts.push(Object.assign(d, { pct, hitsMain: main, hitsTotal: tot, label: p.label || p.v || 'hit' }));
    }
    for (const c of E.list('cast-damage', e.ab, st)) {
      const d = partDamage(b, E, st, wb, e.ab, c.m.el || 'lightning', c.v, {});
      const h = (c.m.hits || 1) * hitsMore;
      const tot = h * (c.m.aoe ? N : 1);
      single += d.avg * h;
      aoe += d.avg * tot;
      parts.push(Object.assign(d, { pct: c.v, hitsMain: h, hitsTotal: tot, label: c.m.label || c.src }));
    }
    return { single, aoe, hits, parts, v };
  }

  // ------------------------------------------------------------------ rotation
  function rotation(b, E, st, wb, abilities) {
    const mech = b.mech, cfg = b.cfg;
    const R = wb.speed * (1 + st.attackSpeedPct);
    const res = { R, rate: {}, uptime: {}, channelFrac: {}, rows: [] };
    const basic = abilities.find(a => a.ab.role === 'basic');
    const strong = abilities.find(a => a.ab.role === 'strong');
    const specials = abilities.filter(a => a.ab.role === 'special');
    const cdrCap = mech.cdrCap;
    const cdOf = e => {
      let cd = e.ab.cdByLv ? tableVal(e.ab.cdByLv, e.lvl) : e.ab.cooldown;
      cd *= 1 - E.sum('cd-more', e.ab, st);
      cd *= 1 - clamp(E.sum('cooldown-reduction-pct', e.ab, st), 0, cdrCap);
      return cd;
    };
    // previous-iteration rates for cooldown recovery talents
    const prevB = E.prev.rate[basic && basic.id] || 0, prevS = E.prev.rate[strong && strong.id] || 0;
    let specialTime = 0, manaIn = st.manaRegen + (cfg.killsPerSec || 0) * st.manaOnKill - E.sum('mana-drain-pct', null, st) * st.maxMana;
    let specialRate = 0;
    for (const e of specials) {
      const meta = M.ABILITY_META[e.id] || {};
      const v = abilityValues(e.ab, e.lvl);
      let cd = cdOf(e);
      cd /= 1 + E.sum('cd-per-strong', e.ab, st) * prevS + E.sum('cd-per-basic', e.ab, st) * prevB;
      const rate = cd > 0 ? 1 / cd : 0;
      res.rate[e.id] = rate;
      specialRate += rate;
      const castTime = meta.channelKey ? (v[meta.channelKey] || 0) : 1 / R;
      specialTime += rate * castTime;
      if (meta.buff) {
        const dur = (meta.buff.dur || v[meta.buff.durKey] || 0) * (1 + E.sum('duration-more', e.ab, st));
        res.uptime[e.id] = clamp(dur * rate, 0, 1);
      }
      if (meta.twin) res.uptime[e.id] = clamp((v.duration || 0) * (1 + E.sum('duration-more', e.ab, st)) * rate, 0, 1);
      manaIn += rate * (E.sum('mana-per-cast', e.ab, st) + (meta.manaPctOnCast ? (v[meta.manaPctOnCast] || 0) * st.maxMana : 0));
    }
    res.specialRate = specialRate;
    res.dodgeRate = (cfg.enemyAttackRate || 0) * (E.cfgEff.enemyDazed ? 0.6 : 1) * st.dodge; // Dazed: -40% attack speed
    manaIn += res.dodgeRate * E.sum('mana-per-dodge', null, st);
    const avail = clamp(1 - specialTime, 0, 1);
    const manaPerHit = E.sum('mana-per-hit-pct', null, st) * st.maxMana;
    let G = 0, basicHits = 0;
    if (basic) {
      const bm = M.ABILITY_META[basic.id] || {};
      basicHits = (bm.parts || []).reduce((a, p) => a + (p.others ? 0 : p.hits), 0);
      G = (basic.ab.manaGen + E.sum('mana-gen-flat', basic.ab, st)) * (1 + E.sum('mana-gen-pct', basic.ab, st)) + manaPerHit * basicHits;
    }
    let s = 0, C = 0, Ts = 0;
    if (strong) {
      const sm = M.ABILITY_META[strong.id] || {};
      const strongHits = (sm.parts || []).reduce((a, p) => a + (p.others ? 0 : p.hits), 0);
      C = strong.ab.manaCost * Math.max(0, 1 + E.sum('mana-cost-pct', strong.ab, st) - E.sum('mana-cost-reduction-pct', strong.ab, st));
      const Cn = C - manaPerHit * strongHits;
      Ts = Math.max(1 / R, (sm.channel || 0) * (1 + E.sum('channel-more', strong.ab, st)));
      const cdS = strong.ab.cooldown ? cdOf(strong) : 0;
      if (Cn <= 0) s = avail / Ts;
      else s = (avail * R * (basic ? G : 0) + Math.max(0, manaIn)) / (Cn + (basic ? Ts * R * G : 0));
      s = Math.min(s, avail / Ts, cdS > 0 ? 1 / Math.max(cdS, Ts) : Infinity);
      s = Math.max(0, s);
      res.rate[strong.id] = s;
      res.channelFrac[strong.id] = sm.channel ? s * Ts : 0;
      res.strongCost = C;
    }
    const bRate = basic ? Math.max(0, (avail - s * Ts) * R) : 0;
    if (basic) res.rate[basic.id] = bRate;
    res.strongRate = s;
    res.basicRate = bRate;
    res.manaSpent = s * C;
    res.manaIn = manaIn + bRate * G;
    res.basicGen = G;
    res.avail = avail;
    return res;
  }

  // ------------------------------------------------------------------ main
  function compute(b) {
    const col = collect(b);
    const cfgEff = Object.assign({}, b.cfg);
    if (b.cfg.autoStatus) {
      for (const e of col.abilities) for (const s of (M.ABILITY_META[e.id] || {}).applies || []) if (STATUS_FLAG[s]) cfgEff[STATUS_FLAG[s]] = true;
    }
    if (cfgEff.enemyFrozen || cfgEff.enemyStunned) cfgEff.enemyImmobilized = true;
    if (cfgEff.enemyFrozen) cfgEff.enemySlowed = true;
    const wb = { damage: col.weapon.damage != null ? col.weapon.damage : b.mech.noWeaponDamage, speed: col.weapon.speed || b.mech.noWeaponSpeed };

    let rot = { rate: {}, uptime: {}, channelFrac: {}, specialRate: 0, strongRate: 0, manaSpent: 0, hitsPerSec: 0 };
    let E, st, out;
    for (let iter = 0; iter < 4; iter++) {
      E = makeEval(b, col, rot, cfgEff);
      E.cfgEff = cfgEff;
      E._col = col;
      E.prev = rot;
      st = coreStats(b, E);
      const r = rotation(b, E, st, wb, col.abilities);
      out = damage(b, E, st, wb, col, r);
      r.hitsPerSec = out.hitsPerSec;
      rot = r;
    }
    const def = defense(b, E, st, out, rot);
    return { col, st, wb, rot, dmg: out, def, E, cfgEff };
  }

  function damage(b, E, st, wb, col, rot) {
    const mech = b.mech, N = Math.max(1, b.cfg.enemies || 1);
    const rows = [];
    let dpsSingle = 0, dpsAoe = 0, hitsPerSec = 0;
    const casts = {};
    // circlet of focus: strong attacks consume focus from basics
    let focusMore = 1;
    const focus = E.list('focus', null, st)[0];
    if (focus && rot.strongRate > 0) focusMore = 1 + focus.v * Math.min(5, rot.basicRate / rot.strongRate);
    const gathered = E.list('gathered', null, st)[0];
    if (gathered && rot.strongRate > 0) focusMore *= 1 + gathered.v * Math.min(1, rot.basicRate / (gathered.m.per * rot.strongRate));
    for (const e of col.abilities) {
      const rate = rot.rate[e.id] || 0;
      const cd = castDamage(b, E, st, wb, e, e.ab.role === 'strong' ? focusMore : 1);
      casts[e.id] = cd;
      const meta = M.ABILITY_META[e.id] || {};
      rows.push({ id: e.id, name: e.ab.name, role: e.ab.role, lvl: e.lvl, rate, perCast: cd.single, perCastAoe: cd.aoe,
        dps: cd.single * rate, dpsAoe: cd.aoe * rate, parts: cd.parts, hits: cd.hits, guess: meta.guess, uptime: rot.uptime[e.id] });
      dpsSingle += cd.single * rate;
      dpsAoe += cd.aoe * rate;
      hitsPerSec += cd.hits * rate;
    }
    // procs: extra casts of other abilities
    const procRows = [];
    for (const m of E._col.mods) {
      if (!E.active(m, null) && !m.ab) continue;
      if (m.s === 'proc') {
        let rate = 0;
        if (m.from) for (const id of m.from) rate += rot.rate[id] || 0;
        if (m.fromRole) rate += m.fromRole === 'basic' ? rot.basicRate : m.fromRole === 'strong' ? rot.strongRate : rot.specialRate;
        rate *= m.v;
        if (!rate) continue;
        const ab = D.abilities[m.cast];
        if (!ab) continue;
        const eq = col.abilities.find(a => a.id === m.cast);
        const e = { id: m.cast, ab, lvl: eq ? eq.lvl : ab.maxLv };
        const cd = casts[m.cast] || castDamage(b, E, st, wb, e);
        procRows.push({ name: m.label || ab.name, detail: ab.name, rate, dps: cd.single * rate, dpsAoe: cd.aoe * rate });
      } else if (m.s === 'proc-hit') {
        let rate = 0;
        if (m.perBasic) rate = rot.basicRate / m.perBasic;
        else if (m.perHits) rate = hitsPerSec / m.perHits;
        else if (m.fromAb) rate = (rot.rate[m.fromAb] || 0) * (m.chance || 1);
        else if (m.onTag) {
          for (const r of rows) if ((D.abilities[r.id].tags || []).includes(m.onTag)) rate += r.rate * r.hits;
          rate *= m.chance || 1;
        }
        if (m.perHits === 100) rate = hitsPerSec * 0.25 / 25; // Soulrender: 25% per hit, 25 stacks
        if (!rate) continue;
        const d = partDamage(b, E, st, wb, null, m.el, m.v, {});
        procRows.push({ name: m.label || m.src, detail: m.src, rate, dps: d.avg * rate, dpsAoe: d.avg * rate * (m.aoe ? N : 1) });
      } else if (m.s === 'pulse') {
        const up = E.uptime(m);
        if (!up) continue;
        const d = partDamage(b, E, st, wb, null, m.el, m.v, {});
        procRows.push({ name: m.label || m.src, detail: m.src, rate: 1, dps: d.avg * up, dpsAoe: d.avg * up * (m.aoe ? N : 1) });
      }
    }
    // Iron Thorn pulses
    const it = col.abilities.find(a => a.id === 'iron-thorn');
    if (it) {
      const up = rot.uptime['iron-thorn'] || 0;
      const d = st.thorns * st.mainMult * (1 + E.sum('physical-damage-pct', null, st)) * (1 + E.sum('bonus-all-damage-pct', null, st));
      procRows.push({ name: 'Iron Thorn pulses', detail: '100% of Thorns per second (guess)', rate: 1, dps: d * up, dpsAoe: d * up * N });
    }
    for (const p of procRows) { dpsSingle += p.dps; dpsAoe += p.dpsAoe; }

    // damage over time
    const dots = [];
    const appliers = (key) => col.abilities.filter(a => (M.ABILITY_META[a.id] || {})[key]);
    const bleeders = appliers('bleed').map(a => ({ a, rate: rot.rate[a.id] || 0 }))
      .concat(E.list('bleed-from', null, st).length ? col.abilities.filter(a => a.id === 'whirlwind').map(a => ({ a, rate: rot.rate[a.id] || 0 })) : []);
    if (bleeders.some(x => x.rate > 0)) {
      const d = partDamage(b, E, st, wb, null, 'physical', mech.bleedPct / mech.bleedDur, { dot: true });
      const aoe = bleeders.some(x => (M.ABILITY_META[x.a.id].parts || []).some(p => p.aoe));
      dots.push({ name: 'Bleeding', dps: d.hit, dpsAoe: d.hit * (aoe ? N : 1), detail: d });
    }
    let poisonApps = 0, poisonAoe = false;
    for (const a of col.abilities) {
      const meta = M.ABILITY_META[a.id] || {};
      if (!meta.poison) continue;
      const v = abilityValues(a.ab, a.lvl);
      const chance = clamp((meta.poison.chance != null ? meta.poison.chance : v[meta.poison.chanceKey] || 0) + E.sum('poison-chance', a.ab, st), 0, 1);
      poisonApps += (rot.rate[a.id] || 0) * chance * meta.poison.stacks;
      if ((meta.parts || []).some(p => p.aoe)) poisonAoe = true;
    }
    if (poisonApps > 0) {
      const stacks = Math.min(mech.poisonMaxStacks, poisonApps * mech.poisonDur);
      const d = partDamage(b, E, st, wb, null, 'poison', mech.poisonPctPerSec * stacks, { dot: true });
      dots.push({ name: 'Poisoned (' + stacks.toFixed(1) + ' stacks)', dps: d.hit, dpsAoe: d.hit * (poisonAoe ? N : 1), detail: d });
    }
    const burners = appliers('burn').filter(a => rot.rate[a.id] > 0);
    if (burners.length || (b.talents.ignite && hitsPerSec > 0)) {
      const d = partDamage(b, E, st, wb, null, 'fire', mech.burnPctPerSec, { dot: true });
      const aoe = burners.some(a => (M.ABILITY_META[a.id].parts || []).some(p => p.aoe));
      dots.push({ name: 'Burn', dps: d.hit, dpsAoe: d.hit * (aoe ? N : 1), detail: d });
    }
    for (const d of dots) { dpsSingle += d.dps; dpsAoe += d.dpsAoe; }

    return { rows, procRows, dots, dpsSingle, dpsAoe, hitsPerSec, focusMore };
  }

  function defense(b, E, st, dmg, rot) {
    const mech = b.mech, cfg = E.cfgEff;
    const L = cfg.enemyLevel || b.level;
    const cap = mech.drCap;
    const armorDR = st.armor > 0 ? clamp(st.armor / (st.armor + mech.armorK * L), 0, cap) : 0;
    const mrDR = st.magicResist > 0 ? clamp(st.magicResist / (st.magicResist + mech.mrK * L), 0, cap) : 0;
    let less = 1;
    const lessList = E.list('damage-taken-less', null, st);
    for (const m of lessList) less *= 1 - clamp(m.v, 0, 1);
    less *= 1 - clamp(E.sum('damage-reduction-pct', null, st), 0, cap);
    const types = {};
    for (const el of ELEMENTS) {
      const typeDR = clamp(E.sum(el + '-damage-reduction-pct', null, st), 0, cap);
      const base = el === 'physical' ? armorDR : mrDR;
      const taken = (1 - base) * (1 - typeDR) * less;
      types[el] = { typeDR, mitig: 1 - taken, ehp: st.maxHealth / Math.max(1e-9, taken) };
    }
    const critDR = clamp(E.sum('critical-damage-reduction-pct', null, st) + mech.baseCritDR + st.dex * mech.critDrPerDex, 0, cap);
    // In-game "Toughness": life / (1 - average of armor and magic resist reduction) / (1 - dodge). Matches the character sheet.
    const toughness = st.maxHealth / (1 - (armorDR + mrDR) / 2) / Math.max(0.01, 1 - st.dodge);
    const critMulti = Math.max(1, 1 + (mech.enemyCritMulti - 1) * (1 - critDR));
    const dodge = st.dodge;
    const hit = Math.max(1, cfg.enemyHit || 1);
    const kills = cfg.killsPerSec || 0;
    const recovery = st.lifeRegen + st.lifeOnHit * (dmg.hitsPerSec || 0) + st.lifeOnKill * kills;
    // shields from abilities
    const shields = [];
    const rs = E._col.abilities.find(a => a.id === 'rage-shield');
    for (const c of E.list('cheat-death', null, st)) shields.push({ name: 'Iron Constitution (once / ' + c.m.cd + 's)', amount: st.maxHealth, uptime: 1 });
    if (rs) {
      const v = abilityValues(rs.ab, rs.lvl);
      shields.push({ name: 'Rage Shield', amount: (v.shield || 0) * st.maxHealth, uptime: rot.uptime['rage-shield'] || 0 });
    }
    return { L, armorDR, mrDR, toughness, toughnessHits: toughness / hit, less, types, critDR, critMulti, dodge, hit, recovery,
      hitsToDie: Object.fromEntries(ELEMENTS.map(el => [el, types[el].ehp / hit])), shields };
  }

  // ------------------------------------------------------------------ talent validation
  function talentProblems(b) {
    const tree = D.talents[b.cls] || [];
    const req = D.rowReq[b.cls] || {};
    const spent = Object.values(b.talents).reduce((a, x) => a + x, 0);
    const avail = D.pts[b.level - 1] || b.level;
    const probs = [];
    if (spent > avail) probs.push(`${spent} points spent, only ${avail} available at level ${b.level}.`);
    for (const t of tree) {
      const p = b.talents[t.id] || 0;
      if (!p) continue;
      const below = tree.filter(x => x.row < t.row).reduce((a, x) => a + (b.talents[x.id] || 0), 0);
      if (below < (req[t.row] || 0)) probs.push(`${t.name}: row ${t.row} needs ${req[t.row]} points in earlier rows (has ${below}).`);
    }
    return { spent, avail, probs };
  }

  // ------------------------------------------------------------------ enemy scaling (from GameConfig in the game files)
  const GAME_CONFIG = {
    growth: [[30, 0.12, 0.10], [50, 0.08, 0.04], [70, 0.06, 0.03]], // up to level, health growth, damage growth
    elite: { health: 3, damage: 1.5 },
    difficulties: [{ name: 'Normal', health: 1, damage: 1 }, { name: 'Nightmare', health: 3.5, damage: 1.35 }, { name: 'Inferno', health: 6, damage: 1.8 }],
  };
  function enemyScale(level) {
    let h = 1, d = 1;
    for (let l = 2; l <= level; l++) {
      const g = GAME_CONFIG.growth.find(x => l <= x[0]) || GAME_CONFIG.growth[GAME_CONFIG.growth.length - 1];
      h *= 1 + g[1];
      d *= 1 + g[2];
    }
    return { health: h, damage: d };
  }

  return { compute, blankBuild, defaults, talentProblems, abilityValues, talentValues, tableVal, range, rolls, sockets, canAncient,
    itemRarity, slotDef, gemById, MAIN, ELEMENTS, GAME_CONFIG, enemyScale };
})();
