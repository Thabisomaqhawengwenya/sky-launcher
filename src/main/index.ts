import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname, extname, isAbsolute, basename } from 'path'
import { spawn, execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
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

/** A fully-validated game entry that is safe to work with internally. */
type Game = {
  id: string
  name: string
  exe?: string
  args?: string[]
  uri?: string
  cover?: string
  color?: string
}

/** Sent to the renderer — no raw file paths exposed beyond cover (data URL). */
type GameEntry = {
  id: string
  name: string
  cover?: string
  color?: string
}

type LaunchResult = { ok: boolean; error?: string }

type LibraryStatus = {
  ok: boolean
  games: GameEntry[]
  error?: string
  warnings: string[]
}

/** A candidate game returned by scan — not yet saved to games.json. */
type ScanCandidate = {
  name: string
  exe?: string
  uri?: string
  source: 'steam' | 'epic' | 'gog' | 'folder'
}

type WriteResult = { ok: boolean; error?: string; game?: GameEntry }

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

/** exe names that are almost certainly launchers/helpers, not the game itself. */
const LAUNCHER_EXE_BLOCKLIST = new Set([
  'uninstall.exe',
  'unins000.exe',
  'unins001.exe',
  'crashreporter.exe',
  'crashhandler.exe',
  'helper.exe',
  'redist.exe',
  'vcredist_x64.exe',
  'vcredist_x86.exe',
  'vc_redist.x64.exe',
  'vc_redist.x86.exe',
  'dxsetup.exe',
  'dotnetfx.exe',
  'setup.exe',
  'install.exe',
  'installer.exe',
  'unarc.exe',
  'creativeengine.exe'
])

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

function saveGames(games: Game[]): void {
  writeFileSync(gamesFile(), JSON.stringify(games, null, 2), 'utf-8')
}

function validateEntry(raw: RawGame, index: number): Game | string {
  const label = typeof raw.id === 'string' && raw.id ? `"${raw.id}"` : `entry #${index + 1}`

  if (typeof raw.id !== 'string' || !raw.id.trim()) return `${label}: missing or empty "id" field`
  if (typeof raw.name !== 'string' || !raw.name.trim())
    return `${label}: missing or empty "name" field`

  const id = raw.id.trim()
  const name = raw.name.trim()

  if (raw.exe !== undefined) {
    if (typeof raw.exe !== 'string') return `${label}: "exe" must be a string`
    if (!isAbsolute(raw.exe)) return `${label}: "exe" must be an absolute path (got "${raw.exe}")`
  }

  if (raw.uri !== undefined) {
    if (typeof raw.uri !== 'string') return `${label}: "uri" must be a string`
    if (!ALLOWED_URI.test(raw.uri))
      return `${label}: "uri" must start with steam:// or com.epicgames.launcher:// (got "${raw.uri}")`
  }

  if (!raw.exe && !raw.uri) return `${label}: must have at least one of "exe" or "uri"`

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

type LoadResult = { games: Game[]; warnings: string[]; parseError?: string }

function loadGames(): LoadResult {
  const file = gamesFile()

  if (!existsSync(file)) {
    try {
      writeFileSync(file, JSON.stringify(SAMPLE, null, 2), 'utf-8')
    } catch {
      // Proceed with sample in memory if write fails.
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

function toEntry(g: Game): GameEntry {
  return { id: g.id, name: g.name, color: g.color, cover: toDataUrl(g.cover) }
}

// ---------------------------------------------------------------------------
// Launch helper
// ---------------------------------------------------------------------------

function launchExe(exe: string, args: string[]): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd: dirname(exe), detached: true, stdio: 'ignore' })
    child.once('error', (err) => resolve({ ok: false, error: err.message }))
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })
}

// ---------------------------------------------------------------------------
// Unique id generator
// ---------------------------------------------------------------------------

function makeId(name: string, existing: Game[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const ids = new Set(existing.map((g) => g.id))
  if (!ids.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!ids.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

// ---------------------------------------------------------------------------
// Registry helper (no extra package — use the built-in reg.exe)
// ---------------------------------------------------------------------------

function regQuery(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
      // Output looks like:
      //   HKEY_...\Key
      //       ValueName    REG_SZ    C:\path\here
      const match = stdout.match(/REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.+)/)
      resolve(match ? match[1].trim() : null)
    })
  })
}

