import { useState } from 'react'

export type UserProfile = {
  email: string
  displayName: string
  signedInAt: string
}

type ProfileModalProps = {
  user: UserProfile | null
  onSignIn: (user: UserProfile) => void
  onSignOut: () => void
  onClose: () => void
}

export function ProfileModal({
  user,
  onSignIn,
  onSignOut,
  onClose
}: ProfileModalProps): React.JSX.Element {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const trimmedEmail = email.trim()
    const trimmedName = displayName.trim()

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (mode === 'signup' && !trimmedName) {
      setError('Enter a display name for your profile.')
      return
    }

    setError('')
    const resolvedName = mode === 'signup' ? trimmedName : trimmedEmail.split('@')[0] || 'Player'

    onSignIn({
      email: trimmedEmail,
      displayName: resolvedName,
      signedInAt: new Date().toISOString()
    })
    setNotice('Signed in locally. Cloud save sync will activate once Firebase backend is wired.')
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Player profile and cloud saves"
      onClick={onClose}
    >
      <div className="console-sheet profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-preview settings-aside">
          <div className="profile-avatar-lg">
            {user ? user.displayName.slice(0, 2).toUpperCase() : 'G'}
          </div>
          <h3>{user ? user.displayName : 'Local Profile'}</h3>
          <p className="settings-aside-copy">
            {user
              ? user.email
              : 'Sign in or create an account to sync your library, play time, and game saves.'}
          </p>
          <span className="profile-sync-badge">
            {user ? 'Local session (Firebase pending)' : 'Not signed in'}
          </span>
        </div>

        <div className="sheet-body">
          <div className="modal-header">
            <h2>
              {user ? 'Account & Cloud Saves' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </h2>
            <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
              Esc / B
            </button>
          </div>

          {user ? (
            <div className="sheet-fields">
              <div className="profile-info-card">
                <div className="profile-info-row">
                  <span className="sheet-label">Display name</span>
                  <span>{user.displayName}</span>
                </div>
                <div className="profile-info-row">
                  <span className="sheet-label">Email</span>
                  <span>{user.email}</span>
                </div>
                <div className="profile-info-row">
                  <span className="sheet-label">Cloud saves</span>
                  <span className="option-hint">Waiting for Phase 8 Firebase backend</span>
                </div>
              </div>

              {notice && <div className="ok-box">{notice}</div>}

              <div className="sheet-footer">
                <button type="button" className="btn btn-danger" onClick={onSignOut}>
                  Sign out
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form className="sheet-fields" onSubmit={handleSubmit}>
              <div className="segmented">
                <button
                  type="button"
                  className={`seg-btn ${mode === 'signin' ? 'active' : ''}`}
                  onClick={() => {
                    setMode('signin')
                    setError('')
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={`seg-btn ${mode === 'signup' ? 'active' : ''}`}
                  onClick={() => {
                    setMode('signup')
                    setError('')
                  }}
                >
                  Create account
                </button>
              </div>

              {mode === 'signup' && (
                <label className="sheet-row">
                  <span className="sheet-label">Display name</span>
                  <input
                    type="text"
                    className="sheet-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Mr Q"
                    autoFocus
                  />
                </label>
              )}

              <label className="sheet-row">
                <span className="sheet-label">Email</span>
                <input
                  type="email"
                  className="sheet-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="player@example.com"
                  autoFocus={mode === 'signin'}
                />
              </label>

              <label className="sheet-row">
                <span className="sheet-label">Password</span>
                <input
                  type="password"
                  className="sheet-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                />
              </label>

              {error && (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                </div>
              )}

              <div className="sheet-footer">
                <button type="submit" className="btn btn-primary">
                  {mode === 'signin' ? 'Sign in' : 'Create account'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
