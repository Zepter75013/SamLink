import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import BoutonFermer from '../components/BoutonFermer.jsx'
import { LecteurVocal } from './ChatVocal.jsx'
import { chatFileUrl } from '../lib/api.js'

// Éléments « riches » de la messagerie : fenêtre, menu d'ajout (fichier, photos et vidéos, sondage, événement),
// pièces jointes, visionneuse, cartes de sondage et d'événement.

// Fenêtre de la messagerie. Elle est rangée dans le bloc de la messagerie (pour garder ses couleurs) mais en dehors du bandeau ou
// de la liste d'où elle est ouverte : un parent qui a un filtre (« backdrop-filter » du bandeau d'une discussion sur téléphone)
// devient sinon le repère de la fenêtre « fixe », qui se retrouve coupée en haut de l'écran.
export function Modal({ titre, onClose, children }) {
  const fenetre = (
    <div className="chat-modal" onClick={onClose}>
      <div className="chat-modal__box" role="dialog" aria-modal="true" aria-label={titre} onClick={(e) => e.stopPropagation()}>
        <div className="chat-modal__head">
          <b>{titre}</b>
          <BoutonFermer onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  )
  return createPortal(fenetre, document.querySelector('.chat') || document.body)
}

export function taille(n) {
  if (n < 1024) return `${n} o`
  if (n < 1048576) return `${Math.round(n / 1024)} Ko`
  return `${(n / 1048576).toFixed(1).replace('.', ',')} Mo`
}

const ICONES_FICHIER = { pdf: '📕', doc: '📘', docx: '📘', odt: '📘', xls: '📗', xlsx: '📗', ods: '📗', csv: '📗', ppt: '📙', pptx: '📙', odp: '📙', zip: '🗜️', gpx: '🗺️', tcx: '🗺️', kml: '🗺️' }
export const iconeFichier = (nom) => ICONES_FICHIER[(nom.split('.').pop() || '').toLowerCase()] || '📄'

// ---- Menu d'ajout, comme WhatsApp ----
const ICO = {
  fichier: (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.2l2 2.2H19.5A2.5 2.5 0 0 1 22 8.7V17.5A2.5 2.5 0 0 1 19.5 20h-15A2.5 2.5 0 0 1 2 17.5Z" fill="#4a9de0" /><path d="M2 9.5h20v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5Z" fill="#2f7fc4" /></svg>
  ),
  photos: (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" fill="#3b82f6" /><circle cx="9" cy="9" r="2" fill="#fff" /><path d="M4 18l5-5 3.5 3.5L16 13l4 5Z" fill="#fff" /></svg>
  ),
  sondage: (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="3" y="5" width="13" height="3.2" rx="1.6" fill="#f5bf3c" /><rect x="3" y="10.4" width="18" height="3.2" rx="1.6" fill="#f5bf3c" /><rect x="3" y="15.8" width="9" height="3.2" rx="1.6" fill="#f5bf3c" /></svg>
  ),
  evenement: (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16.5" rx="3" fill="#e0485f" /><rect x="3" y="4.5" width="18" height="4.5" rx="2" fill="#c42f46" /><g fill="#fff"><circle cx="8" cy="13" r="1.1" /><circle cx="12" cy="13" r="1.1" /><circle cx="16" cy="13" r="1.1" /><circle cx="8" cy="17" r="1.1" /><circle cx="12" cy="17" r="1.1" /></g></svg>
  ),
}

export function AttachMenu({ onPick, onClose, chiffre = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('.chat-attach-btn')) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key) }
  }, [onClose])
  const items = [
    ['fichier', 'Fichier'],
    ['photos', 'Photos et vidéos'],
    ...(chiffre ? [] : [['sondage', 'Sondage'], ['evenement', 'Événement']]), // le serveur verrait un sondage ou un événement
  ]
  return (
    <div className="chat-attach" ref={ref} role="menu" aria-label="Ajouter à la discussion">
      {items.map(([k, label]) => (
        <button type="button" key={k} role="menuitem" onClick={() => onPick(k)}>
          <span className="chat-attach__ico">{ICO[k]}</span>
          <span className="chat-attach__lbl">{label}</span>
        </button>
      ))}
    </div>
  )
}

