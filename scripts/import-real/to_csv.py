# 実データ（原価管理の Excel ブック）を、マスタの CSV（③の列名）に起こす。
#
# 使い方:
#   python -I scripts/import-real/to_csv.py <原価管理ブック.xlsm> [出力フォルダ]
#   出力フォルダの既定は data/import-real/（git の外）。
#
# 守ること:
#   - 原本は read_only で読むだけ。書き換えない。
#   - 出力の CSV には実在の社名・単価が入る。リポジトリには入れない（data/ は .gitignore 済み）。
#   - このスクリプトには社名・商品名を書かない（読むのはシート名と列名だけ）。
#   - ID は見本のマスタと重ならないように「R-」で始める（R-M0001・R-D001・R-P001 など）。
#
#   ソースなど「サブ明細」の入れ子は、比率で材料に配る。
#
# 出す CSV（取り込む順。参照する側があとになるように）:
#   01_materials.csv  材料          ← 材料マスタ（入数g・1g単価）
#   02_packaging.csv  包材          ← 包材マスタ
#   03_toppings.csv   トッピング    ← トッピングレシピ
#   04_toppingItems.csv トッピングの中身 ← トッピング明細（ソースなどの入れ子は材料まで展開）
#   05_doughs.csv     生地          ← 生地レシピ
#   06_recipeItems.csv 生地の配合（ベーカーズ%）← 生地明細
#   07_steps.csv      工程          ← 商品工程（その生地の代表の商品）＋生地工程（条件をメモへ）
#   08_products.csv   商品          ← 商品マスタ（売価は取引先商品の卸価格のいちばん高い値）
#   09_productPackaging.csv 商品の包材 ← 商品包材
#   report.txt        読めなかった行・決めたことの一覧
import collections
import csv
import io
import os
import re
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")

HEADER_KEYS = ("材料ID", "包材ID", "生地名", "商品名", "トッピング名", "取引先名", "サブ名")
PREFIX = "R-"


def table(wb, name):
    """見出しの行（材料ID・生地名 などがある行）から下を dict の list にする。列名の末尾の ＊ は外す"""
    rows = list(wb[name].iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and any(isinstance(v, str) and v in HEADER_KEYS for v in r))
    head = [str(v).rstrip("＊") if v is not None else "" for v in rows[hi]]
    out = []
    for r in rows[hi + 1:]:
        if not r or all(v in (None, "") for v in r):
            continue
        d = dict(zip(head, r))
        d.pop("", None)
        out.append(d)
    return out


def num(v, default=None):
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def fmt(v):
    """CSV に書く文字。数は余計な 0 を付けない"""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "はい" if v else "いいえ"
    if isinstance(v, float):
        s = f"{round(v, 4):.4f}".rstrip("0").rstrip(".")
        return s if s not in ("-0", "") else "0"
    return str(v).strip()


def write(path, header, rows):
    with io.open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow([fmt(r.get(h)) for h in header])


# 工程名 → 工程の種類（③の STEP_KEY_OPTIONS の見出し）と、時間の扱い
#   wait  … 待ち時間（量に関係なし）
#   batch … ミキサー1回ごと
#   piece … 仕上バッチの個数で割って 1個あたりの秒
STEP_RULES = [
    (r"^材料搬入|^材料検品|^保管$|^出荷|^配送|人件費|稼働時間", None, None),
    (r"^計量", "計量", "batch"),
    (r"ミキシング|^本捏|^種$", "ミキシング", "batch"),
    (r"^1次発酵|^常温発酵", "1次発酵", "wait"),
    (r"^ベンチ", "ベンチタイム", "wait"),
    (r"^分割", "分割", "piece"),
    (r"冷蔵|^冷蔵保管", "冷蔵発酵", "wait"),
    (r"^2次発酵|^3次発酵|^ホイロ", "ホイロ", "wait"),
    (r"^成形|伸ばし|シーター|型抜き|鉄板|塗り込み|まぶし|溶かし|製造$", "成形", "piece"),
    (r"^トッピング|投入", "トッピング", "piece"),
    (r"^焼成", "焼成", "piece"),
    (r"^冷却|^冷まし", "冷却", "wait"),
    (r"フリーザー", "急速冷凍", "wait"),
    (r"冷凍庫", "その他", "wait"),
    (r"カット", "スライス", "piece"),
    (r"^包装", "包装", "piece"),
    (r"^金属", "金属検出", "piece"),
    (r"^梱包", "箱詰め", "piece"),
]


