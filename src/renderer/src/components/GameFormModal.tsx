import { useState } from 'react'
import type { GameEntry } from '../../../preload/index.d'

const ACCENT_PRESETS = ['#2f6bff', '#10b981', '#e67e22', '#f43f5e', '#a855f7', '#eab308']

type GameFormModalProps = {
  mode: 'add' | 'edit'
  initialGame?: GameEntry
  onClose: () => void
  onSaved: (savedGame?: GameEntry) => Promise<void>
}

function fileLabel(pathValue: string | null): string {
  if (!pathValue) return ''
  const parts = pathValue.split(/[\\/]/)
  return parts[parts.length - 1] || 'Selected'
}

export function GameFormModal({
  mode,
  initialGame,
  onClose,
  onSaved
}: GameFormModalProps): React.JSX.Element {
  const [name, setName] = useState(initialGame?.name ?? '')
  const [sourceType, setSourceType] = useState<'exe' | 'uri'>('exe')
  const [exePath, setExePath] = useState<string | null>(null)
  const [uri, setUri] = useState('')
  const [coverPath, setCoverPath] = useState<string | null>(null)
  const [color, setColor] = useState(initialGame?.color ?? '#2f6bff')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handlePickExe = async (): Promise<void> => {
    if (!window.api) {
      setError('File picker requires the Electron desktop window.')
      return
    }
    const picked = await window.api.pickExe()
    if (picked) {
      setExePath(picked)
      if (!name.trim()) {
        setName(fileLabel(picked).replace(/\.exe$/i, ''))
      }
      setError('')
    }
  }

  const handlePickCover = async (): Promise<void> => {
    if (!window.api) {
      setError('Image picker requires the Electron desktop window.')
      return
    }
    const picked = await window.api.pickCover()
    if (picked) {
      setCoverPath(picked)
      setError('')
    }
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!window.api) {
      setError('Saving to games.json requires the Electron desktop window.')
      return
    }

    const trimmedName = name.trim()
    const trimmedUri = uri.trim()

    if (!trimmedName) {
      setError('Enter a game title.')
      return
    }
    if (mode === 'add' && !exePath && !trimmedUri) {
      setError('Select a game .exe file or enter a Steam / Epic launch URI.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const res =
        mode === 'add'
          ? await window.api.addGame({
              name: trimmedName,
              ...(exePath ? { exe: exePath } : {}),
              ...(trimmedUri ? { uri: trimmedUri } : {}),
              ...(coverPath ? { cover: coverPath } : {}),
              color
            })
          : await window.api.editGame(initialGame!.id, {
              name: trimmedName,
              ...(exePath ? { exe: exePath } : {}),
              ...(trimmedUri ? { uri: trimmedUri } : {}),
              ...(coverPath ? { cover: coverPath } : {}),
              color
            })

      if (!res.ok) {
        setError(res.error ?? 'Could not save this game.')
        return
      }
      await onSaved(res.game)
    } catch {
      setError('Could not save this game. Check your inputs and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'add' ? 'Add game' : 'Edit game'}
      onClick={onClose}
    >
      <form
        className="console-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="sheet-preview" style={{ ['--sheet-accent' as string]: color }}>
          <div className="sheet-preview-tile">
            {initialGame?.cover ? (
              <img src={initialGame.cover} alt={name || 'Game cover'} draggable={false} />
            ) : (
              <div className="sheet-preview-art">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
          <div className="sheet-preview-title">{name.trim() || 'Untitled Game'}</div>
          <button
            type="button"
            className="sheet-cover-trigger"
            onClick={() => void handlePickCover()}
          >
            {coverPath ? `Art: ${fileLabel(coverPath)}` : 'Change cover art'}
          </button>
          {coverPath && (
            <button type="button" className="inline-link" onClick={() => setCoverPath(null)}>
              Reset art
            </button>
          )}
        </div>

        <div className="sheet-body">
          <div className="modal-header">
            <h2>{mode === 'add' ? 'Add game' : `Edit ${initialGame?.name ?? 'game'}`}</h2>
            <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
              Esc / B
            </button>
          </div>

          <div className="sheet-fields">
            <label className="sheet-row">
              <span className="sheet-label">Title</span>
              <input
                type="text"
                className="sheet-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter game title"
                autoFocus
              />
            </label>

            <div className="sheet-row">
              <div className="sheet-row-head">
                <span className="sheet-label">Launch target</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={`seg-btn ${sourceType === 'exe' ? 'active' : ''}`}
                    onClick={() => setSourceType('exe')}
                  >
                    Local .exe
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${sourceType === 'uri' ? 'active' : ''}`}
                    onClick={() => setSourceType('uri')}
                  >
                    Store URI
                  </button>
                </div>
              </div>

              {sourceType === 'exe' ? (
                <div className="sheet-file-bar">
                  <span className="sheet-file-name">
                    {exePath ? fileLabel(exePath) : 'No executable selected'}
                  </span>
                  <button
                    type="button"
                    className="sheet-browse-btn"
                    onClick={() => void handlePickExe()}
                  >
                    Browse .exe
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  className="sheet-input"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="steam://rungameid/730"
                />
              )}
            </div>

            <div className="sheet-row">
              <span className="sheet-label">Accent</span>
              <div className="accent-bar">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`accent-chip ${color === preset ? 'active' : ''}`}
                    style={{ background: preset }}
                    onClick={() => setColor(preset)}
                    aria-label={`Select colour ${preset}`}
                    aria-pressed={color === preset}
                  />
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
            </div>
          )}

          <div className="sheet-footer">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : mode === 'add' ? 'Add to library' : 'Save changes'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