// ---- Pièces jointes d'un message ----
// Fichier d'une discussion chiffrée : déchiffré dans le navigateur (a.lire) puis affiché depuis une adresse locale temporaire.
// auto : déchiffré dès l'affichage (photos) ; sinon seulement à la demande (vidéos et documents, qui peuvent être gros).
export function useFichierClair(a, auto = true) {
  const [src, setSrc] = useState(a.chiffre ? '' : chatFileUrl(a.url))
  const [etat, setEtat] = useState(a.chiffre ? (auto ? 'charge' : 'attente') : 'ok') // attente | charge | ok | ko
  const url = useRef('')
  const charger = useCallback(async () => {
    if (!a.chiffre || !a.lire) return null
    setEtat('charge')
    try {
      const blob = await a.lire()
      if (!url.current) url.current = URL.createObjectURL(blob)
      setSrc(url.current)
      setEtat('ok')
      return { blob, url: url.current }
    } catch {
      setEtat('ko')
      return null
    }
  }, [a])
  useEffect(() => {
    // une autre pièce jointe (visionneuse : photo suivante) : on repart de zéro
    setSrc(a.chiffre ? '' : chatFileUrl(a.url))
    setEtat(a.chiffre ? (auto ? 'charge' : 'attente') : 'ok')
    if (a.chiffre && auto) charger()
    return () => { if (url.current) { URL.revokeObjectURL(url.current); url.current = '' } }
  }, [a.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return { src, etat, charger }
}

// Une photo : si elle ne se charge pas (lien expiré, réseau), on le dit et on redemande les liens à jour.
function Photo({ a, onBroken }) {
  const [ko, setKo] = useState(false)
  const clair = useFichierClair(a, true)
  if (a.chiffre) {
    if (clair.etat === 'ko') return <span className="chat-photo-ko">🔒 Photo illisible</span>
    if (!clair.src) return <span className="chat-photo-ko">🔒 Déchiffrement…</span>
    return <img src={clair.src} alt={a.nom} decoding="async" />
  }
  if (ko) return <span className="chat-photo-ko" onClick={(e) => { e.stopPropagation(); setKo(false) }}>🖼️ Photo indisponible<small>Touche pour réessayer</small></span>
  return <img src={chatFileUrl(a.url)} alt={a.nom} decoding="async" onError={() => { setKo(true); onBroken?.() }} />
}

// Vidéo d'une discussion chiffrée : déchiffrée seulement quand on la lance
function VideoChiffree({ a }) {
  const clair = useFichierClair(a, false)
  if (clair.src) return <video className="chat-video" controls playsInline autoPlay src={clair.src} />
  return (
    <button type="button" className="chat-file chat-file--chiffre" onClick={clair.charger} disabled={clair.etat === 'charge'}>
      <span className="chat-file__ico">🎥</span>
      <span className="chat-file__txt"><b>{a.nom}</b><small>{clair.etat === 'charge' ? 'Déchiffrement…' : clair.etat === 'ko' ? 'Vidéo illisible : réessayer' : `🔒 ${taille(a.taille)} · Lire`}</small></span>
    </button>
  )
}

// Document d'une discussion chiffrée : déchiffré puis enregistré à la demande
function FichierChiffre({ a }) {
  const clair = useFichierClair(a, false)
  async function enregistrer() {
    if (a.bloque) return
    const r = await clair.charger()
    if (!r) return
    const lien = document.createElement('a')
    lien.href = r.url
    lien.download = a.nom
    document.body.appendChild(lien)
    lien.click()
    lien.remove()
  }
  return (
    <button type="button" className="chat-file chat-file--chiffre" onClick={enregistrer} disabled={clair.etat === 'charge' || a.bloque}>
      <span className="chat-file__ico">{a.bloque ? '🚫' : iconeFichier(a.nom)}</span>
      <span className="chat-file__txt"><b>{a.nom}</b><small>{a.bloque ? 'Type de fichier non pris en charge' : clair.etat === 'charge' ? 'Déchiffrement…' : clair.etat === 'ko' ? 'Fichier illisible : réessayer' : `🔒 ${taille(a.taille)} · Télécharger`}</small></span>
    </button>
  )
}

export function Attachments({ items, onOpenImage, onBroken }) {
  const images = items.filter((a) => a.kind === 'image')
  const videos = items.filter((a) => a.kind === 'video')
  const vocaux = items.filter((a) => a.kind === 'file' && a.mime?.startsWith('audio/') && !a.bloque)
  const fichiers = items.filter((a) => a.kind === 'file' && !vocaux.includes(a))
  const montres = images.slice(0, 4)
  return (
    <div className="chat-media">
      {images.length > 0 && (
        <div className={`chat-grid chat-grid--${Math.min(montres.length, 4)}`}>
          {montres.map((a, i) => (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              className="chat-grid__cell"
              aria-label={`Ouvrir ${a.nom}`}
              onClick={() => onOpenImage(images, i)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenImage(images, i) } }}
            >
              <Photo key={a.url} a={a} onBroken={onBroken} />
              {i === 3 && images.length > 4 && <span className="chat-grid__more">+{images.length - 4}</span>}
            </div>
          ))}
        </div>
      )}
      {videos.map((a) => (a.chiffre
        ? <VideoChiffree key={a.id} a={a} />
        : <video key={a.id} className="chat-video" controls playsInline preload="metadata" src={chatFileUrl(a.url)} onError={onBroken} />
      ))}
      {vocaux.map((a) => <LecteurVocal key={a.id} a={a} onBroken={onBroken} />)}
      {fichiers.filter((a) => a.chiffre).map((a) => <FichierChiffre key={a.id} a={a} />)}
      {fichiers.filter((a) => !a.chiffre).map((a) => (
        <a key={a.id} className="chat-file" href={chatFileUrl(a.url)} target="_blank" rel="noreferrer" download={a.nom}>
          <span className="chat-file__ico">{iconeFichier(a.nom)}</span>
          <span className="chat-file__txt"><b>{a.nom}</b><small>{taille(a.taille)} · Télécharger</small></span>
        </a>
      ))}
    </div>
  )
}

