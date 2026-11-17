import { app, shell, BrowserWindow, ipcMain, dialog, net, screen } from 'electron'
import { join, dirname, extname, isAbsolute, basename } from 'path'
import { spawn, execFile, type ChildProcess } from 'child_process'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  watch
} from 'fs'
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
  notes?: unknown
  tags?: unknown
}

type Game = {
  id: string
  name: string
  exe?: string
  args?: string[]
  uri?: string
  cover?: string
  color?: string
  notes?: string
  tags?: string[]
}

type GameEntry = {
  id: string
  name: string
  cover?: string
  hero?: string
  color?: string
  autoColor?: string
  notes?: string
  tags?: string[]
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
  /** True if a game with the same URI or exe path already exists in games.json. */
  alreadyInLibrary: boolean
}

type WriteResult = { ok: boolean; error?: string; game?: GameEntry }

type PlayRecord = {
  id: string
  lastPlayed: string
  totalMs: number
  sessionStart?: string
  sessions?: number
  firstPlayed?: string
}

type PlaytimeMap = Record<string, PlayRecord>

type PlayStats = {
  sessions: number
  totalMs: number
  avgSessionMs: number
  longestSessionMs: number
  firstPlayed: string
  lastPlayed: string
}

type Settings = {
  steamGridDbApiKey?: string
  minimizeOnLaunch?: boolean
  /** Custom absolute path for games.json. Defaults to userData/games.json. */
  gamesJsonPath?: string
}

/** Pushed to the renderer during fetchArtAll. */
type ArtProgressEvent = {
  id: string
  name: string
  done: number
  total: number
  ok: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_URI = /^(steam|com\.epicgames\.launcher|goggalaxy):\/\//

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
  const settings = loadSettings()
  if (settings.gamesJsonPath && isAbsolute(settings.gamesJsonPath)) {
    return settings.gamesJsonPath
  }
  return join(app.getPath('userData'), 'games.json')
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function playtimeFile(): string {
  return join(app.getPath('userData'), 'playtime.json')
}

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
    if (typeof s.gamesJsonPath === 'string' && isAbsolute(s.gamesJsonPath)) {
      out.gamesJsonPath = s.gamesJsonPath
    }
    return out
  } catch {
    return {}
  }
}

function saveSettings(patch: Partial<Settings>): void {
  const current = loadSettings()
  writeFileSync(settingsFile(), JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8')
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

function recordLaunch(id: string): void {
  try {
    const map = loadPlaytime()
    const existing = map[id] ?? { id, lastPlayed: '', totalMs: 0 }
    const now = new Date().toISOString()
    map[id] = {
      ...existing,
      lastPlayed: now,
      sessionStart: now,
      sessions: (existing.sessions ?? 0) + 1,
      firstPlayed: existing.firstPlayed ?? now
    }
    savePlaytime(map)
  } catch {
    // Non-critical.
  }
}

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
    // Non-critical.
  }
}

