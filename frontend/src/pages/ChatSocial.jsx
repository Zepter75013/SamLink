import { useMemo, useState } from 'react'
import { Modal } from './ChatRich.jsx'

// Fonctions « à la WhatsApp » de la messagerie : réactions, transfert, recherche dans une discussion, mentions @.

export const REACTIONS_RAPIDES = ['👍', '❤️', '😂', '😮', '😢', '🙏']
const REACTIONS_PLUS = ['🔥', '👏', '🎉', '💪', '🏃', '🥇', '✅', '❌', '🤔', '😍', '😅', '👌']

// minuscules sans accents, pour chercher « beatrice » dans « Béatrice »
export const normaliser = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Barre de réactions rapides au-dessus d'un message.
export function BarreReactions({ actuelle, onPick, onClose }) {
  const [plus, setPlus] = useState(false)
  const liste = plus ? [...REACTIONS_RAPIDES, ...REACTIONS_PLUS] : REACTIONS_RAPIDES
  return (
    <div className={`chat-react-bar${plus ? ' is-plus' : ''}`} role="menu" aria-label="Réagir au message" onMouseLeave={onClose}>
      {liste.map((e) => (
        <button type="button" key={e} className={e === actuelle ? 'is-on' : ''} onClick={() => onPick(e)} aria-label={`Réagir ${e}`}>{e}</button>
      ))}
      {!plus && <button type="button" className="chat-react-bar__plus" onClick={() => setPlus(true)} aria-label="Plus de réactions">＋</button>}
    </div>
  )
}

// Pastilles des réactions sous un message (toucher une pastille ajoute ou retire la même réaction).
export function Reactions({ reactions, meId, onToggle }) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className="chat-reactions">
      {reactions.map((r) => {
        const mine = r.ids.includes(meId)
        return (
          <button type="button" key={r.emoji} className={mine ? 'is-mine' : ''} title={r.noms.join(', ')} onClick={() => onToggle(r.emoji)}>
            {r.emoji}{r.ids.length > 1 && <small>{r.ids.length}</small>}
          </button>
        )
      })}
    </div>
  )
}

// Mentions @Prénom Nom (deux mots ou plus commençant par une majuscule) et texte recherché surlignés dans un message.
const MENTION = /@\p{Lu}[\p{L}'’-]*(?: \p{Lu}[\p{L}'’-]*){0,3}/gu
export function TexteRiche({ texte, monNom, recherche }) {
  const morceaux = []
  let i = 0
  for (const m of texte.matchAll(MENTION)) {
    if (m.index > i) morceaux.push({ t: texte.slice(i, m.index) })
    morceaux.push({ t: m[0], mention: true, moi: !!monNom && normaliser(m[0]).startsWith(`@${normaliser(monNom)}`) })
    i = m.index + m[0].length
  }
  if (i < texte.length) morceaux.push({ t: texte.slice(i) })
  return (
    <span className="chat-body">
      {morceaux.map((p, k) => {
        const contenu = recherche ? <Surligne texte={p.t} q={recherche} /> : p.t
        return p.mention ? <b key={k} className={`chat-mention${p.moi ? ' is-me' : ''}`}>{contenu}</b> : <span key={k}>{contenu}</span>
      })}
    </span>
  )
}

function Surligne({ texte, q }) {
  const n = normaliser(texte)
  const nq = normaliser(q)
  if (!nq) return texte
  const out = []
  let i = 0
  for (let j = n.indexOf(nq); j >= 0; j = n.indexOf(nq, j + nq.length)) {
    if (j > i) out.push(texte.slice(i, j))
    out.push(<mark key={j}>{texte.slice(j, j + nq.length)}</mark>)
    i = j + nq.length
  }
  if (i < texte.length) out.push(texte.slice(i))
  return out
}

// Texte « cherchable » d'un message : texte, question du sondage, titre de l'événement, noms des fichiers.
export function texteCherchable(m) {
  if (m.deleted) return ''
  return [m.texte, m.poll?.question, m.event?.titre, m.event?.lieu, ...(m.attachments || []).map((a) => a.nom)].filter(Boolean).join(' ')
}

