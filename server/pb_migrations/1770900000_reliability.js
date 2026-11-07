/// <reference path="../pb_data/types.d.ts" />
// Надёжная доставка: лимиты частоты считаются по IP-адресу, а в школьном Wi-Fi и у мобильных операторов
// с одного адреса выходят сотни людей — прежние лимиты (60 сообщений за 10 секунд на адрес) срабатывали
// на всех сразу, и сообщения не отправлялись. Теперь на адрес лимиты щедрые, а от спама защищает
// лимит на человека (в main.pb.js) и блокировка входа после 10 неверных паролей.
const RULES = [
  { label: "*:auth", maxRequests: 300, duration: 60, audience: "" },
  { label: "users:create", maxRequests: 100, duration: 600, audience: "@guest" },
  { label: "messages:create", maxRequests: 1500, duration: 10, audience: "" },
  { label: "*:create", maxRequests: 600, duration: 10, audience: "" },
  { label: "/api/batch", maxRequests: 5, duration: 1, audience: "" },
  { label: "/api/", maxRequests: 1500, duration: 10, audience: "@guest" },
  { label: "/api/", maxRequests: 15000, duration: 10, audience: "@auth" },
]
const OLD = [
  { label: "*:auth", maxRequests: 30, duration: 60, audience: "" },
  { label: "users:create", maxRequests: 10, duration: 600, audience: "@guest" },
  { label: "messages:create", maxRequests: 60, duration: 10, audience: "" },
  { label: "*:create", maxRequests: 60, duration: 10, audience: "" },
  { label: "/api/batch", maxRequests: 5, duration: 1, audience: "" },
  { label: "/api/", maxRequests: 300, duration: 10, audience: "@guest" },
  { label: "/api/", maxRequests: 1200, duration: 10, audience: "@auth" },
]
migrate((app) => {
  const settings = app.settings()
  settings.rateLimits.enabled = true
  settings.rateLimits.rules = RULES
  app.save(settings)
}, (app) => {
  const settings = app.settings()
  settings.rateLimits.rules = OLD
  app.save(settings)
})
