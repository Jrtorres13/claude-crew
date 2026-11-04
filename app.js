/* Claude Crew: every Claude task as a tiny Claude at work. No API: reads an encrypted feed a scheduled Claude task writes hourly. */
"use strict";
const BUILD = 2;
const OWNER = "Jrtorres13", REPO = "claude-crew";
// The feed rides on the morning-brief repo's "feed" branch, which scheduled Claude tasks can already push to.
const FEED_URL = `https://raw.githubusercontent.com/${OWNER}/morning-brief/feed/crew-feed.json`;
const VERSION_URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/version.json`;
// Live sync: the PC hook (pc/crew-push.ps1) writes crew-live.json to the "live" branch. The API answers fresh; a 304 is free.
const LIVE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/crew-live.json?ref=live`;
const POLL_MS = 45 * 1000, STALE_MS = 2.5 * 3600 * 1000;
const { V, svg } = window.CrewSprites;
const VBY = Object.fromEntries(V.map(v => [v.id, v]));

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const sp = (id, state, k, extra) => svg(id, state).replace("<svg ", `<svg width="${26 * k}" height="${30 * k}" ${extra || ""} `);

// ---------- state ----------
const set = Object.assign({ sound: true, haptics: true, wake: false, theme: "night", demo: false }, ls.get("crew:settings", {}));
let feedKey = ls.get("crew:key", "");
const S = { feed: null, hourly: ls.get("crew:feed", null), live: ls.get("crew:live", null), status: "loading", why: "", view: "floor", items: [], first: true };
let H; // history for the current mode (real or demo)
function histKey() { return demoOn() ? "crew:hist:demo" : "crew:hist"; }
function loadHist() { H = Object.assign({ xp: {}, done: {}, seen: {}, assign: {} }, ls.get(histKey(), {})); }
function saveHist() { ls.set(histKey(), H); }
function saveSet() { ls.set("crew:settings", set); }
const demoOn = () => set.demo || !feedKey;

// ---------- time ----------
const now = () => Date.now();
const ts = v => { const t = typeof v === "number" ? v : Date.parse(v); return isNaN(t) ? 0 : t; };
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const isToday = t => dayKey(t) === dayKey(now());
function ago(t) {
  const s = Math.max(0, (now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  if (s < 172800) return "yesterday";
  return new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
const clock = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function when(t) { return isToday(t) ? "Today " + clock(t) : ago(t) === "yesterday" ? "Yesterday " + clock(t) : new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

// ---------- feed ----------
const b64u8 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
async function decrypt(box, pass) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64u8(box.salt), iterations: box.iter || 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u8(box.iv) }, key, b64u8(box.data))));
}
// v2 (from the PC): PBKDF2-SHA256 -> AES-CBC key + HMAC key, MAC checked before decrypting.
async function decrypt2(box, pass) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64u8(box.salt), iterations: box.iter || 150000, hash: "SHA-256" }, base, 512));
  const iv = b64u8(box.iv), ct = b64u8(box.data), signed = new Uint8Array(iv.length + ct.length); signed.set(iv); signed.set(ct, iv.length);
  const mk = await crypto.subtle.importKey("raw", bits.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("HMAC", mk, b64u8(box.mac), signed)) throw new Error("mac");
  const ek = await crypto.subtle.importKey("raw", bits.slice(0, 32), { name: "AES-CBC" }, false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, ek, ct)));
}
const unlock = (box, pass) => (box.v === 2 ? decrypt2 : decrypt)(box, pass).then(p => (p.generated_at = p.generated_at || box.updated, p));
async function getHourly() {
  try { const r = await fetch(FEED_URL + "?t=" + now(), { cache: "no-store" }); if (!r.ok) return { why: r.status === 404 ? "nofeed" : "http" };
    const box = await r.json(); try { return { feed: await unlock(box, feedKey) }; } catch (e) { return { why: "badkey" }; } }
  catch (e) { return { why: "offline" }; }
}
async function getLive() {
  const tag = S.live && ls.get("crew:live-etag", "");
  try {
    const r = await fetch(LIVE_URL, { cache: "no-store", headers: Object.assign({ Accept: "application/vnd.github.raw+json" }, tag ? { "If-None-Match": tag } : {}) });
    if (r.status === 304) return { same: true };
    if (!r.ok) return { why: r.status === 404 ? "nolive" : "http" };
    const box = await r.json(); ls.set("crew:live-etag", r.headers.get("ETag") || "");
    try { return { feed: await unlock(box, feedKey) }; } catch (e) { return { why: "badkey" }; }
  } catch (e) { return { why: "offline" }; }
}
// Hourly feed covers cloud + project threads; the live feed covers this PC. While the PC is live, its sessions come from it alone.
function merged() {
  const live = S.live && now() - ts(S.live.generated_at) < 12 * 3600 * 1000 ? S.live : null;
  const items = [...((S.hourly && S.hourly.items) || []).filter(i => !(live && i.source === "pc")), ...((live && live.items) || [])];
  const gens = [S.hourly, live].filter(Boolean).map(f => ts(f.generated_at));
  return { generated_at: gens.length ? new Date(Math.max(...gens)).toISOString() : "", items, sig: [S.hourly && S.hourly.generated_at, live && live.generated_at].join("|") };
}
async function fetchFeed() {
  if (!feedKey) return { ok: false, why: "nokey" };
  if (!window.crypto || !crypto.subtle) return { ok: false, why: "nocrypto" };
  const [h, l] = await Promise.all([getHourly(), getLive()]);
  if (h.feed) { S.hourly = h.feed; ls.set("crew:feed", h.feed); }
  if (l.feed) { S.live = l.feed; ls.set("crew:live", l.feed); }
  if (h.why === "badkey" || l.why === "badkey") return { ok: false, why: "badkey" };
  if (!S.hourly && !S.live) return { ok: false, why: h.why || "nofeed" };
  return { ok: true, feed: merged(), why: h.why === "offline" ? "offline" : "" };
}
const WHY = {
  nokey: "Add your feed key in Settings to see your real Claude work.",
  badkey: "That feed key doesn't unlock the feed. Check it in Settings.",
  offline: "No internet right now. Showing the last update.",
  nofeed: "Your feed isn't there yet. It fills in within the hour.",
  http: "GitHub didn't answer. Trying again shortly.",
  nocrypto: "This browser can't unlock the feed. Use Chrome or Safari.",
};

