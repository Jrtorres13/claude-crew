// Claude Crew service worker: network first (so updates land), cache as the offline fallback. The feed is never cached here.
const CACHE = "crew-shell-6";
const SHELL = ["./", "index.html", "app.js", "sprites.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== "crew-secret").map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});

// ---------- phone alerts ----------
// The hub sends an empty push. This worker fetches the PC's encrypted live feed, unlocks it with the key the
// app saved, and shows what changed. Nothing readable ever passes through the hub.
const b64u8 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function unlock2(box, pass) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64u8(box.salt), iterations: box.iter || 150000, hash: "SHA-256" }, base, 512));
  const iv = b64u8(box.iv), ct = b64u8(box.data), signed = new Uint8Array(iv.length + ct.length); signed.set(iv); signed.set(ct, iv.length);
  const mk = await crypto.subtle.importKey("raw", bits.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("HMAC", mk, b64u8(box.mac), signed)) throw new Error("mac");
  const ek = await crypto.subtle.importKey("raw", bits.slice(0, 32), { name: "AES-CBC" }, false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, ek, ct)));
}
async function alertsFor() {
  const c = await caches.open("crew-secret");
  const sec = await (await c.match("./crew-secret"))?.json();
  if (!sec || !sec.key) return [];
  const r = await fetch(sec.live, { cache: "no-store", headers: { Accept: "application/vnd.github.raw+json" } });
  const feed = await unlock2(await r.json(), sec.key);
  const seen = (await (await c.match("./crew-notified"))?.json()) || {};
  const fresh = (feed.items || []).filter(i => !i.scheduled && ["needs_you", "done", "paused"].includes(i.state) && seen[i.id] !== i.state + "|" + i.updated
    && Date.now() - Date.parse(i.updated) < 2 * 3600 * 1000).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
  const next = {}; (feed.items || []).forEach(i => { next[i.id] = i.state + "|" + i.updated; });
  await c.put("./crew-notified", new Response(JSON.stringify(next)));
  return fresh.slice(0, 3);
}
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let list = [];
    try { list = await alertsFor(); } catch (err) { }
    const head = { needs_you: "Needs you", done: "Done", paused: "Paused" };
    if (!list.length) return self.registration.showNotification("Claude Crew", { body: "Your crew has an update.", tag: "crew", icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: {} });
    await Promise.all(list.map(i => self.registration.showNotification(`${head[i.state]}: ${i.title}`, { body: i.note || "", tag: i.id, renotify: true, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { id: i.id } })));
    (await self.clients.matchAll({ type: "window" })).forEach(c => c.postMessage({ type: "refresh" }));
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) { await wins[0].focus(); if (id) wins[0].postMessage({ type: "open", id }); return; }
    return self.clients.openWindow("./" + (id ? "?open=" + encodeURIComponent(id) : ""));
  })());
});
