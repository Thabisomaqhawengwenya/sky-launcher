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
  pickSaveFolder: () => ipcRenderer.invoke('games:pick-save-folder'),

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
  getLoginItem: () => ipcRenderer.invoke('settings:get-login-item'),
  setLoginItem: (enabled: boolean) => ipcRenderer.invoke('settings:set-login-item', { enabled }),

  // ── Cover art ─────────────────────────────────────────────────────────────
  fetchArt: (id: string) => ipcRenderer.invoke('games:fetch-art', id),
  fetchArtAll: () => ipcRenderer.invoke('games:fetch-art-all'),

  // ── Play time ─────────────────────────────────────────────────────────────
  getPlaytime: (id: string) => ipcRenderer.invoke('playtime:get', id),
  getAllPlaytime: () => ipcRenderer.invoke('playtime:get-all'),
  getPlayStats: (id: string) => ipcRenderer.invoke('playtime:stats', id),

  // ── Pill ──────────────────────────────────────────────────────────────────
  hidePill: () => ipcRenderer.invoke('pill:hide'),

  // ── Library export / import ───────────────────────────────────────────────
  exportLibrary: () => ipcRenderer.invoke('games:export'),
  importLibrary: () => ipcRenderer.invoke('games:import'),
  importLibraryConfirm: (filePath: string) => ipcRenderer.invoke('games:import-confirm', filePath),

  // ── Firebase Auth ─────────────────────────────────────────────────────────
  authSignIn: (email: string, password: string) =>
    ipcRenderer.invoke('auth:sign-in', { email, password }),
  authSignUp: (email: string, password: string) =>
    ipcRenderer.invoke('auth:sign-up', { email, password }),
  authSignOut: () => ipcRenderer.invoke('auth:sign-out'),
  getAuthUser: () => ipcRenderer.invoke('auth:get-user'),

  // ── Cloud sync ────────────────────────────────────────────────────────────
  syncProfile: () => ipcRenderer.invoke('cloud:sync-profile'),
  backupGameSave: (id: string) => ipcRenderer.invoke('save:backup', id),
  restoreGameSave: (id: string) => ipcRenderer.invoke('save:restore', id),

  // ── Push event subscriptions ─────────────────────────────────────────────
  onLibraryChanged: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('library:changed', handler)
    return () => ipcRenderer.removeListener('library:changed', handler)
  },

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

  onArtDone: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('art:done', handler)
    return () => ipcRenderer.removeListener('art:done', handler)
  },

  onPlaytimeUpdated: (cb: (id: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('playtime:updated', handler)
    return () => ipcRenderer.removeListener('playtime:updated', handler)
  },

  onGameCrashed: (cb: (id: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('game:crashed', handler)
    return () => ipcRenderer.removeListener('game:crashed', handler)
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
