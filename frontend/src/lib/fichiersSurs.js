// Types de fichiers acceptés dans la messagerie, et description d'un fichier envoyé dans une discussion chiffrée.
// Le serveur ne voit pas un fichier chiffré : c'est le navigateur de l'expéditeur qui vérifie son type, et celui du destinataire
// qui revérifie la description avant d'afficher ou d'enregistrer quoi que ce soit (un expéditeur malveillant ne peut pas
// faire passer un exécutable pour une photo).

export const IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
export const VIDEOS = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }
// Messages vocaux enregistrés dans le navigateur (WebM/Opus, MP4/AAC, Ogg) ; MP3 accepté aussi
export const AUDIOS = { '.weba': 'audio/webm', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' }
export const DOCS = {
  '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet', '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.txt': 'text/plain', '.csv': 'text/csv', '.rtf': 'application/rtf', '.zip': 'application/zip',
  '.gpx': 'application/gpx+xml', '.tcx': 'application/xml', '.kml': 'application/vnd.google-earth.kml+xml',
}

// Nom de fichier sans chemin, sans caractères de contrôle ni guillemets, 150 caractères au plus
export function nomSur(nom) {
  let n = String(nom || '').replace(/\\/g, '/').split('/').pop().replace(/[\u0000-\u001f\u007f"]/g, '').trim()
  if (n.length > 150) { const ext = n.includes('.') ? n.slice(n.lastIndexOf('.')) : ''; n = n.slice(0, 150 - ext.length) + ext }
  return n && n !== '.' ? n : 'fichier'
}

const extDe = (nom) => (nom.includes('.') ? nom.slice(nom.lastIndexOf('.')).toLowerCase() : '')

// Description {n: nom, m: type, s: taille, k: image | video | file} d'un fichier à envoyer ; null si son type n'est pas accepté
export function decrire(file) {
  const n = nomSur(file.name)
  const ext = extDe(n)
  if (IMAGES.includes(file.type)) return { n, m: file.type, s: file.size, k: 'image' }
  if (VIDEOS[ext]) return { n, m: VIDEOS[ext], s: file.size, k: 'video' }
  if (AUDIOS[ext]) return { n, m: AUDIOS[ext], s: file.size, k: 'file' }
  if (DOCS[ext]) return { n, m: DOCS[ext], s: file.size, k: 'file' }
  return null
}

// Description reçue : revérifiée (type et extension cohérents) ; null si elle n'est pas conforme
export function verifierDescription(d) {
  if (!d || typeof d !== 'object') return null
  const n = nomSur(d.n)
  const ext = extDe(n)
  const s = Number.isFinite(d.s) && d.s >= 0 ? d.s : 0
  if (d.k === 'image' && IMAGES.includes(d.m)) return { n, m: d.m, s, k: 'image' }
  if (d.k === 'video' && VIDEOS[ext] && d.m === VIDEOS[ext]) return { n, m: d.m, s, k: 'video' }
  if (d.k === 'file' && AUDIOS[ext] && d.m === AUDIOS[ext]) return { n, m: d.m, s, k: 'file' }
  if (d.k === 'file' && DOCS[ext] && d.m === DOCS[ext]) return { n, m: d.m, s, k: 'file' }
  return null
}

// Texte d'une citation à partir de la description déchiffrée d'un message à pièces jointes (null si ce n'en est pas une)
export function citationDescription(texte) {
  if (typeof texte !== 'string' || !texte.startsWith('{"v":')) return null
  try {
    const o = JSON.parse(texte)
    if (!Array.isArray(o.f)) return null
    return `📎 ${o.t || (o.f[0] && nomSur(o.f[0].n)) || 'Pièce jointe'}`
  } catch { return null }
}
