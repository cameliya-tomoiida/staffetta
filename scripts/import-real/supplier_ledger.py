# 仕入先（パンメーカー）の商品台帳の Excel → マスタの CSV（⑧）。
#   30_suppliers.csv        … 仕入先（名前などは設定ファイルから。git に入れない）
#   31_supplierItems.csv    … 仕入先の商品台帳（品番・製品コード・品名・分類・定価・卸価格・原価・JAN・消費期限・工場・2便）
#   32_customerProducts.csv … 取引先の商品のうち、この仕入先の品（仕入れ元の名前で見分ける）で、商品コード＝品番の物の原価を台帳の原価に
#                              （今の行の中身を全部写して、原価だけ変える。変わらない行は出さない）
#   39_要確認.csv           … 突き合わせられなかった取引先の商品・品名が大きくちがう物
# 実名・単価・店番は git に入れない: 台帳・設定・出力はどれも data/（git の外）に置き、引数で渡す。
#
# 使い方:
#   python -I scripts/import-real/supplier_ledger.py <台帳.xlsx> <設定.json> <取引先の商品を読む DB> <出力フォルダ>
# 設定.json の例（git の外）:
#   {"supplier": {"id": "SP01", "name": "（仕入先の名前）", "method": "fax", "cutoff": "11:00", "leadDays": 1, "contact": "FAX …"},
#    "sources": ["（弥生の倉庫名の一部。例: 〇〇1便）"], "month": "2026-11", "priceSheet": "価格リストまとめ", "ledgerSheets": ["…Ａ (2)", "…Ｂ (2)"]}
import csv
import json
import re
import sqlite3
import sys
import unicodedata

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")

ledger_path, settings_path, db_path, out_dir = sys.argv[1:5]
S = json.load(open(settings_path, encoding="utf-8"))
sup = S["supplier"]
month = S.get("month", "")
JAN_PREFIX = S.get("janPrefix", "")


def norm(s):
    s = unicodedata.normalize("NFKC", str(s or ""))
    return re.sub(r"[\s　・()（）\[\]［］〈〉<>]", "", s).lower()


# 品名をくらべるとき外す言葉（頭の飾り・入数の書き方のちがい）
DROP = ["国産小麦", "ロングライフ", "ll", "個入り", "個入", "入り", "枚スライス", "枚入", "枚切", "スライス"]


def core(s):
    s = norm(s)
    s = re.sub(r"[①-⑳]", "", s)
    s = s.replace("厚ぎり", "厚切り")
    for w in DROP:
        s = s.replace(w, "")
    s = re.sub(r"^s(?=[^a-z])", "", s)
    return re.sub(r"\d+/箱|\d+", "", s)


def sim(a, b, strict=False):
    """品名の似ている度合い（0〜1）。strict なら「含まれる」を同じとみなさない（品番がちがう物を品名で決めるとき）"""
    from difflib import SequenceMatcher
    a, b = core(a), core(b)
    if not a or not b:
        return 0.0
    if not strict and (a in b or b in a):
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def pack_of(name):
    """品名の入数（取引先の商品は ①〜⑳、台帳は「６個入」「５枚」など）。わからなければ None"""
    s = unicodedata.normalize("NFKC", str(name or ""))
    m = re.search(r"[①-⑳]", str(name or ""))
    if m:
        return ord(m.group(0)) - ord("①") + 1
    m = re.search(r"(\d+)\s*(個|枚|本|切)", s)
    return int(m.group(1)) if m else None


def box_of(name):
    """「10/箱」「20個/箱」なら箱の入数（弥生は1箱の値段・台帳は1個の値段）"""
    m = re.search(r"(\d+)\s*個?\s*/\s*箱", unicodedata.normalize("NFKC", str(name or "")))
    return int(m.group(1)) if m else 1


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def itemno(v):
    if isinstance(v, (int, float)) and float(v).is_integer():
        return str(int(v))
    return None


wb = openpyxl.load_workbook(ledger_path, data_only=True, read_only=True)

# 1) 価格のまとめ（品番・JAN・品名・標準卸・原価）
items = {}
ws = wb[S.get("priceSheet", "価格リストまとめ")]
for row in ws.iter_rows(min_row=4, values_only=True):
    no = itemno(row[0])
    if not no or not row[2]:
        continue
    items[no] = {"itemNo": no, "name": str(row[2]).strip(), "jan": str(int(row[1])) if num(row[1]) else "", "wholesalePrice": num(row[3]), "cost": num(row[4])}

# 2) 台帳のシート（1行に3品。15列ごとに: 分類・品番・製品コード・品名・_・_・2便・定価・卸価格・原価・JAN下6けた・夏・冬・工場）
for sheet in S.get("ledgerSheets", []):
    ws = wb[sheet]
    cats = {}
    for row in ws.iter_rows(min_row=6, values_only=True):
        for base in range(0, len(row) - 13, 15):
            cat = row[base]
            if isinstance(cat, str) and cat.strip().startswith("〈"):
                cats[base] = cat.strip().strip("〈〉")
            no = itemno(row[base + 1])
            if not no or not row[base + 3]:
                continue
            it = items.setdefault(no, {"itemNo": no, "name": str(row[base + 3]).strip()})
            it.update({
                "productCode": itemno(row[base + 2]) or "",
                "category": cats.get(base, ""),
                "secondDelivery": "はい" if str(row[base + 6] or "").strip() in ("〇", "○", "◯") else "いいえ",
                "retailPrice": num(row[base + 7]),
            })
            if it.get("wholesalePrice") is None:
                it["wholesalePrice"] = num(row[base + 8])
            if it.get("cost") is None:
                it["cost"] = num(row[base + 9])
            if not it.get("jan") and num(row[base + 10]) and JAN_PREFIX:
                it["jan"] = f"{JAN_PREFIX}{int(row[base + 10]):06d}"
            it["shelfDaysSummer"] = itemno(row[base + 11]) or ""
            it["shelfDaysWinter"] = itemno(row[base + 12]) or ""
            it["factory"] = str(row[base + 13] or "").strip()

