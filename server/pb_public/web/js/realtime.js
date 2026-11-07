/* Обновления в реальном времени (PocketBase realtime, SSE): новые сообщения, «прочитано», чаты, звонки. */
import { api, url } from "./api.js";
import * as store from "./store.js";

let source = null;
let clientId = "";
const BASE_TOPICS = ["messages", "chat_state", "chats", "call_signals"];
const topics = () => [...BASE_TOPICS, ...store.peerIds().map((id) => "users/" + id)];
let lastTopics = "";

/** Подписаться на «в сети» новых собеседников (после обновления списка чатов). */
export async function resubscribe() {
  if (!clientId) return;
  const t = topics();
  if (t.join() === lastTopics) return;
  lastTopics = t.join();
  try { await api("POST", "api/realtime", { body: { clientId, subscriptions: t } }); } catch (_) { lastTopics = ""; }
}
let retryTimer = null;

export function start() {
  stop();
  source = new EventSource(url("api/realtime"));
  source.addEventListener("PB_CONNECT", async (e) => {
    try {
      clientId = JSON.parse(e.data).clientId;
      lastTopics = "";
      await resubscribe();
      store.emit("online", true);
      // пока не было связи, могли прийти сообщения
      store.refreshChats().catch(() => {});
      if (store.state.openChatId) store.loadMessages(store.state.openChatId).catch(() => {});
    } catch (_) { /* переподключимся */ }
  });
  source.addEventListener("messages", async (e) => {
    const { action, record } = JSON.parse(e.data);
    if (action === "delete") store.removeMessage(record.chat, record.id);
    else {
      const msg = await store.applyRecord(record);
      if (msg && action === "create") store.emit("new-message", msg);
    }
  });
  source.addEventListener("chat_state", (e) => store.applyState(JSON.parse(e.data).record));
  source.addEventListener("chats", () => store.refreshChats().catch(() => {}));
  // «В сети» собеседников: подписка на каждого (users/<id>), событие называется так же.
  source.onmessage = null;
  const onUser = (e) => { try { store.applyUser(JSON.parse(e.data).record); store.emit("users"); store.emit("chats"); } catch (_) { /* ignore */ } };
  store.peerIds().forEach((id) => source.addEventListener("users/" + id, onUser));
  userListener = onUser;
  source.addEventListener("call_signals", (e) => {
    const { action, record } = JSON.parse(e.data);
    if (action === "create") store.emit("signal", record);
  });
  source.onerror = () => {
    store.emit("online", false);
    // EventSource переподключается сам; если закрылся совсем — пробуем через 5 секунд
    if (source && source.readyState === EventSource.CLOSED) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(start, 5000);
    }
  };
}

/** Соединение живо? Если нет (телефон усыплял страницу, пропадал интернет) — подключиться заново. */
export function ensure() {
  if (!source || source.readyState === EventSource.CLOSED) start();
}

/** Принудительно переподключиться (после возвращения из фона соединение может «висеть», не сообщая об ошибке). */
export const restart = () => start();

let userListener = null;
// Новые собеседники — слушаем и их события.
store.on("chats", () => {
  if (!source || !userListener) return;
  store.peerIds().forEach((id) => {
    if (!listened.has(id)) { listened.add(id); source.addEventListener("users/" + id, userListener); }
  });
  resubscribe();
});
const listened = new Set();

export function stop() {
  clientId = "";
  lastTopics = "";
  listened.clear();
  clearTimeout(retryTimer);
  if (source) source.close();
  source = null;
}
