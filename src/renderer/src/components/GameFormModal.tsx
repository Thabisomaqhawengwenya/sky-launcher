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
  const [exePath, setExePath] = useState<string | null>(null)
  const [uri, setUri] = useState('')
  const [coverPath, setCoverPath] = useState<string | null>(null)
  const [color, setColor] = useState(initialGame?.color ?? '#2f6bff')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handlePickExe = async (): Promise<void> => {
    if (!window.api) return
    const picked = await window.api.pickExe()
    if (picked) {
      setExePath(picked)
      if (!name.trim()) {
        const base = fileLabel(picked).replace(/\.exe$/i, '')
        setName(base)
      }
      setError('')
    }
  }

  const handlePickCover = async (): Promise<void> => {
    if (!window.api) return
    const picked = await window.api.pickCover()
    if (picked) {
      setCoverPath(picked)
      setError('')
    }
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!window.api) return

    const trimmedName = name.trim()
    const trimmedUri = uri.trim()

    if (!trimmedName) {
      setError('Enter a game name.')
      return
    }
    if (mode === 'add' && !exePath && !trimmedUri) {
      setError('Choose a game .exe file or enter a Steam / Epic URI.')
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
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="modal-header">
          <h2>{mode === 'add' ? 'Add game' : `Edit ${initialGame?.name ?? 'game'}`}</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            Esc / B
          </button>
        </div>

        <div className="form-grid">
          <label className="field">
            <span className="field-label">Game name</span>
            <input
              type="text"
              className="text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cyberpunk 2077"
              autoFocus
            />
          </label>

          <div className="field">
            <span className="field-label">
              Game executable (.exe){mode === 'edit' ? ' (optional to replace)' : ''}
            </span>
            <div className="picker-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handlePickExe()}
              >
                {exePath ? `Selected: ${fileLabel(exePath)}` : 'Choose .exe file'}
              </button>
              {exePath && (
                <button type="button" className="inline-link" onClick={() => setExePath(null)}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <label className="field">
            <span className="field-label">
              Or store launch URI (steam:// or com.epicgames.launcher://)
            </span>
            <input
              type="text"
              className="text-input"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="steam://rungameid/730"
            />
          </label>

          <div className="field">
            <span className="field-label">Cover art (optional)</span>
            <div className="picker-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handlePickCover()}
              >
                {coverPath ? `Selected: ${fileLabel(coverPath)}` : 'Choose cover image'}
              </button>
              {coverPath && (
                <button type="button" className="inline-link" onClick={() => setCoverPath(null)}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Accent colour</span>
            <div className="swatch-row">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`swatch ${color === preset ? 'active' : ''}`}
                  style={{ background: preset }}
                  onClick={() => setColor(preset)}
                  aria-label={`Select colour ${preset}`}
                  aria-pressed={color === preset}
                />
              ))}
              <input
                type="color"
                className="color-picker"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Custom accent colour"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="action-row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : mode === 'add' ? 'Add to library' : 'Save changes'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
