import { useCallback, useEffect, useRef, useState } from 'react'
import PasswordField from '../components/PasswordField.jsx'
import { formaterCle, formaterCodeLiaison, normaliserCode } from '../lib/e2ee.js'
import { Modal } from './ChatRich.jsx'

// Interface du chiffrement de bout en bout des messages privés : bandeau d'activation ou de déverrouillage en haut de la
// messagerie, cadenas dans l'en-tête d'une discussion privée (statut et empreinte à comparer), gestion de la clé de récupération.

// Statut de chiffrement d'une discussion privée, remis à jour toutes les minutes (l'interlocuteur peut l'activer à tout moment)
export function useStatutDM(chat, room) {
  const { statutDM } = chat.e2ee
  const etat = chat.e2ee.etat
  const [st, setSt] = useState(null)
  const charger = useCallback((forcer = false) => {
    if (room.kind !== 'dm') { setSt(null); return Promise.resolve() }
    return statutDM(room, forcer).then(setSt).catch(() => setSt({ statut: 'moi-absent' }))
  }, [room, statutDM])
  useEffect(() => {
    charger()
    if (room.kind !== 'dm') return undefined
    const t = setInterval(() => charger(true), 60000)
    return () => clearInterval(t)
  }, [charger, room.kind, etat])
  return [st, charger]
}

// Saisie de la clé de récupération : majuscules imposées, tiret ajouté tout seul tous les 4 caractères, œil pour voir la saisie
function FormCle({ onSubmit, occupe }) {
  const [cle, setCle] = useState('')
  const [err, setErr] = useState('')
  function soumettre(e) {
    e.preventDefault()
    if (normaliserCode(cle).length !== 20) return setErr('La clé de récupération comporte 20 caractères (5 groupes de 4).')
    setErr('')
    onSubmit(normaliserCode(cle))
  }
  return (
    <form className="chiffre-form" onSubmit={soumettre}>
      <label>Clé de récupération
        <PasswordField
          className="roles-input chiffre-cle"
          value={cle}
          onChange={(e) => setCle((avant) => formaterCle(e.target.value, avant))}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
          maxLength={24}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      {err && <p className="chiffre-err" role="alert">{err}</p>}
      <button type="submit" className="btn btn--solid" disabled={occupe} style={{ justifyContent: 'center' }}>{occupe ? 'Un instant…' : 'Valider'}</button>
    </form>
  )
}

// Clé de récupération générée automatiquement : à noter une fois, pour retrouver ses messages sur un autre appareil
function ModalRecuperation({ e2ee, onClose }) {
  const [note, setNote] = useState(false)
  const [copie, setCopie] = useState(false)
  async function copier() {
    try { await navigator.clipboard.writeText(e2ee.recup); setCopie(true) } catch { /* copie impossible : la clé reste affichée */ }
  }
  // « Terminé » ferme toujours la fenêtre ; la clé n'est considérée comme notée que si la case est cochée (sinon le rappel reste)
  function terminer() {
    onClose()
    if (note) e2ee.confirmerRecuperation()
  }
  return (
    <Modal titre="Ta clé de récupération" onClose={onClose}>
      <div className="chiffre-corps">
        <p>Tes messages privés sont <b>chiffrés automatiquement</b> : seuls toi et ton interlocuteur peuvent les lire.</p>
        <p>Cette <b>clé de récupération</b> te permettra de retrouver tes messages si tu changes de téléphone, d'ordinateur ou de navigateur. Note-la en lieu sûr (papier, gestionnaire de mots de passe) : <b>elle ne s'affichera plus</b> et personne, pas même le bureau, ne peut la récupérer.</p>
        <p className="chiffre-empreinte" aria-label="Clé de récupération">{e2ee.recup}</p>
        <button type="button" className="btn btn--ghost" onClick={copier}>{copie ? '✓ Copiée' : 'Copier la clé'}</button>
        <label className="chiffre-check"><input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} /> Je l'ai notée en lieu sûr.</label>
        <button type="button" className="btn btn--solid" onClick={terminer} style={{ justifyContent: 'center' }}>{note ? 'Terminé' : 'Plus tard (le rappel reste affiché)'}</button>
        <p className="chiffre-note">Sans cette clé, si tu perds cet appareil, tes anciens messages chiffrés seront définitivement perdus (comme sans sauvegarde WhatsApp).</p>
      </div>
    </Modal>
  )
}

