import { useEffect, useState } from 'react'
import type { AuthUser, Settings } from '../../../preload/index.d'

export type LauncherLayout = 'ps5' | 'grid'
export type TileScale = 'compact' | 'standard' | 'large'
export type BackdropBlur = 'low' | 'medium' | 'high'

export type UiPreferences = {
  layout: LauncherLayout
  tileScale: TileScale
  backdropBlur: BackdropBlur
  showLegend: boolean
  soundEnabled: boolean
}

type SettingsTab = 'appearance' | 'artwork' | 'system' | 'account'

type SettingsModalProps = {
  warnings: string[]
  prefs: UiPreferences
  user: AuthUser | null
  onUpdatePrefs: (patch: Partial<UiPreferences>) => void
  onOpenProfile: () => void
  onOpenGamesFile: () => Promise<void>
  onReloadLibrary: () => Promise<void>
  onClose: () => void
}

export function SettingsModal({
  warnings,
  prefs,
  user,
  onUpdatePrefs,
  onOpenProfile,
  onOpenGamesFile,
  onReloadLibrary,
  onClose
}: SettingsModalProps): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('appearance')
  const [apiKey, setApiKey] = useState('')
  const [minimizeOnLaunch, setMinimizeOnLaunch] = useState(true)
  const [autoBackupSaves, setAutoBackupSaves] = useState(false)
  const [fbApiKey, setFbApiKey] = useState('')
  const [fbProjectId, setFbProjectId] = useState('')
  const [fbStorageBucket, setFbStorageBucket] = useState('')
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
        setAutoBackupSaves(s.autoBackupSaves ?? false)
        setFbApiKey(s.firebase?.apiKey ?? '')
        setFbProjectId(s.firebase?.projectId ?? '')
        setFbStorageBucket(s.firebase?.storageBucket ?? '')
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

  const handleSaveSystem = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!window.api) {
      setError('Saving system settings requires the Electron desktop window.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const firebaseConfigured = fbApiKey.trim() && fbProjectId.trim() && fbStorageBucket.trim()
      const res = await window.api.setSettings({
        steamGridDbApiKey: apiKey.trim(),
        minimizeOnLaunch,
        autoBackupSaves,
        ...(firebaseConfigured
          ? {
              firebase: {
                apiKey: fbApiKey.trim(),
                authDomain: `${fbProjectId.trim()}.firebaseapp.com`,
                projectId: fbProjectId.trim(),
                storageBucket: fbStorageBucket.trim()
              }
            }
          : {})
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
      aria-label="Settings"
      onClick={onClose}
    >
      <form
        className="console-sheet settings-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSaveSystem(e)}
      >
        <nav className="settings-nav" aria-label="Settings categories">
          <div className="settings-nav-title">Settings</div>
          <button
            type="button"
            className={`settings-nav-item ${tab === 'appearance' ? 'active' : ''}`}
            onClick={() => setTab('appearance')}
          >
            Appearance &amp; Layouts
          </button>
          <button
            type="button"
            className={`settings-nav-item ${tab === 'artwork' ? 'active' : ''}`}
            onClick={() => setTab('artwork')}
          >
            Artwork &amp; Media
          </button>
          <button
            type="button"
            className={`settings-nav-item ${tab === 'system' ? 'active' : ''}`}
            onClick={() => setTab('system')}
          >
            Launch &amp; Library
          </button>
          <button
            type="button"
            className={`settings-nav-item ${tab === 'account' ? 'active' : ''}`}
            onClick={() => setTab('account')}
          >
            Account &amp; Cloud Saves
          </button>
        </nav>

        <div className="sheet-body">
          <div className="modal-header">
            <h2>
              {tab === 'appearance'
                ? 'Appearance & Layouts'
                : tab === 'artwork'
                  ? 'Artwork & Media'
                  : tab === 'system'
                    ? 'Launch & Library'
                    : 'Account & Cloud Saves'}
            </h2>
            <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
              Esc / B
            </button>
          </div>

          {loading ? (
            <div className="sheet-fields" aria-busy="true" aria-label="Loading settings">
              <div className="skeleton-line skeleton-field-label" />
              <div className="skeleton-box skeleton-input" />
              <div className="skeleton-box skeleton-toggle" />
              <div className="skeleton-box skeleton-toggle" />
            </div>
          ) : tab === 'appearance' ? (
            <div className="sheet-fields">
              <div className="sheet-row">
                <span className="sheet-label">Home layout</span>
                <div className="layout-grid">
                  <button
                    type="button"
                    className={`layout-card ${prefs.layout === 'ps5' ? 'active' : ''}`}
                    onClick={() => onUpdatePrefs({ layout: 'ps5' })}
                    aria-pressed={prefs.layout === 'ps5'}
                  >
                    <div className="layout-thumb layout-thumb-ps5">
                      <span className="lt-row">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="lt-hero" />
                    </div>
                    <span className="layout-name">PS5 Home</span>
                    <span className="layout-desc">Top ribbon + hero stage</span>
                  </button>

                  <button
                    type="button"
                    className={`layout-card ${prefs.layout === 'grid' ? 'active' : ''}`}
                    onClick={() => onUpdatePrefs({ layout: 'grid' })}
                    aria-pressed={prefs.layout === 'grid'}
                  >
                    <div className="layout-thumb layout-thumb-grid">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                    <span className="layout-name">Compact Grid</span>
                    <span className="layout-desc">Multi-column library grid</span>
                  </button>
                </div>
              </div>

              <div className="sheet-row">
                <div className="sheet-row-head">
                  <span className="sheet-label">Tile size</span>
                  <div className="segmented">
                    {(['compact', 'standard', 'large'] as TileScale[]).map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={`seg-btn ${prefs.tileScale === size ? 'active' : ''}`}
                        onClick={() => onUpdatePrefs({ tileScale: size })}
                      >
                        {size[0].toUpperCase() + size.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="sheet-row">
                <div className="sheet-row-head">
                  <span className="sheet-label">Backdrop blur</span>
                  <div className="segmented">
                    {(['low', 'medium', 'high'] as BackdropBlur[]).map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`seg-btn ${prefs.backdropBlur === level ? 'active' : ''}`}
                        onClick={() => onUpdatePrefs({ backdropBlur: level })}
                      >
                        {level[0].toUpperCase() + level.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="toggle-row">
                <span>
                  <span className="toggle-title">Show bottom controls legend</span>
                  <span className="toggle-sub">Display keyboard and controller hints</span>
                </span>
                <input
                  type="checkbox"
                  checked={prefs.showLegend}
                  onChange={(e) => onUpdatePrefs({ showLegend: e.target.checked })}
                />
              </label>
            </div>
          ) : tab === 'artwork' ? (
            <div className="sheet-fields">
              <label className="sheet-row">
                <span className="sheet-label">SteamGridDB API key</span>
                <input
                  type="password"
                  className="sheet-input"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste key from steamgriddb.com"
                  autoComplete="off"
                />
              </label>

              <div className="sheet-row">
                <span className="sheet-label">Batch artwork download</span>
                <div className="sheet-file-bar">
                  <span className="sheet-file-name">
                    {artStatus || 'Download covers & wide hero art for games without cached art'}
                  </span>
                  <button
                    type="button"
                    className="sheet-browse-btn"
                    onClick={() => void handleFetchAllArt()}
                  >
                    Fetch missing art
                  </button>
                </div>
              </div>
            </div>
          ) : tab === 'system' ? (
            <div className="sheet-fields">
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
                  checked={prefs.soundEnabled}
                  onChange={(e) => onUpdatePrefs({ soundEnabled: e.target.checked })}
                />
              </label>

              <div className="sheet-row">
                <span className="sheet-label">Library file</span>
                <div className="sheet-file-bar">
                  <span className="sheet-file-name">games.json in %APPDATA%\sky-launcher</span>
                  <button
                    type="button"
                    className="sheet-browse-btn"
                    onClick={() => void onOpenGamesFile()}
                  >
                    Open folder
                  </button>
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="warnings-box">
                  <h3>Skipped entries ({warnings.length})</h3>
                  <ul>
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="sheet-fields">
              <div className="profile-info-card">
                <div className="profile-info-row">
                  <span className="sheet-label">Active account</span>
                  <span>{user ? user.email : 'Not signed in'}</span>
                </div>
                <div className="profile-info-row">
                  <span className="sheet-label">Firebase project</span>
                  <span className="option-hint">{fbProjectId || 'Not configured'}</span>
                </div>
              </div>

              <label className="sheet-row">
                <span className="sheet-label">Firebase Web API key</span>
                <input
                  type="password"
                  className="sheet-input"
                  value={fbApiKey}
                  onChange={(e) => setFbApiKey(e.target.value)}
                  placeholder="Paste Firebase Web API key"
                  autoComplete="off"
                />
              </label>

              <div className="layout-grid">
                <label className="sheet-row">
                  <span className="sheet-label">Project ID</span>
                  <input
                    type="text"
                    className="sheet-input"
                    value={fbProjectId}
                    onChange={(e) => setFbProjectId(e.target.value)}
                    placeholder="my-sky-launcher"
                  />
                </label>

                <label className="sheet-row">
                  <span className="sheet-label">Storage bucket</span>
                  <input
                    type="text"
                    className="sheet-input"
                    value={fbStorageBucket}
                    onChange={(e) => setFbStorageBucket(e.target.value)}
                    placeholder="my-sky-launcher.appspot.com"
                  />
                </label>
              </div>

              <label className="toggle-row">
                <span>
                  <span className="toggle-title">Auto-backup game saves on exit</span>
                  <span className="toggle-sub">
                    Uploads save folder to Firebase Storage when game closes
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={autoBackupSaves}
                  onChange={(e) => setAutoBackupSaves(e.target.checked)}
                />
              </label>

              <div className="action-row">
                <button type="button" className="btn btn-secondary" onClick={onOpenProfile}>
                  {user ? 'Manage account & sync' : 'Sign in / Create account'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
            </div>
          )}
          {message && <div className="ok-box">{message}</div>}

          <div className="sheet-footer">
            {(tab === 'artwork' || tab === 'system' || tab === 'account') && (
              <button type="submit" className="btn btn-primary" disabled={saving || loading}>
                {saving ? 'Saving...' : 'Save settings'}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
