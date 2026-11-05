# 今の取引先と配送コースを、弥生販売の書き出しから起こす（⑦の(18)）。出すのは CSV と一覧だけ。DB には入れない。
#
# 使い方（ファイルは引数で渡す。このスクリプトに社名・ファイルの場所は書かない）:
#   python -I scripts/import-real/customers_to_csv.py \
#     --master <得意先マスタ…xlsx（「リスト形式」のシート）> \
#     --sales <得意先別売上明細…xlsx> [--sales <…>] \
#     --address <各営業コースマスタデータ（住所入力）.xlsx> \
#     --route <コース表 .xlsx（「○○ルート表」のシート）> \
#     [--found <調べた住所の JSON>] #     [--out data/import-real/customers]
#
# 決め方:
#   - 対象は「売上明細に売上がある得意先」だけ（今も届けている先）
#   - コース = 得意先マスタの「担当者」（コード→名前）。担当者が空なら売上明細のいちばん多い担当者
#   - 納品する曜日 = 売上日の曜日のうち、3日以上ある曜日（たまの臨時は入れない）
#   - 住所・郵便番号 = 住所入力の xlsx を得意先コードで突き合わせ（コードは数として比べる: 0322 = 00322）
#   - 納品時刻・時間の希望・納品の仕方・注意事項 = コース表のルート表を名前で突き合わせ（空白・会社の種類を外して比べる）
#   - ID は「R-」＋得意先コード（見本の C01 などと重ならない）
#   - --found（住所の無い先をあとから調べた結果。[{id, found, postal, address, tel, confidence, note}]）があれば、住所の無い先に入れる。
#     confidence が low なら注意事項に「住所は推測・要確認」。電話はメモに入れる
#   - コードが oc で始まる先はオフィス自社の設置先: 納品の方法＝オフィス自社便（自社便のコース計算には入れない）。
#     ocp（PayPay の集計用）は取引先ではないので出さない
#
# 出すもの（出力フォルダ。data/ は git の外）:
#   10_customers.csv   取引先マスタの CSV（③の列名。マスタの一括登録でそのまま読める）
#   tantou.csv         担当者コード・名前・先の数・住所ありの数（どの担当者がどのコースかを確かめる用）
#   report.txt         突き合わせられなかった先など
import argparse
import collections
import csv
import datetime as dt
import os
import re
import unicodedata

import openpyxl


