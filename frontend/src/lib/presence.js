// Présence dans l'espace adhérent : cercle de couleur autour de la photo et texte « Vu hier à 14:09 ».
// Ancienneté de la dernière présence : moins de 5 minutes → vert (en ligne), de 5 à 10 minutes → orange (a été connecté),
// plus de 10 minutes ou jamais vu → rouge (non connecté).

export const SEUIL_VERT_S = 5 * 60
export const SEUIL_ORANGE_S = 10 * 60

export function niveauPresence(ageSec) {
  if (ageSec == null) return 'rouge'
  if (ageSec < SEUIL_VERT_S) return 'vert'
  if (ageSec < SEUIL_ORANGE_S) return 'orange'
  return 'rouge'
}

const hhmm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const deux = (n) => String(n).padStart(2, '0')

// Date et heure de la dernière connexion : « Aujourd'hui à 14:09 » si c'est dans la journée, sinon « 06/10/2026 à 18:20 »
export function derniereConnexion(ageSec, maintenant = Date.now()) {
  if (ageSec == null) return 'Jamais connecté'
  const d = new Date(maintenant - ageSec * 1000)
  const now = new Date(maintenant)
  if (d.toDateString() === now.toDateString()) return `Aujourd'hui à ${hhmm(d)}`
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} à ${hhmm(d)}`
}

// Depuis combien de temps l'adhérent est déconnecté : « 7 min », « 3 h », « 2 j », « 3 mois » ; « En ligne » s'il est connecté
export function dureeDeconnexion(ageSec) {
  if (ageSec == null) return '—'
  if (niveauPresence(ageSec) === 'vert') return 'En ligne'
  const min = Math.floor(ageSec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const j = Math.floor(h / 24)
  if (j < 60) return `${j} j`
  const mois = Math.floor(j / 30)
  if (mois < 24) return `${mois} mois`
  return `${Math.floor(j / 365)} ans`
}