// ---- Visionneuse de photos ----
export function Lightbox({ images, index, onClose }) {
  const [i, setI] = useState(index)
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((n) => (n + 1) % images.length)
      if (e.key === 'ArrowLeft') setI((n) => (n - 1 + images.length) % images.length)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [images.length, onClose])
  const a = images[i]
  const clair = useFichierClair(a, true)
  return (
    <div className="chat-lightbox" role="dialog" aria-modal="true" aria-label={a.nom} onClick={onClose}>
      <div className="chat-lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <span>{a.nom}{images.length > 1 ? ` · ${i + 1}/${images.length}` : ''}</span>
        <a href={a.chiffre ? clair.src : chatFileUrl(a.url)} download={a.nom} aria-label="Télécharger">⬇</a>
        <BoutonFermer onClick={onClose} />
      </div>
      {(a.chiffre ? clair.src : chatFileUrl(a.url))
        ? <img key={a.id} src={a.chiffre ? clair.src : chatFileUrl(a.url)} alt={a.nom} onClick={(e) => e.stopPropagation()} />
        : <span className="chat-photo-ko">{clair.etat === 'ko' ? '🔒 Photo illisible' : '🔒 Déchiffrement…'}</span>}
      {images.length > 1 && (
        <>
          <button type="button" className="chat-lightbox__nav is-prev" onClick={(e) => { e.stopPropagation(); setI((n) => (n - 1 + images.length) % images.length) }} aria-label="Précédente">‹</button>
          <button type="button" className="chat-lightbox__nav is-next" onClick={(e) => { e.stopPropagation(); setI((n) => (n + 1) % images.length) }} aria-label="Suivante">›</button>
        </>
      )}
    </div>
  )
}

// ---- Sondage ----
export function PollCard({ message, onVote }) {
  const poll = message.poll
  const mine = poll.mine || []
  const toggle = (id) => {
    let next
    if (poll.multiple) next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id]
    else next = mine[0] === id ? [] : [id]
    onVote(message, next)
  }
  return (
    <div className="chat-poll">
      <b className="chat-poll__q">📊 {poll.question}</b>
      <small>{poll.multiple ? 'Plusieurs réponses possibles' : 'Une seule réponse'}</small>
      {poll.options.map((o) => {
        const pct = poll.votants ? Math.round((o.votes / poll.votants) * 100) : 0
        const on = mine.includes(o.id)
        return (
          <button type="button" key={o.id} className={`chat-poll__opt${on ? ' is-on' : ''}`} onClick={() => toggle(o.id)} aria-pressed={on}>
            <span className="chat-poll__mark">{poll.multiple ? (on ? '☑' : '☐') : (on ? '●' : '○')}</span>
            <span className="chat-poll__txt">{o.texte}</span>
            <span className="chat-poll__n">{o.votes}</span>
            <span className="chat-poll__bar" style={{ width: `${pct}%` }} />
          </button>
        )
      })}
      <small className="chat-poll__total">{poll.votants} vote{poll.votants > 1 ? 's' : ''}</small>
    </div>
  )
}