def s(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def code_key(c):
    c = s(c)
    return str(int(c)) if c.isdigit() else c


def norm(name):
    n = unicodedata.normalize("NFKC", s(name))
    n = re.sub(r"\s+", "", n)
    n = re.sub(r"株式会社|有限会社|合同会社|社会福祉法人|医療法人|\(株\)|\(有\)", "", n)
    return n.lower()


def hhmm(v):
    if isinstance(v, dt.time):
        return f"{v.hour:02d}:{v.minute:02d}"
    if isinstance(v, dt.datetime):
        return f"{v.hour:02d}:{v.minute:02d}"
    t = s(v).lstrip("〜～~")
    m = re.match(r"^(\d{1,2})[:：時](\d{2})?", t)
    if m and int(m.group(1)) < 24:
        return f"{int(m.group(1)):02d}:{int(m.group(2) or 0):02d}"
    try:
        f = float(t)
        if 0 < f < 1:
            mins = round(f * 1440)
            return f"{mins // 60:02d}:{mins % 60:02d}"
    except ValueError:
        pass
    return ""


def read_master(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["リスト形式"]
    out = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        code, name = s(row[1]), s(row[2])
        if not code or not name or code == "コード":
            continue
        out[code_key(code)] = {"code": code, "name": name, "tantou": s(row[3]), "tantouName": re.sub(r"\s+", "", s(row[4])), "kubun": s(row[5])}
    return out


def read_sales(paths):
    out = collections.defaultdict(lambda: {"dates": set(), "tantou": collections.Counter(), "nounyu": set(), "lines": 0, "name": ""})
    for p in paths:
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
        ws = wb.worksheets[0]
        head = None
        for row in ws.iter_rows(values_only=True):
            if head is None:
                if "得意先コード" in [s(c) for c in row]:
                    head = [s(c) for c in row]
                continue
            r = dict(zip(head, row))
            code = s(r.get("得意先コード"))
            if not code or code.startswith("<") or "計" in code:  # 小計・総合計の行
                continue
            x = out[code_key(code)]
            x["name"] = x["name"] or s(r.get("得意先名"))
            d = r.get("売上日")
            if isinstance(d, dt.datetime):
                x["dates"].add(d.date())
            elif s(d)[:10]:
                try:
                    x["dates"].add(dt.date.fromisoformat(s(d)[:10]))
                except ValueError:
                    pass
            t = s(r.get("担当者コード"))
            if t:
                x["tantou"][(t, re.sub(r"\s+", "", s(r.get("担当者名"))))] += 1
            if s(r.get("納入先名")):
                x["nounyu"].add(s(r.get("納入先名")))
            x["lines"] += 1
    return out


def read_address(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = {}
    for ws in wb.worksheets:
        head = None
        for row in ws.iter_rows(values_only=True):
            cells = [s(c) for c in row]
            if head is None:
                if "コード" in cells and "住所１" in cells:
                    head = cells
                continue
            r = dict(zip(head, row))
            code = s(r.get("コード"))
            if not code:
                continue
            addr = (s(r.get("住所１")) + s(r.get("住所２"))).strip()
            out[code_key(code)] = {"postal": s(r.get("郵便番号")), "address": addr, "tel": s(r.get("TEL")), "fax": s(r.get("FAX")), "short": s(r.get("略称"))}
    return out


NAME_HEADS = ("得意先名", "名称", "曜日/得意先名", "曜日/卸し先名", "取引先", "取引先名", "卸し先名", "名前")


def read_route(path):
    """コース表のルート表 → 名前（比べる形）→ 時刻・仕方・注意"""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = {}
    for ws in wb.worksheets:
        if "ルート表" not in ws.title:
            continue
        rows = list(ws.iter_rows(values_only=True))
        hi = next((i for i, r in enumerate(rows[:10]) if any(re.sub(r"\s", "", s(c)) in NAME_HEADS for c in r)), None)
        if hi is None:
            continue
        head = [re.sub(r"\s|（指定あり）|\(指定あり\)", "", s(c)) for c in rows[hi]]

        def col(*names):
            for i, h in enumerate(head):
                if any(h == n or h.startswith(n) for n in names):
                    return i
            return -1

        cn, ct, cto, chow, ccau = col(*NAME_HEADS), col("納品時間"), col("〜納品時間", "～納品時間"), col("納品の仕方"), col("注意事項")
        cad, cpo = col("住所"), col("郵便番号")
        for r in rows[hi + 1:]:
            name = s(r[cn]) if cn >= 0 and cn < len(r) else ""
            if not name:
                continue
            k = norm(name)
            if k in out:
                continue
            g = lambda i: r[i] if 0 <= i < len(r) else None  # noqa: E731
            t1 = hhmm(g(ct))
            t2 = hhmm(g(cto))
            out[k] = {"time": t1, "to": t2, "how": s(g(chow)), "caution": s(g(ccau)), "sheet": ws.title, "address": s(g(cad)), "postal": s(g(cpo))}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", required=True)
    ap.add_argument("--sales", action="append", required=True)
    ap.add_argument("--address", required=True)
    ap.add_argument("--route", required=True)
    ap.add_argument("--out", default=os.path.join("data", "import-real", "customers"))
    ap.add_argument("--found", help="住所の無い先を調べた結果（JSON）")
    ap.add_argument("--min-days", type=int, default=3, help="この日数以上売上がある曜日を「納品する曜日」にする")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    master = read_master(a.master)
    sales = read_sales(a.sales)
    addr = read_address(a.address)
    route = read_route(a.route)
    found = {}
    if a.found:
        import json
        with open(a.found, encoding="utf-8") as f:
            for x in json.load(f):
                if x.get("found") and x.get("address"):
                    found[x["id"]] = x
    report = []

    rows = []
    tantou = collections.defaultdict(lambda: {"name": "", "n": 0, "addr": 0, "route": 0, "lines": 0})
    for k, sl in sorted(sales.items(), key=lambda x: x[0].zfill(8)):
        m = master.get(k)
        name = m["name"] if m else sl["name"]
        if m and m["tantou"]:
            tcode, tname = m["tantou"], m["tantouName"]
        elif sl["tantou"]:
            (tcode, tname), _ = sl["tantou"].most_common(1)[0]
        else:
            tcode, tname = "", ""
        if not m:
            report.append(f"得意先マスタに無い（売上だけある）: {k} {name}")
        wd = collections.Counter(d.weekday() for d in sl["dates"])  # 月=0
        days = sorted(((w + 1) % 7) for w, n in wd.items() if n >= a.min_days)  # 日=0 に直す
        rid = f"R-{m['code'] if m else k}"
        if rid.lower().startswith("r-ocp"):
            report.append(f"除外（PayPay の集計用）: {rid} {name}")
            continue
        ad = addr.get(k, {})
        rt = route.get(norm(name)) or (route.get(norm(ad["short"])) if ad.get("short") else None) or {}
        if not ad.get("address") and rt.get("address"):
            ad = {**ad, "address": rt["address"], "postal": ad.get("postal") or rt.get("postal", "")}
        t = tantou[tcode]
        t["name"] = tname
        t["n"] += 1
        t["addr"] += 1 if ad.get("address") else 0
        t["route"] += 1 if rt else 0
        t["lines"] += sl["lines"]
        win_from = rt.get("time", "") if rt.get("to") else ""
        caution = rt.get("caution", "")
        tel = ad.get("tel", "")
        fx = found.get(rid)
        if not ad.get("address") and fx:
            ad = {**ad, "address": fx["address"], "postal": fx.get("postal") or ad.get("postal", "")}
            tel = tel or fx.get("tel", "")
            if fx.get("confidence") == "low":
                caution = ("住所は推測・要確認。" + caution).strip()
        method = "オフィス自社便" if rid.lower().startswith("r-oc") else ""
        rows.append({
            "得意先ID": rid,
            "名前": name,
            "主な注文の入口": "電話",
            "注文の締め（前日）": "15:00",
            "納品時刻": "" if rt.get("to") else rt.get("time", ""),
            "配送コース": tname or "（担当者なし）",
            "納品する曜日": ";".join("日月火水木金土"[d] for d in days),
            "FAX番号": ad.get("fax", ""),
            "メモ": f"弥生の売上（{min(sl['dates']).isoformat() if sl['dates'] else ''}〜）から取り込み。担当者 {tcode}。注文の入口・締めは確かめてください"
            + (f"。納入先: {'・'.join(sorted(sl['nounyu']))[:80]}" if sl["nounyu"] else "")
            + (f"。TEL {tel}" if tel else ""),
            "郵便番号": ad.get("postal", "") if re.match(r"^\d{3}-?\d{4}$", ad.get("postal", "")) else "",
            "住所": ad.get("address", ""),
            "納品時間の希望（から）": win_from,
            "納品時間の希望（まで）": rt.get("to", ""),
            "納品の仕方": rt.get("how", ""),
            "注意事項": caution,
            "納品の方法": method,
            "使う": "はい",
        })

    with open(os.path.join(a.out, "10_customers.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(a.out, "tantou.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["担当者コード", "担当者名", "7〜9月に売上がある先", "うち住所あり", "うちコース表にある", "売上の行数"])
        for code, t in sorted(tantou.items()):
            w.writerow([code, t["name"], t["n"], t["addr"], t["route"], t["lines"]])
    no_addr = [r for r in rows if not r["住所"]]
    report.insert(0, f"対象（売上がある先）: {len(rows)}件。住所なし: {len(no_addr)}件。コース表と名前で合った: {sum(1 for r in rows if r['納品の仕方'] or r['納品時刻'] or r['納品時間の希望（まで）'])}件")
    report += [f"住所なし: {r['得意先ID']} {r['名前']}（{r['配送コース']}）" for r in no_addr]
    with open(os.path.join(a.out, "report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print(report[0])


if __name__ == "__main__":
    main()
