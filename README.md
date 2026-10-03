# Deskrawl Planner

A Path of Building–style build planner for **Deskrawl: Idle ARPG**. Plain HTML/JS, no build step.

## Run it

```bash
python tools/server.py
```

Then open http://localhost:8765. Ctrl+C stops it. If port 8765 is taken, pass another one: `python tools/server.py 8766`.

The server also reads item screenshots (see below). Any static server works too (`python -m http.server 8765`), just without screenshots: pasting one then says "Screenshot reading is not running". Don't open `index.html` directly: it loads its scripts from local files.

### Item screenshots (OCR)

Install the OCR once:

```bash
pip install -r tools/requirements.txt
```

On the Items tab, take a screenshot of an item tooltip (Win+Shift+S) and press Ctrl+V, or use the 📷 button, or drop an image file on an editor. The item goes into the selected editor (Equipped or Candidate): base item, rarity, item level, affixes with their values, and gems. A note lists what each line was read as. If the tooltip doesn't show the item level, it's guessed from the values. Comma decimals (`42,8%`) are supported.

The same reader works on the command line:

```bash
python tools/ocr_item.py tooltip.png --slot weapon --level 24
```

## What it does

- **Talents**: the full tree of each class with its row gates. Left-click adds a point, right-click removes one. Hovering a talent shows how one more point changes DPS and Toughness.
- **Paragon**: after level 70, set your Paragon level and spend points in the 15 Paragon stats (values from the game files). Each stat shows what one more point adds to DPS and Toughness, and the best next point is tagged.
- **Skills**: the four ability slots and their levels. A table shows each ability's casts per second, damage per cast, DPS, and buff uptime.
- **Items**: 12 slots. Pick a generic item of a rarity or a named base, set the item level and Ancient flag, add affixes (checked against the in-game ranges), and socket gems. Legendary and divine effects are in the calculations when the planner models them.
- **Runes**: slots unlock with hero level. Rune levels 1–6 and set bonuses (2/4/6 pieces) are supported.
- **Minion**: its passive bonuses are added to your stats.
- **Configuration**: enemy state (Elite, Vulnerable, Poisoned…), number of enemies for AoE DPS, enemy hit size, buff uptime mode, and custom modifier lines.
- **Calcs**: each damage multiplier for each ability, a defense table for every damage type, and every stat with its sources.
- **Assumptions**: the formulas the game doesn't publish, all editable.
- **Import/Export**: share links (`#b=…`), build codes, and AFK Meta build links in both directions.

### Outputs

- **Combined DPS**: specials are cast on cooldown, the strong attack whenever mana allows, and basic attacks fill the rest. Procs, legendary triggers and DoTs (bleed, poison, burn) are added on top.
- **Toughness**: the game's own survivability number, life ÷ (1 − average of armor and magic resist reduction) ÷ (1 − dodge), and how many hits of the configured size you survive. The Calcs tab also breaks down the largest hit you survive per damage type.

## Data sources