// Barre de recherche dans la discussion ouverte.
export function BarreRecherche({ q, setQ, total, index, onPrev, onNext, onClose, plus, onPlus, chargement }) {
  return (
    <div className="chat-findbar">
      <input
        autoFocus
        className="chat-search"
        placeholder="Rechercher dans la discussion"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onNext(); else onPrev() }
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
      />
      <span className="chat-findbar__count">{q.trim() ? (total ? `${index + 1}/${total}` : 'Aucun') : ''}</span>
      <button type="button" onClick={onPrev} disabled={!total} aria-label="Résultat plus ancien" title="Plus ancien">▲</button>
      <button type="button" onClick={onNext} disabled={!total} aria-label="Résultat plus récent" title="Plus récent">▼</button>
      <button type="button" onClick={onClose} aria-label="Fermer la recherche">✕</button>
      {plus && q.trim() && (
        <button type="button" className="chat-findbar__more" onClick={onPlus} disabled={chargement}>
          {chargement ? 'Chargement…' : 'Chercher plus loin'}
        </button>
      )}
    </div>
  )
}

// Suggestions de mention pendant la saisie de « @… ».
export function SuggestionsMention({ participants, q, meId, onPick }) {
  const liste = useMemo(() => {
    const t = normaliser(q)
    return participants
      .filter((p) => p.id !== meId)
      .filter((p) => !t || normaliser(p.nom).split(' ').some((mot) => mot.startsWith(t)) || normaliser(p.nom).startsWith(t))
      .slice(0, 8)
  }, [participants, q, meId])
  if (liste.length === 0) return null
  return (
    <div className="chat-mentions" role="listbox" aria-label="Mentionner un participant">
      {liste.map((p) => (
        // onMouseDown : garde le focus dans la zone de saisie
        <button type="button" key={p.id} role="option" onMouseDown={(e) => { e.preventDefault(); onPick(p) }}>
          {p.photoUrl ? <img src={p.photoUrl} alt="" /> : <i>{p.nom.split(' ').map((w) => w[0]).slice(0, 2).join('')}</i>}
          <span>{p.nom}</span>
        </button>
      ))}
    </div>
  )
}

// « @be » juste avant le curseur : la mention en cours de saisie (null sinon).
export function mentionEnCours(texte, curseur) {
  const avant = texte.slice(0, curseur)
  const m = avant.match(/(^|\s)@([\p{L}'’-]{0,20}(?: [\p{L}'’-]{0,20})?)$/u)
  return m ? { debut: avant.length - m[2].length - 1, q: m[2] } : null
}

// Fenêtre « Transférer à… » : choix d'une à dix discussions.
export function Transfert({ message, rooms, onSend, onClose }) {
  const [q, setQ] = useState('')
  const [choisis, setChoisis] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const liste = useMemo(() => {
    const t = normaliser(q.trim())
    return [...rooms]
      .filter((r) => !r.archived || choisis.includes(r.id))
      .filter((r) => !t || normaliser(r.nom).includes(t))
      .sort((a, b) => (b.last ? new Date(b.last.createdAt).getTime() : 0) - (a.last ? new Date(a.last.createdAt).getTime() : 0))
  }, [rooms, q, choisis])
  const basculer = (id) => setChoisis((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 10 ? c : [...c, id]))
  async function envoyer() {
    setBusy(true)
    setErr('')
    try {
      await onSend(choisis)
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  const resume = message.kind === 'media' ? `📎 ${message.texte || `${message.attachments?.length || 1} pièce(s) jointe(s)`}` : message.texte
  return (
    <Modal titre="Transférer à…" onClose={onClose}>
      <p className="chat-forward__apercu">↪ {resume.length > 120 ? `${resume.slice(0, 120)}…` : resume}</p>
      {err && <p className="chat-error">{err}</p>}
      <input className="chat-search" placeholder="Rechercher une discussion" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="chat-pick">
        {liste.map((r) => (
          <button type="button" key={r.id} className={`chat-pick__row${choisis.includes(r.id) ? ' is-on' : ''}`} onClick={() => basculer(r.id)}>
            <span className="chat-avatar chat-avatar--groupe" style={{ width: 36, height: 36, fontSize: 15 }}>{r.kind === 'dm' ? '👤' : '👥'}</span>
            <span className="chat-pick__nom">{r.nom}</span>
            <i>{choisis.includes(r.id) ? '☑' : '☐'}</i>
          </button>
        ))}
        {liste.length === 0 && <p className="chat-empty">Aucune discussion trouvée.</p>}
      </div>
      <p className="chat-count">{choisis.length} sélectionnée{choisis.length > 1 ? 's' : ''} (10 au maximum)</p>
      <button type="button" className="btn btn--solid chat-create" disabled={busy || choisis.length === 0} onClick={envoyer}>
        {busy ? 'Transfert…' : `Transférer${choisis.length ? ` (${choisis.length})` : ''}`}
      </button>
    </Modal>
  )
}
