import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api.js'

// Appels audio et vidéo dans les messages privés (WebRTC). Le son et l'image passent directement d'un navigateur à l'autre,
// chiffrés de bout en bout (DTLS-SRTP) ; l'API ne transmet que la signalisation et fournit les serveurs STUN/TURN.

const APPAREIL = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
const SONNERIE_MS = 45000
const nouvelId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

const AppelsCtx = createContext({ appeler: () => {}, occupe: false, disponible: false })
export const useAppels = () => useContext(AppelsCtx)

export const appelsDisponibles = () => typeof window !== 'undefined' && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia

function dureeTexte(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}
const chrono = (ms) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Sonnerie (appel entrant) et tonalité de retour (appel sortant), synthétisées : aucun fichier son à charger.
function creerSonnerie(entrant) {
  let ctx = null
  let stop = false
  let minuterie = null
  try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { ctx = null }
  const bip = () => {
    if (stop) return
    if (entrant && navigator.vibrate) navigator.vibrate([400, 200, 400])
    if (!ctx) return
    ctx.resume?.().catch(() => {})
    const t0 = ctx.currentTime
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0, t0)
    const notes = entrant ? [[880, 0, 0.35], [660, 0.4, 0.35], [880, 1.0, 0.35], [660, 1.4, 0.35]] : [[440, 0, 1.5]]
    for (const [f, debut, duree] of notes) {
      const o = ctx.createOscillator()
      o.frequency.value = f
      o.connect(gain)
      o.start(t0 + debut)
      o.stop(t0 + debut + duree)
      gain.gain.setValueAtTime(entrant ? 0.18 : 0.07, t0 + debut)
      gain.gain.setValueAtTime(0, t0 + debut + duree)
    }
  }
  bip()
  minuterie = setInterval(bip, entrant ? 3000 : 4000)
  return () => {
    stop = true
    clearInterval(minuterie)
    if (navigator.vibrate) navigator.vibrate(0)
    ctx?.close?.().catch(() => {})
  }
}

