# Claude Crew hub (phone alerts + sync across devices)

A free Cloudflare Worker. It stores only hashes of the feed key, push subscriptions, and an
encrypted "which tasks you checked" blob. It never sees a task title or note.

## Deploy (once, on the PC, PowerShell)

```powershell
cd "C:\Users\jrtbu\Projects\Personal Builds\projects\claude-crew\hub"
npx wrangler kv namespace create CREW
```
Paste the printed `id` over `PASTE_KV_ID` in `wrangler.jsonc`, then:
```powershell
npx wrangler deploy
```
It prints the URL, like `https://claude-crew-hub.<name>.workers.dev`. Tell the PC scripts about it:
```powershell
cd "C:\Users\jrtbu\Projects\Personal Builds\projects\claude-crew\pc"
powershell -ExecutionPolicy Bypass -File install.ps1 -Hub https://claude-crew-hub.<name>.workers.dev
```
The phone learns the hub from the live feed. Then in the app: Settings, Phone alerts, Turn on.
iPhone: add the app to the Home Screen first (Share, Add to Home Screen) and open it from there.
