import { ElectronAPI } from '@electron-toolkit/preload'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type GameEntry = {
  id: string
  name: string
  /** Base64 data URL — user cover, SteamGridDB grid, or extracted exe icon. */
  cover?: string
  /** Base64 data URL — wide landscape art for the backdrop (SteamGridDB hero). */
  hero?: string
  /** User-set accent colour override. */
  color?: string
  /** Automatically extracted dominant colour from cover art when no user colour is set. */
  autoColor?: string
  /** Free-text notes about the game (max 500 chars). */
  notes?: string
  /** User-defined tags (max 20, 30 chars each). */
  tags?: string[]
}

export type LaunchResult = {
  ok: boolean
  error?: string
}

export type LibraryStatus = {
  ok: boolean
  games: GameEntry[]
  error?: string
  warnings: string[]
}

export type ScanCandidate = {
  name: string
  exe?: string
  uri?: string
  source: 'steam' | 'epic' | 'gog' | 'folder'
  /** True if a game with the same URI or exe already exists in games.json. */
  alreadyInLibrary: boolean
}

export type WriteResult = {
  ok: boolean
  error?: string
  game?: GameEntry
}

export type AddGameInput = {
  name: string
  exe?: string
  uri?: string
  cover?: string
  color?: string
  args?: string[]
  /** Free-text notes (max 500 chars). */
  notes?: string
  /** User-defined tags (max 20, 30 chars each). */
  tags?: string[]
}

export type EditGameInput = {
  name?: string
  exe?: string
  uri?: string
  cover?: string
  color?: string
  args?: string[]
  /** Free-text notes (max 500 chars). */
  notes?: string
  /** User-defined tags (max 20, 30 chars each). */
  tags?: string[]
}

export type Settings = {
  steamGridDbApiKey?: string
  minimizeOnLaunch?: boolean
  /**
   * Optional absolute path to a custom games.json file.
   * Useful for keeping the library on a synced drive.
   * Leave empty to use the default %APPDATA%\game-launcher\games.json.
   */
  gamesJsonPath?: string
}

export type PlayRecord = {
  id: string
  lastPlayed: string
  totalMs: number
  sessionStart?: string
  /** Number of times the game has been launched. */
  sessions?: number
  /** ISO timestamp of the very first launch. */
  firstPlayed?: string
}

export type PlaytimeMap = Record<string, PlayRecord>

/** Derived play statistics for a single game. */
export type PlayStats = {
  /** Number of recorded launch sessions. */
  sessions: number
  /** Total play time in milliseconds. */
  totalMs: number
  /** Average session length in milliseconds. */
  avgSessionMs: number
  /**
   * Longest single session in milliseconds.
   * Without per-session history this equals totalMs (worst-case one session).
   */
  longestSessionMs: number
  /** ISO timestamp of the first launch, or empty string if never played. */
  firstPlayed: string
  /** ISO timestamp of the most recent launch, or empty string if never played. */
  lastPlayed: string
}

/** Pushed by main during a fetchArtAll() batch. */
export type ArtProgressEvent = {
  id: string
  name: string
  done: number
  total: number
  ok: boolean
}