function normState(s) {
  s = String(s || "").toLowerCase();
  if (/need|block|review|wait|action/.test(s)) return "needs_you";
  if (/work|run|active|progress|busy/.test(s)) return "working";
  if (/done|complete|idle|archiv|resolv|stop|fail/.test(s)) return "done";
  return "done";
}
function normalize(feed) {
  const list = (feed && Array.isArray(feed.items)) ? feed.items : [];
  return list.filter(x => x && x.id && x.title).map(x => ({
    id: String(x.id), title: String(x.title).slice(0, 140), state: normState(x.state),
    source: x.source || "cloud", project: x.project || "", note: String(x.note || "").slice(0, 240),
    started: ts(x.started) || ts(x.updated), updated: ts(x.updated) || ts(x.started), url: /^https:\/\/claude\.ai\//.test(x.url || "") ? x.url : "",
  }));
}

// ---------- crew assignment (a task keeps its Claude) ----------
function assignAll(items) {
  const active = items.filter(i => i.state !== "done");
  const taken = new Set(active.map(i => H.assign[i.id]).filter(Boolean));
  let cycle = Object.keys(H.assign).length;
  [...items].sort((a, b) => a.started - b.started).forEach(it => {
    if (H.assign[it.id]) return;
    // the keyword that shows up first in the title wins ("Fix the checkout" is a fix, not a check)
    let v = V.filter(v => !taken.has(v.id)).map(v => ({ v, at: it.title.search(v.keys) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at)[0]?.v;
    if (!v) v = V.find(v => !taken.has(v.id));
    if (!v) v = V[cycle % V.length];
    cycle++;
    H.assign[it.id] = v.id;
    if (it.state !== "done") taken.add(v.id);
  });
}
const vOf = it => VBY[H.assign[it.id]] || V[0];

// ---------- XP ----------
function level(xp, base) { let L = 1, need = base; while (xp >= need) { xp -= need; L++; need = base * L; } return { L, into: xp, need }; }
const totalXp = () => Object.values(H.xp).reduce((a, b) => a + b, 0);
function streak() {
  const days = new Set(Object.values(H.done).map(d => dayKey(d.at)));
  let n = 0, t = now();
  if (!days.has(dayKey(t))) t -= 86400000;
  while (days.has(dayKey(t))) { n++; t -= 86400000; }
  return n;
}

// ---------- apply a feed: diff, reward, render ----------
function apply(feed, quiet) {
  const items = normalize(feed);
  assignAll(items);
  const firstEver = !Object.keys(H.seen).length;
  const events = [];
  items.forEach(it => {
    const was = H.seen[it.id];
    if (it.state === "done" && !H.done[it.id]) {
      const v = vOf(it);
      H.done[it.id] = { at: it.updated || now(), v: v.id, title: it.title };
      H.xp[v.id] = (H.xp[v.id] || 0) + 100;
      if (!quiet && !firstEver && (was || now() - it.updated < 3 * 3600 * 1000)) events.push({ type: "done", it, v });
    } else if (it.state === "needs_you" && was !== "needs_you" && !quiet && !firstEver) events.push({ type: "needs", it, v: vOf(it) });
    else if (!was && it.state === "working" && !quiet && !firstEver) events.push({ type: "new", it, v: vOf(it) });
    H.seen[it.id] = it.state;
  });
  saveHist();
  S.items = items;
  render(events);
  events.slice(0, 3).forEach((e, i) => setTimeout(() => celebrate(e), 350 + i * 900));
  return events.length;
}

// ---------- render ----------
function render(events) {
  renderFloor(events || []);
  renderCrew();
  renderLog();
  renderSync();
}
const active = () => S.items.filter(i => i.state !== "done").sort((a, b) => (a.state === "needs_you" ? 0 : 1) - (b.state === "needs_you" ? 0 : 1) || b.updated - a.updated);
const doneToday = () => S.items.filter(i => i.state === "done" && isToday(i.updated)).sort((a, b) => b.updated - a.updated);
function names(list) { const n = list.map(i => vOf(i).name); return n.length <= 2 ? n.join(" and ") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1]; }

function renderFloor(events) {
  const act = active(), needs = act.filter(i => i.state === "needs_you"), work = act.filter(i => i.state === "working"), done = doneToday();
  const fresh = new Set(events.filter(e => e.type === "new").map(e => e.it.id));
  const h1 = $("#floorTitle"), lede = $("#floorLede"), pods = $("#pods");
  if (S.status === "loading" && !S.items.length) {
    h1.textContent = "Waking the crew"; lede.textContent = "Checking what Claude is up to.";
    pods.innerHTML = V.slice(0, 4).map(v => `<div class="pod" style="--acc:${v.accent}"><div class="spr">${sp(v.id, "idle", 2.5)}</div><span class="tag">&nbsp;</span></div>`).join("");
    $("#lists").innerHTML = `<h2>Working</h2><div class="rows"><div class="skel"></div><div class="skel"></div></div>`;
    return;
  }
  if (act.length) {
    h1.innerHTML = (work.length ? `${work.length} at work` : "") + (work.length && needs.length ? ", " : "") + (needs.length ? `<em>${needs.length} need${needs.length > 1 ? "" : "s"} you</em>` : "");
    const bits = [];
    if (work.length) bits.push(`${names(work.slice(0, 3))}${work.length > 3 ? " and the rest" : ""} ${work.length > 1 ? "are" : "is"} on it.`);
    if (needs.length) bits.push(`${names(needs.slice(0, 2))} ${needs.length > 1 ? "are" : "is"} waiting on you.`);
    lede.textContent = bits.join(" ");
    const shown = act.slice(0, 8);
    pods.innerHTML = shown.map(it => {
      const v = vOf(it);
      return `<button class="pod ${it.state === "needs_you" ? "needs" : ""} ${fresh.has(it.id) ? "fresh" : ""}" type="button" data-id="${esc(it.id)}" style="--acc:${v.accent}" aria-label="${esc(v.name + ": " + it.title)}">
        <div class="spr">${sp(v.id, it.state, 2.5)}</div><span class="nm">${v.name}</span><span class="tag">${esc(it.title)}</span></button>`;
    }).join("") + (act.length > 8 ? `` : "");
    $("#floor").querySelector(".floor-more")?.remove();
    if (act.length > 8) $("#floor").insertAdjacentHTML("beforeend", `<p class="floor-more">and ${act.length - 8} more below</p>`);
  } else {
    h1.textContent = done.length ? "All done for now" : "All quiet on the floor";
    lede.textContent = done.length ? `${done.length} finished today. The crew is napping.` : "Nothing running. Start something in Claude and the crew wakes up.";
    $("#floor").querySelector(".floor-more")?.remove();
    pods.innerHTML = `<div style="width:100%"><div class="sleepers">${V.map(v => sp(v.id, "done", 2)).join("")}</div></div>`;
  }
  $("#demoNote").innerHTML = demoOn()
    ? `<p class="demo-note">This is a demo crew. ${feedKey ? "" : `<button type="button" data-act="settings">Add your feed key</button> to see your real Claude work.`}${feedKey ? `<button type="button" data-act="demo-off">Show my real work</button>` : ""}</p>`
    : (S.why && S.why !== "offline" ? `<p class="demo-note">${esc(WHY[S.why] || "")}</p>` : "");
  const sec = (title, list, cls, emptyMsg) => `<h2>${title} <span class="n">${list.length}</span></h2>` +
    (list.length ? `<div class="rows">${list.map(it => row(it, cls)).join("")}</div>` : (emptyMsg ? `<div class="empty">${emptyMsg}</div>` : ""));
  $("#lists").innerHTML =
    (needs.length ? sec("Needs you", needs, "needs") : "") +
    sec("Working", work, "", "Nobody is working right now.") +
    sec("Done today", done, "", "Nothing finished yet today.");
  const b = $("#needsBadge"); b.hidden = !needs.length; b.textContent = needs.length;
  document.title = needs.length ? `(${needs.length}) Claude Crew` : "Claude Crew";
}
function row(it, cls) {
  const v = vOf(it);
  return `<button class="row ${cls || ""}" type="button" data-id="${esc(it.id)}" style="--acc:${v.accent}">
    <span class="ava">${sp(v.id, it.state, 2)}</span>
    <span class="txt"><span class="t">${esc(it.title)}</span><span class="s">${esc(it.note || placeName(it))}</span></span>
    <span class="when">${esc(ago(it.updated))}</span></button>`;
}
function placeName(it) { return it.source === "pc" ? "On your PC" : it.source === "project" ? (it.project ? it.project + " project" : "Claude project") : "Claude Code on the web"; }

function renderCrew() {
  const tot = totalXp(), me = level(tot, 300), doneN = Object.keys(H.done).length, st = streak();
  $("#rank").innerHTML = `<span class="lv big">LV ${me.L}</span><span class="rt">Crew level ${me.L}</span>
    <div class="bar" role="progressbar" aria-label="XP to next level" aria-valuemin="0" aria-valuemax="${me.need}" aria-valuenow="${me.into}"><i style="--p:${(me.into / me.need).toFixed(3)}"></i></div>
    <div class="meta"><span><b>${tot.toLocaleString()}</b>total XP</span><span><b>${doneN}</b>tasks done</span><span><b>${st}</b>day streak</span></div>`;
  const act = active();
  $("#roster").innerHTML = V.map(v => {
    const xp = H.xp[v.id] || 0, lv = level(xp, 100), n = Object.values(H.done).filter(d => d.v === v.id).length;
    const cur = act.find(i => vOf(i).id === v.id);
    const st = cur ? cur.state : (n ? "idle" : "idle");
    return `<button class="card" type="button" data-crew="${v.id}" style="--acc:${v.accent}">
      <span class="stage">${sp(v.id, st, 3)}</span>
      ${cur ? `<span class="busy ${cur.state === "needs_you" ? "needs" : ""}">${cur.state === "needs_you" ? "needs you" : "working"}</span>` : ""}
      <span class="nm"><b>${v.name}</b><span class="lv">LV ${lv.L}</span></span>
      <span class="rl">${v.role}</span>
      <span class="bar"><i style="--p:${(lv.into / lv.need).toFixed(3)}"></i></span>
      <span class="ct">${n} done, ${xp} XP</span></button>`;
  }).join("");
}

function renderLog() {
  const list = Object.entries(H.done).map(([id, d]) => ({ id, ...d })).sort((a, b) => b.at - a.at).slice(0, 150);
  if (!list.length) { $("#log").innerHTML = `<div class="empty">Finished tasks land here, with the XP each Claude earned.</div>`; return; }
  const groups = [];
  list.forEach(d => { const k = dayKey(d.at); let g = groups[groups.length - 1]; if (!g || g.k !== k) groups.push(g = { k, at: d.at, items: [] }); g.items.push(d); });
  $("#log").innerHTML = groups.map(g => {
    const label = isToday(g.at) ? "Today" : ago(g.at) === "yesterday" ? "Yesterday" : new Date(g.at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    return `<div class="day"><h2>${label} <span class="n">${g.items.length}</span></h2><div class="rows">${g.items.map(d => {
      const v = VBY[d.v] || V[0], live = S.items.find(i => i.id === d.id);
      return `<button class="row" type="button" data-id="${esc(d.id)}" style="--acc:${v.accent}"><span class="ava">${sp(v.id, "done", 2)}</span>
        <span class="txt"><span class="t">${esc(d.title)}</span><span class="s">${v.name} earned 100 XP</span></span><span class="when">${clock(d.at)}</span></button>`;
    }).join("")}</div></div>`;
  }).join("");
}

function renderSync() {
  const b = $("#sync"), t = $("#syncTxt");
  const gen = S.feed && ts(S.feed.generated_at);
  b.classList.toggle("stale", !!gen && now() - gen > STALE_MS && !demoOn());
  if (demoOn()) t.textContent = "Demo";
  else if (gen) t.textContent = ago(gen);
  else t.textContent = S.status === "loading" ? "Loading" : "No update yet";
  b.setAttribute("aria-label", gen && !demoOn() ? "Last update " + ago(gen) + ". Check again" : "Check for new Claude activity");
}

// ---------- sheets ----------
let lastFocus = null;
function openSheet(html) {
  lastFocus = document.activeElement;
  $("#sheetBody").innerHTML = html;
  $("#scrim").classList.add("on"); $("#sheet").classList.add("on");
  setTimeout(() => ($("#sheet").querySelector("[data-autofocus]") || $("#sheet")).focus({ preventScroll: true }), 60);
}
function closeSheet() {
  $("#scrim").classList.remove("on"); $("#sheet").classList.remove("on");
  lastFocus?.focus?.({ preventScroll: true });
}
function taskSheet(id) {
  const it = S.items.find(i => i.id === id);
  const d = H.done[id];
  if (!it && !d) return;
  const v = it ? vOf(it) : (VBY[d.v] || V[0]);
  const state = it ? it.state : "done";
  const label = { working: "Working", needs_you: "Needs you", done: "Done", idle: "Idle" }[state];
  const line = { working: `${v.name} is on it.`, needs_you: `${v.name} is waiting for you.`, done: `${v.name} finished this one.` }[state] || "";
  openSheet(`<div class="hero" style="--acc:${v.accent}"><span class="who"><b>${v.name}</b>, ${v.role.toLowerCase()}</span>${sp(v.id, state, 5)}</div>
    <h3 id="sheetTitle">${esc(it ? it.title : d.title)}</h3>
    <span class="pill ${state}">${label}</span>
    <p class="note">${esc((it && it.note) || line)}</p>
    <dl class="facts">
      ${it ? `<dt>Where</dt><dd>${esc(placeName(it))}</dd>` : ""}
      ${it && it.started ? `<dt>Started</dt><dd>${esc(when(it.started))}</dd>` : ""}
      <dt>${state === "done" ? "Finished" : "Last update"}</dt><dd>${esc(it ? ago(it.updated) : when(d.at))}</dd>
    </dl>
    <div class="actions">
      ${it && it.url ? `<a class="btn primary" href="${esc(it.url)}" target="_blank" rel="noopener" data-autofocus>Open in Claude</a>` : ""}
      <button class="btn" type="button" data-act="close">Close</button>
    </div>`);
}
function crewSheet(vid, preview) {
  const v = VBY[vid]; if (!v) return;
  const xp = H.xp[v.id] || 0, lv = level(xp, 100);
  const mine = Object.entries(H.done).filter(([, d]) => d.v === v.id).sort((a, b) => b[1].at - a[1].at).slice(0, 4);
  const cur = active().find(i => vOf(i).id === v.id);
  const st = preview || (cur ? cur.state : "working");
  openSheet(`<div class="hero" style="--acc:${v.accent}"><span class="who"><b>${v.name}</b>, ${v.role.toLowerCase()}</span>${sp(v.id, st, 5)}</div>
    <h3 id="sheetTitle">${v.name} <span class="lv">LV ${lv.L}</span></h3>
    <div class="bar" style="--acc:${v.accent};margin-top:10px"><i style="--p:${(lv.into / lv.need).toFixed(3)};background:${v.accent}"></i></div>
    <p class="hint">${lv.need - lv.into} XP to level ${lv.L + 1}. Gets tasks that sound like ${v.role.toLowerCase()} work.</p>
    <div class="seg" role="group" aria-label="Preview" style="margin-top:14px">
      ${[["working", "Working"], ["needs_you", "Needs you"], ["done", "Asleep"]].map(([k, l]) => `<button type="button" data-preview="${k}" data-crew-id="${v.id}" aria-pressed="${st === k}">${l}</button>`).join("")}
    </div>
    ${cur ? `<h2>On it now</h2><div class="rows">${row(cur, cur.state === "needs_you" ? "needs" : "")}</div>` : ""}
    ${mine.length ? `<h2>Recently finished</h2><div class="rows">${mine.map(([id, d]) => `<button class="row" type="button" data-id="${esc(id)}" style="--acc:${v.accent}"><span class="ava">${sp(v.id, "done", 2)}</span><span class="txt"><span class="t">${esc(d.title)}</span></span><span class="when">${esc(ago(d.at))}</span></button>`).join("")}</div>` : ""}
    <div class="actions"><button class="btn" type="button" data-act="close">Close</button></div>`);
}
function settingsSheet(msg, bad) {
  const sw = (k, label, sub) => `<div class="set-row"><span class="lab">${label}${sub ? `<small>${sub}</small>` : ""}</span><button class="sw" type="button" role="switch" aria-checked="${!!set[k]}" data-sw="${k}" aria-label="${label}"></button></div>`;
  openSheet(`<h3 id="sheetTitle">Settings</h3>
    <div class="set">
      <div class="set-row" style="display:block;padding:12px 0">
        <span class="lab">Feed key<small>Unlocks your Claude activity. Saved only on this phone.</small></span>
        <form class="field" id="keyForm"><input id="keyIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${feedKey ? "Saved. Paste a new one to replace it" : "Paste the key Claude gave you"}" aria-label="Feed key"><button class="btn primary" type="submit">Save</button></form>
        ${msg ? `<p class="hint ${bad ? "bad" : ""}" role="status">${esc(msg)}</p>` : ""}
      </div>
      ${sw("sound", "Sounds", "A chime when a task needs you or finishes")}
      ${sw("haptics", "Vibration", "Android phones only")}
      ${sw("wake", "Keep screen on", "For a phone that sits on your desk")}
      ${sw("demo", "Demo crew", "Show sample tasks instead of yours")}
      <div class="set-row"><span class="lab">Look</span><span class="seg" role="group" aria-label="Look">
        <button type="button" data-theme-pick="night" aria-pressed="${set.theme === "night"}">Night</button><button type="button" data-theme-pick="ivory" aria-pressed="${set.theme === "ivory"}">Ivory</button></span></div>
    </div>
    <div class="actions"><button class="btn" type="button" data-act="close">Done</button></div>
    <p class="ver">Your PC: ${S.live ? "live, last " + ago(ts(S.live.generated_at)) : "live sync not set up yet"}<br>Cloud and project threads: hourly${S.hourly ? ", last " + ago(ts(S.hourly.generated_at)) : ""}<br>Claude Crew build ${BUILD}</p>`);
}

// ---------- juice: toasts, confetti, sound, haptics ----------
function toast(html, vid, state, xp) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = (vid ? sp(vid, state || "working", 1.5) : "") + `<span>${html}</span>` + (xp ? `<span class="xp">+${xp} XP</span>` : "");
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, 3600);
}
function confetti(color) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div"); box.className = "confetti";
  const cols = [color, "#d97757", "#f2c14e", "#f4ede3", "#8fc3a9"];
  const ox = innerWidth / 2, oy = innerHeight * 0.32;
  for (let i = 0; i < 46; i++) {
    const p = document.createElement("i"), a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 200;
    p.style.cssText = `left:${ox}px;top:${oy}px;--c:${cols[i % cols.length]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d + 160}px;--r:${Math.random() * 540 - 270}deg;--d:${900 + Math.random() * 700}ms`;
    box.appendChild(p);
  }
  document.body.appendChild(box); setTimeout(() => box.remove(), 1800);
}
let actx = null;
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === "suspended") actx.resume(); return actx; }
function tone(notes, type) {
  if (!set.sound) return; const a = audio(); if (!a) return;
  let t = a.currentTime + 0.02;
  notes.forEach(([f, d]) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || "square"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.02); t += d * 0.8;
  });
}
const sfx = {
  done: () => tone([[523, .09], [659, .09], [784, .09], [1047, .22]]),
  needs: () => tone([[784, .12], [988, .18]], "triangle"),
  new: () => tone([[392, .07], [523, .1]], "triangle"),
  tap: () => tone([[880, .03]], "triangle"),
};
const buzz = p => { if (set.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} };
function celebrate(e) {
  const t = esc(e.it.title.length > 48 ? e.it.title.slice(0, 46) + "…" : e.it.title);
  if (e.type === "done") { toast(`<b>${e.v.name}</b> finished ${t}`, e.v.id, "working", 100); confetti(e.v.accent); sfx.done(); buzz([30, 40, 30]); bump(e.it.id); }
  if (e.type === "needs") { toast(`<b>${e.v.name}</b> needs you: ${t}`, e.v.id, "needs_you"); sfx.needs(); buzz([80, 60, 80]); }
  if (e.type === "new") { toast(`<b>${e.v.name}</b> started ${t}`, e.v.id, "working"); sfx.new(); }
}
function bump(id) { document.querySelectorAll(`[data-id="${CSS.escape(id)}"] .sprite`).forEach(s => { s.classList.add("celebrate"); setTimeout(() => s.classList.remove("celebrate"), 1600); }); }

