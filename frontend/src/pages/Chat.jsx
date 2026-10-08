import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { RunnerFigure } from '../components/Legs.jsx'
import { apercu } from '../lib/chat.js'
import { niveauPresence, derniereConnexion, dureeDeconnexion } from '../lib/presence.js'
import { BoutonChiffrement, CadenasDiscussion, useStatutDM } from './ChatChiffrement.jsx'
import { BarreReactions, Reactions, TexteRiche, BarreRecherche, SuggestionsMention, Transfert, InfoMessage, ListeImportants, mentionEnCours, normaliser, texteCherchable } from './ChatSocial.jsx'
import { CarteDirect, CartePosition, ModalPosition, lirePosition } from './ChatPosition.jsx'
import { Enregistreur, vocalDisponible } from './ChatVocal.jsx'
import { AppelsProvider, useAppels } from './Appels.jsx'
import { Modal, AttachMenu, Attachments, Lightbox, PollCard, EventCard, PollModal, EventModal, taille, iconeFichier } from './ChatRich.jsx'

const EMOJIS = ['😀', '😂', '😅', '😍', '🥰', '😎', '🤩', '🙂', '😉', '🙏', '👍', '👏', '🙌', '💪', '🔥', '🎉', '❤️', '😢', '😮', '🤔',
  '🏃', '🏃‍♀️', '🚶', '🥇', '🏅', '🏆', '⏱️', '👟', '☀️', '🌧️', '💧', '🍌', '🍝', '🍻', '🚗', '📍', '✅', '❌', '⚠️', '👋']

