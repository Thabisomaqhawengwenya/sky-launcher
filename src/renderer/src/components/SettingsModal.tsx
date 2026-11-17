import { useEffect, useState } from 'react'
import type { Settings } from '../../../preload/index.d'

type SettingsModalProps = {
  warnings: string[]
  soundEnabled: boolean
  onToggleSound: (enabled: boolean) => void
  onOpenGamesFile: () => Promise<void>
  onReloadLibrary: () => Promise<void>
  onClose: () => void
}

export function SettingsModal({
  warnings,
  soundEnabled,
  onToggleSound,
  onOpenGamesFile,
  onReloadLibrary,
  onClose
}: SettingsModalProps): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [minimizeOnLaunch, setMinimizeOnLaunch] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [artStatus, setArtStatus] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!window.api) {
      Promise.resolve().then(() => {
        if (active) setLoading(false)
      })
      return () => {
        active = false
      }
    }

    window.api
      .getSettings()
      .then((s: Settings) => {
        if (!active) return
        setApiKey(s.steamGridDbApiKey ?? '')
        setMinimizeOnLaunch(s.minimizeOnLaunch ?? true)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError('Could not load settings.')
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!window.api) {
      setError('Saving settings requires the Electron desktop window.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await window.api.setSettings({
        steamGridDbApiKey: apiKey.trim(),
        minimizeOnLaunch
      })
      if (!res.ok) {
        setError(res.error ?? 'Could not save settings.')
        return
      }
      setMessage('Settings saved.')
    } catch {
      setError('Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  const handleFetchAllArt = async (): Promise<void> => {
    if (!window.api) {
      setError('Fetching artwork requires the Electron desktop window.')
      return
    }
    setError('')
    setArtStatus('Queueing artwork downloads...')
    try {
      const res = await window.api.fetchArtAll()
      if (!res.ok) {
        setArtStatus('')
        setError('Add your SteamGridDB API key above and save before fetching art.')
        return
      }
      if (res.queued === 0) {
        setArtStatus('All games already have cached artwork.')
        return
      }
      setArtStatus(`Fetching art for ${res.queued} ${res.queued === 1 ? 'game' : 'games'}...`)
      setTimeout(() => {
        void onReloadLibrary()
        setArtStatus('Artwork check complete. Library refreshed.')
      }, 3000)
    } catch {
      setArtStatus('')
      setError('Could not start artwork download.')
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Settings and library"
      onClick={onClose}
    >
      <form
        className="console-sheet settings-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSave(e)}
      >
        <div className="sheet-preview settings-aside">
          <div className="settings-aside-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          </div>
          <h3>Sky Launcher</h3>
          <p className="settings-aside-copy">
            Configure SteamGridDB artwork, launch behaviour, and library diagnostics.
          </p>

          <div className="settings-aside-actions">
            <button
              type="button"
              className="sheet-cover-trigger"
              onClick={() => void handleFetchAllArt()}
            >
              Fetch missing artwork
            </button>
            <button
              type="button"
              className="sheet-cover-trigger"
              onClick={() => void onOpenGamesFile()}
            >
              Open games.json
            </button>
          </div>

          {artStatus && <p className="settings-aside-status">{artStatus}</p>}
        </div>

        <div className="sheet-body">
          <div className="modal-header">
            <h2>Settings &amp; Library</h2>
            <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
              Esc / B
            </button>
          </div>

          {loading ? (
            <p className="hint">Loading settings...</p>
          ) : (
            <div className="sheet-fields">
              <div className="sheet-row">
                <div className="sheet-row-head">
                  <span className="sheet-label">SteamGridDB API key</span>
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => setShowKey((prev) => !prev)}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  type={showKey ? 'text' : 'password'}
                  className="sheet-input"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste key from steamgriddb.com"
                  autoComplete="off"
                />
              </div>

              <label className="toggle-row">
                <span>
                  <span className="toggle-title">Minimize launcher on game launch</span>
                  <span className="toggle-sub">
                    Automatically hides the window when a game starts
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={minimizeOnLaunch}
                  onChange={(e) => setMinimizeOnLaunch(e.target.checked)}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <span className="toggle-title">Console navigation sounds</span>
                  <span className="toggle-sub">
                    Subtle audio feedback when browsing or launching
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => onToggleSound(e.target.checked)}
                />
              </label>

              {warnings.length > 0 && (
                <div className="warnings-box">
                  <h3>Skipped games.json entries ({warnings.length})</h3>
                  <ul>
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
            </div>
          )}
          {message && <div className="ok-box">{message}</div>}

          <div className="sheet-footer">
            <button type="submit" className="btn btn-primary" disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save settings'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
