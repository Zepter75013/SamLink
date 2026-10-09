import { useState } from 'react'
import { Modal } from './ChatRich.jsx'

// Filtres de la liste des discussions (Toutes, Non lues, Privés, Groupes, puis les listes de l'adhérent), comme WhatsApp.

export const FILTRES = [
  ['toutes', 'Toutes'],
  ['non-lues', 'Non lues'],
  ['prives', 'Privés'],
  ['groupes', 'Groupes'],
]

export function filtrer(rooms, filtre, listes) {
  switch (filtre) {
    case 'non-lues': return rooms.filter((r) => r.unread > 0)
    case 'prives': return rooms.filter((r) => r.kind === 'dm')
    case 'groupes': return rooms.filter((r) => r.kind !== 'dm')
    default: {
      if (filtre.startsWith('liste:')) {
        const l = listes.find((x) => `liste:${x.id}` === filtre)
        return l ? rooms.filter((r) => l.roomIds.includes(r.id)) : rooms
      }
      return rooms
    }
  }
}

export function videPour(filtre, listes) {
  if (filtre === 'non-lues') return 'Aucune discussion non lue. 🎉'
  if (filtre === 'prives') return 'Aucun message privé.'
  if (filtre === 'groupes') return 'Aucun salon.'
  if (filtre.startsWith('liste:')) {
    const l = listes.find((x) => `liste:${x.id}` === filtre)
    return l ? `La liste « ${l.nom} » est vide : touche ✏️ pour y ajouter des discussions.` : 'Aucune discussion.'
  }
  return 'Aucune discussion.'
}

export function BarreFiltres({ filtre, onFiltre, nonLues, listes, onNouvelle, onModifier }) {
  const liste = filtre.startsWith('liste:') ? listes.find((x) => `liste:${x.id}` === filtre) : null
  return (
    <div className="chat-filtres" role="tablist" aria-label="Filtrer les discussions">
      {FILTRES.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={filtre === id} className={filtre === id ? 'is-on' : ''} onClick={() => onFiltre(id)}>
          {label}{id === 'non-lues' && nonLues > 0 && <span className="chat-filtres__n">{nonLues > 99 ? '99+' : nonLues}</span>}
        </button>
      ))}
      {listes.map((l) => (
        <button key={l.id} type="button" role="tab" aria-selected={filtre === `liste:${l.id}`} className={filtre === `liste:${l.id}` ? 'is-on' : ''}
          onClick={() => onFiltre(`liste:${l.id}`)}>{l.nom}</button>
      ))}
      {liste && <button type="button" className="chat-filtres__outil" onClick={() => onModifier(liste)} title={`Modifier la liste « ${liste.nom} »`} aria-label={`Modifier la liste ${liste.nom}`}>✏️</button>}
      <button type="button" className="chat-filtres__outil" onClick={onNouvelle} title="Nouvelle liste" aria-label="Nouvelle liste">＋</button>
    </div>
  )
}

// Créer ou modifier une liste : nom et discussions cochées
export function ModalListe({ liste, rooms, onSave, onDelete, onClose }) {
  const [nom, setNom] = useState(liste?.nom || '')
  const [ids, setIds] = useState(() => new Set(liste?.roomIds || []))
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const t = q.trim().toLowerCase()
  const visibles = rooms.filter((r) => !t || (r.nom || '').toLowerCase().includes(t))

  async function faire(action) {
    setBusy(true)
    setErr('')
    try {
      await action()
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  function basculer(id) {
    setIds((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  return (
    <Modal titre={liste?.id ? 'Modifier la liste' : 'Nouvelle liste'} onClose={onClose}>
      <div className="chat-liste-form">
        <input className="chat-search" placeholder="Nom de la liste (ex. Sorties, Bénévoles…)" maxLength={40} value={nom} onChange={(e) => setNom(e.target.value)} autoFocus={!liste?.id} />
        <input className="chat-search" placeholder="Rechercher une discussion" value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="chat-count">{ids.size} discussion{ids.size > 1 ? 's' : ''} dans la liste</p>
      </div>
      <div className="chat-pick chat-liste-choix">
        {visibles.map((r) => (
          <label key={r.id} className="chat-pick__row">
            <input type="checkbox" checked={ids.has(r.id)} onChange={() => basculer(r.id)} />
            <span>{r.kind === 'dm' ? '👤' : '👥'} {r.nom}</span>
          </label>
        ))}
        {visibles.length === 0 && <p className="chat-empty">Aucune discussion.</p>}
      </div>
      {err && <p className="chat-error">{err}</p>}
      <button type="button" className="btn btn--solid chat-create" disabled={busy || !nom.trim()} onClick={() => faire(() => onSave(nom.trim(), [...ids]))}>
        {busy ? 'Enregistrement…' : liste?.id ? 'Enregistrer' : 'Créer la liste'}
      </button>
      {liste?.id && (
        <button type="button" className="chat-liste-suppr" disabled={busy}
          onClick={() => window.confirm(`Supprimer la liste « ${liste.nom} » ? Les discussions ne sont pas supprimées.`) && faire(onDelete)}>
          Supprimer la liste
        </button>
      )}
    </Modal>
  )
}

// Depuis une discussion (menu ⋮) : cocher les listes où la ranger
export function ModalAjoutListe({ room, listes, onSave, onNouvelle, onClose }) {
  const [err, setErr] = useState('')
  const [coches, setCoches] = useState({}) // listId -> bool, affiché tout de suite (enregistré ensuite)
  const dedans = (l) => (l.id in coches ? coches[l.id] : l.roomIds.includes(room.id))
  async function basculer(l) {
    const avant = dedans(l)
    setCoches((c) => ({ ...c, [l.id]: !avant }))
    setErr('')
    const roomIds = avant ? l.roomIds.filter((x) => x !== room.id) : [...l.roomIds.filter((x) => x !== room.id), room.id]
    try { await onSave(l.id, l.nom, roomIds) } catch (e) { setErr(e.message); setCoches((c) => ({ ...c, [l.id]: avant })) }
  }
  return (
    <Modal titre="Ranger dans une liste" onClose={onClose}>
      <div className="chat-pick chat-liste-choix">
        {listes.map((l) => (
          <label key={l.id} className="chat-pick__row">
            <input type="checkbox" checked={dedans(l)} onChange={() => basculer(l)} />
            <span>🗂️ {l.nom} <small>· {l.roomIds.length}</small></span>
          </label>
        ))}
        {listes.length === 0 && <p className="chat-empty">Tu n'as pas encore de liste.</p>}
      </div>
      {err && <p className="chat-error">{err}</p>}
      <button type="button" className="btn btn--ghost chat-create" onClick={onNouvelle}>＋ Nouvelle liste avec « {room.nom} »</button>
    </Modal>
  )
}
