"""Draws the REWIND app icon (rewind glyph on a beveled Midnight 2003 tile) and writes Tauri's icon set."""
import sys
from PIL import Image, ImageDraw

def draw(size):
    s = 1024
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    m = 56
    # vertical gradient tile
    for y in range(m, s - m):
        t = (y - m) / (s - 2 * m)
        c = (int(19 + (6 - 19) * t), int(33 + (10 - 33) * t), int(77 + (23 - 77) * t), 255)
        d.line([(m, y), (s - m, y)], fill=c)
    # bevel: light top-left, dark bottom-right
    w = 22
    d.rectangle([m, m, s - m - 1, m + w], fill=(169, 193, 239, 255))
    d.rectangle([m, m, m + w, s - m - 1], fill=(169, 193, 239, 255))
    d.rectangle([m, s - m - w, s - m - 1, s - m - 1], fill=(2, 4, 11, 255))
    d.rectangle([s - m - w, m, s - m - 1, s - m - 1], fill=(2, 4, 11, 255))
    d.rectangle([m - 8, m - 8, s - m + 7, s - m + 7], outline=(2, 4, 11, 255), width=8)
    # inset screen
    a, b = 170, s - 170
    d.rectangle([a, a, b, b], fill=(7, 12, 29, 255))
    d.line([(a, a), (b, a)], fill=(2, 4, 11, 255), width=10)
    d.line([(a, a), (a, b)], fill=(2, 4, 11, 255), width=10)
    d.line([(a, b), (b, b)], fill=(45, 62, 114, 255), width=10)
    d.line([(b, a), (b, b)], fill=(45, 62, 114, 255), width=10)
    # rewind glyph: bar + two triangles
    cy, h = s // 2, 300
    silver = (214, 220, 234, 255)
    d.rectangle([262, cy - h // 2, 312, cy + h // 2], fill=silver)
    d.polygon([(330, cy), (560, cy - h // 2), (560, cy + h // 2)], fill=silver)
    d.polygon([(540, cy), (770, cy - h // 2), (770, cy + h // 2)], fill=(169, 193, 239, 255))
    return im.resize((size, size), Image.LANCZOS)

out = sys.argv[1]
big = draw(1024)
big.save(f"{out}/icon.png")
for n, px in [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)]:
    draw(px).save(f"{out}/{n}")
big.save(f"{out}/icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
