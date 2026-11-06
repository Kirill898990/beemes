"""Скачивает анимированные эмодзи Google Noto (лицензия CC BY 4.0) для приложения и сайта beemes.

Запуск: python3 tools/fetch_emoji.py
Кладёт lottie-файлы в android/app/src/main/assets/emoji/<код>.json и список в android/.../emoji/index.json.
Эмодзи без анимации в наборе Noto пропускаются.
"""
import json, os, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "android", "app", "src", "main", "assets", "emoji")
CDN = "https://fonts.gstatic.com/s/e/notoemoji/latest/{}/lottie.json"

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
    json.dump(index, open(os.path.join(OUT, "index.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print("всего файлов:", len(os.listdir(OUT)), "размер, МБ:", round(total / 1e6, 1))


if __name__ == "__main__":
    main()
