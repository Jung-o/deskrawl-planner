#!/usr/bin/env python3
"""Read a Deskrawl item tooltip screenshot and turn it into a planner item.

    python tools/ocr_item.py screenshot.png --slot weapon --level 24 --cls monk

Prints the item as JSON (the same format the planner stores). The planner uses this
through tools/server.py: paste a screenshot (Ctrl+V) on the Items tab.

Needs:  pip install rapidocr-onnxruntime pillow
"""
import argparse
import difflib
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "deskrawl-data.js"

_ocr = None
_data = None


def data():
    global _data
    if _data is None:
        txt = DATA_FILE.read_text(encoding="utf8")
        txt = txt[txt.index("window.DESKRAWL=") + len("window.DESKRAWL="):].rstrip().rstrip(";")
        _data = json.loads(txt)
    return _data


def ocr_engine():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


def norm(s):
    """Lowercase, letters only: OCR often drops or adds spaces."""
    return re.sub(r"[^a-z]", "", s.lower())


# ----------------------------------------------------------------------------- OCR -> text lines
def read_lines(image):
    """OCR the image and group the text boxes into rows (labels and values are separate boxes)."""
    from PIL import Image
    if isinstance(image, (bytes, bytearray)):
        image = Image.open(io.BytesIO(image))
    elif isinstance(image, (str, Path)):
        image = Image.open(image)
    image = image.convert("RGB")
    # Small tooltips read better a little larger.
    if image.width < 900:
        f = 900 / image.width
        image = image.resize((int(image.width * f), int(image.height * f)), Image.LANCZOS)
    import numpy as np
    res, _ = ocr_engine()(np.array(image))
    boxes = []
    for box, text, conf in res or []:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        boxes.append({"x": min(xs), "y": (min(ys) + max(ys)) / 2, "h": max(ys) - min(ys), "text": text, "conf": conf})
    boxes.sort(key=lambda b: b["y"])
    rows = []
    for b in boxes:
        if rows and abs(rows[-1]["y"] - b["y"]) < 0.55 * max(b["h"], rows[-1]["h"]):
            rows[-1]["boxes"].append(b)
        else:
            rows.append({"y": b["y"], "h": b["h"], "boxes": [b]})
    lines = []
    for r in rows:
        parts = sorted(r["boxes"], key=lambda b: b["x"])
        lines.append(" ".join(p["text"] for p in parts).strip())
    return [l for l in lines if l]


# ----------------------------------------------------------------------------- numbers
NUM_RE = re.compile(r"[+-]?\d+(?:[.,]\d+)*")


def parse_number(tok):
    """'42,8' -> 42.8 ; '1,586' -> 1586 ; '6.694' -> 6694 ; '1.06' -> 1.06."""
    sign = -1 if tok.startswith("-") else 1
    tok = tok.lstrip("+-")
    groups = re.split(r"[.,]", tok)
    if len(groups) == 1:
        return sign * float(groups[0])
    last = groups[-1]
    if len(last) == 3 and len(groups[0]) <= 3:
        return sign * float("".join(groups))  # thousands separator
    return sign * float("".join(groups[:-1]) + "." + last)


# ----------------------------------------------------------------------------- stat names
def stat_aliases():
    """normalized label -> (flat stat, percent stat). Built from the game's affix names plus synonyms."""
    D = data()
    names = dict(D["statNames"])
    pct_stats = {k for k, sc in D["scale"].items() if sc == 1000}
    al = {}

    def put(label, stat):
        n = norm(label)
        flat, pct = al.get(n, (None, None))
        if stat in pct_stats:
            pct = stat
        else:
            flat = stat
        al[n] = (flat, pct)

    for stat, label in names.items():
        put(label, stat)
    synonyms = {
        "bonus-all-damage": ["All Damage", "Damage"],
        "bonus-armor": ["Armor"],
        "bonus-health": ["Health", "Max Health", "Maximum Health"],
        "max-health": ["Health", "Maximum Health", "HP", "Max HP"],
        "critical-hit-chance": ["Crit Chance", "Critical Chance"],
        "critical-hit-damage": ["Crit Damage", "Critical Damage"],
        "critical-damage-reduction": ["Crit Damage Reduction"],
        "weapon-speed": ["Attack Speed", "Attacks per Second", "Speed"],
        "weapon-damage": ["Damage", "Weapon Damage"],
        "damage-vs-vulnerable": ["Vulnerable Damage"],
        "damage-vs-elite": ["Damage vs Elites", "Damage to Elite"],
        "item-find": ["Magic Find"],
        "health-potion-find": ["Potion Find", "HP Potion Find"],
        "xp-gained": ["XP Gain", "Experience"],
        "life-regeneration": ["Life Regen", "Health Regeneration"],
        "bonus-move-speed": ["Move Speed", "Movement Speed"],
        "dodge-chance": ["Dodge"],
        "thorns": ["Thorn"],
        "special-ability-bonus-damage": ["Special Ability Damage"],
    }
    for stat, labels in synonyms.items():
        for l in labels:
            put(l, stat)
    return al


