"""Скачивает анимированные эмодзи Google Noto (лицензия CC BY 4.0) для приложения и сайта beemes.

Запуск: python3 tools/fetch_emoji.py
Кладёт lottie-файлы в android/app/src/main/assets/emoji/<код>.json и список в android/.../emoji/index.json
(и тот же список — в server/pb_public/emoji/index.json для сайта).

В приложении лежат только самые нужные (GROUPS ниже). Остальные анимации Noto (группы «Ещё …») в список
попадают, но файлы не скачиваются: сервер beemes сам скачает каждую один раз при первом запросе
и сохранит у себя (server/pb_hooks/main.pb.js, маршрут /emoji/…). Телефоны к Google не обращаются.
Эмодзи без анимации в наборе Noto пропускаются.
"""
import json, os, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "android", "app", "src", "main", "assets", "emoji")
CDN = "https://fonts.gstatic.com/s/e/notoemoji/latest/{}/lottie.json"
CATALOG = "https://googlefonts.github.io/noto-emoji-animation/data/api.json"
SERVER_INDEX = os.path.join(ROOT, "server", "pb_public", "emoji", "index.json")
# Группы «Ещё …» из каталога Noto (без оттенков кожи — их слишком много для панели).
MORE = [
    ("Ещё смайлы", ["Smileys and emotions", "People"]),
    ("Животные и растения", ["Animals and nature"]),
    ("Еда и напитки", ["Food and drink"]),
    ("Праздник, спорт, хобби", ["Activities and events"]),
    ("Путешествия", ["Travel and places"]),
    ("Предметы", ["Objects"]),
    ("Символы и флаги", ["Symbols", "Flags"]),
]
SKIN = {"1f3fb", "1f3fc", "1f3fd", "1f3fe", "1f3ff"}

# Группы для панели эмодзи: название группы и эмодзи по порядку.
GROUPS = [
    ("Смайлы", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👻 👽 👾 🤖"),
    ("Сердца", "❤️ 🧡 💛 💚 🩵 💙 💜 🤎 🖤 🩶 🤍 🩷 💘 💝 💖 💗 💓 💞 💕 💟 ❣️ 💔 ❤️‍🔥 ❤️‍🩹 💋 💯 💢 💥 💫 💦 💨 🕳️ 💬 💤"),
    ("Жесты", "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👄 🫦"),
    ("Природа", "🐝 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐛 🦋 🐌 🐞 🐜 🪲 🦂 🐢 🐍 🦎 🦖 🐙 🦑 🦀 🐡 🐠 🐟 🐬 🐳 🦈 🌵 🌲 🌴 🌱 🌿 🍀 🍁 🍂 🌷 🌹 🌺 🌸 🌼 🌻 🌞 🌝 🌚 🌕 🌙 🌎 ⭐ 🌟 ✨ ⚡ ☄️ 🔥 🌈 ☀️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ☃️ ⛄ 🌊"),
    ("Еда и праздник", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🌶️ 🌽 🥕 🍿 🍕 🍔 🍟 🌭 🥪 🌮 🍣 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍯 ☕ 🍵 🧃 🥤 🍾 🥂 🎉 🎊 🎈 🎁 🎆 🎇 🧨 🏆 🥇 ⚽ 🏀 🎮 🎲 🎯 🎸 🎧 🎤"),
    ("Разное", "🚀 ✈️ 🚗 🚲 🛸 ⏰ ⌛ 💡 📚 🧪 ⚗️ 🔬 🔭 💻 📱 📞 🎥 📷 💰 💎 🔑 🔒 🔔 📌 ✅ ❌ ❓ ❗ ⚠️ 🆒 🆗 🆕 🔝 ♻️ 🎵 🎶 💌 🪄 🧿 🎭"),
]


def code_of(e):
    return "_".join("%x" % ord(c) for c in e)


def fetch(code):
    try:
        with urllib.request.urlopen(CDN.format(code), timeout=20) as r:
            return r.read()
    except urllib.error.HTTPError:
        return None


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for title, line in GROUPS:
        items = []
        for e in line.split():
            code = code_of(e)
            path = os.path.join(OUT, code + ".json")
            data = open(path, "rb").read() if os.path.exists(path) else None
            if data is None:
                data = fetch(code) or fetch(code.replace("_fe0f", ""))
                if data is None:
                    print("нет анимации:", e, code)
                    continue
                # Сжимаем: убираем лишние пробелы в JSON.
                data = json.dumps(json.loads(data), separators=(",", ":")).encode()
                open(path, "wb").write(data)
            items.append({"e": e, "c": code})
        index.append({"title": title, "items": items})
        print(title, len(items))
    # Остальные анимации из каталога Noto — только в список.
    with urllib.request.urlopen(CATALOG, timeout=30) as r:
        icons = json.load(r)["icons"]
    norm = lambda c: c.replace("_fe0f", "")
    have = {norm(it["c"]) for g in index for it in g["items"]}
    for title, cats in MORE:
        items = []
        for icon in icons:
            cp = icon["codepoint"]
            if icon["categories"][:1] and icon["categories"][0] in cats and not (set(cp.split("_")) & SKIN) and norm(cp) not in have:
                items.append({"e": "".join(chr(int(x, 16)) for x in cp.split("_")), "c": cp})
                have.add(norm(cp))
        if items:
            index.append({"title": title, "items": items})
            print(title, len(items), "(с сервера)")
    for path in (os.path.join(OUT, "index.json"), SERVER_INDEX):
        json.dump(index, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print("всего файлов:", len(os.listdir(OUT)), "размер, МБ:", round(total / 1e6, 1))


if __name__ == "__main__":
    main()