function regQuerySubkeys(key: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([])
      const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('HKEY_'))
      resolve(lines)
    })
  })
}

// ---------------------------------------------------------------------------
// Store scanners
// ---------------------------------------------------------------------------

/** Parse a Valve VDF text file into a simple flat key→value map. */
function parseVdfFlat(text: string): Map<string, string> {
  const map = new Map<string, string>()
  // Matches: "key"    "value"
  const re = /"([^"]+)"\s+"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    map.set(m[1].toLowerCase(), m[2])
  }
  return map
}

/** Find all Steam library root folders from libraryfolders.vdf. */
function steamLibraryRoots(steamInstall: string): string[] {
  const vdfPath = join(steamInstall, 'steamapps', 'libraryfolders.vdf')
  if (!existsSync(vdfPath)) return [steamInstall]
  try {
    const text = readFileSync(vdfPath, 'utf-8')
    const roots: string[] = [steamInstall]
    const re = /"path"\s+"([^"]+)"/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const p = m[1].replace(/\\\\/g, '\\')
      if (!roots.includes(p)) roots.push(p)
    }
    return roots
  } catch {
    return [steamInstall]
  }
}

async function scanSteam(): Promise<ScanCandidate[]> {
  const candidates: ScanCandidate[] = []

  // Find Steam install path from registry.
  const installPath = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')
  if (!installPath) return candidates

  const roots = steamLibraryRoots(installPath)

  for (const root of roots) {
    const appsDir = join(root, 'steamapps')
    if (!existsSync(appsDir)) continue

    let manifests: string[]
    try {
      manifests = readdirSync(appsDir).filter(
        (f) => f.startsWith('appmanifest_') && f.endsWith('.acf')
      )
    } catch {
      continue
    }

    for (const mf of manifests) {
      try {
        const text = readFileSync(join(appsDir, mf), 'utf-8')
        const kv = parseVdfFlat(text)
        const appid = kv.get('appid')
        const name = kv.get('name')
        const installdir = kv.get('installdir')
        if (!appid || !name || !installdir) continue

        // Prefer the steam:// URI so Steam handles updates / overlays.
        candidates.push({
          name,
          uri: `steam://rungameid/${appid}`,
          source: 'steam'
        })
      } catch {
        continue
      }
    }
  }

  return candidates
}

async function scanEpic(): Promise<ScanCandidate[]> {
  const candidates: ScanCandidate[] = []

  // Epic stores .item JSON manifests here.
  const manifestDir = join(
    process.env['ProgramData'] ?? 'C:\\ProgramData',
    'Epic',
    'EpicGamesLauncher',
    'Data',
    'Manifests'
  )
  if (!existsSync(manifestDir)) return candidates

  let files: string[]
  try {
    files = readdirSync(manifestDir).filter((f) => f.endsWith('.item'))
  } catch {
    return candidates
  }

  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(manifestDir, file), 'utf-8'))
      const name: unknown = raw.DisplayName
      const location: unknown = raw.InstallLocation
      const launchExePath: unknown = raw.LaunchExecutable
      const catalogItemId: unknown = raw.CatalogItemId
      const namespaceProp: unknown = raw.CatalogNamespace

      if (typeof name !== 'string' || !name) continue
      if (typeof location !== 'string' || !location) continue
      if (typeof launchExePath !== 'string' || !launchExePath) continue

      const exeAbs = join(location, launchExePath)

      // Build a com.epicgames.launcher URI if we have the catalog info.
      if (typeof catalogItemId === 'string' && typeof namespaceProp === 'string') {
        candidates.push({
          name,
          uri: `com.epicgames.launcher://apps/${namespaceProp}%3A${catalogItemId}%3A${catalogItemId}?action=launch&silent=true`,
          source: 'epic'
        })
      } else if (existsSync(exeAbs)) {
        candidates.push({ name, exe: exeAbs, source: 'epic' })
      }
    } catch {
      continue
    }
  }

  return candidates
}

