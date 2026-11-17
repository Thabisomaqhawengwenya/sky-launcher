import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, dirname, extname, isAbsolute } from 'path'
import { spawn } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawGame = {
  id?: unknown
  name?: unknown
  exe?: unknown
  args?: unknown
  uri?: unknown
  cover?: unknown
  color?: unknown
}

/** A fully-validated game entry that is safe to work with. */
type Game = {
  id: string
  name: string
  exe?: string
  args?: string[]
  uri?: string
  cover?: string
  color?: string
}

/** What games:list returns to the renderer — no file paths. */
type GameEntry = {
  id: string
  name: string
  cover?: string // base64 data URL
  color?: string
}

/** What games:launch returns to the renderer. */
type LaunchResult = { ok: boolean; error?: string }

/** What games:status returns to the renderer. */
type LibraryStatus = {
  ok: boolean
  games: GameEntry[]
  error?: string
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_URI = /^(steam|com\.epicgames\.launcher):\/\//

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

const SAMPLE: Game[] = [
  {
    id: 'notepad',
    name: 'Notepad (test launch)',
    exe: 'C:\\Windows\\System32\\notepad.exe',
    color: '#2f6bff'
  },
  {
    id: 'steam-example',
    name: 'Steam game (example)',
    uri: 'steam://rungameid/730',
    color: '#16a085'
  }
]

// ---------------------------------------------------------------------------
// games.json helpers
// ---------------------------------------------------------------------------

function gamesFile(): string {
  return join(app.getPath('userData'), 'games.json')
}

/**
 * Validates a raw parsed object as a Game.
 * Returns the validated Game on success, or a string describing why it failed.
 */
function validateEntry(raw: RawGame, index: number): Game | string {
  const label = typeof raw.id === 'string' && raw.id ? `"${raw.id}"` : `entry #${index + 1}`

  if (typeof raw.id !== 'string' || !raw.id.trim()) return `${label}: missing or empty "id" field`
  if (typeof raw.name !== 'string' || !raw.name.trim())
    return `${label}: missing or empty "name" field`

  const id = raw.id.trim()
  const name = raw.name.trim()

  // exe validation
  if (raw.exe !== undefined) {
    if (typeof raw.exe !== 'string') return `${label}: "exe" must be a string`
    if (!isAbsolute(raw.exe)) return `${label}: "exe" must be an absolute path (got "${raw.exe}")`
  }

  // uri validation
  if (raw.uri !== undefined) {
    if (typeof raw.uri !== 'string') return `${label}: "uri" must be a string`
    if (!ALLOWED_URI.test(raw.uri))
      return `${label}: "uri" must start with steam:// or com.epicgames.launcher:// (got "${raw.uri}")`
  }

  // must have at least one launch method
  if (!raw.exe && !raw.uri) return `${label}: must have at least one of "exe" or "uri"`

  // optional fields — accept or drop silently
  const args =
    Array.isArray(raw.args) && raw.args.every((a) => typeof a === 'string')
      ? (raw.args as string[])
      : undefined

  const cover = typeof raw.cover === 'string' && raw.cover ? raw.cover : undefined

  const color = typeof raw.color === 'string' && raw.color ? raw.color : undefined

  return {
    id,
    name,
    exe: typeof raw.exe === 'string' ? raw.exe : undefined,
    args,
    uri: typeof raw.uri === 'string' ? raw.uri : undefined,
    cover,
    color
  }
}

type LoadResult = {
  games: Game[]
  warnings: string[]
  parseError?: string
}

/**
 * Reads and validates games.json.
 * Never throws. On parse failure returns parseError; individual bad entries
 * go into warnings and are skipped.
 */
function loadGames(): LoadResult {
  const file = gamesFile()

  if (!existsSync(file)) {
    try {
      writeFileSync(file, JSON.stringify(SAMPLE, null, 2), 'utf-8')
    } catch {
      // If we can't write the seed file, just proceed with the sample in memory.
    }
    return { games: SAMPLE, warnings: [] }
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      games: [],
      warnings: [],
      parseError: `games.json could not be parsed: ${msg}. Open games.json and fix the syntax.`
    }
  }

  if (!Array.isArray(raw)) {
    return {
      games: [],
      warnings: [],
      parseError:
        'games.json must contain a JSON array ([ ... ]). Open games.json and check the top-level structure.'
    }
  }

  const games: Game[] = []
  const warnings: string[] = []

  ;(raw as RawGame[]).forEach((entry, i) => {
    const result = validateEntry(entry, i)
    if (typeof result === 'string') {
      warnings.push(result)
    } else {
      games.push(result)
    }
  })

  return { games, warnings }
}

