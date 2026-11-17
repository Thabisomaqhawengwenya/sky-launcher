# Game Launcher: shared brief

Console-style (PS5/Xbox-like) Windows 10 desktop app that shows the games on my
laptop and only launches them. Electron + React + TypeScript (electron-vite react-ts).

## Ownership

- `src/main` and `src/preload` — backend (Kiro)
- `src/renderer` — UI (Antigravity)
- Do not edit the other agent's area. If you need a change there, add it to
  **Requests** at the bottom of this file.
- The typed API in `src/preload/index.d.ts` is the contract. The backend updates
  it; the UI only consumes it.

## Rules for every change

- **Security:** contextIsolation on, nodeIntegration off. The renderer only sends
  game ids and user choices. Paths, URIs, registry reads, file scanning, downloads
  and API keys stay in the main process. Only `steam://` and
  `com.epicgames.launcher://` URIs may be opened. Never run a path that isn't in
  `games.json`. Keep the CSP strict.
- Everything works with keyboard **AND** gamepad (D-pad/stick move, A select, B
  back, Y options). Always show a visible focus state.
- Style: dark navy, large tiles, blurred backdrop of the selected game's art,
  per-game accent colour, motion respects `prefers-reduced-motion`. Looks right at
  1920×1080 and 1366×768.
- Errors are plain language: what went wrong and how to fix it. Never crash on bad
  JSON, missing files or failed launches.
- Windows 10 only. No new dependencies unless really needed; explain why.
- After every task: `npm run typecheck`, `npm run lint`, `npm run dev`, then commit
  with a clear message. Make small changes and don't rewrite working files.

## Phases (done in order; each agent does only its part)

| # | Name | Backend | UI |
|---|------|---------|----|
| 1 | Make it solid | Harden IPC: validate games.json entries, guard all handlers, expose load status | Show errors, wire status |
| 2 | Add / edit / remove games in-app | CRUD IPC handlers for games.json | Form UI |
| 3 | Auto-detect Steam, Epic, GOG, folder scan | Registry reads + folder scan in main | Scan trigger + results UI |
| 4 | Cover art (SteamGridDB) | Fetch + cache images in main | Display art |
| 5 | Recently played, play time, search, favourites, sounds | Track in main | Surface in UI |
| 6 | Settings and visual polish | Read/write settings file, expose over IPC | Settings screen |
| 7 | Packaging and security review | Full IPC audit, build hardening | — |

## Current status

### Phase 1 — complete (backend)

**`games.json` location:** `%APPDATA%\game-launcher\games.json`

**IPC channels the UI can call via `window.api`:**

| Method | Returns | Notes |
|--------|---------|-------|
| `listGames()` | `Promise<GameEntry[]>` | Returns validated games only. Skips entries that fail validation; never throws. |
| `launchGame(id)` | `Promise<LaunchResult>` | Validates `id` is a string before lookup. Returns `{ ok, error }`. Minimises window on success. |
| `openGamesFile()` | `Promise<void>` | Ensures the file exists, then opens its containing folder in Explorer. |
| `getStatus()` | `Promise<LibraryStatus>` | Returns `{ ok, games, error?, warnings[] }`. `ok` is false only when `games.json` exists but cannot be parsed. `warnings` lists entries that were skipped and why. |

**Types (from `index.d.ts`):**

```ts
GameEntry    = { id, name, cover?, color? }
LaunchResult = { ok, error? }
LibraryStatus = { ok, games: GameEntry[], error?, warnings: string[] }
```

**What "validation" means for a game entry:**
- Must have a non-empty string `id` and `name`
- If `exe` is present: must be an absolute path
- Must have at least one of `exe` or `uri`
- If `uri` is present: must match the `steam://` or `com.epicgames.launcher://` allowlist

Entries that fail are skipped (not shown, not launchable) and their reason appears
in `LibraryStatus.warnings`.

## Requests

_(Agents add cross-area requests here.)_
