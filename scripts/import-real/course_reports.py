# コースの日報（Excel）→ 便のマスタ・取引先の配送コース・納品する曜日・注意事項の CSV（⑧）。
#   40_courses.csv     … 便（例: Aコース）。走る曜日＝日報にある曜日、回る順番＝日報に並んだ順（月→土、左の列→右の列で先に出た順）
#   41_customers.csv   … 日報に出た取引先の今の行を全部写して、配送コース・納品する曜日・注意事項（日報の備考を足す）だけ変える
#   49_コースの要確認.csv … 取引先が見つからない行・今のコースとちがう・曜日がちがう・2つのコースに出る 物の一覧
# 決まり（11/6 担当者）: 変えるのは日報に出る取引先だけ（ほかは今のまま。「コースなし」にもしない）。便は A〜F を足すだけ（今の便は消さない）。
#   2つのコースに出る・今のコースがほかとちがう取引先は自動で変えず、一覧に残す。
# 実名・コードは git に入れない: 日報・設定・出力はどれも data/（git の外）に置き、引数で渡す。
#
# 使い方:
#   python -I scripts/import-real/course_reports.py <日報のフォルダ> <取引先を読む DB> <出力フォルダ> [設定.json]
#   日報のファイル名は「<コース名>コース日報.xlsx」（「- コピー」は読まない）。曜日のシートは「月」か「月曜日」の名前の物だけ
#   （「1.13(月)」のような日付のシートは読まない）。シートの中は「得意先名・コード・備考」の見出しの組が左右に並ぶ形。
# 設定.json の例（git の外。無くてもよい）:
#   {"courses": {"A": {"departTime": "06:00", "vehicle": "軽バン"}}, "idPrefix": "R-"}
import csv
import glob
import json
import os
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from difflib import SequenceMatcher

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")

src_dir, db_path, out_dir = sys.argv[1:4]
S = json.load(open(sys.argv[4], encoding="utf-8")) if len(sys.argv) > 4 else {}
PREFIX = S.get("idPrefix", "R-")
WD = "日月火水木金土"

db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
customers = {c["id"]: c for c in (json.loads(j) for (j,) in db.execute("SELECT json FROM masters WHERE name = 'customers' AND disabled = 0"))}
old_courses = {c["id"]: c for c in (json.loads(j) for (j,) in db.execute("SELECT json FROM masters WHERE name = 'courses' AND disabled = 0"))}


def norm(s):
    s = unicodedata.normalize("NFKC", str(s or ""))
    return re.sub(r"[\s　・()（）\[\]［］〈〉<>㈱]|株式会社|\(株\)", "", s).lower()


def codes_of(v):
    """コードの欄 → 試すコード（「0956\\n(3815)」なら 3815 → 0956 の順。先頭の 0 のちがいも試す）"""
    if v is None or v == "":
        return []
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    parts = re.findall(r"[0-9A-Za-z]+", unicodedata.normalize("NFKC", str(v)))
    out = []
    for p in reversed(parts):  # かっこの中（事業所のコード）を先に
        for k in (p, p.lstrip("0"), p.zfill(4), p.zfill(5)):
            if k and k not in out:
                out.append(k)
    return out


def find(name, code):
    for k in codes_of(code):
        c = customers.get(PREFIX + k)
        if c:
            return c, "コード"
    # コードで見つからない: 名前がとても似ていて、候補が1つの時だけ
    n = norm(name)
    if not n:
        return None, ""
    cands = sorted(((SequenceMatcher(None, n, norm(c["name"])).ratio() + (0.2 if n in norm(c["name"]) else 0), c) for c in customers.values()), key=lambda t: -t[0])
    if cands and cands[0][0] >= 0.9 and (len(cands) < 2 or cands[0][0] - cands[1][0] >= 0.15):
        return cands[0][1], "名前"
    return None, (f"候補: {cands[0][1]['id']} {cands[0][1]['name']}" if cands and cands[0][0] >= 0.6 else "")


def weekday_of(title):
    t = title.strip()
    m = re.fullmatch(r"([日月火水木金土])(曜日?)?", t)
    return WD.index(m.group(1)) if m else None


