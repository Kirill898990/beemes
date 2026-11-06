/*
 * Сайт-визитка beemes: живые эмодзи (Lottie), выбор цвета профиля и ссылка на последнюю версию APK
 * (её выкладывают в веб-панели сервера, коллекция app_releases).
 */
(function () {
  "use strict";
  const base = location.origin;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const charOf = (code) => String.fromCodePoint.apply(null, code.split("_").map((h) => parseInt(h, 16)));

  // ---------- Живые эмодзи: играют, только пока видны на экране ----------
  const players = new Map();
  function mount(el) {
    const code = el.dataset.emoji;
    if (!window.lottie) { el.textContent = charOf(code); return; }
    try {
      const anim = window.lottie.loadAnimation({
        container: el, renderer: "svg", loop: !reduced, autoplay: false, path: `emoji/${code}.json`,
        rendererSettings: { preserveAspectRatio: "xMidYMid meet", progressiveLoad: true },
      });
      anim.addEventListener("data_failed", () => { el.textContent = charOf(code); });
      players.set(el, anim);
    } catch (_) {
      el.textContent = charOf(code);
    }
  }
  const emojis = document.querySelectorAll("[data-emoji]");
  if ("IntersectionObserver" in window) {
    const seen = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!players.has(e.target)) mount(e.target);
        const anim = players.get(e.target);
        if (!anim) return;
        if (e.isIntersecting) { if (reduced) anim.goToAndStop(anim.totalFrames ? anim.totalFrames - 1 : 0, true); else anim.play(); }
        else anim.pause();
      });
    }, { rootMargin: "120px" });
    emojis.forEach((el) => seen.observe(el));
  } else {
    emojis.forEach((el) => { mount(el); const a = players.get(el); if (a && !reduced) a.play(); });
  }

  // ---------- Цвет профиля ----------
  const card = document.getElementById("pcard");
  const accents = document.querySelectorAll(".accent");
  accents.forEach((btn) => {
    btn.addEventListener("click", () => {
      accents.forEach((b) => b.setAttribute("aria-checked", b === btn ? "true" : "false"));
      card.className = "pcard accent-" + btn.dataset.accent;
    });
  });

  // ---------- Последняя версия приложения ----------
  async function loadRelease() {
    const links = document.querySelectorAll(".apk-link");
    const metas = document.querySelectorAll(".apk-meta");
    const setMeta = (text) => metas.forEach((m) => { m.textContent = text; });
    try {
      const r = await fetch(`${base}/api/collections/app_releases/records?sort=-versionCode&perPage=1`);
      if (!r.ok) throw new Error(String(r.status));
      const release = (await r.json()).items[0];
      if (!release) { setMeta("скоро появится"); return; }
      const url = `${base}/api/files/${release.collectionName}/${release.id}/${encodeURIComponent(release.apk)}?download=1`;
      links.forEach((a) => {
        a.href = url;
        a.setAttribute("download", `beemes-${release.versionName}.apk`);
        a.removeAttribute("aria-disabled");
      });
      setMeta(`версия ${release.versionName}`);
      fetch(url, { method: "HEAD" }).then((h) => {
        const size = Number(h.headers.get("content-length"));
        if (size > 0) setMeta(`версия ${release.versionName} · ${(size / 1048576).toFixed(1).replace(".", ",")} МБ`);
      }, () => {});
      if (release.notes) {
        document.getElementById("new-title").textContent = `Что нового в версии ${release.versionName}`;
        document.getElementById("new-notes").textContent = release.notes;
        document.getElementById("whats-new").hidden = false;
      }
    } catch (_) {
      setMeta("не удалось загрузить, обновите страницу");
    }
  }
  loadRelease();
})();