def match_label(label, allowed, has_pct):
    """Best stat for an OCR label among `allowed` stats. Returns (stat, score)."""
    n = norm(label)
    if len(n) < 3:
        return None, 0
    best, score = None, 0
    for alias, (flat, pct) in ALIASES.items():
        stat = pct if has_pct and pct else flat if not has_pct and flat else (pct or flat)
        if stat not in allowed:
            continue
        r = difflib.SequenceMatcher(None, n, alias).ratio()
        # an exact alias wins over fuzzy ones; prefer the stat that fits the % sign
        if (pct if has_pct else flat) == stat:
            r += 0.02
        if r > score:
            best, score = stat, r
    return (best, score) if score >= 0.78 else (None, score)


ALIASES = None


# ----------------------------------------------------------------------------- item parsing
def parse_item(lines, slot=None, level=None, cls=None):
    global ALIASES
    if ALIASES is None:
        ALIASES = stat_aliases()
    D = data()
    slots = {s["id"]: s for s in D["slots"]}
    items = D["items"]
    rarities = [r["id"] for r in D["rarities"]]
    report = []
    warnings = []

    # item name: best fuzzy match of any line against item names
    item_id, best = None, 0
    for line in lines:
        n = norm(line)
        if len(n) < 5:
            continue
        for iid, it in items.items():
            if slot and slots.get(slot) and it["slot"] != slots[slot]["kind"]:
                continue
            r = difflib.SequenceMatcher(None, n, norm(it["name"])).ratio()
            if r > best:
                item_id, best = iid, r
    if best < 0.82:
        item_id = None
    if item_id:
        report.append({"line": items[item_id]["name"], "as": "item: " + items[item_id]["name"]})
    if not slot:
        slot = items[item_id]["slot"] if item_id else None
    if not slot or slot not in slots:
        return {"error": "Could not tell the item slot: pick a slot in the planner first.", "lines": lines}
    s = slots[slot]

    text = " \n".join(lines).lower()
    rar = items[item_id]["rarity"] if item_id else None
    if not rar:
        for r in reversed(rarities):  # 'uncommon' before 'common'
            if re.search(r"\b" + r + r"\b", text):
                rar = r
                break
    ancient = "ancient" in text

    q = None
    m = re.search(r"(item\s*level|ilvl|item\s*lv)\D{0,4}(\d{1,2})", text)
    if m:
        q = int(m.group(2))
    else:
        m = re.search(r"(requires?\s*(hero\s*)?level|req\.?\s*lv|level\s*req\w*)\D{0,4}(\d{1,2})", text)
        if m:
            q = min(70, int(m.group(3)) + 1)  # an item of level q needs hero level q-1
            report.append({"line": m.group(0), "as": f"item level {q} (from required level)"})

    # stats
    allowed = set(s["imp"]) | set(s["pri"]) | set(s["sec"])
    gem_names = {t["id"]: t["name"] for g in D["gems"] for t in g["tiers"]}
    imp, aff, gems = {}, [], []
    for line in lines:
        low = line.lower()
        g = max(gem_names.items(), key=lambda kv: difflib.SequenceMatcher(None, norm(line), norm(kv[1])).ratio())
        if difflib.SequenceMatcher(None, norm(line), norm(g[1])).ratio() > 0.85:
            gems.append(g[0])
            report.append({"line": line, "as": "gem: " + g[1]})
            continue
        nums = NUM_RE.findall(line)
        if not nums or re.search(r"item\s*level|ilvl|requires|level\s*\d", low):
            continue
        has_pct = "%" in line
        label = NUM_RE.sub(" ", line).replace("%", " ")
        label = re.sub(r"[^A-Za-z ]", " ", label).strip()
        if not label:
            continue
        stat, score = match_label(label, allowed, has_pct)
        if not stat:
            if len(norm(label)) > 3 and len(label) < 40:
                warnings.append(f'Not an affix of this slot: "{line}"')
            continue
        # a weapon's speed line can show DPS too: take the first number after/before the label
        val = parse_number(nums[0])
        if stat == "weapon-speed" and val > 5:
            continue
        scale = D["scale"].get(stat, 1)
        raw = round(val * 10) if scale == 1000 else round(val * scale)
        if stat in imp or any(a[0] == stat for a in aff):
            continue
        if stat in s["imp"]:
            imp[stat] = raw
        else:
            aff.append([stat, raw])
        report.append({"line": line, "as": f'{D["statNames"].get(stat, stat)} = {val}{"%" if scale == 1000 else ""}'})

    pri = [a for a in aff if a[0] in s["pri"]]
    sec = [a for a in aff if a[0] in s["sec"]]
    if not rar:
        rar = "legendary" if len(pri) >= 4 else "rare" if len(pri) == 3 or sec else "uncommon" if len(pri) == 2 else "common"
        warnings.append(f"Rarity not found in the text, guessed {rar} from the number of affixes.")
    n_pri, n_sec = D["rarCount"].get(rar, [4, 1])
    if len(pri) > n_pri or len(sec) > n_sec:
        warnings.append(f"Found {len(pri)} primary / {len(sec)} secondary affixes, a {rar} item has {n_pri} / {n_sec}.")

    # item level: if the tooltip does not say, pick the levels where every value is inside its roll range
    if q is None and rar in D["rolled"]:
        fits = [lv for lv in range(1, 71) if all_in_range(imp, aff, rar, lv, ancient)]
        if fits:
            q = max([lv for lv in fits if level is None or lv <= level + 1] or fits)
            warnings.append(f"Item level not shown: guessed {q} (values fit item levels {fits[0]}–{fits[-1]}).")
        else:
            q = level or D["maxLevel"]
            warnings.append(f"Item level not shown and some values fit no level: set to {q}, please check.")
    if ancient and not (q and D["bands"][q - 1][2] and rar in D["ancRar"]):
        ancient = False

    item = {
        "item": item_id,
        "rar": None if item_id else rar,
        "q": q if rar in D["rolled"] else None,
        "anc": ancient,
        "imp": imp,
        "aff": aff,
        "gems": gems[: s["sock"]],
    }
    return {"item": item, "slot": slot, "lines": lines, "report": report, "warnings": warnings}