function initiales(nom) {
  return (nom || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

// Présence : de(id) donne l'ancienneté (secondes) de la dernière présence d'un adhérent ; meId est l'adhérent connecté (toujours en ligne).
const PresenceCtx = createContext({ de: () => null, meId: 0 })

// État de présence d'un adhérent : niveau (vert, orange, rouge), durée de déconnexion (« 7 min ») et date de dernière connexion (« Aujourd'hui à 14:09 »)
function usePresence(id) {
  const { de, meId } = useContext(PresenceCtx)
  if (!id) return null
  const age = id === meId ? 0 : de(id)
  return { niveau: niveauPresence(age), duree: dureeDeconnexion(age), derniere: derniereConnexion(age) }
}

// Avatar ; `niveau` (vert, orange, rouge) ajoute la pastille de présence à cheval sur le coin bas droit de la photo
function Avatar({ photoUrl, nom, size = 40, groupe, niveau }) {
  const style = { width: size, height: size, fontSize: size * 0.38 }
  const photo = photoUrl
    ? <img className="chat-avatar" src={photoUrl} alt="" style={style} />
    : <span className={`chat-avatar chat-avatar--${groupe ? 'groupe' : 'init'}`} style={style}>{groupe ? '👥' : initiales(nom)}</span>
  if (!niveau) return photo
  const d = Math.max(11, Math.round(size * 0.3))
  return <span className="pres-avatar">{photo}<i className={`pres-pastille pres-pastille--${niveau}`} style={{ width: d, height: d }} aria-hidden="true" /></span>
}

// Texte de présence sous un nom (« En ligne », « Vu hier à 14:09 »)
function PresenceTexte({ id }) {
  const p = usePresence(id)
  return p ? <small className={`pres-texte pres-texte--${p.niveau}`}>{p.derniere}</small> : null
}

// Ligne de présence d'un message privé dans la liste des discussions
function PresenceLigne({ id }) {
  const p = usePresence(id)
  return <span className={`chat-room__last pres-texte pres-texte--${p?.niveau || 'rouge'}`}>{p ? p.derniere : ''}</span>
}

// Avatar d'un adhérent avec son cercle de présence
function AvatarPresence({ id, photoUrl, nom, size }) {
  const p = usePresence(id)
  return (
    <span className="pres-photo">
      <Avatar photoUrl={photoUrl} nom={nom} size={size} niveau={p?.niveau} />
      {p && <small className={`pres-duree pres-duree--${p.niveau}`} title={p.niveau === 'vert' ? 'En ligne' : `Déconnecté depuis ${p.duree}`}>{p.duree}</small>}
    </span>
  )
}

const sameDay = (a, b) => a.toDateString() === b.toDateString()
function jourLabel(d) {
  const now = new Date()
  const hier = new Date(now); hier.setDate(now.getDate() - 1)
  if (sameDay(d, now)) return "Aujourd'hui"
  if (sameDay(d, hier)) return 'Hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}
const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
function heureListe(iso) {
  const d = new Date(iso)
  const now = new Date()
  const hier = new Date(now); hier.setDate(now.getDate() - 1)
  if (sameDay(d, now)) return heure(iso)
  if (sameDay(d, hier)) return 'Hier'
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

// Photos volumineuses : réduites avant l'envoi (1920 px, JPEG) pour économiser les données mobiles.
async function reduire(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 1_500_000) return file
  try {
    const bmp = await createImageBitmap(file)
    const ratio = Math.min(1, 1920 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * ratio)
    canvas.height = Math.round(bmp.height * ratio)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// couleur stable par auteur dans les salons (comme WhatsApp)
const COULEURS = ['#c2410c', '#0f766e', '#7c3aed', '#be185d', '#1d4ed8', '#a16207', '#047857', '#b91c1c']
const couleurDe = (id) => COULEURS[Math.abs(id) % COULEURS.length]

function Coches({ message, room, otherRead }) {
  if (message.failed) return <span className="chat-tick chat-tick--err" title="Non envoyé">!</span>
  if (message.pending) return <span className="chat-tick">🕓</span>
  // ✓ envoyé · ✓✓ bleu : lu par au moins une autre personne (dans un message privé : par l'autre adhérent)
  const lu = message.id <= otherRead
  return <span className={`chat-tick${lu ? ' is-read' : ''}`} title={lu ? (room.kind === 'dm' ? 'Lu' : 'Lu par au moins une personne') : 'Envoyé'}>{lu ? '✓✓' : '✓'}</span>
}

function Bulle({ message, room, me, otherRead, onReply, onEdit, onDelete, onVote, onRsvp, onOpenImage, onBroken, showAuteur,
  reacting, onReacting, onReact, onForward, recherche, trouve, epingle, onPin, onQuote, onStar, onInfo, onStopLive }) {
  const live = !message.deleted && message.live ? message.live : null
  const position = !live && !message.deleted && (!message.kind || message.kind === 'text') ? lirePosition(message.texte) : null
  const mine = message.senderId === me.id
  const actif = !message.deleted && !message.pending && !message.failed
  const maReaction = message.reactions?.find((r) => r.ids.includes(me.id))?.emoji
  // transférables : textes lisibles, photos et documents non chiffrés
  const transferable = actif && !live && !message.illisible && ((!message.kind || message.kind === 'text') ? !!message.texte : message.kind === 'media' && !message.chiffre)
  // l'auteur peut modifier / supprimer tant que personne d'autre n'a lu ; le bureau peut toujours supprimer (modération)
  const modifiable = mine && actif && !live && message.id > otherRead && (!message.kind || message.kind === 'text') // seuls les textes se modifient
  const supprimable = mine && actif && message.id > otherRead
  const canDelete = actif && (supprimable || !!me.features?.includes('messagerie.moderer'))
  return (
    <div className={`chat-row${mine ? ' is-mine' : ''}${message.reactions?.length && !message.deleted ? ' has-reactions' : ''}`} data-msg={message.id}>
      <div className={`chat-bubble${mine ? ' is-mine' : ''}${message.deleted ? ' is-deleted' : ''}${(message.kind && message.kind !== 'text' && !message.deleted) || position || live ? ' is-rich' : ''}${trouve ? ' is-found' : ''}`} tabIndex={0}>
        {message.forwarded && !message.deleted && <span className="chat-forwarded">↪ Transféré</span>}
        {!mine && showAuteur && room.kind !== 'dm' && (
          <b className="chat-author" style={{ color: couleurDe(message.senderId) }}>{message.auteur}</b>
        )}
        {message.reply && (
          <div className="chat-quote" role="button" tabIndex={-1} title="Voir le message cité" onClick={() => onQuote(message.reply.id)}>
            <b>{message.reply.auteur}</b>
            <span>{message.reply.texte || '🚫 Message supprimé'}</span>
          </div>
        )}
        {message.deleted ? <span className="chat-body">🚫 Message supprimé</span> : (
          <>
            {message.kind === 'media' && <Attachments items={message.attachments || []} onOpenImage={onOpenImage} onBroken={onBroken} />}
            {message.kind === 'poll' && message.poll && <PollCard message={message} onVote={onVote} />}
            {message.kind === 'event' && message.event && <EventCard message={message} onRsvp={onRsvp} />}
            {position && <CartePosition pos={position} />}
            {live && <CarteDirect live={live} mine={mine} onStop={() => onStopLive(message)} />}
            {message.texte && !position && !live && <TexteRiche texte={message.texte} monNom={`${me.prenom || ''} ${me.nom || ''}`.trim()} recherche={recherche} />}
          </>
        )}
        <span className="chat-meta">
          {message.starred && !message.deleted && <span className="chat-pin-mini" title="Message important">⭐</span>}
          {epingle && !message.deleted && <span className="chat-pin-mini" title="Message épinglé">📌</span>}
          {message.chiffre && !message.deleted && <span className="chat-lock-mini" title="Message chiffré de bout en bout">🔒</span>}
          {message.edited && !message.deleted && <em>modifié</em>}
          {heure(message.createdAt)}
          {mine && !message.deleted && <Coches message={message} room={room} otherRead={otherRead} />}
        </span>
        {!message.deleted && !message.pending && !message.failed && (
          <span className="chat-actions">
            <button type="button" title="Réagir" onClick={() => onReacting(reacting ? null : message.id)}>😊</button>
            <button type="button" title="Répondre" onClick={() => onReply(message)}>↩</button>
            {transferable && <button type="button" title="Transférer" onClick={() => onForward(message)}>↪</button>}
            <button type="button" title={message.starred ? 'Retirer des messages importants' : 'Marquer comme important'} onClick={() => onStar(message, !message.starred)}>{message.starred ? '✩' : '⭐'}</button>
            {mine && room.kind !== 'dm' && <button type="button" title="Infos : qui l'a lu" onClick={() => onInfo(message)}>ℹ️</button>}
            {room.canPin && <button type="button" title={epingle ? 'Désépingler' : 'Épingler'} onClick={() => onPin(message, !epingle)}>{epingle ? '📍' : '📌'}</button>}
            {modifiable && <button type="button" title="Modifier" onClick={() => onEdit(message)}>✏️</button>}
            {canDelete && <button type="button" title="Supprimer" onClick={() => onDelete(message)}>🗑</button>}
          </span>
        )}
        {reacting && actif && <BarreReactions actuelle={maReaction} onPick={(e) => { onReacting(null); onReact(message, e) }} onClose={() => onReacting(null)} />}
        {!message.deleted && <Reactions reactions={message.reactions} meId={me.id} onToggle={(e) => onReact(message, e)} />}
      </div>
    </div>
  )
}

// Typologie d'un adhérent d'après son groupe : coureur (Running) ou marcheur (marche nordique / loisir).
const typeDe = (m) => {
  if (m.groupe === 'Running') return 'coureur'
  if ((m.groupe || '').startsWith('Marche')) return 'marcheur'
  return ''
}
const LOOK_HOMME = { femme: false, peau: '#f1c7a1', cheveux: '#3a2a1d' }
const LOOK_FEMME = { femme: true, peau: '#f1c7a1', cheveux: '#8a3b1d' }

// Le petit bonhomme SAM (une fille pour les filles) : en course pour les coureurs, avec ses bâtons pour les marcheurs.
function Mini({ type, femme = false }) {
  if (!type) return null
  const marche = type === 'marcheur'
  return (
    <span className={`runner runner--mini ${marche ? 'runner--walk' : 'runner--run'}${femme ? ' is-woman' : ''}`} title={marche ? 'Marche nordique' : 'Running'} aria-hidden="true">
      <RunnerFigure look={femme ? LOOK_FEMME : LOOK_HOMME} flag={false} walk={marche} />
    </span>
  )
}

function ChoixMembres({ members, meId, exclude = [], selected = [], onChange, onPick }) {
  const multiple = Boolean(onChange)
  const [q, setQ] = useState('')
  const eligibles = useMemo(() => members
    .filter((m) => m.id !== meId && !exclude.includes(m.id))
    .sort((a, b) => `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, 'fr')), [members, meId, exclude])
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? eligibles.filter((m) => `${m.prenom} ${m.nom}`.toLowerCase().includes(t)) : eligibles
  }, [eligibles, q])

  const groupes = {
    tous: eligibles.map((m) => m.id),
    coureur: eligibles.filter((m) => typeDe(m) === 'coureur').map((m) => m.id),
    marcheur: eligibles.filter((m) => typeDe(m) === 'marcheur').map((m) => m.id),
  }
  const toutes = (ids) => ids.length > 0 && ids.every((id) => selected.includes(id))
  // un clic sélectionne tout le groupe, un second clic le désélectionne (mises à jour fonctionnelles : pas de clic perdu)
  const basculer = (ids) => onChange((cur) => (ids.length > 0 && ids.every((id) => cur.includes(id))
    ? cur.filter((id) => !ids.includes(id))
    : [...new Set([...cur, ...ids])]))
  const unParUn = (id) => onChange((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  return (
    <>
      <input className="chat-search" placeholder="Rechercher un adhérent…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {multiple && (
        <div className="chat-chips">
          <button type="button" className={toutes(groupes.tous) ? 'is-on' : ''} onClick={() => basculer(groupes.tous)}>
            Tout sélectionner ({groupes.tous.length})
          </button>
          <button type="button" className={toutes(groupes.coureur) ? 'is-on' : ''} disabled={groupes.coureur.length === 0} onClick={() => basculer(groupes.coureur)}>
            <Mini type="coureur" /> Running ({groupes.coureur.length})
          </button>
          <button type="button" className={toutes(groupes.marcheur) ? 'is-on' : ''} disabled={groupes.marcheur.length === 0} onClick={() => basculer(groupes.marcheur)}>
            <Mini type="marcheur" /> Marche nordique ({groupes.marcheur.length})
          </button>
          <button type="button" disabled={selected.length === 0} onClick={() => onChange([])}>Aucun</button>
        </div>
      )}
      <div className="chat-pick">
        {list.map((m) => {
          const type = typeDe(m)
          return (
            <button type="button" key={m.id} className={`chat-pick__row${selected.includes(m.id) ? ' is-on' : ''}`} onClick={() => (multiple ? unParUn(m.id) : onPick(m))}>
              <AvatarPresence id={m.id} photoUrl={m.photoUrl} nom={`${m.prenom} ${m.nom}`} size={36} />
              <span className="chat-pick__nom">{m.prenom} {m.nom}<PresenceTexte id={m.id} /></span>
              {type && <small className="chat-type"><Mini type={type} femme={m.sexe === 'F'} /></small>}
              {multiple && <i>{selected.includes(m.id) ? '☑' : '☐'}</i>}
            </button>
          )
        })}
        {list.length === 0 && <p className="chat-empty">Aucun adhérent trouvé.</p>}
      </div>
      {multiple && <p className="chat-count">{selected.length} sélectionné{selected.length > 1 ? 's' : ''}</p>}
    </>
  )
}

function NouvelleDiscussion({ chat, token, me, members, onClose }) {
  const [onglet, setOnglet] = useState('dm')
  const [nom, setNom] = useState('')
  const [choisis, setChoisis] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function ouvrirDM(m) {
    setBusy(true)
    try {
      const { roomId } = await api.chatOpenDM(token, m.id)
      await chat.refreshRooms()
      chat.openRoom(roomId)
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  async function creer() {
    setBusy(true)
    setErr('')
    try {
      const { roomId } = await api.chatCreateRoom(token, nom, choisis)
      await chat.refreshRooms()
      chat.openRoom(roomId)
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Modal titre="Nouvelle discussion" onClose={onClose}>
      {chat.canCreate && (
        <div className="chat-tabs">
          <button type="button" className={onglet === 'dm' ? 'is-on' : ''} onClick={() => setOnglet('dm')}>Message privé</button>
          <button type="button" className={onglet === 'salon' ? 'is-on' : ''} onClick={() => setOnglet('salon')}>Nouveau salon</button>
        </div>
      )}
      {err && <p className="chat-error">{err}</p>}
      {onglet === 'dm' && <ChoixMembres members={members} meId={me.id} onPick={(m) => !busy && ouvrirDM(m)} />}
      {onglet === 'salon' && (
        <>
          <input className="chat-search" placeholder="Nom du salon (ex. Covoiturage Paris-Reims)" maxLength={100} value={nom} onChange={(e) => setNom(e.target.value)} />
          <ChoixMembres members={members} meId={me.id} selected={choisis} onChange={setChoisis} />
          <button type="button" className="btn btn--solid chat-create" disabled={busy || !nom.trim()} onClick={creer}>
            Créer le salon ({choisis.length + 1} participant{choisis.length ? 's' : ''})
          </button>
        </>
      )}
    </Modal>
  )
}

function Participants({ room, conv, token, members, me, onClose, chat }) {
  const [ajout, setAjout] = useState(false)
  const [choisis, setChoisis] = useState([])
  const [err, setErr] = useState('')
  const deja = conv.participants.map((p) => p.id)
  async function ajouter() {
    try {
      await api.chatAddMembers(token, room.id, choisis)
      await chat.openRoom(room.id)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  return (
    <Modal titre={`${room.nom} · ${conv.participants.length} participants`} onClose={onClose}>
      {err && <p className="chat-error">{err}</p>}
      {!ajout && (
        <>
          {room.canAdd && <button type="button" className="btn btn--ghost chat-create" onClick={() => setAjout(true)}>＋ Ajouter des participants</button>}
          <div className="chat-pick">
            {conv.participants.map((p) => (
              <div key={p.id} className="chat-pick__row is-static">
                <AvatarPresence id={p.id} photoUrl={p.photoUrl} nom={p.nom} size={36} />
                <span className="chat-pick__nom">{p.nom}{p.id === me.id ? ' (toi)' : ''}<PresenceTexte id={p.id} /></span>
              </div>
            ))}
          </div>
        </>
      )}
      {ajout && (
        <>
          <ChoixMembres members={members} meId={me.id} exclude={deja} selected={choisis} onChange={setChoisis} />
          <button type="button" className="btn btn--solid chat-create" disabled={choisis.length === 0} onClick={ajouter}>Ajouter {choisis.length || ''}</button>
        </>
      )}
    </Modal>
  )
}

function Conversation({ chat, room, token, me, members, onBack, onUnarchived }) {
  const conv = chat.convs[room.id] || { messages: [], participants: [], otherRead: 0, more: false, loading: false, loaded: false }
  const [texte, setTexte] = useState('')
  const [reply, setReply] = useState(null)
  const [editing, setEditing] = useState(null)
  const [emoji, setEmoji] = useState(false)
  const [infos, setInfos] = useState(false)
  const [menu, setMenu] = useState(false)
  const [err, setErr] = useState('')
  const [fichiers, setFichiers] = useState([]) // pièces jointes en attente d'envoi : { id, file, apercu }
  const [pj, setPj] = useState(false) // menu d'ajout ouvert
  const [modal, setModal] = useState(null) // 'sondage' | 'evenement'
  const [envoi, setEnvoi] = useState(false)
  const [visionneuse, setVisionneuse] = useState(null)
  const [reagir, setReagir] = useState(null) // message dont la barre de réactions est ouverte
  const [transfert, setTransfert] = useState(null) // message à transférer
  const [recherche, setRecherche] = useState(null) // null : fermée ; sinon le texte cherché
  const [trouve, setTrouve] = useState(0) // index du résultat affiché (0 = le plus récent)
  const [mention, setMention] = useState(null) // { debut, q } : « @… » en cours de saisie
  const [info, setInfo] = useState(null) // message dont on regarde « lu par »
  const [vocal, setVocal] = useState(false) // enregistrement d'un message vocal en cours
  const [cible, setCible] = useState(null) // message à rejoindre (épinglé, citation) : l'historique est chargé jusqu'à lui
  const [eclaire, setEclaire] = useState(null) // message mis en évidence un instant après l'avoir rejoint
  const [epingleVu, setEpingleVu] = useState(0) // message épinglé affiché dans le bandeau
  const [mentions, setMentions] = useState([]) // participants mentionnés dans le message en cours : { id, nom }
  const inputMedias = useRef(null)
  const inputFichiers = useRef(null)
  const seq = useRef(0)
  const zone = useRef(null)
  const input = useRef(null)
  const bas = useRef(true)
  const curseur = useRef(null)
  const prevH = useRef(0)

  // reste collé en bas sauf si l'adhérent remonte dans l'historique
  useLayoutEffect(() => {
    const z = zone.current
    if (!z) return
    if (prevH.current && !bas.current && z.scrollHeight > prevH.current && conv.messages.length) {
      z.scrollTop += z.scrollHeight - prevH.current // historique chargé au-dessus : on garde la position
    } else if (bas.current) {
      z.scrollTop = z.scrollHeight
    }
    prevH.current = z.scrollHeight
  }, [conv.messages])

  useEffect(() => { setMenu(false) }, [room.id])
  useEffect(() => {
    if (!menu) return undefined
    const close = (e) => { if (!e.target.closest('.chat-menu, .chat-menu-btn')) setMenu(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  useEffect(() => { bas.current = true; setReply(null); setEditing(null); setTexte(''); setErr(''); setPj(false); setModal(null); setRecherche(null); setVocal(false); setCible(null); setEpingleVu(0); setMentions([]); setMention(null); viderFichiers(); input.current?.focus() }, [room.id])

  // la zone de saisie s'ajuste au texte, y compris quand on le remplit (modification d'un message)
  useLayoutEffect(() => {
    const t = input.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight, 120)}px`
    if (curseur.current != null) {
      t.focus()
      t.setSelectionRange(curseur.current, curseur.current)
      curseur.current = null
    }
  }, [texte])

  function onScroll() {
    const z = zone.current
    bas.current = z.scrollHeight - z.scrollTop - z.clientHeight < 80
    if (z.scrollTop < 60 && conv.more && !conv.loading) { prevH.current = z.scrollHeight; chat.loadMore(room.id) }
  }

  function commencerEdition(m) {
    setEditing(m)
    setReply(null)
    setEmoji(false)
    setTexte(m.texte)
    setErr('')
    input.current?.focus()
  }
  function annulerEdition() {
    setEditing(null)
    setTexte('')
  }

  // Un fichier ne se charge pas (lien expiré après une longue ouverture de l'application) : on recharge la
  // conversation pour obtenir des liens à jour, au plus une fois toutes les 30 secondes.
  const dernierRechargement = useRef(0)
  function recharger() {
    if (Date.now() - dernierRechargement.current < 30000) return
    dernierRechargement.current = Date.now()
    chat.openRoom(room.id)
  }

  // ---- pièces jointes en attente ----
  const fichiersRef = useRef([])
  fichiersRef.current = fichiers
  useEffect(() => () => fichiersRef.current.forEach((f) => f.apercu && URL.revokeObjectURL(f.apercu)), [])

  function ajouterFichiers(liste) {
    const entrants = Array.from(liste || [])
    if (entrants.length === 0) return
    setErr('')
    const suite = [...fichiers]
    for (const f of entrants) {
      if (suite.length >= 10) { setErr('10 fichiers au maximum par message'); break }
      const max = f.type.startsWith('image/') ? 40 : f.type.startsWith('video/') ? 100 : 30
      if (f.size > max * 1048576) { setErr(`« ${f.name} » dépasse ${max} Mo`); continue }
      suite.push({ id: ++seq.current, file: f, apercu: f.type.startsWith('image/') ? URL.createObjectURL(f) : '' })
    }
    setFichiers(suite)
  }
  function retirerFichier(id) {
    setFichiers((l) => {
      l.filter((f) => f.id === id).forEach((f) => f.apercu && URL.revokeObjectURL(f.apercu))
      return l.filter((f) => f.id !== id)
    })
  }
  function viderFichiers() {
    fichiersRef.current.forEach((f) => f.apercu && URL.revokeObjectURL(f.apercu))
    setFichiers([])
  }
  function choisirAjout(k) {
    setPj(false)
    setEmoji(false)
    if (k === 'fichier') inputFichiers.current?.click()
    else if (k === 'photos') inputMedias.current?.click()
    else setModal(k)
  }
  async function envoyerFichiers(t) {
    setEnvoi(true)
    setErr('')
    try {
      const liste = await Promise.all(fichiers.map((f) => reduire(f.file)))
      await chat.sendMedia(room.id, liste, t, reply)
      setTexte('')
      setReply(null)
      viderFichiers()
      bas.current = true
    } catch (e) {
      setErr(e.message)
    } finally {
      setEnvoi(false)
    }
  }

  async function envoyer() {
    const t = texte.trim()
    if (editing) {
      if (!t) return
      try {
        await chat.edit(room.id, editing.id, t)
        annulerEdition()
      } catch (e) {
        setErr(e.message)
        if (e.status === 409) annulerEdition() // déjà lu : on sort du mode modification
      }
      input.current?.focus()
      return
    }
    if (fichiers.length > 0) { await envoyerFichiers(t); return }
    if (!t) return
    setTexte('')
    const r = reply
    setReply(null)
    setEmoji(false)
    setMention(null)
    // seules les mentions encore présentes dans le texte comptent
    const ids = [...new Set(mentions.filter((m) => t.includes(`@${m.nom}`)).map((m) => m.id))]
    setMentions([])
    bas.current = true
    try { await chat.send(room.id, t, r, { mentions: ids }) } catch (e) { setErr(e.message) }
    input.current?.focus()
  }
  function saisir(e) {
    const v = e.target.value
    setTexte(v)
    if (v.trim() && !editing) chat.typing(room.id)
    setMention(room.kind !== 'dm' && !editing ? mentionEnCours(v, e.target.selectionStart ?? v.length) : null)
  }
  function choisirMention(p) {
    if (!mention) return
    const fin = mention.debut + 1 + mention.q.length
    const insere = `@${p.nom} `
    const suite = texte.slice(0, mention.debut) + insere + texte.slice(fin)
    setTexte(suite)
    setMentions((l) => [...l, { id: p.id, nom: p.nom }])
    setMention(null)
    curseur.current = mention.debut + insere.length // placé juste après la mention, au prochain rendu
  }
  // rejoindre un message : chargé au besoin en remontant l'historique (20 pages au plus)
  const pagesCherchees = useRef(0)
  useEffect(() => {
    if (cible == null) return
    if (conv.messages.some((m) => m.id === cible)) {
      bas.current = false
      zone.current?.querySelector(`[data-msg="${cible}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setEclaire(cible)
      setCible(null)
      pagesCherchees.current = 0
      return
    }
    if (conv.loading || !conv.loaded) return
    if (!conv.more || pagesCherchees.current >= 20) { setErr('Ce message est trop ancien pour être affiché ici.'); setCible(null); pagesCherchees.current = 0; return }
    pagesCherchees.current += 1
    chat.loadMore(room.id)
  }, [cible, conv.messages, conv.loading, conv.more, chat, room.id])
  useEffect(() => {
    if (eclaire == null) return undefined
    const t = setTimeout(() => setEclaire(null), 1800)
    return () => clearTimeout(t)
  }, [eclaire])

  // arrivée depuis la liste des messages importants
  const { cible: cibleGlobale, oublierCible } = chat
  useEffect(() => {
    if (cibleGlobale?.roomId !== room.id) return
    setCible(cibleGlobale.messageId)
    oublierCible()
  }, [cibleGlobale, room.id, oublierCible])
  async function marquer(m, oui) {
    try { await chat.star(room.id, m.id, oui) } catch (e) { setErr(e.message) }
  }
  const chargerInfo = useMemo(() => (info ? () => api.chatInfo(token, info.id) : null), [info, token])

  const epingles = conv.pinned || []
  const idsEpingles = useMemo(() => new Set(epingles.map((m) => m.id)), [epingles])
  const epingleAffiche = epingles[epingleVu % Math.max(epingles.length, 1)]
  function ouvrirEpingle() {
    if (!epingleAffiche) return
    setCible(epingleAffiche.id)
    setEpingleVu((i) => (i + 1) % epingles.length) // un clic de plus : l'épinglé suivant
  }
  async function epingler(m, oui) {
    try { await chat.pin(room.id, m.id, oui) } catch (e) { setErr(e.message) }
  }
  async function envoyerVocal(file) {
    setVocal(false)
    setEnvoi(true)
    setErr('')
    try {
      await chat.sendMedia(room.id, [file], '', reply)
      setReply(null)
      bas.current = true
    } catch (e) { setErr(e.message) } finally { setEnvoi(false) }
  }

  async function reagirA(m, emoji) {
    try { await chat.react(room.id, m.id, emoji) } catch (e) { setErr(e.message) }
  }
  async function basculerSourdine() {
    setMenu(false)
    try { await chat.mute(room.id, !room.muted) } catch (e) { setErr(e.message) }
  }
  function onKey(e) {
    if (mention && e.key === 'Escape') { e.preventDefault(); setMention(null); return }
    // Entrée = retour à la ligne ; seule la flèche (ou Ctrl/Cmd + Entrée) envoie le message
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); envoyer() }
    if (e.key === 'Escape' && editing) { e.preventDefault(); e.stopPropagation(); annulerEdition() }
  }
  async function archiver() {
    setMenu(false)
    try {
      await chat.archive(room.id, !room.archived)
      if (!room.archived) onBack() // archivée : on referme la conversation ; désarchivée : elle reste ouverte
      else onUnarchived()
    } catch (e) { setErr(e.message) }
  }
  async function supprimerDiscussion() {
    setMenu(false)
    if (!window.confirm('Supprimer cette discussion ?\n\nElle disparaîtra de ton écran (les autres participants la gardent). Elle reste conservée en base : seul l\'administrateur peut la réactiver.')) return
    try { await chat.removeRoom(room.id) } catch (e) { setErr(e.message) }
  }
  async function supprimer(m) {
    if (!window.confirm('Supprimer ce message pour tout le monde ?')) return
    try { await chat.remove(m.id) } catch (e) { setErr(e.message) }
  }

  // regroupement par jour
  const items = []
  let jour = ''
  conv.messages.forEach((m, i) => {
    const d = new Date(m.createdAt)
    const k = d.toDateString()
    if (k !== jour) { items.push({ sep: jourLabel(d), key: `s${k}` }); jour = k }
    const prev = conv.messages[i - 1]
    items.push({ m, showAuteur: !prev || prev.senderId !== m.senderId || new Date(prev.createdAt).toDateString() !== k, key: m.id })
  })

  // recherche : messages chargés (et déjà déchiffrés) qui contiennent le texte, du plus récent au plus ancien
  const resultats = useMemo(() => {
    const q = normaliser((recherche || '').trim())
    if (!q) return []
    return conv.messages.filter((m) => m.id > 0 && normaliser(texteCherchable(m)).includes(q)).map((m) => m.id).reverse()
  }, [conv.messages, recherche])
  const idTrouve = resultats[Math.min(trouve, resultats.length - 1)]
  useEffect(() => { setTrouve(0) }, [recherche])
  useEffect(() => {
    if (idTrouve == null) return
    bas.current = false
    zone.current?.querySelector(`[data-msg="${idTrouve}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [idTrouve])

  const ecrivent = chat.quiEcrit(room.id)
  const appels = useAppels()
  const presenceAutre = usePresence(room.kind === 'dm' ? room.otherId : 0)
  const [statutChiffre, actualiserChiffre] = useStatutDM(chat, room)
  const chiffre = statutChiffre?.statut === 'chiffre' // discussion chiffrée : ni sondage, ni événement
  const { historiqueAuto } = chat
  useEffect(() => { if (chiffre) historiqueAuto(room.id) }, [chiffre, room.id, historiqueAuto]) // chiffre mes anciens messages restés en clair
  const sousTitreBase = room.kind === 'dm'
    ? (presenceAutre ? (presenceAutre.niveau === 'vert' ? 'En ligne' : presenceAutre.duree === '—' ? 'Jamais connecté' : `Déconnecté depuis ${presenceAutre.duree} · dernière connexion : ${presenceAutre.derniere}`) : 'Message privé')
    : (conv.participants.length ? conv.participants.slice(0, 6).map((p) => p.nom.split(' ')[0]).join(', ') + (conv.participants.length > 6 ? '…' : '') : `${room.members} participants`)
  const sousTitre = ecrivent.length === 0 ? sousTitreBase
    : room.kind === 'dm' ? 'écrit…'
      : ecrivent.length === 1 ? `${ecrivent[0]} écrit…` : `${ecrivent.slice(0, 3).join(', ')} écrivent…`

  return (
    <section
      className="chat-conv"
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }}
      onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); ajouterFichiers(e.dataTransfer.files) } }}
    >
      <header className="chat-conv__head">
        <button type="button" className="chat-back" onClick={onBack} aria-label="Retour aux discussions">←</button>
        {room.kind === 'dm' ? <AvatarPresence id={room.otherId} photoUrl={room.photoUrl} nom={room.nom} size={40} /> : <Avatar photoUrl={room.photoUrl} nom={room.nom} groupe />}
        <button type="button" className="chat-conv__title" onClick={() => room.kind !== 'dm' && setInfos(true)} disabled={room.kind === 'dm'}>
          <b>{room.nom}</b>
          <span className={ecrivent.length ? 'is-typing' : ''}>{sousTitre}</span>
        </button>
        {room.kind === 'dm' && appels.disponible && (
          <span className="chat-call-btns">
            <button type="button" onClick={() => appels.appeler(room, false)} disabled={appels.occupe} aria-label={`Appel vocal avec ${room.nom}`} title="Appel vocal">📞</button>
            <button type="button" onClick={() => appels.appeler(room, true)} disabled={appels.occupe} aria-label={`Appel vidéo avec ${room.nom}`} title="Appel vidéo">🎥</button>
          </span>
        )}
        {room.kind === 'dm' && <CadenasDiscussion chat={chat} room={room} statut={statutChiffre} actualiser={actualiserChiffre} />}
        <div className="chat-menu-wrap">
          <button type="button" className="chat-menu-btn" onClick={() => setMenu((v) => !v)} aria-label="Options de la discussion" aria-expanded={menu}>⋮</button>
          {menu && (
            <div className="chat-menu" role="menu">
              {room.kind !== 'dm' && <button type="button" role="menuitem" onClick={() => { setMenu(false); setInfos(true) }}>👥 Participants</button>}
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setRecherche('') }}>🔍 Rechercher dans la discussion</button>
              <button type="button" role="menuitem" onClick={basculerSourdine}>{room.muted ? '🔔 Réactiver les notifications' : '🔕 Mettre en sourdine'}</button>
              <button type="button" role="menuitem" onClick={archiver}>{room.archived ? '📤 Désarchiver la discussion' : '🗄️ Archiver la discussion'}</button>
              {room.canDelete && <button type="button" role="menuitem" className="is-danger" onClick={supprimerDiscussion}>🗑️ Supprimer la discussion</button>}
            </div>
          )}
        </div>
      </header>
      {epingleAffiche && (
        <div className="chat-pinbar">
          {epingles.length > 1 && <span className="chat-pinbar__pos" aria-hidden="true">{epingles.map((m, i) => <i key={m.id} className={i === epingleVu % epingles.length ? 'is-on' : ''} />)}</span>}
          <button type="button" className="chat-pinbar__msg" onClick={ouvrirEpingle} title="Voir le message épinglé">
            <span aria-hidden="true">📌</span>
            <span className="chat-pinbar__txt"><b>{epingleAffiche.auteur}</b> {apercu(epingleAffiche) || 'Message'}</span>
          </button>
          {room.canPin && <button type="button" className="chat-pinbar__del" onClick={() => epingler(epingleAffiche, false)} aria-label="Désépingler ce message" title="Désépingler">✕</button>}
        </div>
      )}
      {recherche != null && (
        <BarreRecherche q={recherche} setQ={setRecherche} total={resultats.length} index={Math.min(trouve, Math.max(resultats.length - 1, 0))}
          onPrev={() => setTrouve((i) => (resultats.length ? (i + 1) % resultats.length : 0))}
          onNext={() => setTrouve((i) => (resultats.length ? (i - 1 + resultats.length) % resultats.length : 0))}
          onClose={() => setRecherche(null)} plus={conv.more} chargement={conv.loading} onPlus={() => chat.loadMore(room.id)} />
      )}

      <div className="chat-scroll" ref={zone} onScroll={onScroll}>
        {conv.loading && conv.messages.length === 0 && <p className="chat-empty">Chargement…</p>}
        {conv.loaded && conv.messages.length === 0 && <p className="chat-empty">Aucun message. Écris le premier ! 👋</p>}
        {conv.more && <p className="chat-empty">Chargement de l'historique…</p>}
        {items.map((it) => (it.sep
          ? <div key={it.key} className="chat-day"><span>{it.sep}</span></div>
          : <Bulle key={it.key} message={it.m} room={room} me={me} otherRead={conv.otherRead} showAuteur={it.showAuteur}
              onReply={(m) => { setReply(m); setEditing(null); input.current?.focus() }} onEdit={commencerEdition} onDelete={supprimer}
              onVote={(m, ids) => chat.vote(room.id, m.id, ids).catch((e) => setErr(e.message))}
              onRsvp={(m, rep) => chat.rsvp(room.id, m.id, rep).catch((e) => setErr(e.message))}
              onOpenImage={(images, index) => setVisionneuse({ images, index })}
              onBroken={recharger}
              reacting={reagir === it.m.id} onReacting={setReagir} onReact={reagirA} onForward={setTransfert}
              recherche={recherche?.trim() || ''} trouve={it.m.id === idTrouve || it.m.id === eclaire}
              epingle={idsEpingles.has(it.m.id)} onPin={epingler} onQuote={setCible} onStar={marquer} onInfo={setInfo}
              onStopLive={(m) => chat.arreterLive(m.id)} />))}
      </div>

      {err && <p className="chat-error chat-error--bar">{err} <button type="button" onClick={() => setErr('')}>✕</button></p>}
      {editing && (
        <div className="chat-replybar chat-replybar--edit">
          <div><b>Modifier le message</b><span>{editing.texte}</span></div>
          <button type="button" onClick={annulerEdition} aria-label="Annuler la modification">✕</button>
        </div>
      )}
      {reply && (
        <div className="chat-replybar">
          <div><b>{reply.auteur || 'Toi'}</b><span>{apercu(reply)}</span></div>
          <button type="button" onClick={() => setReply(null)} aria-label="Annuler la réponse">✕</button>
        </div>
      )}
      {emoji && (
        <div className="chat-emojis">
          {EMOJIS.map((e) => <button type="button" key={e} onClick={() => { setTexte((t) => t + e); input.current?.focus() }}>{e}</button>)}
        </div>
      )}
      {mention && <SuggestionsMention participants={conv.participants} q={mention.q} meId={me.id} onPick={choisirMention} />}
      {pj && <AttachMenu onPick={choisirAjout} onClose={() => setPj(false)} chiffre={chiffre} />}
      {fichiers.length > 0 && (
        <div className="chat-tray">
          {fichiers.map((f) => (
            <div key={f.id} className={`chat-tray__item${f.apercu ? ' has-img' : ''}`}>
              {f.apercu
                ? <img src={f.apercu} alt={f.file.name} />
                : <span className="chat-tray__doc"><i>{f.file.type.startsWith('video/') ? '🎥' : iconeFichier(f.file.name)}</i><b>{f.file.name}</b><small>{taille(f.file.size)}</small></span>}
              <button type="button" onClick={() => retirerFichier(f.id)} aria-label={`Retirer ${f.file.name}`}>✕</button>
            </div>
          ))}
        </div>
      )}
      {envoi && <p className="chat-uploading">Envoi en cours…</p>}
      {vocal ? <Enregistreur onSend={envoyerVocal} onCancel={() => setVocal(false)} onError={setErr} /> : (
      <div className="chat-composer">
        <button type="button" className="chat-emoji-btn" onClick={() => { setEmoji((v) => !v); setPj(false) }} aria-label="Emojis">😊</button>
        {!editing && (
          <button type="button" className="chat-attach-btn" onClick={() => { setPj((v) => !v); setEmoji(false) }} aria-label="Joindre un fichier, une photo, un sondage ou un événement" aria-expanded={pj}>＋</button>
        )}
        <textarea
          ref={input}
          rows={1}
          value={texte}
          maxLength={2000}
          placeholder={editing ? 'Modifie ton message' : fichiers.length ? 'Ajoute une légende…' : 'Écris un message'}
          onChange={saisir}
          onKeyDown={onKey}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onPaste={(e) => { const fs = Array.from(e.clipboardData?.files || []); if (fs.length) { e.preventDefault(); ajouterFichiers(fs) } }}
        />
        {!editing && !texte.trim() && fichiers.length === 0 && vocalDisponible()
          ? <button type="button" className="chat-send chat-mic" onClick={() => { setEmoji(false); setPj(false); setVocal(true) }} disabled={envoi} aria-label="Enregistrer un message vocal" title="Message vocal">🎤</button>
          : <button type="button" className="chat-send" onClick={envoyer} disabled={envoi || (!texte.trim() && fichiers.length === 0)} aria-label={editing ? 'Enregistrer la modification' : 'Envoyer'}>{editing ? '✓' : '➤'}</button>}
      </div>
      )}
      <input ref={inputMedias} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { ajouterFichiers(e.target.files); e.target.value = '' }} />
      <input ref={inputFichiers} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.rtf,.zip,.gpx,.tcx,.kml,.mp3,.m4a,.ogg" multiple hidden onChange={(e) => { ajouterFichiers(e.target.files); e.target.value = '' }} />

      {modal === 'sondage' && <PollModal onClose={() => setModal(null)} onSend={(d) => chat.sendPoll(room.id, { ...d, replyTo: reply ? reply.id : 0 }).then(() => { setReply(null); bas.current = true })} />}
      {modal === 'evenement' && <EventModal onClose={() => setModal(null)} onSend={(d) => chat.sendEvent(room.id, { ...d, replyTo: reply ? reply.id : 0 }).then(() => { setReply(null); bas.current = true })} />}
      {visionneuse && <Lightbox images={visionneuse.images} index={visionneuse.index} onClose={() => setVisionneuse(null)} />}

      {info && chargerInfo && <InfoMessage message={conv.messages.find((m) => m.id === info.id) || info} charger={chargerInfo} onClose={() => setInfo(null)} />}
      {modal === 'position' && <ModalPosition onClose={() => setModal(null)}
        onLive={(min) => chat.demarrerLive(room.id, min, reply).then(() => { setReply(null); bas.current = true })}
        onSend={(t) => chat.send(room.id, t, reply).then(() => { setReply(null); bas.current = true })} />}
      {transfert && (
        <Transfert message={transfert} rooms={chat.rooms} onClose={() => setTransfert(null)}
          onSend={async (ids) => { await chat.forward(transfert, ids); if (ids.includes(room.id)) bas.current = true }} />
      )}
      {infos && <Participants room={room} conv={conv} token={token} members={members} me={me} chat={chat} onClose={() => setInfos(false)} />}
    </section>
  )
}

// Plein écran sur téléphone et quand le site est installé comme application (PWA).

export default function ChatPanel(props) {
  const { chat, me } = props
  const valeur = useMemo(() => ({ de: chat.presenceDe, meId: me?.id || 0 }), [chat.presenceDe, me?.id])
  return (
    <PresenceCtx.Provider value={valeur}>
      <AppelsProvider chat={chat} token={props.token} me={me}><ChatPanelInterne {...props} /></AppelsProvider>
    </PresenceCtx.Provider>
  )
}

// Sam Link est une application à part entière : la messagerie occupe toujours tout l'écran (comme WhatsApp Web).
function ChatPanelInterne({ chat, token, me, members, onMenu }) {
  const [q, setQ] = useState('')
  const [nouveau, setNouveau] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [importants, setImportants] = useState(false)
  const { setPanelOpen } = chat

  // en plein écran la page derrière ne défile pas
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    setPanelOpen(true)
    return () => setPanelOpen(false)
  }, [setPanelOpen])

  const rooms = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...chat.rooms]
      .filter((r) => !!r.archived === showArchived)
      .filter((r) => !t || (r.nom || '').toLowerCase().includes(t))
      // les messages privés vides n'apparaissent pas tant qu'on n'a pas écrit
      .filter((r) => r.kind !== 'dm' || r.last || r.id === chat.openId)
      .sort((a, b) => {
        const ta = a.last ? new Date(a.last.createdAt).getTime() : 0
        const tb = b.last ? new Date(b.last.createdAt).getTime() : 0
        return tb - ta || (a.nom || '').localeCompare(b.nom || '', 'fr')
      })
  }, [chat.rooms, chat.openId, q, showArchived])

  const archivees = chat.rooms.filter((r) => r.archived)
  const archiveesNonLues = archivees.reduce((n, r) => n + (r.unread || 0), 0)

  const current = chat.rooms.find((r) => r.id === chat.openId)

  return (
    <div>
      <div className={`chat${current ? ' has-conv' : ''} chat--full`}>
        <aside className="chat-list">
          <div className="chat-list__head">
            {!showArchived && (
              <span className="chat-list__exit">
                <button type="button" onClick={onMenu} title="Mon compte et notifications" aria-label="Mon compte et notifications">☰</button>
              </span>
            )}
            {showArchived
              ? <button type="button" className="chat-list__back" onClick={() => setShowArchived(false)}>← Archivées</button>
              : <b>Discussions</b>}
            <span className="chat-list__actions">
              <button type="button" className="chat-stars-btn" onClick={() => setImportants(true)} title="Messages importants" aria-label="Messages importants">⭐</button>
              <BoutonChiffrement chat={chat} />
              <button type="button" className="chat-new" onClick={() => setNouveau(true)} title="Nouvelle discussion" aria-label="Nouvelle discussion">＋</button>
            </span>
          </div>
          <input className="chat-search" placeholder="Rechercher une discussion" value={q} onChange={(e) => setQ(e.target.value)} />
          {!chat.online && <p className="chat-offline">Connexion perdue, reconnexion…</p>}
          <div className="chat-list__rows">
            {!chat.loaded && <p className="chat-empty">Chargement…</p>}
            {!showArchived && archivees.length > 0 && (
              <button type="button" className="chat-room chat-room--archives" onClick={() => setShowArchived(true)}>
                <span className="chat-avatar chat-avatar--groupe" style={{ width: 46, height: 46, fontSize: 20 }}>🗄️</span>
                <span className="chat-room__main">
                  <span className="chat-room__top"><b>Archivées</b></span>
                  <span className="chat-room__bottom">
                    <span className="chat-room__last">{archivees.length} discussion{archivees.length > 1 ? 's' : ''}</span>
                    {archiveesNonLues > 0 && <i className="chat-badge chat-badge--muted">{archiveesNonLues > 99 ? '99+' : archiveesNonLues}</i>}
                  </span>
                </span>
              </button>
            )}
            {rooms.map((r) => (
              <button type="button" key={r.id} className={`chat-room${r.id === chat.openId ? ' is-on' : ''}`} onClick={() => chat.openRoom(r.id)}>
                {r.kind === 'dm' ? <AvatarPresence id={r.otherId} photoUrl={r.photoUrl} nom={r.nom} size={46} /> : <Avatar photoUrl={r.photoUrl} nom={r.nom} groupe size={46} />}
                <span className="chat-room__main">
                  <span className="chat-room__top"><b>{r.nom}</b>{r.muted && <span className="chat-room__muted" title="En sourdine">🔕</span>}</span>
                  <span className="chat-room__bottom">
                    {chat.quiEcrit(r.id).length > 0
                      ? <span className="chat-room__last is-typing">{r.kind === 'dm' ? 'écrit…' : `${chat.quiEcrit(r.id)[0]} écrit…`}</span>
                      : r.kind === 'dm' ? <PresenceLigne id={r.otherId} /> : <span className="chat-room__last">{r.members} participants</span>}
                    {r.unread > 0 && <i className={`chat-badge${r.muted ? ' chat-badge--muted' : ''}`}>{r.unread > 99 ? '99+' : r.unread}</i>}
                  </span>
                </span>
              </button>
            ))}
            {chat.loaded && rooms.length === 0 && <p className="chat-empty">{showArchived ? 'Aucune discussion archivée.' : 'Aucune discussion.'}</p>}
          </div>
        </aside>

        {current
          ? <Conversation key={current.id} chat={chat} room={current} token={token} me={me} members={members} onBack={() => chat.openRoom(null)} onUnarchived={() => setShowArchived(false)} />
          : <section className="chat-conv chat-conv--vide"><p>Sélectionne une discussion<br />ou démarre-en une avec ＋</p></section>}
      </div>
      {importants && <ListeImportants chat={chat} onClose={() => setImportants(false)} />}
      {nouveau && <NouvelleDiscussion chat={chat} token={token} me={me} members={members} onClose={() => setNouveau(false)} />}
    </div>
  )
}
