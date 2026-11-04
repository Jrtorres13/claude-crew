// Builds the encrypted feed Claude Crew reads.
//   CREW_FEED_KEY=... node tools/feed.mjs plain.json crew-feed.json
// The repo is public, so the feed is AES-GCM encrypted. Only "updated" is readable without the key.
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const [, , inFile, outFile] = process.argv;
const pass = process.env.CREW_FEED_KEY || "";
function fail(msg) { console.error("feed.mjs: " + msg); process.exitCode = 1; }
const STATES = ["working", "needs_you", "done"], SOURCES = ["project", "pc", "cloud"];

if (!inFile || !outFile) fail("usage: node tools/feed.mjs plain.json crew-feed.json");
else if (pass.length < 12) fail("set CREW_FEED_KEY (12+ characters)");
else {
  const plain = JSON.parse(readFileSync(inFile, "utf8"));
  const errs = [];
  const str = (v, n) => typeof v === "string" && v.trim() && v.length <= n;
  const iso = v => typeof v === "string" && !isNaN(Date.parse(v));
  if (!Array.isArray(plain.items)) errs.push("items must be an array");
  (plain.items || []).forEach((s, i) => {
    if (!str(s.id, 120)) errs.push(`items[${i}].id missing`);
    if (!str(s.title, 140)) errs.push(`items[${i}].title missing or over 140 chars`);
    if (!STATES.includes(s.state)) errs.push(`items[${i}].state must be ${STATES.join("|")}`);
    if (!SOURCES.includes(s.source)) errs.push(`items[${i}].source must be ${SOURCES.join("|")}`);
    if (s.note && !str(s.note, 240)) errs.push(`items[${i}].note over 240 chars`);
    if (!iso(s.updated)) errs.push(`items[${i}].updated must be an ISO date`);
    if (s.started && !iso(s.started)) errs.push(`items[${i}].started must be an ISO date`);
    if (s.url && !/^https:\/\/claude\.ai\//.test(s.url)) errs.push(`items[${i}].url must start with https://claude.ai/`);
    const blob = `${s.title} ${s.note || ""}`;
    if (/[A-Za-z]:\\|sk-ant-|ghp_|github_pat_|-----BEGIN|@[a-z0-9-]+\.[a-z]{2,}/i.test(blob)) errs.push(`items[${i}] looks like it holds a path, key or email; remove it`);
  });
  if (errs.length) fail("feed not written:\n  " + errs.join("\n  "));
  else {
    plain.generated_at = plain.generated_at || new Date().toISOString();
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 150000;
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(plain))));
    const b64 = u => Buffer.from(u).toString("base64");
    writeFileSync(outFile, JSON.stringify({ v: 1, updated: plain.generated_at, iter, salt: b64(salt), iv: b64(iv), data: b64(data) }) + "\n");
    const c = s => plain.items.filter(x => x.state === s).length;
    console.log(`feed.mjs: wrote ${outFile} (${plain.items.length} items: ${c("working")} working, ${c("needs_you")} need you, ${c("done")} done)`);
  }
}
