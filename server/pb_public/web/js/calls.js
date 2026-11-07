/* Звонки и уведомления в веб-версии: окно звонка, входящий звонок, запись о звонке в чате, уведомления Windows. */
import * as store from "./store.js";
import { h, icon, avatar, titleOf, toast } from "./ui.js";
import { preview } from "./views/chats.js";
import { avatarUrl } from "./api.js";

let callWin = null;

/** Показать окно: в приложении для Windows — достать из трея. */
export function showWindow() {
  try { if (window.beemesDesktop) window.beemesDesktop.show(); } catch (_) { /* ignore */ }
  window.focus();
}

function openCallWindow(url) {
  if (callWin && !callWin.closed) { callWin.focus(); toast("Звонок уже идёт"); return; }
  callWin = window.open(url, "beemes-call", "width=460,height=800");
  if (!callWin) toast("Разрешите всплывающие окна для этого сайта, чтобы звонить");
}

export const startCall = (chatId, video) => openCallWindow(store.callUrl(chatId, video));

// Страница звонка сообщает, что звонок закончился, — звонивший оставляет в чате запись (зашифрованную).
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (d && d.type === "beemes-call-ended" && d.chat) store.sendCallLog(d.chat, d.video, d.seconds, d.status);
});

// ---------- Входящий звонок ----------
let ringing = null;

function ringtone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume().catch(() => {});
    const beep = (t, f) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.4);
    };
    const ring = () => { beep(0, 880); beep(0.45, 660); beep(0.9, 880); };
    ring();
    const t = setInterval(ring, 3000);
    return () => { clearInterval(t); ctx.close().catch(() => {}); };
  } catch (_) {
    return () => {};
  }
}

async function showIncoming(call) {
  if (ringing && ringing.id === call.id) return;
  hideIncoming();
  const caller = await store.user(call.from).catch(() => ({ id: call.from, name: call.name }));
  const stop = ringtone();
  const answer = () => { hideIncoming(); openCallWindow(store.callUrl(call.chat, call.video, call.id)); };
  const decline = () => { hideIncoming(); store.declineCall(call.chat, call.id, call.from); };
  const overlay = h("div", { class: "incoming", role: "alertdialog", "aria-label": `Входящий звонок: ${titleOf(caller)}` },
    h("div", { class: "incoming-card" },
      h("div", { class: "incoming-pulse" }, avatar(caller, 120)),
      h("h2", {}, titleOf(caller)),
      h("p", {}, call.video ? "Видеозвонок в beemes…" : "Звонок в beemes…"),
      h("div", { class: "incoming-actions" },
        h("button", { type: "button", class: "round-btn decline", "aria-label": "Отклонить", onclick: decline }, icon("phone", 30)),
        h("button", { type: "button", class: "round-btn answer", "aria-label": "Ответить", onclick: answer }, icon(call.video ? "video" : "phone", 30)))));
  document.body.append(overlay);
  if (window.beemesDesktop) showWindow(); // на компьютере звонок поднимает окно из трея, как телефон
  overlay.querySelector(".answer").focus();
  const timer = setTimeout(hideIncoming, 45000);
  ringing = { id: call.id, overlay, stop, timer };
  if (document.hidden || !document.hasFocus()) notify(titleOf(caller), call.video ? "📹 Видеозвонок — нажмите, чтобы ответить" : "📞 Звонок — нажмите, чтобы ответить", "call-" + call.id, null, caller, true);
}

function hideIncoming() {
  if (!ringing) return;
  ringing.stop();
  clearTimeout(ringing.timer);
  ringing.overlay.remove();
  ringing = null;
}

store.on("signal", (s) => {
  const me = store.state.me;
  if (!me) return;
  if (s.type === "ring" && s.to === me.id) {
    showIncoming({ id: s.call, chat: s.chat, from: s.from, video: !!(s.data && s.data.video), name: (s.data && s.data.name) || "" });
  } else if (ringing && ringing.id === s.call && ["accept", "decline", "hangup", "busy"].includes(s.type)) hideIncoming();
});

/** Сразу после входа: вдруг уже звонят. */
export async function checkIncoming() {
  const call = await store.incoming();
  if (call) showIncoming({ id: call.id, chat: call.chat, from: call.from, video: call.video, name: call.name });
}

// ---------- Уведомления ----------
export const canNotify = () => "Notification" in window;
export async function askNotify() {
  if (!canNotify()) return "unsupported";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

function notify(title, body, tag, chatId, user, sticky = false) {
  if (!canNotify() || Notification.permission !== "granted" || !store.notifyOn.get()) return;
  // На iPhone (с экрана «Домой») уведомление может показать только помощник в фоне — через него же
  // нажатие откроет нужный чат.
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, tag, icon: "../img/icon-192.png", requireInteraction: sticky, data: { chat: chatId || "" } })).catch(() => {});
    return;
  }
  try {
    const n = new Notification(title, { body, tag, icon: avatarUrl(user) || "../img/logo.svg", requireInteraction: sticky, silent: false });
    n.onclick = () => { showWindow(); if (chatId) location.hash = `#/chat/${chatId}`; n.close(); };
  } catch (_) { /* не поддерживается */ }
}

// ---------- Звук нового сообщения ----------
// Браузеры (особенно на iPhone) разрешают звук только после первого касания страницы — «будим» звук на нём.
let audio = null;
function unlockAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume().catch(() => {});
  } catch (_) { /* без звука */ }
}
["pointerdown", "keydown", "touchend"].forEach((ev) => window.addEventListener(ev, unlockAudio, { passive: true, capture: true }));

/** Короткий «медовый» сигнал: две ноты вверх. quiet — тише (сообщение в открытом чате). */
export function messageSound(quiet = false) {
  if (!store.soundOn.get() || !audio || audio.state !== "running") return;
  const t = audio.currentTime;
  [[0, 784], [0.11, 1175]].forEach(([dt, f]) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + dt);
    g.gain.exponentialRampToValueAtTime(quiet ? 0.05 : 0.14, t + dt + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.22);
    o.connect(g).connect(audio.destination);
    o.start(t + dt);
    o.stop(t + dt + 0.25);
  });
}

store.on("new-message", (msg) => {
  const me = store.state.me;
  if (!me || msg.senderId === me.id) return;
  const item = store.chatItem(msg.chatId);
  if (item && item.muted) return;
  const looking = !document.hidden && document.hasFocus() && store.state.openChatId === msg.chatId;
  messageSound(looking);
  if (looking) return;
  const sender = store.state.users.get(msg.senderId) || (item && item.peer);
  notify(titleOf(sender), preview(msg, me.id), "chat-" + msg.chatId, msg.chatId, sender);
});

