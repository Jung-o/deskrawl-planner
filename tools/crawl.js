#!/usr/bin/env node
// Downloads the Deskrawl game data published by afkmeta.com and writes it as
// data/deskrawl-data.js (a single `window.DESKRAWL = {...}` object) for the planner.
//
//   node tools/crawl.js
//
// Re-run after a game patch to refresh skills, talents, affixes, runes, gems and items.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://afkmeta.com';
const DATA_FILES = ['data-build', 'data-items', 'data-talents'];
const CLASSES = ['warrior', 'hunter', 'sorcerer', 'monk'];
const OUT = path.join(__dirname, '..', 'data', 'deskrawl-data.js');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 deskrawl-planner' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(new URL(res.headers.location, url).href));
      }
      if (res.statusCode !== 200) return reject(new Error(url + ' -> HTTP ' + res.statusCode));
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => (body += d));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = s => decode(s.replace(/<br\s*\/?>/g, ' | ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const en = o => (o && (o.en || o.es)) || '';

function parseAbilityPage(html, cls) {
  const out = {};
  const re = /<article class="dk-ability[^"]*" id="ability-([^"]+)" data-values="([^"]*)">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const body = m[3];
    const vals = JSON.parse(decode(m[2]));
    const tagsHtml = (body.match(/<div class="dk-tags"[^>]*>([\s\S]*?)<\/div>/) || [, ''])[1];
    const tags = [...tagsHtml.matchAll(/<span>([^<]*)<\/span>/g)].map(x => decode(x[1]));
    const manaTxt = strip((body.match(/<p class="dk-ab-mana">([\s\S]*?)<\/p>/) || [, ''])[1]);
    const gen = manaTxt.match(/Generate:\s*([\d.]+)/);
    const cost = manaTxt.match(/Cost:\s*([\d.]+)/);
    const cd = manaTxt.match(/Cooldown:\s*([\d.]+)\s*sec/);
    out[m[1]] = {
      cls,
      group: (body.match(/data-group="([^"]+)"/) || [])[1],
      tags,
      manaGen: gen ? +gen[1] : 0,
      manaCost: cost ? +cost[1] : 0,
      cooldown: cd ? +cd[1] : 0,
      weaponSpeedCd: /Weapon speed/.test(manaTxt),
      vals: vals.t || {},
      manaByLv: vals.m || null,
      cdByLv: vals.c || null,
    };
  }
  return out;
}

