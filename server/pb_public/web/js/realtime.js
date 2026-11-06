/* Обновления в реальном времени (PocketBase realtime, SSE): новые сообщения, «прочитано», чаты, звонки. */
import { api, url } from "./api.js";
import * as store from "./store.js";

let source = null;
let retryTimer = null;

export function start() {
  stop();
  source = new EventSource(url("api/realtime"));
  source.addEventListener("PB_CONNECT", async (e) => {
    try {
      const { clientId } = JSON.parse(e.data);
      await api("POST", "api/realtime", { body: { clientId, subscriptions: ["messages", "chat_state", "chats", "call_signals"] } });
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

export function stop() {
  clearTimeout(retryTimer);
  if (source) source.close();
  source = null;
}
