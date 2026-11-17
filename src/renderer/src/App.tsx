import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameEntry, LibraryStatus, PlaytimeMap } from '../../preload/index.d'
import { GameFormModal } from './components/GameFormModal'
import { ScanModal } from './components/ScanModal'
import { SettingsModal } from './components/SettingsModal'

type ActiveModal = 'none' | 'settings' | 'game-options' | 'add' | 'edit' | 'scan'
type LibraryFilter = 'all' | 'recent' | 'favorites'

const FAV_STORAGE_KEY = 'sky_launcher_favorites_v1'
const SOUND_STORAGE_KEY = 'sky_launcher_sound_v1'

function getRibbonMetrics(width: number): {
  activeTile: number
  idleTile: number
  gap: number
} {
  if (width >= 1600) return { activeTile: 132, idleTile: 96, gap: 14 }
  if (width >= 1200) return { activeTile: 110, idleTile: 80, gap: 12 }
  return { activeTile: 96, idleTile: 72, gap: 10 }
}

function makeDemoCover(bg1: string, bg2: string, accent: string, title: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/></linearGradient><radialGradient id="a" cx="72%" cy="35%" r="55%"><stop offset="0%" stop-color="${accent}" stop-opacity="0.75"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs><rect width="800" height="450" fill="url(#g)"/><rect width="800" height="450" fill="url(#a)"/><circle cx="590" cy="180" r="130" fill="${accent}" fill-opacity="0.18"/><path d="M470 350 L620 110 L760 350 Z" fill="#ffffff" fill-opacity="0.06"/><text x="60" y="385" fill="#ffffff" fill-opacity="0.22" font-family="Segoe UI, sans-serif" font-size="44" font-weight="800">${title}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const BROWSER_DEMO_GAMES: GameEntry[] = [
  {
    id: 'demo-spider',
    name: "Marvel's Spider-Man",
    color: '#ef4444',
    cover: makeDemoCover('#0f172a', '#2b0912', '#ef4444', 'SPIDER-MAN')
  },
  {
    id: 'demo-cs2',
    name: 'Counter-Strike 2',
    color: '#e67e22',
    cover: makeDemoCover('#111827', '#2c1808', '#f59e0b', 'COUNTER-STRIKE 2')
  },
  {
    id: 'demo-cyberpunk',
    name: 'Cyberpunk 2077',
    color: '#eab308',
    cover: makeDemoCover('#091326', '#292205', '#eab308', 'CYBERPUNK 2077')
  },
  {
    id: 'demo-elden',
    name: 'Elden Ring',
    color: '#10b981',
    cover: makeDemoCover('#081715', '#152510', '#10b981', 'ELDEN RING')
  }
]

function formatDuration(totalMs: number): string {
  const mins = Math.floor(totalMs / 60_000)
  if (mins < 1) return 'Less than 1 min'
  if (mins < 60) return `${mins} min`
  const hrs = totalMs / 3_600_000
  return `${hrs.toFixed(1)} hrs`
}

function formatLastPlayed(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return date.toLocaleDateString()
}

function playUiSound(type: 'move' | 'confirm', enabled: boolean): void {
  if (!enabled || typeof window === 'undefined') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  try {
    const AudioCtx = window.AudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    const now = ctx.currentTime
    if (type === 'move') {
      osc.frequency.setValueAtTime(520, now)
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.045)
      gain.gain.setValueAtTime(0.035, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.055)
    } else {
      osc.frequency.setValueAtTime(480, now)
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.09)
      gain.gain.setValueAtTime(0.05, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.12)
    }
    osc.onended = () => {
      void ctx.close()
    }
  } catch {
    // Ignore audio errors when autoplay is blocked
  }
}

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function App(): React.JSX.Element {
  const isElectron = typeof window !== 'undefined' && Boolean(window.api)
  const [status, setStatus] = useState<LibraryStatus | null>(null)
  const [playtime, setPlaytime] = useState<PlaytimeMap>({})
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites())
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SOUND_STORAGE_KEY) !== 'false'
    } catch {
      return true
    }
  })

  const [index, setIndex] = useState(0)
  const [launchError, setLaunchError] = useState('')
  const [fetchingArt, setFetchingArt] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [activeModal, setActiveModal] = useState<ActiveModal>('none')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [modalActionIndex, setModalActionIndex] = useState(0)
  const [gamepadConnected, setGamepadConnected] = useState(false)
  const [time, setTime] = useState(() => new Date())
  const [metrics, setMetrics] = useState(() => getRibbonMetrics(window.innerWidth))

  const searchInputRef = useRef<HTMLInputElement>(null)

  const allGames = useMemo(() => status?.games ?? [], [status])
  const warnings = status?.warnings ?? []

  const visibleGames = useMemo(() => {
    let list = allGames
    if (filter === 'favorites') {
      const favSet = new Set(favorites)
      list = list.filter((g) => favSet.has(g.id))
    } else if (filter === 'recent') {
      list = [...list]
        .filter((g) => Boolean(playtime[g.id]?.lastPlayed))
        .sort((a, b) => {
          const ta = Date.parse(playtime[a.id]?.lastPlayed ?? '') || 0
          const tb = Date.parse(playtime[b.id]?.lastPlayed ?? '') || 0
          return tb - ta
        })
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((g) => g.name.toLowerCase().includes(q))
    }
    return list
  }, [allGames, filter, favorites, playtime, searchQuery])

  const clampedIndex = Math.min(index, Math.max(visibleGames.length - 1, 0))

  const latest = useRef({
    games: visibleGames,
    index: clampedIndex,
    activeModal,
    modalActionIndex,
    launchError,
    statusOk: status?.ok ?? true,
    soundEnabled,
    searchOpen
  })
  useEffect(() => {
    latest.current = {
      games: visibleGames,
      index: clampedIndex,
      activeModal,
      modalActionIndex,
      launchError,
      statusOk: status?.ok ?? true,
      soundEnabled,
      searchOpen
    }
  }, [
    visibleGames,
    clampedIndex,
    activeModal,
    modalActionIndex,
    launchError,
    status?.ok,
    soundEnabled,
    searchOpen
  ])

  const busy = useRef(false)

  const refreshPlaytime = useCallback(async () => {
    if (!window.api) return
    try {
      const pt = await window.api.getAllPlaytime()
      setPlaytime(pt)
    } catch {
      // Ignore playtime read errors
    }
  }, [])

  const loadLibrary = useCallback(async (focusGameId?: string) => {
    if (!window.api) {
      setStatus({
        ok: false,
        games: [],
        error:
          'You are viewing the Vite web preview in a browser. Switch to the Sky Launcher Electron desktop window to scan your laptop, open games.json, and launch games.',
        warnings: []
      })
      return
    }
    try {
      const [next, pt] = await Promise.all([
        window.api.getStatus(),
        window.api.getAllPlaytime().catch(() => ({}))
      ])
      setStatus(next)
      setPlaytime(pt)
      if (focusGameId) {
        const found = next.games.findIndex((g) => g.id === focusGameId)
        if (found >= 0) {
          setFilter('all')
          setSearchQuery('')
          setIndex(found)
          return
        }
      }
      setIndex((i) => Math.min(i, Math.max(next.games.length - 1, 0)))
    } catch {
      setStatus({
        ok: false,
        games: [],
        error: 'Could not read your game library. Try reloading or opening games.json.',
        warnings: []
      })
    }
  }, [])

  useEffect(() => {
    let active = true
    const fetchInitial = window.api
      ? Promise.all([
          window.api.getStatus(),
          window.api.getAllPlaytime().catch(() => ({}) as PlaytimeMap)
        ])
      : Promise.resolve<[LibraryStatus, PlaytimeMap]>([
          {
            ok: false,
            games: [],
            error:
              'You are viewing the Vite web preview in a browser. Switch to the Sky Launcher Electron desktop window to scan your laptop, open games.json, and launch games.',
            warnings: []
          },
          {}
        ])

    fetchInitial
      .then(([next, pt]) => {
        if (!active) return
        setStatus(next)
        setPlaytime(pt)
        setIndex((i) => Math.min(i, Math.max(next.games.length - 1, 0)))
      })
      .catch(() => {
        if (!active) return
        setStatus({
          ok: false,
          games: [],
          error: 'Could not read your game library. Try reloading or opening games.json.',
          warnings: []
        })
      })

    const onFocus = (): void => {
      void refreshPlaytime()
    }
    const timer = setInterval(() => setTime(new Date()), 30_000)
    const onResize = (): void => setMetrics(getRibbonMetrics(window.innerWidth))
    window.addEventListener('focus', onFocus)
    window.addEventListener('resize', onResize)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('resize', onResize)
    }
  }, [refreshPlaytime])

  useEffect(() => {
    const syncPads = (): void => {
      const hasPad = navigator.getGamepads().some((p) => Boolean(p))
      setGamepadConnected(hasPad)
    }
    syncPads()
    window.addEventListener('gamepadconnected', syncPads)
    window.addEventListener('gamepaddisconnected', syncPads)
    return () => {
      window.removeEventListener('gamepadconnected', syncPads)
      window.removeEventListener('gamepaddisconnected', syncPads)
    }
  }, [])

  const closeModal = useCallback(() => {
    setActiveModal('none')
    setConfirmRemove(false)
    setModalActionIndex(0)
  }, [])

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const exists = prev.includes(id)
      const next = exists ? prev.filter((item) => item !== id) : [...prev, id]
      try {
        localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Ignore storage errors
      }
      return next
    })
  }, [])

  const handleToggleSound = useCallback((enabled: boolean) => {
    setSoundEnabled(enabled)
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, String(enabled))
    } catch {
      // Ignore storage errors
    }
  }, [])

  const move = useCallback((dir: number) => {
    const { activeModal: modal, games: list, statusOk, soundEnabled: sfx } = latest.current
    if (modal !== 'none' || !statusOk || list.length === 0) {
      setModalActionIndex((prev) => (prev + dir + 2) % 2)
      return
    }
    const last = Math.max(list.length - 1, 0)
    setLaunchError('')
    setIndex((i) => {
      const next = Math.min(Math.max(i + dir, 0), last)
      if (next !== i) playUiSound('move', sfx)
      return next
    })
  }, [])

  const launch = useCallback(async () => {
    const game = latest.current.games[latest.current.index]
    if (!game || busy.current) return
    if (!window.api) {
      setLaunchError('Launching games requires the Sky Launcher Electron desktop window.')
      return
    }
    busy.current = true
    setLaunching(true)
    setLaunchError('')
    playUiSound('confirm', latest.current.soundEnabled)
    try {
      const res = await window.api.launchGame(game.id)
      if (!res.ok) {
        setLaunchError(
          res.error ?? 'Could not start this game. Check its path or URI in games.json.'
        )
      } else {
        void refreshPlaytime()
      }
    } catch {
      setLaunchError('Could not start this game. Check its path or URI in games.json.')
    } finally {
      setTimeout(() => {
        busy.current = false
        setLaunching(false)
      }, 1200)
    }
  }, [refreshPlaytime])

  const fetchSelectedArt = useCallback(async () => {
    const game = latest.current.games[latest.current.index]
    if (!game) return
    if (!window.api) {
      setLaunchError('Fetching SteamGridDB artwork requires the Electron desktop window.')
      closeModal()
      return
    }
    setFetchingArt(true)
    setLaunchError('')
    try {
      const res = await window.api.fetchArt(game.id)
      if (!res.ok) {
        setLaunchError(
          res.error ?? 'Could not fetch artwork. Add a SteamGridDB API key in Settings.'
        )
      } else {
        await loadLibrary(game.id)
      }
    } catch {
      setLaunchError('Could not fetch artwork from SteamGridDB.')
    } finally {
      setFetchingArt(false)
      closeModal()
    }
  }, [closeModal, loadLibrary])

  const revealSelectedGame = useCallback(async () => {
    const game = latest.current.games[latest.current.index]
    if (!game) return
    if (!window.api) {
      setLaunchError('Opening Explorer requires the Sky Launcher Electron desktop window.')
      closeModal()
      return
    }
    setLaunchError('')
    const res = await window.api.revealGame(game.id)
    if (!res.ok) {
      setLaunchError(res.error ?? 'Could not open this game’s folder.')
    }
    closeModal()
  }, [closeModal])

  const removeSelectedGame = useCallback(async () => {
    const game = latest.current.games[latest.current.index]
    if (!game) return
    if (!window.api) {
      setStatus((prev) =>
        prev ? { ...prev, games: prev.games.filter((g) => g.id !== game.id) } : prev
      )
      setIndex((i) => Math.max(0, i - 1))
      closeModal()
      return
    }
    const res = await window.api.removeGame(game.id)
    if (!res.ok) {
      setLaunchError(res.error ?? 'Could not remove this game.')
      closeModal()
      return
    }
    closeModal()
    await loadLibrary()
  }, [closeModal, loadLibrary])

  const openGamesFile = useCallback(async () => {
    if (!window.api) {
      setLaunchError('Opening games.json requires the Sky Launcher Electron desktop window.')
      return
    }
    await window.api.openGamesFile()
  }, [])

  const activateModalAction = useCallback(() => {
    if (latest.current.modalActionIndex === 0) {
      void openGamesFile()
    } else {
      void loadLibrary()
    }
  }, [openGamesFile, loadLibrary])

  const handleConfirm = useCallback(() => {
    const { activeModal: modal, statusOk, games: list } = latest.current
    if (!statusOk || list.length === 0) {
      activateModalAction()
      return
    }
    if (modal === 'none') {
      void launch()
    }
  }, [activateModalAction, launch])

  const handleBack = useCallback(() => {
    if (latest.current.activeModal !== 'none') {
      closeModal()
      return
    }
    if (latest.current.searchOpen) {
      setSearchOpen(false)
      setSearchQuery('')
      return
    }
    if (latest.current.launchError) {
      setLaunchError('')
    }
  }, [closeModal])

  const toggleOptions = useCallback(() => {
    setConfirmRemove(false)
    setModalActionIndex(0)
    setActiveModal((prev) => {
      if (prev !== 'none') return 'none'
      return latest.current.games.length > 0 ? 'game-options' : 'settings'
    })
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const inInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

      if (e.key === 'Escape') {
        if (
          latest.current.activeModal !== 'none' ||
          latest.current.searchOpen ||
          latest.current.launchError
        ) {
          e.preventDefault()
          handleBack()
        }
        return
      }

      if (inInput) return

      if (e.key === '/') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        move(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        move(-1)
      } else if (e.key === 'Enter') {
        const activeTag = document.activeElement?.tagName
        if (activeTag === 'BUTTON') return
        e.preventDefault()
        handleConfirm()
      } else if (e.key === 'Backspace') {
        handleBack()
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        toggleOptions()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        void loadLibrary()
      } else if (e.key === 'f' || e.key === 'F') {
        const g = latest.current.games[latest.current.index]
        if (g) toggleFavorite(g.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, handleConfirm, handleBack, toggleOptions, loadLibrary, toggleFavorite])

  // Gamepad navigation: D-pad/left stick move, A (0) select, B (1) back, Y (3) options
  useEffect(() => {
    let raf = 0
    let lastMove = 0
    let aWasDown = false
    let bWasDown = false
    let yWasDown = false

    const tick = (now: number): void => {
      const pad = navigator.getGamepads().find((p) => p)
      if (pad) {
        const x = pad.axes[0] ?? 0
        const left = pad.buttons[14]?.pressed || x < -0.5
        const right = pad.buttons[15]?.pressed || x > 0.5
        if ((left || right) && now - lastMove > 180) {
          move(left ? -1 : 1)
          lastMove = now
        }

        const a = pad.buttons[0]?.pressed ?? false
        if (a && !aWasDown) handleConfirm()
        aWasDown = a

        const b = pad.buttons[1]?.pressed ?? false
        if (b && !bWasDown) handleBack()
        bWasDown = b

        const y = pad.buttons[3]?.pressed ?? false
        if (y && !yWasDown) toggleOptions()
        yWasDown = y
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [move, handleConfirm, handleBack, toggleOptions])

  const game = visibleGames[clampedIndex]
  const backdropArt = game?.hero ?? game?.cover
  const gamePlayRecord = game ? playtime[game.id] : undefined
  const isFavorite = game ? favorites.includes(game.id) : false
  const accent = game?.color ?? '#2f6bff'
  const clock = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  const isErrorState = status !== null && !status.ok
  const isEmptyLibrary = status !== null && status.ok && allGames.length === 0
  const isEmptyFiltered =
    status !== null && status.ok && allGames.length > 0 && visibleGames.length === 0
  const ribbonShift = clampedIndex * (metrics.idleTile + metrics.gap)

  return (
    <div
      className="app"
      style={{
        ['--accent' as string]: accent,
        ['--tile-active' as string]: `${metrics.activeTile}px`,
        ['--tile-idle' as string]: `${metrics.idleTile}px`,
        ['--tile-gap' as string]: `${metrics.gap}px`
      }}
    >
      {/* Full-bleed atmospheric backdrop (prefers wide hero art) */}
      <div
        key={game?.id ?? 'none'}
        className={`backdrop ${backdropArt ? (game?.hero ? 'has-hero' : 'has-cover') : ''}`}
        style={backdropArt ? { backgroundImage: `url("${backdropArt}")` } : undefined}
      />
      <div className="backdrop-vignette" />
      <div className="accent-glow" />

      {/* PS5-style Top Bar */}
      <header className="topbar">
        <nav className="nav-tabs" aria-label="Library filters">
          <button
            type="button"
            className={`nav-tab-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => {
              setFilter('all')
              setIndex(0)
            }}
          >
            Games
          </button>
          <button
            type="button"
            className={`nav-tab-btn ${filter === 'recent' ? 'active' : ''}`}
            onClick={() => {
              setFilter('recent')
              setIndex(0)
            }}
          >
            Recent
          </button>
          <button
            type="button"
            className={`nav-tab-btn ${filter === 'favorites' ? 'active' : ''}`}
            onClick={() => {
              setFilter('favorites')
              setIndex(0)
            }}
          >
            Favourites
          </button>
          <span className="nav-count">
            {visibleGames.length} {visibleGames.length === 1 ? 'title' : 'titles'}
          </span>
        </nav>

        <div className="status-group">
          {searchOpen ? (
            <div className="search-bar">
              <input
                ref={searchInputRef}
                type="text"
                className="search-input"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setIndex(0)
                }}
                placeholder="Search games..."
                aria-label="Search games"
              />
              <button
                type="button"
                className="inline-link"
                onClick={() => {
                  setSearchOpen(false)
                  setSearchQuery('')
                }}
              >
                Clear
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setSearchOpen(true)
                setTimeout(() => searchInputRef.current?.focus(), 0)
              }}
              title="Search games (/)"
              aria-label="Search games"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.9" />
                <path
                  d="m20 20-3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}

          {warnings.length > 0 && (
            <button
              type="button"
              className="warning-chip"
              onClick={() => setActiveModal('settings')}
              title="View skipped entries from games.json"
            >
              <span className="warning-dot" />
              {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
            </button>
          )}

          <button type="button" className="top-action-btn" onClick={() => setActiveModal('scan')}>
            Scan laptop
          </button>

          <button type="button" className="top-action-btn" onClick={() => setActiveModal('add')}>
            + Add game
          </button>

          {gamepadConnected && (
            <span className="icon-pill" title="Controller connected" aria-label="Controller ready">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6.5 8.5h11a3.5 3.5 0 0 1 3.4 4.3l-.9 3.8a2.3 2.3 0 0 1-4.1.8l-1.5-2h-4.8l-1.5 2a2.3 2.3 0 0 1-4.1-.8l-.9-3.8A3.5 3.5 0 0 1 6.5 8.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M8 11.5v3M6.5 13h3M15.5 12h.01M17.5 13.5h.01"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          )}

          <button
            type="button"
            className="icon-btn"
            onClick={() => void loadLibrary()}
            title="Reload library (R)"
            aria-label="Reload library"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={() => setActiveModal('settings')}
            title="Settings & Library"
            aria-label="Settings and library"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          </button>

          <span className="clock">{clock}</span>
        </div>
      </header>

      {status === null ? (
        <main className="center-panel">
          <p className="hint">Loading your game library...</p>
        </main>
      ) : isErrorState ? (
        <main className="center-panel" role="alert">
          <div className={`state-card ${isElectron ? 'state-card-error' : ''}`}>
            <span className="state-badge">
              {isElectron ? 'games.json could not be read' : 'Browser preview mode'}
            </span>
            <h1>
              {isElectron
                ? 'Your library file has a syntax error'
                : 'Open the Electron desktop window for full features'}
            </h1>
            <p className="state-copy">
              {status.error ?? 'Open games.json to fix the formatting, then reload your library.'}
            </p>
            <div className="action-row">
              {isElectron ? (
                <>
                  <button
                    type="button"
                    className={`btn btn-primary ${modalActionIndex === 0 ? 'focused' : ''}`}
                    onClick={() => void openGamesFile()}
                  >
                    Open games.json
                  </button>
                  <button
                    type="button"
                    className={`btn btn-secondary ${modalActionIndex === 1 ? 'focused' : ''}`}
                    onClick={() => void loadLibrary()}
                  >
                    Reload library
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    setStatus({
                      ok: true,
                      games: BROWSER_DEMO_GAMES,
                      warnings: []
                    })
                  }
                >
                  Preview PS5 UI with demo games
                </button>
              )}
            </div>
          </div>
        </main>
      ) : isEmptyLibrary ? (
        <main className="center-panel">
          <div className="state-card">
            <span className="state-badge">Empty library</span>
            <h1>No playable games yet</h1>
            <p className="state-copy">
              {warnings.length > 0
                ? 'All entries in games.json were skipped because of invalid paths or URIs. Scan your laptop, add a game, or open games.json.'
                : 'Scan your laptop for installed games or add a game executable directly.'}
            </p>
            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setActiveModal('scan')}
              >
                Scan laptop for games
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveModal('add')}
              >
                + Add game
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void openGamesFile()}
              >
                Open games.json
              </button>
            </div>
          </div>
        </main>
      ) : isEmptyFiltered ? (
        <main className="center-panel">
          <div className="state-card">
            <span className="state-badge">No matches</span>
            <h1>No games match this filter</h1>
            <p className="state-copy">
              {filter === 'favorites'
                ? 'Press F or open Game Options to mark a game as a favourite.'
                : filter === 'recent'
                  ? 'Launch a game to see it in your Recently Played list.'
                  : 'Clear your search query to see all games in your library.'}
            </p>
            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setFilter('all')
                  setSearchQuery('')
                  setSearchOpen(false)
                }}
              >
                Show all games
              </button>
            </div>
          </div>
        </main>
      ) : (
        <main className="ps5-stage">
          {/* Upper-Left PS5 Game Ribbon */}
          <section className="ribbon-section" aria-label="Game library">
            <div className="ribbon-viewport">
              <div className="ribbon-track" style={{ transform: `translateX(-${ribbonShift}px)` }}>
                {visibleGames.map((g, i) => {
                  const isActive = i === clampedIndex
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={`ribbon-tile ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        if (isActive) {
                          void launch()
                        } else {
                          playUiSound('move', soundEnabled)
                          setIndex(i)
                        }
                      }}
                      aria-label={g.name}
                      aria-pressed={isActive}
                    >
                      <div className="ribbon-tile-inner">
                        {g.cover ? (
                          <img src={g.cover} alt={g.name} draggable={false} />
                        ) : (
                          <div
                            className="tile-fallback"
                            style={{ ['--tile-accent' as string]: g.color ?? '#2f6bff' }}
                          >
                            <svg
                              width="34"
                              height="34"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                              className="tile-fallback-icon"
                            >
                              <path
                                d="M6.5 8.5h11a3.5 3.5 0 0 1 3.4 4.3l-.9 3.8a2.3 2.3 0 0 1-4.1.8l-1.5-2h-4.8l-1.5 2a2.3 2.3 0 0 1-4.1-.8l-.9-3.8A3.5 3.5 0 0 1 6.5 8.5Z"
                                stroke="currentColor"
                                strokeWidth="1.6"
                              />
                              <path
                                d="M8 11.5v3M6.5 13h3M15.5 12h.01M17.5 13.5h.01"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              />
                            </svg>
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}

                <button
                  type="button"
                  className="ribbon-tile library-tile"
                  onClick={() => setActiveModal('scan')}
                  title="Scan laptop for games"
                  aria-label="Scan laptop for games"
                >
                  <div className="ribbon-tile-inner library-tile-inner">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="3" y="3" width="6" height="6" rx="1.5" fill="currentColor" />
                      <rect x="11" y="3" width="6" height="6" rx="1.5" fill="currentColor" />
                      <rect x="3" y="11" width="6" height="6" rx="1.5" fill="currentColor" />
                      <path
                        d="M12.5 14.5h6a2 2 0 0 1 1.9 2.5l-.4 1.6a1.4 1.4 0 0 1-2.5.4l-.8-1h-2.4l-.8 1a1.4 1.4 0 0 1-2.5-.4l-.4-1.6a2 2 0 0 1 1.9-2.5Z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                </button>
              </div>
            </div>

            <div className="ribbon-caption">
              <span className="ribbon-game-name">{game?.name}</span>
            </div>
          </section>

          {/* Lower-Left Hero Title & Play Hub */}
          <section className="hero-hub">
            <h1 className="hero-title">{game?.name}</h1>

            {launchError ? (
              <div className="error-banner" role="alert">
                <span>{launchError}</span>
                <button type="button" className="inline-link" onClick={() => void openGamesFile()}>
                  Open games.json
                </button>
              </div>
            ) : (
              <p className="hero-subtitle">
                {gamePlayRecord
                  ? `${formatDuration(gamePlayRecord.totalMs)} played · Last played ${formatLastPlayed(gamePlayRecord.lastPlayed)}`
                  : 'Press Enter or A to start'}
                {isFavorite ? ' · Favourite' : ''}
              </p>
            )}

            <div className="hero-actions">
              <button
                type="button"
                className="play-pill"
                onClick={() => void launch()}
                disabled={launching}
              >
                {launching ? 'Starting...' : 'Play'}
              </button>
              <button
                type="button"
                className="more-circle"
                onClick={() => {
                  setConfirmRemove(false)
                  setActiveModal('game-options')
                }}
                title="Game options (Y)"
                aria-label="Game options"
              >
                •••
              </button>
            </div>
          </section>
        </main>
      )}

      {/* Subtle Bottom Controls Legend */}
      <footer className="legend">
        <span>
          <kbd>←</kbd> <kbd>→</kbd> / D-pad Move
        </span>
        <span>
          <kbd>Enter</kbd> / <kbd>A</kbd> Play
        </span>
        <span>
          <kbd>Y</kbd> Options
        </span>
        <span>
          <kbd>F</kbd> Favourite
        </span>
        <span>
          <kbd>/</kbd> Search
        </span>
        <span>
          <kbd>F11</kbd> Fullscreen
        </span>
      </footer>

      {/* Game Options Modal (Y / •••) */}
      {activeModal === 'game-options' && game && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`${game.name} options`}
          onClick={closeModal}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{game.name}</h2>
              <button type="button" className="close-btn" onClick={closeModal} aria-label="Close">
                Esc / B
              </button>
            </div>

            <p className="modal-subtitle">
              {gamePlayRecord
                ? `${formatDuration(gamePlayRecord.totalMs)} played · Last played ${formatLastPlayed(gamePlayRecord.lastPlayed)}`
                : 'Manage this game, artwork, or install folder.'}
            </p>

            <div className="options-stack">
              <button
                type="button"
                className="option-row-btn"
                onClick={() => void revealSelectedGame()}
              >
                <span>Open file location in Explorer</span>
                <span className="option-hint">Shows .exe folder</span>
              </button>

              <button
                type="button"
                className="option-row-btn"
                onClick={() => void fetchSelectedArt()}
                disabled={fetchingArt}
              >
                <span>{fetchingArt ? 'Fetching artwork...' : 'Fetch cover & hero art'}</span>
                <span className="option-hint">SteamGridDB</span>
              </button>

              <button
                type="button"
                className="option-row-btn"
                onClick={() => toggleFavorite(game.id)}
              >
                <span>{isFavorite ? 'Remove from Favourites' : 'Add to Favourites'}</span>
                <span className="option-hint">Shortcut: F</span>
              </button>

              <button
                type="button"
                className="option-row-btn"
                onClick={() => setActiveModal('edit')}
              >
                <span>Edit game details</span>
                <span className="option-hint">Title, target, cover, accent</span>
              </button>

              {!confirmRemove ? (
                <button
                  type="button"
                  className="option-row-btn danger"
                  onClick={() => setConfirmRemove(true)}
                >
                  <span>Remove from Sky Launcher</span>
                  <span className="option-hint">Keeps game files on disk</span>
                </button>
              ) : (
                <div className="confirm-remove-box">
                  <span>Remove {game.name} from Sky Launcher?</span>
                  <div className="confirm-remove-actions">
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void removeSelectedGame()}
                    >
                      Yes, remove
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setConfirmRemove(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings & Library Modal */}
      {activeModal === 'settings' && (
        <SettingsModal
          warnings={warnings}
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
          onOpenGamesFile={openGamesFile}
          onReloadLibrary={loadLibrary}
          onClose={closeModal}
        />
      )}

      {/* Add / Edit Game Modal */}
      {(activeModal === 'add' || activeModal === 'edit') && (
        <GameFormModal
          mode={activeModal}
          initialGame={activeModal === 'edit' ? game : undefined}
          onClose={closeModal}
          onSaved={async (savedGame: GameEntry | undefined) => {
            closeModal()
            await loadLibrary(savedGame?.id)
          }}
        />
      )}

      {/* Scan Laptop Modal */}
      {activeModal === 'scan' && (
        <ScanModal
          existingNames={allGames.map((g) => g.name)}
          onClose={closeModal}
          onImported={async () => {
            await loadLibrary()
          }}
        />
      )}
    </div>
  )
}

export default App