async function main() {
  global.window = {};
  for (const f of DATA_FILES) {
    process.stdout.write('fetch ' + f + '.js\n');
    // The files are plain `window.DK = Object.assign(...)` scripts.
    eval(await get(`${BASE}/assets/deskrawl/${f}.js`)); // eslint-disable-line no-eval
  }
  const DK = window.DK;
  const B = DK.build;
  const N = B.names;

  const pageAbilities = {};
  for (const cls of CLASSES) {
    process.stdout.write('fetch abilities/' + cls + '\n');
    Object.assign(pageAbilities, parseAbilityPage(await get(`${BASE}/en/deskrawl/abilities/${cls}`), cls));
  }
  const buildPage = await get(`${BASE}/en/deskrawl/build`);
  const asOf = (buildPage.match(/<time datetime="([^"]+)"/) || [])[1] || null;

  const abilities = {};
  for (const [id, meta] of Object.entries(B.abilities)) {
    const [cls, role, req, maxLv, locked] = meta;
    const eq = N.equip[id] || {};
    const p = pageAbilities[id] || {};
    abilities[id] = {
      id, cls, role, req, maxLv, locked: !!locked,
      name: en(eq.name), icon: eq.icon || null, desc: en(eq.description),
      tags: p.tags || [], manaGen: p.manaGen || 0, manaCost: p.manaCost || 0,
      cooldown: p.cooldown || 0, weaponSpeedCd: !!p.weaponSpeedCd,
      vals: Object.fromEntries(Object.entries(eq.values || p.vals || {}).map(([k, v]) => [k, { f: v.format, s: v.suffix || '', v: v.values }])),
      manaByLv: p.manaByLv || null, cdByLv: p.cdByLv || null,
    };
  }

  const talents = {};
  for (const t of DK.combat) {
    (talents[t.class] = talents[t.class] || []).push({
      id: t.id, name: en(t.name), row: t.row, max: t.max_points, locked: !!t.locked,
      icon: `icons/talents/${t.id}.webp`, desc: en(t.description), hit: t.hit,
      vals: Object.fromEntries(Object.entries(t.effects_by_point).map(([k, v]) => [k, { f: v.format, s: v.suffix || '', v: v.values }])),
    });
  }
  // Keep the in-game order of each tree (the site's link order follows it).
  for (const cls of CLASSES) {
    const order = B.link.combat[cls] || [];
    talents[cls].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  const items = {};
  for (const [id, [slot, rarity]] of Object.entries(B.items)) {
    const n = N.items[id] || {};
    items[id] = { slot, rarity, name: en(n.name), icon: n.icon || null, effect: n.effect ? en(n.effect) : null };
  }

  const runes = {};
  for (const r of N.runes) {
    runes[r.id] = { name: en(r.name), icon: r.icon, cls: r.class, set: r.set, abilities: r.abilities, attrs: B.runeAttrs[r.id] || [] };
  }
  const sets = {};
  for (const s of N.sets) {
    sets[s.id] = { name: en(s.name), runes: s.runes, bonuses: s.bonuses.map(b => ({ pieces: b.pieces, text: b.effects.map(en) })), stats: B.setStats[s.id] || [] };
  }

  const gems = N.gems.map(g => ({
    id: g.id, name: en(g.name) || g.id,
    tiers: g.tiers.map(t => ({ id: t.id, name: en(t.name), icon: t.icon, tier: t.tier, bonus: B.gemBonus[t.id] })),
  }));

  const minions = N.minions.map(m => ({
    id: m.id, name: en(m.name), icon: m.icon, rarity: m.rarity, locked: !!B.minions[m.id],
    active: m.active.map(en),
    passive: m.passive.map(p => ({ name: en(p.name), desc: en(p.description), vals: Object.fromEntries(Object.entries(p.values || {}).map(([k, v]) => [k, { f: v.format, v: v.values }])) })),
  }));

  const slots = N.slots.map(s => {
    const kind = (B.kinds && B.kinds[s.id]) || s.id;
    const d = B.slots[kind] || B.slots[s.id] || { imp: [], pri: [], sec: [], sock: 0 };
    return { id: s.id, kind, name: en(s.name), icon: s.icon, imp: d.imp, pri: d.pri, sec: d.sec, sock: d.sock };
  });

  const statNames = {};
  for (const [k, v] of Object.entries(N.stats)) statNames[k] = en(v);
  for (const [k, v] of Object.entries(DK.wiNames || {})) statNames[k] = en(v);
  const groups = {};
  for (const [k, v] of Object.entries(B.groups)) groups[k] = { name: v[0], pct: !!v[2] };

  const data = {
    source: BASE + '/en/deskrawl/', asOf, crawledAt: new Date().toISOString(),
    maxLevel: B.maxLevel, classes: N.classes.map(c => ({ id: c.id, name: en(c.name), icon: c.icon })),
    pts: B.pts, rowReq: B.rows, talents, abilities, roles: B.roles,
    slots, rarities: N.rarities.map(r => ({ id: r.id, name: en(r.name) })), rarCount: B.rar,
    rolled: B.rolled, rolls: B.rolls, ancRar: B.ancRar, bands: B.bands, minSock: B.minSock,
    ranges: B.ranges, ancient: B.ancient, scale: B.scale, statGroup: B.statGroup, affClasses: B.affClasses,
    statNames, groups, groupOrder: B.groupOrder,
    items, gems, gemPlace: B.gemPlace, runes, runeSlots: B.runeSlots, maxRune: B.maxRune, sets,
    minions, talentSum: B.talentSum, link: B.link,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, '// Generated by tools/crawl.js from ' + BASE + ' — do not edit by hand.\nwindow.DESKRAWL=' + JSON.stringify(data) + ';\n');
  console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB',
    '| abilities', Object.keys(abilities).length, '| talents', DK.combat.length, '| items', Object.keys(items).length, '| runes', Object.keys(runes).length);
}

main().catch(e => { console.error(e); process.exit(1); });
