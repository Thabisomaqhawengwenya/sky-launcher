import { ElectronAPI } from '@electron-toolkit/preload'

/** A game entry safe to render — contains no file-system paths. */
export type GameEntry = {
  id: string
  name: string
  /** Base64 data URL for the cover image, if one was found on disk. */
  cover?: string
  /** CSS colour string used as the per-game accent, e.g. "#2f6bff". */
  color?: string
}

/** Returned by launchGame(). */
export type LaunchResult = {
  ok: boolean
  /** Plain-language error shown directly to the user when ok is false. */
  error?: string
}

/**
 * Returned by getStatus().
 * ok is false only when games.json exists but cannot be parsed.
 * warnings lists entries that were skipped and why (one string per entry).
 */
export type LibraryStatus = {
  ok: boolean
  games: GameEntry[]
  /** Set when the file exists but cannot be parsed. */
  error?: string
  /** One entry per skipped game, describing why it was rejected. */
  warnings: string[]
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      /** Returns all valid games. Never throws; returns [] on any error. */
      listGames(): Promise<GameEntry[]>
      /**
       * Launches a game by id.
       * The renderer must only send the id — paths and URIs come from
       * games.json inside the main process.
       */
      launchGame(id: string): Promise<LaunchResult>
      /** Opens the folder containing games.json in Windows Explorer. */
      openGamesFile(): Promise<void>
      /**
       * Returns the full library load result.
       * Use this to show parse errors and skipped-entry warnings in the UI.
       */
      getStatus(): Promise<LibraryStatus>
    }
  }
}