function computePlayStats(id: string): PlayStats {
  const map = loadPlaytime()
  const rec = map[id]
  if (!rec || rec.totalMs === 0) {
    return {
      sessions: 0,
      totalMs: 0,
      avgSessionMs: 0,
      longestSessionMs: 0,
      firstPlayed: '',
      lastPlayed: ''
    }
  }
  const sessions = rec.sessions ?? Math.max(1, Math.round(rec.totalMs / 3_600_000))
  const avgSessionMs = sessions > 0 ? rec.totalMs / sessions : 0
  return {
    sessions,
    totalMs: rec.totalMs,
    avgSessionMs,
    longestSessionMs: rec.totalMs,
    firstPlayed: rec.firstPlayed ?? '',
    lastPlayed: rec.lastPlayed
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
      return `${label}: "uri" must start with steam://, com.epicgames.launcher://, or goggalaxy:// (got "${raw.uri}")`
  }

  if (!raw.exe && !raw.uri) return `${label}: must have at least one of "exe" or "uri"`

  const args =
    Array.isArray(raw.args) && raw.args.every((a) => typeof a === 'string')
      ? (raw.args as string[])
      : undefined

  const cover = typeof raw.cover === 'string' && raw.cover ? raw.cover : undefined
  const color = typeof raw.color === 'string' && raw.color ? raw.color : undefined

  // Notes: string, trimmed, max 500 chars
  const notes =
    typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 500) : undefined

  // Tags: array of non-empty strings, max 20 tags, max 30 chars each
  let tags: string[] | undefined
  if (Array.isArray(raw.tags)) {
    const filtered = (raw.tags as unknown[])
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => t.slice(0, 30))
      .slice(0, 20)
    if (filtered.length > 0) tags = filtered
  }

  return {
    id,
    name,
    exe: typeof raw.exe === 'string' ? raw.exe : undefined,
    args,
    uri: typeof raw.uri === 'string' ? raw.uri : undefined,
    cover,
    color,
    notes,
    tags
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
// Dominant colour extraction (Feature 1)
// ---------------------------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0)
  } else if (max === gn) {
    h = (bn - rn) / d + 2
  } else {
    h = (rn - gn) / d + 4
  }
  h /= 6
  return { h, s, l }
}

