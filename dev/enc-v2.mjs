// Mirrors pc/crew-push.ps1's Encrypt (PBKDF2-SHA256 -> AES-256-CBC + HMAC-SHA256), for tests.
import { readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
const [, , inFile, outFile] = process.argv, pass = process.env.CREW_FEED_KEY;
const salt = crypto.randomBytes(16), iv = crypto.randomBytes(16);
const keys = crypto.pbkdf2Sync(pass, salt, 150000, 64, "sha256");
const c = crypto.createCipheriv("aes-256-cbc", keys.subarray(0, 32), iv);
const ct = Buffer.concat([c.update(readFileSync(inFile)), c.final()]);
const mac = crypto.createHmac("sha256", keys.subarray(32)).update(Buffer.concat([iv, ct])).digest();
writeFileSync(outFile, JSON.stringify({ v: 2, updated: new Date().toISOString(), iter: 150000, salt: salt.toString("base64"), iv: iv.toString("base64"), data: ct.toString("base64"), mac: mac.toString("base64") }));
