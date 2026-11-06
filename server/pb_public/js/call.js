/*
 * Звонок в beemes: голосом или с видео (WebRTC). Страницу открывает приложение в своём окне.
 *
 * Адрес: call.html#chat=<чат>&video=1                 — позвонить;
 *        call.html#chat=<чат>&call=<id>&answer=1      — ответить на звонок.
 * Приложение добавляет &app=1&token=<вход>.
 *
 * Как устроено: телефоны обмениваются служебными сообщениями через сервер (коллекция call_signals):
 * ring → accept → offer → answer → … → hangup. Голос и видео идут напрямую и шифруются (DTLS-SRTP),
 * а если напрямую не получается — через TURN-сервер на нашем же сервере (/api/bm/ice).
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  const inApp = params.get("app") === "1";
  const chatId = String(params.get("chat") || "").replace(/[^a-z0-9]/gi, "");
  const answering = params.get("answer") === "1";
  const wantVideo = params.get("video") === "1";
  let callId = String(params.get("call") || "").replace(/[^a-z0-9]/gi, "");
  const bridge = window.BeemesCall;

  const serverUrl = () => (location.protocol === "http:" || location.protocol === "https:") ? location.origin : "http://127.0.0.1:8091";

  // Вход передаёт приложение (в адресе). Из адреса его сразу убираем.
  let token = params.get("token") || "";
  if (token) {
    params.delete("token");
    history.replaceState(null, "", location.pathname + "#" + params.toString());
    try { sessionStorage.setItem("callToken", token); } catch (_) { /* ignore */ }
  } else {
    try { token = sessionStorage.getItem("callToken") || ""; } catch (_) { /* ignore */ }
  }

  async function api(method, path, body, keepalive = false) {
    let res;
    try {
      res = await fetch(serverUrl() + "/" + path, {
        method,
        keepalive,
        headers: { "Content-Type": "application/json", Authorization: token },
        body: body ? JSON.stringify(body) : method === "POST" ? "{}" : undefined,
      });
    } catch (_) {
      throw new Error("Нет связи с сервером. Проверьте интернет.");
    }
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { /* не JSON */ }
    if (!res.ok) {
      const msg = String(data.message || "");
      const err = new Error(/[а-яё]/i.test(msg) ? msg : res.status === 401 ? "Войдите в приложение заново" : "Звонок сейчас недоступен. Попробуйте позже.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let me = null;
  let chat = null;
  let peer = "";
  let pc = null;
  let stream = null;
  let facing = "user";
  let ended = false;
  let connected = false;
  let accepted = answering;
  let ringing = false;
  let startedAt = 0;
  const seen = new Set();
  const timers = {};
  let stopTone = () => {};
  let wakeLock = null;

  const setStatus = (text) => { $("status").textContent = text; };
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  const seconds = () => Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const duration = () => { const s = seconds(); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  function send(type, data = {}) {
    return api("POST", "api/collections/call_signals/records",
      { call: callId, from: me.id, to: peer, chat: chat.id, type, data }, type === "hangup");
  }

  /** Гудки, пока ждём ответа: 425 Гц, секунда звука и четыре тишины. */
  function ringback() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume().catch(() => {});
      const beep = () => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 425;
        gain.gain.value = 0.08;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1);
      };
      beep();
      const t = setInterval(beep, 5000);
      return () => { clearInterval(t); ctx.close().catch(() => {}); };
    } catch (_) {
      return () => {};
    }
  }

  function mediaError(e) {
    const name = e && e.name;
    const what = "микрофону" + (wantVideo ? " и камере" : "");
    if (name === "NotAllowedError" || name === "SecurityError") return `Нет доступа к ${what}. Разрешите его beemes в настройках телефона.`;
    if (name === "NotFoundError" || name === "OverconstrainedError") return wantVideo ? "Не нашли камеру или микрофон." : "Не нашли микрофон.";
    if (name === "NotReadableError") return "Микрофон или камера заняты другим приложением. Закройте его и попробуйте ещё раз.";
    return "Не получилось включить микрофон" + (wantVideo ? " и камеру" : "") + ".";
  }

  /**
   * Конец звонка. Звонивший оставляет в чате запись о звонке: приложение шифрует её, как обычное сообщение.
   * outcome: done — поговорили, declined — отклонили, missed — не ответили или отменили.
   */
  function finish(text, canRetry, outcome) {
    if (ended) return;
    ended = true;
    Object.values(timers).forEach((t) => { clearTimeout(t); clearInterval(t); });
    stopTone();
    if (pc) pc.close();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (wakeLock) wakeLock.release().catch(() => {});
    $("remote").srcObject = null;
    $("local").hidden = true;
    document.body.classList.remove("has-video");
    document.body.classList.add("ended");
    setStatus(text);
    $("lock").hidden = true;
    $("bar").hidden = true;
    $("end").hidden = false;
    $("retry").hidden = !canRetry || !chat;
    if (!answering && ringing && bridge && bridge.ended) {
      const status = connected ? "done" : outcome === "declined" ? "declined" : "missed";
      try { bridge.ended(wantVideo, connected ? seconds() : 0, status); } catch (_) { /* ignore */ }
    }
  }

  function hangup() {
    if (ended) return;
    if (callId && me && chat) send("hangup").catch(() => {});
    finish(connected ? `Звонок завершён · ${duration()}` : "Звонок отменён", true);
  }

  async function handle(s) {
    const data = s.data || {};
    if (s.type === "accept" && !answering && !accepted) {
      accepted = true;
      stopTone();
      clearTimeout(timers.noAnswer);
      setStatus("Соединяемся…");
      await pc.setLocalDescription(await pc.createOffer());
      await gathered();
      await send("offer", { sdp: pc.localDescription.sdp });
    } else if (s.type === "offer" && answering && data.sdp) {
      await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered();
      await send("answer", { sdp: pc.localDescription.sdp });
    } else if (s.type === "answer" && !answering && data.sdp && pc.signalingState === "have-local-offer") {
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
    } else if (s.type === "decline") {
      finish("Звонок отклонён", true, "declined");
    } else if (s.type === "busy") {
      finish("Сейчас занято. Попробуйте позже.", true);
    } else if (s.type === "hangup") {
      finish(connected ? `Звонок завершён · ${duration()}` : answering ? "Звонок уже завершён" : "Звонок отменён", !answering || connected);
    }
  }

  /** Ждём, пока соберутся адреса для соединения (но не дольше 3 секунд). */
  function gathered() {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const t = setTimeout(resolve, 3000);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") { clearTimeout(t); resolve(); }
      });
    });
  }

  async function poll() {
    if (ended) return;
    try {
      const q = new URLSearchParams({ filter: `call = "${callId}" && to = "${me.id}"`, sort: "created", perPage: "100" });
      const r = await api("GET", "api/collections/call_signals/records?" + q);
      for (const s of r.items || []) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        await handle(s);
        if (ended) return;
      }
    } catch (_) { /* нет связи — попробуем ещё раз */ }
    if (!ended) timers.poll = setTimeout(poll, connected ? 3000 : 1000);
  }

  function onConnectionState() {
    const st = pc.connectionState;
    if (st === "connected") {
      clearTimeout(timers.lost);
      if (!connected) {
        connected = true;
        startedAt = Date.now();
        timers.tick = setInterval(() => setStatus(duration()), 1000);
        setStatus("0:00");
        $("lock").hidden = false;
        playRemote();
        // Телефон, начиная разговор, может переключить звук в разговорный динамик — включаем громкую связь ещё раз.
        if (inApp && bridge && bridge.reapplySpeaker) {
          bridge.reapplySpeaker();
          setTimeout(() => { if (!ended) bridge.reapplySpeaker(); }, 1500);
        }
        watchSound();
      }
    } else if (st === "disconnected" && connected) {
      setStatus("Плохая связь… переподключаемся");
      clearTimeout(timers.lost);
      timers.lost = setTimeout(() => { send("hangup").catch(() => {}); finish("Связь прервалась", true); }, 15000);
    } else if (st === "failed") {
      send("hangup").catch(() => {});
      finish(connected ? "Связь прервалась" : "Не получилось соединиться. Проверьте интернет и попробуйте ещё раз.", true);
    }
  }

  function showRemote(e) {
    const video = $("remote");
    if (video.srcObject !== e.streams[0]) video.srcObject = e.streams[0];
    if (e.track.kind === "video") document.body.classList.add("has-video");
    playRemote();
  }

  /** Включить звук собеседника. Если не дали сделать это сразу — просим нажать на экран. */
  function playRemote() {
    const video = $("remote");
    if (!video.srcObject) return;
    video.muted = false;
    video.volume = 1;
    video.play().then(() => {
      const btn = document.querySelector(".call-unmute");
      if (btn) btn.remove();
    }, () => {
      if (document.querySelector(".call-unmute")) return;
      const btn = document.createElement("button");
      btn.className = "call-pill call-unmute";
      btn.textContent = "🔈 Нажмите, чтобы включить звук";
      btn.onclick = () => playRemote();
      $("call").append(btn);
    });
  }

  /** Индикаторы звука «Вы» и «Собеседник» и подсказка, если звук собеседника не доходит. */
  function watchSound() {
    $("meters").hidden = false;
    let lastEnergy = 0;
    let lastPackets = 0;
    let silentFor = 0;
    let noPacketsFor = 0;
    timers.sound = setInterval(async () => {
      if (ended || !pc) return;
      let mine = 0;
      let theirs = 0;
      let packets = 0;
      let energy = 0;
      try {
        (await pc.getStats()).forEach((r) => {
          if (r.type === "media-source" && r.kind === "audio" && typeof r.audioLevel === "number") mine = r.audioLevel;
          if (r.type === "inbound-rtp" && r.kind === "audio") {
            packets = r.packetsReceived || 0;
            energy = r.totalAudioEnergy || 0;
            if (typeof r.audioLevel === "number") theirs = r.audioLevel;
          }
        });
      } catch (_) { return; }
      const micOff = stream && stream.getAudioTracks().every((t) => !t.enabled);
      setMeter($("meter-me"), micOff ? 0 : mine);
      setMeter($("meter-them"), theirs);
      noPacketsFor = packets > lastPackets ? 0 : noPacketsFor + 1;
      silentFor = energy - lastEnergy > 0.00001 ? 0 : silentFor + 1;
      lastPackets = packets;
      lastEnergy = energy;
      const hint = $("sound-hint");
      if (noPacketsFor >= 5) hint.textContent = "Звук от собеседника не доходит. Попросите его проверить интернет.";
      else if (silentFor >= 8) hint.textContent = "Собеседника не слышно: возможно, у него выключен микрофон.";
      else hint.textContent = "";
    }, 1000);
  }

  function setMeter(el, level) {
    const bars = Math.min(5, Math.round(Math.sqrt(Math.max(0, level)) * 9));
    el.querySelectorAll("i").forEach((b, i) => b.classList.toggle("on", i < bars));
  }

  function toggle(kind, btn, onText, offText) {
    const tracks = stream ? (kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks()) : [];
    if (!tracks.length) return;
    const on = !tracks[0].enabled;
    tracks.forEach((t) => { t.enabled = on; });
    btn.classList.toggle("off", !on);
    btn.setAttribute("aria-pressed", on ? "false" : "true");
    btn.setAttribute("aria-label", on ? onText : offText);
    if (kind === "video") $("local").classList.toggle("off", !on);
  }

  async function flipCamera() {
    if (!stream || !pc) return;
    facing = facing === "user" ? "environment" : "user";
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } });
      const track = fresh.getVideoTracks()[0];
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) await sender.replaceTrack(track);
      stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
      stream.addTrack(track);
      $("local").srcObject = stream;
      $("local").classList.toggle("mirror", facing === "user");
    } catch (_) {
      facing = facing === "user" ? "environment" : "user";
    }
  }

  function showPeer(user) {
    const name = (user && (user.name || (user.username && "@" + user.username))) || "Собеседник";
    $("name").textContent = name;
    $("initial").textContent = Array.from(name)[0].toUpperCase();
    document.title = `${name} · звонок`;
    if (user && user.avatar) {
      const img = new Image();
      img.alt = "";
      img.onload = () => { $("avatar").replaceChildren(img); };
      img.src = `${serverUrl()}/api/files/users/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}?thumb=480x480`;
    }
  }

  async function start() {
    if (!token) return finish("Звонить можно из приложения beemes", false);
    if (!chatId) return finish("Не понятно, кому звонить. Откройте звонок из чата.", false);
    if (!window.RTCPeerConnection || !navigator.mediaDevices) return finish("Здесь не получается позвонить. Обновите приложение Android System WebView.", false);
    try {
      me = (await api("POST", "api/collections/users/auth-refresh")).record;
      chat = await api("GET", `api/collections/chats/records/${chatId}?expand=members`);
    } catch (e) {
      return finish(e.status === 404 ? "Чат не найден" : e.message, false);
    }
    peer = (chat.members || []).find((id) => id !== me.id) || "";
    const other = ((chat.expand && chat.expand.members) || []).find((u) => u.id === peer);
    showPeer(other);
    if (!peer) return finish("В этом чате некому звонить", false);

    setStatus(wantVideo ? "Включаем камеру и микрофон…" : "Включаем микрофон…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: wantVideo ? { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
    } catch (e) {
      if (answering && callId) send("decline").catch(() => {});
      return finish(mediaError(e), true);
    }
    if (wantVideo) {
      $("local").srcObject = stream;
      $("local").hidden = false;
      $("local").classList.add("mirror");
      $("cam").hidden = false;
      navigator.mediaDevices.enumerateDevices().then((list) => {
        if (list.filter((d) => d.kind === "videoinput").length > 1) $("flip").hidden = false;
      }, () => {});
    }
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch (_) { /* не везде есть */ }

    const ice = await api("GET", "api/bm/ice").catch(() => ({ iceServers: [] }));
    pc = new RTCPeerConnection({ iceServers: ice.iceServers || [], iceTransportPolicy: params.get("relay") === "1" ? "relay" : "all" });
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.ontrack = showRemote;
    pc.onconnectionstatechange = onConnectionState;

    try {
      if (answering) {
        await send("accept");
        setStatus("Соединяемся…");
      } else {
        callId = randomId();
        await send("ring", { video: wantVideo });
        ringing = true;
        setStatus("Звоним…");
        document.body.classList.add("ringing");
        stopTone = ringback();
        timers.noAnswer = setTimeout(() => {
          if (!accepted) { send("hangup", { reason: "timeout" }).catch(() => {}); finish("Не отвечает. Попробуйте позвонить позже.", true); }
        }, 45000);
      }
    } catch (e) {
      return finish(e.message, true);
    }
    poll();
  }

  $("hangup").addEventListener("click", hangup);
  // Любое нажатие на экран — ещё одна попытка включить звук.
  document.addEventListener("click", () => { if (connected && !ended) playRemote(); }, true);
  $("mic").addEventListener("click", () => toggle("audio", $("mic"), "Выключить микрофон", "Включить микрофон"));
  $("cam").addEventListener("click", () => toggle("video", $("cam"), "Выключить камеру", "Включить камеру"));
  $("flip").addEventListener("click", flipCamera);
  if (inApp && bridge && bridge.setSpeakerOn) {
    const btn = $("speaker");
    const show = () => {
      const on = !!bridge.isSpeakerOn();
      btn.classList.toggle("off", !on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    };
    btn.hidden = false;
    btn.addEventListener("click", () => { bridge.setSpeakerOn(!bridge.isSpeakerOn()); setTimeout(show, 150); });
    show();
  }
  $("retry").addEventListener("click", () => {
    const next = new URLSearchParams({ chat: chatId });
    if (wantVideo) next.set("video", "1");
    if (inApp) next.set("app", "1");
    location.replace(location.pathname + "#" + next.toString());
    location.reload();
  });
  $("back").addEventListener("click", () => {
    if (inApp && bridge) return bridge.close();
    location.href = "./";
  });
  // Закрыли страницу во время звонка — кладём трубку.
  window.addEventListener("pagehide", () => { if (!ended && callId && me && chat) send("hangup").catch(() => {}); });
  window.BeemesCallPage = { hangup };

  start();
})();
