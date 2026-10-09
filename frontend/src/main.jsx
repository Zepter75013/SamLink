import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './samlink.css'
import App from './App.jsx'
import { initTheme } from './lib/theme.js'
import { appliquerFond } from './lib/fond.js'
import { rechargerNouvelleVersion } from './lib/importModule.js'

initTheme()
appliquerFond()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Application installable (PWA) : service worker minimal (notifications push), enregistré en production seulement.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Morceau de code introuvable après une mise en ligne (page restée ouverte sur l'ancienne version) : on recharge.
window.addEventListener('vite:preloadError', (event) => {
  if (rechargerNouvelleVersion()) event.preventDefault()
})

// Au retour dans l'application (téléphone, PWA), on vérifie qu'une version plus récente n'est pas disponible
// et on recharge le cas échéant : plus de vieille version bloquée dans l'application installée.
if (import.meta.env.PROD) {
  const verifierMiseAJour = async () => {
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text()
      const neuve = html.match(/src="(\/assets\/index-[^"]+\.js)"/)
      const actuelle = document.querySelector('script[type="module"][src*="/assets/index-"]')
      if (neuve && actuelle && actuelle.getAttribute('src') !== neuve[1]) window.location.reload()
    } catch { /* hors ligne : on garde la version actuelle */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') verifierMiseAJour()
  })
}
