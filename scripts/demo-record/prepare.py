# デモ動画の撮影の用意（⑧ → ⑥）。本番（3100）の DB は使わない。
#   snapshot <AI が F001 を読んだあとの DB>       … F001 の「AI が読んだ結果」と、そこから作られた注文を data/demo-f001.json に取っておく
#                                                  （撮り直しのたびに本物の AI を呼ばないため。確定済みでも「要確認」に戻して取る）
#   fresh <見本の DB> <撮影用の DB>               … 見本の DB をコピーし、F001 を消す（D1 で「届く」ところを撮るため）
#   arrive <撮影用の DB>                           … F001 を「届いたばかり（未読）」で入れる（D1）
#   autoread <撮影用の DB>                         … F001 を「AI が読み終えた」状態にして注文を入れる（工場では届くと自動で読む。D2 の前）
import json
import shutil
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

SNAP = "data/demo-f001.json"
FAX = "F001"


def jst_now():
    return datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%dT%H:%M:%S+09:00")


def snapshot(db):
    d = sqlite3.connect(db)
    fid, received, status, cust, js = d.execute("SELECT id, received_at, status, customer_id, json FROM faxes WHERE id = ?", (FAX,)).fetchone()
    fax = json.loads(js)
    if not fax.get("read"):
        sys.exit("F001 がまだ読まれていません。先に確認用サーバーで「Claudeで読み取る」を押してください")
    fax["status"] = "review"
    for k in ("confirmedAt", "confirmedBy", "sortedBy", "autoConfirmed"):
        fax.pop(k, None)
    orders = []
    for oid, js2 in d.execute("SELECT id, json FROM orders WHERE id LIKE ?", (f"{FAX}-%",)).fetchall():
        o = json.loads(js2)
        o["status"] = "needs_review"
        for k in ("confirmedAt", "confirmedBy"):
            o.pop(k, None)
        orders.append(o)
    json.dump({"fax": fax, "customer_id": cust, "orders": orders}, open(SNAP, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"取っておきました: {SNAP}（注文 {len(orders)}件）")


def fresh(src, dst):
    for s in ("", "-wal", "-shm"):
        try:
            import os
            os.remove(dst + s)
        except FileNotFoundError:
            pass
    a = sqlite3.connect(src)
    b = sqlite3.connect(dst)
    a.backup(b)
    b.execute("DELETE FROM faxes WHERE id = ?", (FAX,))
    b.execute("DELETE FROM orders WHERE id LIKE ?", (f"{FAX}-%",))
    b.commit()
    print(f"撮影用の DB を作りました: {dst}（F001 は、まだ届いていない）")


def arrive(db):
    snap = json.load(open(SNAP, encoding="utf-8"))
    f = snap["fax"]
    now = jst_now()
    unread = {"id": FAX, "file": f["file"], "receivedAt": now, "label": f.get("label", ""), "status": "new"}
    d = sqlite3.connect(db)
    d.execute("INSERT OR REPLACE INTO faxes (id, received_at, status, customer_id, json) VALUES (?, ?, 'new', NULL, ?)", (FAX, now, json.dumps(unread, ensure_ascii=False)))
    d.commit()
    print("F001 が届きました（未読）")


def autoread(db):
    snap = json.load(open(SNAP, encoding="utf-8"))
    f = dict(snap["fax"])
    d = sqlite3.connect(db)
    row = d.execute("SELECT received_at FROM faxes WHERE id = ?", (FAX,)).fetchone()
    received = row[0] if row else jst_now()
    f["receivedAt"] = received
    d.execute("INSERT OR REPLACE INTO faxes (id, received_at, status, customer_id, json) VALUES (?, ?, 'review', ?, ?)", (FAX, received, snap.get("customer_id"), json.dumps(f, ensure_ascii=False)))
    for o in snap["orders"]:
        d.execute(
            "INSERT OR REPLACE INTO orders (id, customer_id, delivery_date, status, channel, intent, created_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (o["id"], o.get("customerId", ""), o["deliveryDate"], o["status"], o["source"]["channel"], o.get("intent", "new"), o.get("createdAt", received), json.dumps(o, ensure_ascii=False)),
        )
    d.commit()
    print(f"F001 を AI が読み終えた状態にしました（注文 {len(snap['orders'])}件・要確認）")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "snapshot":
        snapshot(sys.argv[2])
    elif cmd == "fresh":
        fresh(sys.argv[2], sys.argv[3])
    elif cmd == "arrive":
        arrive(sys.argv[2])
    elif cmd == "autoread":
        autoread(sys.argv[2])
    else:
        print(__doc__ or open(__file__, encoding="utf-8").read().split("\nimport")[0])
