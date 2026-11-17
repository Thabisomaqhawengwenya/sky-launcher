import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryStatus } from '../../preload/index.d'

function getRibbonMetrics(width: number): {
  activeTile: number
  idleTile: number
  gap: number
} {
  if (width >= 1600) return { activeTile: 132, idleTile: 96, gap: 14 }
  if (width >= 1200) return { activeTile: 110, idleTile: 80, gap: 12 }
  return { activeTile: 96, idleTile: 72, gap: 10 }
}

function getInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-zA-Z0-9]+/, ''))
    .filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function App(): React.JSX.Element {
  const [status, setStatus] = useState<LibraryStatus | null>(null)
  const [index, setIndex] = useState(0)
  const [launchError, setLaunchError] = useState('')
  const [launching, setLaunching] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [modalActionIndex, setModalActionIndex] = useState(0)
  const [gamepadConnected, setGamepadConnected] = useState(false)
  const [time, setTime] = useState(() => new Date())
  const [metrics, setMetrics] = useState(() => getRibbonMetrics(window.innerWidth))

  const games = useMemo(() => status?.games ?? [], [status])
  const warnings = status?.warnings ?? []

  const latest = useRef({
    games,
    index,
    showOptions,
    modalActionIndex,
    launchError,
    statusOk: status?.ok ?? true
  })
  useEffect(() => {
    latest.current = {
      games,
      index,
      showOptions,
      modalActionIndex,
      launchError,
      statusOk: status?.ok ?? true
    }
  }, [games, index, showOptions, modalActionIndex, launchError, status?.ok])

  const busy = useRef(false)

  const loadLibrary = useCallback(async () => {
    if (!window.api) {
      setStatus({
        ok: false,
        games: [],
        error:
          'Open Sky Launcher in the Electron window (npm run dev) to access your local game library.',
        warnings: []
      })
      return
    }
    try {
      const next = await window.api.getStatus()
      setStatus(next)
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
    const fetchStatus = window.api
      ? window.api.getStatus()
      : Promise.resolve<LibraryStatus>({
          ok: false,
          games: [],
          error:
            'Open Sky Launcher in the Electron window (npm run dev) to access your local game library.',
          warnings: []
        })

    fetchStatus
      .then((next) => {
        if (!active) return
        setStatus(next)
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
    const timer = setInterval(() => setTime(new Date()), 30_000)
    const onResize = (): void => setMetrics(getRibbonMetrics(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

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

  const move = useCallback((dir: number) => {
    const { showOptions: inModal, games: list, statusOk } = latest.current
    if (inModal || !statusOk || list.length === 0) {
      setModalActionIndex((prev) => (prev + dir + 2) % 2)
      return
    }
    const last = Math.max(list.length - 1, 0)
    setLaunchError('')
    setIndex((i) => Math.min(Math.max(i + dir, 0), last))
  }, [])

  const launch = useCallback(async () => {
    const game = latest.current.games[latest.current.index]
    if (!game || busy.current) return
    busy.current = true
    setLaunching(true)
    setLaunchError('')
    try {
      const res = await window.api.launchGame(game.id)
      if (!res.ok) {
        setLaunchError(
          res.error ?? 'Could not start this game. Check its path or URI in games.json.'
        )
      }
    } catch {
      setLaunchError('Could not start this game. Check its path or URI in games.json.')
    } finally {
      setTimeout(() => {
        busy.current = false
        setLaunching(false)
      }, 1200)
    }
  }, [])

  const openGamesFile = useCallback(async () => {
    if (!window.api) return
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
    const { showOptions: inModal, statusOk, games: list } = latest.current
    if (inModal || !statusOk || list.length === 0) {
      activateModalAction()
      return
    }
    void launch()
  }, [activateModalAction, launch])

  const handleBack = useCallback(() => {
    if (latest.current.showOptions) {
      setShowOptions(false)
      return
    }
    if (latest.current.launchError) {
      setLaunchError('')
    }
  }, [])

  const toggleOptions = useCallback(() => {
    setShowOptions((prev) => !prev)
    setModalActionIndex(0)
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') {
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
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        handleBack()
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        toggleOptions()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        void loadLibrary()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, handleConfirm, handleBack, toggleOptions, loadLibrary])

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

  const game = games[index]
  const accent = game?.color ?? '#2f6bff'
  const clock = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  const isErrorState = status !== null && !status.ok
  const isEmptyState = status !== null && status.ok && games.length === 0
  const ribbonShift = index * (metrics.idleTile + metrics.gap)

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
      {/* Full-bleed atmospheric backdrop */}
      <div
        key={game?.id ?? 'none'}
        className={`backdrop ${game?.cover ? 'has-cover' : ''}`}
        style={game?.cover ? { backgroundImage: `url("${game.cover}")` } : undefined}
      />
      <div className="backdrop-vignette" />
      <div className="accent-glow" />

      {/* PS5-style Top Bar */}
      <header className="topbar">
        <nav className="nav-tabs" aria-label="Primary">
          <span className="nav-tab active">Games</span>
          <span className="nav-count">
            {games.length} {games.length === 1 ? 'title' : 'titles'}
          </span>
        </nav>

        <div className="status-group">
          {warnings.length > 0 && (
            <button
              type="button"
              className="warning-chip"
              onClick={toggleOptions}
              title="View skipped entries from games.json"
            >
              <span className="warning-dot" />
              {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
            </button>
          )}

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
            onClick={toggleOptions}
            title="Library & Warnings (Y)"
            aria-label="Library and warnings"
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
          <div className="state-card state-card-error">
            <span className="state-badge">games.json could not be read</span>
            <h1>Your library file has a syntax error</h1>
            <p className="state-copy">
              {status.error ?? 'Open games.json to fix the formatting, then reload your library.'}
            </p>
            <div className="action-row">
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
            </div>
          </div>
        </main>
      ) : isEmptyState ? (
        <main className="center-panel">
          <div className="state-card">
            <span className="state-badge">Empty library</span>
            <h1>No playable games found</h1>
            <p className="state-copy">
              {warnings.length > 0
                ? 'All entries in games.json were skipped because of invalid paths or URIs. Open games.json to fix them, or press Y to inspect the warnings.'
                : 'Add games to games.json in your app data folder, then reload your library.'}
            </p>
            <div className="action-row">
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
            </div>
          </div>
        </main>
      ) : (
        <main className="ps5-stage">
          {/* Upper-Left PS5 Game Ribbon */}
          <section className="ribbon-section" aria-label="Game library">
            <div className="ribbon-viewport">
              <div className="ribbon-track" style={{ transform: `translateX(-${ribbonShift}px)` }}>
                {games.map((g, i) => {
                  const isActive = i === index
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={`ribbon-tile ${isActive ? 'active' : ''}`}
                      onClick={() => (isActive ? void launch() : setIndex(i))}
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
                            <span className="tile-monogram">{getInitials(g.name)}</span>
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}

                <button
                  type="button"
                  className="ribbon-tile library-tile"
                  onClick={toggleOptions}
                  title="Library & Warnings (Y)"
                  aria-label="Open Library and Warnings"
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
              <p className="hero-subtitle">Press Enter or A to start</p>
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
                onClick={toggleOptions}
                title="Library & Warnings (Y)"
                aria-label="Library and warnings"
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
          <kbd>Y</kbd> Library &amp; Warnings
        </span>
        <span>
          <kbd>R</kbd> Reload
        </span>
        <span>
          <kbd>F11</kbd> Fullscreen
        </span>
      </footer>

      {showOptions && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Library and warnings"
          onClick={() => setShowOptions(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Library &amp; Warnings</h2>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowOptions(false)}
                aria-label="Close"
              >
                Esc / B
              </button>
            </div>

            <p className="modal-subtitle">
              Games are read from <code>games.json</code> in your app data folder.
            </p>

            {warnings.length > 0 ? (
              <div className="warnings-box">
                <h3>Skipped entries ({warnings.length})</h3>
                <ul>
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="ok-box">
                All entries in <code>games.json</code> passed validation.
              </div>
            )}

            <div className="action-row">
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