def rng(stat, rar, q, anc):
    D = data()
    table = D["ancient"] if anc else D["ranges"]
    r = table.get(stat, {}).get(rar)
    if not r:
        return None
    r = r[q - 1]
    if not r:
        return None
    return [r, r] if isinstance(r, (int, float)) else r


def all_in_range(imp, aff, rar, q, anc):
    for stat, raw in list(imp.items()) + [tuple(a) for a in aff]:
        r = rng(stat, rar, q, anc)
        if r is None or not (r[0] <= raw <= r[1]):
            return False
    return True


def read_item(image, slot=None, level=None, cls=None):
    lines = read_lines(image)
    return parse_item(lines, slot=slot, level=level, cls=cls)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", help="screenshot of the item tooltip")
    ap.add_argument("--slot", help="planner slot id: weapon, helm, chest, pants, boots, belt, ring, ring-2, necklace, gloves, shoulder, back")
    ap.add_argument("--level", type=int, help="hero level (helps guess the item level)")
    ap.add_argument("--cls", help="class id")
    ap.add_argument("--lines", action="store_true", help="only print the OCR text lines")
    a = ap.parse_args()
    if a.lines:
        print("\n".join(read_lines(a.image)))
        return
    res = read_item(a.image, a.slot, a.level, a.cls)
    json.dump(res, sys.stdout, indent=2, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
