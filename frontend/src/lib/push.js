// Notifications push du navigateur (standard Web Push) : détection, autorisation, abonnement de l'appareil.

const estIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const estInstalle = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

// État du push sur cet appareil :
//   'indisponible' (navigateur trop ancien), 'ios-a-installer' (iPhone : ajouter d'abord le site à l'écran d'accueil),
//   'refuse' (notifications bloquées dans le navigateur), 'possible' (pas encore activé), 'actif'.
export async function etatPush() {
  const supporte = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supporte) return estIOS() && !estInstalle() ? 'ios-a-installer' : 'indisponible'
  if (Notification.permission === 'denied') return 'refuse'
  const reg = await navigator.serviceWorker.getRegistration('/')
  const abo = reg ? await reg.pushManager.getSubscription() : null
  return abo ? 'actif' : 'possible'
}

function cleVersOctets(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const brut = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(brut, (c) => c.charCodeAt(0))
}

// Nom lisible de l'appareil, pour s'y retrouver s'il y en a plusieurs.
function nomAppareil() {
  const ua = navigator.userAgent
  const sys = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Appareil'
  const nav = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return nav ? `${sys} · ${nav}` : sys
}

// Service worker du site : celui déjà installé au chargement (production), sinon on l'installe. On attend au plus
// 10 secondes qu'il soit actif, au lieu de navigator.serviceWorker.ready qui peut attendre indéfiniment.
async function serviceWorkerActif() {
  let reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js')
  if (reg.active) return reg
  const sw = reg.installing || reg.waiting
  await new Promise((ok, ko) => {
    const delai = setTimeout(() => ko(new Error("Le site n'a pas pu s'installer sur cet appareil : recharge la page puis réessaie.")), 10000)
    sw?.addEventListener('statechange', () => { if (sw.state === 'activated') { clearTimeout(delai); ok() } })
    if (!sw) { clearTimeout(delai); ok() }
  })
  return reg
}

// Demande l'autorisation, abonne l'appareil et renvoie l'abonnement (format JSON du navigateur) à déclarer à l'API.
// etape(texte) : progression affichée à l'adhérent (l'abonnement auprès du service push peut prendre quelques secondes).
export async function activerPush(clePublique, etape = () => {}) {
  if (Notification.permission !== 'granted') {
    etape("Autorise les notifications dans la fenêtre du navigateur…")
    const choix = await Notification.requestPermission()
    if (choix !== 'granted') throw new Error(choix === 'denied' ? 'Les notifications sont bloquées pour ce site dans le navigateur.' : "Autorisation non accordée.")
  }
  etape('Préparation de l’appareil…')
  const reg = await serviceWorkerActif()
  let abo = await reg.pushManager.getSubscription()
  if (!abo) {
    etape('Abonnement auprès du service de notifications (quelques secondes)…')
    abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleVersOctets(clePublique) })
  }
  return { ...abo.toJSON(), appareil: nomAppareil() }
}

// Désabonne l'appareil ; renvoie l'adresse d'abonnement à oublier côté API (ou null s'il n'y en avait pas).
export async function desactiverPush() {
  const reg = await navigator.serviceWorker.getRegistration('/')
  const abo = reg ? await reg.pushManager.getSubscription() : null
  if (!abo) return null
  const endpoint = abo.endpoint
  await abo.unsubscribe()
  return endpoint
}