export function AppelsProvider({ chat, token, me, children }) {
  const [vue, setVue] = useState(null) // { phase: sortant | entrant | connexion | en-cours | fin, nom, photoUrl, video, debut, message }
  const [local, setLocal] = useState(null)
  const [distant, setDistant] = useState(null)
  const [micCoupe, setMicCoupe] = useState(false)
  const [cameraCoupee, setCameraCoupee] = useState(false)
  const appel = useRef(null) // appel en cours : { callId, roomId, role, peer, pc, flux, video, iceAttente, offre, connecte, debut, ... }
  const termines = useRef(new Set())
  const chatRef = useRef(chat)
  chatRef.current = chat

  const signal = useCallback((roomId, s) => api.chatSignal(token, roomId, { ...s, from: APPAREIL }).catch(() => {}), [token])

  const terminer = useCallback((message, { prevenir = false } = {}) => {
    const a = appel.current
    if (!a) return
    appel.current = null
    termines.current.add(a.callId)
    clearTimeout(a.minuterie)
    clearTimeout(a.coupure)
    a.sonnerie?.()
    if (prevenir) signal(a.roomId, { type: 'hangup', callId: a.callId, to: a.peer || '' })
    a.flux?.getTracks().forEach((t) => t.stop())
    try { a.pc?.close() } catch { /* déjà fermée */ }
    setLocal(null)
    setDistant(null)
    setMicCoupe(false)
    setCameraCoupee(false)
    // trace dans la discussion, écrite par l'appelant seulement (chiffrée si la discussion l'est)
    if (a.role === 'appelant' && a.offreEnvoyee) {
      const quoi = a.video ? '🎥 Appel vidéo' : '📞 Appel vocal'
      const texte = a.debut ? `${quoi} · ${dureeTexte(Date.now() - a.debut)}` : `${quoi} manqué`
      chatRef.current.send(a.roomId, texte, null, { silencieux: true }).catch(() => {})
    }
    if (message) {
      setVue((v) => (v ? { ...v, phase: 'fin', message } : null))
      setTimeout(() => setVue((v) => (v?.phase === 'fin' ? null : v)), 2200)
    } else setVue(null)
  }, [signal])

  const creerPC = useCallback(async () => {
    let iceServers = []
    try { iceServers = (await api.chatIce(token)).iceServers || [] } catch { /* STUN par défaut du navigateur */ }
    const pc = new RTCPeerConnection({ iceServers })
    pc.onicecandidate = (e) => {
      const a = appel.current
      if (e.candidate && a && a.pc === pc) signal(a.roomId, { type: 'ice', callId: a.callId, candidate: e.candidate.toJSON(), to: a.peer || '' })
    }
    pc.ontrack = (e) => setDistant(e.streams[0] || new MediaStream([e.track]))
    pc.onconnectionstatechange = () => {
      const a = appel.current
      if (!a || a.pc !== pc) return
      if (pc.connectionState === 'connected') {
        clearTimeout(a.coupure)
        if (!a.debut) a.debut = Date.now()
        setVue((v) => (v ? { ...v, phase: 'en-cours', debut: a.debut } : v))
      } else if (pc.connectionState === 'failed') {
        terminer('Connexion impossible : le réseau bloque l\'appel.', { prevenir: true })
      } else if (pc.connectionState === 'disconnected') {
        clearTimeout(a.coupure)
        a.coupure = setTimeout(() => { if (appel.current === a && pc.connectionState !== 'connected') terminer('Appel coupé (réseau).', { prevenir: true }) }, 10000)
      }
    }
    return pc
  }, [token, signal, terminer])

  const media = (video) => navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  })

  const viderIce = async (a) => {
    const liste = a.iceAttente.splice(0)
    for (const c of liste) { try { await a.pc.addIceCandidate(c) } catch { /* candidat périmé */ } }
  }

  const appeler = useCallback(async (room, video) => {
    if (appel.current || room.kind !== 'dm') return
    const a = { callId: nouvelId(), roomId: room.id, role: 'appelant', peer: '', video, nom: room.nom, iceAttente: [] }
    appel.current = a
    setVue({ phase: 'sortant', nom: room.nom, photoUrl: room.photoUrl, video })
    try {
      a.flux = await media(video)
      if (appel.current !== a) { a.flux.getTracks().forEach((t) => t.stop()); return }
      setLocal(a.flux)
      a.pc = await creerPC()
      a.flux.getTracks().forEach((t) => a.pc.addTrack(t, a.flux))
      if (!video) a.pc.addTransceiver('video', { direction: 'recvonly' }) // l'autre peut répondre en vidéo
      const offre = await a.pc.createOffer()
      await a.pc.setLocalDescription(offre)
      if (appel.current !== a) return
      await api.chatSignal(token, room.id, { type: 'offer', callId: a.callId, video, sdp: offre.sdp, from: APPAREIL })
      a.offreEnvoyee = true
      a.sonnerie = creerSonnerie(false)
      a.minuterie = setTimeout(() => { if (appel.current === a && !a.peer) terminer('Pas de réponse.', { prevenir: true }) }, SONNERIE_MS)
    } catch (e) {
      const refuse = e?.name === 'NotAllowedError' || e?.name === 'NotFoundError'
      if (appel.current === a) terminer(refuse ? `Accès ${video ? 'à la caméra ou ' : ''}au micro refusé : autorise-le dans les réglages du navigateur.` : (e?.message || 'Appel impossible.'))
    }
  }, [token, creerPC, terminer])

  const accepter = useCallback(async (video) => {
    const a = appel.current
    if (!a || a.role !== 'appele' || a.pc) return
    a.sonnerie?.()
    clearTimeout(a.minuterie)
    setVue((v) => (v ? { ...v, phase: 'connexion' } : v))
    try {
      a.flux = await media(video)
      if (appel.current !== a) { a.flux.getTracks().forEach((t) => t.stop()); return }
      setLocal(a.flux)
      a.pc = await creerPC()
      await a.pc.setRemoteDescription({ type: 'offer', sdp: a.offre })
      a.flux.getTracks().forEach((t) => a.pc.addTrack(t, a.flux))
      const reponse = await a.pc.createAnswer()
      await a.pc.setLocalDescription(reponse)
      await signal(a.roomId, { type: 'answer', callId: a.callId, sdp: reponse.sdp, to: a.peer })
      await viderIce(a)
    } catch (e) {
      signal(a.roomId, { type: 'reject', callId: a.callId, to: a.peer })
      terminer(e?.name === 'NotAllowedError' ? 'Accès au micro refusé : autorise-le dans les réglages du navigateur.' : 'Appel impossible.')
    }
  }, [creerPC, signal, terminer])

  const refuser = useCallback(() => {
    const a = appel.current
    if (!a) return
    signal(a.roomId, { type: 'reject', callId: a.callId, to: a.peer })
    terminer(null)
  }, [signal, terminer])

  // Signalisation reçue (flux temps réel)
  const recevoir = useCallback(async (d) => {
    if (d.from === APPAREIL || (d.to && d.to !== APPAREIL)) return
    const a = appel.current
    // mes autres appareils : un appel décroché ou refusé ailleurs arrête la sonnerie ici
    if (d.memberId === me.id) {
      if (a && a.callId === d.callId && a.role === 'appele' && !a.pc && ['answer', 'reject'].includes(d.type)) terminer(null)
      return
    }
    if (d.type === 'offer') {
      if (termines.current.has(d.callId) || (a && a.callId === d.callId)) return
      if (a) { signal(d.roomId, { type: 'busy', callId: d.callId, to: d.from }); return }
      const n = { callId: d.callId, roomId: d.roomId, role: 'appele', peer: d.from, video: !!d.video, offre: d.sdp, iceAttente: [] }
      appel.current = n
      setVue({ phase: 'entrant', nom: d.nom, photoUrl: d.photoUrl, video: !!d.video })
      n.sonnerie = creerSonnerie(true)
      n.minuterie = setTimeout(() => { if (appel.current === n && !n.pc) terminer(null) }, SONNERIE_MS)
      return
    }
    if (!a || a.callId !== d.callId) return
    if (d.type === 'answer' && a.role === 'appelant' && !a.peer) {
      a.peer = d.from
      a.sonnerie?.()
      clearTimeout(a.minuterie)
      setVue((v) => (v ? { ...v, phase: 'connexion' } : v))
      try {
        await a.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp })
        await viderIce(a)
      } catch { terminer('Appel impossible.', { prevenir: true }) }
    } else if (d.type === 'ice') {
      if (a.peer && d.from !== a.peer) return
      if (a.pc?.remoteDescription) { try { await a.pc.addIceCandidate(d.candidate) } catch { /* ignoré */ } } else a.iceAttente.push(d.candidate)
    } else if (d.type === 'hangup') {
      terminer(a.debut ? 'Appel terminé.' : null)
    } else if (d.type === 'reject' && a.role === 'appelant') {
      terminer('Appel refusé.')
    } else if (d.type === 'busy' && a.role === 'appelant') {
      terminer(`${a.nom || 'Ton correspondant'} est déjà en ligne.`)
    }
  }, [me.id, signal, terminer])

  useEffect(() => {
    chat.appelsRef.current = recevoir
    return () => { if (chat.appelsRef.current === recevoir) chat.appelsRef.current = null }
  }, [chat.appelsRef, recevoir])

  // fermeture de l'onglet pendant un appel : on prévient l'autre
  useEffect(() => {
    const quitter = () => { if (appel.current) terminer(null, { prevenir: true }) }
    window.addEventListener('pagehide', quitter)
    return () => window.removeEventListener('pagehide', quitter)
  }, [terminer])

  function basculerMic() {
    const t = appel.current?.flux?.getAudioTracks() || []
    t.forEach((x) => { x.enabled = !x.enabled })
    setMicCoupe(t.length > 0 && !t[0].enabled)
  }
  function basculerCamera() {
    const t = appel.current?.flux?.getVideoTracks() || []
    t.forEach((x) => { x.enabled = !x.enabled })
    setCameraCoupee(t.length > 0 && !t[0].enabled)
  }
  async function retournerCamera() {
    const a = appel.current
    const ancienne = a?.flux?.getVideoTracks()[0]
    if (!a || !ancienne) return
    const face = (ancienne.getSettings().facingMode || 'user') === 'user' ? 'environment' : 'user'
    try {
      const f = await navigator.mediaDevices.getUserMedia({ video: { facingMode: face } })
      const nouvelle = f.getVideoTracks()[0]
      await a.pc.getSenders().find((s) => s.track?.kind === 'video')?.replaceTrack(nouvelle)
      a.flux.removeTrack(ancienne)
      ancienne.stop()
      a.flux.addTrack(nouvelle)
      setLocal(new MediaStream(a.flux.getTracks()))
    } catch { /* une seule caméra */ }
  }

  const valeur = useMemo(() => ({ appeler, occupe: !!vue, disponible: appelsDisponibles() }), [appeler, vue])
  return (
    <AppelsCtx.Provider value={valeur}>
      {children}
      {vue && (
        <EcranAppel vue={vue} local={local} distant={distant} micCoupe={micCoupe} cameraCoupee={cameraCoupee}
          onAccepter={accepter} onRefuser={refuser} onRaccrocher={() => terminer(appel.current?.debut ? 'Appel terminé.' : null, { prevenir: true })}
          onMic={basculerMic} onCamera={basculerCamera} onRetourner={retournerCamera} />
      )}
    </AppelsCtx.Provider>
  )
}