// ---------- wake lock ----------
let lock = null;
async function wake() {
  if (!set.wake || document.visibilityState !== "visible" || !("wakeLock" in navigator)) { if (!set.wake && lock) { lock.release().catch(() => {}); lock = null; } return; }
  try { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } catch (e) {}
}

// ---------- demo crew (sample tasks, clearly labelled) ----------
function demoFeed() {
  const m = 60000, t = now();
  const base = ls.get("crew:demo-base", null) || { at: t };
  ls.set("crew:demo-base", base);
  const sec = Math.floor((t - base.at) / 1000);
  const items = [
    { id: "d1", title: "Build habit tracker app", state: "working", source: "project", project: "Side projects", note: "Wiring up the streak counter and the weekly chart.", started: t - 52 * m, updated: t - 3 * m },
    { id: "d2", title: "Research the best mic for reels", state: "working", source: "cloud", note: "Comparing five lav mics under $100.", started: t - 30 * m, updated: t - 6 * m },
    { id: "d3", title: "Fix the checkout bug on the shop site", state: "needs_you", source: "pc", note: "Found it. Needs you to approve the deploy.", started: t - 95 * m, updated: t - 12 * m },
    { id: "d4", title: "Edit the launch reel captions", state: "working", source: "pc", note: "Timing captions to the voiceover.", started: t - 20 * m, updated: t - 2 * m },
    { id: "d5", title: "Design three logo options", state: "working", source: "project", project: "Side projects", note: "Sketching a monogram and two wordmarks.", started: t - 44 * m, updated: t - 9 * m },
    { id: "d6", title: "Write the weekly newsletter", state: "done", source: "cloud", note: "Draft is in your docs.", started: t - 180 * m, updated: t - 70 * m },
    { id: "d7", title: "Set up a nightly backup skill", state: "working", source: "pc", note: "Testing the schedule.", started: t - 15 * m, updated: t - 1 * m },
    { id: "d8", title: "Ship the portfolio site", state: "done", source: "cloud", note: "Live on GitHub Pages.", started: t - 240 * m, updated: t - 120 * m },
  ];
  // Every 40 seconds the demo moves on a step, so you can see the crew react.
  const step = Math.floor(sec / 40);
  if (step >= 1) items[1].state = "done", items[1].updated = base.at + 40000, items[1].note = "Picked one. Notes are in the thread.";
  if (step >= 2) items.push({ id: "d9", title: "Plan next week's content", state: "working", source: "cloud", note: "Drafting seven post ideas.", started: base.at + 80000, updated: base.at + 80000 });
  if (step >= 3) items[0].state = "needs_you", items[0].note = "Ready for you to try on your phone.";
  if (step >= 4) items[3].state = "done", items[3].updated = base.at + 160000;
  return { generated_at: new Date(t).toISOString(), items };
}

