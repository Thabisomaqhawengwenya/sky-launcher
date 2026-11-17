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
  color?: string
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
}

export type EditGameInput = {
  name?: string
  exe?: string
  uri?: string
  cover?: string
  color?: string
  args?: string[]
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
}

export type PlaytimeMap = Record<string, PlayRecord>

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
    }
  }
}
