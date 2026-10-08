import { useState } from 'react'
import { api } from '../lib/api.js'
import { setToken } from '../lib/session.js'
import PasswordField from '../components/PasswordField.jsx'
import { APP_VERSION } from '../version.js'

const libelle = { display: 'block', textTransform: 'uppercase', color: 'var(--stone)', letterSpacing: '0.1em', fontSize: '0.7rem' }

// Connexion avec l'e-mail et le mot de passe du site du club. Sam Link ne gère pas les mots de passe :
// un oubli se règle sur le site du club.
export default function Login({ onConnecte, message }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token } = await api.login(email, password)
      setToken(token)
      onConnecte(token)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img src="/logo.png" alt="Logo officiel SAM Paris 12" style={{ width: 64, height: 58, objectFit: 'contain', margin: '0 auto 1rem', display: 'block' }} />
          <h1 style={{ fontSize: '2.2rem', textTransform: 'uppercase', fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>Sam Link</h1>
          <p className="eyebrow" style={{ marginTop: '0.4rem' }}>SAM Paris 12 · Messagerie des adhérents</p>
        </div>

        <div className="login-card">
          {message && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--ink-soft)', marginBottom: '1rem' }}>{message}</p>
          )}
          {error && (
            <p role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--vermilion)', marginBottom: '1rem' }}>{error}</p>
          )}

          <form onSubmit={handleLogin} style={{ display: 'grid', gap: '1.2rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
            <div>
              <label htmlFor="login-email" style={libelle}>E-mail</label>
              <input
                id="login-email"
                type="email"
                className="login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="prenom.nom@exemple.fr"
                required
              />
            </div>

            <div>
              <label style={libelle}>Mot de passe</label>
              <PasswordField className="login-input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>

            <div style={{ paddingTop: '0.5rem' }}>
              <button type="submit" disabled={loading} className="btn btn--solid" style={{ width: '100%', justifyContent: 'center', padding: '0.85rem', fontSize: '0.75rem' }}>
                {loading ? 'Connexion…' : 'Se connecter'}
              </button>
            </div>

            <p style={{ margin: 0, textAlign: 'center', color: 'var(--stone)', fontSize: '0.7rem' }}>
              Mêmes identifiants que sur le site du club. Mot de passe oublié : il se change sur le site du club.
            </p>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--stone)' }}>
          Besoin d'aide pour vous connecter ?
          <div style={{ marginTop: '0.3rem' }}><a href="mailto:contact@samparis12.org" style={{ color: 'var(--vermilion)', textDecoration: 'underline' }}>contact@samparis12.org</a></div>
          <div style={{ marginTop: '0.6rem' }}>Sam Link v{APP_VERSION}</div>
        </div>
      </div>
    </div>
  )
}