// ---------- loop ----------
let busy = false;
async function refresh(loud) {
  if (busy) return; busy = true;
  $("#sync").classList.add("spin");
  try {
    if (demoOn()) { S.status = "ok"; S.why = feedKey ? "" : "nokey"; apply(demoFeed()); if (loud) toast("Demo crew refreshed."); return; }
    const r = await fetchFeed();
    if (r.ok) {
      const changed = !S.feed || S.feed.sig !== r.feed.sig || S.first;
      S.feed = r.feed; S.status = "ok"; S.why = "";
      const n = changed ? apply(r.feed) : (renderSync(), 0);
      if (loud && !n) toast(changed ? "Up to date." : `No news. Claude last checked in ${ago(ts(r.feed.generated_at))}.`);
    } else {
      S.status = "error"; S.why = r.why;
      if (S.hourly || S.live) { S.feed = merged(); apply(S.feed, true); } else render([]);
      if (loud || r.why === "badkey") toast(esc(WHY[r.why] || "Couldn't load your feed."));
    }
  } finally { busy = false; S.first = false; $("#sync").classList.remove("spin"); }
}

function show(view) {
  S.view = view;
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + view));
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t.dataset.v === view));
  try { history.replaceState(null, "", view === "floor" ? location.pathname : "#" + view); } catch (e) {}
  scrollTo({ top: 0 });
}

