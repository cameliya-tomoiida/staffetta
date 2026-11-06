# デモ動画用の画面録画（⑧ → ⑥・撮影リスト第7稿）。1つの FAX（F001・ひまわり保育園（架空）の週間パン注文表）を追う:
#   D1 FAX が届く → D2 AI が読む（迷った行だけ黄色）→ D3 確認して注文に → D4 製造計画・工程表（ベトナム語）
#   → D5 発注書（65個 → 6個入り 11袋）→ D6 配送のルート → D7 製品カード・衛生・記録の漏れ → D8 分析 → D9 ホーム
# 見本の DB（scripts/demo-record/prepare.py fresh で作る）で動かした確認用サーバー（http://localhost:3107）を撮る。本番（3100）は使わない。
# 手順は docs/demo-recording.md。
#
# 使い方:  python -I scripts/demo-record/record.py <出力フォルダ> <撮影用の DB> [--only D1,D3] [--size 1920x1080]
import os
import shutil
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright
import imageio_ffmpeg

BASE = os.environ.get("DEMO_BASE", "http://localhost:3107")
OUT = sys.argv[1]
DB = sys.argv[2]
ONLY = None
SIZE = (1920, 1080)
for i, a in enumerate(sys.argv):
    if a == "--only":
        ONLY = set(sys.argv[i + 1].split(","))
    if a == "--size":
        w, h = sys.argv[i + 1].split("x")
        SIZE = (int(w), int(h))
FF = imageio_ffmpeg.get_ffmpeg_exe()
HERE = os.path.dirname(os.path.abspath(__file__))
FAX = "F001"
DAY = "2026-11-09"  # F001 のいちばん早い納品日
PO_DAY = "2026-11-06"  # 「超じゅくロール 6個入 65個 → 11袋」が出る日（見本）

os.makedirs(OUT, exist_ok=True)
tmp = os.path.join(OUT, "_raw")

# 開発用の「Rendering…」「Compiling…」の印（Next.js）を映さない・FAX の見せ方は、指定した場面だけ「見た」にする
HIDE = "nextjs-portal{display:none!important}"
INIT = "document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='" + HIDE + "';document.head.appendChild(s)});"


def prep(cmd):
    subprocess.run([sys.executable, "-I", os.path.join(HERE, "prepare.py"), cmd, DB], check=True)


def slow_scroll(pg, dy, steps=14, wait=55):
    for _ in range(steps):
        pg.mouse.wheel(0, dy / steps)
        pg.wait_for_timeout(wait)


def center(loc):
    loc.evaluate("e => e.scrollIntoView({block: 'center', behavior: 'smooth'})")


def scene(name, fn, b, mobile=False, seen_fax=False):
    if ONLY and name.split("_")[0] not in ONLY:
        return
    shutil.rmtree(tmp, ignore_errors=True)
    size = {"width": 430, "height": 932} if mobile else {"width": SIZE[0], "height": SIZE[1]}
    ctx = b.new_context(viewport=size, record_video_dir=tmp, record_video_size=size, locale="ja-JP", is_mobile=mobile, has_touch=mobile)
    ctx.add_init_script(INIT + (f"sessionStorage.setItem('hub.faxshow.{FAX}','1');" if seen_fax else ""))
    ctx.set_default_timeout(120000)
    pg = ctx.new_page()
    t0 = time.time()
    ok = True
    try:
        fn(pg)
        pg.wait_for_timeout(1000)
        pg.screenshot(path=os.path.join(OUT, f"{name}.png"))
    except Exception as e:  # 1つの場面がだめでも、次の場面を撮る
        ok = False
        print(f"  ！ {name}: {str(e).splitlines()[0]}")
    v = pg.video.path()
    ctx.close()
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", v, "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", os.path.join(OUT, f"{name}.mp4")], check=True)
    print(f"{'○' if ok else '×'} {name}.mp4（{time.time() - t0:.0f}秒）")


def d1(pg):
    pg.goto(f"{BASE}/", wait_until="domcontentloaded")
    pg.wait_for_timeout(3000)
    prep("arrive")  # 複合機に FAX が届く（見本）。受信箱は数秒おきに見て、知らせて並べ直す
    pg.wait_for_function("() => document.body.innerText.includes('ﾋﾏﾜﾘ')", timeout=60000)
    card = pg.locator("div, li, article, section").filter(has_text="ﾋﾏﾜﾘ").filter(has=pg.get_by_role("button", name="Claudeで読み取る")).last
    center(card)
    card.hover()
    pg.wait_for_timeout(3500)


def d2(pg):
    prep("autoread")  # 工場では、届くと AI が自動で読む（ここでは、前に本物の AI が読んだ結果を入れる）
    pg.goto(f"{BASE}/fax/{FAX}", wait_until="domcontentloaded")
    pg.wait_for_timeout(5500)


