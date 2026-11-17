# Sky Launcher

A PS5-inspired Windows 10 desktop game launcher built with **Electron**, **React**, and **TypeScript** (`electron-vite`). Designed for keyboard, mouse, and game controllers.

## Features

- **PS5-Style Console Home UI:** Upper-left square game ribbon with active focus frame, per-game accent lighting, full-bleed hero backdrop, and lower-left Play hub.
- **Full Keyboard & Gamepad Support:**
  - `←` `→` / **D-Pad / Left Stick** — Browse games
  - `Enter` / **A** — Launch game or confirm
  - `Esc` / **B** — Close modal / back
  - `Y` — Open Game Options (Open file location, Fetch artwork, Favourite, Edit, Remove)
  - `Q` / `E` or **LB / RB** — Switch between `Games`, `Recent`, and `Favourites`
  - `F` — Toggle Favourite
  - `/` — Search games
  - `R` — Reload library
  - `F11` — Toggle fullscreen
- **Auto-Detect & Folder Scan:** Scans Steam, Epic Games, GOG, or any local folder you pick for `.exe` games without modifying your library until you confirm.
- **In-App Library Management:** Add, edit, remove, and reveal games in Windows Explorer via native file/folder pickers, with optional custom launch arguments.
- **Automatic Icons & SteamGridDB Artwork:** Extracts `.exe` icons automatically and supports fetching high-res cover + wide hero art from [SteamGridDB](https://www.steamgriddb.com/) (API key configured in Settings).
- **Play-Time Tracking:** Records last played timestamps, total play time, and active running sessions locally.

## Security Architecture

- `contextIsolation` is enabled and `nodeIntegration` is disabled.
- The renderer never receives raw filesystem paths or executes commands—it only sends game IDs and user selections over the typed `window.api` bridge in `src/preload/index.d.ts`.
- All registry reads, folder scans, file dialogs, SteamGridDB requests, and process launches happen exclusively in `src/main`.
- External launch URIs are strictly allowlisted to `steam://` and `com.epicgames.launcher://`.

## Development

```bash
npm install
npm run dev
```

## Quality Checks & Packaging

```bash
npm run typecheck
npm run lint
npm run build
npm run build:win   # Outputs Windows installer in dist/
```

## Library Storage

Games and settings are stored in `%APPDATA%\sky-launcher\`:

- `games.json` — Validated list of games (`id`, `name`, `exe` or `uri`, optional `args`, `cover`, `color`)
- `settings.json` — `steamGridDbApiKey`, `minimizeOnLaunch`
- `playtime.json` — Per-game session and total play time
- `art-cache/` — Cached SteamGridDB cover and hero images
