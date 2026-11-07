/* Группы и каналы: создание, «О группе» (участники, админы, ссылка), вступление по приглашению. */
import { h, icon, iconButton, avatar, nameWithStatus, groupAvatar, groupTitle, groupSubtitle, modal, toast, disposeEmoji, titleOf, animoji, popupMenu } from "../ui.js";
import * as store from "../store.js";

/** Люди, с которыми есть личные чаты, — из них выбираем участников. */
const contacts = () => store.state.chats.filter((i) => !i.group && i.peer).map((i) => store.state.users.get(i.peer.id) || i.peer);

function pickPeople(list, chosen) {
  return h("div", { class: "pick-list" }, list.length ? list.map((u) => {
    const box = h("input", { type: "checkbox", checked: chosen.has(u.id), "aria-label": titleOf(u) });
    box.onchange = () => { if (box.checked) chosen.add(u.id); else chosen.delete(u.id); };
    return h("label", { class: "pick-row" }, box, avatar(u, 40), h("span", { class: "grow" }, nameWithStatus(u, 16), h("small", {}, "@" + u.username)));
  }) : h("p", { class: "muted pad" }, "Пока не с кем: сначала напишите кому-нибудь в личку — потом его можно будет добавить."));
}

/** Новая группа или канал (левая колонка). */
export function newGroup(root, { go, type }) {
  const channel = type === "channel";
  const title = h("input", { class: "input", maxlength: 64, placeholder: channel ? "Например, «Новости улья»" : "Например, «Семья»", "aria-label": "Название" });
  const about = h("textarea", { class: "input", rows: 2, maxlength: 255, placeholder: "О чём это (необязательно)", "aria-label": "Описание" });
  const chosen = new Set();
  const handle = h("input", { class: "input", maxlength: 32, placeholder: "например, honey_news", "aria-label": "@имя канала", autocomplete: "off", spellcheck: "false" });
  const handleRow = h("label", { class: "field", hidden: true }, h("span", { class: "field-label" }, "@имя канала"), handle,
    h("small", { class: "muted" }, "По нему канал найдут в поиске. Латиница, цифры и _, от 4 символов."));
  const priv = h("input", { type: "radio", name: "vis", checked: true });
  const pub = h("input", { type: "radio", name: "vis" });
  const onVis = () => { handleRow.hidden = !pub.checked; };
  priv.onchange = onVis; pub.onchange = onVis;
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { type: "button", class: "btn btn-primary" }, channel ? "Создать канал" : "Создать группу");
  btn.onclick = async () => {
    err.textContent = "";
    if (!title.value.trim()) { err.textContent = "Впишите название"; return; }
    btn.disabled = true; btn.textContent = "Создаём…";
    try {
      const c = await store.createGroup({
        type: channel ? "channel" : "group", title: title.value.trim(), about: about.value.trim(), members: [...chosen],
        isPublic: channel && pub.checked, handle: handle.value.trim().replace(/^@/, "").toLowerCase(),
      });
      toast(channel ? "Канал создан" : "Группа создана");
      go(`#/chat/${c.id}`);
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = channel ? "Создать канал" : "Создать группу"; }
  };
  root.replaceChildren(
    h("header", { class: "side-header" }, iconButton("back", "Назад", () => go("#/")), h("h2", { class: "side-title" }, channel ? "Новый канал" : "Новая группа")),
    h("div", { class: "form pad-x new-group" },
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Название"), title),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Описание"), about),
      channel ? h("div", { class: "seg-choice", role: "radiogroup", "aria-label": "Какой канал" },
        h("label", {}, priv, h("span", {}, h("b", {}, "Приватный"), h("small", { class: "muted block" }, "Вступают по ссылке-приглашению. Посты зашифрованы — сервер их не видит."))),
        h("label", {}, pub, h("span", {}, h("b", {}, "Публичный"), h("small", { class: "muted block" }, "Его найдёт любой в поиске и сможет читать. Посты видны всем.")))) : null,
      handleRow,
      h("h3", { class: "list-title" }, channel ? "Подписчики (можно позже по ссылке)" : "Участники"),
      pickPeople(contacts(), chosen),
      err, btn));
  title.focus();
  return () => disposeEmoji(root);
}

