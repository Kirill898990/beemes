// Проверка шифрования веб-версии по тем же эталонным значениям, что у Android (CryptoTest.kt) и Python.
//   node server/tests/web-crypto.test.mjs
import assert from "node:assert";
import * as C from "../pb_public/web/js/crypto.js";

const PW = "Пчёлка 🐝 секрет";
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log("OK  ", msg); };

ok(await C.authPassword("alice", PW) === "b2cF53kRWQwrB0EaBw59WzwfNJJLkr5YIYEoITsj5Ms=", "пароль для сервера — как у Android");
ok(await C.authPassword("Alice", PW) === await C.authPassword("alice", PW), "@имя без учёта регистра");

const a = C.unb64("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=");
const b = C.unb64("ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0A=");
ok(C.b64(await C.publicFromPrivate(a)) === "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=", "открытый ключ по закрытому");
const k1 = await C.chatKeyBytes(a, await C.publicFromPrivate(b), "chat123abc");
const k2 = await C.chatKeyBytes(b, await C.publicFromPrivate(a), "chat123abc");
ok(C.b64(k1) === "iVd9wglZuwuYJLuLYgZ2lH3bVlf5zlNb3HO3OB0jreM=", "ключ чата — как у Android");
ok(C.b64(k1) === C.b64(k2), "у обоих собеседников один ключ");
ok(C.b64(await C.chatKeyBytes(a, await C.publicFromPrivate(b), "other")) !== C.b64(k1), "в другом чате — другой ключ");

const key = await C.chatKey(a, await C.publicFromPrivate(b), "chat123abc");
const msg = await C.open(key, "UqbANSupIrmpoHA+0rFFHklUjIbGVVFBGxS6YAM4HLRzuyPOm93cRtxy", "AAECAwQFBgcICQoL", C.messageAad("chat123abc", "aliceid"));
ok(msg.t === "Привет 🐝", "расшифровка эталонного сообщения");
await assert.rejects(C.open(key, "UqbANSupIrmpoHA+0rFFHklUjIbGVVFBGxS6YAM4HLRzuyPOm93cRtxy", "AAECAwQFBgcICQoL", C.messageAad("chat123abc", "bob")));
ok(true, "чужой отправитель — не расшифровать");

const priv = await C.unwrapPrivateKey("AAECAwQFBgcICQoLHXfQGS15X+VOwjHca82tmDSUxxaCMY8NpwZGaa3PK9DaVAwsL4yU7h7rZv8mUQXI", "AAECAwQFBgcICQoLDA0ODw==", PW);
ok(C.b64(priv) === "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=", "закрытый ключ открывается паролем (как у Android)");
await assert.rejects(C.unwrapPrivateKey("AAECAwQFBgcICQoLHXfQGS15X+VOwjHca82tmDSUxxaCMY8NpwZGaa3PK9DaVAwsL4yU7h7rZv8mUQXI", "AAECAwQFBgcICQoLDA0ODw==", "wrong"));
ok(true, "неверный пароль — ключ не открыть");

const me = await C.newIdentity();
const them = await C.newIdentity();
ok(C.b64(await C.publicFromPrivate(me.privateKey)) === C.b64(me.publicKey), "новая пара ключей согласована");
const { wrapped, salt } = await C.wrapPrivateKey(me.privateKey, PW);
ok(C.b64(await C.unwrapPrivateKey(wrapped, salt, PW)) === C.b64(me.privateKey), "обёртка ключа туда и обратно");
const sealed = await C.seal(await C.chatKey(me.privateKey, them.publicKey, "c1"), { t: "секрет" }, C.messageAad("c1", "me"));
ok((await C.open(await C.chatKey(them.privateKey, me.publicKey, "c1"), sealed.body, sealed.nonce, C.messageAad("c1", "me"))).t === "секрет", "сообщение туда и обратно");
const photo = C.randomBytes(5000);
const f = await C.encryptFile(photo);
ok(C.b64(await C.decryptFile(f.blob, f.key)) === C.b64(photo), "фото туда и обратно");
const s1 = await C.safetyCode(me.publicKey, them.publicKey);
ok(s1.join() === (await C.safetyCode(them.publicKey, me.publicKey)).join() && s1.length === 4 && s1.every((x) => /^\d{5}$/.test(x)), "код безопасности одинаков у обоих");
console.log(`\n${n} checks, 0 fails`);
