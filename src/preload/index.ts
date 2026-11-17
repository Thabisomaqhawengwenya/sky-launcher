import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Only these functions are visible to the UI.
const api = {
  listGames: () => ipcRenderer.invoke('games:list'),
  launchGame: (id: string) => ipcRenderer.invoke('games:launch', id),
  openGamesFile: () => ipcRenderer.invoke('games:reveal'),
  getStatus: () => ipcRenderer.invoke('games:status')
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
