// Après une mise en ligne, une page restée ouverte sur l'ancienne version peut demander un morceau de code (chargé à la
// demande) qui n'existe plus sur le serveur : l'import échoue (404). On recharge alors la page, une seule fois en
// 30 secondes pour ne jamais boucler, ce qui charge la nouvelle version.
const CLE = 'samlink_rechargement_version'

export function rechargerNouvelleVersion() {
  try {
    const dernier = Number(sessionStorage.getItem(CLE)) || 0
    if (Date.now() - dernier < 30000) return false
    sessionStorage.setItem(CLE, String(Date.now()))
  } catch { /* stockage indisponible : on recharge quand même une fois */ }
  window.location.reload()
  return true
}

// À utiliser avec React.lazy : lazy(() => importModule(() => import('./Composant.jsx')))
export function importModule(charger) {
  return charger().catch((err) => {
    if (rechargerNouvelleVersion()) return new Promise(() => {}) // la page se recharge : on n'affiche pas d'erreur
    throw err
  })
}
