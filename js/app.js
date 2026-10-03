// UI for the Deskrawl planner.
'use strict';
(function () {
  const D = window.DESKRAWL, M = window.MECH, C = window.Calc;
  const ICON = 'https://afkmeta.com/assets/deskrawl/';
  const LS_CUR = 'dkp.current', LS_SAVES = 'dkp.saves', LS_TAB = 'dkp.tab';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n, d = 0) => (n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const pct = (n, d = 1) => (n == null || !isFinite(n) ? '—' : fmt(n * 100, d) + '%');
  const icon = p => (p ? `<img src="${ICON + p}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">` : '<img alt="">');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };

  // ------------------------------------------------------------------ state
  let build = loadInitial();
  let result = null;
  let tab = store.get(LS_TAB, 'talents');
  let selSlot = 'weapon';
  let calcAbility = null;

  function normalize(b) {
    const base = C.blankBuild(b.cls);
    b = Object.assign(base, b);
    b.cfg = Object.assign(C.defaults().cfg, b.cfg || {});
    // Builds saved before a defaults update get the new (in-game confirmed) assumptions.
    // Only assumptions the user edited are kept; everything else follows the current defaults.
    b.mechEdits = b.mechEdits || {};
    b.mech = Object.assign(C.defaults().mech, b.mechEdits);
    delete b.mechV;
    b.gear = b.gear || {}; b.talents = b.talents || {}; b.runes = b.runes || [];
    b.paragon = Object.assign({ level: 0, pts: {} }, b.paragon || {});
    b.abilities = (b.abilities || []).concat([null, null, null, null]).slice(0, 4);
    b.abLv = (b.abLv || []).concat([10, 10, 10, 10]).slice(0, 4);
    return b;
  }
  function loadInitial() {
    const h = location.hash;
    if (h.startsWith('#b=')) { try { return normalize(decodeBuild(h.slice(3))); } catch (e) { console.warn(e); } }
    if (h.length > 1 && /cl=/.test(h)) { try { return normalize(fromAfkMeta(h.slice(1))); } catch (e) { console.warn(e); } }
    const cur = store.get(LS_CUR, null);
    return normalize(cur || defaultBuild('warrior'));
  }
  function defaultBuild(cls) {
    const b = C.blankBuild(cls);
    const abs = Object.values(D.abilities).filter(a => a.cls === cls && a.req <= b.level);
    const pick = (role, n) => (abs.filter(a => a.role === role)[n] || {}).id || null;
    b.abilities = [pick('basic', 0), pick('strong', 0), pick('special', 0), pick('special', 1)];
    return b;
  }
  function encodeBuild(b) {
    const json = JSON.stringify(b);
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeBuild(code) {
    code = code.trim().replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(code))));
  }

  function update(opts) {
    build = normalize(build);
    result = C.compute(build);
    store.set(LS_CUR, build);
    if (/^#(b=|.*cl=)/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    renderSide();
    if (!opts || !opts.keepView) renderView();
  }

  // ------------------------------------------------------------------ AFK Meta build links
  function fromAfkMeta(str) {
    const q = str.includes('?') ? str.slice(str.indexOf('?') + 1) : str.replace(/^#/, '');
    const p = {};
    q.split('#')[0].split('&').forEach(kv => { const i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    if (!p.cl || !D.classes.find(c => c.id === p.cl)) throw new Error('No class (cl=) in the link');
    const L = D.link, b = C.blankBuild(p.cl);
    if (p.lv) b.level = Math.min(D.maxLevel, Math.max(1, +p.lv));
    if (p.c) p.c.split('-').forEach(t => { const m = /^(\d+)(?:x(\d+))?$/.exec(t); const id = m && L.combat[p.cl][+m[1]]; if (id) b.talents[id] = m[2] ? +m[2] : 1; });
    for (const [k, v] of Object.entries(p)) {
      let m = /^s(\d+)$/.exec(k);
      if (m) {
        const slot = L.slots[+m[1]];
        if (!slot) continue;
        const it = { item: null, rar: null, q: null, anc: false, imp: {}, aff: [], gems: [] };
        v.split('-').forEach((tok, i) => {
          let x;
          if (i === 0) { if ((x = /^i(\d+)$/.exec(tok))) it.item = L.items[+x[1]]; else if ((x = /^r(\d+)$/.exec(tok))) it.rar = L.rarities[+x[1]]; return; }
          if ((x = /^q(\d+)$/.exec(tok))) it.q = +x[1];
          else if (tok === 'a') it.anc = true;
          else if ((x = /^m(\d+)v(\d+)$/.exec(tok))) it.imp[L.stats[+x[1]]] = +x[2];
          else if ((x = /^f(\d+)(?:v(\d+))?$/.exec(tok))) it.aff.push([L.stats[+x[1]], x[2] == null ? null : +x[2]]);
          else if ((x = /^g(\d+)$/.exec(tok))) it.gems.push(L.gems[+x[1]]);
        });
        b.gear[slot] = it;
        continue;
      }
      if ((m = /^a([0-3])$/.exec(k))) {
        const x = /^(\d+)(?:x(\d+))?$/.exec(v); const id = x && L.abilities[+x[1]];
        if (id && D.abilities[id]) { b.abilities[+m[1]] = id; b.abLv[+m[1]] = x[2] ? +x[2] : D.abilities[id].maxLv; }
      }
    }
    if (p.ru) b.runes = p.ru.split('-').map(t => { const x = /^(\d+)(?:x(\d+))?$/.exec(t); return x && L.runes[+x[1]] ? [L.runes[+x[1]], x[2] ? +x[2] : D.maxRune] : null; }).filter(Boolean);
    if (p.mi && L.minions[+p.mi]) b.minion = L.minions[+p.mi];
    b.name = 'Imported from AFK Meta';
    return b;
  }
  function toAfkMeta(b) {
    const L = D.link, out = ['cl=' + b.cls];
    const c = (L.combat[b.cls] || []).map((id, i) => (b.talents[id] ? (b.talents[id] === 1 ? String(i) : i + 'x' + b.talents[id]) : null)).filter(Boolean);
    if (c.length) out.push('c=' + c.join('-'));
    if (b.level !== D.maxLevel) out.push('lv=' + b.level);
    L.slots.forEach((slot, si) => {
      const it = b.gear[slot];
      if (!slot || !it || !(it.item || it.rar)) return;
      const t = [it.item ? 'i' + L.items.indexOf(it.item) : 'r' + L.rarities.indexOf(it.rar)];
      if (it.q) t.push('q' + it.q);
      if (it.anc) t.push('a');
      Object.entries(it.imp || {}).forEach(([s, v]) => v != null && t.push('m' + L.stats.indexOf(s) + 'v' + v));
      (it.aff || []).forEach(([s, v]) => t.push('f' + L.stats.indexOf(s) + (v == null ? '' : 'v' + v)));
      (it.gems || []).forEach(g => t.push('g' + L.gems.indexOf(g)));
      out.push('s' + si + '=' + t.join('-'));
    });
    if (b.runes.length) out.push('ru=' + b.runes.map(([r, l]) => L.runes.indexOf(r) + (l === D.maxRune ? '' : 'x' + l)).join('-'));
    b.abilities.forEach((id, i) => { if (id) out.push('a' + i + '=' + L.abilities.indexOf(id) + (b.abLv[i] === D.abilities[id].maxLv ? '' : 'x' + b.abLv[i])); });
    if (b.minion) out.push('mi=' + L.minions.indexOf(b.minion));
    return 'https://afkmeta.com/en/deskrawl/build?' + out.join('&');
  }

  // ------------------------------------------------------------------ header
  function initHeader() {
    $('#cls').innerHTML = D.classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('#cls').onchange = e => {
      if (Object.keys(build.talents).length && !confirm('Changing class resets talents, abilities and runes. Continue?')) { e.target.value = build.cls; return; }
      const nb = defaultBuild(e.target.value);
      nb.gear = build.gear; nb.paragon = build.paragon; nb.level = build.level; nb.cfg = build.cfg; nb.mechEdits = build.mechEdits; nb.custom = build.custom; nb.name = build.name;
      build = nb; update();
    };
    $('#level').onchange = e => { build.level = Math.max(1, Math.min(D.maxLevel, +e.target.value || 1)); update(); };
    $('#bname').oninput = e => { build.name = e.target.value; store.set(LS_CUR, build); };
    $('#btn-new').onclick = () => { if (confirm('Start a new build? (the current one stays in your saves only if you saved it)')) { build = defaultBuild(build.cls); update(); } };
    $('#btn-save').onclick = () => {
      const saves = store.get(LS_SAVES, {});
      const name = prompt('Save as', build.name || 'My build');
      if (!name) return;
      build.name = name; saves[name] = build; store.set(LS_SAVES, saves); refreshSaves(); update();
    };
    $('#saved').onchange = e => {
      const saves = store.get(LS_SAVES, {});
      const v = e.target.value;
      if (v === '__del') {
        const n = prompt('Delete which save? ' + Object.keys(saves).join(', '));
        if (n && saves[n]) { delete saves[n]; store.set(LS_SAVES, saves); }
      } else if (saves[v]) build = normalize(JSON.parse(JSON.stringify(saves[v])));
      e.target.value = ''; refreshSaves(); update();
    };
    $('#btn-share').onclick = () => {
      const url = location.href.split('#')[0] + '#b=' + encodeBuild(build);
      history.replaceState(null, '', url);
      copy(url, 'Link copied to the clipboard (it is also in the address bar).');
    };
    $('#btn-export').onclick = () => {
      dialog('Export', `<p>Build code (paste it back with Import):</p><textarea readonly>${esc(encodeBuild(build))}</textarea>
        <p>AFK Meta build link (talents, gear, runes, abilities, minion):</p><textarea readonly>${esc(toAfkMeta(build))}</textarea>`);
    };
    $('#btn-import').onclick = () => {
      dialog('Import', `<p>Paste a build code from this planner or an <b>AFK Meta build link</b> (https://afkmeta.com/en/deskrawl/build?cl=…).</p><textarea id="imp"></textarea>`, () => {
        const v = $('#imp').value.trim();
        if (!v) return;
        try {
          build = normalize(/cl=/.test(v) ? fromAfkMeta(v) : decodeBuild(v.replace(/^.*#b=/, '')));
          update();
        } catch (e) { alert('Could not read this build: ' + e.message); }
      });
    };
    refreshSaves();
  }
  function refreshSaves() {
    const saves = store.get(LS_SAVES, {});
    $('#saved').innerHTML = '<option value="">Load…</option>' + Object.keys(saves).map(n => `<option>${esc(n)}</option>`).join('') + (Object.keys(saves).length ? '<option value="__del">Delete a save…</option>' : '');
  }
  function copy(text, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => dialog('Copy', `<textarea readonly>${esc(text)}</textarea>`));
  }
  function toast(msg) {
    const t = $('#tip'); t.innerHTML = esc(msg); t.hidden = false; t.style.left = '50%'; t.style.top = '60px';
    setTimeout(() => (t.hidden = true), 1800);
  }
  function dialog(title, html, onOk) {
    const d = $('#dlg');
    $('#dlg-title').textContent = title; $('#dlg-body').innerHTML = html;
    $('#dlg-ok').hidden = !onOk;
    d.onclose = () => { if (onOk && d.returnValue === 'ok') onOk(); };
    d.showModal();
  }

  // ------------------------------------------------------------------ side panel
  function renderSide() {
    const r = result, st = r.st, dmg = r.dmg, def = r.def, rot = r.rot;
    $('#cls').value = build.cls; $('#level').value = build.level; $('#bname').value = build.name || '';
    const tp = C.talentProblems(build);
    const N = build.cfg.enemies;
    const dotDps = dmg.dots.reduce((a, d) => a + d.dps, 0);
    const lines = [];
    lines.push(`<div class="sum-sec"><h4>Offense</h4>
      <div class="row"><span>Combined DPS</span><b class="big">${fmt(dmg.dpsSingle)}</b></div>
      ${N > 1 ? `<div class="row"><span>AoE DPS (${N} enemies)</span><b>${fmt(dmg.dpsAoe)}</b></div>` : ''}
      ${dmg.rows.map(x => `<div class="row small"><span>${esc(x.name)}</span><b>${fmt(x.dps)}</b></div>`).join('')}
      ${dmg.procRows.map(x => `<div class="row small"><span>+ ${esc(x.name)}</span><b>${fmt(x.dps)}</b></div>`).join('')}
      ${dotDps ? `<div class="row small"><span>+ Damage over time</span><b>${fmt(dotDps)}</b></div>` : ''}
      <div class="row"><span>Attacks / sec</span><b>${fmt(rot.R, 2)}</b></div>
      <div class="row"><span>Weapon damage / speed</span><b>${fmt(r.wb.damage)} / ${fmt(r.wb.speed, 2)}</b></div>
      <div class="row"><span>Crit chance / damage</span><b>${pct(Math.min(1, st.critChance))} / ${pct(st.critDamage, 0)}</b></div>
      <div class="row"><span>${C.MAIN[build.cls][0].toUpperCase() + C.MAIN[build.cls].slice(1)}</span><b>${fmt(st.main)} <span class="muted small">(×${fmt(st.mainMult, 2)})</span></b></div>
      <div class="row"><span>Mana in / spent per sec</span><b>${fmt(rot.manaIn, 1)} / ${fmt(rot.manaSpent, 1)}</b></div>
    </div>`);
    lines.push(`<div class="sum-sec"><h4>Defense</h4>
      <div class="row" title="Same formula as the in-game Toughness: life / (1 - average of armor and magic resist reduction) / (1 - dodge)"><span>Toughness</span><b class="big">${fmt(def.toughness)}</b></div>
      <div class="row" title="Toughness divided by the enemy hit set in Configuration"><span>Hits to die (${fmt(def.hit)} per hit)</span><b>${fmt(def.toughnessHits, 1)}</b></div>
      <div class="row"><span>Life</span><b>${fmt(st.maxHealth)}</b></div>
      <div class="row"><span>Mana</span><b>${fmt(st.maxMana)}</b></div>
      <div class="row"><span>Armor</span><b>${fmt(st.armor)} <span class="muted small">(${pct(def.armorDR)})</span></b></div>
      <div class="row"><span>Magic resist</span><b>${fmt(st.magicResist)} <span class="muted small">(${pct(def.mrDR)})</span></b></div>
      <div class="row"><span>Dodge</span><b>${pct(def.dodge)}</b></div>
      ${def.less < 1 ? `<div class="row"><span>Less damage taken</span><b>${pct(1 - def.less)}</b></div>` : ''}
      <div class="row"><span>Thorns</span><b>${fmt(st.thorns)}</b></div>
      <div class="row"><span>Life recovery / sec</span><b>${fmt(def.recovery, 1)}</b></div>
      ${def.shields.map(s => `<div class="row small"><span>${esc(s.name)} shield (${pct(s.uptime, 0)} up)</span><b>${fmt(s.amount)}</b></div>`).join('')}
    </div>`);
    const warns = [];
    tp.probs.forEach(p => warns.push(p));
    C.paragonProblems(build).probs.forEach(p => warns.push(p));
    if (!build.gear.weapon || !(build.gear.weapon.item || build.gear.weapon.rar)) warns.push('No weapon: using the "no weapon" damage from Assumptions.');
    build.abilities.forEach((id, i) => { const a = id && D.abilities[id]; if (a && a.req > build.level) warns.push(`${a.name} needs level ${a.req}.`); });
    if (r.col.customBad.length) warns.push('Custom lines not understood: ' + r.col.customBad.map(esc).join('; '));
    lines.push(`<div class="sum-sec"><h4>Talent points</h4><div class="row"><span>Spent</span><b class="${tp.spent > tp.avail ? 'bad' : ''}">${tp.spent} / ${tp.avail}</b></div></div>`);
    if (warns.length) lines.push(warns.map(w => `<div class="warn">${w}</div>`).join(''));
    lines.push(`<p class="muted small">Numbers from game data (AFK Meta, ${esc(D.asOf || '')}) and the game files; formulas marked as assumptions are editable in the Assumptions tab.</p>`);
    $('#side').innerHTML = lines.join('');
  }

  // ------------------------------------------------------------------ tabs
  const TABS = [
    ['talents', 'Talents'], ['paragon', 'Paragon'], ['skills', 'Skills'], ['items', 'Items'], ['runes', 'Runes'], ['minion', 'Minion'],
    ['config', 'Configuration'], ['calcs', 'Calcs'], ['assumptions', 'Assumptions'], ['about', 'About'],
  ];
  function initTabs() {
    $('#tabs').innerHTML = TABS.map(([k, n]) => `<button data-tab="${k}">${n}</button>`).join('');
    $('#tabs').onclick = e => { const k = e.target.dataset.tab; if (k) { tab = k; store.set(LS_TAB, k); renderView(); } };
  }
  function renderView() {
    [...$('#tabs').children].forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    hideTip();
    ({ talents: viewTalents, paragon: viewParagon, skills: viewSkills, items: viewItems, runes: viewRunes, minion: viewMinion, config: viewConfig,
      calcs: viewCalcs, assumptions: viewAssumptions, about: viewAbout }[tab] || viewTalents)();
  }

  // ------------------------------------------------------------------ tooltip
  function showTip(html, ev) {
    const t = $('#tip'); t.innerHTML = html; t.hidden = false;
    const x = Math.min(ev.clientX + 16, innerWidth - t.offsetWidth - 10), y = Math.min(ev.clientY + 12, innerHeight - t.offsetHeight - 10);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { $('#tip').hidden = true; }

  function fillDesc(desc, vals, at) {
    return esc(desc).replace(/\{(\w+)\}/g, (m, k) => {
      const t = vals[k];
      if (!t) return '<b>?</b>';
      const v = typeof at === 'number' ? (t.v ? C.tableVal(t.v, at) : at) : at[k];
      return '<b>' + fmtVal(v, t.f, t.s) + '</b>';
    }).replace(/\[([^\]]+)\]/g, '<span class="muted">[$1]</span>');
  }
  function fmtVal(v, f, suffix) {
    if (v == null) return '?';
    if (f === 'pct') return fmt(v * 100, Math.abs(v * 100) % 1 ? 1 : 0) + '%';
    return (+v.toFixed(2)).toLocaleString('en-US') + (suffix || '');
  }
  function deltaHtml(nb) {
    const r2 = C.compute(normalize(nb));
    const d1 = r2.dmg.dpsSingle - result.dmg.dpsSingle;
    const d2 = r2.def.toughness - result.def.toughness;
    const base1 = result.dmg.dpsSingle || 1, base2 = result.def.toughness || 1;
    const f = (d, b) => `<span class="${d > 0.5 ? 'good' : d < -0.5 ? 'bad' : 'muted'}">${d >= 0 ? '+' : ''}${fmt(d)} (${d >= 0 ? '+' : ''}${fmt(d / b * 100, 1)}%)</span>`;
    return `<div class="d small">DPS ${f(d1, base1)}<br>Toughness ${f(d2, base2)}</div>`;
  }

  // ------------------------------------------------------------------ talents
  function viewTalents() {
    const tree = D.talents[build.cls] || [];
    const req = D.rowReq[build.cls] || {};
    const tp = C.talentProblems(build);
    const rows = [...new Set(tree.map(t => t.row))].sort((a, b) => a - b);
    const spentBelow = row => tree.filter(x => x.row < row).reduce((a, x) => a + (build.talents[x.id] || 0), 0);
    let html = `<h2>${esc(D.classes.find(c => c.id === build.cls).name)} talents <span class="muted small">— ${tp.spent} / ${tp.avail} points · left-click add, right-click remove · green dot = included in the calculations</span></h2>
      <div class="row" style="justify-content:flex-start;gap:8px;margin-bottom:8px"><button id="t-reset">Reset talents</button></div><div class="tree">`;
    for (const row of rows) {
      const need = req[row] || 0, have = spentBelow(row), locked = have < need;
      html += `<div class="trow ${locked ? 'locked' : ''}"><div class="req">row ${row}<b>${need}</b>pts</div><div class="tnodes">`;
      for (const t of tree.filter(x => x.row === row)) {
        const p = build.talents[t.id] || 0;
        const modeled = !!M.TALENT_FX[t.id];
        html += `<div class="tnode ${p ? (p >= t.max ? 'max' : 'some') : ''} ${locked && !p ? 'locked' : ''}" data-id="${t.id}">
          ${icon(t.icon)}<div class="nm">${esc(t.name)}<br><span class="pt">${p}/${t.max}</span></div><span class="fx ${modeled ? '' : 'off'}"></span></div>`;
      }
      html += '</div></div>';
    }
    html += '</div>';
    $('#view').innerHTML = html;
    $('#t-reset').onclick = () => { build.talents = {}; update(); };
    const tnodes = $('.tree');
    const change = (id, d) => {
      const t = tree.find(x => x.id === id);
      const p = (build.talents[id] || 0) + d;
      if (p < 0 || p > t.max) return;
      if (d > 0 && C.talentProblems(build).spent >= C.talentProblems(build).avail) return toast('No talent points left at this level.');
      if (d > 0 && spentBelow(t.row) < (req[t.row] || 0)) return toast(`Row ${t.row} needs ${req[t.row]} points in earlier rows.`);
      if (p) build.talents[id] = p; else delete build.talents[id];
      update();
    };
    tnodes.onclick = e => { const n = e.target.closest('.tnode'); if (n) change(n.dataset.id, e.shiftKey ? -1 : 1); };
    tnodes.oncontextmenu = e => { const n = e.target.closest('.tnode'); if (n) { e.preventDefault(); change(n.dataset.id, -1); } };
    tnodes.onmousemove = e => {
      const n = e.target.closest('.tnode');
      if (!n) return hideTip();
      if (tnodes._hover !== n.dataset.id) {
        tnodes._hover = n.dataset.id;
        const t = tree.find(x => x.id === n.dataset.id), p = build.talents[t.id] || 0;
        const vals = t.vals;
        const cur = p ? `<div class="d">${fillDesc(t.desc, vals, C.talentValues(t, p))}</div>` : '';
        const nxt = p < t.max ? `<div class="d nx">Next: ${fillDesc(t.desc, vals, C.talentValues(t, p + 1))}</div>` : '';
        let delta = '';
        if (p < t.max) { const nb = JSON.parse(JSON.stringify(build)); nb.talents[t.id] = p + 1; delta = '<div class="small muted">If you add a point:</div>' + deltaHtml(nb); }
        tnodes._html = `<h5>${esc(t.name)} <span class="muted">${p}/${t.max}</span></h5>${cur}${nxt}${delta}
          <div class="small">${M.TALENT_FX[t.id] ? '<span class="badge ok">in calculations</span>' : '<span class="badge no">text only — not in the numbers</span>'}</div>`;
      }
      showTip(tnodes._html, e);
    };
    tnodes.onmouseleave = () => { tnodes._hover = null; hideTip(); };
  }

  // ------------------------------------------------------------------ paragon
  function viewParagon() {
    const par = build.paragon;
    const pp = C.paragonProblems(build);
    const open = build.level >= D.maxLevel;
    const val = (p, n) => (p.per < 1 || /pct$/.test(p.stat) ? fmt(p.per * n * 100, p.per * 100 % 1 ? 1 : 0) + '%' : fmt(p.per * n));
    let html = `<h2>Paragon <span class="muted small">— 1 point per Paragon level after level ${D.maxLevel}. The gain columns show what one more point adds.</span></h2>
      ${open ? '' : `<div class="warn">Paragon unlocks at level ${D.maxLevel}. Points set here are still counted, with a warning.</div>`}
      <div class="row" style="justify-content:flex-start;gap:14px;margin-bottom:10px">
        <label>Paragon level <input id="par-level" type="number" min="0" value="${par.level || 0}"></label>
        <span>Points spent <b class="${pp.spent > pp.avail ? 'bad' : ''}">${pp.spent} / ${pp.avail}</b></span>
        <button id="par-reset">Reset points</button></div>`;
    const groups = [...new Set(M.PARAGON.map(p => p.group))];
    // what one more point of each stat is worth
    const gains = {};
    for (const p of M.PARAGON) {
      if (p.max && (par.pts[p.stat] || 0) >= p.max) continue;
      const nb = JSON.parse(JSON.stringify(build));
      nb.paragon.pts[p.stat] = (nb.paragon.pts[p.stat] || 0) + 1;
      const r2 = C.compute(normalize(nb));
      gains[p.stat] = { dps: r2.dmg.dpsSingle / (result.dmg.dpsSingle || 1) - 1, tough: r2.def.toughness / (result.def.toughness || 1) - 1 };
    }
    const bestDps = Object.entries(gains).sort((a, b) => b[1].dps - a[1].dps)[0];
    const bestTough = Object.entries(gains).sort((a, b) => b[1].tough - a[1].tough)[0];
    const g = v => (v > 1e-7 ? `<span class="good">+${fmt(v * 100, 2)}%</span>` : '<span class="muted">—</span>');
    html += `<table class="t par"><tr><th>Stat</th><th>Per point</th><th>Points</th><th>Total</th><th>DPS / point</th><th>Toughness / point</th></tr>`;
    for (const grp of groups) {
      html += `<tr class="hdr"><td colspan="6">${esc(grp)}</td></tr>`;
      for (const p of M.PARAGON.filter(x => x.group === grp)) {
        const n = par.pts[p.stat] || 0;
        const ga = gains[p.stat];
        const tags = (bestDps && bestDps[0] === p.stat && bestDps[1].dps > 0 ? ' <span class="badge ok">best DPS</span>' : '') + (bestTough && bestTough[0] === p.stat && bestTough[1].tough > 0 ? ' <span class="badge ok">best Toughness</span>' : '');
        html += `<tr><td>${esc(p.name)}${tags}</td><td class="muted">${val(p, 1)}${p.max ? ' <span class="small">(max ' + p.max + ')</span>' : ''}</td>
          <td class="pts"><button class="small" data-pd="${p.stat}" data-d="-1">−</button><input type="number" min="0" ${p.max ? `max="${p.max}"` : ''} data-pv="${p.stat}" value="${n}"><button class="small" data-pd="${p.stat}" data-d="1">+</button></td>
          <td>${n ? '+' + val(p, n) : ''}</td><td>${ga ? g(ga.dps) : '<span class="muted">max</span>'}</td><td>${ga ? g(ga.tough) : ''}</td></tr>`;
      }
    }
    html += '</table>';
    $('#view').innerHTML = html;
    const setPts = (stat, n) => {
      const p = M.PARAGON.find(x => x.stat === stat);
      n = Math.max(0, Math.round(n || 0));
      if (p.max) n = Math.min(p.max, n);
      if (n) par.pts[stat] = n; else delete par.pts[stat];
      update();
    };
    $('#par-level').onchange = e => { par.level = Math.max(0, Math.round(+e.target.value || 0)); update(); };
    $('#par-reset').onclick = () => { par.pts = {}; update(); };
    $('#view').querySelectorAll('[data-pd]').forEach(btn => (btn.onclick = () => {
      const d = +btn.dataset.d;
      if (d > 0 && C.paragonProblems(build).spent >= (par.level || 0)) return toast('No Paragon points left: raise the Paragon level.');
      setPts(btn.dataset.pd, (par.pts[btn.dataset.pd] || 0) + d);
    }));
    $('#view').querySelectorAll('[data-pv]').forEach(inp => (inp.onchange = e => setPts(e.target.dataset.pv, +e.target.value)));
  }

  // ------------------------------------------------------------------ skills
  function viewSkills() {
    const roles = ['basic', 'strong', 'special', 'special'];
    const names = ['Basic attack', 'Strong attack', 'Special 1', 'Special 2'];
    const abs = Object.values(D.abilities).filter(a => a.cls === build.cls);
    const r = result;
    let html = '<h2>Equipped abilities</h2><div class="cards">';
    roles.forEach((role, i) => {
      const id = build.abilities[i];
      const a = id && D.abilities[id];
      const eq = r.col.abilities.find(x => x.slot === i);
      const lvl = eq ? eq.lvl : build.abLv[i];
      const meta = (id && M.ABILITY_META[id]) || {};
      html += `<div class="card"><div class="row" style="margin-bottom:6px"><b>${names[i]}</b>
        <span><select data-ab="${i}"><option value="">— none —</option>${abs.filter(x => x.role === role).map(x =>
          `<option value="${x.id}" ${x.id === id ? 'selected' : ''} ${(i === 3 && x.id === build.abilities[2]) || (i === 2 && x.id === build.abilities[3]) ? 'disabled' : ''}>${esc(x.name)} (lv ${x.req})</option>`).join('')}</select>
        Lv <input type="number" min="1" max="10" data-lv="${i}" value="${build.abLv[i]}"></span></div>`;
      if (a) {
        const v = C.abilityValues(a, lvl);
        html += `<div class="abil">${icon(a.icon)}<div><div class="tags">${a.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>
          <div class="desc">${fillDesc(a.desc, a.vals, lvl)}</div>
          <div class="small muted">${a.manaGen ? 'Generates ' + a.manaGen + ' mana' : a.manaCost ? 'Costs ' + a.manaCost + ' mana' : ''}
          ${a.cooldown || a.cdByLv ? ' · Cooldown ' + fmt(a.cdByLv ? C.tableVal(a.cdByLv, lvl) : a.cooldown, 1) + 's' : a.weaponSpeedCd ? ' · Weapon speed' : ''}
          ${lvl !== build.abLv[i] ? ` · <span class="good">effective level ${lvl}</span>` : ''}</div>
          ${meta.guess ? `<div class="small"><span class="badge guess">assumption</span> ${esc(meta.guess)}</div>` : ''}</div></div>`;
      }
      html += '</div>';
    });
    html += '</div>';
    const rot = r.rot;
    html += `<h3>Rotation</h3><div class="note">Specials are cast on cooldown; the strong attack is used whenever mana allows (and its cooldown is ready); the basic attack fills the rest.
      Attacks per second ${fmt(rot.R, 2)} · strong attack cost ${fmt(rot.strongCost || 0, 1)} mana · basic generates ${fmt(rot.basicGen, 1)} · time left for basic/strong ${pct(rot.avail, 0)}</div>`;
    html += `<table class="t"><tr><th>Ability</th><th>Level</th><th>Casts / s</th><th>Avg damage / cast</th><th>DPS</th><th>AoE DPS</th><th>Buff uptime</th></tr>`;
    for (const x of r.dmg.rows) html += `<tr><td>${esc(x.name)}</td><td>${x.lvl}</td><td>${fmt(x.rate, 2)}</td><td>${fmt(x.perCast)}</td><td>${fmt(x.dps)}</td><td>${fmt(x.dpsAoe)}</td><td>${x.uptime != null ? pct(x.uptime, 0) : ''}</td></tr>`;
    for (const x of r.dmg.procRows) html += `<tr class="sub"><td>+ ${esc(x.name)}</td><td></td><td>${fmt(x.rate, 2)}</td><td></td><td>${fmt(x.dps)}</td><td>${fmt(x.dpsAoe)}</td><td></td></tr>`;
    for (const x of r.dmg.dots) html += `<tr class="sub"><td>+ ${esc(x.name)}</td><td></td><td></td><td></td><td>${fmt(x.dps)}</td><td>${fmt(x.dpsAoe)}</td><td></td></tr>`;
    html += `<tr><td><b>Total</b></td><td></td><td></td><td></td><td><b>${fmt(r.dmg.dpsSingle)}</b></td><td><b>${fmt(r.dmg.dpsAoe)}</b></td><td></td></tr></table>`;
    $('#view').innerHTML = html;
    $('#view').querySelectorAll('[data-ab]').forEach(s => (s.onchange = e => { build.abilities[+e.target.dataset.ab] = e.target.value || null; update(); }));
    $('#view').querySelectorAll('[data-lv]').forEach(s => (s.onchange = e => { build.abLv[+e.target.dataset.lv] = Math.max(1, Math.min(10, +e.target.value || 1)); update(); }));
  }

  const EXTRA_NAMES = { 'mana-regen': 'Mana Regeneration', 'damage-taken-less': 'Less Damage Taken', 'thorns-pct': 'Bonus Thorns',
    'healing-received-pct': 'Healing Received', 'max-mana-pct': 'Bonus Mana', 'mana-drain-pct': 'Mana Drain / s', 'max-health-more': 'Max Health (more)',
    'damage-vs-stunned-pct': 'Damage vs Stunned', 'damage-vs-dazed-pct': 'Damage vs Dazed', 'more': 'More Damage', 'mana-per-hit-pct': 'Mana per Hit (% max)',
    'mana-per-dodge': 'Mana per Dodge', 'special-ability-bonus-damage': 'Special Ability Damage', 'bonus-magic-resist-pct': 'Bonus Magic Resist',
    'mana-regeneration-pct': 'Bonus Mana Regeneration', 'damage-reduction-pct': 'Damage Reduction' };
  const statLabel = s => (D.groups[s] && D.groups[s].name) || EXTRA_NAMES[s] || s;

  // ------------------------------------------------------------------ items
  const affName = st => D.statNames[st] || st;
  const isPctStat = st => D.scale[st] === 1000;
  const toDisp = (st, raw) => raw == null ? '' : isPctStat(st) ? +(raw / 10).toFixed(1) : +(raw / D.scale[st]).toFixed(2);
  const fromDisp = (st, d) => Math.round(isPctStat(st) ? d * 10 : d * D.scale[st]);
  const rangeTxt = (st, r, raw) => {
    if (!r) return 'not on this item';
    const txt = `${toDisp(st, r[0])} – ${toDisp(st, r[1])}${isPctStat(st) ? '%' : ''}`;
    return raw != null && (raw < r[0] || raw > r[1]) ? `<span class="bad" title="Outside the roll range at this item level">${txt} ⚠</span>` : txt;
  };

  function itemTitle(it, s) {
    if (!it || !(it.item || it.rar)) return { name: 'Empty', rar: '' };
    const rar = C.itemRarity(it);
    return { name: it.item ? D.items[it.item].name : (D.rarities.find(r => r.id === rar) || {}).name + ' ' + s.name, rar };
  }
  function viewItems() {
    build.compare = build.compare || {};
    let html = '<div class="grid2"><div class="slotlist">';
    for (const s of D.slots) {
      const it = build.gear[s.id];
      const t = itemTitle(it, s);
      const ic = it && it.item ? D.items[it.item].icon : s.icon;
      const cmp = build.compare[s.kind] ? ' <span class="badge guess">compare</span>' : '';
      html += `<div class="slot ${s.id === selSlot ? 'on' : ''}" data-slot="${s.id}">${icon(ic)}<div><div class="s">${esc(s.name)}${cmp}</div><div class="t r-${t.rar}">${esc(t.name)}${it && it.q ? ' <span class="muted">· ilvl ' + it.q + '</span>' : ''}${it && it.anc ? ' <span class="r-divine">· Ancient</span>' : ''}</div></div></div>`;
    }
    html += `<button id="it-lvl" style="margin-top:6px">Set every item level to hero level</button></div>
      <div><div id="ocr-note"></div><div class="cmp-wrap"><div id="ied"></div><div id="ced"></div></div><div id="cmp-res"></div></div></div>`;
    $('#view').innerHTML = html;
    $('#view').querySelector('.slotlist').onclick = e => { const n = e.target.closest('.slot'); if (n) { selSlot = n.dataset.slot; ocrTarget = null; lastOcr = null; viewItems(); } };
    $('#it-lvl').onclick = () => { Object.values(build.gear).forEach(it => it && it.q && (it.q = build.level)); update(); };
    const s = C.slotDef(selSlot);
    const saveEquipped = it => { if (it) build.gear[s.id] = it; else delete build.gear[s.id]; update({ keepView: true }); viewItems(); };
    const saveCandidate = it => { if (it) build.compare[s.kind] = it; else delete build.compare[s.kind]; store.set(LS_CUR, build); viewItems(); };
    ocrTargets = { equipped: saveEquipped, candidate: saveCandidate, slot: s };
    if (!ocrTarget) ocrTarget = build.compare[s.kind] ? 'candidate' : 'equipped';
    // equipped item
    itemEditor($('#ied'), s, 'Equipped', build.gear[s.id], saveEquipped);
    renderOcrNote();
    // candidate item to compare
    if (build.compare[s.kind]) {
      itemEditor($('#ced'), s, 'Candidate', build.compare[s.kind], saveCandidate, true);
      renderCompare(s);
    } else {
      $('#ced').innerHTML = `<div class="card"><h2>Compare an item</h2><p class="muted">Build a temporary item for the ${esc(s.name)} slot and see every stat change against what you have equipped. It does not change your build until you equip it.</p>
        <p><button id="cmp-new" class="primary">New candidate item</button> <button id="cmp-copy">Start from the equipped item</button> <button id="cmp-ocr">📷 From a screenshot</button></p>
        <p class="muted small">Or select this card and paste a tooltip screenshot (Ctrl+V), or drop the image file on it.</p></div>`;
      $('#cmp-ocr').onclick = () => pickImage('candidate');
      $('#ced').onmousedown = () => { ocrTarget = 'candidate'; };
      dropZone($('#ced'), 'candidate');
      $('#cmp-new').onclick = () => { build.compare[s.kind] = emptyItem(); viewItems(); };
      $('#cmp-copy').onclick = () => { build.compare[s.kind] = JSON.parse(JSON.stringify(build.gear[s.id] || emptyItem())); viewItems(); };
    }
  }
  const emptyItem = () => ({ item: null, rar: null, q: null, anc: false, imp: {}, aff: [], gems: [] });

  // Editor for one item. `onSave(item|null)` is called after every change.
  function itemEditor(box, s, title, it0, onSave, isCandidate) {
    const it = it0 ? JSON.parse(JSON.stringify(it0)) : emptyItem();
    it.imp = it.imp || {}; it.aff = it.aff || []; it.gems = it.gems || [];
    const named = Object.entries(D.items).filter(([, x]) => x.slot === s.kind);
    const rar = C.itemRarity(it);
    const tgt = isCandidate ? 'candidate' : 'equipped';
    let html = `<div class="card ${isCandidate ? 'cand' : ''} ${ocrTarget === tgt ? 'ocr-on' : ''}"><h2>${esc(title)} — ${esc(s.name)}
      <button data-k="ocr" class="small" style="float:right" title="Read the item from a tooltip screenshot. You can also select this card and paste one with Ctrl+V, or drop an image file on it.">📷 Screenshot</button></h2><div class="form">
      <label>Item</label><select data-k="base"><option value="">— empty —</option>
        <optgroup label="Generic (pick the affixes)">${D.rolled.filter(() => s.imp.length + s.pri.length + s.sec.length).map(r => `<option value="r:${r}" ${!it.item && it.rar === r ? 'selected' : ''}>${esc(D.rarities.find(x => x.id === r).name)} ${esc(s.name)}</option>`).join('')}</optgroup>
        ${['divine', 'legendary', 'rare', 'uncommon', 'common'].map(r => {
          const list = named.filter(([, x]) => x.rarity === r);
          return list.length ? `<optgroup label="${esc(D.rarities.find(x => x.id === r).name)}">${list.map(([id, x]) => `<option value="i:${id}" ${it.item === id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : '';
        }).join('')}
      </select>`;
    if (rar) {
      const rolls = C.rolls(it, s.id);
      if (rolls) {
        const band = D.bands[(it.q || 1) - 1];
        html += `<label>Item level</label><span><input data-k="q" type="number" min="1" max="70" value="${it.q || ''}"> <span class="muted small">needs hero level ${band ? band[0] : '?'} · values are kept when you change it</span> <button data-k="maxall" class="small" title="Set every value to the best roll at this item level">Max all rolls</button></span>`;
        if (C.canAncient(rar, it.q)) html += `<label>Ancient</label><span><input data-k="anc" type="checkbox" ${it.anc ? 'checked' : ''}> <span class="muted small">higher rolls (level 70 legendary)</span></span>`;
      } else html += `<label></label><span class="muted small">This item has fixed stats in the game; only its effect is used here.</span>`;
      html += '</div>';
      if (it.item && D.items[it.item].effect) {
        const fx = !!M.ITEM_FX[it.item];
        html += `<div class="effect">${esc(D.items[it.item].effect)} <span class="badge ${fx ? 'ok' : 'no'}">${fx ? 'in calculations' : 'text only'}</span></div>`;
      }
      if (rolls && it.q) {
        if (s.imp.length) {
          html += '<h3>Base stats</h3>';
          for (const st of s.imp) {
            const r = C.range(st, rar, it.q, it.anc);
            const raw = it.imp[st] != null ? it.imp[st] : r && r[1];
            html += `<div class="affrow"><span>${esc(affName(st))}</span><input type="number" step="any" data-imp="${st}" value="${toDisp(st, raw)}"><span class="rg">${rangeTxt(st, r, raw)}</span><span></span></div>`;
          }
        }
        const [nPri, nSec] = D.rarCount[rar];
        const pri = it.aff.filter(a => s.pri.includes(a[0])), sec = it.aff.filter(a => s.sec.includes(a[0]));
        const used = new Set(it.aff.map(a => a[0]));
        const pool = list => list.filter(st => !D.affClasses[st] || D.affClasses[st].includes(build.cls));
        const affRow = (a, kind) => {
          const r = C.range(a[0], rar, it.q, it.anc);
          const raw = a[1] == null ? r && r[1] : a[1];
          return `<div class="affrow"><select data-affs="${a[0]}">${(kind === 'p' ? pool(s.pri) : s.sec).map(st => `<option value="${st}" ${st === a[0] ? 'selected' : ''} ${st !== a[0] && used.has(st) ? 'disabled' : ''}>${esc(affName(st))}</option>`).join('')}</select>
            <input type="number" step="any" data-affv="${a[0]}" value="${toDisp(a[0], raw)}"><span class="rg">${rangeTxt(a[0], r, raw)}</span><button data-affdel="${a[0]}" title="Remove">✕</button></div>`;
        };
        html += `<h3>Primary affixes (${pri.length}/${nPri})</h3>` + pri.map(a => affRow(a, 'p')).join('');
        if (pri.length < nPri) html += `<select data-affadd="p"><option value="">+ add a primary affix…</option>${pool(s.pri).filter(x => !used.has(x)).map(st => `<option value="${st}">${esc(affName(st))}</option>`).join('')}</select>`;
        if (nSec) {
          html += `<h3>Secondary affixes (${sec.length}/${nSec})</h3>` + sec.map(a => affRow(a, 's')).join('');
          if (sec.length < nSec) html += `<select data-affadd="s"><option value="">+ add a secondary affix…</option>${s.sec.filter(x => !used.has(x)).map(st => `<option value="${st}">${esc(affName(st))}</option>`).join('')}</select>`;
        }
      }
      const nSock = C.sockets(it, s.id);
      if (s.sock) {
        html += `<h3>Gems (${nSock} socket${nSock === 1 ? '' : 's'})</h3>`;
        if (!nSock) html += `<div class="muted small">Sockets open from item level ${D.minSock}.</div>`;
        const place = D.gemPlace[s.id];
        for (let i = 0; i < nSock; i++) {
          const g = it.gems[i] || '';
          html += `<div class="affrow"><select data-gem="${i}"><option value="">— empty socket —</option>${D.gems.map(gr => `<optgroup label="${esc(gr.name)}">${gr.tiers.map(t =>
            `<option value="${t.id}" ${t.id === g ? 'selected' : ''}>${esc(t.name)} — ${esc(((t.bonus[place] || [])[0] || []).length ? gemTxt(t.bonus[place][0]) : '')}</option>`).join('')}</optgroup>`).join('')}</select><span></span><span></span><span></span></div>`;
        }
      }
    } else html += '</div>';
    html += '<p>';
    if (isCandidate) {
      const targets = sameKindSlots(s);
      html += targets.map(t => `<button data-k="equip" data-slot="${t.id}" class="primary">${targets.length > 1 ? 'Equip in ' + esc(t.name) : 'Equip this item'}</button>`).join(' ')
        + ` <button data-k="copy">Copy equipped item</button> <button data-k="drop">Stop comparing</button>`;
    }
    else if (rar) html += `<button data-k="clear">Remove item</button>`;
    html += '</p></div>';
    box.innerHTML = html;
    const q = sel => box.querySelector(sel);
    const save = () => onSave(it);
    q('[data-k=ocr]').onclick = () => pickImage(tgt);
    box.onmousedown = () => {
      ocrTarget = tgt;
      document.querySelectorAll('#ied > .card, #ced > .card').forEach(c => c.classList.toggle('ocr-on', c.parentElement === box));
    };
    dropZone(box, tgt);
    q('[data-k=base]').onchange = e => {
      const v = e.target.value;
      if (!v) { onSave(isCandidate ? emptyItem() : null); return; }
      const [k, id] = v.split(':');
      it.item = k === 'i' ? id : null; it.rar = k === 'r' ? id : null;
      const r2 = C.itemRarity(it);
      if (D.rolled.includes(r2)) { it.q = it.q || build.level; if (r2 === 'legendary' && it.q < 10) it.q = 10; } else { it.q = null; it.anc = false; }
      const [np, ns] = D.rarCount[r2] || [0, 0];
      it.aff = it.aff.filter(a => s.pri.includes(a[0])).slice(0, np).concat(it.aff.filter(a => s.sec.includes(a[0])).slice(0, ns));
      save();
    };
    // Changing item level or Ancient keeps every value already on the item: values left at
    // "max roll" are frozen at the current level's max first, so nothing has to be typed again.
    const freeze = () => {
      const r0 = C.itemRarity(it);
      for (const st of s.imp) if (it.imp[st] == null) { const r = C.range(st, r0, it.q, it.anc); if (r) it.imp[st] = r[1]; }
      it.aff = it.aff.map(a => { if (a[1] != null) return a; const r = C.range(a[0], r0, it.q, it.anc); return [a[0], r ? r[1] : null]; });
    };
    const qi = q('[data-k=q]'); if (qi) qi.onchange = e => { if (it.q) freeze(); it.q = Math.max(1, Math.min(70, +e.target.value || 1)); if (!C.canAncient(C.itemRarity(it), it.q)) it.anc = false; save(); };
    const anc = q('[data-k=anc]'); if (anc) anc.onchange = e => { freeze(); it.anc = e.target.checked; save(); };
    box.querySelectorAll('[data-k=maxall]').forEach(b => (b.onclick = () => { it.imp = {}; it.aff = it.aff.map(a => [a[0], null]); save(); }));
    box.querySelectorAll('[data-imp]').forEach(inp => (inp.onchange = e => { const st = e.target.dataset.imp; it.imp[st] = fromDisp(st, +e.target.value); save(); }));
    box.querySelectorAll('[data-affv]').forEach(inp => (inp.onchange = e => { const a = it.aff.find(x => x[0] === e.target.dataset.affv); a[1] = fromDisp(a[0], +e.target.value); save(); }));
    box.querySelectorAll('[data-affs]').forEach(sel => (sel.onchange = e => { const a = it.aff.find(x => x[0] === e.target.dataset.affs); a[0] = e.target.value; a[1] = null; save(); }));
    box.querySelectorAll('[data-affdel]').forEach(btn => (btn.onclick = e => { it.aff = it.aff.filter(x => x[0] !== e.target.dataset.affdel); save(); }));
    box.querySelectorAll('[data-affadd]').forEach(sel => (sel.onchange = e => { if (e.target.value) { it.aff.push([e.target.value, null]); save(); } }));
    box.querySelectorAll('[data-gem]').forEach(sel => (sel.onchange = e => { it.gems[+e.target.dataset.gem] = e.target.value; it.gems = it.gems.filter(Boolean); save(); }));
    const clr = q('[data-k=clear]'); if (clr) clr.onclick = () => onSave(null);
    const eqb = q('[data-k=equip]');
    if (eqb) {
      box.querySelectorAll('[data-k=equip]').forEach(btn => (btn.onclick = () => {
        const slot = btn.dataset.slot;
        const old = build.gear[slot];
        if (it.item || it.rar) build.gear[slot] = it; else delete build.gear[slot];
        // keep the previously equipped item as the candidate, so you can switch back
        if (old) build.compare[s.kind] = old; else delete build.compare[s.kind];
        selSlot = slot;
        update();
      }));
      q('[data-k=copy]').onclick = () => onSave(JSON.parse(JSON.stringify(build.gear[s.id] || emptyItem())));
      q('[data-k=drop]').onclick = () => onSave(null);
    }
  }

  // ------------------------------------------------------------------ screenshot OCR (tools/server.py)
  let ocrTargets = null, ocrTarget = null, lastOcr = null;
  function pickImage(tgt) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => inp.files[0] && runOcr(inp.files[0], tgt);
    inp.click();
  }
  function dropZone(el, tgt) {
    el.ondragover = e => { e.preventDefault(); el.classList.add('drop'); };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = e => {
      e.preventDefault(); el.classList.remove('drop');
      const f = [...(e.dataTransfer.files || [])].find(x => x.type.startsWith('image/'));
      if (f) runOcr(f, tgt);
    };
  }
  document.addEventListener('paste', e => {
    if (tab !== 'items' || !ocrTargets) return;
    const f = [...(e.clipboardData ? e.clipboardData.items : [])].find(x => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    runOcr(f.getAsFile(), ocrTarget || 'equipped');
  });
  async function runOcr(file, tgt) {
    const s = ocrTargets.slot;
    toast('Reading the screenshot…');
    let res;
    try {
      const r = await fetch(`/api/ocr?slot=${encodeURIComponent(s.id)}&level=${build.level}&cls=${build.cls}`, { method: 'POST', body: file });
      if (!(r.headers.get('content-type') || '').includes('json')) throw new Error('no-server');
      res = await r.json();
    } catch (err) {
      dialog('Screenshot reading is not running', `<p>Reading item screenshots needs the planner's Python server. Stop the current server and start the planner with:</p>
        <pre>python tools/server.py</pre><p>then open <a href="http://localhost:8765">http://localhost:8765</a>. Install the OCR once with <code>pip install rapidocr-onnxruntime pillow</code>.</p>`);
      return;
    }
    if (res.error) { dialog('Could not read the item', `<p>${esc(res.error)}</p>${(res.lines || []).length ? '<p class="muted small">Text found: ' + res.lines.map(esc).join(' · ') + '</p>' : ''}`); return; }
    lastOcr = Object.assign({ tgt }, res);
    ocrTarget = tgt;
    (tgt === 'candidate' ? ocrTargets.candidate : ocrTargets.equipped)(res.item);
  }
  function renderOcrNote() {
    const box = $('#ocr-note');
    if (!box || !lastOcr) return;
    const r = lastOcr;
    box.innerHTML = `<div class="note"><b>Read from the screenshot into the ${r.tgt === 'candidate' ? 'candidate' : 'equipped'} item.</b> Check the values; you can fix anything in the editor.
      ${r.warnings.map(w => `<div class="bad small">⚠ ${esc(w)}</div>`).join('')}
      <details><summary class="small">What was recognized (${r.report.length} of ${r.lines.length} lines)</summary>
      <table class="t small">${r.lines.map(l => { const m = r.report.find(x => x.line === l); return `<tr><td>${esc(l)}</td><td style="text-align:left">${m ? '→ ' + esc(m.as) : '<span class="muted">ignored</span>'}</td></tr>`; }).join('')}</table></details>
      <button id="ocr-close" class="small">Hide</button></div>`;
    $('#ocr-close').onclick = () => { lastOcr = null; box.innerHTML = ''; };
  }

  // Full stat comparison: equipped build vs. the same build with the candidate in this slot.
  function snapshot(r) {
    const st = r.st, def = r.def, dmg = r.dmg;
    const main = C.MAIN[build.cls];
    const rows = [
      ['Offense'],
      ['Combined DPS', dmg.dpsSingle, 'n'], ['AoE DPS (' + build.cfg.enemies + ' enemies)', dmg.dpsAoe, 'n'],
      ...dmg.rows.map(x => ['· ' + x.name + ' DPS', x.dps, 'n']),
      ...dmg.procRows.map(x => ['· ' + x.name + ' DPS', x.dps, 'n']),
      ...dmg.dots.map(x => ['· ' + x.name.replace(/ \(.*\)/, '') + ' DPS', x.dps, 'n']),
      ['Attacks / sec', r.rot.R, 'n2'], ['Weapon damage', r.wb.damage, 'n'], ['Weapon speed', r.wb.speed, 'n2'],
      ['Crit chance', Math.min(1, st.critChance), 'p'], ['Crit damage', st.critDamage, 'p'],
      [main[0].toUpperCase() + main.slice(1), st.main, 'n'],
      ['Mana in / sec', r.rot.manaIn, 'n1'],
      ['Defense'],
      ['Life', st.maxHealth, 'n'], ['Mana', st.maxMana, 'n'],
      ['Armor', st.armor, 'n'], ['Armor reduction', def.armorDR, 'p'],
      ['Magic resist', st.magicResist, 'n'], ['Magic resist reduction', def.mrDR, 'p'],
      ['Dodge', def.dodge, 'p'], ['Critical damage reduction', def.critDR, 'p'], ['Less damage taken', 1 - def.less, 'p'],
      ['Thorns', st.thorns, 'n'],
      ['Toughness', def.toughness, 'n'],
      ['Hits to die', def.toughnessHits, 'n1'],
      ['Life recovery / sec', def.recovery, 'n1'],
      ['Life on hit', st.lifeOnHit, 'n'], ['Life on kill', st.lifeOnKill, 'n'], ['Life regeneration', st.lifeRegen, 'n'],
      ['Move speed', st.moveSpeed, 'p'],
    ];
    // every plain stat total (all sources added up)
    const keys = new Set();
    for (const m of r.col.mods) {
      if (m.ab || m.tag || m.role || /^(proc|pulse|cast-damage|extra-part|focus|gathered|cheat-death|bleed-from|ability-level)/.test(m.s)) continue;
      keys.add(m.s);
    }
    const statRows = [...keys].map(s => {
      const g = D.groups[s] || {};
      return [statLabel(s), r.E.sum(s, null, r.st), g.pct || /pct$|more|less/.test(s) ? 'p' : 'n1', s];
    });
    return { rows, statRows };
  }

  const sameKindSlots = s => D.slots.filter(x => x.kind === s.kind);

  // Compare the candidate against what is equipped. For rings the candidate is tried in each ring slot.
  function renderCompare(s) {
    const cand = build.compare[s.kind];
    const variants = sameKindSlots(s).map(t => {
      const nb = JSON.parse(JSON.stringify(build));
      if (cand && (cand.item || cand.rar)) nb.gear[t.id] = cand; else delete nb.gear[t.id];
      const r = C.compute(normalize(nb));
      const cur = itemTitle(build.gear[t.id], t);
      return { slot: t, r, snap: snapshot(r), label: sameKindSlots(s).length > 1 ? 'Replace ' + t.name : 'Candidate', replaces: cur.name };
    });
    const a = snapshot(result);
    const fv = (v, f) => v == null ? '—' : f === 'p' ? pct(v, 1) : f === 'n2' ? fmt(v, 2) : f === 'n1' ? fmt(v, 1) : fmt(v);
    const cells = (v1, v2, f) => {
      const d = (v2 || 0) - (v1 || 0);
      const eps = f === 'p' ? 1e-5 : 0.05;
      const same = Math.abs(d) < eps;
      const rel = v1 ? d / Math.abs(v1) : null;
      const dtxt = same ? '' : (d > 0 ? '+' : '') + fv(d, f) + (rel != null && f !== 'p' && isFinite(rel) ? ` <span class="small">(${d > 0 ? '+' : ''}${fmt(rel * 100, 1)}%)</span>` : '');
      return `<td>${fv(v2, f)}</td><td class="${same ? 'muted' : d > 0 ? 'good' : 'bad'}">${dtxt}</td>`;
    };
    const changed = (v1, vs) => vs.some(v2 => Math.abs((v2 || 0) - (v1 || 0)) > 1e-6);
    const cols = 2 + variants.length * 2;
    // align rows by label (abilities, procs and DoTs can differ between builds)
    const labels = [];
    for (const row of a.rows.concat(...variants.map(v => v.snap.rows))) if (!labels.find(x => x[0] === row[0])) labels.push(row);
    const head = (n, v1, v2) => {
      const d = v2 - v1, p = v1 ? d / v1 * 100 : 0;
      return `<span class="cmp-big ${Math.abs(d) < 0.5 ? 'muted' : d > 0 ? 'good' : 'bad'}">${n} ${d >= 0 ? '+' : ''}${fmt(p, 1)}%</span>`;
    };
    const best = variants.length > 1 ? variants.reduce((x, y) => (y.r.dmg.dpsSingle > x.r.dmg.dpsSingle ? y : x)) : null;
    let html = `<div class="card" style="margin-top:12px"><h2>Equipped → candidate</h2>`;
    for (const v of variants) {
      html += `<p>${variants.length > 1 ? `<b>${esc(v.label)}</b> <span class="muted small">(${esc(v.replaces)})</span>${v === best && Math.abs(variants[0].r.dmg.dpsSingle - variants[1].r.dmg.dpsSingle) > 0.5 ? ' <span class="badge ok">best for DPS</span>' : ''}<br>` : ''}
        ${head('DPS', result.dmg.dpsSingle, v.r.dmg.dpsSingle)} ${head('Toughness', result.def.toughness, v.r.def.toughness)}</p>`;
    }
    html += `<p><label><input type="checkbox" id="cmp-only" ${build.cmpOnly ? 'checked' : ''}> Only show what changes</label></p>
      <table class="t cmp"><tr><th>Stat</th><th>Equipped</th>${variants.map(v => `<th>${esc(v.label)}</th><th>Change</th>`).join('')}</tr>`;
    for (const row of labels) {
      if (row.length === 1) { html += `<tr class="hdr"><td colspan="${cols}">${esc(row[0])}</td></tr>`; continue; }
      const v1 = (a.rows.find(x => x[0] === row[0]) || [])[1];
      const vs = variants.map(v => (v.snap.rows.find(x => x[0] === row[0]) || [])[1]);
      if (build.cmpOnly && !changed(v1, vs)) continue;
      html += `<tr><td>${esc(row[0])}</td><td>${fv(v1, row[2])}</td>${vs.map(v2 => cells(v1, v2, row[2])).join('')}</tr>`;
    }
    html += `<tr class="hdr"><td colspan="${cols}">All stat totals</td></tr>`;
    const all = a.statRows.concat(...variants.map(v => v.snap.statRows));
    for (const k of [...new Set(all.map(x => x[3]))].sort()) {
      const ra = a.statRows.find(x => x[3] === k), any = all.find(x => x[3] === k);
      const v1 = ra ? ra[1] : 0;
      const vs = variants.map(v => { const rb = v.snap.statRows.find(x => x[3] === k); return rb ? rb[1] : 0; });
      if (build.cmpOnly && !changed(v1, vs)) continue;
      html += `<tr><td>${esc(any[0])}</td><td>${fv(v1, any[2])}</td>${vs.map(v2 => cells(v1, v2, any[2])).join('')}</tr>`;
    }
    html += '</table></div>';
    $('#cmp-res').innerHTML = html;
    $('#cmp-only').onchange = e => { build.cmpOnly = e.target.checked; store.set(LS_CUR, build); renderCompare(s); };
  }

  function gemTxt([st, v]) {
    const g = D.groups[st];
    return (g && g.pct ? '+' + fmt(v * 100, 1) + '% ' : '+' + fmt(v, 0) + ' ') + (g ? g.name : st);
  }

  // ------------------------------------------------------------------ runes
  function viewRunes() {
    const slots = D.runeSlots.filter(l => l <= build.level).length;
    const list = Object.entries(D.runes).filter(([, r]) => !r.cls || r.cls === build.cls);
    const used = new Set(build.runes.map(r => r[0]));
    let html = `<h2>Runes <span class="muted small">— ${slots} of ${D.runeSlots.length} slots open at level ${build.level} (slots open at ${D.runeSlots.join(', ')})</span></h2><div class="cards">`;
    for (let i = 0; i < D.runeSlots.length; i++) {
      const cur = build.runes[i];
      const r = cur && D.runes[cur[0]];
      html += `<div class="card"><div class="row"><b>Slot ${i + 1}</b><span class="muted small">opens at ${D.runeSlots[i]}</span></div>`;
      if (i >= slots) { html += '<div class="muted small">Locked</div></div>'; continue; }
      html += `<div class="row" style="margin-top:6px"><select data-rune="${i}"><option value="">— empty —</option>${groupRunes(list).map(([set, rs]) => `<optgroup label="${esc(set)}">${rs.map(([id, x]) =>
        `<option value="${id}" ${cur && cur[0] === id ? 'selected' : ''} ${cur && cur[0] !== id && used.has(id) ? 'disabled' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select>
        Lv <input type="number" min="1" max="${D.maxRune}" data-rl="${i}" value="${cur ? cur[1] : D.maxRune}"></div>`;
      if (r) html += `<div class="abil" style="margin-top:6px">${icon(r.icon)}<div class="small">${r.attrs.map(([st, vals]) => gemTxt([st, vals[Math.min(cur[1], vals.length) - 1]])).join('<br>')}
        ${r.abilities.map(a => `<div class="muted">Raises the level of ${esc((D.abilities[a] || {}).name || a)}</div>`).join('')}</div></div>`;
      html += '</div>';
    }
    html += '</div><h3>Set bonuses</h3>';
    const sets = result.col.activeSets;
    if (!sets.length) html += '<div class="muted">No rune set equipped.</div>';
    html += '<table class="t"><tr><th>Set</th><th>Pieces</th><th>Bonus</th><th>Used in numbers</th></tr>' + sets.map(x =>
      `<tr class="${x.on ? '' : 'sub'}"><td>${esc(x.set)}</td><td>${x.have}/${x.pieces}</td><td style="text-align:left">${esc(x.text)}</td><td>${x.modeled ? '<span class="badge ok">yes</span>' : '<span class="badge no">text</span>'}</td></tr>`).join('') + '</table>';
    $('#view').innerHTML = html;
    $('#view').querySelectorAll('[data-rune]').forEach(s => (s.onchange = e => {
      const i = +e.target.dataset.rune;
      if (e.target.value) build.runes[i] = [e.target.value, build.runes[i] ? build.runes[i][1] : D.maxRune]; else build.runes.splice(i, 1);
      build.runes = build.runes.filter(Boolean); update();
    }));
    $('#view').querySelectorAll('[data-rl]').forEach(s => (s.onchange = e => { const i = +e.target.dataset.rl; if (build.runes[i]) { build.runes[i][1] = Math.max(1, Math.min(D.maxRune, +e.target.value || 1)); update(); } }));
  }
  function groupRunes(list) {
    const g = {};
    for (const [id, r] of list) { const n = (D.sets[r.set] || {}).name || 'Other'; (g[n] = g[n] || []).push([id, r]); }
    return Object.entries(g);
  }

  // ------------------------------------------------------------------ minion
  const RARITY_ORDER = ['divine', 'legendary', 'rare', 'uncommon', 'common'];
  const LS_MINF = 'dkp.minionFilter';
  function viewMinion() {
    const f = Object.assign({ q: '', rar: [], sort: 'rarity' }, store.get(LS_MINF, {}));
    const rarities = RARITY_ORDER.filter(r => D.minions.some(m => m.rarity === r));
    const cur = build.minion && D.minions.find(m => m.id === build.minion);
    $('#view').innerHTML = `<h2>Active minion</h2><p class="muted">Its passive bonuses are added to your stats. Active abilities are listed for reference.</p>
      <div class="card" style="margin-bottom:10px">Equipped: ${cur ? `<b class="r-${cur.rarity}">${esc(cur.name)}</b> <button id="mi-none" class="small">Remove</button>` : '<span class="muted">no minion</span>'}</div>
      <div class="filters"><input id="mi-q" type="search" placeholder="Search name, bonus or ability…" value="${esc(f.q)}">
        ${rarities.map(r => `<label class="chip r-${r} ${f.rar.includes(r) ? 'on' : ''}"><input type="checkbox" data-rar="${r}" ${f.rar.includes(r) ? 'checked' : ''}>${esc(D.rarities.find(x => x.id === r).name)}</label>`).join('')}
        <select id="mi-sort"><option value="rarity" ${f.sort === 'rarity' ? 'selected' : ''}>Sort: rarity</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>Sort: name</option></select>
        <span id="mi-count" class="muted small"></span></div>
      <div class="cards" id="mi-list"></div>`;
    const list = () => {
      const q = f.q.trim().toLowerCase();
      const text = m => (m.name + ' ' + m.passive.map(p => p.name + ' ' + p.desc).join(' ') + ' ' + m.active.join(' ')).toLowerCase();
      const shown = D.minions
        .filter(m => !f.rar.length || f.rar.includes(m.rarity))
        .filter(m => !q || q.split(/\s+/).every(w => text(m).includes(w)))
        .sort((a, b) => (f.sort === 'rarity' ? RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) : 0) || a.name.localeCompare(b.name));
      $('#mi-count').textContent = `${shown.length} of ${D.minions.length}`;
      $('#mi-list').innerHTML = shown.map(m => {
        const mods = M.minionMods(m);
        return `<div class="card" data-mi="${m.id}" style="cursor:pointer;${build.minion === m.id ? 'border-color:var(--accent)' : ''}"><div class="abil">${icon(m.icon)}<div>
          <b class="r-${m.rarity}">${esc(m.name)}</b>${m.locked ? ' <span class="badge">locked</span>' : ''}${build.minion === m.id ? ' <span class="badge ok">equipped</span>' : ''}
          <div class="small">${m.passive.map(p => esc(p.desc.replace('{value}', p.vals.value ? fmtVal(p.vals.value.v[0], p.vals.value.f) : '?'))).join('<br>')}</div>
          ${m.active.length ? `<div class="small muted">Active: ${m.active.map(esc).join(', ')}</div>` : ''}
          ${m.passive.length && !mods.length ? '<span class="badge no">text only</span>' : ''}</div></div></div>`;
      }).join('') || '<p class="muted">No minion matches.</p>';
    };
    const saveF = () => store.set(LS_MINF, f);
    $('#mi-q').oninput = e => { f.q = e.target.value; saveF(); list(); };
    $('#mi-sort').onchange = e => { f.sort = e.target.value; saveF(); list(); };
    $('#view').querySelectorAll('[data-rar]').forEach(cb => (cb.onchange = e => {
      const r = e.target.dataset.rar;
      f.rar = e.target.checked ? f.rar.concat(r) : f.rar.filter(x => x !== r);
      e.target.parentElement.classList.toggle('on', e.target.checked);
      saveF(); list();
    }));
    $('#mi-list').onclick = e => { const c = e.target.closest('[data-mi]'); if (c) { build.minion = c.dataset.mi; update(); } };
    const none = $('#mi-none'); if (none) none.onclick = () => { build.minion = null; update(); };
    list();
  }

  // ------------------------------------------------------------------ configuration
  function viewConfig() {
    let html = '<h2>Configuration</h2><div class="cfg-grid">';
    for (const [group, rows] of M.CONFIG_DEFS) {
      html += `<div class="card"><h3>${esc(group)}</h3>`;
      if (group === 'Enemy') html += `<div class="cfg-row"><label title="Statuses your equipped abilities inflict count as active">Statuses my abilities apply are active</label><input type="checkbox" data-cfg="autoStatus" ${build.cfg.autoStatus ? 'checked' : ''}></div>`;
      for (const [k, type, , label, help, opts] of rows) {
        const v = build.cfg[k];
        const auto = result.cfgEff[k] && !v && type === 'check' ? ' <span class="badge ok">from skills</span>' : '';
        html += `<div class="cfg-row"><label title="${esc(help)}">${esc(label)}${auto}</label>${type === 'check' ? `<input type="checkbox" data-cfg="${k}" ${v ? 'checked' : ''}>`
          : type === 'select' ? `<select data-cfg="${k}">${opts.map(([ov, ol]) => `<option value="${ov}" ${ov === v ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`
          : `<input type="number" step="any" data-cfg="${k}" value="${v}">`}</div>`;
      }
      if (group === 'Enemy') {
        const L = build.cfg.enemyLevel || build.level;
        const sc = C.enemyScale(L);
        html += `<div class="note small">From the game files (GameConfig): an enemy of level ${L} has <b>×${fmt(sc.health, 1)}</b> the health and <b>×${fmt(sc.damage, 1)}</b> the damage of a level-1 enemy.
          Elites ×${C.GAME_CONFIG.elite.health} health / ×${C.GAME_CONFIG.elite.damage} damage. Difficulty: ${C.GAME_CONFIG.difficulties.map(d => `${d.name} ×${d.health} / ×${d.damage}`).join(' · ')}.</div>`;
      }
      html += '</div>';
    }
    html += `<div class="card"><h3>Custom modifiers</h3><p class="small muted">One per line, e.g. <code>+50% Physical Damage</code>, <code>+300 Armor</code>, <code>+10% Critical Hit Chance</code>, <code>20% more Damage</code>, <code>15% less Damage Taken</code>. Lines starting with # are ignored.</p>
      <textarea id="custom">${esc(build.custom || '')}</textarea>${result.col.customBad.length ? `<div class="warn">Not understood: ${result.col.customBad.map(esc).join('; ')}</div>` : ''}</div>`;
    html += '</div>';
    $('#view').innerHTML = html;
    $('#view').querySelectorAll('[data-cfg]').forEach(inp => (inp.onchange = e => {
      const k = e.target.dataset.cfg;
      build.cfg[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.tagName === 'SELECT' ? e.target.value : +e.target.value;
      update();
    }));
    $('#custom').onchange = e => { build.custom = e.target.value; update(); };
  }

  // ------------------------------------------------------------------ calcs
  function viewCalcs() {
    const r = result, rows = r.dmg.rows;
    if (!calcAbility || !rows.find(x => x.id === calcAbility)) calcAbility = rows[0] && rows[0].id;
    let html = '<h2>Calculation breakdown</h2>';
    html += `<div class="note">Hit = (weapon damage + flat damage) × ability % × main stat × (1 + element) × (1 + basic/strong/special + ability) × (1 + all damage) × (1 + conditional "damage vs") × more × vulnerable; average = hit × (1 + crit chance × crit damage).
      Each bracket is a separate multiplier, following the community formula "Base DMG × Ability × STR/INT/DEX × DMG Type × Basic/Strong".</div>`;
    html += `<p>Ability: ${rows.map(x => `<button data-ca="${x.id}" class="${x.id === calcAbility ? 'primary' : ''}">${esc(x.name)}</button>`).join(' ')}</p>`;
    const row = rows.find(x => x.id === calcAbility);
    if (row) {
      html += `<table class="t"><tr><th>Part</th><th>Ability %</th><th>Base</th><th>Main stat</th><th>Element</th><th>Role + ability</th><th>All dmg</th><th>Conditional</th><th>More</th><th>Vulnerable</th><th>Electrostatic</th><th>Hit</th><th>Crit %</th><th>Crit dmg</th><th>Average</th><th>Hits</th></tr>`;
      for (const p of row.parts) html += `<tr><td>${esc(p.label)} <span class="muted small">${p.el}</span></td><td>${pct(p.pct, 0)}</td><td>${fmt(p.base)}</td><td>×${fmt(p.mainMult, 2)}</td><td>+${pct(p.elemInc, 0)}</td><td>+${pct(p.roleInc, 0)}</td><td>+${pct(p.allInc, 0)}</td><td>+${pct(p.condInc, 0)}</td><td>×${fmt(p.more, 2)}</td><td>×${fmt(p.vuln, 2)}</td><td>×${fmt(p.estatic, 2)}</td><td>${fmt(p.hit)}</td><td>${pct(p.cc, 1)}</td><td>${pct(p.cd, 0)}</td><td>${fmt(p.avg)}</td><td>${fmt(p.hitsMain, 2)}</td></tr>`;
      html += `</table><p class="muted small">Casts per second ${fmt(row.rate, 3)} · damage per cast ${fmt(row.perCast)} · DPS ${fmt(row.dps)}</p>`;
      const ab = D.abilities[row.id];
      const srcs = ['more', 'ability-damage-pct', 'critical-hit-chance-pct', 'critical-hit-damage-pct', 'hits-more', 'mana-cost-pct', 'cooldown-reduction-pct'];
      html += '<h3>Modifiers that apply to this ability</h3><table class="t"><tr><th>Stat</th><th>Source</th><th>Value</th></tr>';
      for (const s of srcs) for (const m of r.E.list(s, ab, r.st)) if (m.v) html += `<tr><td>${esc(s)}</td><td>${esc(m.label || m.src)}</td><td>${fmt(m.v * 100, 1)}%</td></tr>`;
      html += '</table>';
    }
    if (r.dmg.dots.length) {
      html += '<h3>Damage over time</h3><table class="t"><tr><th>DoT</th><th>Base / s</th><th>Element</th><th>DoT inc.</th><th>Conditional</th><th>DPS</th></tr>';
      for (const d of r.dmg.dots) html += `<tr><td>${esc(d.name)}</td><td>${fmt(d.detail.base)}</td><td>+${pct(d.detail.elemInc, 0)}</td><td>+${pct(d.detail.dotInc, 0)}</td><td>+${pct(d.detail.condInc, 0)}</td><td>${fmt(d.dps)}</td></tr>`;
      html += '</table>';
    }
    // defense
    const def = r.def;
    html += `<h3>Defense</h3><p><b>Toughness ${fmt(def.toughness)}</b> = life ${fmt(r.st.maxHealth)} / (1 − average of armor ${pct(def.armorDR)} and magic resist ${pct(def.mrDR)} reduction) / (1 − dodge ${pct(def.dodge)}) — the in-game formula.
      Hits to die: ${fmt(def.toughnessHits, 1)} at ${fmt(def.hit)} per hit.</p>
      <p class="muted small">Per damage type, without dodge (typed reductions and "less damage taken" are not part of the game's Toughness):</p><table class="t"><tr><th>Damage type</th><th>Armor / resist</th><th>Typed reduction</th><th>Other</th><th>Total mitigation</th><th>Max hit (EHP)</th><th>Hits to die</th></tr>`;
    for (const el of C.ELEMENTS) {
      const t = def.types[el];
      html += `<tr><td>${el}</td><td>${pct(el === 'physical' ? def.armorDR : def.mrDR)}</td><td>${pct(t.typeDR)}</td><td>${pct(1 - def.less)}</td><td>${pct(t.mitig)}</td><td>${fmt(t.ehp)}</td><td>${fmt(def.hitsToDie[el], 1)}</td></tr>`;
    }
    html += `</table><p class="muted small">Armor and magic resist use DR = value / (value + K × enemy level ${def.L}). Dodge (${pct(def.dodge)}) avoids direct hits entirely and is not in "max hit"; enemy crits hit ×${fmt(def.critMulti, 2)} after your critical damage reduction.</p>`;
    // all stats
    html += '<h3>Stat totals and sources</h3><table class="t"><tr><th>Stat</th><th>Total (unscoped)</th><th>Sources</th></tr>';
    const stats = [...new Set(r.col.mods.map(m => m.s))].sort();
    for (const s of stats) {
      const l = r.E.list(s, null, r.st);
      const scoped = r.col.mods.filter(m => m.s === s && (m.ab || m.tag || m.role)).length;
      if (!l.length && !scoped) continue;
      const tot = l.reduce((a, m) => a + m.v, 0);
      const name = statLabel(s);
      const isP = (D.groups[s] || {}).pct || /pct$|more|less/.test(s);
      html += `<tr><td>${esc(name)}</td><td>${isP ? pct(tot, 1) : fmt(tot, 1)}</td><td style="text-align:left"><details><summary class="muted small">${l.length} source(s)${scoped ? ` + ${scoped} ability-specific` : ''}</summary>${l.map(m => `<div class="small">${esc(m.label || m.src)}: ${isP ? pct(m.v, 1) : fmt(m.v, 1)}</div>`).join('')}</details></td></tr>`;
    }
    html += '</table>';
    if (r.col.itemInfo.length) html += '<h3>Item effects</h3>' + r.col.itemInfo.map(x => `<div class="small">${esc(x.name)}: ${esc(x.text)} <span class="badge ${x.modeled ? 'ok' : 'no'}">${x.modeled ? 'in calculations' : 'text only'}</span></div>`).join('');
    if (r.col.talentInfo.length) html += `<h3>Talents shown as text only</h3><div class="small muted">${r.col.talentInfo.map(esc).join(', ')}</div>`;
    $('#view').innerHTML = html;
    $('#view').querySelectorAll('[data-ca]').forEach(b => (b.onclick = e => { calcAbility = e.target.dataset.ca; viewCalcs(); }));
  }

  // ------------------------------------------------------------------ assumptions
  function viewAssumptions() {
    const groups = {};
    M.DEFAULT_MECH.forEach(row => (groups[row[4]] = groups[row[4]] || []).push(row));
    let html = `<h2>Assumptions</h2><div class="note">The game data gives every ability %, talent value and affix range, but not how stats combine. These values are the model's guesses. Change them to match what your in-game character sheet shows — every number in the planner follows.</div>
      <p><button id="as-reset">Reset all to defaults</button></p><div class="cfg-grid">`;
    for (const [g, rows] of Object.entries(groups)) {
      html += `<div class="card"><h3>${esc(g)}</h3>`;
      for (const [k, def, label, help] of rows) {
        const v = build.mech[k];
        html += `<div class="cfg-row"><label title="${esc(help)}">${esc(label)}${v !== def ? ' <span class="badge guess">changed</span>' : ''}<br><span class="small muted">${esc(help)}</span></label><input type="number" step="any" data-mech="${k}" value="${v}"></div>`;
      }
      html += '</div>';
    }
    html += `</div><h3>Read from the game files</h3><div class="card small">
      <p>These come from <code>GameConfig</code> in the game's assets (Unity IL2CPP build, field names from the metadata):</p>
      <table class="t"><tr><th>Setting</th><th>Value</th></tr>
      <tr><td>Enemy health / damage growth per level, levels 1–30</td><td>+12% / +10%</td></tr>
      <tr><td>Levels 31–50</td><td>+8% / +4%</td></tr>
      <tr><td>Levels 51–70</td><td>+6% / +3%</td></tr>
      <tr><td>Elite health / damage multipliers</td><td>×3 / ×1.5</td></tr>
      <tr><td>Difficulty tiers (health / damage)</td><td>Normal ×1/×1 · Nightmare ×3.5/×1.35 · Inferno ×6/×1.8</td></tr>
      <tr><td>Max player level / rune slots</td><td>70 / opens at 40, 45, 50, 55, 60, 65</td></tr>
      <tr><td>Health potion (first tier)</td><td>heals 25 + 30% max health over 3 s</td></tr>
      </table>
      <p class="muted">The hero's own base stats (base health, crit, dodge, attack speed, health and primary stat per level) are stored in the <code>Player</code> object behind the game's anti-cheat value encryption (ACTk), so they stay assumptions here.</p></div>`;
    $('#view').innerHTML = html;
    $('#view').querySelectorAll('[data-mech]').forEach(inp => (inp.onchange = e => { build.mechEdits[e.target.dataset.mech] = +e.target.value; update(); }));
    $('#as-reset').onclick = () => { build.mechEdits = {}; update(); };
  }

  // ------------------------------------------------------------------ about
  function viewAbout() {
    const n = k => Object.keys(D[k]).length;
    const talentsModeled = Object.values(D.talents).flat().filter(t => M.TALENT_FX[t.id]).length;
    const talentsAll = Object.values(D.talents).flat().length;
    const fxItems = Object.values(D.items).filter(i => i.effect).length;
    $('#view').innerHTML = `<h2>About</h2><div class="card">
      <p>A Path of Building–style planner for <b>Deskrawl: Idle ARPG</b>: put together talents, gear, gems, runes, abilities and a minion, and see the damage per second of the rotation and your effective hit pool (how big a hit you survive, and how many hits).</p>
      <h3>Data</h3>
      <ul>
        <li>Skills, talents, item affixes and ranges, gems, runes, rune sets, legendaries and minions: <a href="${esc(D.source)}" target="_blank" rel="noopener">AFK Meta</a> (game data as of ${esc(D.asOf || '?')}), read on ${esc((D.crawledAt || '').slice(0, 10))}. Re-run <code>node tools/crawl.js</code> after a patch.</li>
        <li>${n('abilities')} abilities, ${talentsAll} talents (${talentsModeled} in the calculations, the rest shown as text), ${n('items')} named items (${fxItems} with an effect, ${Object.keys(M.ITEM_FX).length} modeled), ${n('runes')} runes, ${D.gems.length} gem families, ${D.minions.length} minions.</li>
        <li>Enemy scaling, elite and difficulty multipliers: read from the game's own <code>GameConfig</code> asset.</li>
      </ul>
      <h3>Model</h3>
      <ul>
        <li>Rotation: specials on cooldown, strong attack whenever mana allows, basic attack the rest of the time. Self-buffs (Rage Shout, Phantom Form, Flame Aura…) are averaged by uptime (see Configuration).</li>
        <li>Damage buckets are multiplied together (main stat, element, attack type, all damage, conditional, more, vulnerable, crit).</li>
        <li>Defense is summed up by Toughness, the game's own formula: life ÷ (1 − average of armor and magic resist reduction) ÷ (1 − dodge). The Calcs tab also shows the largest hit you survive per damage type.</li>
        <li>Values not published by the game (stat scaling, armor curve, base stats, poison/burn damage, some hit counts) are editable on the Assumptions tab and marked "assumption" next to the abilities.</li>
      </ul>
      <p class="muted small">Unofficial fan tool. Deskrawl: Idle ARPG © First Day Games. Icons load from AFK Meta.</p></div>`;
  }

  // ------------------------------------------------------------------ boot
  initHeader();
  initTabs();
  window.addEventListener('hashchange', () => { const b = loadInitial(); if (b) { build = b; update(); } });
  update();
})();
