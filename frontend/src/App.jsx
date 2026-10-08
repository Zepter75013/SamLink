import { useCallback, useState } from 'react'
import Login from './pages/Login.jsx'
import SamLink from './pages/SamLink.jsx'
import { clearToken, getToken } from './lib/session.js'

export default function App() {
  const [token, setToken] = useState(getToken)
  const [message, setMessage] = useState('')

  const deconnexion = useCallback((msg) => {
    clearToken()
    setMessage(msg || '')
    setToken(null)
  }, [])

  if (!token) return <Login message={message} onConnecte={(t) => { setMessage(''); setToken(t) }} />
  return <SamLink token={token} onDeconnexion={deconnexion} />
}