// ---------------------------------------------------------------------------
// Cover art helper
// ---------------------------------------------------------------------------

function toDataUrl(file?: string): string | undefined {
  if (!file) return undefined
  const mime = MIME[extname(file).toLowerCase()]
  if (!mime) return undefined
  try {
    if (!existsSync(file)) return undefined
    return `data:${mime};base64,${readFileSync(file).toString('base64')}`
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Launch helper
// ---------------------------------------------------------------------------

function launchExe(exe: string, args: string[]): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, {
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore'
    })
    child.once('error', (err) => resolve({ ok: false, error: err.message }))
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#070a12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen())
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function toEntry(g: Game): GameEntry {
  return { id: g.id, name: g.name, color: g.color, cover: toDataUrl(g.cover) }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.gamelauncher.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  /**
   * games:list
   * Returns the list of valid games for display. Never exposes file paths.
   * Skips invalid entries silently (they appear in games:status).
   */
  ipcMain.handle('games:list', (): GameEntry[] => {
    try {
      const { games } = loadGames()
      return games.map(toEntry)
    } catch {
      return []
    }
  })

  /**
   * games:status
   * Returns the full library load result so the UI can show parse errors and
   * per-entry warnings without crashing.
   */
  ipcMain.handle('games:status', (): LibraryStatus => {
    try {
      const { games, warnings, parseError } = loadGames()
      return {
        ok: !parseError,
        games: games.map(toEntry),
        error: parseError,
        warnings
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, games: [], error: msg, warnings: [] }
    }
  })

  /**
   * games:launch
   * id must be a string — validated before any file look-up.
   * Exe paths and URIs come exclusively from games.json; the renderer never
   * supplies them.
   */
  ipcMain.handle('games:launch', async (_e, id: unknown): Promise<LaunchResult> => {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: 'Invalid game id.' }
    }

    let result: LaunchResult
    try {
      const { games } = loadGames()
      const game = games.find((g) => g.id === id)
      if (!game) {
        return {
          ok: false,
          error: `"${id}" was not found in games.json. The file may have changed — try restarting the launcher.`
        }
      }

      if (game.uri) {
        // URI allowlist is already enforced by validateEntry, but double-check.
        if (!ALLOWED_URI.test(game.uri)) {
          return { ok: false, error: 'Only steam:// and Epic links are allowed.' }
        }
        await shell.openExternal(game.uri)
        result = { ok: true }
      } else if (game.exe) {
        if (!existsSync(game.exe)) {
          return {
            ok: false,
            error: `Can't find "${game.exe}". Check the exe path in games.json.`
          }
        }
        result = await launchExe(game.exe, game.args ?? [])
      } else {
        // Should not reach here after validation, but be explicit.
        return { ok: false, error: 'This game has no exe or uri in games.json.' }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Unexpected error launching game: ${msg}` }
    }

    if (result.ok) BrowserWindow.getAllWindows()[0]?.minimize()
    return result
  })

  /**
   * games:reveal
   * Opens the folder containing games.json in Explorer.
   */
  ipcMain.handle('games:reveal', (): void => {
    try {
      loadGames() // ensures the file exists
      shell.showItemInFolder(gamesFile())
    } catch {
      // If we can't reveal, do nothing — not worth surfacing.
    }
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
