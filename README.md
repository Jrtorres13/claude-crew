# Claude Crew

A phone app that shows every Claude task you have going as a tiny pixel Claude at work.

- Phone: https://jrtorres13.github.io/claude-crew/ (Add to Home Screen)
- 8 Claudes: Forge, Scout, Muse, Reel, Patch, Quill, Rune, Comet. Each task gets the one that fits it; past eight they cycle.
- Working, needs you, done: each has its own animation. Finished tasks earn XP.

## How it knows what Claude is doing

A scheduled Claude task runs about once an hour. It lists your Claude sessions and project threads,
writes `crew-feed.json`, encrypts it (AES-GCM, `tools/feed.mjs`) and pushes it to the `feed` branch of Jrtorres13/morning-brief (next to the Morning Brief feed).
The repo is public; without the key the feed is unreadable. The key is never committed.

## Files

- `index.html`, `app.js`, `sprites.js`: the app (no build step)
- `sw.js`, `manifest.webmanifest`, `icons/`: installable on the home screen, works offline
- `version.json`: bump `build` (and `BUILD` in app.js) to show "Update now"
- `pc/`: live sync for Claude Code on the PC (a hook that pushes an encrypted `crew-live.json` to the `live` branch). Install: `powershell -ExecutionPolicy Bypass -File pc\install.ps1`
- `dev/`: Playwright checks (`node dev/test.cjs`, `dev/test-feed.cjs`, `dev/test-live.cjs`)