def d3(pg):
    pg.goto(f"{BASE}/fax/{FAX}", wait_until="domcontentloaded")
    pg.wait_for_timeout(2500)
    box = pg.get_by_role("checkbox").first
    box.wait_for(state="attached")
    qty = box.locator("xpath=ancestor::td[1]//input[@inputmode or @type='text' or @type='number']").first
    center(qty)
    pg.wait_for_timeout(1200)
    qty.click()
    pg.wait_for_timeout(600)
    pad = pg.get_by_role("dialog")
    if pad.count():  # テンキーが出る画面なら、テンキーで入れる
        for k in ["C", "2", "5"]:
            btn = pad.get_by_role("button", name=k, exact=True)
            if btn.count():
                btn.first.click()
                pg.wait_for_timeout(350)
        ok = pad.get_by_role("button", name="決定")
        if ok.count():
            ok.first.click()
    else:
        qty.fill("")
        qty.type("25", delay=250)
    pg.wait_for_timeout(800)
    box.check()
    pg.wait_for_timeout(1200)
    pg.get_by_role("button", name="この内容で確定する").click()
    pg.wait_for_timeout(2500)
    pg.goto(f"{BASE}/orders", wait_until="load")
    pg.wait_for_timeout(1500)
    slow_scroll(pg, 520)
    pg.wait_for_timeout(1200)
    hit = pg.locator("li").filter(has_text="ひまわり保育園").first
    center(hit)
    hit.hover()
    pg.wait_for_timeout(2500)


def d4(pg):
    pg.goto(f"{BASE}/plan?date={DAY}", wait_until="domcontentloaded")
    pg.wait_for_timeout(2500)
    slow_scroll(pg, 420)
    pg.wait_for_timeout(1500)
    pg.get_by_text("ベトナム語に変換", exact=True).first.click()
    pg.wait_for_url("**lang=vi**")
    pg.wait_for_timeout(1500)
    slow_scroll(pg, 700, steps=18)
    pg.wait_for_timeout(2500)


def d5(pg):
    pg.goto(f"{BASE}/purchase?date={PO_DAY}", wait_until="domcontentloaded")
    pg.wait_for_timeout(2000)
    line = pg.get_by_text("超じゅくロール 6個入").first
    center(line)
    pg.wait_for_timeout(1200)
    line.hover()
    pg.wait_for_timeout(3500)


def d6(pg):
    pg.goto(f"{BASE}/admin/routes?yobi=1", wait_until="load")
    btn = pg.get_by_role("button", name="月曜の見直し案を出す")
    btn.wait_for()
    btn.scroll_into_view_if_needed()
    pg.wait_for_timeout(1000)
    btn.click()
    pg.wait_for_timeout(1250)
    pg.get_by_role("button", name="地図: 見直し案").wait_for()
    pg.get_by_role("button", name="地図: 見直し案").evaluate("e => e.scrollIntoView({block: 'start'})")
    pg.evaluate("window.scrollBy(0, -150)")
    pg.wait_for_timeout(3500)
    pg.get_by_role("button", name="地図: 今のコース").click()
    pg.wait_for_timeout(2500)
    pg.get_by_role("button", name="地図: 見直し案").click()
    pg.wait_for_timeout(2800)


def d7(pg):
    pg.goto(f"{BASE}/cards/templates", wait_until="domcontentloaded")
    pg.wait_for_timeout(3000)
    pg.goto(f"{BASE}/hygiene/temp-storage?month={DAY[:7]}", wait_until="load")
    pg.wait_for_timeout(2500)
    pg.get_by_label("記入する人（担当者名）").fill("見本 はなこ")
    first = pg.locator("tr:has-text('きょう') input[inputmode=decimal]").first
    center(first)
    first.click()
    first.type("21", delay=220)
    pg.wait_for_timeout(1500)
    pg.goto(f"{BASE}/hygiene/missing", wait_until="domcontentloaded")
    pg.wait_for_timeout(2500)


def d8(pg):
    pg.goto(f"{BASE}/analytics", wait_until="domcontentloaded")
    pg.wait_for_timeout(3000)
    slow_scroll(pg, 560, steps=16)
    pg.wait_for_timeout(1500)
    slow_scroll(pg, 700, steps=16)
    pg.wait_for_timeout(2000)


def d9(pg):
    pg.goto(f"{BASE}/home", wait_until="domcontentloaded")
    pg.wait_for_timeout(3500)
    slow_scroll(pg, 400)
    pg.wait_for_timeout(1500)


def d10(pg):
    # 「FAX も LINE も電話も、同じ一覧に」: 入口の印（FAX・LINE・電話・メール・サイト…）が並ぶ所
    pg.goto(f"{BASE}/orders", wait_until="load")
    pg.wait_for_timeout(1500)
    first = pg.locator("ul.m-limit > li").first
    first.wait_for()
    center(first)
    pg.wait_for_timeout(1200)
    slow_scroll(pg, 650, steps=20, wait=90)
    pg.wait_for_timeout(1500)


SCENES = [
    ("D1_fax到着", d1, {}),
    ("D2_fax読取", d2, {}),
    ("D3_確認して注文に", d3, {"seen_fax": True}),
    ("D4_製造計画", d4, {}),
    ("D5_発注書", d5, {}),
    ("D6_配送", d6, {}),
    ("D7_製品カードと衛生", d7, {}),
    ("D8_分析", d8, {}),
    ("D9_ホーム", d9, {}),
    ("D10_受注一覧", d10, {}),
]

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    warm = b.new_page()
    warm.set_default_timeout(240000)
    for path in (["/orders"] if ONLY == {"D10"} else ["/", "/fax/F002", "/orders", f"/plan?date={DAY}", f"/plan?date={DAY}&lang=vi", f"/purchase?date={PO_DAY}", "/admin/routes", "/cards/templates", "/hygiene/temp-storage", "/hygiene/missing", "/analytics", "/home"]):
        try:
            warm.goto(BASE + path, wait_until="domcontentloaded")
            warm.wait_for_timeout(1500)
        except Exception:
            pass
    warm.close()
    for name, fn, kw in SCENES:
        scene(name, fn, b, **kw)
    b.close()
shutil.rmtree(tmp, ignore_errors=True)
