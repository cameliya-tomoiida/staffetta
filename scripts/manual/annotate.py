# 操作手引き（docs/manual）の画面写真に、丸と番号を描く。
#   python scripts/manual/annotate.py
# 元の写真: docs/screenshots/all/（②が撮った架空データの画面）と docs/manual/shots/（④が 3100 で撮ったマスタ・発注の画面）
# 出力: docs/manual/img/*.png
# 実在の取引先・FAX が写った写真は使わない（元の写真を足すときは、必ず目で確かめる）。
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
ALL = ROOT / "docs/screenshots/all"
SHOTS = ROOT / "docs/manual/shots"
OUT = ROOT / "docs/manual/img"
RED = (200, 30, 30)
FONT = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"

# (出力名, 元の写真, 切り取り (左, 上, 右, 下) or None, [(x, y, 丸の半径), ...]) 座標は元の写真の画素
JOBS = [
    ("01-inbox", ALL / "01-inbox.png", (0, 0, 1024, 1100), [(403, 223, 0), (390, 951, 0)]),
    ("02-fax-review", ROOT / "docs/screenshots/02-fax-review.png", None, [(971, 243, 0), (175, 546, 0), (1112, 659, 0), (812, 775, 0), (1148, 775, 0)]),
    ("03-orders", ALL / "02-orders.png", (0, 0, 1024, 1000), [(421, 197, 0), (567, 367, 0), (894, 616, 0), (894, 676, 0)]),
    ("04-line", ALL / "11-line.png", (0, 0, 1024, 900), [(851, 340, 0)]),
    ("05-purchase", SHOTS / "purchase.png", (0, 0, 1024, 1560), [(400, 196, 0), (407, 284, 0), (631, 527, 0), (638, 1464, 0)]),
    ("06-outbound", SHOTS / "outbound.png", (0, 0, 1024, 1150), [(435, 245, 0), (395, 767, 0), (595, 818, 0), (638, 1080, 0)]),
    ("07-plan", SHOTS / "plan.png", (0, 0, 1024, 800), [(365, 196, 0), (527, 567, 0), (545, 715, 0), (929, 702, 0)]),
    ("08-master-list", SHOTS / "masters-products.png", (0, 0, 1024, 800), [(448, 246, 0), (643, 246, 0), (436, 310, 0), (834, 491, 0)]),
    ("09-recipes", SHOTS / "masters-recipes.png", None, [(362, 360, 0), (458, 609, 0), (690, 609, 0), (388, 1181, 0), (640, 1250, 0), (794, 1338, 0)]),
    ("10-steps", SHOTS / "masters-steps.png", (0, 0, 1024, 800), [(643, 246, 0), (436, 310, 0), (834, 491, 0)]),
    ("11-customers", SHOTS / "masters-customers.png", (0, 0, 1024, 700), [(436, 284, 0), (651, 220, 0)]),
]


def badge(d: ImageDraw.ImageDraw, x: int, y: int, n: int, r_ring: int):
    r = r_ring or 34
    d.ellipse((x - r, y - r, x + r, y + r), outline=RED, width=5)
    # 番号は丸の左上に
    bx, by, br = x - r - 6, y - r - 6, 19
    d.ellipse((bx - br, by - br, bx + br, by + br), fill=RED, outline=(255, 255, 255), width=3)
    f = ImageFont.truetype(FONT, 24)
    t = str(n)
    w = d.textlength(t, font=f)
    d.text((bx - w / 2, by - 14), t, fill=(255, 255, 255), font=f)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, src, crop, marks in JOBS:
        im = Image.open(src).convert("RGB")
        d = ImageDraw.Draw(im)
        for i, (x, y, r) in enumerate(marks, 1):
            badge(d, x, y, i, r)
        if crop:
            im = im.crop(crop)
        if im.width > 1024:
            im = im.resize((1024, round(im.height * 1024 / im.width)))
        im = im.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
        im.save(OUT / f"{name}.png", optimize=True)
        print(name, im.size)


if __name__ == "__main__":
    main()