// Saisie du code affiché par le nouvel appareil (majuscules, tiret automatique après 5 caractères)
function FormLiaison({ e2ee, onFini, onRetour }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [occupe, setOcc] = useState(false)
  async function soumettre(e) {
    e.preventDefault()
    if (normaliserCode(code).length !== 10) return setErr('Le code comporte 10 caractères (2 groupes de 5).')
    setOcc(true)
    setErr('')
    try { await e2ee.approuverLiaison(code); onFini() } catch (er) { setErr(er.message || 'La liaison a échoué.'); setOcc(false) }
  }
  return (
    <form className="chiffre-form" onSubmit={soumettre}>
      <p>Sur le <b>nouvel appareil</b>, ouvre Sam Link puis <b>Déverrouiller › Obtenir un code de liaison</b>, et saisis ici le code qui s'affiche.</p>
      <label>Code de liaison
        <input className="roles-input chiffre-cle" value={code} onChange={(e) => setCode((avant) => formaterCodeLiaison(e.target.value, avant))}
          placeholder="XXXXX-XXXXX" maxLength={11} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoFocus />
      </label>
      {err && <p className="chiffre-err" role="alert">{err}</p>}
      <button type="submit" className="btn btn--solid" disabled={occupe} style={{ justifyContent: 'center' }}>{occupe ? 'Un instant…' : 'Lier cet appareil'}</button>
      <button type="button" className="link-button" onClick={onRetour}>← Retour</button>
    </form>
  )
}

