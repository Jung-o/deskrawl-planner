# Deskrawl Planner

A Path of Building–style build planner for **Deskrawl: Idle ARPG**. Plain HTML/JS, no build step.

## Run it

The page loads its scripts from local files, so serve the folder instead of opening `index.html` directly:

```bash
python -m http.server 8765
```

Then open http://localhost:8765.

## What it does

- **Talents**: the full tree of each class with its row gates. Left-click adds a point, right-click removes one. Hovering a talent shows how one more point changes DPS and EHP.
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
- **Effective hit pool**: the largest hit you survive per damage type, after armor or magic resist, typed reductions and "less damage taken". It's also shown counting dodge, and for a critical hit, along with how many hits you survive.

## Data sources

| Data | Source |
|---|---|
| Abilities (values per level, mana, cooldowns, tags), talents, affix pools and ranges per level and rarity, gems, runes and sets, legendary effects, minions | [AFK Meta](https://afkmeta.com/en/deskrawl/), via `node tools/crawl.js` → `data/deskrawl-data.js` |
| Enemy growth per level (by 1–30, 31–50, 51–70), elite multipliers, difficulty tiers | The game's `GameConfig` asset (`GameFiles/`) |

Re-run `node tools/crawl.js` after a game patch.

## Assumptions (not in any published data)

These are the defaults on the Assumptions tab. Change them to match your in-game character sheet:

- Main stat: +1% damage per point; 1 armor per Strength, 1 magic resist per Intelligence, 0.01% dodge per Dexterity.
- Armor and magic resist damage reduction: `value / (value + 50 × enemy level)`.
- Base stats: life `200 + 20/level`, mana 100, 2 mana regen per second, 5% crit chance, +50% crit damage, 3 main stat per level.
- Vulnerable: +20% damage taken. Poison: 15% weapon damage per second per stack, 4 s, max 10 stacks. Burn: 20% per second. Bleed: 250% over 5 s.
- Hit counts for channelled or multi-hit skills whose numbers aren't published: Rapid Fire, Whirlwind, Frost Beam and others are marked "assumption" next to the ability.

The hero's base stats are in the game files (`Player` component) but protected by the anti-cheat toolkit's value encryption, so they aren't decoded yet.

## Files

- `index.html`, `css/app.css`, `js/app.js`: the UI
- `js/calc.js`: stats, rotation, damage and defense engine
- `js/mechanics.js`: assumptions, configuration, ability hit models, and the talent/legendary/set effect mappings
- `tools/crawl.js`: data refresh
