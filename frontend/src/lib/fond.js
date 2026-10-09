// Fond d'écran des conversations, comme dans WhatsApp. Mémorisé sur l'appareil (comme le thème).
const CLE = 'samlink_fond'
const CLE_PHOTO = 'samlink_fond_photo'
const CLE_VOILE = 'samlink_fond_voile'

export const FONDS = [
  ['defaut', 'Par défaut'],
  ['ciel', 'Ciel'],
  ['menthe', 'Menthe'],
  ['lavande', 'Lavande'],
  ['peche', 'Pêche'],
  ['rose', 'Rose'],
  ['sable', 'Sable'],
  ['ardoise', 'Ardoise'],
  ['sam', 'Rouge Sam'],
  ['points', 'Pois'],
  ['aurore', 'Aurore'],
  ['piste', 'Piste'],
]

function lire(cle, defaut) {
  try { return localStorage.getItem(cle) ?? defaut } catch { return defaut }
}

export function getFond() {
  const f = lire(CLE, 'defaut')
  return f === 'photo' && !lire(CLE_PHOTO, '') ? 'defaut' : f
}
export const getPhotoFond = () => lire(CLE_PHOTO, '')
export const getVoile = () => Number(lire(CLE_VOILE, '25')) || 0

export function appliquerFond() {
  const html = document.documentElement
  const fond = getFond()
  html.setAttribute('data-fond', fond)
  const photo = fond === 'photo' ? getPhotoFond() : ''
  if (photo) html.style.setProperty('--sl-photo', `url("${photo}")`)
  else html.style.removeProperty('--sl-photo')
  html.style.setProperty('--sl-voile', `${getVoile()}%`)
}

export function setFond(fond) {
  try { localStorage.setItem(CLE, fond) } catch { /* stockage indisponible : appliqué pour la session */ }
  appliquerFond()
}

export function setVoile(v) {
  try { localStorage.setItem(CLE_VOILE, String(v)) } catch { /* idem */ }
  appliquerFond()
}

// Réduit la photo (1600 px max, JPEG) pour qu'elle tienne dans le stockage du navigateur
export async function setPhotoFond(fichier) {
  if (!fichier.type.startsWith('image/')) throw new Error('Choisis une image (JPEG, PNG…).')
  const img = await createImageBitmap(fichier)
  const k = Math.min(1, 1600 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  let url = c.toDataURL('image/jpeg', 0.82)
  if (url.length > 1_500_000) url = c.toDataURL('image/jpeg', 0.6)
  try {
    localStorage.setItem(CLE_PHOTO, url)
    localStorage.setItem(CLE, 'photo')
  } catch {
    throw new Error("Cette photo est trop lourde pour être mémorisée sur cet appareil. Essaie une image plus petite.")
  }
  appliquerFond()
}

export function supprimerPhotoFond() {
  try { localStorage.removeItem(CLE_PHOTO) } catch { /* rien */ }
  if (lire(CLE, '') === 'photo') setFond('defaut')
  else appliquerFond()
}