# ── 日報を読む ──
seen = {}  # 取引先ID → {course: set(曜日)}
notes = {}  # 取引先ID → [備考]
course_rows = {}  # コース → {"weekdays": set, "stops": [ID]}
check = {}  # (コース, 日報の名前, コード, 取引先ID, 名前, 候補, わけ) → 曜日の集まり


def flag(course, wd, name, code, cid, cname, hint, why):
    k = (course, name, code, cid, cname, hint, why)
    check.setdefault(k, set())
    if wd is not None:
        check[k].add(wd)


for path in sorted(glob.glob(os.path.join(src_dir, "*コース日報*.xlsx"))):
    base = os.path.basename(path)
    if "コピー" in base:
        continue
    m = re.match(r"(.+?)コース日報", base)
    course = f"{m.group(1)}コース"
    cr = course_rows.setdefault(course, {"weekdays": set(), "stops": []})
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    for ws in wb.worksheets:
        wd = weekday_of(ws.title)
        if wd is None:
            continue
        rows = list(ws.iter_rows(values_only=True))
        hi = next((i for i, r in enumerate(rows) if r and "得意先名" in [str(x).strip() if x else "" for x in r]), None)
        if hi is None:
            continue
        hdr = [str(x).strip() if x else "" for x in rows[hi]]
        blocks = [i for i, h in enumerate(hdr) if h == "得意先名"]
        n = 0
        for b in blocks:
            for r in rows[hi + 1:]:
                if b >= len(r) or not r[b] or not str(r[b]).strip():
                    continue
                name = str(r[b]).strip().replace("\n", " ")
                code = r[b + 1] if b + 1 < len(r) else None
                note = str(r[b + 2]).strip() if b + 2 < len(r) and r[b + 2] else ""
                n += 1
                c, how = find(name, code)
                if not c:
                    flag(course, wd, name, str(code or "").replace("\n", " "), "", "", how, "取引先が見つからない（コードも名前も）")
                    continue
                if how == "名前":
                    flag(course, wd, name, str(code or "").replace("\n", " "), c["id"], c["name"], "", "名前で決めた（コードがちがう・空）。合っているか見る")
                seen.setdefault(c["id"], {}).setdefault(course, set()).add(wd)
                if note and note not in notes.setdefault(c["id"], []):
                    notes[c["id"]].append(note)
                if c["id"] not in cr["stops"]:
                    cr["stops"].append(c["id"])
        if n:
            cr["weekdays"].add(wd)

# 今の配送コース（担当の名前など）→ 日報のコース: いちばん多い組み合わせを「ふつう」とみなす
pair = Counter()
for cid, by in seen.items():
    for course in by:
        pair[(course, customers[cid].get("course") or "")] += 1
usual = {}
for (course, old), _ in pair.most_common():
    usual.setdefault(course, old)