def step_rule(name):
    for pat, key, how in STEP_RULES:
        if re.search(pat, name):
            return key, how
    return "その他", "piece"


def main():
    if len(sys.argv) < 2:
        print("使い方: python -I scripts/import-real/to_csv.py <原価管理ブック.xlsm> [出力フォルダ]")
        sys.exit(1)
    src = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join("data", "import-real")
    os.makedirs(out_dir, exist_ok=True)
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    report = []

    # ── 材料 ──
    mats = table(wb, "材料マスタ")
    mat_id = {}
    mat_rows = []
    for m in mats:
        if not m.get("材料ID") or not m.get("材料名"):
            continue
        mid = PREFIX + str(m["材料ID"]).strip()
        mat_id[str(m["材料名"]).strip()] = mid
        grams = num(m.get("入数g"))
        per_g = num(m.get("1g単価"), 0.0)
        kg = grams / 1000 if grams else 1.0
        mat_rows.append({
            "材料ID": mid, "名前": m["材料名"], "在庫の単位": "kg", "発注先（仕入先ID）": "",
            "発注単位の量": kg, "発注単位の名前": f"{fmt(kg)}kg" if grams else "1kg",
            "単価（円/在庫の単位）": per_g * 1000, "在庫": 0, "安全在庫": 0,
            "保管場所": m.get("区分") or "", "使う": m.get("使用中") not in ("×", "いいえ", False),
        })
    write(os.path.join(out_dir, "01_materials.csv"),
          ["材料ID", "名前", "在庫の単位", "発注先（仕入先ID）", "発注単位の量", "発注単位の名前", "単価（円/在庫の単位）", "在庫", "安全在庫", "保管場所"],
          mat_rows)

    # ── 包材 ──
    pk_id = {}
    pk_rows = []
    for p in table(wb, "包材マスタ"):
        if not p.get("包材ID") or not p.get("包材名"):
            continue
        pid = PREFIX + "K" + str(p["包材ID"]).strip().lstrip("P")
        pk_id[str(p["包材名"]).strip()] = pid
        lot = num(p.get("入数"), 1.0) or 1.0
        unit_cost = num(p.get("単価"))
        if unit_cost is None:
            lp = num(p.get("ロット価格"))
            unit_cost = lp / lot if lp is not None else 0.0
        pk_rows.append({
            "包材ID": pid, "名前": p["包材名"], "在庫の単位": "枚", "発注先（仕入先ID）": "",
            "発注単位の量": lot, "発注単位の名前": f"{fmt(lot)}枚", "単価（円/在庫の単位）": unit_cost,
            "在庫": 0, "安全在庫": 0, "保管場所": p.get("用途区分") or "",
        })
    write(os.path.join(out_dir, "02_packaging.csv"),
          ["包材ID", "名前", "在庫の単位", "発注先（仕入先ID）", "発注単位の量", "発注単位の名前", "単価（円/在庫の単位）", "在庫", "安全在庫", "保管場所"],
          pk_rows)

    # ── トッピング（ソースなどの入れ子は、材料まで展開する） ──
    tops = [t for t in table(wb, "トッピングレシピ") if t.get("トッピング名")]
    top_id = {str(t["トッピング名"]).strip(): f"{PREFIX}T{i + 1:03d}" for i, t in enumerate(tops)}
    items_by_top = collections.defaultdict(list)
    for it in table(wb, "トッピング明細"):
        if it.get("トッピング名") and it.get("材料名"):
            items_by_top[str(it["トッピング名"]).strip()].append((str(it["材料名"]).strip(), num(it.get("使用g"), 0.0)))

    # サブレシピ（中種・ソース・フィリング）: 比率は合計で割って使う
    subs = collections.defaultdict(list)
    for it in table(wb, "サブ明細"):
        if it.get("サブ名") and it.get("材料名"):
            subs[str(it["サブ名"]).strip()].append((str(it["材料名"]).strip(), num(it.get("比率"), 0.0)))

    def expand(name, grams, depth=0):
        """トッピングの中身を材料まで。入れ子のトッピングは、その合計 g に対する割合で配る"""
        if name in mat_id:
            return {mat_id[name]: grams}
        src_items = items_by_top.get(name) or subs.get(name)
        if src_items and depth < 5:
            total = sum(g for _, g in src_items) or 0
            res = collections.Counter()
            if total <= 0:
                return res
            for child, g in src_items:
                for k, v in expand(child, grams * g / total, depth + 1).items():
                    res[k] += v
            return res
        report.append(f"トッピングの中身: 材料にもトッピングにも無い名前（とばす） [{name}]")
        return {}

    ti_rows = []
    for t in tops:
        name = str(t["トッピング名"]).strip()
        acc = collections.Counter()
        for child, g in items_by_top.get(name, []):
            for k, v in expand(child, g).items():
                acc[k] += v
        for k, v in acc.items():
            if v > 0:
                ti_rows.append({"トッピングID": top_id[name], "材料ID": k, "1個あたり（g）": v})
    write(os.path.join(out_dir, "03_toppings.csv"), ["トッピングID", "名前"],
          [{"トッピングID": top_id[str(t["トッピング名"]).strip()], "名前": t["トッピング名"]} for t in tops])
    write(os.path.join(out_dir, "04_toppingItems.csv"), ["トッピングID", "材料ID", "1個あたり（g）"], ti_rows)

    # ── 商品（生地のラインと代表の商品を決めるので、先に読む） ──
    prods = [p for p in table(wb, "商品マスタ") if p.get("商品名")]
    prod_id = {str(p["商品名"]).strip(): f"{PREFIX}P{i + 1:03d}" for i, p in enumerate(prods)}

    # ── 生地 ──
    doughs = [d for d in table(wb, "生地レシピ") if d.get("生地名")]
    dough_id = {}
    for i, d in enumerate(doughs):
        m = re.match(r"\s*(D\d+)", str(d.get("備考") or ""))
        dough_id[str(d["生地名"]).strip()] = PREFIX + (m.group(1) if m else f"D{900 + i}")
    is_pizza = lambda cls: bool(cls) and ("ピザ" in str(cls) or "生地玉" in str(cls))
    dough_line = {}
    for d in doughs:
        name = str(d["生地名"]).strip()
        uses = [p for p in prods if str(p.get("生地名") or "").strip() == name]
        pizza = sum(is_pizza(p.get("製品分類")) for p in uses)
        dough_line[name] = "ピザ" if (pizza * 2 > len(uses) if uses else "ピザ" in str(d.get("表示名") or "")) else "パン"
    write(os.path.join(out_dir, "05_doughs.csv"), ["生地ID", "名前", "ライン", "ロス率", "メモ"],
          [{"生地ID": dough_id[str(d["生地名"]).strip()], "名前": d["生地名"], "ライン": dough_line[str(d["生地名"]).strip()],
            "ロス率": num(d.get("ロス率"), 0.0),
            "メモ": f"標準仕込み粉量 {fmt(num(d.get('標準仕込み粉量g')))}g" if d.get("標準仕込み粉量g") else ""} for d in doughs])

    # ── 生地の配合 ──
    ri = collections.Counter()
    for r in table(wb, "生地明細"):
        dn, mn = str(r.get("生地名") or "").strip(), str(r.get("材料名") or "").strip()
        if not dn or not mn:
            continue
        if dn not in dough_id:
            report.append(f"生地の配合: 生地に無い名前（とばす） [{dn}]")
            continue
        if mn not in mat_id:
            report.append(f"生地の配合: 材料に無い名前（とばす） [{dn}] [{mn}]")
            continue
        ri[(dough_id[dn], mat_id[mn])] += num(r.get("ベーカーズ%"), 0.0)
    write(os.path.join(out_dir, "06_recipeItems.csv"), ["生地ID", "材料ID", "ベーカーズ％"],
          [{"生地ID": d, "材料ID": m, "ベーカーズ％": p} for (d, m), p in ri.items()])

    # ── 工程: 生地ごとに「代表の商品」（その生地でいちばん先に出てくる、工程のある商品）の工程を使う ──
    psteps = collections.defaultdict(list)
    for s in table(wb, "商品工程"):
        if s.get("商品名") and s.get("工程名"):
            psteps[str(s["商品名"]).strip()].append(s)
    dsteps = collections.defaultdict(list)
    for s in table(wb, "生地工程"):
        if s.get("生地名") and s.get("工程名"):
            dsteps[str(s["生地名"]).strip()].append(s)

    step_rows = []
    for d in doughs:
        dn = str(d["生地名"]).strip()
        did = dough_id[dn]
        rep = next((p for p in prods if str(p.get("生地名") or "").strip() == dn and psteps.get(str(p["商品名"]).strip())), None)
        # 生地工程の条件（ミキシングの速さ・水温・捏ね上げ温度・日程）はメモにまとめる
        cond = []
        for s in dsteps.get(dn, []):
            bits = [str(x) for x in (s.get("工程名"), s.get("条件"), s.get("基準・備考"), s.get("日程")) if x not in (None, "", "基準")]
            if s.get("分"):
                bits.append(f"{fmt(num(s['分']))}分")
            if len(bits) > 1:
                cond.append(" ".join(bits))
        prev_day = any(s.get("日程") for s in dsteps.get(dn, []))
        src_steps = psteps[str(rep["商品名"]).strip()] if rep else dsteps.get(dn, [])
        batch = (num(rep.get("仕上バッチ個数")) if rep else None) or 100.0
        seq = 0
        mix_done = False
        for s in sorted(src_steps, key=lambda x: num(x.get("順序"), 0)):
            key, how = step_rule(str(s["工程名"]).strip())
            if key is None:
                continue
            mins = num(s.get("分"), 0.0)
            people = int(num(s.get("人数"), 0) or 0)
            if mins <= 0 and people <= 0:
                continue
            if key == "ミキシング" and mix_done and not rep:
                # 生地工程だけのときは、ミキシングの行（1速・3速…）を1つにまとめる
                step_rows[-1]["ミキサー1回ごと（分）"] += mins
                continue
            seq += 1
            row = {"工程ID": f"{did}-{seq:02d}", "生地ID": did, "順番": seq, "工程の種類": key, "工程名": s["工程名"],
                   "人数": people, "段取り・調整（分）": 0, "待ち時間（分）": 0, "ミキサー1回ごと（分）": 0, "1個あたり（秒）": None,
                   "前日の作業": False, "CCP": bool(s.get("CCP")), "条件・メモ": " ".join(str(x) for x in (s.get("条件"), s.get("基準・備考")) if x)}
            if how == "wait":
                row["待ち時間（分）"] = mins
            elif how == "batch":
                row["ミキサー1回ごと（分）"] = mins
            elif rep:
                row["1個あたり（秒）"] = mins * 60 / batch
                row["条件・メモ"] = (row["条件・メモ"] + f" / 元: {fmt(mins)}分・{people}人で {fmt(batch)}個").strip(" /")
            else:
                row["段取り・調整（分）"] = mins
            if key == "ミキシング":
                mix_done = True
                if cond:
                    row["条件・メモ"] = (row["条件・メモ"] + " / 生地の工程: " + "；".join(cond)).strip(" /")[:500]
                row["前日の作業"] = prev_day and False  # 日程は条件に残す。前日かどうかは人が決める
            step_rows.append(row)
        if not seq:
            report.append(f"工程: 工程が読めなかった生地 [{dn}]")
        elif rep:
            report.append(f"工程: [{dn}] は商品 [{rep['商品名']}] の工程（仕上バッチ {fmt(batch)}個）")
    write(os.path.join(out_dir, "07_steps.csv"),
          ["工程ID", "生地ID", "順番", "工程の種類", "工程名", "人数", "段取り・調整（分）", "待ち時間（分）", "ミキサー1回ごと（分）", "1個あたり（秒）", "前日の作業", "CCP", "条件・メモ"],
          step_rows)

    # ── 商品 ──
    price = {}
    for r in table(wb, "取引先商品"):
        n, v = str(r.get("商品名") or "").strip(), num(r.get("卸価格"))
        if n and v is not None and v > 0:
            # 取引先ごとに卸価格が違うときは、いちばん高い値（商品のマスタの売価は1つだけなので）。
            # いちばん低い値にすると、ほかの取引先の分まで「粗利がマイナス」のお知らせが出てしまう
            price[n] = max(price.get(n, v), v)
    p_rows = []
    for p in prods:
        n = str(p["商品名"]).strip()
        dn = str(p.get("生地名") or "").strip()
        if dn not in dough_id:
            report.append(f"商品: 生地が無いので とばす [{n}] [{dn}]")
            continue
        g = num(p.get("生地g"))
        if not g or g <= 0:
            report.append(f"商品: 生地g が無いので とばす [{n}]")
            continue
        tn = str(p.get("トッピング名") or "").strip()
        bag, case = num(p.get("袋入数")), num(p.get("ケース入数"))
        p_rows.append({
            "商品ID": prod_id[n], "商品名": n, "種類": "自社製造", "単位": "個", "売価（円）": price.get(n, 0),
            "ライン": dough_line[dn], "生地ID": dough_id[dn], "分割（g）": round(g, 1),
            "トッピングID": top_id.get(tn, ""), "袋の入数": int(bag) if bag and bag >= 1 else None,
            "ケースの入数": int(case) if case and case >= 1 else None,
            "人件費（円/個）": num(p.get("人件費")),
        })
        if n not in price:
            report.append(f"商品: 卸価格が無いので売価 0 [{n}]")
    write(os.path.join(out_dir, "08_products.csv"),
          ["商品ID", "商品名", "種類", "単位", "売価（円）", "ライン", "生地ID", "分割（g）", "トッピングID", "袋の入数", "ケースの入数", "人件費（円/個）"],
          p_rows)

    # ── 商品の包材 ──
    per = {"袋": "1包・1袋", "ケース": "1ケース", "個": "1個"}
    made = {r["商品ID"] for r in p_rows}
    pp = collections.Counter()
    for r in table(wb, "商品包材"):
        n, k = str(r.get("商品名") or "").strip(), str(r.get("包材名") or "").strip()
        if not n or not k:
            continue
        if prod_id.get(n) not in made or k not in pk_id:
            report.append(f"商品の包材: 商品か包材が無いので とばす [{n}] [{k}]")
            continue
        pp[(prod_id[n], pk_id[k], per.get(str(r.get("単位") or "").strip(), "1個"))] += num(r.get("数量"), 1.0)
    write(os.path.join(out_dir, "09_productPackaging.csv"), ["商品ID", "包材ID", "数", "あたり"],
          [{"商品ID": a, "包材ID": b, "数": q, "あたり": c} for (a, b, c), q in pp.items()])

    summary = (f"材料 {len(mat_rows)} / 包材 {len(pk_rows)} / トッピング {len(tops)}（中身 {len(ti_rows)}） / 生地 {len(doughs)}（配合 {len(ri)}・工程 {len(step_rows)}） / "
               f"商品 {len(p_rows)} / 商品の包材 {len(pp)}")
    with io.open(os.path.join(out_dir, "report.txt"), "w", encoding="utf-8") as f:
        f.write(summary + "\n\n" + "\n".join(report) + "\n")
    print(summary)
    print(f"出力: {out_dir}（くわしくは report.txt）")


if __name__ == "__main__":
    main()
