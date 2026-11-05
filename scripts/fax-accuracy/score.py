# 読み取りの生の結果を正解と行ごとに比べ、表（Markdown）と集計（JSON）を出す。使い方: python score.py <ラベル>
import io, json, sys
from pathlib import Path

here = Path(__file__).parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf8")  # Windows でも表が化けないように
label = sys.argv[1]
exp = json.loads((here / "expected.json").read_text(encoding="utf8"))
raw = json.loads((here / f"raw-{label}.json").read_text(encoding="utf8"))

def level(conf, att):  # src/lib/aliases.ts の confidenceLevel と同じ
    if conf < 0.6: return "low"
    if conf < 0.85 or (att and att.strip()): return "mid"
    return "high"

tot = dict(lines=0, ok=0, wrong=0, wrong_flagged=0, ok_flagged=0, missing=0, extra=0, must_flag=0, must_flag_hit=0,
           docs=0, kind_ok=0, cust_ok=0, rot_ok=0, ppu_checked=0, ppu_ok=0, prev_checked=0, prev_ok=0)
rows_md, miss_md = [], []
for name, e in exp.items():
    r = raw.get(name, {}).get("read")
    if not r:
        rows_md.append(f"| {name} | {e['what']} | 読み取り失敗 | | | | |")
        continue
    tot["docs"] += 1
    kind_ok = r["kind"] == e["kind"]
    cust_ok = (r["sender"]["matched_customer_id"] or "") == e["customer"]
    rot_ok = (r["rotation_degrees"] % 360) == e["rotation"]
    tot["kind_ok"] += kind_ok; tot["cust_ok"] += cust_ok; tot["rot_ok"] += rot_ok
    got = [(o["delivery_date"], l) for o in r["orders"] for l in o["lines"]]
    used = set()
    ok = wrong = flagged_wrong = 0
    for item in e["lines"]:
        date, pid, qty = item[:3]
        opt = item[3] if len(item) > 3 else {}
        tot["lines"] += 1
        # 同じ納品日・商品の行（同じ商品が2行あるときは数量が合う方を先に）
        cands = [i for i, (d, l) in enumerate(got) if i not in used and d == date and l["product_id"] == pid]
        cands.sort(key=lambda i: got[i][1]["quantity"] != qty)
        if not cands:
            # 商品の対応だけ外れた行（同じ納品日・同じ数量）
            alt = [i for i, (d, l) in enumerate(got) if i not in used and d == date and l["quantity"] == qty]
            if alt:
                i = alt[0]; used.add(i); l = got[i][1]
                fl = level(l["confidence"], l["attention"]) != "high"
                wrong += 1; flagged_wrong += fl
                miss_md.append(f"| {name} | {date} {pid} {qty} | 商品を {l['product_id'] or '（なし）'} と読んだ（書いてある品名「{l['written_name']}」） | {'○' if fl else '×'} | {l['confidence']:.2f} | {l['attention'] or ''} |")
            else:
                tot["missing"] += 1
                miss_md.append(f"| {name} | {date} {pid} {qty} | 読み落とし | — | | |")
            continue
        i = cands[0]; used.add(i); l = got[i][1]
        fl = level(l["confidence"], l["attention"]) != "high"
        good = l["quantity"] == qty
        if "ppu" in opt:
            tot["ppu_checked"] += 1; tot["ppu_ok"] += l["pieces_per_unit"] == opt["ppu"]
            good = good and l["pieces_per_unit"] == opt["ppu"]
        if "prev" in opt:
            tot["prev_checked"] += 1; tot["prev_ok"] += l["previous_quantity"] == opt["prev"]
        if opt.get("mustFlag"):
            tot["must_flag"] += 1; tot["must_flag_hit"] += fl
        if good:
            ok += 1; tot["ok_flagged"] += fl
        else:
            wrong += 1; flagged_wrong += fl
            miss_md.append(f"| {name} | {date} {pid} {qty} | 数量 {l['quantity']}・入数 {l['pieces_per_unit']} と読んだ | {'○' if fl else '×'} | {l['confidence']:.2f} | {l['attention'] or ''} |")
    extra = [got[i] for i in range(len(got)) if i not in used]
    for d, l in extra:
        miss_md.append(f"| {name} | （正解に無い行） | {d} {l['product_id']} {l['quantity']}「{l['written_name']}」 | {'○' if level(l['confidence'], l['attention']) != 'high' else '×'} | {l['confidence']:.2f} | {l['attention'] or ''} |")
    tot["ok"] += ok; tot["wrong"] += wrong; tot["wrong_flagged"] += flagged_wrong; tot["extra"] += len(extra)
    n = len(e["lines"])
    rows_md.append(f"| {name} | {e['what']} | {'○' if kind_ok else '×（' + r['kind'] + '）'} | {'○' if cust_ok else '×（' + (r['sender']['matched_customer_id'] or 'なし') + '）'} | {'○' if rot_ok else '×（' + str(r['rotation_degrees']) + '）'} | {ok}/{n} | {r.get('format_kind', '')} |")

print(f"## {label}\n")
print("| FAX | 中身 | 種類 | 取引先 | 向き | 行（品名・数量・納品日・入数）が合った数 | 様式の型 |\n|---|---|---|---|---|---|---|")
print("\n".join(rows_md))
print("\n外れた行・余分な行（印＝自信度が中以下か、注意の文が付いていた）\n")
print("| FAX | 正解 | 読み取り | 印 | 自信度 | 注意の文 |\n|---|---|---|---|---|---|")
print("\n".join(miss_md) or "| （なし） | | | | | |")
print("\n```json\n" + json.dumps(tot, ensure_ascii=False) + "\n```")
