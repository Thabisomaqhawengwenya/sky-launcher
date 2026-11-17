import { app, shell, BrowserWindow, ipcMain, dialog, net } from 'electron'
import { join, dirname, extname, isAbsolute, basename } from 'path'
import { spawn, execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs'
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
  cover?: string // path on disk
  color?: string
}

/** Sent to the renderer — no raw file paths. cover and hero are data URLs. */
type GameEntry = {
  id: string
  name: string
  cover?: string // base64 data URL (tile art / exe icon)
  hero?: string // base64 data URL (wide backdrop art)
  color?: string
}

type LaunchResult = { ok: boolean; error?: string }

type LibraryStatus = {
  ok: boolean
  games: GameEntry[]
  error?: string
  warnings: string[]
}

type ScanCandidate = {
  name: string
  exe?: string
  uri?: string
  source: 'steam' | 'epic' | 'gog' | 'folder'
}

type WriteResult = { ok: boolean; error?: string; game?: GameEntry }

/** Per-game play time record stored in playtime.json. */
type PlayRecord = {
  id: string
  lastPlayed: string // ISO 8601
  totalMs: number // accumulated play time in milliseconds
  sessionStart?: string // ISO 8601, set when a session is in progress
}

type PlaytimeMap = Record<string, PlayRecord>