// Deux façons de déverrouiller un nouvel appareil : avec un autre appareil déjà déverrouillé (code à saisir là-bas), ou avec la clé de récupération
function ModalDeverrouiller({ e2ee, onClose }) {
  const [occupe, setOcc] = useState(false)
  const [err, setErr] = useState('')
  const [oubli, setOubli] = useState(false)
  const [liaison, setLiaison] = useState(null) // { code } pendant l'attente de l'autre appareil
  const annulation = useRef(null)
  useEffect(() => () => annulation.current?.abort(), [])

  async function deverrouiller(cle) {
    setOcc(true)
    setErr('')
    try { await e2ee.deverrouiller(cle); onClose() } catch (e) { setErr(e.message || 'Impossible de déverrouiller.'); setOcc(false) }
  }
  async function lier() {
    setErr('')
    annulation.current = new AbortController()
    setLiaison({ code: '' })
    try {
      const ok = await e2ee.lierNouvelAppareil((code) => setLiaison({ code }), annulation.current.signal)
      if (ok) onClose()
    } catch (e) {
      setErr(e.message || 'La liaison a échoué.')
      setLiaison(null)
    }
  }
  function annuler() {
    annulation.current?.abort()
    setLiaison(null)
  }

  if (liaison) {
    return (
      <Modal titre="Lier avec un autre appareil" onClose={() => { annuler(); onClose() }}>
        <div className="chiffre-corps">
          <p>Sur ton <b>autre appareil déjà déverrouillé</b> (ordinateur ou téléphone), ouvre Sam Link puis <b>Gérer › Lier un nouvel appareil</b> et saisis ce code :</p>
          <p className="chiffre-empreinte" aria-live="polite">{liaison.code || '…'}</p>
          <p className="chiffre-note">En attente de l'autre appareil… Ce code est valable 5 minutes. Cet écran se ferme tout seul dès que c'est fait.</p>
          <button type="button" className="btn btn--ghost" onClick={annuler} style={{ justifyContent: 'center' }}>Annuler</button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal titre="Déverrouiller mes messages privés" onClose={onClose}>
      <div className="chiffre-corps">
        <p>Pour lire tes messages chiffrés sur cet appareil, choisis l'une des deux possibilités :</p>
        <div className="chiffre-option">
          <b>① Avec un autre appareil</b>
          <small>Tu as déjà un appareil déverrouillé sous la main : il transmet la clé à celui-ci, rien à noter ni à taper.</small>
          <button type="button" className="btn btn--solid" onClick={lier} style={{ justifyContent: 'center' }}>Obtenir un code de liaison</button>
        </div>
        <div className="chiffre-option">
          <b>② Avec ta clé de récupération</b>
          <small>Elle ressemble à XXXX-XXXX-XXXX-XXXX-XXXX : elle t'a été montrée une seule fois, sur le premier appareil où tu as ouvert l'espace adhérent.</small>
          <FormCle onSubmit={deverrouiller} occupe={occupe} />
        </div>
        {err && <p className="chiffre-err" role="alert">{err}</p>}
        {!oubli
          ? <button type="button" className="link-button" onClick={() => setOubli(true)}>Je n'ai ni autre appareil, ni clé de récupération</button>
          : (
            <div className="chiffre-danger">
              <p><b>Si un de tes appareils est encore déverrouillé</b> : ouvre-y Sam Link, <b>Gérer › Générer une nouvelle clé de récupération</b>, note-la, puis saisis-la ici. Tes messages sont conservés.</p><p><b>Sinon, tes anciens messages chiffrés ne peuvent pas être récupérés</b> (ni par toi, ni par le bureau). Tu peux repartir de zéro avec de nouvelles clés : tes interlocuteurs devront accepter ta nouvelle clé.</p>
              <button type="button" className="btn btn--ghost" onClick={async () => { await e2ee.reinitialiser(); onClose() }}>Repartir de zéro (nouvelles clés)</button>
            </div>
          )}
      </div>
    </Modal>
  )
}

function ModalGerer({ e2ee, chat, onClose, onRecup }) {
  const [vue, setVue] = useState('menu')
  const [msg, setMsg] = useState(null)
  const [occupe, setOcc] = useState(false)
  async function nouvelleCle() {
    setOcc(true)
    setMsg(null)
    try {
      await e2ee.regenererRecuperation()
      onClose()
      onRecup()
    } catch (e) { setMsg({ ok: false, texte: e.message || 'Impossible de générer une nouvelle clé.' }) }
    setOcc(false)
  }
  async function chiffrerHistorique() {
    setOcc(true)
    setMsg(null)
    try {
      const r = await chat.chiffrerHistorique()
      setMsg({ ok: true, texte: r.total > 0 ? `${r.total} ancien${r.total > 1 ? 's' : ''} message${r.total > 1 ? 's' : ''} chiffré${r.total > 1 ? 's' : ''} dans ${r.discussions} discussion${r.discussions > 1 ? 's' : ''}.` : "Rien à chiffrer : tes anciens messages sont déjà chiffrés, ou tes interlocuteurs n'ont pas encore activé le chiffrement." })
    } catch (e) { setMsg({ ok: false, texte: e.message || 'Échec du chiffrement.' }) }
    setOcc(false)
  }
  return (
    <Modal titre="Mes messages privés chiffrés" onClose={onClose}>
      <div className="chiffre-corps">
        <p>Le chiffrement de bout en bout est <b>activé automatiquement</b> et cet appareil est déverrouillé.</p>
        {msg && <p className={msg.ok ? 'chiffre-ok' : 'chiffre-err'} role="status">{msg.texte}</p>}
        {vue === 'menu' && (
          <div className="chiffre-actions">
            <button type="button" className="btn btn--ghost" onClick={chiffrerHistorique} disabled={occupe}>{occupe ? 'Chiffrement en cours…' : 'Chiffrer mes anciens messages privés'}</button>
            {e2ee.recup && <button type="button" className="btn btn--solid" onClick={() => { onClose(); onRecup() }}>Afficher ma clé de récupération</button>}
            <button type="button" className="btn btn--ghost" onClick={() => setVue('lier')}>Lier un nouvel appareil (téléphone, ordinateur…)</button>
            <button type="button" className="btn btn--ghost" disabled={occupe} onClick={nouvelleCle}>Générer une nouvelle clé de récupération</button>
            <button type="button" className="btn btn--ghost" onClick={async () => { await e2ee.oublierAppareil(); onClose() }}>Effacer la clé de cet appareil (ordinateur partagé)</button>
            <button type="button" className="btn btn--ghost" onClick={() => setVue('reset')}>Repartir de zéro (nouvelles clés)</button>
          </div>
        )}
        {vue === 'lier' && <FormLiaison e2ee={e2ee} onFini={() => { setMsg({ ok: true, texte: 'Appareil lié ✓ : il peut maintenant lire tes messages privés.' }); setVue('menu') }} onRetour={() => setVue('menu')} />}
        {vue === 'reset' && (
          <div className="chiffre-danger">
            <p><b>Tes messages déjà chiffrés deviendront illisibles pour toujours</b>, pour toi comme pour tes interlocuteurs. De nouvelles clés (et une nouvelle clé de récupération) sont créées aussitôt.</p>
            <button type="button" className="btn btn--solid" onClick={async () => { await e2ee.reinitialiser(); onClose() }}>Je repars de zéro définitivement</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// Bandeau en haut de la messagerie : le chiffrement est activé automatiquement ; il ne reste qu'à noter la clé de récupération
// (une fois) et, sur un nouvel appareil, à déverrouiller avec cette clé.
export function BandeauChiffrement({ chat }) {
  const { e2ee } = chat
  const [modal, setModal] = useState(null)
  const [masque, setMasque] = useState(false)
  if (e2ee.etat === 'chargement' || e2ee.etat === 'indisponible' || e2ee.etat === 'absent') return null
  return (
    <>
      {e2ee.etat === 'verrouille' && (
        <div className="chiffre-bandeau chiffre-bandeau--verrou">
          <span>🔒 Tes messages privés chiffrés sont <b>verrouillés</b> sur cet appareil : saisis ta clé de récupération pour les lire.</span>
          <span className="chiffre-bandeau__actions"><button type="button" className="btn btn--solid" onClick={() => setModal('deverrouiller')}>Déverrouiller</button></span>
        </div>
      )}
      {e2ee.etat === 'actif' && e2ee.recup && !masque && (
        <div className="chiffre-bandeau">
          <span>🔑 <b>Note ta clé de récupération</b> : sans elle, tu perdras tes messages privés si tu changes d'appareil.</span>
          <span className="chiffre-bandeau__actions"><button type="button" className="btn btn--solid" onClick={() => setModal('recup')}>Afficher la clé</button><button type="button" className="link-button" onClick={() => setMasque(true)}>Plus tard</button><button type="button" className="link-button" onClick={() => setModal('gerer')}>Gérer</button></span>
        </div>
      )}
      {e2ee.etat === 'actif' && (!e2ee.recup || masque) && (
        <div className="chiffre-bandeau chiffre-bandeau--actif">
          <span>🔒 Messages privés chiffrés de bout en bout : <b>activé</b>.{e2ee.recup && <> <button type="button" className="link-button" onClick={() => setModal('recup')}>Noter ma clé de récupération</button></>}</span>
          <span className="chiffre-bandeau__actions"><button type="button" className="link-button" onClick={() => setModal('gerer')}>Gérer</button></span>
        </div>
      )}
      {modal === 'recup' && <ModalRecuperation e2ee={e2ee} onClose={() => setModal(null)} />}
      {modal === 'deverrouiller' && <ModalDeverrouiller e2ee={e2ee} onClose={() => setModal(null)} />}
      {modal === 'gerer' && <ModalGerer e2ee={e2ee} chat={chat} onClose={() => setModal(null)} onRecup={() => setModal('recup')} />}
    </>
  )
}

// Bouton 🔒 de la liste des discussions : accès au chiffrement (gérer, noter la clé, déverrouiller) même quand le bandeau n'est pas visible
// (messagerie en plein écran sur téléphone). Pastille rouge : appareil verrouillé ; orange : clé de récupération à noter.
export function BoutonChiffrement({ chat }) {
  const { e2ee } = chat
  const [modal, setModal] = useState(null)
  if (e2ee.etat !== 'actif' && e2ee.etat !== 'verrouille') return null
  const alerte = e2ee.etat === 'verrouille' ? 'rouge' : e2ee.recup ? 'orange' : ''
  return (
    <>
      <button type="button" className="chat-cle" onClick={() => setModal(e2ee.etat === 'verrouille' ? 'deverrouiller' : 'gerer')}
        title="Chiffrement des messages privés" aria-label="Chiffrement des messages privés : gérer, noter ma clé de récupération, lier un appareil">
        <span aria-hidden="true">🔒</span>{alerte && <i className={`chat-cle__pastille chat-cle__pastille--${alerte}`} />}
      </button>
      {modal === 'recup' && <ModalRecuperation e2ee={e2ee} onClose={() => setModal(null)} />}
      {modal === 'deverrouiller' && <ModalDeverrouiller e2ee={e2ee} onClose={() => setModal(null)} />}
      {modal === 'gerer' && <ModalGerer e2ee={e2ee} chat={chat} onClose={() => setModal(null)} onRecup={() => setModal('recup')} />}
    </>
  )
}

const ETIQUETTES = {
  chiffre: ['🔒', 'Chiffré', 'chiffre'],
  'moi-verrouille': ['🔒', 'Verrouillé', 'alerte'],
  'cle-changee': ['⚠️', 'Clé modifiée', 'alerte'],
  'autre-absent': ['🔓', 'Non chiffré', 'clair'],
  'moi-absent': ['🔓', 'Non chiffré', 'clair'],
}

// Cadenas de l'en-tête d'une discussion privée : statut, et fenêtre de vérification (empreinte)
export function CadenasDiscussion({ chat, room, statut, actualiser }) {
  const [ouvert, setOuvert] = useState(false)
  const [modal, setModal] = useState(null)
  if (!statut) return null
  const [icone, texte, classe] = ETIQUETTES[statut.statut] || ETIQUETTES['moi-absent']
  const prenom = room.nom.split(' ')[0]
  return (
    <>
      <button type="button" className={`chiffre-cadenas chiffre-cadenas--${classe}`} onClick={() => setOuvert(true)} title="Vérifier le chiffrement de cette discussion">
        <span aria-hidden="true">{icone}</span> {texte}
      </button>
      {ouvert && (
        <Modal titre="Chiffrement de cette discussion" onClose={() => setOuvert(false)}>
          <div className="chiffre-corps">
            {statut.statut === 'chiffre' && (
              <>
                <p>🔒 Les messages échangés avec <b>{room.nom}</b> sont chiffrés de bout en bout : ni le serveur ni le bureau ne peuvent les lire.</p>
                <p>Pour être certain de parler à la bonne personne, compare cette <b>empreinte</b> avec celle que {prenom} voit, <b>de vive voix ou par téléphone</b> (pas dans Sam Link) :</p>
                <p className="chiffre-empreinte">{statut.empreinte}</p>
                <button type="button" className="link-button" onClick={async () => { await chat.e2ee.verifierCles(); await actualiser(true) }}>↻ Actualiser les clés</button>
                <p className="chiffre-note">Si les deux empreintes sont identiques, personne ne s'interpose. Si elles diffèrent, actualise les clés des <b>deux</b> côtés (ou recharge la page) : une page restée ouverte peut garder une ancienne clé. Photos, vidéos et documents sont chiffrés aussi ; les sondages et événements ne sont pas disponibles dans cette discussion.</p>
              </>
            )}
            {statut.statut === 'cle-changee' && (
              <>
                <p>⚠️ La clé de chiffrement de <b>{room.nom}</b> n'est plus celle que tu connaissais. Cela arrive quand {prenom} change de téléphone après avoir réinitialisé son chiffrement… ou si quelqu'un se fait passer pour lui.</p>
                <p>Compare la nouvelle empreinte avec celle que {prenom} voit, de vive voix :</p>
                <p className="chiffre-empreinte">{statut.empreinte}</p>
                <button type="button" className="link-button" onClick={async () => { await chat.e2ee.verifierCles(); await actualiser(true) }}>↻ Actualiser les clés</button>
                <button type="button" className="btn btn--solid" onClick={async () => { await chat.e2ee.accepterCle(room); await actualiser(true); setOuvert(false) }}>Les empreintes sont identiques : accepter la nouvelle clé</button>
              </>
            )}
            {statut.statut === 'autre-absent' && <p>🔓 <b>{room.nom}</b> ne s'est pas encore connecté depuis l'activation du chiffrement : vos messages sont envoyés <b>en clair</b> (lisibles par le serveur) tant que ce n'est pas fait. Le chiffrement s'active tout seul dès qu'il ouvre l'espace adhérent.</p>}
            {statut.statut === 'moi-absent' && <p>🔓 Le chiffrement de bout en bout n'est pas actif sur cet appareil (navigateur trop ancien, ou activation en cours) : tes messages privés sont envoyés <b>en clair</b>. Recharge la page ; si cela persiste, utilise un navigateur récent.</p>}
            {statut.statut === 'moi-verrouille' && (
              <>
                <p>🔒 Cette discussion est chiffrée, mais cet appareil est verrouillé : saisis ta clé de récupération pour lire et écrire.</p>
                <button type="button" className="btn btn--solid" onClick={() => { setOuvert(false); setModal('deverrouiller') }}>Déverrouiller</button>
              </>
            )}
          </div>
        </Modal>
      )}
      {modal === 'deverrouiller' && <ModalDeverrouiller e2ee={chat.e2ee} onClose={() => setModal(null)} />}
    </>
  )
}
