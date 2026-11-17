import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Only these functions are visible to the UI.
const api = {
  // ── Read ──────────────────────────────────────────────────────────────────
  listGames: () => ipcRenderer.invoke('games:list'),
  getStatus: () => ipcRenderer.invoke('games:status'),

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

  // ── Cover art ─────────────────────────────────────────────────────────────
  fetchArt: (id: string) => ipcRenderer.invoke('games:fetch-art', id),
  fetchArtAll: () => ipcRenderer.invoke('games:fetch-art-all'),

  // ── Play time ─────────────────────────────────────────────────────────────
  getPlaytime: (id: string) => ipcRenderer.invoke('playtime:get', id),
  getAllPlaytime: () => ipcRenderer.invoke('playtime:get-all')
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
