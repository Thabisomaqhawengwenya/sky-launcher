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
| 8 | User accounts & cloud saves (Firebase) | Firebase Auth/Firestore/Storage sync + local save-folder zip/restore in main | Sign-in, profile HUD, cloud save sync UI |

## Current status

### Improvement pass — complete (backend)

| Item | What changed |
|------|-------------|
| Process exit detection | `launchExe` now keeps the `ChildProcess` reference. When the game exits, `recordSessionEnd` is called precisely and `playtime:updated` is pushed to the renderer. URI launches still use the focus-based fallback. |
| games.json file watcher | `fs.watch` on `gamesFile()` starts after `did-finish-load`. On any change it debounces 500 ms then sends `library:changed` to the renderer. |
| Art progress push events | `fetchArtAll` now sends `art:progress` (per game) and `art:done` (batch end) to the renderer instead of fire-and-forget. |
| `app:version` IPC | `getVersion()` returns `app.getVersion()` — the string from package.json. |
| GOG Galaxy URI | `scanGog` reads `gameID` from the registry and emits `goggalaxy://openGame/<id>` URIs. `ALLOWED_URI` now includes `goggalaxy://`. Fallback to raw exe if no gameID found. |
| Duplicate detection | `markDuplicates()` cross-references scan candidates against existing `games.json` entries by URI and exe path. `ScanCandidate.alreadyInLibrary` is now always present. |
| Portable games.json path | `Settings.gamesJsonPath` — an optional absolute path. `gamesFile()` reads it. `settings:set` accepts and validates it. |
| App identity | `package.json`: name `sky-launcher`, description, author updated. `electron-builder.yml`: appId `com.skylauncher.app`, productName `Sky Launcher`, executableName `SkyLauncher`. |

**New push subscriptions (return unsubscribe fn):**
- `onLibraryChanged(cb)` — games.json changed on disk
- `onArtProgress(cb)` — per-game art fetch progress
- `onArtDone(cb)` — art batch complete
- `onPlaytimeUpdated(cb)` — game process exited, playtime updated

**New IPC method:** `getVersion()` → `Promise<string>`

**Updated types:** `ScanCandidate` now has `alreadyInLibrary: boolean`. `Settings` now has `gamesJsonPath?: string`. `ArtProgressEvent` added.

### Phases 4–7 — complete (backend)

#### Phase 4 — Cover art (SteamGridDB)

