// Claude Crew hub. Rooms are named by SHA-256 of the feed key, so only someone with the key can find one.
// The first caller of a room sets its auth (also a hash of the key); every later call must match it.
//   GET  /vapid                      -> { key }  public Web Push key (made once, kept in KV)
//   POST /room/:room/sub     {auth, sub}        save a phone's push subscription (max 10 per room)
//   POST /room/:room/unsub   {auth, endpoint}
//   POST /room/:room/notify  {auth}             wake every phone in the room (empty push; the phone reads the feed itself)
//   GET  /room/:room/checks?auth=...            -> { blob }  encrypted "checked" state
//   PUT  /room/:room/checks  {auth, blob}
const ORIGINS = ["https://jrtorres13.github.io", "http://localhost:8790", "http://localhost:8789"];
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/;
const HEX = /^[0-9a-f]{64}$/;
const SUBJECT = "https://jrtorres13.github.io/claude-crew/";

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");

function cors(req) {
  const o = req.headers.get("Origin");
  return { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
}
const json = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

async function vapid(env) {
  let v = await env.CREW.get("vapid", "json");
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    v = { pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
    await env.CREW.put("vapid", JSON.stringify(v));
  }
  return v;
}

async function pushOne(v, sub) {
  const u = new URL(sub.endpoint);
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ typ: "JWT", alg: "ES256" }) + "." + enc({ aud: u.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT });
  const key = await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head));
  const r = await fetch(sub.endpoint, { method: "POST", headers: { Authorization: `vapid t=${head}.${b64u(sig)}, k=${v.pub}`, TTL: "3600", Urgency: "high", "Content-Length": "0" } });
  return r.status;
}

async function room(env, id, auth) {
  if (!HEX.test(id) || !HEX.test(auth || "")) return "bad";
  const want = await sha(auth), have = await env.CREW.get("auth:" + id);
  if (!have) { await env.CREW.put("auth:" + id, want); return "ok"; }
  return have === want ? "ok" : "denied";
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
    const url = new URL(req.url), p = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && p[0] === "vapid") return json(req, { key: (await vapid(env)).pub });
      if (p[0] !== "room" || p.length !== 3) return json(req, { error: "not found" }, 404);
      const [, id, what] = p;
      const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
      if (JSON.stringify(body).length > 40000) return json(req, { error: "too big" }, 413);
      const ok = await room(env, id, req.method === "GET" ? url.searchParams.get("auth") : body.auth);
      if (ok !== "ok") return json(req, { error: ok }, ok === "bad" ? 400 : 403);
      const subsKey = "subs:" + id;
      if (what === "sub" && req.method === "POST") {
        const s = body.sub || {};
        let host = ""; try { host = new URL(s.endpoint).host; } catch (e) {}
        if (!s.endpoint || !s.endpoint.startsWith("https://") || !PUSH_HOSTS.test(host)) return json(req, { error: "endpoint" }, 400);
        const subs = ((await env.CREW.get(subsKey, "json")) || []).filter(x => x.endpoint !== s.endpoint);
        subs.unshift({ endpoint: s.endpoint, at: Date.now() });
        await env.CREW.put(subsKey, JSON.stringify(subs.slice(0, 10)));
        return json(req, { ok: true, phones: Math.min(subs.length, 10) });
      }
      if (what === "unsub" && req.method === "POST") {
        const subs = ((await env.CREW.get(subsKey, "json")) || []).filter(x => x.endpoint !== body.endpoint);
        await env.CREW.put(subsKey, JSON.stringify(subs));
        return json(req, { ok: true });
      }
      if (what === "notify" && req.method === "POST") {
        const subs = (await env.CREW.get(subsKey, "json")) || [];
        if (!subs.length) return json(req, { sent: 0 });
        const v = await vapid(env);
        const res = await Promise.all(subs.map(s => pushOne(v, s).catch(() => 0)));
        const keep = subs.filter((s, i) => res[i] !== 404 && res[i] !== 410);
        if (keep.length !== subs.length) await env.CREW.put(subsKey, JSON.stringify(keep));
        return json(req, { sent: res.filter(c => c >= 200 && c < 300).length, codes: res });
      }
      if (what === "checks") {
        if (req.method === "GET") return json(req, { blob: await env.CREW.get("checks:" + id, "json") });
        if (req.method === "PUT") {
          const b = body.blob;
          if (!b || typeof b.iv !== "string" || typeof b.data !== "string") return json(req, { error: "blob" }, 400);
          await env.CREW.put("checks:" + id, JSON.stringify({ iv: b.iv, data: b.data, at: Date.now() }));
          return json(req, { ok: true });
        }
      }
      return json(req, { error: "not found" }, 404);
    } catch (e) { return json(req, { error: "server" }, 500); }
  },
};