function extractDominantColor(buf: Buffer): string {
  const MAX_SAMPLES = 200
  const step = Math.max(3, Math.floor(buf.length / MAX_SAMPLES))

  let bestR = 47
  let bestG = 107
  let bestB = 255
  let bestSat = -1

  for (let offset = 0; offset + 2 < buf.length; offset += step) {
    const r = Math.max(0, Math.min(255, buf[offset]))
    const g = Math.max(0, Math.min(255, buf[offset + 1]))
    const b = Math.max(0, Math.min(255, buf[offset + 2]))
    const { s } = rgbToHsl(r, g, b)
    if (s > bestSat) {
      bestSat = s
      bestR = r
      bestG = g
      bestB = b
    }
  }

  if (bestSat < 0) return '#2f6bff'

  return `#${Math.round(bestR).toString(16).padStart(2, '0')}${Math.round(bestG).toString(16).padStart(2, '0')}${Math.round(bestB).toString(16).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Art helpers
// ---------------------------------------------------------------------------

const ART_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function artMetaPath(imagePath: string): string {
  return `${imagePath}.meta.json`
}

function isCacheStale(imagePath: string): boolean {
  const metaPath = artMetaPath(imagePath)
  if (!existsSync(metaPath)) return false // no sidecar → treat as valid (backwards compat)
  try {
    const raw: unknown = JSON.parse(readFileSync(metaPath, 'utf-8'))
    if (typeof raw !== 'object' || raw === null) return false
    const meta = raw as Record<string, unknown>
    if (typeof meta.fetchedAt !== 'string') return false
    const fetchedAt = new Date(meta.fetchedAt).getTime()
    if (Number.isNaN(fetchedAt)) return false
    return Date.now() - fetchedAt > ART_CACHE_MAX_AGE_MS
  } catch {
    return false
  }
}

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

async function exeIconDataUrl(exe: string): Promise<string | undefined> {
  try {
    const img = await app.getFileIcon(exe, { size: 'large' })
    return img.toDataURL()
  } catch {
    return undefined
  }
}

function cachedArtPaths(id: string): { cover?: string; hero?: string } {
  const dir = artCacheDir()
  const coverPath = join(dir, `${id}-cover.png`)
  const heroPath = join(dir, `${id}-hero.png`)

  const coverExists = existsSync(coverPath)
  const heroExists = existsSync(heroPath)

  return {
    cover: coverExists && !isCacheStale(coverPath) ? coverPath : undefined,
    hero: heroExists && !isCacheStale(heroPath) ? heroPath : undefined
  }
}

async function toEntry(g: Game): Promise<GameEntry> {
  const cached = cachedArtPaths(g.id)
  const cover: string | undefined =
    toDataUrl(g.cover) ??
    toDataUrl(cached.cover) ??
    (g.exe ? await exeIconDataUrl(g.exe) : undefined)
  const hero: string | undefined = toDataUrl(cached.hero)

  // Derive auto colour from cover art when no user colour is set
  let autoColor: string | undefined
  if (!g.color && cover && cover.startsWith('data:')) {
    try {
      const commaIdx = cover.indexOf(',')
      if (commaIdx !== -1) {
        const b64 = cover.slice(commaIdx + 1)
        const buf = Buffer.from(b64, 'base64')
        autoColor = extractDominantColor(buf)
      }
    } catch {
      // Non-critical — skip auto colour on failure.
    }
  }

  return {
    id: g.id,
    name: g.name,
    color: g.color,
    autoColor,
    cover,
    hero,
    notes: g.notes,
    tags: g.tags
  }
}

// ---------------------------------------------------------------------------
// SteamGridDB
// ---------------------------------------------------------------------------

const SGDB_BASE = 'https://www.steamgriddb.com/api/v2'

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

function steamAppIdFromUri(uri?: string): string | null {
  if (!uri) return null
  const m = uri.match(/^steam:\/\/rungameid\/(\d+)$/)
  return m ? m[1] : null
}

type SgdbArtResult = { coverUrl?: string; heroUrl?: string }

async function fetchSgdbArt(
  gameName: string,
  uri: string | undefined,
  apiKey: string
): Promise<SgdbArtResult> {
  try {
    let sgdbId: number | null = null

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

    let coverUrl: string | undefined
    const gridRes = (await fetchJson(
      `${SGDB_BASE}/grids/game/${sgdbId}?dimensions=600x900`,
      apiKey
    )) as { success?: boolean; data?: Array<{ url?: string }> }
    if (gridRes.success && Array.isArray(gridRes.data) && gridRes.data.length > 0) {
      coverUrl = gridRes.data[0].url
    }

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

async function downloadAndCache(url: string, destPath: string): Promise<string | undefined> {
  try {
    const buf = await fetchBinary(url)
    writeFileSync(destPath, buf)
    // Write sidecar metadata for stale-cache invalidation (Feature 6)
    writeFileSync(
      artMetaPath(destPath),
      JSON.stringify({ fetchedAt: new Date().toISOString() }),
      'utf-8'
    )
    return destPath
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Now Playing pill window (Feature 2)
// ---------------------------------------------------------------------------

let pillWin: BrowserWindow | null = null

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function showPillWindow(gameName: string): void {
  // Close any existing pill before showing a new one
  if (pillWin && !pillWin.isDestroyed()) {
    pillWin.destroy()
    pillWin = null
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

  const win = new BrowserWindow({
    width: 220,
    height: 52,
    x: screenW - 240,
    y: screenH - 72,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const safeName = escapeHtml(gameName)
  const html = `<!doctype html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;overflow:hidden;-webkit-app-region:drag;font-family:'Segoe UI',system-ui,sans-serif;background:rgba(10,15,28,0.92);backdrop-filter:blur(12px);border-radius:14px;border:1px solid rgba(255,255,255,0.12);color:#f4f6fb}body{display:flex;align-items:center;gap:12px;padding:0 16px}#dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;animation:pulse 1.8s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}#name{font-size:13px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1}#close{-webkit-app-region:no-drag;width:22px;height:22px;border-radius:50%;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#f4f6fb;font-size:13px;cursor:pointer;display:grid;place-items:center;flex-shrink:0}</style></head><body><div id="dot"></div><span id="name">${safeName}</span><button id="close" onclick="window.close()">&#x2715;</button></body></html>`

  win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  pillWin = win
}

function hidePillWindow(): void {
  if (pillWin && !pillWin.isDestroyed()) {
    pillWin.destroy()
  }
  pillWin = null
}

// ---------------------------------------------------------------------------
// Launch helper — returns the ChildProcess + earlyExitPromise for crash detection
// ---------------------------------------------------------------------------