| Method | Returns | Notes |
|--------|---------|-------|
| `fetchArt(id)` | `Promise<WriteResult>` | Fetches grid + hero from SteamGridDB for one game, caches to `%APPDATA%\game-launcher\art-cache\`. Requires `steamGridDbApiKey` in settings. |
| `fetchArtAll()` | `Promise<{ ok, queued }>` | Queues background art fetch for every game with no cached art. Returns immediately — reload library after a delay. |

`GameEntry` now has a `hero?: string` field (wide landscape data URL for the backdrop) alongside `cover`.

**Cover priority per game:** user-set cover image → SteamGridDB grid cache → extracted exe icon → no art.

#### Phase 5 — Play time

| Method | Returns | Notes |
|--------|---------|-------|
| `getPlaytime(id)` | `Promise<PlayRecord \| null>` | Record for one game. `null` if never launched. |
| `getAllPlaytime()` | `Promise<PlaytimeMap>` | All records as `{ [id]: PlayRecord }`. |

`lastPlayed` and `totalMs` are updated automatically on each launch. Session end (window focus after a game launch) is detected via the `win.on('focus')` event.

#### Phase 6 — Settings

| Method | Returns | Notes |
|--------|---------|-------|
| `getSettings()` | `Promise<Settings>` | Reads `settings.json` from userData. |
| `setSettings(patch)` | `Promise<LaunchResult>` | Writes only known fields; unknown keys are dropped. |

**Settings fields:** `steamGridDbApiKey` (string), `minimizeOnLaunch` (boolean, default true).

#### Phases 1–3 requests fulfilled (Antigravity)

- **Exe icon extraction:** `GameEntry.cover` is now automatically populated from `app.getFileIcon()` when a game has an `exe` path and no user-set or cached cover art.
- **`hero` field:** `GameEntry.hero` carries the wide landscape backdrop image. Set by SteamGridDB; never by the user manually.

#### Phase 7 — Security audit

All IPC handlers reviewed:
- Every handler receiving an `id` validates it is a non-empty string before any file or registry access.
- `games:add` and `games:edit` run full `validateEntry()` before writing — exe must be absolute, URIs must match the allowlist.
- `settings:set` only writes a known allowlist of fields; arbitrary keys are silently dropped.
- `games:scan-folder` requires the path to be absolute and existing before walking.
- `games:fetch-art` uses `net.request` (Electron's proxy-aware fetch) — no outbound connections made without an explicit API key set by the user.
- No IPC handler passes renderer-supplied strings to `shell.openExternal` — URIs come exclusively from `games.json`.

### Phase 2 + 3 — complete (backend)

**New IPC channels added via `window.api`:**

| Method | Returns | Notes |
|--------|---------|-------|
| `pickExe()` | `Promise<string \| null>` | Native Windows file dialog, filtered to `.exe`. Returns absolute path or null if cancelled. |
| `pickCover()` | `Promise<string \| null>` | Native file dialog for `.png/.jpg/.jpeg/.webp`. Returns path or null. |
| `pickFolder()` | `Promise<string \| null>` | Native folder dialog. Returns path or null. Pass result to `scanFolder()`. |
| `addGame(input)` | `Promise<WriteResult>` | Validates + appends to `games.json`. Main generates the id. |
| `editGame(id, patch)` | `Promise<WriteResult>` | Merges patch onto existing entry and rewrites `games.json`. |
| `removeGame(id)` | `Promise<LaunchResult>` | Removes entry by id. |
| `revealGame(id)` | `Promise<LaunchResult>` | Opens the game's exe folder in Explorer. |
| `scanStores()` | `Promise<ScanCandidate[]>` | Scans Steam (registry + `.acf` manifests), Epic (`Manifests/*.item`), GOG (registry). Returns candidates — nothing written until `addGame()` is called. |
| `scanFolder(path)` | `Promise<ScanCandidate[]>` | Scans a folder up to 3 levels deep for `.exe` files. `path` must come from `pickFolder()`. |

**New types (from `index.d.ts`):**

```ts
ScanCandidate = { name, exe?, uri?, source: 'steam'|'epic'|'gog'|'folder' }
WriteResult   = { ok, error?, game?: GameEntry }
AddGameInput  = { name, exe?, uri?, cover?, color?, args? }
EditGameInput = { name?, exe?, uri?, cover?, color?, args? }
```

**Add game flow:**
1. UI calls `pickExe()` → receives path
2. UI calls `pickCover()` → receives path (optional)
3. UI calls `addGame({ name, exe: path, cover: coverPath, color })` → receives `{ ok, game }`

**Scan + add flow:**
1. UI calls `scanStores()` → receives `ScanCandidate[]`
   - or: UI calls `pickFolder()` → `scanFolder(path)` → `ScanCandidate[]`
2. User picks candidates they want to keep
3. UI calls `addGame(candidate)` for each confirmed entry

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

### Phase 8 — complete (backend)

#### Firebase Auth

| Method | Returns | Notes |
|--------|---------|-------|
| `authSignIn(email, password)` | `Promise<{ ok, user?, error? }>` | Signs in via Firebase Identity Toolkit REST. Stores `idToken`/`refreshToken` in `settings.json` only — never returned to renderer. |
| `authSignUp(email, password)` | `Promise<{ ok, user?, error? }>` | Creates a new account. Same token storage model. |
| `authSignOut()` | `Promise<LaunchResult>` | Removes auth state from `settings.json`. |
| `getAuthUser()` | `Promise<AuthUser \| null>` | Returns `{ uid, email }` or null. No tokens. |

Tokens are refreshed automatically before any cloud call using the Firebase securetoken endpoint. No Firebase SDK or new npm dependency — uses `net.request` already in the codebase.

#### `savePath` on games

- `Game` and `GameEntry` now support `savePath?: string` (absolute path, validated on write).
- `GameEntry.hasSavePath: boolean` is the only save-path-related field the renderer ever sees — the raw path stays in main.
- New picker: `pickSaveFolder()` opens a folder dialog titled for save-data selection.
- `AddGameInput` and `EditGameInput` accept `savePath`.

#### Cloud sync

| Method | Returns | Notes |
|--------|---------|-------|
| `syncProfile()` | `Promise<LaunchResult>` | Writes games metadata (names, colours, tags, notes — no paths), playtime, and non-secret settings to `users/{uid}/profile/data` in Firestore. Requires sign-in + Firebase config. |
| `backupGameSave(id)` | `Promise<LaunchResult>` | Zips `savePath` via PowerShell `Compress-Archive`, uploads zip to Firebase Storage at `users/{uid}/saves/{id}/latest.zip`. |
| `restoreGameSave(id)` | `Promise<LaunchResult>` | Downloads the latest zip from Storage, extracts it over `savePath` via `Expand-Archive`. |

Auto-backup on game exit is triggered when `settings.autoBackupSaves = true` and the game has a `savePath`.

#### New settings fields

| Field | Type | Notes |
|-------|------|-------|
| `autoBackupSaves` | `boolean` | Triggers save backup on exe game exit. |
| `firebase.apiKey` | `string` | Firebase Web API key. |
| `firebase.projectId` | `string` | Firebase project id. |
| `firebase.storageBucket` | `string` | Firebase Storage bucket (e.g. `myapp.appspot.com`). |

Auth tokens (`idToken`, `refreshToken`) are stored in `settings.json` but are **never returned** by `getSettings()` — the handler strips the `auth` key before sending to the renderer.

#### New type

```ts
AuthUser = { uid: string, email: string }
```

---

## Requests

- **From Kiro → Antigravity (Firebase SDK migration — breaking):**
  Auth has moved from IPC to the Firebase JS SDK running in the renderer. The old `window.api.authSignIn`, `authSignUp`, `authSignOut`, `getAuthUser` IPC methods no longer exist. The UI must migrate:

  1. **`src/lib/firebase.ts`** is the shared config. Import `{ auth, firebaseConfig }` from `@lib/firebase`.
  2. **Sign in:** `import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth'` — call these directly in the renderer. `signInWithPopup(auth, new GoogleAuthProvider())` opens a browser popup for Google Sign-in.
  3. **Get current user:** `auth.currentUser` (synchronous) or `onAuthStateChanged(auth, cb)` (reactive listener).
  4. **Sign out:** `signOut(auth)` from the SDK.
  5. **Cloud methods now require `idToken`:** Before calling `syncProfile()`, `backupGameSave(id)`, or `restoreGameSave(id)`, get the token: `const idToken = await auth.currentUser.getIdToken()`. Pass it as the first (or second) argument: `syncProfile(idToken, uid)`, `backupGameSave(id, idToken)`, `restoreGameSave(id, idToken)`.
  6. **`Settings.firebase`** now includes `authDomain` — include it when saving Firebase config: `{ apiKey, authDomain, projectId, storageBucket }`.

  **Manual one-time setup in Firebase Console** (https://console.firebase.google.com/project/sky-launcher-app):
  - Authentication → Sign-in method → enable Email/Password and Google
  - Firestore Database → Create database (Native mode, region nam5)
  - Storage → Get started
  - Add Firestore security rules so users can only read/write their own data: `allow read, write: if request.auth != null && request.auth.uid == uid;`
