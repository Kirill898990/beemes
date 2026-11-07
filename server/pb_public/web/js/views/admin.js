/* Админ-панель: выдать или снять галочку человеку и каналу. Видна только админу (users.admin в панели PocketBase). */
import { h, iconButton, avatar, nameWithStatus, groupAvatar, groupTitle, groupSubtitle, toast, disposeEmoji } from "../ui.js";
import * as store from "../store.js";

export function admin(root, { go }) {
  let kind = "users";
  let seq = 0;
  let timer = null;
  const list = h("div", { class: "card" });
  const hint = h("p", { class: "muted small" });
  const search = h("input", { class: "input", type: "search", "aria-label": "Поиск" });
  const tabs = h("div", { class: "segmented admin-tabs", role: "radiogroup", "aria-label": "Кому" },
    [["users", "Люди"], ["chats", "Каналы и группы"]].map(([k, label]) =>
      h("button", { type: "button", role: "radio", "aria-checked": k === kind ? "true" : "false", onclick: (e) => {
        kind = k;
        tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b === e.currentTarget ? "true" : "false"));
        load();
      } }, label)));

  const row = (it) => {
    const sw = h("input", { type: "checkbox", class: "switch", checked: !!it.badge, "aria-label": "Галочка" });
    sw.onchange = async () => {
      sw.disabled = true;
      try {
        const r = await store.adminBadge(it.kind, it.id, sw.checked);
        it.badge = r.badge;
        toast(r.badge ? "Галочка выдана" : "Галочка снята");
        render(last);
      } catch (e) { sw.checked = !sw.checked; toast(e.message); }
      sw.disabled = false;
    };
    const who = it.kind === "user"
      ? [avatar(it, 44), h("span", { class: "grow" }, nameWithStatus(it, 18), h("small", {}, "@" + it.username))]
      : [groupAvatar(it, 44), h("span", { class: "grow" }, groupTitle(it, 16),
        h("small", {}, [it.handle ? "@" + it.handle : (it.isPublic ? "" : "приватный"), groupSubtitle(it)].filter(Boolean).join(" · ")))];
    return h("label", { class: "admin-row" }, ...who, sw);
  };

  let last = [];
  const render = (items) => {
    last = items;
    disposeEmoji(list);
    list.replaceChildren(...(items.length ? items.map(row)
      : [h("p", { class: "muted pad" }, search.value.trim() ? "Ничего не нашлось" : kind === "users" ? "Галочек у людей пока нет" : "Галочек у каналов пока нет")]));
  };

  const load = async () => {
    const my = ++seq;
    const q = search.value.trim();
    search.placeholder = kind === "users" ? "@имя или имя" : "Название или @имя канала";
    hint.textContent = q ? "" : kind === "users" ? "Люди с галочкой. Найдите человека, чтобы выдать." : "Каналы и группы с галочкой. Найдите канал, чтобы выдать.";
    try {
      const items = await store.adminSearch(kind, q);
      if (my === seq) render(items);
    } catch (e) { if (my === seq) list.replaceChildren(h("p", { class: "form-error pad" }, e.message)); }
  };
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };

  root.replaceChildren(h("section", { class: "profile-pane" },
    h("header", { class: "pane-header" }, iconButton("back", "Назад", () => go("#/settings"), { class: "only-narrow" }), h("h2", {}, "Админ-панель")),
    h("div", { class: "profile-body" },
      h("p", { class: "muted" }, "Галочка ✓ рядом с именем — знак, что аккаунт или канал настоящий. Видна всем."),
      tabs, search, hint, list)));
  load();
  return () => { clearTimeout(timer); disposeEmoji(list); };
}
