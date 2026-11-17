import { useCallback, useEffect, useRef, useState } from 'react'

type Game = { id: string; name: string; cover?: string; color?: string }

const TILE = 220
const GAP = 28

function App(): React.JSX.Element {
  const [games, setGames] = useState<Game[]>([])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const [time, setTime] = useState(() => new Date())

  const latest = useRef({ games, index })
  useEffect(() => {
    latest.current = { games, index }
  }, [games, index])
  const busy = useRef(false)

  useEffect(() => {
    window.api.listGames().then(setGames)
    const t = setInterval(() => setTime(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const move = useCallback((dir: number) => {
    const last = Math.max(latest.current.games.length - 1, 0)
    setIndex((i) => Math.min(Math.max(i + dir, 0), last))
  }, [])

  const launch = useCallback(async () => {
    const game = latest.current.games[latest.current.index]
    if (!game || busy.current) return
    busy.current = true
    setError('')
    const res = await window.api.launchGame(game.id)
    if (!res.ok) setError(res.error ?? 'Could not start this game')
    setTimeout(() => (busy.current = false), 2000)
  }, [])

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') move(1)
      else if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === 'Enter') launch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, launch])

  // Controller: D-pad or left stick to move, A (button 0) to play
  useEffect(() => {
    let raf = 0
    let lastMove = 0
    let aWasDown = false
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
        if (a && !aWasDown) launch()
        aWasDown = a
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [move, launch])

  const game = games[index]
  const clock = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="app" style={{ ['--accent' as string]: game?.color ?? '#2f6bff' }}>
      <div
        key={game?.id ?? 'none'}
        className="backdrop"
        style={game?.cover ? { backgroundImage: `url("${game.cover}")` } : undefined}
      />
      <div className="shade" />

      <header>
        <span>My Games</span>
        <span>{clock}</span>
      </header>

      {games.length === 0 ? (
        <div className="info">
          <h1>No games yet</h1>
          <p className="hint">Add your games to games.json, then restart the launcher.</p>
          <button className="btn" onClick={() => window.api.openGamesFile()}>
            Open games.json
          </button>
        </div>
      ) : (
        <>
          <div className="row-wrap">
            <div
              className="row"
              style={{
                transform: `translateX(calc(50vw - ${TILE / 2}px - ${index * (TILE + GAP)}px))`
              }}
            >
              {games.map((g, i) => (
                <div
                  key={g.id}
                  className={`tile ${i === index ? 'active' : ''}`}
                  onClick={() => (i === index ? launch() : setIndex(i))}
                >
                  {g.cover ? <img src={g.cover} alt="" draggable={false} /> : <span>{g.name}</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="info">
            <h1>{game?.name}</h1>
            {error ? (
              <p className="hint error">{error}</p>
            ) : (
              <p className="hint">Press Enter or A to play. Press F11 for fullscreen.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default App