# ── 書く ──
def write(name, header, rows):
    with open(os.path.join(out_dir, name), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


wdl = lambda ds: ";".join(WD[d] for d in sorted(ds))
CRH = ["便ID", "名前", "出発時刻", "積み込み（分）", "出発する日", "走る曜日", "メモ", "回る順番", "1件の納品の時間（分）", "休けい（分）", "休けいを取る（何件目のあと）", "車", "使う"]
crs = []
for course, cr in course_rows.items():
    cs = S.get("courses", {}).get(course.replace("コース", ""), {})
    old = old_courses.get(course, {})
    crs.append([course, course, cs.get("departTime", old.get("departTime", "06:00")), old.get("loadMinutes", 30), 0, wdl(cr["weekdays"]),
                old.get("note") or f"コースの日報から取り込み。今までの配送コース「{usual.get(course, '')}」の取引先が多い。回る順番は日報に並んだ順（走る順か確かめる）。出発時刻は確かめる",
                ";".join(cr["stops"]), old.get("serviceMinutes", ""), old.get("breakMinutes", ""), old.get("breakAfter", ""), cs.get("vehicle", old.get("vehicle", "")), "はい"])
write("40_courses.csv", CRH, crs)

# 取引先: 今の行を全部写して、配送コース・納品する曜日・注意事項だけ変える
CH = [("id", "得意先ID", "text"), ("name", "名前", "text"), ("channel", "主な注文の入口", "text"), ("fax", "FAX番号", "text"), ("externalCode", "外部サイトの取引先コード", "text"),
      ("cutoff", "注文の締め（前日）", "text"), ("deliveryTime", "納品時刻", "text"), ("course", "配送コース", "text"), ("deliveryWeekdays", "納品する曜日", "weekdays"),
      ("replyRequired", "受けたら返事が要る", "bool"), ("note", "メモ", "text"), ("postalCode", "郵便番号", "text"), ("address", "住所", "text"), ("deliveryMethod", "納品の方法", "text"),
      ("closedWeekdays", "定休日", "weekdays"), ("deliveryWindowFrom", "納品時間の希望（から）", "text"), ("deliveryWindowTo", "納品時間の希望（まで）", "text"),
      ("deliveryHowTo", "納品の仕方", "text"), ("deliveryCaution", "注意事項", "text"), ("serviceMinutes", "納品にかかる時間（分）", "text"), ("lat", "緯度", "text"), ("lng", "経度", "text"), ("active", "使う", "bool")]


def cell(c, key, t):
    v = c.get(key)
    if t == "bool":
        return "はい" if (v if key != "active" else v is not False) else "いいえ"
    if t == "weekdays":
        return wdl(v or [])
    return "" if v is None else str(v)


cus = []
changed_course = same = 0
held = 0
for cid, by in seen.items():
    c = dict(customers[cid])
    course, days = max(by.items(), key=lambda t: len(t[1]))
    # 2つのコースに出る・今のコースがほかとちがう 取引先は、給食・冷凍便などとのかけもちかもしれないので、自動で変えない（一覧に残す）
    if len(by) > 1:
        flag(";".join(by), None, c["name"], "", cid, c["name"], "", "2つ以上のコースに出る（" + "・".join(f"{k} {wdl(v)}" for k, v in by.items()) + "）。変えずに残した")
        held += 1
        continue
    if (c.get("course") or "") not in (usual.get(course), course):
        flag(course, None, c["name"], "", cid, c["name"], "", f"今の配送コースがほかとちがう（{c.get('course') or '空'}。このコースの多くは {usual.get(course) or '空'}）。変えずに残した")
        held += 1
        continue
    alldays = set().union(*by.values())
    before = (c.get("course"), sorted(c.get("deliveryWeekdays") or []), c.get("deliveryCaution", ""))
    if c.get("course") != course:
        changed_course += 1
    if c.get("deliveryWeekdays") and set(c["deliveryWeekdays"]) != alldays:
        flag(course, None, c["name"], "", cid, c["name"], "", f"納品する曜日がちがう（今 {wdl(c['deliveryWeekdays'])} → 日報 {wdl(alldays)}）")
    c["course"] = course
    c["deliveryWeekdays"] = sorted(alldays)
    caution = c.get("deliveryCaution") or ""
    for n in notes.get(cid, []):
        if norm(n) not in norm(caution):
            caution = f"{caution}　{n}".strip("　")
    c["deliveryCaution"] = caution
    if (c["course"], c["deliveryWeekdays"], caution) == before:
        same += 1
        continue
    cus.append([cell(c, k, t) for k, _, t in CH])
write("41_customers.csv", [l for _, l, _ in CH], cus)
rows = sorted(([k[0], wdl(v), *k[1:]] for k, v in check.items()), key=lambda r: (r[-1], r[0], r[2]))
write("49_コースの要確認.csv", ["コース", "曜日", "日報の名前", "日報のコード", "取引先ID", "取引先の名前", "候補", "わけ"], rows)

print("コース: " + "・".join(f"{k} {len(v['stops'])}件（{wdl(v['weekdays'])}）" for k, v in course_rows.items()))
print(f"取引先: 日報で見つかった {len(seen)}件・変える {len(cus)}件（うち配送コースが変わる {changed_course}件）・同じ {same}件・変えずに残した {held}件（日報に出ない取引先は触らない）")
print("今のコース → 日報のコース: " + "・".join(f"{v or '空'} → {k}" for k, v in usual.items()))
print(f"要確認: {len(rows)}行（" + "・".join(f"{w} {n}" for w, n in Counter(r[-1].split('（')[0] for r in rows).most_common()) + "）")