# ── 書く ──
def write(name, header, rows):
    with open(f"{out_dir}/{name}", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


write("30_suppliers.csv", ["仕入先ID", "名前", "発注方法", "連絡先", "締め時刻", "リードタイム（日）"],
      [[sup["id"], sup["name"], {"fax": "FAX", "email": "メール", "phone": "電話"}.get(sup.get("method", "fax"), "FAX"), sup.get("contact", ""), sup.get("cutoff", ""), sup.get("leadDays", "")]])

fmt = lambda v: "" if v is None else (str(int(v)) if float(v).is_integer() else f"{v:g}")
IH = ["仕入先ID", "品番", "製品コード", "品名", "分類", "定価（円）", "卸価格（円）", "原価（円）", "JAN", "消費期限 夏（日）", "消費期限 冬（日）", "製造工場", "2便で頼める", "台帳の月", "使う"]
write("31_supplierItems.csv", IH, [[
    sup["id"], it["itemNo"], it.get("productCode", ""), it["name"], it.get("category", ""), fmt(it.get("retailPrice")), fmt(it.get("wholesalePrice")), fmt(it.get("cost")),
    it.get("jan", ""), it.get("shelfDaysSummer", ""), it.get("shelfDaysWinter", ""), it.get("factory", ""), it.get("secondDelivery", ""), month, "はい",
] for it in sorted(items.values(), key=lambda x: int(x["itemNo"]))])

# 3) 取引先の商品の原価（仕入れ元の名前で、この仕入先の品を見分ける。商品コード＝品番）
db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
rows = [json.loads(j) for (j,) in db.execute("SELECT json FROM masters WHERE name = 'customerProducts' AND disabled = 0")]
WD = "日月火水木金土"
CH = ["得意先ID", "商品コード", "商品名", "STAFFETTA の商品ID", "単位", "卸価格（円）", "原価（円）", "単価の要確認", "仕入れ元の目安", "期間の数量", "よく出る曜日", "最後に出た日", "メモ", "使う"]
upd, check, same, matched, byname = [], [], 0, 0, 0
for r in rows:
    src = str(r.get("source", ""))
    if not any(s in src for s in S["sources"]):
        continue
    code = str(r.get("code", "")).lstrip("0")
    it = items.get(code)
    if it and sim(r.get("name"), it["name"]) < 0.6:
        check.append([r.get("customerId"), r.get("code"), r.get("name"), src, it["name"], "品番は同じだが、品名がちがう（原価は入れない）"])
        continue
    if not it:
        # 品番がちがう（弥生のコードが別）: 品名がとても似ていて、ほかに近い候補が無い物だけ
        cands = sorted(((sim(r.get("name"), x["name"], strict=True), x) for x in items.values()), key=lambda t: -t[0])
        best = cands[0] if cands else (0, None)
        second = cands[1][0] if len(cands) > 1 else 0
        if best[0] >= 0.85 and best[0] - second >= 0.1:
            it = best[1]
            byname += 1
        else:
            hint = f"候補: {best[1]['itemNo']} {best[1]['name']}（{best[0]:.2f}）" if best[1] and best[0] >= 0.5 else ""
            check.append([r.get("customerId"), r.get("code"), r.get("name"), src, hint, "台帳に同じ品番がなく、品名でも1つに決まらない"])
            continue
    a, b = pack_of(r.get("name")), pack_of(it["name"])
    if a is not None and b is not None and a != b:
        # 小分けにした品など（入数がちがうと 1つの原価がちがう）
        check.append([r.get("customerId"), r.get("code"), r.get("name"), src, f"{it['itemNo']} {it['name']}", f"入数がちがう（{a} と {b}）ので、原価は入れない"])
        continue
    matched += 1
    if it.get("cost") is None:
        same += 1
        continue
    new = round(it["cost"] * box_of(r.get("name")), 2)
    old = r.get("cost")
    if old is not None and abs(float(old) - new) < 0.005:
        same += 1
        continue
    if old and abs(new - float(old)) / float(old) > 0.2:
        # 大きく変わる物は、取りちがえかもしれないので人が見る
        check.append([r.get("customerId"), r.get("code"), r.get("name"), src, f"{it['itemNo']} {it['name']}", f"原価が大きく変わる（{fmt(float(old))} → {fmt(new)}）ので、自動では入れない"])
        continue
    upd.append([r.get("customerId"), r.get("code"), r.get("name"), r.get("productId", ""), r.get("unit", ""), fmt(r.get("price")), fmt(new), r.get("priceNote", ""), src,
                fmt(r.get("quantity")), ";".join(WD[d] for d in (r.get("weekdays") or [])), r.get("lastDate", ""), r.get("note", ""), "はい" if r.get("active", True) else "いいえ"])
write("32_customerProducts.csv", CH, upd)
write("39_要確認.csv", ["得意先ID", "商品コード", "取引先の商品名", "仕入れ元", "台帳の品名", "わけ"], check)
print(f"台帳 {len(items)}品 → 31_supplierItems.csv")
print(f"取引先の商品（この仕入先の品）: 突き合わせ {matched}行（うち品名で {byname}行）・原価を直す {len(upd)}行・同じ {same}行・要確認 {len(check)}行")
