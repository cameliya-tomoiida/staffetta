# 取引先の住所の記入のお願い（Excel）の返事 → 取引先マスタの CSV（⑧）。
#   42_customers.csv        … 答えのある行だけ。得意先ID と、変える列だけ（CSV に無い列は今の値のまま）
#   48_住所の上書き.csv      … 今の値があって、ちがう値で上書きする所
#   49_住所の要確認.csv      … 人が決める所（取引なし・契約なし・旧住所 など）
# 決まり（11/6 管理役2）:
#   - 空欄の行は触らない。「〇」は値として入れない（候補の住所を使うのは、〇があって住所の欄が空の行だけ）
#   - 住所・郵便番号・電話 → 取引先へ（住所が変わったら地図の位置を空にして、住所から出し直す）
#   - 届け先の名前 → 「届け先の名前」、納品の仕方・注意 → 「注意事項」に足す
#   - 「引き取り」と書いてある → 納品の方法を「引き取り」に
#   - 日によって納品先が変わる（船など）→ 「納品の仕方」にも入れる
#   - 「契約なし」「注文なし」「取引なし」「弥生に入力しない」→ 消さずに注意事項に書き、要確認へ
#   - 「旧住所」「削除」→ 住所は変えず、要確認へ
# 実名・住所は git に入れない: Excel・出力は data/（git の外）に置き、引数で渡す。
#
# 使い方: python -I scripts/import-real/address_reply.py <返事.xlsx> <取引先を読む DB> <出力フォルダ>
import csv
import json
import os
import re
import sqlite3
import sys
import unicodedata

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")
xlsx, db_path, out_dir = sys.argv[1:4]
PREFIX = "R-"

db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
customers = {c["id"]: c for c in (json.loads(j) for (j,) in db.execute("SELECT json FROM masters WHERE name = 'customers' AND disabled = 0"))}

OK_MARK = {"〇", "○", "◯", "o", "O"}


def clean(v):
    s = str(v or "").replace("\r", "").strip()
    s = re.sub(r"[/\n]+$", "", s).strip()
    return s


def is_mark(s):
    return s.strip() in OK_MARK


def postal(s):
    m = re.search(r"(\d{3})-?(\d{4})", unicodedata.normalize("NFKC", s))
    return f"{m.group(1)}-{m.group(2)}" if m else ""


def phone(s):
    m = re.search(r"0\d{1,4}-\d{1,4}-\d{3,4}", unicodedata.normalize("NFKC", s))
    return m.group(0) if m else ""


def addr(s):
    s = unicodedata.normalize("NFKC", s).replace("\n", " ").strip(" /")
    s = re.sub(r"\s+", " ", s)
    return re.sub(r"^(北海道|東京都|大阪府|京都府|.{2,3}県) ", r"\1", s)


wb = openpyxl.load_workbook(xlsx, data_only=True)
ws = wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
hi = next(i for i, r in enumerate(rows) if r and "得意先コード" in [str(x or "").strip() for x in r])
H = [str(x or "").strip() for x in rows[hi]]
col = lambda name: next(i for i, h in enumerate(H) if h.startswith(name))
iC, iCand, iZip, iAddr, iTel, iTo, iHow = col("得意先コード"), col("調べた候補"), col("郵便番号"), col("住所"), col("電話"), col("届け先の名前"), col("納品の仕方")

STOP_WORDS = ["契約なし", "注文なし", "取引なし", "弥生入力せず", "弥生に入力しない"]
KEYS = ["id", "postalCode", "address", "phone", "deliverTo", "deliveryMethod", "deliveryHowTo", "deliveryCaution", "lat", "lng"]
LABEL = {"id": "得意先ID", "postalCode": "郵便番号", "address": "住所", "phone": "電話", "deliverTo": "届け先の名前", "deliveryMethod": "納品の方法",
         "deliveryHowTo": "納品の仕方", "deliveryCaution": "注意事項", "lat": "緯度", "lng": "経度"}
out, over, check = [], [], []
answered = untouched = 0
# 同じ電話番号が、ちがう取引先の行に書いてある → 写しまちがいかもしれないので要確認
tel_of = {}
for r in rows[hi + 1:]:
    t = phone(clean(r[iTel])) if clean(r[iC]) else ""
    if t:
        tel_of.setdefault(t, []).append(clean(r[iC]))
