import { useState } from 'react'
import type { AuthUser } from '../../../preload/index.d'

type ProfileModalProps = {
  user: AuthUser | null
  onAuthChange: (user: AuthUser | null) => void
  onSynced: () => Promise<void>
  onClose: () => void
}

function EyeIcon({ visible }: { visible: boolean }): React.JSX.Element {
  return visible ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.58 10.58A2 2 0 0 0 13.42 13.42M9.88 5.09A10.94 10.94 0 0 1 12 4.91c5 0 9.27 3.11 11 7.09a11.72 11.72 0 0 1-3.16 4.35M6.61 6.61A11.83 11.83 0 0 0 1 12c1.73 3.98 6 7.09 11 7.09 1.61 0 3.14-.32 4.5-.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export function ProfileModal({
  user,
  onAuthChange,
  onSynced,
  onClose
}: ProfileModalProps): React.JSX.Element {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!window.api) {
      setError('Firebase sign-in requires the Electron desktop window.')
      return
    }

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res =
        mode === 'signin'
          ? await window.api.authSignIn(trimmedEmail, password)
          : await window.api.authSignUp(trimmedEmail, password)

      if (!res.ok || !res.user) {
        setError(
          res.error ?? 'Authentication failed. Check your Firebase settings and credentials.'
        )
        return
      }
      onAuthChange(res.user)
      setPassword('')
      setConfirmPassword('')
      setNotice('Signed in to Firebase.')
    } catch {
      setError('Could not connect to Firebase Authentication.')
    } finally {
      setBusy(false)
    }
  }

  const handleSyncProfile = async (): Promise<void> => {
    if (!window.api) return
    setSyncing(true)
    setError('')
    setNotice('')
    try {
      const res = await window.api.syncProfile()
      if (!res.ok) {
        setError(res.error ?? 'Could not sync profile.')
        return
      }
      await onSynced()
      setNotice('Profile, playtime, and library metadata synced to Firestore.')
    } catch {
      setError('Cloud sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    if (!window.api) {
      onAuthChange(null)
      return
    }
    setBusy(true)
    setError('')
    try {
      await window.api.authSignOut()
      onAuthChange(null)
      setNotice('')
    } catch {
      setError('Could not sign out.')
    } finally {
      setBusy(false)
    }
  }

  const avatarInitials = user ? user.email.slice(0, 2).toUpperCase() : 'G'

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
          <div className="profile-avatar-lg">{avatarInitials}</div>
          <h3>{user ? user.email.split('@')[0] : 'Local Profile'}</h3>
          <p className="settings-aside-copy">
            {user
              ? user.email
              : 'Sign in or create an account to sync your library, play time, and game saves.'}
          </p>
          <span className="profile-sync-badge">
            {user ? 'Firebase connected' : 'Not signed in'}
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
                  <span className="sheet-label">Email</span>
                  <span>{user.email}</span>
                </div>
                <div className="profile-info-row">
                  <span className="sheet-label">User ID</span>
                  <span className="option-hint">{user.uid.slice(0, 12)}...</span>
                </div>
              </div>

              {error && (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                </div>
              )}
              {notice && <div className="ok-box">{notice}</div>}

              <div className="sheet-footer">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSyncProfile()}
                  disabled={syncing || busy}
                >
                  {syncing ? 'Syncing...' : 'Sync profile now'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void handleSignOut()}
                  disabled={busy}
                >
                  Sign out
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form className="sheet-fields" onSubmit={(e) => void handleSubmit(e)}>
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

              <label className="sheet-row">
                <span className="sheet-label">Email</span>
                <input
                  type="email"
                  className="sheet-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="player@example.com"
                  autoFocus
                />
              </label>

              <div className="sheet-row">
                <span className="sheet-label">Password</span>
                <div className="password-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="sheet-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                  />
                  <button
                    type="button"
                    className="eye-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon visible={showPassword} />
                  </button>
                </div>
              </div>

              {mode === 'signup' && (
                <div className="sheet-row">
                  <span className="sheet-label">Confirm password</span>
                  <div className="password-wrap">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      className="sheet-input"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter your password"
                    />
                    <button
                      type="button"
                      className="eye-toggle"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label={
                        showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'
                      }
                    >
                      <EyeIcon visible={showConfirmPassword} />
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                </div>
              )}

              <div className="sheet-footer">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
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
