/* Профиль собеседника и код безопасности. */
import { h, icon, iconButton, avatar, nameWithStatus, lastSeenText, isOnline, accentOf, accentVars, withPattern, animoji, modal, toast, titleOf, disposeEmoji } from "../ui.js";
import * as store from "../store.js";
import * as C from "../crypto.js";
import { startCall } from "../calls.js";

export function peerProfile(root, { userId, go }) {
  let u = store.state.users.get(userId) || { id: userId };
  let isBlocked = false;
  const pane = h("section", { class: "profile-pane" });
  const withChat = async (fn) => {
    try { fn((await store.chatWith(userId)).id); } catch (e) { toast(e.message); }
  };
  const render = () => {
    disposeEmoji(pane);
    const acc = accentOf(u);
    pane.replaceChildren(
      h("div", { class: "profile-head", style: accentVars(acc) },
        iconButton("back", "Назад", () => history.length > 1 ? history.back() : go("#/"), { class: "on-color" }),
        h("div", { class: "profile-hero" }, withPattern(avatar(u, 132), u.bgEmoji), h("h1", {}, nameWithStatus(u, 30)),
          h("p", {}, u.username ? "@" + u.username : "", u.username ? " · " : "", h("span", { class: isOnline(u) ? "online" : "" }, lastSeenText(u))))),
      h("div", { class: "profile-body" },
        h("div", { class: "quick-actions" },
          h("button", { type: "button", onclick: () => withChat((id) => go(`#/chat/${id}`)) }, icon("chat"), "Написать"),
          h("button", { type: "button", onclick: () => withChat((id) => startCall(id, false)) }, icon("phone"), "Звонок"),
          h("button", { type: "button", onclick: () => withChat((id) => startCall(id, true)) }, icon("video"), "Видео")),
        u.bio ? h("section", { class: "section" }, h("h3", {}, "О себе"), h("div", { class: "card pad" }, u.bio)) : null,
        h("section", { class: "section" }, h("h3", {}, "Безопасность"),
          h("div", { class: "card" },
            h("button", { type: "button", class: "row-item", onclick: () => withChat((id) => go(`#/safety/${id}`)) },
              icon("shield"), h("span", {}, h("b", {}, "Код безопасности"), h("small", {}, "Сравните с собеседником, чтобы убедиться в шифровании"))),
            h("button", { type: "button", class: "row-item danger", onclick: toggleBlock },
              icon("block"), h("span", {}, h("b", {}, isBlocked ? "Разблокировать" : "Заблокировать"), isBlocked ? h("small", {}, "Этот человек не может вам писать и звонить") : null))))));
  };
  async function toggleBlock() {
    if (isBlocked) {
      try { await store.unblock(userId); isBlocked = false; render(); toast("Разблокирован"); } catch (e) { toast(e.message); }
      return;
    }
    modal(`Заблокировать ${titleOf(u)}?`, h("p", {}, "Он не сможет писать и звонить вам. Разблокировать можно в любой момент."), [
      { label: "Отмена" },
      { label: "Заблокировать", danger: true, onclick: async (close) => { close(); try { await store.block(userId); isBlocked = true; render(); } catch (e) { toast(e.message); } } },
    ]);
  }
  root.replaceChildren(pane);
  render();
  (async () => {
    try {
      u = await store.user(userId, true);
      isBlocked = (await store.blocked()).some((b) => b.blocked === userId);
      render();
    } catch (e) { pane.replaceChildren(h("p", { class: "form-error pad" }, e.message)); }
  })();
  return () => disposeEmoji(pane);
}

export function safety(root, { chatId, go }) {
  const pane = h("section", { class: "profile-pane safety" },
    h("header", { class: "pane-header" }, iconButton("back", "Назад", () => history.back()), h("h2", {}, "Код безопасности")));
  root.replaceChildren(pane);
  (async () => {
    try {
      const c = await store.chat(chatId);
      const peer = await store.user(store.peerOf(c), true);
      const code = await C.safetyCode(C.unb64(store.state.me.publicKey), C.unb64(peer.publicKey));
      pane.append(h("div", { class: "safety-body" }, animoji("1f512", 96),
        h("div", { class: "safety-code", "aria-label": "Код: " + code.join(" ") }, code.map((g) => h("span", {}, g))),
        h("p", { class: "muted" }, `У собеседника (${titleOf(peer)}) в профиле с вами должны быть те же цифры. Сравните их при встрече или по видеозвонку. ` +
          "Если они совпадают — сообщения точно шифруются для вас двоих и никто не подменил ключи.")));
    } catch (e) { pane.append(h("p", { class: "form-error pad" }, e.message)); }
  })();
  return () => disposeEmoji(pane);
}