function Video({ flux, muet, className }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current && ref.current.srcObject !== flux) ref.current.srcObject = flux || null }, [flux])
  return <video ref={ref} className={className} autoPlay playsInline muted={muet} />
}

function EcranAppel({ vue, local, distant, micCoupe, cameraCoupee, onAccepter, onRefuser, onRaccrocher, onMic, onCamera, onRetourner }) {
  const [, setTic] = useState(0)
  useEffect(() => {
    if (vue.phase !== 'en-cours') return undefined
    const t = setInterval(() => setTic((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [vue.phase])
  const videoDistante = !!distant?.getVideoTracks().some((t) => t.readyState === 'live')
  const videoLocale = !!local?.getVideoTracks().length
  const etat = {
    sortant: vue.video ? 'Appel vidéo… ça sonne' : 'Appel vocal… ça sonne',
    entrant: vue.video ? 'Appel vidéo entrant' : 'Appel vocal entrant',
    connexion: 'Connexion…',
    'en-cours': vue.debut ? chrono(Date.now() - vue.debut) : '',
    fin: vue.message,
  }[vue.phase]
  const ecran = (
    <div className={`appel${videoDistante ? ' has-video' : ''}`} role="dialog" aria-modal="true" aria-label={`Appel avec ${vue.nom}`}>
      <Video flux={distant} className="appel__distant" />
      {!videoDistante && (
        <div className="appel__qui">
          {vue.photoUrl ? <img src={vue.photoUrl} alt="" /> : <span>{(vue.nom || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>}
        </div>
      )}
      <div className="appel__entete">
        <b>{vue.nom}</b>
        <span>{etat}</span>
        {vue.phase !== 'entrant' && vue.phase !== 'fin' && <small>🔒 Chiffré de bout en bout</small>}
      </div>
      {videoLocale && vue.phase !== 'fin' && <Video flux={local} muet className={`appel__local${cameraCoupee ? ' is-off' : ''}`} />}
      <div className="appel__boutons">
        {vue.phase === 'entrant' && (
          <>
            <button type="button" className="appel__btn is-rouge" onClick={onRefuser} aria-label="Refuser l'appel"><i>📞</i><small>Refuser</small></button>
            <button type="button" className="appel__btn is-vert" onClick={() => onAccepter(false)} aria-label="Répondre"><i>📞</i><small>Répondre</small></button>
            {vue.video && <button type="button" className="appel__btn is-vert" onClick={() => onAccepter(true)} aria-label="Répondre en vidéo"><i>🎥</i><small>En vidéo</small></button>}
          </>
        )}
        {['sortant', 'connexion', 'en-cours'].includes(vue.phase) && (
          <>
            <button type="button" className={`appel__btn${micCoupe ? ' is-on' : ''}`} onClick={onMic} aria-label={micCoupe ? 'Réactiver le micro' : 'Couper le micro'}><i>{micCoupe ? '🔇' : '🎙️'}</i><small>{micCoupe ? 'Micro coupé' : 'Micro'}</small></button>
            {videoLocale && <button type="button" className={`appel__btn${cameraCoupee ? ' is-on' : ''}`} onClick={onCamera} aria-label={cameraCoupee ? 'Rallumer la caméra' : 'Couper la caméra'}><i>{cameraCoupee ? '🚫' : '📷'}</i><small>Caméra</small></button>}
            {videoLocale && <button type="button" className="appel__btn" onClick={onRetourner} aria-label="Changer de caméra"><i>🔄</i><small>Retourner</small></button>}
            <button type="button" className="appel__btn is-rouge" onClick={onRaccrocher} aria-label="Raccrocher"><i>📞</i><small>Raccrocher</small></button>
          </>
        )}
      </div>
    </div>
  )
  return createPortal(ecran, document.querySelector('.chat') || document.body)
}