function applyTheme() {
  document.documentElement.dataset.theme = set.theme;
  document.querySelector('meta[name="theme-color"]').content = set.theme === "ivory" ? "#f3eee5" : "#161412";
}

// ---------- events ----------
document.addEventListener("click", e => {
  const el = e.target.closest("button, a"); if (!el) return;
  if (el.matches(".tab")) { sfx.tap(); show(el.dataset.v); return; }
  if (el.dataset.id) { sfx.tap(); taskSheet(el.dataset.id); return; }
  if (el.dataset.crew) { sfx.tap(); crewSheet(el.dataset.crew); return; }
  if (el.dataset.preview) { crewSheet(el.dataset.crewId, el.dataset.preview); return; }
  if (el.dataset.sw) {
    const k = el.dataset.sw; set[k] = !set[k]; saveSet(); el.setAttribute("aria-checked", set[k]);
    if (k === "sound" && set.sound) { audio(); sfx.tap(); }
    if (k === "haptics") buzz(20);
    if (k === "wake") wake();
    if (k === "demo") { loadHist(); S.items = []; S.first = true; refresh(); }
    return;
  }
  if (el.dataset.themePick) { set.theme = el.dataset.themePick; saveSet(); applyTheme(); el.parentElement.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === el)); return; }
  const act = el.dataset.act;
  if (act === "close") closeSheet();
  if (act === "settings") settingsSheet();
  if (act === "demo-off") { set.demo = false; saveSet(); loadHist(); S.items = []; S.first = true; refresh(true); }
});
document.addEventListener("submit", async e => {
  if (e.target.id !== "keyForm") return; e.preventDefault();
  const v = $("#keyIn").value.trim();
  if (v.length < 12) { settingsSheet("That key looks too short. Copy the whole thing.", true); return; }
  feedKey = v; ls.set("crew:key", v); set.demo = false; saveSet(); loadHist(); S.items = []; S.first = true;
  await refresh();
  settingsSheet(S.why === "badkey" ? WHY.badkey : S.why === "nofeed" ? WHY.nofeed : "Saved. Your crew is live.", S.why === "badkey");
});
$("#scrim").addEventListener("click", closeSheet);
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#sheet").classList.contains("on")) closeSheet(); });
$("#sync").addEventListener("click", () => { audio(); refresh(true); });
$("#openSet").addEventListener("click", () => settingsSheet());
// swipe the sheet down to close
(() => { let y0 = null; const sh = $("#sheet");
  sh.addEventListener("touchstart", e => { if (sh.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener("touchend", e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 70) closeSheet(); y0 = null; }, { passive: true }); })();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { refresh(); wake(); } });
