"""Стикеры beemes «Пчёлка Бимми»: рисуются здесь (SVG), в PNG их переводит tools/stickers/render.js.

Запуск:  python3 tools/stickers/make_stickers.py && node tools/stickers/render.js
Результат: server/pb_public/stickers/bee/<имя>.png (сайт), android/app/src/main/assets/stickers/bee/<имя>.png
и списки server/pb_public/stickers/index.json, android/app/src/main/assets/stickers/index.json.
Рисунки — собственные, их можно свободно использовать в beemes.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SVG_DIR = os.path.join(ROOT, "tools", "stickers", "svg")

INK = "#2E2119"
YEL_A, YEL_B = "#FFE066", "#FFB300"


def eyes(kind):
    l, r = (206, 178), (306, 178)
    if kind == "open":
        return "".join(f'<circle cx="{x}" cy="{y}" r="27" fill="#fff" stroke="{INK}" stroke-width="7"/><circle cx="{x + 4}" cy="{y + 4}" r="14" fill="{INK}"/><circle cx="{x + 9}" cy="{y - 2}" r="5" fill="#fff"/>' for x, y in (l, r))
    if kind == "wide":
        return "".join(f'<circle cx="{x}" cy="{y}" r="32" fill="#fff" stroke="{INK}" stroke-width="7"/><circle cx="{x}" cy="{y}" r="10" fill="{INK}"/>' for x, y in (l, r))
    if kind == "happy":  # ^ ^
        return "".join(f'<path d="M{x - 24} {y + 10} Q{x} {y - 22} {x + 24} {y + 10}" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>' for x, y in (l, r))
    if kind == "closed":
        return "".join(f'<path d="M{x - 24} {y} Q{x} {y + 20} {x + 24} {y}" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round"/>' for x, y in (l, r))
    if kind == "wink":
        x, y = l
        return (f'<path d="M{x - 24} {y + 6} Q{x} {y - 18} {x + 24} {y + 6}" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>'
                + eyes_one(r))
    if kind == "hearts":
        return "".join(heart(x, y, 34, "#FF3D6E") for x, y in (l, r))
    if kind == "sad":
        return "".join(f'<circle cx="{x}" cy="{y + 6}" r="24" fill="#fff" stroke="{INK}" stroke-width="7"/><circle cx="{x}" cy="{y + 12}" r="12" fill="{INK}"/>' for x, y in (l, r)) + \
            f'<path d="M180 140 L228 128" stroke="{INK}" stroke-width="9" stroke-linecap="round"/><path d="M332 140 L284 128" stroke="{INK}" stroke-width="9" stroke-linecap="round"/>'
    if kind == "angry":
        return "".join(f'<circle cx="{x}" cy="{y + 6}" r="22" fill="#fff" stroke="{INK}" stroke-width="7"/><circle cx="{x}" cy="{y + 8}" r="11" fill="{INK}"/>' for x, y in (l, r)) + \
            f'<path d="M176 136 L232 158" stroke="{INK}" stroke-width="11" stroke-linecap="round"/><path d="M336 136 L280 158" stroke="{INK}" stroke-width="11" stroke-linecap="round"/>'
    if kind == "shades":
        return (f'<path d="M168 160 H344 V172 Q344 214 302 214 Q270 214 262 182 H250 Q242 214 210 214 Q168 214 168 172 Z" fill="{INK}"/>'
                f'<path d="M184 172 Q196 166 214 170" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"/>')
    if kind == "look-up":
        return "".join(f'<circle cx="{x}" cy="{y}" r="26" fill="#fff" stroke="{INK}" stroke-width="7"/><circle cx="{x + 8}" cy="{y - 10}" r="12" fill="{INK}"/>' for x, y in (l, r))
    raise ValueError(kind)


def eyes_one(p):
    x, y = p
    return f'<circle cx="{x}" cy="{y}" r="27" fill="#fff" stroke="{INK}" stroke-width="7"/><circle cx="{x + 4}" cy="{y + 4}" r="14" fill="{INK}"/><circle cx="{x + 9}" cy="{y - 2}" r="5" fill="#fff"/>'


def mouth(kind):
    if kind == "smile":
        return f'<path d="M222 232 Q256 266 290 232" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>'
    if kind == "grin":
        return f'<path d="M212 228 Q256 296 300 228 Z" fill="#7A1F2B" stroke="{INK}" stroke-width="8" stroke-linejoin="round"/><path d="M236 262 Q256 274 276 262 Q266 250 256 252 Q246 250 236 262Z" fill="#FF7A8A"/>'
    if kind == "o":
        return f'<ellipse cx="256" cy="246" rx="20" ry="26" fill="#7A1F2B" stroke="{INK}" stroke-width="8"/>'
    if kind == "frown":
        return f'<path d="M226 254 Q256 228 286 254" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>'
    if kind == "flat":
        return f'<path d="M232 246 H280" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>'
    if kind == "kiss":
        return f'<path d="M248 228 Q270 236 252 246 Q272 256 248 264" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
    if kind == "smirk":
        return f'<path d="M228 244 Q266 258 292 228" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>'
    if kind == "wobbly":
        return f'<path d="M222 250 q11 -12 22 0 t22 0 t22 0" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round"/>'
    raise ValueError(kind)


def heart(x, y, s, color):
    k = s / 30
    return (f'<path transform="translate({x} {y}) scale({k:.3f})" d="M0 22 C-34 -4 -22 -30 0 -16 C22 -30 34 -4 0 22Z" '
            f'fill="{color}" stroke="{INK}" stroke-width="{6 / k:.1f}" stroke-linejoin="round"/>')


def caption(text, color="#FF8A00"):
    size = 58 if len(text) <= 8 else 48 if len(text) <= 12 else 40
    return (f'<text x="256" y="486" text-anchor="middle" font-family="Nunito, \'Arial Rounded MT Bold\', Arial, sans-serif" font-weight="900" '
            f'font-size="{size}" fill="#fff" stroke="{INK}" stroke-width="16" stroke-linejoin="round" paint-order="stroke">{text}</text>'
            f'<text x="256" y="486" text-anchor="middle" font-family="Nunito, \'Arial Rounded MT Bold\', Arial, sans-serif" font-weight="900" '
            f'font-size="{size}" fill="{color}">{text}</text>')


def arm(side, pose):
    """Ручка: side = -1 (левая) / 1 (правая)."""
    x0 = 256 + side * 100
    if pose == "wave":
        return (f'<path d="M{x0} 320 Q{x0 + side * 60} 290 {x0 + side * 70} 220" fill="none" stroke="{INK}" stroke-width="16" stroke-linecap="round"/>'
                f'<circle cx="{x0 + side * 72}" cy="210" r="24" fill="{YEL_A}" stroke="{INK}" stroke-width="8"/>'
                f'<path d="M{x0 + side * 110} 180 q{side * 14} 10 {side * 8} 26 M{x0 + side * 116} 220 q{side * 14} 6 {side * 14} 20" fill="none" stroke="{INK}" stroke-width="6" stroke-linecap="round"/>')
    if pose == "up":  # большой палец вверх
        return (f'<path d="M{x0} 330 Q{x0 + side * 50} 320 {x0 + side * 64} 280" fill="none" stroke="{INK}" stroke-width="16" stroke-linecap="round"/>'
                f'<rect x="{x0 + side * 64 - 26}" y="250" width="52" height="46" rx="16" fill="{YEL_A}" stroke="{INK}" stroke-width="8"/>'
                f'<rect x="{x0 + side * 64 - 10}" y="206" width="22" height="54" rx="11" fill="{YEL_A}" stroke="{INK}" stroke-width="8"/>')
    if pose == "hold":  # держит что-то перед собой
        return (f'<path d="M{x0} 330 Q{x0 - side * 30} 360 {256 + side * 40} 368" fill="none" stroke="{INK}" stroke-width="16" stroke-linecap="round"/>'
                f'<circle cx="{256 + side * 40}" cy="368" r="20" fill="{YEL_A}" stroke="{INK}" stroke-width="7"/>')
    if pose == "chin":
        return (f'<path d="M{x0} 330 Q{x0 - side * 10} 300 {256 + side * 44} 276" fill="none" stroke="{INK}" stroke-width="16" stroke-linecap="round"/>'
                f'<circle cx="{256 + side * 44}" cy="272" r="20" fill="{YEL_A}" stroke="{INK}" stroke-width="7"/>')
    if pose == "open":
        return (f'<path d="M{x0} 330 Q{x0 + side * 70} 330 {x0 + side * 100} 270" fill="none" stroke="{INK}" stroke-width="16" stroke-linecap="round"/>'
                f'<circle cx="{x0 + side * 102}" cy="262" r="22" fill="{YEL_A}" stroke="{INK}" stroke-width="8"/>')
    if pose == "down":
        return (f'<path d="M{x0} 330 Q{x0 + side * 34} 370 {x0 + side * 30} 404" fill="none" stroke="{INK}" stroke-width="16" stroke-linecap="round"/>'
                f'<circle cx="{x0 + side * 30}" cy="408" r="18" fill="{YEL_A}" stroke="{INK}" stroke-width="7"/>')
    raise ValueError(pose)


def bee(eye="open", mth="smile", arms=("down", "down"), blush=True, extra_back="", extra_front="", text="", text_color="#FF8A00", tint=None, lift=0):
    body_a, body_b = (tint or (YEL_A, YEL_B))
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">',
        f'<defs><linearGradient id="y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{body_a}"/><stop offset="1" stop-color="{body_b}"/></linearGradient>'
        '<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#CDE9FF"/></linearGradient>'
        '<clipPath id="b"><ellipse cx="256" cy="250" rx="138" ry="150"/></clipPath></defs>',
        f'<g transform="translate(0 {lift})">',
        extra_back,
        # крылья
        f'<ellipse cx="136" cy="150" rx="70" ry="48" transform="rotate(-30 136 150)" fill="url(#w)" stroke="{INK}" stroke-width="8" opacity=".95"/>',
        f'<ellipse cx="376" cy="150" rx="70" ry="48" transform="rotate(30 376 150)" fill="url(#w)" stroke="{INK}" stroke-width="8" opacity=".95"/>',
        # усики
        f'<path d="M222 108 Q206 56 172 44" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round"/><circle cx="168" cy="42" r="14" fill="{INK}"/>',
        f'<path d="M290 108 Q306 56 340 44" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round"/><circle cx="344" cy="42" r="14" fill="{INK}"/>',
        # жало
        f'<path d="M240 392 L256 428 L272 392Z" fill="{INK}"/>',
        # тело с полосками
        f'<ellipse cx="256" cy="250" rx="138" ry="150" fill="url(#y)"/>',
        f'<g clip-path="url(#b)"><rect x="100" y="300" width="312" height="34" fill="{INK}"/><rect x="100" y="362" width="312" height="34" fill="{INK}"/></g>',
        f'<ellipse cx="256" cy="250" rx="138" ry="150" fill="none" stroke="{INK}" stroke-width="10"/>',
        '<ellipse cx="206" cy="132" rx="46" ry="22" fill="#fff" opacity=".35" transform="rotate(-18 206 132)"/>',
    ]
    if blush:
        parts.append('<ellipse cx="168" cy="226" rx="22" ry="13" fill="#FF7A8A" opacity=".6"/><ellipse cx="344" cy="226" rx="22" ry="13" fill="#FF7A8A" opacity=".6"/>')
    parts += [eyes(eye), mouth(mth), arm(-1, arms[0]), arm(1, arms[1]), extra_front, '</g>']
    if text:
        parts.append(caption(text, text_color))
    parts.append('</svg>')
    return "\n".join(parts)


def sparkle(x, y, s=1.0, color="#FFD54A"):
    return (f'<path transform="translate({x} {y}) scale({s})" d="M0 -28 Q6 -6 28 0 Q6 6 0 28 Q-6 6 -28 0 Q-6 -6 0 -28Z" '
            f'fill="{color}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>')


def tear(x, y, s=1.0):
    return f'<path transform="translate({x} {y}) scale({s})" d="M0 -22 Q16 2 0 18 Q-16 2 0 -22Z" fill="#6EC6FF" stroke="{INK}" stroke-width="5"/>'


FLOWER = (f'<g transform="translate(256 360)"><path d="M0 0 V-70" stroke="#2E8B3E" stroke-width="10" stroke-linecap="round"/>'
          + "".join(f'<circle cx="{dx}" cy="{dy - 92}" r="20" fill="#FF7EB3" stroke="{INK}" stroke-width="6"/>' for dx, dy in ((0, -22), (21, -7), (13, 18), (-13, 18), (-21, -7)))
          + f'<circle cx="0" cy="-92" r="15" fill="#FFD54A" stroke="{INK}" stroke-width="6"/></g>')
CUP = (f'<g transform="translate(256 352)"><path d="M-44 -34 H44 L36 26 Q34 40 20 40 H-20 Q-34 40 -36 26Z" fill="#fff" stroke="{INK}" stroke-width="8" stroke-linejoin="round"/>'
       f'<path d="M44 -20 Q72 -18 66 8 Q60 24 38 20" fill="none" stroke="{INK}" stroke-width="8"/><rect x="-40" y="-30" width="80" height="12" fill="#8D5524"/>'
       f'<path d="M-14 -50 q-10 -16 0 -30 M10 -50 q-10 -16 0 -30" fill="none" stroke="{INK}" stroke-width="6" stroke-linecap="round" opacity=".6"/></g>')
HAT = (f'<path d="M206 104 L262 -2 L316 104Z" fill="#7D5CFF" stroke="{INK}" stroke-width="8" stroke-linejoin="round"/>'
       f'<path d="M222 74 L300 74 M236 44 L288 44" stroke="#FFD54A" stroke-width="10" stroke-linecap="round"/><circle cx="262" cy="0" r="16" fill="#FF5E8A" stroke="{INK}" stroke-width="6"/>')
CONFETTI = "".join(f'<rect x="{x}" y="{y}" width="16" height="26" rx="4" fill="{c}" transform="rotate({r} {x} {y})" stroke="{INK}" stroke-width="3"/>'
                   for x, y, c, r in ((60, 80, "#FF5E8A", 20), (440, 70, "#36D1C4", -25), (40, 260, "#FFD54A", 40), (466, 250, "#7D5CFF", -15), (86, 380, "#36D1C4", 60), (430, 390, "#FF5E8A", 10)))
ZZZ = (f'<text x="380" y="100" font-family="Arial, sans-serif" font-weight="900" font-size="64" fill="#7D5CFF" stroke="{INK}" stroke-width="5" paint-order="stroke">Z</text>'
       f'<text x="430" y="54" font-family="Arial, sans-serif" font-weight="900" font-size="44" fill="#7D5CFF" stroke="{INK}" stroke-width="4" paint-order="stroke">z</text>')
STEAM = (f'<path d="M84 150 q-14 -20 0 -40 q14 -20 0 -40" fill="none" stroke="#B0B0B8" stroke-width="12" stroke-linecap="round"/>'
         f'<path d="M428 150 q14 -20 0 -40 q-14 -20 0 -40" fill="none" stroke="#B0B0B8" stroke-width="12" stroke-linecap="round"/>')
GIFT = (f'<g transform="translate(256 360)"><rect x="-50" y="-36" width="100" height="78" rx="10" fill="#FF5E8A" stroke="{INK}" stroke-width="8"/>'
        f'<rect x="-58" y="-56" width="116" height="26" rx="8" fill="#FF7EB3" stroke="{INK}" stroke-width="8"/><rect x="-10" y="-56" width="20" height="98" fill="#FFD54A" stroke="{INK}" stroke-width="5"/>'
        f'<path d="M0 -56 Q-40 -96 -44 -64 Q-40 -50 0 -56 Q40 -96 44 -64 Q40 -50 0 -56Z" fill="#FFD54A" stroke="{INK}" stroke-width="6"/></g>')
QUESTION = (f'<text x="388" y="120" font-family="Arial, sans-serif" font-weight="900" font-size="110" fill="#36D1C4" stroke="{INK}" stroke-width="7" paint-order="stroke">?</text>')
SWEAT = f'<path d="M352 110 Q370 140 352 160 Q334 140 352 110Z" fill="#6EC6FF" stroke="{INK}" stroke-width="6"/>'
BIG_HEART = heart(256, 350, 70, "#FF3D6E")

STICKERS = [
    ("hello", "👋", "Привет!", bee("open", "grin", ("down", "wave"), extra_front=sparkle(70, 120, .8), text="Привет!")),
    ("love", "😍", "", bee("hearts", "grin", ("down", "down"), extra_back=heart(70, 90, 40, "#FF5E8A") + heart(444, 120, 32, "#FF7EB3") + heart(420, 40, 22, "#FF3D6E"))),
    ("lol", "😂", "Ха-ха!", bee("happy", "grin", ("down", "down"), extra_front=tear(160, 214, 1.1) + tear(352, 214, 1.1), text="Ха-ха!")),
    ("thanks", "🙏", "Спасибо!", bee("happy", "smile", ("hold", "hold"), extra_front=FLOWER, text="Спасибо!", text_color="#FF5E8A")),
    ("ok", "👍", "Окей!", bee("wink", "smirk", ("down", "up"), text="Окей!", text_color="#2BB673")),
    ("sleep", "😴", "Спокойной ночи", bee("closed", "o", ("down", "down"), blush=True, extra_back=ZZZ, tint=("#FFE9A0", "#F2B33D"), text="Спокойной ночи", text_color="#7D5CFF")),
    ("sad", "😢", "", bee("sad", "frown", ("down", "down"), blush=False, extra_front=tear(330, 236, 1.2))),
    ("wow", "😮", "Вау!", bee("wide", "o", ("open", "open"), extra_back=sparkle(70, 90) + sparkle(446, 100, .8) + sparkle(456, 300, .6), text="Вау!", text_color="#3D8BFF")),
    ("angry", "😠", "", bee("angry", "frown", ("down", "down"), blush=False, tint=("#FFB37A", "#FF6A3D"), extra_back=STEAM)),
    ("party", "🥳", "Ура!", bee("happy", "grin", ("open", "open"), extra_back=CONFETTI, extra_front=HAT, text="Ура!", text_color="#7D5CFF", lift=10)),
    ("coffee", "☕", "Доброе утро", bee("closed", "smile", ("hold", "hold"), extra_front=CUP, text="Доброе утро", text_color="#FF9F1C")),
    ("hug", "🤗", "Обнимаю", bee("happy", "smile", ("open", "open"), extra_back=heart(64, 110, 30, "#FF7EB3") + heart(448, 110, 30, "#FF7EB3"), text="Обнимаю", text_color="#FF5E8A")),
    ("think", "🤔", "Хм…", bee("look-up", "flat", ("down", "chin"), extra_back=QUESTION, text="Хм…", text_color="#0E8C8C")),
    ("cool", "😎", "", bee("shades", "smirk", ("down", "up"), blush=False, extra_back=sparkle(440, 70, .7))),
    ("kiss", "😘", "", bee("wink", "kiss", ("down", "down"), extra_front=heart(330, 250, 26, "#FF3D6E"))),
    ("sorry", "😅", "Прости", bee("sad", "wobbly", ("hold", "hold"), extra_front=SWEAT, text="Прости", text_color="#3D8BFF")),
    ("gift", "🎁", "Это тебе!", bee("happy", "grin", ("hold", "hold"), extra_front=GIFT, text="Это тебе!", text_color="#FF5E8A")),
    ("loveyou", "❤️", "Люблю", bee("hearts", "smile", ("hold", "hold"), extra_front=BIG_HEART, text="Люблю", text_color="#FF3D6E")),
]


def main():
    os.makedirs(SVG_DIR, exist_ok=True)
    for name, _, _, svg in STICKERS:
        open(os.path.join(SVG_DIR, name + ".svg"), "w").write(svg)
    index = [{"id": "bee", "title": "Пчёлка Бимми", "items": [{"id": n, "e": e, "t": t} for n, e, t, _ in STICKERS]}]
    for path in (os.path.join(ROOT, "server", "pb_public", "stickers", "index.json"),
                 os.path.join(ROOT, "android", "app", "src", "main", "assets", "stickers", "index.json")):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(index, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    print("стикеров:", len(STICKERS))


if __name__ == "__main__":
    main()