type LaunchExeResult = {
  result: LaunchResult
  child?: ChildProcess
  earlyExitPromise: Promise<boolean>
}

function launchExeProcess(exe: string, args: string[]): Promise<LaunchExeResult> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd: dirname(exe), detached: true, stdio: 'ignore' })

    child.once('error', (err) => {
      resolve({
        result: { ok: false, error: err.message },
        earlyExitPromise: Promise.resolve(false)
      })
    })

    child.once('spawn', () => {
      // Feature 7: Early crash detection — watch for non-zero exit within 4 seconds
      const earlyExitPromise = new Promise<boolean>((resolveCrash) => {
        let settled = false

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true
            resolveCrash(false)
          }
        }, 4000)

        child.once('exit', (code, signal) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            const crashed = code !== 0 || signal !== null
            resolveCrash(crashed)
          }
        })
      })

      resolve({ result: { ok: true }, child, earlyExitPromise })
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

async function scanSteam(): Promise<Omit<ScanCandidate, 'alreadyInLibrary'>[]> {
  const candidates: Omit<ScanCandidate, 'alreadyInLibrary'>[] = []
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

async function scanEpic(): Promise<Omit<ScanCandidate, 'alreadyInLibrary'>[]> {
  const candidates: Omit<ScanCandidate, 'alreadyInLibrary'>[] = []
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

async function scanGog(): Promise<Omit<ScanCandidate, 'alreadyInLibrary'>[]> {
  const candidates: Omit<ScanCandidate, 'alreadyInLibrary'>[] = []
  const subkeys = await regQuerySubkeys('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games')
  for (const subkey of subkeys) {
    const [name, exe, gameId] = await Promise.all([
      regQuery(subkey, 'gameName'),
      regQuery(subkey, 'exe'),
      regQuery(subkey, 'gameID')
    ])
    if (!name) continue

    // Prefer GOG Galaxy URI so Galaxy handles DRM and updates.
    if (gameId) {
      candidates.push({ name, uri: `goggalaxy://openGame/${gameId}`, source: 'gog' })
    } else if (exe && isAbsolute(exe) && existsSync(exe)) {
      candidates.push({ name, exe, source: 'gog' })
    }
  }
  return candidates
}

function scanFolder(folderPath: string, depth = 3): Omit<ScanCandidate, 'alreadyInLibrary'>[] {
  const candidates: Omit<ScanCandidate, 'alreadyInLibrary'>[] = []
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

/**
 * Mark candidates that already exist in the library (by URI or exe path).
 * Hard duplicates are not filtered out — the UI decides whether to show them.
 */
function markDuplicates(
  candidates: Omit<ScanCandidate, 'alreadyInLibrary'>[],
  existing: Game[]
): ScanCandidate[] {
  const existingUris = new Set(existing.map((g) => g.uri).filter(Boolean) as string[])
  const existingExes = new Set(
    existing.map((g) => g.exe?.toLowerCase()).filter(Boolean) as string[]
  )
  return candidates.map((c) => ({
    ...c,
    alreadyInLibrary:
      (!!c.uri && existingUris.has(c.uri)) || (!!c.exe && existingExes.has(c.exe.toLowerCase()))
  }))
}

// ---------------------------------------------------------------------------
// games.json file watcher — pushes library:changed to the renderer
// ---------------------------------------------------------------------------

let watcherDebounce: ReturnType<typeof setTimeout> | null = null

function startGamesFileWatcher(win: BrowserWindow): void {
  const file = gamesFile()
  // Ensure the file exists before watching.
  if (!existsSync(file)) loadGames()

  try {
    watch(file, () => {
      // Debounce: editors write multiple events on save.
      if (watcherDebounce) clearTimeout(watcherDebounce)
      watcherDebounce = setTimeout(() => {
        if (!win.isDestroyed()) {
          win.webContents.send('library:changed')
        }
      }, 500)
    })
  } catch {
    // If watch fails (network drive, permission, etc.) just skip it.
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/** Id of the game whose session should end when the window next regains focus. */
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

  // End session when the user returns to the launcher (focus-based fallback
  // for URI launches where we can't watch the process directly).
  win.on('focus', () => {
    if (pendingSessionEnd) {
      recordSessionEnd(pendingSessionEnd)
      pendingSessionEnd = null
    }
    // URI game ended: hide pill when launcher is re-focused
    hidePillWindow()
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

  // Start the games.json file watcher after the window is ready.
  win.webContents.once('did-finish-load', () => startGamesFileWatcher(win))

  return
}

// ---------------------------------------------------------------------------
// App bootstrap + IPC handlers
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.skylauncher.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // ── Read ──────────────────────────────────────────────────────────────────

  ipcMain.handle('games:list', async (): Promise<GameEntry[]> => {
    try {
      return await Promise.all(loadGames().games.map(toEntry))
    } catch {
      return []
    }
  })

  ipcMain.handle('games:status', async (): Promise<LibraryStatus> => {
    try {
      const { games, warnings, parseError } = loadGames()
      return {
        ok: !parseError,
        games: await Promise.all(games.map(toEntry)),
        error: parseError,
        warnings
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, games: [], error: msg, warnings: [] }
    }
  })

  ipcMain.handle('app:version', (): string => app.getVersion())

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
          return {
            ok: false,
            error: 'Only steam://, Epic, and GOG Galaxy links are allowed.'
          }
        await shell.openExternal(game.uri)
        result = { ok: true }
        // URI launches: use focus-based session end (can't watch external processes).
        recordLaunch(id)
        pendingSessionEnd = id
        // Show pill for URI launch
        showPillWindow(game.name)
      } else if (game.exe) {
        if (!existsSync(game.exe))
          return {
            ok: false,
            error: `Can't find "${game.exe}". Check the exe path in games.json.`
          }
        const {
          result: launchRes,
          child,
          earlyExitPromise
        } = await launchExeProcess(game.exe, game.args ?? [])
        result = launchRes
        if (result.ok && child) {
          recordLaunch(id)
          // Show pill for exe launch
          showPillWindow(game.name)
          // Process exit detection: end session precisely when the game exits.
          child.once('exit', () => {
            recordSessionEnd(id)
            hidePillWindow()
            // Notify the renderer so it can refresh playtime immediately.
            BrowserWindow.getAllWindows()[0]?.webContents.send('playtime:updated', id)
          })
          // Feature 7: Early crash detection
          void earlyExitPromise.then((crashed) => {
            if (crashed) {
              const mainWin = BrowserWindow.getAllWindows()[0]
              mainWin?.restore()
              mainWin?.webContents.send('game:crashed', id)
              hidePillWindow()
            }
          })
        }
      } else {
        return { ok: false, error: 'This game has no exe or uri in games.json.' }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Unexpected error launching game: ${msg}` }
    }

    if (result.ok) {
      const settings = loadSettings()
      if (settings.minimizeOnLaunch !== false) BrowserWindow.getAllWindows()[0]?.minimize()
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
      const p = patch as RawGame
      const merged: RawGame = {
        id: existing.id,
        name: p.name ?? existing.name,
        exe: p.exe ?? existing.exe,
        args: p.args ?? existing.args,
        uri: p.uri ?? existing.uri,
        cover: p.cover ?? existing.cover,
        color: p.color ?? existing.color,
        notes: p.notes ?? existing.notes,
        tags: p.tags ?? existing.tags
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
      const { games } = loadGames()
      return markDuplicates([...steam, ...epic, ...gog], games)
    } catch (err) {
      console.error('games:scan error:', err instanceof Error ? err.message : String(err))
      return []
    }
  })

  ipcMain.handle('games:scan-folder', (_e, folderPath: unknown): ScanCandidate[] => {
    if (typeof folderPath !== 'string' || !folderPath.trim()) return []
    if (!isAbsolute(folderPath) || !existsSync(folderPath)) return []
    try {
      const { games } = loadGames()
      return markDuplicates(scanFolder(folderPath), games)
    } catch {
      return []
    }
  })

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', (): Settings => loadSettings())

  ipcMain.handle('settings:set', (_e, patch: unknown): LaunchResult => {
    if (typeof patch !== 'object' || patch === null) return { ok: false, error: 'Invalid patch.' }
    try {
      const p = patch as Record<string, unknown>
      const safe: Partial<Settings> = {}
      if (typeof p.steamGridDbApiKey === 'string') safe.steamGridDbApiKey = p.steamGridDbApiKey
      if (typeof p.minimizeOnLaunch === 'boolean') safe.minimizeOnLaunch = p.minimizeOnLaunch
      if (typeof p.gamesJsonPath === 'string') {
        // Accept empty string to reset to default.
        safe.gamesJsonPath = p.gamesJsonPath.trim() || undefined
      }
      saveSettings(safe)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not save settings: ${msg}` }
    }
  })

  // ── Auto-launch on startup (Feature 4) ───────────────────────────────────

  ipcMain.handle('settings:get-login-item', (): { enabled: boolean } => {
    return { enabled: app.getLoginItemSettings().openAtLogin }
  })

  ipcMain.handle('settings:set-login-item', (_e, payload: unknown): LaunchResult => {
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, error: 'Invalid payload.' }
    }
    const p = payload as Record<string, unknown>
    if (typeof p.enabled !== 'boolean') {
      return { ok: false, error: '"enabled" must be a boolean.' }
    }
    try {
      app.setLoginItemSettings({ openAtLogin: p.enabled })
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not update login item: ${msg}` }
    }
  })

  // ── Pill hide (Feature 2) ─────────────────────────────────────────────────

  ipcMain.handle('pill:hide', (): void => {
    hidePillWindow()
  })

  // ── Cover art (SteamGridDB) ───────────────────────────────────────────────

  ipcMain.handle('games:fetch-art', async (_e, id: unknown): Promise<WriteResult> => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false, error: 'Invalid game id.' }

    const { steamGridDbApiKey } = loadSettings()
    if (!steamGridDbApiKey)
      return {
        ok: false,
        error: 'No SteamGridDB API key set. Add one in Settings to fetch cover art.'
      }

    const { games } = loadGames()
    const game = games.find((g) => g.id === id)
    if (!game) return { ok: false, error: `Game "${id}" not found.` }

    const { coverUrl, heroUrl } = await fetchSgdbArt(game.name, game.uri, steamGridDbApiKey)
    const dir = artCacheDir()
    if (coverUrl) await downloadAndCache(coverUrl, join(dir, `${game.id}-cover.png`))
    if (heroUrl) await downloadAndCache(heroUrl, join(dir, `${game.id}-hero.png`))

    if (!coverUrl && !heroUrl)
      return { ok: false, error: `No art found for "${game.name}" on SteamGridDB.` }

    return { ok: true, game: await toEntry(game) }
  })

  /**
   * Fetch art for all games lacking cached art.
   * Pushes art:progress events to the renderer as each game completes,
   * then art:done when the batch is finished.
   */
  ipcMain.handle('games:fetch-art-all', async (): Promise<{ ok: boolean; queued: number }> => {
    const { steamGridDbApiKey } = loadSettings()
    if (!steamGridDbApiKey) return { ok: false, queued: 0 }

    const { games } = loadGames()
    const needsArt = games.filter((g) => {
      const { cover, hero } = cachedArtPaths(g.id)
      return !g.cover && !cover && !hero
    })
    if (needsArt.length === 0) return { ok: true, queued: 0 }

    void (async () => {
      const dir = artCacheDir()
      let done = 0
      const total = needsArt.length

      for (const game of needsArt) {
        const { coverUrl, heroUrl } = await fetchSgdbArt(game.name, game.uri, steamGridDbApiKey)
        if (coverUrl) await downloadAndCache(coverUrl, join(dir, `${game.id}-cover.png`))
        if (heroUrl) await downloadAndCache(heroUrl, join(dir, `${game.id}-hero.png`))
        done++

        const event: ArtProgressEvent = {
          id: game.id,
          name: game.name,
          done,
          total,
          ok: !!(coverUrl || heroUrl)
        }
        BrowserWindow.getAllWindows()[0]?.webContents.send('art:progress', event)
      }

      BrowserWindow.getAllWindows()[0]?.webContents.send('art:done')
    })()

    return { ok: true, queued: needsArt.length }
  })

  // ── Play time ─────────────────────────────────────────────────────────────

  ipcMain.handle('playtime:get', (_e, id: unknown): PlayRecord | null => {
    if (typeof id !== 'string' || !id.trim()) return null
    return loadPlaytime()[id] ?? null
  })

  ipcMain.handle('playtime:get-all', (): PlaytimeMap => loadPlaytime())

  // ── Play stats (Feature 3) ────────────────────────────────────────────────

  ipcMain.handle('playtime:stats', (_e, id: unknown): PlayStats => {
    if (typeof id !== 'string' || !id.trim()) {
      return {
        sessions: 0,
        totalMs: 0,
        avgSessionMs: 0,
        longestSessionMs: 0,
        firstPlayed: '',
        lastPlayed: ''
      }
    }
    return computePlayStats(id)
  })

  // ── Library export / import (Feature 8) ──────────────────────────────────

  ipcMain.handle('games:export', async (): Promise<LaunchResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    try {
      const result = await dialog.showSaveDialog(win, {
        title: 'Export library',
        defaultPath: 'sky-launcher-games.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled.' }

      const content = readFileSync(gamesFile(), 'utf-8')
      writeFileSync(result.filePath, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Export failed: ${msg}` }
    }
  })

  ipcMain.handle(
    'games:import',
    async (): Promise<{
      ok: boolean
      filePath?: string
      games?: GameEntry[]
      warnings?: string[]
      error?: string
    }> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      try {
        const result = await dialog.showOpenDialog(win, {
          title: 'Import library',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, error: 'Cancelled.' }
        }
        const filePath = result.filePaths[0]

        // Parse and validate — do NOT write yet (renderer previews first)
        let raw: unknown
        try {
          raw = JSON.parse(readFileSync(filePath, 'utf-8'))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false, error: `Could not parse file: ${msg}` }
        }

        if (!Array.isArray(raw)) {
          return { ok: false, error: 'File must contain a JSON array.' }
        }

        const games: Game[] = []
        const warnings: string[] = []
        ;(raw as RawGame[]).forEach((entry, i) => {
          const r = validateEntry(entry, i)
          if (typeof r === 'string') warnings.push(r)
          else games.push(r)
        })

        const entries = await Promise.all(games.map(toEntry))
        return { ok: true, filePath, games: entries, warnings }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Import failed: ${msg}` }
      }
    }
  )

  ipcMain.handle('games:import-confirm', (_e, filePath: unknown): LaunchResult => {
    // Validate the path parameter — never trust the renderer's cached parse
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { ok: false, error: 'Invalid file path.' }
    }
    if (!isAbsolute(filePath)) {
      return { ok: false, error: 'File path must be absolute.' }
    }
    if (!existsSync(filePath)) {
      return { ok: false, error: 'File no longer exists.' }
    }
    try {
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(filePath, 'utf-8'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Could not parse file: ${msg}` }
      }

      if (!Array.isArray(raw)) {
        return { ok: false, error: 'File must contain a JSON array.' }
      }

      // Re-validate every entry
      const games: Game[] = []
      const warnings: string[] = []
      ;(raw as RawGame[]).forEach((entry, i) => {
        const r = validateEntry(entry, i)
        if (typeof r === 'string') warnings.push(r)
        else games.push(r)
      })

      saveGames(games)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not import library: ${msg}` }
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