for r in rows[hi + 1:]:
    code = clean(r[iC])
    if not code:
        continue
    vals = {k: clean(r[i]) for k, i in (("cand", iCand), ("zip", iZip), ("addr", iAddr), ("tel", iTel), ("to", iTo), ("how", iHow))}
    if not any(vals[k] for k in ("zip", "addr", "tel", "to", "how")):
        untouched += 1
        continue
    answered += 1
    cid = PREFIX + code
    c = customers.get(cid)
    if not c:
        check.append([code, "", "取引先が見つからない（得意先コード）", json.dumps(vals, ensure_ascii=False)])
        continue
    new = dict(c)
    marks = [k for k in ("zip", "addr", "tel", "to") if is_mark(vals[k])]
    how = re.sub(r"[/\n]+", "　", vals["how"]).strip("　")
    # 住所: 「旧住所」「削除」なら変えずに要確認
    a = vals["addr"]
    if a and re.search(r"旧住所|削除", a):
        check.append([code, c["name"], f"住所の欄に「{a}」。今の住所（{c.get('address') or '空'}）を空にするか決める", ""])
        a = ""
    elif is_mark(a):
        a = ""
    if not a and marks and vals["cand"] and not vals["addr"]:
        a = addr(re.split(r"/", vals["cand"])[0])  # 〇があって住所の欄が空 → 候補の1つ目
    if a:
        a = addr(a)
        if not re.match(r"^(北海道|東京都|大阪府|京都府|.{2,3}県)", a) and re.match(r"^(名古屋市|小牧市|清須市|東海市|一宮市|弥富市|春日井市|瀬戸市|豊川市|安城市)", a):
            a = "愛知県" + a.replace("愛知県 ", "")
        new["address"] = a
    z = "" if is_mark(vals["zip"]) else postal(vals["zip"])
    if z:
        new["postalCode"] = z
    t = "" if is_mark(vals["tel"]) else phone(vals["tel"])
    if t and len(tel_of.get(t, [])) > 1:
        others = "・".join(x for x in tel_of[t] if x != code)
        check.append([code, c["name"], f"電話 {t} が、ほかの取引先（{others}）と同じ。写しまちがいかもしれないので入れていない", ""])
        t = ""
    if t:
        new["phone"] = t
    if vals["to"] and not is_mark(vals["to"]):
        new["deliverTo"] = vals["to"].replace("　", " ")
    if how:
        caution = c.get("deliveryCaution") or ""
        if how not in caution:
            new["deliveryCaution"] = f"{caution}　{how}".strip("　")
        if "引き取り" in how or "引取" in how:
            new["deliveryMethod"] = "pickup"
        if re.search(r"日によって|その日によって", how):
            new["deliveryHowTo"] = f"{c.get('deliveryHowTo') or ''}　{how}".strip("　")
        for w in STOP_WORDS:
            if w in how:
                check.append([code, c["name"], f"「{how}」。消さずに注意事項に書いた。使うのをやめるか決める", ""])
                break
    if new.get("address") != c.get("address") and c.get("lat") is not None:
        new["lat"] = None
        new["lng"] = None
    for k in ("address", "postalCode", "phone", "deliverTo", "deliveryMethod", "deliveryHowTo"):
        if c.get(k) and new.get(k) != c.get(k):
            over.append([code, c["name"], LABEL[k], c.get(k), new.get(k)])
    if any(new.get(k) != c.get(k) for k in KEYS):
        out.append([("" if new.get(k) is None else str(new.get(k))) for k in KEYS])


def write(name, header, rs):
    with open(os.path.join(out_dir, name), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rs)


write("42_customers.csv", [LABEL[k] for k in KEYS], out)
write("48_住所の上書き.csv", ["得意先コード", "名前", "欄", "今の値", "新しい値"], over)
write("49_住所の要確認.csv", ["得意先コード", "名前", "わけ", "返事の中身"], check)
print(f"返事のある行 {answered}・空欄で触らない行 {untouched}・取引先を変える {len(out)}件・上書き {len(over)}か所・要確認 {len(check)}件")