async function scanGog(): Promise<ScanCandidate[]> {
  const candidates: ScanCandidate[] = []
  const baseKey = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games'

  const subkeys = await regQuerySubkeys(baseKey)

  for (const subkey of subkeys) {
    const [name, exe] = await Promise.all([regQuery(subkey, 'gameName'), regQuery(subkey, 'exe')])
    if (!name || !exe) continue
    if (!isAbsolute(exe) || !existsSync(exe)) continue
    candidates.push({ name, exe, source: 'gog' })
  }

  return candidates
}

/** Scan a folder up to `depth` levels deep for .exe files. */
function scanFolder(folderPath: string, depth = 3): ScanCandidate[] {
  const candidates: ScanCandidate[] = []

  function walk(dir: string, remaining: number): void {
    if (remaining < 0) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      try {
        const st = statSync(full)
        if (st.isDirectory()) {
          walk(full, remaining - 1)
        } else if (
          extname(entry).toLowerCase() === '.exe' &&
          !LAUNCHER_EXE_BLOCKLIST.has(entry.toLowerCase())
        ) {
          const name = basename(entry, '.exe')
          candidates.push({ name, exe: full, source: 'folder' })
        }
      } catch {
        continue
      }
    }
  }

  walk(folderPath, depth)
  return candidates
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
// App bootstrap + IPC handlers
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.gamelauncher.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // ── Read handlers ──────────────────────────────────────────────────────────

  ipcMain.handle('games:list', (): GameEntry[] => {
    try {
      return loadGames().games.map(toEntry)
    } catch {
      return []
    }
  })

  ipcMain.handle('games:status', (): LibraryStatus => {
    try {
      const { games, warnings, parseError } = loadGames()
      return { ok: !parseError, games: games.map(toEntry), error: parseError, warnings }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, games: [], error: msg, warnings: [] }
    }
  })

  // ── Launch + reveal ────────────────────────────────────────────────────────

  ipcMain.handle('games:launch', async (_e, id: unknown): Promise<LaunchResult> => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid game id.' }

    let result: LaunchResult
    try {
      const { games } = loadGames()
      const game = games.find((g) => g.id === id)
      if (!game)
        return {
          ok: false,
          error: `"${id}" was not found in games.json. The file may have changed — try restarting the launcher.`
        }

      if (game.uri) {
        if (!ALLOWED_URI.test(game.uri))
          return { ok: false, error: 'Only steam:// and Epic links are allowed.' }
        await shell.openExternal(game.uri)
        result = { ok: true }
      } else if (game.exe) {
        if (!existsSync(game.exe))
          return { ok: false, error: `Can't find "${game.exe}". Check the exe path in games.json.` }
        result = await launchExe(game.exe, game.args ?? [])
      } else {
        return { ok: false, error: 'This game has no exe or uri in games.json.' }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Unexpected error launching game: ${msg}` }
    }

    if (result.ok) BrowserWindow.getAllWindows()[0]?.minimize()
    return result
  })

  /** Open the folder containing games.json. */
  ipcMain.handle('games:reveal', (): void => {
    try {
      loadGames()
      shell.showItemInFolder(gamesFile())
    } catch {
      // Not worth surfacing.
    }
  })

  /** Open the folder containing a specific game's exe. */
  ipcMain.handle('games:reveal-game', (_e, id: unknown): LaunchResult => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid game id.' }
    try {
      const { games } = loadGames()
      const game = games.find((g) => g.id === id)
      if (!game) return { ok: false, error: `Game "${id}" not found in games.json.` }
      if (!game.exe) return { ok: false, error: `"${game.name}" has no exe path to reveal.` }
      shell.showItemInFolder(game.exe)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
  })

  // ── File / folder pickers ──────────────────────────────────────────────────

  /** Opens a native file dialog for .exe files. Returns the chosen path or null. */
  ipcMain.handle('games:pick-exe', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Select game executable',
      properties: ['openFile'],
      filters: [{ name: 'Executables', extensions: ['exe'] }]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  /** Opens a native file dialog for cover images. Returns the chosen path or null. */
  ipcMain.handle('games:pick-cover', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Select cover image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  /** Opens a native folder dialog. Returns the chosen folder path or null. */
  ipcMain.handle('games:pick-folder', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Select games folder to scan',
      properties: ['openDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * Add a new game.
   * The renderer sends a plain object with name + either exe or uri (plus optional
   * cover / color). The main process generates the id, validates everything, and
   * appends to games.json.
   *
   * exe and cover are absolute paths that the user chose via pick-exe / pick-cover;
   * they are re-validated here before being written.
   */
  ipcMain.handle('games:add', (_e, input: unknown): WriteResult => {
    try {
      if (typeof input !== 'object' || input === null) return { ok: false, error: 'Invalid input.' }

      const { games } = loadGames()
      const raw = input as RawGame
      const id = makeId(typeof raw.name === 'string' ? raw.name : 'game', games)
      const result = validateEntry({ ...raw, id }, games.length)
      if (typeof result === 'string') return { ok: false, error: result }

      games.push(result)
      saveGames(games)
      return { ok: true, game: toEntry(result) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not save game: ${msg}` }
    }
  })

  /**
   * Edit an existing game by id.
   * Only the fields present in the patch are updated; omitted fields keep their
   * existing values.
   */
  ipcMain.handle('games:edit', (_e, id: unknown, patch: unknown): WriteResult => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid game id.' }
    if (typeof patch !== 'object' || patch === null) return { ok: false, error: 'Invalid patch.' }

    try {
      const { games, parseError } = loadGames()
      if (parseError) return { ok: false, error: parseError }

      const idx = games.findIndex((g) => g.id === id)
      if (idx === -1) return { ok: false, error: `Game "${id}" not found in games.json.` }

      const existing = games[idx]
      const merged: RawGame = {
        id: existing.id,
        name: (patch as RawGame).name ?? existing.name,
        exe: (patch as RawGame).exe ?? existing.exe,
        args: (patch as RawGame).args ?? existing.args,
        uri: (patch as RawGame).uri ?? existing.uri,
        cover: (patch as RawGame).cover ?? existing.cover,
        color: (patch as RawGame).color ?? existing.color
      }

      const result = validateEntry(merged, idx)
      if (typeof result === 'string') return { ok: false, error: result }

      games[idx] = result
      saveGames(games)
      return { ok: true, game: toEntry(result) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not update game: ${msg}` }
    }
  })

  /** Remove a game by id. */
  ipcMain.handle('games:remove', (_e, id: unknown): LaunchResult => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid game id.' }
    try {
      const { games, parseError } = loadGames()
      if (parseError) return { ok: false, error: parseError }

      const before = games.length
      const filtered = games.filter((g) => g.id !== id)
      if (filtered.length === before) return { ok: false, error: `Game "${id}" not found.` }

      saveGames(filtered)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not remove game: ${msg}` }
    }
  })

  // ── Store + folder scanning ────────────────────────────────────────────────

  /**
   * Scan Steam, Epic, and GOG for installed games.
   * Returns candidates — nothing is written to games.json until the user
   * confirms via games:add.
   */
  ipcMain.handle('games:scan', async (): Promise<ScanCandidate[]> => {
    try {
      const [steam, epic, gog] = await Promise.all([scanSteam(), scanEpic(), scanGog()])
      return [...steam, ...epic, ...gog]
    } catch (err) {
      // Return partial results on unexpected error — don't crash.
      const msg = err instanceof Error ? err.message : String(err)
      console.error('games:scan error:', msg)
      return []
    }
  })

  /**
   * Scan a user-chosen folder for .exe files (up to 3 levels deep).
   * The folder path must come from games:pick-folder — the renderer sends
   * the path it received back here.
   */
  ipcMain.handle('games:scan-folder', (_e, folderPath: unknown): ScanCandidate[] => {
    if (typeof folderPath !== 'string' || !folderPath.trim()) return []
    if (!isAbsolute(folderPath) || !existsSync(folderPath)) return []
    try {
      return scanFolder(folderPath)
    } catch {
      return []
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