// ---- Événement ----
const MOIS = ['JAN', 'FÉV', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC']
const quand = (debut) => {
  const d = new Date(debut)
  return `${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}`
}

function telechargerIcs(e) {
  const d = new Date(e.debut)
  const fmt = (x) => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}T${String(x.getHours()).padStart(2, '0')}${String(x.getMinutes()).padStart(2, '0')}00`
  const fin = new Date(d.getTime() + 60 * 60 * 1000)
  const esc = (t) => (t || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n')
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SAM Paris 12//Messagerie//FR', 'BEGIN:VEVENT',
    `UID:${fmt(d)}-${Math.abs(e.titre.length)}@samparis12`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(d)}`, `DTEND:${fmt(fin)}`,
    `SUMMARY:${esc(e.titre)}`, `LOCATION:${esc(e.lieu)}`, `DESCRIPTION:${esc(e.description)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'evenement.ics'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function EventCard({ message, onRsvp }) {
  const e = message.event
  const d = new Date(e.debut)
  const bouton = (rep, label) => (
    <button type="button" className={`chat-event__rsvp${e.mine === rep ? ' is-on' : ''}`} onClick={() => onRsvp(message, e.mine === rep ? '' : rep)} aria-pressed={e.mine === rep}>
      {label}
    </button>
  )
  return (
    <div className="chat-event">
      <div className="chat-event__head">
        <span className="chat-event__cal"><i>{MOIS[d.getMonth()]}</i><b>{d.getDate()}</b></span>
        <span className="chat-event__txt">
          <b>{e.titre}</b>
          <small>{quand(e.debut)}</small>
          {e.lieu && <small>📍 {e.lieu}</small>}
        </span>
      </div>
      {e.description && <p className="chat-event__desc">{e.description}</p>}
      <div className="chat-event__rsvps">
        {bouton('oui', `Je viens (${e.oui})`)}
        {bouton('peut-etre', `Peut-être (${e.peutEtre})`)}
        {bouton('non', `Non (${e.non})`)}
      </div>
      {e.venus.length > 0 && <small className="chat-event__venus">Viennent : {e.venus.join(', ')}{e.oui > e.venus.length ? '…' : ''}</small>}
      <button type="button" className="chat-event__ics" onClick={() => telechargerIcs(e)}>📅 Ajouter à mon agenda</button>
    </div>
  )
}

// ---- Fenêtres de création ----
export function PollModal({ onClose, onSend }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiple, setMultiple] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const remplies = options.filter((o) => o.trim()).length
  async function envoyer() {
    setBusy(true)
    setErr('')
    try { await onSend({ question, options: options.map((o) => o.trim()).filter(Boolean), multiple }); onClose() } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <Modal titre="Nouveau sondage" onClose={onClose}>
      <div className="chat-form">
        {err && <p className="chat-error">{err}</p>}
        <label>Question<input className="chat-field" value={question} maxLength={255} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex. Sortie longue dimanche ?" autoFocus /></label>
        <span className="chat-form__lbl">Options</span>
        {options.map((o, i) => (
          <div key={i} className="chat-form__row">
            <input className="chat-field" value={o} maxLength={100} onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} />
            {options.length > 2 && <button type="button" className="chat-form__x" onClick={() => setOptions((l) => l.filter((_, j) => j !== i))} aria-label="Retirer l'option">✕</button>}
          </div>
        ))}
        {options.length < 12 && <button type="button" className="chat-form__add" onClick={() => setOptions((l) => [...l, ''])}>＋ Ajouter une option</button>}
        <label className="chat-form__check"><input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} /> Autoriser plusieurs réponses</label>
        <button type="button" className="btn btn--solid chat-create" disabled={busy || !question.trim() || remplies < 2} onClick={envoyer}>Envoyer le sondage</button>
      </div>
    </Modal>
  )
}

export function EventModal({ onClose, onSend }) {
  const [titre, setTitre] = useState('')
  const [date, setDate] = useState('')
  const [heure, setHeure] = useState('09:30')
  const [lieu, setLieu] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function envoyer() {
    setBusy(true)
    setErr('')
    try { await onSend({ titre, debut: `${date}T${heure}`, lieu, description }); onClose() } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <Modal titre="Nouvel événement" onClose={onClose}>
      <div className="chat-form">
        {err && <p className="chat-error">{err}</p>}
        <label>Titre<input className="chat-field" value={titre} maxLength={150} onChange={(e) => setTitre(e.target.value)} placeholder="Ex. Footing du dimanche" autoFocus /></label>
        <div className="chat-form__row">
          <label>Date<input className="chat-field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Heure<input className="chat-field" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} /></label>
        </div>
        <label>Lieu (facultatif)<input className="chat-field" value={lieu} maxLength={200} onChange={(e) => setLieu(e.target.value)} placeholder="Ex. Stade Léo Lagrange" /></label>
        <label>Description (facultatif)<textarea className="chat-field" rows={3} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} /></label>
        <button type="button" className="btn btn--solid chat-create" disabled={busy || !titre.trim() || !date || !heure} onClick={envoyer}>Envoyer l'événement</button>
      </div>
    </Modal>
  )
}
