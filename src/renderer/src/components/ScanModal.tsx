import { useState } from 'react'
import type { ScanCandidate } from '../../../preload/index.d'

type ScanModalProps = {
  existingNames: string[]
  onClose: () => void
  onImported: () => Promise<void>
}

const SOURCE_LABELS: Record<ScanCandidate['source'], string> = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  folder: 'Folder'
}

const NON_GAME_PATTERN =
  /vcredist|dxwebsetup|directx|dotnet|oalinst|redist|gdfinstall|gdftool|firewall|updater|unins|setup|install|crash|reporter|qtwebengine|pbsvc|uplaybrowser|yuzu-cmd|trainer|editor|config/i

function isGameShortcut(item: ScanCandidate): boolean {
  if (item.source !== 'folder') return true
  const target = `${item.name} ${item.exe ?? ''}`
  return !NON_GAME_PATTERN.test(target)
}

export function ScanModal({
  existingNames,
  onClose,
  onImported
}: ScanModalProps): React.JSX.Element {
  const [candidates, setCandidates] = useState<ScanCandidate[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [importing, setImporting] = useState(false)
  const [statusMessage, setStatusMessage] = useState(
    'Scan Steam, Epic, and GOG automatically, or pick a folder on your laptop.'
  )
  const [error, setError] = useState('')

  const existingSet = new Set(existingNames.map((n) => n.trim().toLowerCase()))

  const applyResults = (items: ScanCandidate[], label: string): void => {
    const filtered = items.filter(isGameShortcut)
    setCandidates(filtered)
    const nextSelected = new Set<number>()
    filtered.forEach((item, idx) => {
      if (!existingSet.has(item.name.trim().toLowerCase())) {
        nextSelected.add(idx)
      }
    })
    setSelected(nextSelected)
    if (filtered.length === 0) {
      setStatusMessage(`No game shortcuts found from ${label}.`)
    } else {
      setStatusMessage(
        `Found ${filtered.length} ${filtered.length === 1 ? 'game' : 'games'} from ${label}. Choose which ones to add.`
      )
    }
  }

  const handleScanStores = async (): Promise<void> => {
    if (!window.api) return
    setScanning(true)
    setError('')
    setStatusMessage('Scanning Steam, Epic, and GOG...')
    try {
      const items = await window.api.scanStores()
      applyResults(items, 'installed stores')
    } catch {
      setError('Could not scan installed stores. Try scanning a specific folder instead.')
    } finally {
      setScanning(false)
    }
  }

  const handleScanFolder = async (): Promise<void> => {
    if (!window.api) return
    setError('')
    try {
      const folder = await window.api.pickFolder()
      if (!folder) return
      setScanning(true)
      setStatusMessage('Scanning selected folder for games...')
      const items = await window.api.scanFolder(folder)
      applyResults(items, 'selected folder')
    } catch {
      setError('Could not scan that folder. Make sure it is accessible and try again.')
    } finally {
      setScanning(false)
    }
  }

  const toggleIndex = (idx: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleImport = async (): Promise<void> => {
    if (!window.api || selected.size === 0) return
    setImporting(true)
    setError('')
    let added = 0
    let failed = 0
    for (const idx of selected) {
      const item = candidates[idx]
      if (!item) continue
      const res = await window.api.addGame({
        name: item.name,
        ...(item.exe ? { exe: item.exe } : {}),
        ...(item.uri ? { uri: item.uri } : {})
      })
      if (res.ok) added += 1
      else failed += 1
    }
    setImporting(false)
    if (failed > 0 && added === 0) {
      setError('Could not add the selected games. Check their paths or URIs.')
      return
    }
    try {
      const art = await window.api.fetchArtAll()
      if (art.ok && art.queued > 0) {
        setTimeout(() => {
          void onImported()
        }, 3000)
      }
    } catch {
      // Ignore art fetch errors when no API key is configured
    }
    await onImported()
    onClose()
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Scan laptop for games"
      onClick={onClose}
    >
      <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Scan laptop for games</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            Esc / B
          </button>
        </div>

        <p className="modal-subtitle">{statusMessage}</p>

        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleScanStores()}
            disabled={scanning || importing}
          >
            {scanning ? 'Scanning...' : 'Scan Steam, Epic & GOG'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleScanFolder()}
            disabled={scanning || importing}
          >
            Choose folder to scan
          </button>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
          </div>
        )}

        {candidates.length > 0 && (
          <div className="scan-results">
            <div className="scan-toolbar">
              <span>
                {selected.size} of {candidates.length} selected
              </span>
              <div className="scan-toolbar-actions">
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => setSelected(new Set(candidates.map((_, i) => i)))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>

            <ul className="candidate-list">
              {candidates.map((item, idx) => {
                const isChecked = selected.has(idx)
                const alreadyInLibrary = existingSet.has(item.name.trim().toLowerCase())
                return (
                  <li key={`${item.source}-${item.name}-${idx}`}>
                    <label className={`candidate-row ${isChecked ? 'checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleIndex(idx)}
                      />
                      <span className="candidate-name">{item.name}</span>
                      <span className={`source-badge source-${item.source}`}>
                        {SOURCE_LABELS[item.source]}
                      </span>
                      {alreadyInLibrary && <span className="in-library-tag">In library</span>}
                    </label>
                  </li>
                )
              })}
            </ul>

            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={selected.size === 0 || importing}
                onClick={() => void handleImport()}
              >
                {importing
                  ? 'Adding games...'
                  : `Add ${selected.size} ${selected.size === 1 ? 'game' : 'games'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