document.addEventListener("pointerdown", () => audio(), { once: true });

// ---------- update banner (phone version reloads to update) ----------
function checkUpdate() {
  fetch(VERSION_URL + "?t=" + now(), { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(v => {
    if (v && v.build > BUILD) { $("#upd span").textContent = "A new version is ready" + (v.notes ? ": " + v.notes : "."); $("#upd").hidden = false; }
  }).catch(() => {});
}
$("#updGo").addEventListener("click", async () => {
  $("#updGo").disabled = true;
  try { const regs = await navigator.serviceWorker?.getRegistrations?.() || []; await Promise.all(regs.map(r => r.update())); const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch (e) {}
  location.reload();
});

// ---------- start ----------
(function setupLink() { // one-time phone setup link: .../claude-crew/#key=KEY
  const m = /[#&]key=([^&]+)/.exec(location.hash); if (!m) return;
  feedKey = decodeURIComponent(m[1]); ls.set("crew:key", feedKey); set.demo = false; saveSet();
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  setTimeout(() => toast("Feed connected. Your crew is live."), 700);
})();
$("#brand").innerHTML = sp("forge", "idle", 1) + "<b>Claude Crew</b>";
applyTheme(); loadHist();
if (/^#(crew|log)$/.test(location.hash)) show(location.hash.slice(1));
if ((S.hourly || S.live) && !demoOn()) { S.status = "ok"; S.feed = merged(); apply(S.feed, true); } else render([]);
refresh();
setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
setInterval(() => { if (document.visibilityState === "visible") { renderSync(); document.querySelectorAll(".row .when").length && S.items.length && renderFloor([]); } }, 30000);
wake(); checkUpdate(); setInterval(checkUpdate, 6 * 3600 * 1000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
