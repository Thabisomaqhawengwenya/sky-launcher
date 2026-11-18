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
  /** User-set accent colour. */
  color?: string
  /** Dominant colour auto-extracted from cover art when no user colour is set. */
  autoColor?: string
  /** Free-text notes (max 500 chars). */
  notes?: string
  /** User-defined tags (max 20, 30 chars each). */
  tags?: string[]
  /** True if a save-data folder path is configured for this game. */
  hasSavePath: boolean
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
  notes?: string
  tags?: string[]
  /** Absolute path to the game's save-data folder. Never returned to renderer raw. */
  savePath?: string
}

export type EditGameInput = {
  name?: string
  exe?: string
  uri?: string
  cover?: string
  color?: string
  args?: string[]
  notes?: string
  tags?: string[]
  savePath?: string
}

export type Settings = {
  steamGridDbApiKey?: string
  minimizeOnLaunch?: boolean
  gamesJsonPath?: string
  autoBackupSaves?: boolean
  /** Firebase project configuration. Required for cloud sync and save backup. */
  firebase?: FirebaseConfig
}

export type PlayRecord = {
  id: string
  lastPlayed: string
  totalMs: number
  sessionStart?: string
  sessions?: number
  firstPlayed?: string
}

export type PlaytimeMap = Record<string, PlayRecord>

export type PlayStats = {
  sessions: number
  totalMs: number
  avgSessionMs: number
  longestSessionMs: number
  firstPlayed: string
  lastPlayed: string
}

export type ArtProgressEvent = {
  id: string
  name: string
  done: number
  total: number
  ok: boolean
}

/** The signed-in user. Only uid and email — no tokens. */
export type AuthUser = {
  uid: string
  email: string
}

export type FirebaseConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
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
      getVersion(): Promise<string>

      // ── Launch + reveal ──────────────────────────────────────────────────
      launchGame(id: string): Promise<LaunchResult>
      openGamesFile(): Promise<void>
      revealGame(id: string): Promise<LaunchResult>

      // ── File / folder pickers ────────────────────────────────────────────
      pickExe(): Promise<string | null>
      pickCover(): Promise<string | null>
      pickFolder(): Promise<string | null>
      /** Opens a folder picker labelled for save-data selection. */
      pickSaveFolder(): Promise<string | null>

      // ── CRUD ────────────────────────────────────────────────────────────
      addGame(input: AddGameInput): Promise<WriteResult>
      editGame(id: string, patch: EditGameInput): Promise<WriteResult>
      removeGame(id: string): Promise<LaunchResult>

      // ── Scanning ────────────────────────────────────────────────────────
      scanStores(): Promise<ScanCandidate[]>
      scanFolder(folderPath: string): Promise<ScanCandidate[]>

      // ── Settings ────────────────────────────────────────────────────────
      /** Returns settings excluding auth tokens — those never leave main. */
      getSettings(): Promise<Settings>
      setSettings(patch: Partial<Settings>): Promise<LaunchResult>
      getLoginItem(): Promise<{ enabled: boolean }>
      setLoginItem(enabled: boolean): Promise<LaunchResult>

      // ── Cover art ───────────────────────────────────────────────────────
      fetchArt(id: string): Promise<WriteResult>
      fetchArtAll(): Promise<{ ok: boolean; queued: number }>

      // ── Play time ───────────────────────────────────────────────────────
      getPlaytime(id: string): Promise<PlayRecord | null>
      getAllPlaytime(): Promise<PlaytimeMap>
      getPlayStats(id: string): Promise<PlayStats>

      // ── Pill ─────────────────────────────────────────────────────────────
      hidePill(): Promise<void>

      // ── Library export / import ──────────────────────────────────────────
      exportLibrary(): Promise<LaunchResult>
      importLibrary(): Promise<{
        ok: boolean
        filePath?: string
        games?: GameEntry[]
        warnings?: string[]
        error?: string
      }>
      importLibraryConfirm(filePath: string): Promise<LaunchResult>

      // ── Firebase Auth ────────────────────────────────────────────────────
      // Auth runs in the renderer via the Firebase JS SDK (@lib/firebase).
      // The renderer calls signInWithEmailAndPassword / signInWithPopup (Google)
      // directly, then passes the resulting idToken to the cloud methods below.

      // ── Cloud sync ───────────────────────────────────────────────────────
      /**
       * Sync games metadata, playtime, and settings to Firestore.
       * Requires the user's idToken and uid from the Firebase SDK in the renderer.
       * Never syncs exe paths, save paths, or the SteamGridDB API key.
       */
      syncProfile(idToken: string, uid: string): Promise<LaunchResult>
      /**
       * Zip the game's save folder and upload it to Firebase Storage.
       * The game must have a savePath set. Requires the user's idToken.
       */
      backupGameSave(id: string, idToken: string): Promise<LaunchResult>
      /**
       * Download the latest save backup from Firebase Storage and
       * extract it over the game's save folder. Requires the user's idToken.
       */
      restoreGameSave(id: string, idToken: string): Promise<LaunchResult>

      // ── Push event subscriptions ─────────────────────────────────────────
      onLibraryChanged(cb: () => void): () => void
      onArtProgress(cb: (event: ArtProgressEvent) => void): () => void
      onArtDone(cb: () => void): () => void
      onPlaytimeUpdated(cb: (id: string) => void): () => void
      onGameCrashed(cb: (id: string) => void): () => void
    }
  }
}