// ---------------------------------------------------------------------------
// Window API
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // ── Read ────────────────────────────────────────────────────────────
      listGames(): Promise<GameEntry[]>
      getStatus(): Promise<LibraryStatus>
      /** Returns the app version string from package.json, e.g. "1.0.0". */
      getVersion(): Promise<string>

      // ── Launch + reveal ──────────────────────────────────────────────────
      launchGame(id: string): Promise<LaunchResult>
      openGamesFile(): Promise<void>
      revealGame(id: string): Promise<LaunchResult>

      // ── File / folder pickers ────────────────────────────────────────────
      pickExe(): Promise<string | null>
      pickCover(): Promise<string | null>
      pickFolder(): Promise<string | null>

      // ── CRUD ────────────────────────────────────────────────────────────
      addGame(input: AddGameInput): Promise<WriteResult>
      editGame(id: string, patch: EditGameInput): Promise<WriteResult>
      removeGame(id: string): Promise<LaunchResult>

      // ── Scanning ────────────────────────────────────────────────────────
      /** Scan Steam, Epic, GOG. Candidates include alreadyInLibrary flag. */
      scanStores(): Promise<ScanCandidate[]>
      scanFolder(folderPath: string): Promise<ScanCandidate[]>

      // ── Settings ────────────────────────────────────────────────────────
      getSettings(): Promise<Settings>
      setSettings(patch: Partial<Settings>): Promise<LaunchResult>

      /**
       * Returns whether Sky Launcher is configured to open at Windows login.
       * Uses the OS login-item API — separate from settings.json.
       */
      getLoginItem(): Promise<{ enabled: boolean }>

      /**
       * Enable or disable Sky Launcher opening at Windows login.
       * Pass `true` to enable, `false` to disable.
       */
      setLoginItem(enabled: boolean): Promise<LaunchResult>

      // ── Cover art ───────────────────────────────────────────────────────
      fetchArt(id: string): Promise<WriteResult>
      /**
       * Start a background art fetch for all games without cached art.
       * Subscribe to onArtProgress / onArtDone for real-time updates.
       */
      fetchArtAll(): Promise<{ ok: boolean; queued: number }>

      // ── Play time ───────────────────────────────────────────────────────
      getPlaytime(id: string): Promise<PlayRecord | null>
      getAllPlaytime(): Promise<PlaytimeMap>

      /**
       * Returns derived play statistics for a game: session count, total time,
       * average session, longest session, first and last played dates.
       */
      getPlayStats(id: string): Promise<PlayStats>

      // ── Now Playing pill ─────────────────────────────────────────────────
      /**
       * Dismiss the floating "Now Playing" pill overlay.
       * Useful when the launcher window is restored by the user.
       */
      hidePill(): Promise<void>

      // ── Library export / import ──────────────────────────────────────────
      /**
       * Open a Save dialog and write the current games.json to the chosen path.
       */
      exportLibrary(): Promise<LaunchResult>

      /**
       * Open an Open dialog, parse and validate the chosen JSON file,
       * and return a preview without writing anything.
       * On success the returned `filePath` can be passed to importLibraryConfirm.
       */
      importLibrary(): Promise<{
        ok: boolean
        filePath?: string
        games?: GameEntry[]
        warnings?: string[]
        error?: string
      }>

      /**
       * Re-reads and re-validates the file at `filePath` (must be the path
       * returned by importLibrary), then overwrites the active games.json.
       * Always re-validates on the main side — never trusts the renderer's parse.
       */
      importLibraryConfirm(filePath: string): Promise<LaunchResult>

      // ── Push event subscriptions ─────────────────────────────────────────
      /**
       * Called when games.json changes on disk (file watcher).
       * Returns an unsubscribe function — call it in a useEffect cleanup.
       */
      onLibraryChanged(cb: () => void): () => void
      /**
       * Called after each game completes in a fetchArtAll() batch.
       * Returns an unsubscribe function.
       */
      onArtProgress(cb: (event: ArtProgressEvent) => void): () => void
      /**
       * Called once when a fetchArtAll() batch finishes.
       * Returns an unsubscribe function.
       */
      onArtDone(cb: () => void): () => void
      /**
       * Called when an exe-launched game process exits so play time
       * can be refreshed without waiting for the next window focus.
       * Returns an unsubscribe function.
       */
      onPlaytimeUpdated(cb: (id: string) => void): () => void
      /**
       * Called when an exe-launched game exits within 4 seconds with a non-zero
       * exit code — indicating a likely crash. The launcher window is automatically
       * restored. Returns an unsubscribe function.
       */
      onGameCrashed(cb: (id: string) => void): () => void
    }
  }
}
