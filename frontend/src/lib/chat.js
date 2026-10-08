import { useCallback, useEffect, useRef, useState } from 'react'
import { api, chatStreamUrl } from './api.js'
import { estChiffre } from './e2ee.js'
import { useE2EE } from './useE2EE.js'
import { decrire, verifierDescription, citationDescription } from './fichiersSurs.js'

// Aperçu d'un message dans la liste des discussions.
export function apercu(m) {
  if (estChiffre(m.texte)) return '🔒 Message chiffré'
  if (m.kind === 'poll') return `📊 ${m.poll?.question || 'Sondage'}`
  if (m.kind === 'event') return `📅 ${m.event?.titre || 'Événement'}`
  if (m.kind === 'media') {
    const first = m.attachments?.[0]
    const icon = first?.kind === 'image' ? '📷' : first?.kind === 'video' ? '🎥' : '📄'
    return `${icon} ${m.texte || (first?.kind === 'image' ? 'Photo' : first?.kind === 'video' ? 'Vidéo' : 'Document')}`
  }
  return m.texte
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function parseFrame(frame) {
  let event = 'message'
  const data = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }
  if (data.length === 0) return null
  try { return { event, data: JSON.parse(data.join('\n')) } } catch { return null }
}

// Messagerie : salons, conversations ouvertes et flux temps réel (événements serveur lus avec fetch,
// pour pouvoir envoyer le jeton dans l'en-tête Authorization plutôt que dans l'URL).
export function useChat(token, meId) {
  const [rooms, setRooms] = useState([])
  const [canCreate, setCanCreate] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [convs, setConvs] = useState({}) // roomId -> { messages, participants, otherRead, more, loading }
  const [openId, setOpenIdState] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [online, setOnline] = useState(true)
  const e2ee = useE2EE(token, meId)
  const e2eeRef = useRef(e2ee)
  e2eeRef.current = e2ee
  const [presence, setPresence] = useState({ at: 0, ages: {} }) // ancienneté (secondes) de la dernière présence de chaque adhérent, au moment `at`

  const openRef = useRef(null)
  const panelRef = useRef(false)
  const roomsRef = useRef([])
  const convsRef = useRef({})
  const tempSeq = useRef(0)
  roomsRef.current = rooms
  convsRef.current = convs
  openRef.current = openId
  panelRef.current = panelOpen

  // Messages privés chiffrés : déchiffrés ici, dans le navigateur, avant d'entrer dans l'état de l'écran.
  // Un message qu'on ne peut pas lire (appareil verrouillé, clé réinitialisée) devient un texte de remplacement.
  const clair = useCallback(async (roomId, m) => {
    if (!estChiffre(m.texte) && !(m.reply && estChiffre(m.reply.texte))) return m
    const room = roomsRef.current.find((r) => r.id === roomId)
    if (!room || room.kind !== 'dm') return m
    const lire = async (t) => { try { return await e2eeRef.current.dechiffrerPour(room, t) } catch { return null } }
    const out = { ...m }
    if (estChiffre(m.texte)) {
      const t = await lire(m.texte)
      out.chiffre = true
      if (m.kind === 'media') {
        // description chiffrée d'un message à pièces jointes : { v, t: légende, f: [{ n, m, s, k }] }
        let desc = null
        try { desc = t == null ? null : JSON.parse(t) } catch { desc = null }
        if (!desc || !Array.isArray(desc.f)) {
          out.texte = '🔒 Pièces jointes chiffrées, illisibles sur cet appareil'
          out.illisible = true
          out.attachments = []
        } else {
          out.texte = desc.t || ''
          out.attachments = (m.attachments || []).map((a, i) => {
            const d = verifierDescription(desc.f[i])
            if (!d) return { ...a, kind: 'file', nom: 'Fichier non pris en charge', taille: 0, chiffre: true, bloque: true }
            return { ...a, nom: d.n, mime: d.m, taille: d.s, kind: d.k, chiffre: true, lire: () => e2eeRef.current.lireFichierPour(room, a, d.m) }
          })
        }
      } else {
        out.texte = t ?? '🔒 Message chiffré, illisible sur cet appareil'
        if (t == null) out.illisible = true
      }
    }
    if (m.reply && estChiffre(m.reply.texte)) {
      const t = await lire(m.reply.texte)
      const citation = t == null ? null : (citationDescription(t) ?? t)
      out.reply = { ...m.reply, texte: citation == null ? '🔒 Message chiffré' : (citation.length > 140 ? `${citation.slice(0, 140)}…` : citation) }
    }
    return out
  }, [])
  const clairs = useCallback((roomId, ms) => Promise.all(ms.map((m) => clair(roomId, m))), [clair])
  const clairRef = useRef(clair)
  clairRef.current = clair

  const refreshRooms = useCallback(async () => {
    if (!token) return
    const data = await api.chatRooms(token)
    // le dernier message d'une discussion chiffrée n'est jamais affiché tel quel (ni son chiffré)
    setRooms(data.rooms.map((r) => (r.last && estChiffre(r.last.texte) ? { ...r, last: { ...r.last, texte: '🔒 Message chiffré' } } : r)))
    setCanCreate(data.canCreate)
    setLoaded(true)
  }, [token])

  const patchConv = useCallback((roomId, fn) => {
    setConvs((c) => ({ ...c, [roomId]: fn(c[roomId] || { messages: [], participants: [], otherRead: 0, more: false, loading: false, loaded: false }) }))
  }, [])

  const markRead = useCallback((roomId) => {
    const conv = convsRef.current[roomId]
    if (!conv || !token) return
    const last = [...conv.messages].reverse().find((m) => m.id > 0)
    if (!last) return
    setRooms((rs) => rs.map((r) => (r.id === roomId && r.unread > 0 ? { ...r, unread: 0 } : r)))
    api.chatRead(token, roomId, last.id).catch(() => {})
  }, [token])

  // « Tout marquer comme lu » : toutes les discussions sont marquées lues jusqu'à leur dernier message, même sans les avoir ouvertes
  const markAllRead = useCallback(() => {
    if (!token) return
    const aLire = roomsRef.current.filter((r) => r.unread > 0 && r.last?.id)
    if (aLire.length === 0) return
    setRooms((rs) => rs.map((r) => (r.unread > 0 ? { ...r, unread: 0 } : r)))
    aLire.forEach((r) => api.chatRead(token, r.id, r.last.id).catch(() => {}))
  }, [token])

  const loadConv = useCallback(async (roomId) => {
    patchConv(roomId, (c) => ({ ...c, loading: true }))
    try {
      const data = await api.chatMessages(token, roomId)
      const messages = await clairs(roomId, data.messages)
      patchConv(roomId, (c) => ({
        ...c, loading: false, loaded: true, messages, participants: data.participants || [], otherRead: data.otherRead || 0, more: data.more,
      }))
    } catch {
      patchConv(roomId, (c) => ({ ...c, loading: false }))
    }
  }, [token, patchConv, clairs])

  // Le chiffrement vient d'être activé ou déverrouillé (ou a fini de charger) : on relit les conversations pour déchiffrer
  const etatChiffrement = e2ee.etat
  useEffect(() => {
    if (etatChiffrement === 'chargement') return
    setConvs({})
    if (openRef.current != null) loadConv(openRef.current)
  }, [etatChiffrement, loadConv])

  // Historique : chiffre, depuis ce navigateur, mes anciens messages restés en clair dans les discussions privées chiffrées
  // (une discussion précise, ou toutes). Chaque adhérent chiffre les siens ; ceux de l'interlocuteur le sont de son côté.
  const traitees = useRef(new Set())
  const chiffrerHistorique = useCallback(async (roomId = null) => {
    let total = 0
    let discussions = 0
    const salons = roomsRef.current.filter((r) => r.kind === 'dm' && (roomId == null || r.id === roomId))
    for (const room of salons) {
      try {
        const { statut } = await e2eeRef.current.statutDM(room, true)
        if (statut !== 'chiffre') continue
        let n = 0
        for (let tour = 0; tour < 25; tour++) {
          const { messages } = await api.chatEnClair(token, room.id)
          if (!messages || messages.length === 0) break
          const lot = []
          for (const m of messages) lot.push({ id: m.id, texte: await e2eeRef.current.chiffrerPour(room, m.texte) })
          const r = await api.chatChiffrerHistorique(token, room.id, lot)
          n += r.chiffres
          if (r.chiffres === 0) break
        }
        if (n > 0) { total += n; discussions++ }
        traitees.current.add(room.id)
      } catch { /* cette discussion sera retentée plus tard */ }
    }
    if (total > 0) {
      setConvs({})
      if (openRef.current != null) loadConv(openRef.current)
    }
    return { total, discussions }
  }, [token, loadConv])
  // à l'ouverture d'une discussion devenue chiffrée : un seul passage par session
  const historiqueAuto = useCallback((roomId) => {
    if (traitees.current.has(roomId)) return
    traitees.current.add(roomId)
    chiffrerHistorique(roomId)
  }, [chiffrerHistorique])

  const loadMore = useCallback(async (roomId) => {
    const conv = convsRef.current[roomId]
    if (!conv || conv.loading || !conv.more || conv.messages.length === 0) return
    const first = conv.messages.find((m) => m.id > 0)
    if (!first) return
    patchConv(roomId, (c) => ({ ...c, loading: true }))
    try {
      const data = await api.chatMessages(token, roomId, first.id)
      const plus = await clairs(roomId, data.messages)
      patchConv(roomId, (c) => ({ ...c, loading: false, messages: [...plus, ...c.messages], more: data.more }))
    } catch {
      patchConv(roomId, (c) => ({ ...c, loading: false }))
    }
  }, [token, patchConv, clairs])

  const openRoom = useCallback((roomId) => {
    setOpenIdState(roomId)
    if (roomId != null) loadConv(roomId)
  }, [loadConv])

  // marque lu quand la conversation est ouverte, visible et à jour
  useEffect(() => {
    if (openId == null || !panelOpen) return
    const conv = convs[openId]
    if (!conv || conv.loading) return
    if (document.visibilityState === 'visible') markRead(openId)
  }, [openId, panelOpen, convs, markRead])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && openRef.current != null && panelRef.current) markRead(openRef.current)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [markRead])

  useEffect(() => {
    if (!token || !meId) return undefined
    let stop = false
    let ctrl = null

    const onEvent = async ({ event, data }) => {
      if (event === 'message') {
        const { roomId, message: brut } = data
        const message = await clairRef.current(roomId, brut)
        if (convsRef.current[roomId]) {
          patchConv(roomId, (c) => (c.messages.some((m) => m.id === message.id) ? c : { ...c, messages: [...c.messages, message] }))
        }
        const known = roomsRef.current.some((r) => r.id === roomId)
        if (!known) { refreshRooms().catch(() => {}); return }
        const seen = openRef.current === roomId && panelRef.current && document.visibilityState === 'visible'
        setRooms((rs) => rs.map((r) => (r.id === roomId
          ? { ...r, last: { id: brut.id, auteur: brut.auteur, texte: apercu(brut), createdAt: brut.createdAt }, unread: brut.senderId === meId || seen ? r.unread : r.unread + 1 }
          : r)))
      } else if (event === 'read') {
        if (data.memberId !== meId) patchConv(data.roomId, (c) => ({ ...c, otherRead: Math.max(c.otherRead || 0, data.upTo) }))
      } else if (event === 'poll') {
        // les compteurs viennent du serveur ; mes propres choix restent ceux que j'ai faits ici
        patchConv(data.roomId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === data.messageId && m.poll ? { ...m, poll: { ...data.poll, mine: m.poll.mine || [] } } : m)) }))
      } else if (event === 'event') {
        patchConv(data.roomId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === data.messageId && m.event ? { ...m, event: { ...data.event, mine: m.event.mine || '' } } : m)) }))
      } else if (event === 'edit') {
        const modifie = await clairRef.current(data.roomId, data.message)
        patchConv(data.roomId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === modifie.id ? modifie : m)) }))
        refreshRooms().catch(() => {})
      } else if (event === 'delete') {
        patchConv(data.roomId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === data.messageId ? { ...m, deleted: true, texte: '' } : m)) }))
        refreshRooms().catch(() => {})
      } else if (event === 'rooms') {
        refreshRooms().catch(() => {})
      }
    }

    async function run() {
      let delay = 1000
      while (!stop) {
        ctrl = new AbortController()
        try {
          const res = await fetch(chatStreamUrl(), { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal })
          if (res.status === 401) return
          if (!res.ok) throw new Error(String(res.status))
          delay = 1000
          setOnline(true)
          await refreshRooms().catch(() => {})
          if (openRef.current != null) await loadConv(openRef.current)
          const reader = res.body.getReader()
          const dec = new TextDecoder()
          let buf = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += dec.decode(value, { stream: true })
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const frame = parseFrame(buf.slice(0, i))
              buf = buf.slice(i + 2)
              if (frame) onEvent(frame)
            }
          }
        } catch {
          if (stop) return
        }
        setOnline(false)
        await sleep(delay)
        delay = Math.min(delay * 2, 15000)
      }
    }
    run()
    return () => { stop = true; if (ctrl) ctrl.abort() }
  }, [token, meId, refreshRooms, loadConv, patchConv])

  // Texte à envoyer : chiffré dans une discussion privée dont les deux adhérents ont activé le chiffrement (le serveur n'en voit que
  // le chiffré) ; en clair sinon. Refuse d'écrire quand la clé de l'interlocuteur a changé ou quand cet appareil est verrouillé.
  const statutEnvoi = useCallback(async (roomId) => {
    const room = roomsRef.current.find((r) => r.id === roomId)
    if (!room || room.kind !== 'dm') return { room, chiffre: false }
    const { statut } = await e2eeRef.current.statutDM(room)
    if (statut === 'cle-changee') throw new Error(`La clé de chiffrement de ${room.nom} a changé : vérifie-la (cadenas en haut de la discussion) avant d'écrire.`)
    if (statut === 'moi-verrouille') throw new Error('Cette discussion est chiffrée : déverrouille tes messages privés avec ta phrase secrète pour écrire.')
    return { room, chiffre: statut === 'chiffre' }
  }, [])
  const preparer = useCallback(async (roomId, texte) => {
    const { room, chiffre } = await statutEnvoi(roomId)
    return chiffre ? e2eeRef.current.chiffrerPour(room, texte) : texte
  }, [statutEnvoi])

  const send = useCallback(async (roomId, texte, reply) => {
    const tempId = -(++tempSeq.current)
    const temp = {
      id: tempId, roomId, senderId: meId, auteur: '', photoUrl: '', texte, deleted: false, pending: true,
      reply: reply ? { id: reply.id, auteur: reply.auteur, texte: apercu(reply) } : null, createdAt: new Date().toISOString(),
    }
    patchConv(roomId, (c) => ({ ...c, messages: [...c.messages, temp] }))
    try {
      const envoye = await preparer(roomId, texte)
      const brut = await api.chatSend(token, roomId, envoye, reply ? reply.id : 0)
      const msg = await clair(roomId, brut)
      patchConv(roomId, (c) => {
        const without = c.messages.filter((m) => m.id !== tempId)
        return { ...c, messages: without.some((m) => m.id === msg.id) ? without : [...without, msg] }
      })
      setRooms((rs) => rs.map((r) => (r.id === roomId ? { ...r, last: { id: brut.id, auteur: brut.auteur, texte: apercu(brut), createdAt: brut.createdAt } } : r)))
    } catch (err) {
      patchConv(roomId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)) }))
      throw err
    }
  }, [token, meId, patchConv, preparer, clair])

  const remove = useCallback(async (messageId) => {
    await api.chatDelete(token, messageId)
  }, [token])

  // Ajoute un message reçu en réponse d'un envoi (sans doublon avec le flux temps réel).
  const addSent = useCallback((roomId, msg) => {
    patchConv(roomId, (c) => (c.messages.some((m) => m.id === msg.id) ? c : { ...c, messages: [...c.messages, msg] }))
    setRooms((rs) => rs.map((r) => (r.id === roomId ? { ...r, last: { id: msg.id, auteur: msg.auteur, texte: apercu(msg), createdAt: msg.createdAt } } : r)))
  }, [patchConv])

  // Pièces jointes : dans une discussion chiffrée, chaque fichier est chiffré ici ; son nom, son type et la légende le sont aussi
  // (description chiffrée dans le corps du message) : le serveur ne voit que des blocs binaires anonymes.
  const sendMedia = useCallback(async (roomId, files, texte, reply) => {
    const { room, chiffre } = await statutEnvoi(roomId)
    if (!chiffre) {
      addSent(roomId, await api.chatSendMedia(token, roomId, files, texte, reply ? reply.id : 0))
      return
    }
    const e = e2eeRef.current
    const descriptions = []
    const blocs = []
    for (const f of files) {
      const d = decrire(f)
      if (!d) throw new Error(`« ${f.name} » : ce type de fichier n'est pas accepté (photos, vidéos, PDF, documents Office, texte, GPX)`)
      descriptions.push(d)
      blocs.push(await e.chiffrerFichierPour(room, f))
    }
    const description = await e.chiffrerPour(room, JSON.stringify({ v: 1, t: texte || '', f: descriptions }))
    const envoyes = blocs.map((b, i) => new File([b], `fichier-${i + 1}.bin`, { type: 'application/octet-stream' }))
    addSent(roomId, await clair(roomId, await api.chatSendMedia(token, roomId, envoyes, description, reply ? reply.id : 0, true)))
  }, [token, addSent, statutEnvoi, clair])
  const sendPoll = useCallback(async (roomId, data) => {
    addSent(roomId, await api.chatSendPoll(token, roomId, data))
  }, [token, addSent])
  const sendEvent = useCallback(async (roomId, data) => {
    addSent(roomId, await api.chatSendEvent(token, roomId, data))
  }, [token, addSent])

  const vote = useCallback(async (roomId, messageId, optionIds) => {
    const msg = await api.chatVote(token, messageId, optionIds)
    patchConv(roomId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, poll: msg.poll } : m)) }))
  }, [token, patchConv])
  const rsvp = useCallback(async (roomId, messageId, reponse) => {
    const msg = await api.chatRsvp(token, messageId, reponse)
    patchConv(roomId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, event: msg.event } : m)) }))
  }, [token, patchConv])

  // Modifier un message : possible tant qu'aucun autre adhérent ne l'a lu (le serveur refuse sinon).
  const edit = useCallback(async (roomId, messageId, texte) => {
    const msg = await clair(roomId, await api.chatEdit(token, messageId, await preparer(roomId, texte)))
    patchConv(roomId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msg.id ? msg : m)) }))
    refreshRooms().catch(() => {})
  }, [token, patchConv, refreshRooms, preparer, clair])

  // Archiver / désarchiver : propre à chaque adhérent.
  const archive = useCallback(async (roomId, archived) => {
    await api.chatArchive(token, roomId, archived)
    setRooms((rs) => rs.map((r) => (r.id === roomId ? { ...r, archived } : r)))
  }, [token])

  // Supprimer : la discussion disparaît de l'écran (elle reste en base, réactivable uniquement par l'administrateur de la base).
  const removeRoom = useCallback(async (roomId) => {
    await api.chatDeleteRoom(token, roomId)
    setRooms((rs) => rs.filter((r) => r.id !== roomId))
    setConvs((c) => { const next = { ...c }; delete next[roomId]; return next })
    if (openRef.current === roomId) setOpenIdState(null)
  }, [token])

  // les discussions archivées ne comptent pas dans la pastille de l'onglet
  const unreadTotal = rooms.reduce((n, r) => n + (r.archived ? 0 : r.unread || 0), 0)

  // Présence : un battement toutes les 30 secondes tant que la page est visible (il renvoie aussi la présence de tous les adhérents)
  useEffect(() => {
    if (!token) return undefined
    let stop = false
    const battre = () => {
      if (document.visibilityState !== 'visible') return
      api.chatPresence(token).then((d) => { if (!stop) setPresence({ at: Date.now(), ages: d.presence || {} }) }).catch(() => {})
    }
    battre()
    const t = setInterval(battre, 30000)
    document.addEventListener('visibilitychange', battre)
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', battre) }
  }, [token])
  // âge actuel (secondes) de la dernière présence de cet adhérent, null s'il n'a jamais été vu
  const presenceDe = useCallback((id) => {
    const a = presence.ages[String(id)]
    return a == null ? null : a + (Date.now() - presence.at) / 1000
  }, [presence])

  return { e2ee, chiffrerHistorique, historiqueAuto, presenceDe, rooms, canCreate, loaded, convs, openId, openRoom, loadMore, send, remove, edit, archive, removeRoom, sendMedia, sendPoll, sendEvent, vote, rsvp, refreshRooms, unreadTotal, markAllRead, setPanelOpen, online }
}