| Data | Source |
|---|---|
| Abilities (values per level, mana, cooldowns, tags), talents, affix pools and ranges per level and rarity, gems, runes and sets, legendary effects, minions | [AFK Meta](https://afkmeta.com/en/deskrawl/), via `node tools/crawl.js` → `data/deskrawl-data.js` |
| Enemy growth per level (by 1–30, 31–50, 51–70), elite multipliers, difficulty tiers | The game's `GameConfig` asset (`GameFiles/`) |

Re-run `node tools/crawl.js` after a game patch.

## Formulas

Most of the math is now published by [wikily.gg](https://wikily.gg/deskrawl/stats/damage-formula) and checked against an in-game character sheet:

- Hit = (weapon damage + Damage) × ability % × (1 + main stat / 100) × (1 + element + Bonus All Damage) × crit × (1 + "Damage vs" bonuses) × (1 + Basic/Strong/Special bonus). Crits deal 1 + Critical Hit Damage (heroes start at 150%, so 250%); crit chance is capped at 85%.
- Vulnerable targets take ×1.3. Poisoned deals 50% weapon damage every 2 s per stack (up to 100 stacks, 6 s + 0.5 s per ability level). Bleeding deals 250% over 5 s and reapplying keeps the remaining damage.
- Armor and magic resist reduce damage by `R / (R + 50 × enemy level)`. Dodge is capped at 85%. Strength gives 1 armor and Intelligence 1 magic resist per point; Dexterity gives critical damage reduction `Dex / (Dex + 1500)`.
- Toughness = life ÷ (1 − average of the armor and magic resist reduction) ÷ (1 − dodge). Recovery = (life regen + attacks/s × life on hit + 0.25 × life on kill) × Toughness ÷ life.
- Base stats: 100 life + 16 per level, 100 mana, 10 of the class main stat (no growth per level), 5% dodge.
- Spirit Twin repeats your Basic and Strong attacks at full damage while it's out (confirmed in game).
- Runes raise their ability by 2 levels (4 at rune level 6); a set's rune I by 4 (6).

### Still assumptions

Editable on the Assumptions tab (only the values you change are saved with a build):

- Burn damage per tick, the Electrostatic bonus per stack, base mana regeneration.
- Hit counts the game doesn't publish: Rapid Fire arrows, Whirlwind hits per 4 s channel, Frost Beam and Ice Meteor ticks, Sacred Orbs and Divine Thunder hits, Whirlwind Staff tornado hits, Fire Elemental fireballs. They're marked "assumption" next to the ability.

## Files

- `index.html`, `css/app.css`, `js/app.js`: the UI
- `js/calc.js`: stats, rotation, damage and defense engine
- `js/mechanics.js`: assumptions, configuration, ability hit models, and the talent/legendary/set effect mappings
- `tools/crawl.js`: data refresh
- `tools/server.py`, `tools/ocr_item.py`: local server and item screenshot reader

## Missing info you can check in game

These numbers aren't in the game data or on any site we found. If you play the class, a quick check in the **Training Grounds** (training dummy) settles them: watch the damage numbers during one cast, or read the tooltip. Send the result and it replaces the assumption in `js/mechanics.js`.

### Any class

- **Base mana regeneration**: Mana Regeneration on the character sheet with no gear and no mana talents (assumed 2/s).
- **Cooldown reduction cap**: the highest Cooldown Reduction the sheet will show (assumed 75%).
- **Weapon damage with no weapon**: unequip the weapon and check the "Attack" value or a hit on the dummy (assumed 10).
- **Enemy critical hits**: how much harder an enemy crit hits you than a normal hit (assumed ×1.5).
- **Blacksmith upgrades**: an item's stats before and after one upgrade (+1), to see how upgrades scale affixes.
- **Divine items**: the fixed stats of Glorious Gladiator Helmet, Visage of the Undying, The Grandmother, Violet Skybow, Soulrender and Remnant of the Elder Sage.
- **Level-10 ability tooltips**: AFK Meta and wikily.gg disagree slightly (Threefold Strike 110% / 400% vs 107.5% / 380%). One level-10 tooltip shows which site is current.

### Monk

- **Sacred Orbs**: how many times one orb hits a single enemy per cast (assumed 5).
- **Divine Thunder**: number of pulses during the 3 s channel (assumed 4).
- **Whirlwind Staff**: hits on a single enemy per cast, from both tornados (assumed 4).
- **Electrostatic**: the extra Lightning damage per stack (assumed +5%). Charged Orb and Thundering use it.
- **Chain Force**: does the 7th Basic cast deal +100% damage (AFK Meta) or apply Vulnerable (wikily.gg)?
- **Chi Expenditure**: damage per extra mana spent, to model it.

### Hunter

- **Rapid Fire**: arrows per 2 s channel (assumed 10).
- **Arcane Arrowstorm**: hits per cast on one enemy (assumed 6).
- **Arcane Corrosion**: confirm the 150% / 350% detonation on Arcane Bomb or Multishot, to model it.
- **Improved Steady Shot**: damage per pierced enemy, to model it in AoE.

### Sorcerer

- **Burn**: damage of one tick (Burn lasts 3 s and ticks every 0.5 s; assumed 20% weapon damage per second).
- **Frost Beam**: ticks per 3 s channel (assumed 6).
- **Ice Meteor**: ticks during the 3 s field (assumed 6).
- **Fire Elemental**: how long it stays and how many fireballs it shoots (assumed 10).
- **Ice Block**: damage of the shatter when it ends.
- **Electrostatic**: same as Monk (Static Charge, Current Transfer).

### Warrior

- **Whirlwind**: hits on one enemy during the 4 s channel (assumed 8).
- **Hemorrhage, Ironward, Deepening Wounds**: their effects aren't modeled yet; a short fight log with them would help.
