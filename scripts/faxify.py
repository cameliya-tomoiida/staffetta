"""架空の注文書PNGを「FAXで届いたPDF」っぽく加工する（白黒化・わずかな傾き・ノイズ・逆さま）。"""
import random, sys
from pathlib import Path
from PIL import Image, ImageFilter

random.seed(7)
src = Path(__file__).parent / "fax-samples"
out = Path(__file__).parent.parent / "public" / "samples"
out.mkdir(parents=True, exist_ok=True)

def faxify(name, angle=0.0, flip=False):
    im = Image.open(src / f"{name}.png").convert("L")
    w, h = im.size
    im = im.resize((int(w * 1.3), int(h * 1.3)), Image.LANCZOS)  # FAXの標準〜ファイン程度の解像度
    im = im.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=255)
    im = im.filter(ImageFilter.GaussianBlur(0.4))
    px = im.load()
    W, H = im.size
    for _ in range(W * H // 4000):  # ゴミ点
        x, y = random.randrange(W), random.randrange(H)
        px[x, y] = 0
    im = im.point(lambda v: 0 if v < 175 else 255).convert("L")  # 白黒2値（PDFはグレースケールで保存）
    if flip:
        im = im.rotate(180)
    im.save(out / f"{name}.pdf", "PDF", resolution=200)
    print("wrote", out / f"{name}.pdf", im.size)

faxify("fax1", angle=0.6)
faxify("fax2", angle=-0.8, flip=True)
faxify("fax3", angle=0.4)
faxify("fax4", angle=-0.3)
faxify("fax5", angle=0.5)
faxify("fax6", angle=0.8)
faxify("fax7", angle=0, flip=True)
faxify("fax8", angle=-0.6)
faxify("fax9", angle=-0.5)
