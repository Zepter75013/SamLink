// Délai (en minutes) avant l'e-mail d'un message non lu, réglé par le club (NOTIF_DELAI_EMAIL_MIN) ; 0 = e-mail immédiat.

// « Immédiatement », « 15 minutes », « 1 heure », « 2 heures »
export function libelleDelai(min) {
  if (!min) return 'Immédiatement'
  if (min < 60) return `${min} minutes`
  const h = min / 60
  return Number.isInteger(h) ? `${h} heure${h > 1 ? 's' : ''}` : `${min} minutes`
}

// « dans l'heure », « dans les 15 minutes », « dans les 2 heures »
export function phraseDelai(min) {
  if (min === 60) return "dans l'heure"
  if (min > 60 && min % 60 === 0) return `dans les ${min / 60} heures`
  return `dans les ${min} minutes`
}
