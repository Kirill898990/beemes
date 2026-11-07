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
  try {
    // Своя подписка сервера beemes: обычная (api/realtime) отказывает, если адрес сменился (мобильный интернет, HTTP/3).
    await api("POST", "api/bm/realtime", { body: { clientId, subscriptions: t } })
      // 404 — старый сервер без этой подписки
      .catch((e) => (e.status === 404 ? api("POST", "api/realtime", { body: { clientId, subscriptions: t } }) : Promise.reject(e)));
    subscribeFails = 0;
  } catch (_) {
    // Без подписки соединение открыто, но события не идут — повторяем, а после трёх неудач подключаемся заново.
    lastTopics = "";
    clearTimeout(subscribeTimer);
    if (++subscribeFails >= 3) { subscribeFails = 0; start(); } else subscribeTimer = setTimeout(resubscribe, 2000 * subscribeFails);
  }
}
let subscribeFails = 0;
let subscribeTimer = null;
let retryTimer = null;
/** Когда соединение последний раз подавало признаки жизни. PocketBase сам закрывает тихое соединение через 5 минут. */
let aliveAt = 0;
const alive = () => { aliveAt = Date.now(); };

export function start() {
  stop();
  source = new EventSource(url("api/realtime"));
  alive();
  source.onopen = alive;
  source.addEventListener("PB_CONNECT", async (e) => {
    alive();
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
    alive();
    const { action, record } = JSON.parse(e.data);
    if (action === "delete") store.removeMessage(record.chat, record.id);
    else {
      const msg = await store.applyRecord(record);
      if (msg && action === "create") store.emit("new-message", msg);
    }
  });
  source.addEventListener("chat_state", (e) => { alive(); store.applyState(JSON.parse(e.data).record); });
  source.addEventListener("chats", () => { alive(); store.refreshChats().catch(() => {}); });
  // «В сети» собеседников: подписка на каждого (users/<id>), событие называется так же.
  source.onmessage = null;
  const onUser = (e) => { alive(); try { store.applyUser(JSON.parse(e.data).record); store.emit("users"); store.emit("chats"); } catch (_) { /* ignore */ } };
  store.peerIds().forEach((id) => source.addEventListener("users/" + id, onUser));
  userListener = onUser;
  source.addEventListener("call_signals", (e) => {
    alive();
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

// Связь «зависла» молча (дольше 5,5 минуты ни событий, ни переподключения) — подключаемся заново.
setInterval(() => { if (source && Date.now() - aliveAt > 330000) start(); }, 30000);
// Интернет вернулся (или сменилась сеть) — не ждём, пока браузер заметит сам.
window.addEventListener("online", () => { if (source) start(); });

export function stop() {
  clientId = "";
  lastTopics = "";
  listened.clear();
  clearTimeout(retryTimer);
  clearTimeout(subscribeTimer);
  if (source) source.close();
  source = null;
}