/** «О группе / О канале»: описание, ссылка, участники, админы, выход. */
export function groupInfo(root, { chatId, go }) {
  const pane = h("section", { class: "profile-pane" });
  let c = null;
  let members = null;
  const me = store.state.me;
  const render = () => {
    disposeEmoji(pane);
    const admin = store.isAdminOf(c);
    const owner = c.owner === me.id;
    const link = admin || c.isPublic ? store.inviteLink(c) : "";
    pane.replaceChildren(
      h("div", { class: "profile-head", style: { "--a1": "#7D5CFF", "--a2": "#FF5E8A", "--on": "#fff" } },
        iconButton("back", "Назад", () => history.length > 1 ? history.back() : go(`#/chat/${c.id}`), { class: "on-color" }),
        h("div", { class: "profile-hero" }, groupAvatar(c, 132), h("h1", {}, groupTitle(c, 26)), h("p", {}, groupSubtitle(c) + (c.handle ? " · @" + c.handle : "")))),
      h("div", { class: "profile-body" },
        h("div", { class: "quick-actions" },
          h("button", { type: "button", onclick: () => go(`#/chat/${c.id}`) }, icon("chat"), c.type === "channel" ? "Читать" : "Написать"),
          link ? h("button", { type: "button", onclick: async () => { try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована"); } catch (_) { toast(link, 8000); } } }, icon("link"), "Ссылка") : null,
          admin && !c.isPublic ? h("button", { type: "button", onclick: addPeople }, icon("personadd"), "Добавить") : null),
        c.about ? h("section", { class: "section" }, h("h3", {}, "Описание"), h("div", { class: "card pad" }, c.about)) : null,
        admin ? h("section", { class: "section" }, h("h3", {}, "Настройки"), h("div", { class: "card" },
          h("button", { type: "button", class: "row-item", onclick: edit }, icon("edit"), h("span", {}, h("b", {}, "Название и описание"))),
          !c.isPublic ? h("button", { type: "button", class: "row-item", onclick: async () => { try { c = await store.newInvite(c.id); render(); toast("Старая ссылка больше не работает"); } catch (e) { toast(e.message); } } },
            icon("link"), h("span", {}, h("b", {}, "Новая ссылка-приглашение"), h("small", {}, "Старая перестанет работать"))) : null)) : null,
        members ? h("section", { class: "section" }, h("h3", {}, c.type === "channel" ? `Подписчики (${members.length})` : `Участники (${members.length})`),
          h("div", { class: "card" }, members.map((m) => memberRow(m, admin, owner)))) : null,
        h("section", { class: "section" }, h("div", { class: "card" },
          c.joined ? h("button", { type: "button", class: "row-item danger", onclick: leave }, icon("logout"), h("span", {}, h("b", {}, c.type === "channel" ? "Отписаться" : "Выйти из группы"))) : null,
          owner ? h("button", { type: "button", class: "row-item danger", onclick: remove }, icon("delete_forever"), h("span", {}, h("b", {}, c.type === "channel" ? "Удалить канал" : "Удалить группу"), h("small", {}, "Для всех, вместе с сообщениями"))) : null))));
  };
  const memberRow = (m, admin, owner) => {
    const role = m.owner ? "владелец" : m.admin ? "админ" : "";
    const canManage = m.id !== me.id && !m.owner && (owner || (admin && !m.admin));
    return h("div", { class: "member-row" }, avatar(m, 40),
      h("button", { type: "button", class: "grow link-like", onclick: () => go(`#/user/${m.id}`) }, nameWithStatus(m, 16), h("small", {}, "@" + m.username + (m.hasKey ? "" : " · ждёт ключ"))),
      role ? h("span", { class: "role-chip" }, role) : null,
      canManage ? iconButton("more", "Действия", (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        popupMenu(r.right - 220, r.bottom, [
          owner ? { icon: "shield", label: m.admin ? "Снять с админов" : "Сделать админом", onclick: async () => { try { await store.setAdmin(c.id, m.id, !m.admin); await load(); } catch (x) { toast(x.message); } } } : null,
          { icon: "block", label: "Исключить", danger: true, onclick: async () => { try { c = await store.removeMember(c.id, m.id); await load(); toast("Исключён. Ключ шифрования сменили."); } catch (x) { toast(x.message); } } },
        ].filter(Boolean));
      }) : null);
  };
  async function addPeople() {
    const already = new Set((members || []).map((m) => m.id));
    const chosen = new Set();
    const list = contacts().filter((u) => !already.has(u.id));
    modal("Добавить участников", pickPeople(list, chosen), [
      { label: "Отмена" },
      { label: "Добавить", primary: true, onclick: async (close) => {
        if (!chosen.size) { close(); return; }
        try { await store.addMembers(c.id, [...chosen]); close(); await load(); toast("Добавлены"); } catch (e) { toast(e.message); }
      } },
    ]);
  }
  function edit() {
    const t = h("input", { class: "input", value: c.title, maxlength: 64, "aria-label": "Название" });
    const a = h("textarea", { class: "input", rows: 3, maxlength: 255, "aria-label": "Описание" }, c.about || "");
    modal("Название и описание", h("div", { class: "form" }, t, a), [
      { label: "Отмена" },
      { label: "Сохранить", primary: true, onclick: async (close) => { try { c = await store.updateGroup(c.id, { title: t.value.trim(), about: a.value.trim() }); close(); await load(); } catch (e) { toast(e.message); } } },
    ]);
  }
  function leave() {
    modal(c.type === "channel" ? "Отписаться от канала?" : "Выйти из группы?", h("p", {}, "Вернуться можно будет по ссылке-приглашению."), [
      { label: "Отмена" },
      { label: c.type === "channel" ? "Отписаться" : "Выйти", danger: true, onclick: async (close) => { close(); try { await store.leaveGroup(c.id); go("#/"); } catch (e) { toast(e.message); } } },
    ]);
  }
  function remove() {
    modal("Удалить совсем?", h("p", {}, "Группа и все сообщения исчезнут у всех участников. Вернуть нельзя."), [
      { label: "Отмена" },
      { label: "Удалить", danger: true, onclick: async (close) => { close(); try { await store.deleteGroup(c.id); go("#/"); } catch (e) { toast(e.message); } } },
    ]);
  }
  async function load() {
    c = await store.reloadChat(chatId);
    await store.ensureGroupKey(c).catch(() => {});
    members = c.type === "group" || store.isAdminOf(c) ? (await store.groupMembers(chatId).catch(() => ({ members: null }))).members : null;
    if (members) members.forEach((m) => store.state.users.set(m.id, { ...(store.state.users.get(m.id) || {}), ...m }));
    render();
  }
  root.replaceChildren(pane);
  load().catch((e) => pane.replaceChildren(h("p", { class: "form-error pad" }, e.message)));
  return () => disposeEmoji(pane);
}

/** Вступить по ссылке: #/join/КОД/ЭПОХА.КЛЮЧ */
export function joinView(root, { code, key, go }) {
  const box = h("div", { class: "join-card" }, h("p", { class: "muted" }, "Открываем приглашение…"));
  root.replaceChildren(h("section", { class: "profile-pane" }, box));
  const [epoch, k] = String(key || "").split(".");
  (async () => {
    try {
      const p = await store.invitePreview(code);
      if (p.joined) { go(`#/chat/${p.id}`); return; }
      const btn = h("button", { type: "button", class: "btn btn-primary wide-btn" }, p.type === "channel" ? "Подписаться" : "Вступить в группу");
      btn.onclick = async () => {
        btn.disabled = true;
        try { const c = await store.joinByInvite(code, epoch, k); go(`#/chat/${c.id}`); } catch (e) { toast(e.message); btn.disabled = false; }
      };
      box.replaceChildren(...[groupAvatar(p, 110), h("h2", {}, groupTitle(p, 22)), h("p", { class: "muted" }, groupSubtitle(p)),
        p.about ? h("p", {}, p.about) : null,
        k ? h("p", { class: "muted small" }, "🔒 Сообщения зашифрованы, ключ — в самой ссылке.") : null,
        btn, h("button", { type: "button", class: "btn btn-text", onclick: () => go("#/") }, "Не сейчас")].filter(Boolean));
    } catch (e) {
      box.replaceChildren(animoji("1f622", 80), h("h2", {}, "Приглашение не работает"), h("p", { class: "muted" }, e.message),
        h("button", { type: "button", class: "btn btn-text", onclick: () => go("#/") }, "К чатам"));
    }
  })();
  return () => disposeEmoji(root);
}

/** Публичный канал по @имени: #/c/имя */
export function channelLink(root, { handle, go }) {
  root.replaceChildren(h("p", { class: "muted pad" }, "Открываем канал…"));
  store.channelByHandle(handle).then((c) => {
    if (c) go(`#/chat/${c.id}`);
    else root.replaceChildren(h("p", { class: "form-error pad" }, "Канал @" + handle + " не найден"));
  }).catch((e) => root.replaceChildren(h("p", { class: "form-error pad" }, e.message)));
  return () => {};
}
