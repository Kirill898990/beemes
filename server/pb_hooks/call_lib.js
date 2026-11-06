// Звонки в курсе: временные логин и пароль для TURN-сервера (coturn, ставится install.sh).
// coturn проверяет их по общему секрету (use-auth-secret): пароль = base64(HMAC-SHA1(секрет, логин)).
// В PocketBase нет HMAC-SHA1, поэтому SHA-1 посчитан здесь.

function utf8(text) {
  const out = []
  const s = String(text)
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00)
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

function sha1(bytes) {
  const m = bytes.slice()
  const bits = bytes.length * 8
  m.push(0x80)
  while (m.length % 64 !== 56) m.push(0)
  m.push(0, 0, 0, 0, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255)
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const w = new Array(80)
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3]
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = (x << 1) | (x >>> 31)
    }
    let [a, b, c, d, e] = h
    for (let i = 0; i < 80; i++) {
      let f, k
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0
  }
  const out = []
  h.forEach((v) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255))
  return out
}

function hmacSha1(key, message) {
  let k = key.length > 64 ? sha1(key) : key.slice()
  while (k.length < 64) k.push(0)
  const inner = sha1(k.map((b) => b ^ 0x36).concat(message))
  return sha1(k.map((b) => b ^ 0x5c).concat(inner))
}

function base64(bytes) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63]
    out += i + 1 < bytes.length ? abc[(n >> 6) & 63] : "="
    out += i + 2 < bytes.length ? abc[n & 63] : "="
  }
  return out
}

/** Серверы для соединения звонка. Если TURN не настроен — только общедоступный STUN. */
function iceServers(secret, host, userId) {
  if (!secret || !host) return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
  const username = (Math.floor(Date.now() / 1000) + 24 * 3600) + ":" + userId
  return [
    { urls: ["stun:" + host + ":3478"] },
    {
      urls: ["turn:" + host + ":3478?transport=udp", "turn:" + host + ":3478?transport=tcp"],
      username,
      credential: base64(hmacSha1(utf8(secret), utf8(username))),
    },
  ]
}

const hex = (bytes) => bytes.map((b) => (b < 16 ? "0" : "") + b.toString(16)).join("")

module.exports = { utf8, sha1, hmacSha1, base64, hex, iceServers }
