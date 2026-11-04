# Claude Crew — plan (4 Nov 2026)

Phone app (2nd phone, ambient display) that shows every Claude task as a tiny animated Claude.

## Data (no API, no cost beyond a small hourly run)
- Scheduled task, hourly 8am to 1am ET, in this project (fresh thread, resolves itself).
- Reads: list_sessions (PC + cloud Claude Code sessions: title, status, post_turn_summary) and list_threads (project threads: title, state).
- Writes crew-feed.json, AES-GCM encrypted (same scheme as Morning Brief), to branch `feed` of public repo Jrtorres13/claude-crew.
- Phone unlocks it with a key saved once via a setup link (#key=...). Key never committed.
- Item: id, title, state (working | needs_you | done | idle), source (project | pc | cloud), note, started, updated, url.

## The 8 Claudes (original pixel art, Claude clay body, outfit = style)
Forge builder (hard hat, hammer) · Scout researcher (glasses, magnifier) · Muse designer (beret, brush) · Reel video (headphones, clapper) · Patch fixer (cap, wrench) · Quill writer (quill) · Rune wizard (hat, wand) · Comet shipper (goggles, jet).
Pick by keywords in the title; if taken, next free one; past 8, cycle.

## States = animation
working: bob + tool loop · needs you: hop + "!" bubble + chime · done: confetti + XP once, then sleeps · idle: slow blink.

## Screens
Floor (stage of active Claudes + Needs you / Working / Done today lists) · Crew (8 roster cards, level, XP) · Log (timeline) · Settings sheet (key, sound, haptics, keep screen on, theme, demo).

## Specs / checks
- Single file app + manifest + sw + icons. GitHub Pages: jrtorres13.github.io/claude-crew/
- "Update now" banner from version.json (same as other apps).
- transform/opacity animations only; reduced-motion fallback; 44px targets; 320 + 430 widths; no horizontal scroll.
- Demo mode when no key (clearly labelled).
- Privacy: titles/notes only, encrypted; no secrets/paths; nothing personal in the repo.
- Higgsfield: not needed (SVG pixel art beats generated video for crisp 60fps sprites).

## Review of the plan
- Hourly is the freshest possible without an always-on agent; say so to the user.
- Repo creation + Pages needs the PC (remote control), like the other apps.
