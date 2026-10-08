const TOKEN_KEY = 'samlink_token'
const ACTIVITE_KEY = 'samlink_derniere_activite'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    // Nouvelle connexion : le compteur d'inactivité repart de zéro (voir lib/inactivite.js).
    localStorage.setItem(ACTIVITE_KEY, String(Date.now()))
  } catch {
    // stockage indisponible (navigation privée, etc.) — la session ne persiste pas au reload
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ACTIVITE_KEY)
  } catch {
    // rien à faire
  }
}