/** App settings stored in settings.json. */
type Settings = {
  steamGridDbApiKey?: string
  minimizeOnLaunch?: boolean // default true
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
// File path helpers
// ---------------------------------------------------------------------------

function gamesFile(): string {
  return join(app.getPath('userData'), 'games.json')
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function playtimeFile(): string {
  return join(app.getPath('userData'), 'playtime.json')
}

/** Directory for cached SteamGridDB images. */
function artCacheDir(): string {
  const dir = join(app.getPath('userData'), 'art-cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function loadSettings(): Settings {
  try {
    if (!existsSync(settingsFile())) return {}
    const raw: unknown = JSON.parse(readFileSync(settingsFile(), 'utf-8'))
    if (typeof raw !== 'object' || raw === null) return {}
    const s = raw as Record<string, unknown>
    const out: Settings = {}
    if (typeof s.steamGridDbApiKey === 'string') out.steamGridDbApiKey = s.steamGridDbApiKey
    if (typeof s.minimizeOnLaunch === 'boolean') out.minimizeOnLaunch = s.minimizeOnLaunch
    return out
  } catch {
    return {}
  }
}

function saveSettings(patch: Partial<Settings>): void {
  const current = loadSettings()
  const next: Settings = { ...current, ...patch }
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// Playtime helpers
// ---------------------------------------------------------------------------

function loadPlaytime(): PlaytimeMap {
  try {
    if (!existsSync(playtimeFile())) return {}
    const raw: unknown = JSON.parse(readFileSync(playtimeFile(), 'utf-8'))
    return typeof raw === 'object' && raw !== null ? (raw as PlaytimeMap) : {}
  } catch {
    return {}
  }
}

function savePlaytime(map: PlaytimeMap): void {
  writeFileSync(playtimeFile(), JSON.stringify(map, null, 2), 'utf-8')
}

/** Called when a game is launched. Records lastPlayed and starts session timer. */
function recordLaunch(id: string): void {
  try {
    const map = loadPlaytime()
    const existing = map[id] ?? { id, lastPlayed: '', totalMs: 0 }
    map[id] = {
      ...existing,
      lastPlayed: new Date().toISOString(),
      sessionStart: new Date().toISOString()
    }
    savePlaytime(map)
  } catch {
    // Non-critical — ignore.
  }
}

/** Called when the launcher window is restored/focused after a game launch.
 *  Ends the in-progress session and adds its duration to totalMs. */
function recordSessionEnd(id: string): void {
  try {
    const map = loadPlaytime()
    const rec = map[id]
    if (!rec?.sessionStart) return
    const elapsed = Date.now() - new Date(rec.sessionStart).getTime()
    map[id] = {
      ...rec,
      totalMs: (rec.totalMs ?? 0) + Math.max(0, elapsed),
      sessionStart: undefined
    }
    savePlaytime(map)
  } catch {
    // Non-critical — ignore.
  }
}

// ---------------------------------------------------------------------------
// games.json helpers
// ---------------------------------------------------------------------------

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
      // Proceed with sample in memory.
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
    if (typeof result === 'string') warnings.push(result)
    else games.push(result)
  })

  return { games, warnings }
}

// ---------------------------------------------------------------------------
// Art helpers — disk cover, exe icon, SteamGridDB cache
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

/** Extract the Windows shell icon from an .exe as a PNG data URL. */
async function exeIconDataUrl(exe: string): Promise<string | undefined> {
  try {
    const img = await app.getFileIcon(exe, { size: 'large' })
    return img.toDataURL()
  } catch {
    return undefined
  }
}

/** Return the cached SteamGridDB art paths for a game id, if they exist. */
function cachedArtPaths(id: string): { cover?: string; hero?: string } {
  const dir = artCacheDir()
  const coverPath = join(dir, `${id}-cover.png`)
  const heroPath = join(dir, `${id}-hero.png`)
  return {
    cover: existsSync(coverPath) ? coverPath : undefined,
    hero: existsSync(heroPath) ? heroPath : undefined
  }
}

/** Build a GameEntry from a Game. Loads exe icons asynchronously when needed. */
async function toEntry(g: Game): Promise<GameEntry> {
  const cached = cachedArtPaths(g.id)

  // Cover priority: disk path set by user → SteamGridDB cache → exe icon → undefined
  const cover: string | undefined =
    toDataUrl(g.cover) ??
    toDataUrl(cached.cover) ??
    (g.exe ? await exeIconDataUrl(g.exe) : undefined)

  // Hero: SteamGridDB cache only (users don't set heroes manually)
  const hero: string | undefined = toDataUrl(cached.hero)

  return { id: g.id, name: g.name, color: g.color, cover, hero }
}

// ---------------------------------------------------------------------------
// SteamGridDB
// ---------------------------------------------------------------------------

const SGDB_BASE = 'https://www.steamgriddb.com/api/v2'

/**
 * Fetch a URL using Electron's net module (respects proxy settings, works
 * in the main process without Node's http — no extra dependency needed).
 */
function fetchJson(url: string, apiKey: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET' })
    req.setHeader('Authorization', `Bearer ${apiKey}`)
    req.setHeader('Accept', 'application/json')
    const chunks: Buffer[] = []
    req.on('response', (res) => {
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
        } catch {
          reject(new Error('JSON parse failed'))
        }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

function fetchBinary(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET' })
    const chunks: Buffer[] = []
    req.on('response', (res) => {
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Extract the numeric Steam app id from a steam:// URI, or null.
 * steam://rungameid/730 → "730"
 */
function steamAppIdFromUri(uri?: string): string | null {
  if (!uri) return null
  const m = uri.match(/^steam:\/\/rungameid\/(\d+)$/)
  return m ? m[1] : null
}

type SgdbArtResult = { coverUrl?: string; heroUrl?: string }

/** Fetch grid (cover) and hero URLs from SteamGridDB for one game.
 *  Tries by Steam app id first; falls back to name search. */
async function fetchSgdbArt(
  _gameId: string,
  gameName: string,
  uri: string | undefined,
  apiKey: string
): Promise<SgdbArtResult> {
  try {
    let sgdbId: number | null = null

    // ── Resolve the SGDB game id ──────────────────────────────────────────
    const steamAppId = steamAppIdFromUri(uri)
    if (steamAppId) {
      const res = (await fetchJson(`${SGDB_BASE}/games/steam/${steamAppId}`, apiKey)) as {
        success?: boolean
        data?: { id?: number }
      }
      if (res.success && typeof res.data?.id === 'number') sgdbId = res.data.id
    }

    if (sgdbId === null) {
      const q = encodeURIComponent(gameName)
      const res = (await fetchJson(`${SGDB_BASE}/search/autocomplete/${q}`, apiKey)) as {
        success?: boolean
        data?: Array<{ id?: number }>
      }
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        const first = res.data[0]
        if (typeof first?.id === 'number') sgdbId = first.id
      }
    }

    if (sgdbId === null) return {}

    // ── Fetch grid (portrait cover) ───────────────────────────────────────
    let coverUrl: string | undefined
    const gridRes = (await fetchJson(
      `${SGDB_BASE}/grids/game/${sgdbId}?dimensions=600x900`,
      apiKey
    )) as { success?: boolean; data?: Array<{ url?: string }> }
    if (gridRes.success && Array.isArray(gridRes.data) && gridRes.data.length > 0) {
      coverUrl = gridRes.data[0].url
    }

    // ── Fetch hero (landscape backdrop) ──────────────────────────────────
    let heroUrl: string | undefined
    const heroRes = (await fetchJson(`${SGDB_BASE}/heroes/game/${sgdbId}`, apiKey)) as {
      success?: boolean
      data?: Array<{ url?: string }>
    }
    if (heroRes.success && Array.isArray(heroRes.data) && heroRes.data.length > 0) {
      heroUrl = heroRes.data[0].url
    }

    return { coverUrl, heroUrl }
  } catch {
    return {}
  }
}

/** Download one image URL and save it to the art cache. Returns the saved path. */
async function downloadAndCache(url: string, destPath: string): Promise<string | undefined> {
  try {
    const buf = await fetchBinary(url)
    writeFileSync(destPath, buf)
    return destPath
  } catch {
    return undefined
  }
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
// Registry helpers
// ---------------------------------------------------------------------------

function regQuery(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
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

function parseVdfFlat(text: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /"([^"]+)"\s+"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) map.set(m[1].toLowerCase(), m[2])
  return map
}

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
        const kv = parseVdfFlat(readFileSync(join(appsDir, mf), 'utf-8'))
        const appid = kv.get('appid')
        const name = kv.get('name')
        const installdir = kv.get('installdir')
        if (!appid || !name || !installdir) continue
        candidates.push({ name, uri: `steam://rungameid/${appid}`, source: 'steam' })
      } catch {
        continue
      }
    }
  }
  return candidates
}

