const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api'

async function request(path, { token, headers, ...options } = {}) {
  // Pour un FormData (upload de fichier), laisser le navigateur poser son
  // propre Content-Type (multipart/form-data + boundary) plutôt que forcer JSON.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const finalHeaders = { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...headers }
  if (token) finalHeaders.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: finalHeaders })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.error || `Erreur ${res.status}`)
    err.data = body
    err.status = res.status
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

export const chatStreamUrl = () => `${BASE_URL}/chat/stream`

// Lien d'une pièce jointe de la messagerie (l'API renvoie un chemin signé commençant par /api/).
export const chatFileUrl = (u) => (u && u.startsWith('/') ? `${BASE_URL.replace(/\/api$/, '')}${u}` : u)

export const api = {
  // Connexion avec l'e-mail et le mot de passe du site du club.
  login: (identifiant, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ identifiant, password }) }),
  getMe: (token) => request('/me', { token }),
  listMembres: (token) => request('/membres', { token }),

  notifConfig: (token) => request('/notifications/config', { token }),
  notifPrefs: (token) => request('/notifications/prefs', { token }),
  notifSavePrefs: (token, prefs) => request('/notifications/prefs', { method: 'PUT', body: JSON.stringify(prefs), token }),
  notifAbonner: (token, abo) => request('/notifications/subscriptions', { method: 'POST', body: JSON.stringify(abo), token }),
  notifDesabonner: (token, endpoint) => request('/notifications/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }), token }),
  notifTest: (token) => request('/notifications/test', { method: 'POST', token }),


  chatMesCles: (token) => request('/chat/keys/me', { token }),
  chatEnregistrerCles: (token, publicKey, emballee) => request('/chat/keys/me', { method: 'PUT', body: JSON.stringify({ publicKey, emballee }), token }),
  chatReinitialiserCles: (token) => request('/chat/keys/me', { method: 'DELETE', token }),
  chatCleDe: (token, id) => request(`/chat/keys/${id}`, { token }),
  chatEnClair: (token, roomId) => request(`/chat/rooms/${roomId}/en-clair`, { token }),
  chatChiffrerHistorique: (token, roomId, messages) => request(`/chat/rooms/${roomId}/chiffrer-historique`, { method: 'POST', body: JSON.stringify({ messages }), token }),
  chatDemanderLiaison: (token, publicKey) => request('/chat/liaisons', { method: 'POST', body: JSON.stringify({ publicKey }), token }),
  chatLiaisons: (token) => request('/chat/liaisons', { token }),
  chatRepondreLiaison: (token, id, publicKey, blob) => request(`/chat/liaisons/${id}/reponse`, { method: 'POST', body: JSON.stringify({ publicKey, blob }), token }),
  chatReponseLiaison: (token, id) => request(`/chat/liaisons/${id}`, { token }),
  chatSupprimerLiaison: (token, id) => request(`/chat/liaisons/${id}`, { method: 'DELETE', token }),
  chatPresence: (token) => request('/chat/presence', { method: 'POST', token }),
  chatRooms: (token) => request('/chat/rooms', { token }),
  chatMessages: (token, roomId, before) => request(`/chat/rooms/${roomId}/messages${before ? `?before=${before}` : ''}`, { token }),
  chatSend: (token, roomId, texte, replyTo, { mentions = [], forwarded = false, live = 0 } = {}) =>
    request(`/chat/rooms/${roomId}/messages`, { method: 'POST', token, body: JSON.stringify({ texte, replyTo: replyTo || 0, mentions, forwarded, live }) }),
  chatLive: (token, messageId, position) => request(`/chat/messages/${messageId}/live`, { method: 'PUT', token, body: JSON.stringify({ position }) }),
  chatLiveStop: (token, messageId) => request(`/chat/messages/${messageId}/live`, { method: 'DELETE', token }),
  chatReact: (token, messageId, emoji) => request(`/chat/messages/${messageId}/reaction`, { method: 'PUT', token, body: JSON.stringify({ emoji }) }),
  chatForward: (token, messageId, roomIds) => request(`/chat/messages/${messageId}/forward`, { method: 'POST', token, body: JSON.stringify({ roomIds }) }),
  chatPin: (token, messageId, pinned) => request(`/chat/messages/${messageId}/pin`, { method: 'PUT', token, body: JSON.stringify({ pinned }) }),
  chatIce: (token) => request('/chat/ice', { token }),
  chatSignal: (token, roomId, signal) => request(`/chat/rooms/${roomId}/call`, { method: 'POST', token, body: JSON.stringify(signal) }),
  chatStar: (token, messageId, starred) => request(`/chat/messages/${messageId}/star`, { method: 'PUT', token, body: JSON.stringify({ starred }) }),
  chatStars: (token) => request('/chat/stars', { token }),
  chatInfo: (token, messageId) => request(`/chat/messages/${messageId}/info`, { token }),
  chatTyping: (token, roomId) => request(`/chat/rooms/${roomId}/typing`, { method: 'POST', token }),
  chatMute: (token, roomId, muted) => request(`/chat/rooms/${roomId}/mute`, { method: 'POST', token, body: JSON.stringify({ muted }) }),
  chatRead: (token, roomId, upTo) => request(`/chat/rooms/${roomId}/read`, { method: 'POST', token, body: JSON.stringify({ upTo }) }),
  chatEdit: (token, messageId, texte) => request(`/chat/messages/${messageId}`, { method: 'PUT', token, body: JSON.stringify({ texte }) }),
  chatArchive: (token, roomId, archived) =>
    request(`/chat/rooms/${roomId}/archive`, { method: 'POST', token, body: JSON.stringify({ archived }) }),
  chatDeleteRoom: (token, roomId) => request(`/chat/rooms/${roomId}`, { method: 'DELETE', token }),
  chatSendMedia: (token, roomId, files, texte, replyTo, chiffre = false) => {
    const form = new FormData()
    if (chiffre) form.append('chiffre', '1') // avant les fichiers : le serveur le lit en premier
    files.forEach((f) => form.append('files', f, f.name))
    if (texte) form.append('texte', texte)
    if (replyTo) form.append('replyTo', String(replyTo))
    return request(`/chat/rooms/${roomId}/attachments`, { method: 'POST', token, body: form })
  },
  chatRoomPhoto: (token, roomId, blob) => {
    const form = new FormData()
    form.append('photo', blob, 'photo.jpg')
    return request(`/chat/rooms/${roomId}/photo`, { method: 'PUT', token, body: form })
  },
  chatRoomPhotoDelete: (token, roomId) => request(`/chat/rooms/${roomId}/photo`, { method: 'DELETE', token }),
  chatSendPoll: (token, roomId, data) => request(`/chat/rooms/${roomId}/polls`, { method: 'POST', token, body: JSON.stringify(data) }),
  chatSendEvent: (token, roomId, data) => request(`/chat/rooms/${roomId}/events`, { method: 'POST', token, body: JSON.stringify(data) }),
  chatVote: (token, messageId, optionIds) =>
    request(`/chat/messages/${messageId}/vote`, { method: 'POST', token, body: JSON.stringify({ optionIds }) }),
  chatRsvp: (token, messageId, reponse) =>
    request(`/chat/messages/${messageId}/rsvp`, { method: 'POST', token, body: JSON.stringify({ reponse }) }),
  chatDelete: (token, messageId) => request(`/chat/messages/${messageId}`, { method: 'DELETE', token }),
  chatOpenDM: (token, memberId) => request('/chat/dm', { method: 'POST', token, body: JSON.stringify({ memberId }) }),
  chatCreateRoom: (token, nom, memberIds) => request('/chat/rooms', { method: 'POST', token, body: JSON.stringify({ nom, memberIds }) }),
  chatAddMembers: (token, roomId, memberIds) =>
    request(`/chat/rooms/${roomId}/members`, { method: 'POST', token, body: JSON.stringify({ memberIds }) }),
}
