import { useEffect, useRef, useState } from 'react'
import { chatFileUrl } from '../lib/api.js'
import { useFichierClair } from './ChatRich.jsx'

// Messages vocaux : enregistrement dans le navigateur (micro) et lecteur dans les bulles.

export const DUREE_MAX = 300 // secondes (5 minutes, comme la taille maximale acceptée par le serveur)

// Format d'enregistrement pris en charge par ce navigateur, avec l'extension que le serveur reconnaît
function formatEnregistrement() {
  if (typeof MediaRecorder === 'undefined') return null
  const formats = [
    ['audio/webm;codecs=opus', 'audio/webm', '.weba'],
    ['audio/webm', 'audio/webm', '.weba'],
    ['audio/mp4', 'audio/mp4', '.m4a'],
    ['audio/ogg;codecs=opus', 'audio/ogg', '.ogg'],
  ]
  const f = formats.find(([t]) => MediaRecorder.isTypeSupported(t))
  return f ? { type: f[0], mime: f[1], ext: f[2] } : null
}

export const vocalDisponible = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!formatEnregistrement()

const mmss = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const t = Math.round(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

// Barre d'enregistrement : remplace la zone de saisie pendant qu'on parle.
export function Enregistreur({ onSend, onCancel, onError }) {
  const [duree, setDuree] = useState(0)
  const [pret, setPret] = useState(false)
  const rec = useRef(null)
  const morceaux = useRef([])
  const envoyer = useRef(false)
  const debut = useRef(0)

  useEffect(() => {
    let flux = null
    let fini = false
    let minuterie = null
    const format = formatEnregistrement()
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
      if (fini) { s.getTracks().forEach((t) => t.stop()); return }
      flux = s
      const r = new MediaRecorder(s, { mimeType: format.type, audioBitsPerSecond: 32000 })
      rec.current = r
      r.ondataavailable = (e) => { if (e.data.size) morceaux.current.push(e.data) }
      r.onstop = () => {
        s.getTracks().forEach((t) => t.stop())
        if (!envoyer.current || morceaux.current.length === 0) return
        const blob = new Blob(morceaux.current, { type: format.mime })
        const d = new Date()
        const nom = `Message vocal ${d.toLocaleDateString('fr-FR').replace(/\//g, '-')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}${format.ext}`
        onSend(new File([blob], nom, { type: format.mime }))
      }
      r.start(1000)
      debut.current = Date.now()
      setPret(true)
      minuterie = setInterval(() => {
        const s2 = (Date.now() - debut.current) / 1000
        setDuree(s2)
        if (s2 >= DUREE_MAX) { envoyer.current = true; r.state !== 'inactive' && r.stop(); clearInterval(minuterie) }
      }, 250)
    }).catch(() => {
      onError("Micro inaccessible : autorise l'accès au micro pour ce site (réglages du navigateur), puis réessaie.")
      onCancel()
    })
    return () => {
      fini = true
      clearInterval(minuterie)
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
      if (flux) flux.getTracks().forEach((t) => t.stop())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function arreter(garder) {
    envoyer.current = garder
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
    if (!garder) onCancel()
  }

  return (
    <div className="chat-composer chat-vocal-rec">
      <button type="button" className="chat-vocal-rec__del" onClick={() => arreter(false)} aria-label="Annuler le message vocal" title="Annuler">🗑</button>
      <span className="chat-vocal-rec__live"><i aria-hidden="true" />{pret ? mmss(duree) : 'Micro…'}</span>
      <span className="chat-vocal-rec__hint">{pret ? `Enregistrement en cours (5 min au plus)` : "Autorise l'accès au micro"}</span>
      <button type="button" className="chat-send" onClick={() => arreter(true)} disabled={!pret || duree < 0.8} aria-label="Envoyer le message vocal">➤</button>
    </div>
  )
}

const VITESSES = [1, 1.5, 2]

// Lecteur d'un message vocal (déchiffré dans le navigateur dans une discussion chiffrée).
export function LecteurVocal({ a, onBroken }) {
  const clair = useFichierClair(a, true)
  const audio = useRef(null)
  const [lecture, setLecture] = useState(false)
  const [pos, setPos] = useState(0)
  const [duree, setDuree] = useState(0)
  const [vitesse, setVitesse] = useState(1)
  const src = a.chiffre ? clair.src : chatFileUrl(a.url)

  function surMetadonnees() {
    const el = audio.current
    if (!el) return
    if (el.duration === Infinity) {
      // WebM enregistré par Chrome : durée inconnue tant que le fichier n'a pas été parcouru jusqu'au bout
      el.currentTime = 1e101
      el.ontimeupdate = () => { el.ontimeupdate = null; setDuree(el.duration); el.currentTime = 0 }
    } else setDuree(el.duration)
  }
  function basculer() {
    const el = audio.current
    if (!el) return
    if (el.paused) el.play().catch(() => {})
    else el.pause()
  }
  function changerVitesse() {
    const v = VITESSES[(VITESSES.indexOf(vitesse) + 1) % VITESSES.length]
    setVitesse(v)
    if (audio.current) audio.current.playbackRate = v
  }

  if (a.chiffre && !src) {
    return <div className="chat-vocal"><span className="chat-vocal__play">🔒</span><small>{clair.etat === 'ko' ? 'Message vocal illisible' : 'Déchiffrement…'}</small></div>
  }
  return (
    <div className="chat-vocal">
      <audio ref={audio} src={src} preload="metadata" onLoadedMetadata={surMetadonnees} onError={a.chiffre ? undefined : onBroken}
        onPlay={() => setLecture(true)} onPause={() => setLecture(false)} onEnded={() => { setLecture(false); setPos(0) }}
        onTimeUpdate={(e) => { if (Number.isFinite(e.currentTarget.duration)) setPos(e.currentTarget.currentTime) }} />
      <button type="button" className="chat-vocal__play" onClick={basculer} aria-label={lecture ? 'Pause' : 'Écouter le message vocal'}>{lecture ? '❚❚' : '▶'}</button>
      <input type="range" className="chat-vocal__barre" min={0} max={duree || 1} step={0.1} value={Math.min(pos, duree || 1)}
        aria-label="Position dans le message vocal"
        onChange={(e) => { const t = Number(e.target.value); setPos(t); if (audio.current) audio.current.currentTime = t }}
        style={{ '--p': `${duree ? (pos / duree) * 100 : 0}%` }} />
      <small className="chat-vocal__temps">{mmss(lecture || pos ? pos : duree)}</small>
      <button type="button" className="chat-vocal__vitesse" onClick={changerVitesse} aria-label="Vitesse de lecture">{vitesse}×</button>
      <span className="chat-vocal__micro" aria-hidden="true">🎤</span>
    </div>
  )
}