async function scanEpic(): Promise<ScanCandidate[]> {
  const candidates: ScanCandidate[] = []
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
      const launchExe: unknown = raw.LaunchExecutable
      const catalogItemId: unknown = raw.CatalogItemId
      const namespaceProp: unknown = raw.CatalogNamespace
      if (typeof name !== 'string' || !name) continue
      if (typeof location !== 'string' || !location) continue
      if (typeof launchExe !== 'string' || !launchExe) continue
      const exeAbs = join(location, launchExe)
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
  const subkeys = await regQuerySubkeys('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games')
  for (const subkey of subkeys) {
    const [name, exe] = await Promise.all([regQuery(subkey, 'gameName'), regQuery(subkey, 'exe')])
    if (!name || !exe) continue
    if (!isAbsolute(exe) || !existsSync(exe)) continue
    candidates.push({ name, exe, source: 'gog' })
  }
  return candidates
}

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
          candidates.push({ name: basename(entry, '.exe'), exe: full, source: 'folder' })
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

/** Id of the game whose session we should end when the window regains focus. */
let pendingSessionEnd: string | null = null

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

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
    if (process.platform === 'win32') win.moveTop()
  })

  // When the launcher window is restored after a game launch, end the session.
  win.on('focus', () => {
    if (pendingSessionEnd) {
      recordSessionEnd(pendingSessionEnd)
      pendingSessionEnd = null
    }
  })

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

  // ── Read ──────────────────────────────────────────────────────────────────

  ipcMain.handle('games:list', async (): Promise<GameEntry[]> => {
    try {
      const { games } = loadGames()
      return await Promise.all(games.map(toEntry))
    } catch {
      return []
    }
  })

  ipcMain.handle('games:status', async (): Promise<LibraryStatus> => {
    try {
      const { games, warnings, parseError } = loadGames()
      const entries = await Promise.all(games.map(toEntry))
      return { ok: !parseError, games: entries, error: parseError, warnings }
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
          return {
            ok: false,
            error: `Can't find "${game.exe}". Check the exe path in games.json.`
          }
        result = await launchExe(game.exe, game.args ?? [])
      } else {
        return { ok: false, error: 'This game has no exe or uri in games.json.' }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Unexpected error launching game: ${msg}` }
    }

    if (result.ok) {
      recordLaunch(id)
      pendingSessionEnd = id
      const settings = loadSettings()
      const shouldMinimize = settings.minimizeOnLaunch !== false // default true
      if (shouldMinimize) BrowserWindow.getAllWindows()[0]?.minimize()
    }
    return result
  })

  ipcMain.handle('games:reveal', (): void => {
    try {
      loadGames()
      shell.showItemInFolder(gamesFile())
    } catch {
      // Not worth surfacing.
    }
  })

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

  // ── File / folder pickers ─────────────────────────────────────────────────

  ipcMain.handle('games:pick-exe', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Select game executable',
      properties: ['openFile'],
      filters: [{ name: 'Executables', extensions: ['exe'] }]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('games:pick-cover', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Select cover image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('games:pick-folder', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: 'Select games folder to scan',
      properties: ['openDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  // ── CRUD ──────────────────────────────────────────────────────────────────

  ipcMain.handle('games:add', async (_e, input: unknown): Promise<WriteResult> => {
    try {
      if (typeof input !== 'object' || input === null) return { ok: false, error: 'Invalid input.' }
      const { games } = loadGames()
      const raw = input as RawGame
      const id = makeId(typeof raw.name === 'string' ? raw.name : 'game', games)
      const result = validateEntry({ ...raw, id }, games.length)
      if (typeof result === 'string') return { ok: false, error: result }
      games.push(result)
      saveGames(games)
      return { ok: true, game: await toEntry(result) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not save game: ${msg}` }
    }
  })

  ipcMain.handle('games:edit', async (_e, id: unknown, patch: unknown): Promise<WriteResult> => {
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
      return { ok: true, game: await toEntry(result) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not update game: ${msg}` }
    }
  })

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

  // ── Store + folder scanning ───────────────────────────────────────────────

  ipcMain.handle('games:scan', async (): Promise<ScanCandidate[]> => {
    try {
      const [steam, epic, gog] = await Promise.all([scanSteam(), scanEpic(), scanGog()])
      return [...steam, ...epic, ...gog]
    } catch (err) {
      console.error('games:scan error:', err instanceof Error ? err.message : String(err))
      return []
    }
  })

  ipcMain.handle('games:scan-folder', (_e, folderPath: unknown): ScanCandidate[] => {
    if (typeof folderPath !== 'string' || !folderPath.trim()) return []
    if (!isAbsolute(folderPath) || !existsSync(folderPath)) return []
    try {
      return scanFolder(folderPath)
    } catch {
      return []
    }
  })

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', (): Settings => {
    return loadSettings()
  })

  ipcMain.handle('settings:set', (_e, patch: unknown): LaunchResult => {
    if (typeof patch !== 'object' || patch === null) return { ok: false, error: 'Invalid patch.' }
    try {
      // Only accept known fields — ignore anything else.
      const p = patch as Record<string, unknown>
      const safe: Partial<Settings> = {}
      if (typeof p.steamGridDbApiKey === 'string') safe.steamGridDbApiKey = p.steamGridDbApiKey
      if (typeof p.minimizeOnLaunch === 'boolean') safe.minimizeOnLaunch = p.minimizeOnLaunch
      saveSettings(safe)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not save settings: ${msg}` }
    }
  })

  // ── Cover art (SteamGridDB) ───────────────────────────────────────────────

  /**
   * Fetch cover + hero art from SteamGridDB for a single game and cache to disk.
   * Returns the updated GameEntry (with new cover/hero data URLs) so the UI can
   * refresh without reloading the whole library.
   * No-ops silently if no API key is configured.
   */
  ipcMain.handle('games:fetch-art', async (_e, id: unknown): Promise<WriteResult> => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid game id.' }

    const { steamGridDbApiKey } = loadSettings()
    if (!steamGridDbApiKey) {
      return {
        ok: false,
        error: 'No SteamGridDB API key set. Add one in Settings to fetch cover art.'
      }
    }

    const { games } = loadGames()
    const game = games.find((g) => g.id === id)
    if (!game) return { ok: false, error: `Game "${id}" not found.` }

    const { coverUrl, heroUrl } = await fetchSgdbArt(
      game.id,
      game.name,
      game.uri,
      steamGridDbApiKey
    )
    const dir = artCacheDir()

    if (coverUrl) await downloadAndCache(coverUrl, join(dir, `${game.id}-cover.png`))
    if (heroUrl) await downloadAndCache(heroUrl, join(dir, `${game.id}-hero.png`))

    if (!coverUrl && !heroUrl) {
      return { ok: false, error: `No art found for "${game.name}" on SteamGridDB.` }
    }

    return { ok: true, game: await toEntry(game) }
  })

  /**
   * Fetch art for every game that doesn't already have cached art.
   * Fires-and-forgets in the background — returns immediately with a count.
   * The UI should reload the library after a delay or on focus.
   */
  ipcMain.handle('games:fetch-art-all', async (): Promise<{ ok: boolean; queued: number }> => {
    const { steamGridDbApiKey } = loadSettings()
    if (!steamGridDbApiKey) return { ok: false, queued: 0 }

    const { games } = loadGames()
    const needsArt = games.filter((g) => {
      const { cover, hero } = cachedArtPaths(g.id)
      return !g.cover && !cover && !hero
    })

    // Run in background — don't await.
    void (async () => {
      for (const game of needsArt) {
        const { coverUrl, heroUrl } = await fetchSgdbArt(
          game.id,
          game.name,
          game.uri,
          steamGridDbApiKey
        )
        const dir = artCacheDir()
        if (coverUrl) await downloadAndCache(coverUrl, join(dir, `${game.id}-cover.png`))
        if (heroUrl) await downloadAndCache(heroUrl, join(dir, `${game.id}-hero.png`))
      }
    })()

    return { ok: true, queued: needsArt.length }
  })

  // ── Play time ─────────────────────────────────────────────────────────────

  ipcMain.handle('playtime:get', (_e, id: unknown): PlayRecord | null => {
    if (typeof id !== 'string' || !id.trim()) return null
    const map = loadPlaytime()
    return map[id] ?? null
  })

  ipcMain.handle('playtime:get-all', (): PlaytimeMap => {
    return loadPlaytime()
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
