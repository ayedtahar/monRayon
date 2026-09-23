#!/usr/bin/env python3
"""Genere les icones de l'application a partir de la marque monRayon.

La marque est la meme que dans l'interface : un « m » serif italique creme sur
fond vert. Les valeurs reprennent les jetons de src/app/globals.css.

    python3 scripts/generate-icons.py

Depend de Pillow et d'une police serif italique (Liberation Serif, metriquement
compatible avec Times New Roman, le repli declare dans la feuille de style).
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

GREEN = (23, 79, 52)  # --green
PAPER = (245, 242, 233)  # --paper
FONT_PATH = "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf"
PUBLIC = Path(__file__).resolve().parent.parent / "public"

# Une icone maskable est rognee : sa marque doit tenir dans la zone sure.
TARGETS = [
    ("icon-192.png", 192, 0.62),
    ("icon-512.png", 512, 0.62),
    ("icon-maskable-512.png", 512, 0.46),
    ("apple-touch-icon.png", 180, 0.62),
]


def draw_icon(size: int, mark_ratio: float) -> Image.Image:
    image = Image.new("RGB", (size, size), GREEN)
    draw = ImageDraw.Draw(image)

    # Cherche la taille de police dont le « m » occupe la fraction visee.
    target = size * mark_ratio
    font_size = size
    while font_size > 4:
        font = ImageFont.truetype(FONT_PATH, font_size)
        left, top, right, bottom = draw.textbbox((0, 0), "m", font=font)
        if right - left <= target:
            break
        font_size -= 1

    # Centre sur la boite reelle du glyphe, pas sur son avance typographique.
    draw.text(
        ((size - (right - left)) / 2 - left, (size - (bottom - top)) / 2 - top),
        "m",
        font=font,
        fill=PAPER,
    )
    return image


def main() -> None:
    for name, size, ratio in TARGETS:
        path = PUBLIC / name
        draw_icon(size, ratio).save(path, "PNG", optimize=True)
        print(f"{path.relative_to(PUBLIC.parent)} ({size}x{size})")


if __name__ == "__main__":
    main()
