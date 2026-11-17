import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Only these functions are visible to the UI.
const api = {
  // ── Read ──────────────────────────────────────────────────────────────────
  listGames: () => ipcRenderer.invoke('games:list'),
  getStatus: () => ipcRenderer.invoke('games:status'),
  getVersion: () => ipcRenderer.invoke('app:version'),

  // ── Launch + reveal ───────────────────────────────────────────────────────
  launchGame: (id: string) => ipcRenderer.invoke('games:launch', id),
  openGamesFile: () => ipcRenderer.invoke('games:reveal'),
  revealGame: (id: string) => ipcRenderer.invoke('games:reveal-game', id),

  // ── File / folder pickers ─────────────────────────────────────────────────
  pickExe: () => ipcRenderer.invoke('games:pick-exe'),
  pickCover: () => ipcRenderer.invoke('games:pick-cover'),
  pickFolder: () => ipcRenderer.invoke('games:pick-folder'),

  // ── CRUD ──────────────────────────────────────────────────────────────────
  addGame: (input: object) => ipcRenderer.invoke('games:add', input),
  editGame: (id: string, patch: object) => ipcRenderer.invoke('games:edit', id, patch),
  removeGame: (id: string) => ipcRenderer.invoke('games:remove', id),

  // ── Scanning ──────────────────────────────────────────────────────────────
  scanStores: () => ipcRenderer.invoke('games:scan'),
  scanFolder: (folderPath: string) => ipcRenderer.invoke('games:scan-folder', folderPath),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: object) => ipcRenderer.invoke('settings:set', patch),

  // ── Auto-launch on startup (Feature 4) ───────────────────────────────────
  getLoginItem: () => ipcRenderer.invoke('settings:get-login-item'),
  setLoginItem: (enabled: boolean) => ipcRenderer.invoke('settings:set-login-item', { enabled }),

  // ── Cover art ─────────────────────────────────────────────────────────────
  fetchArt: (id: string) => ipcRenderer.invoke('games:fetch-art', id),
  fetchArtAll: () => ipcRenderer.invoke('games:fetch-art-all'),

  // ── Play time ─────────────────────────────────────────────────────────────
  getPlaytime: (id: string) => ipcRenderer.invoke('playtime:get', id),
  getAllPlaytime: () => ipcRenderer.invoke('playtime:get-all'),

  // ── Play stats (Feature 3) ────────────────────────────────────────────────
  getPlayStats: (id: string) => ipcRenderer.invoke('playtime:stats', id),

  // ── Now Playing pill (Feature 2) ─────────────────────────────────────────
  hidePill: () => ipcRenderer.invoke('pill:hide'),

  // ── Library export / import (Feature 8) ──────────────────────────────────
  exportLibrary: () => ipcRenderer.invoke('games:export'),
  importLibrary: () => ipcRenderer.invoke('games:import'),
  importLibraryConfirm: (filePath: string) => ipcRenderer.invoke('games:import-confirm', filePath),

  // ── Push event subscriptions ─────────────────────────────────────────────
  // These return an unsubscribe function so the UI can clean up.

  /** Called when games.json changes on disk (e.g. user edits it in a text editor). */
  onLibraryChanged: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('library:changed', handler)
    return () => ipcRenderer.removeListener('library:changed', handler)
  },

  /** Called after each game completes in a fetchArtAll() batch. */
  onArtProgress: (
    cb: (event: { id: string; name: string; done: number; total: number; ok: boolean }) => void
  ) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      data: { id: string; name: string; done: number; total: number; ok: boolean }
    ): void => cb(data)
    ipcRenderer.on('art:progress', handler)
    return () => ipcRenderer.removeListener('art:progress', handler)
  },

  /** Called once when a fetchArtAll() batch finishes. */
  onArtDone: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('art:done', handler)
    return () => ipcRenderer.removeListener('art:done', handler)
  },

  /** Called when a tracked game process exits so play time can be refreshed. */
  onPlaytimeUpdated: (cb: (id: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('playtime:updated', handler)
    return () => ipcRenderer.removeListener('playtime:updated', handler)
  },

  /** Called when an exe-launched game exits within 4 seconds with a non-zero code (crash). */
  onGameCrashed: (cb: (id: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('game:crashed', handler)
    return () => ipcRenderer.removeListener('game:crashed', handler)
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
