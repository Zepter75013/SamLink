import { useMemo, useRef, useState } from 'react'
import { Modal } from './ChatRich.jsx'
import { ModalDeverrouiller, ModalGerer, ModalRecuperation } from './ChatChiffrement.jsx'
import NotificationsPanel from '../components/NotificationsPanel.jsx'
import AboutContent from '../components/AboutContent.jsx'
import AideChiffrement from '../components/AideChiffrement.jsx'
import { chatFileUrl } from '../lib/api.js'
import { APP_VERSION } from '../version.js'
import { getTheme, setTheme } from '../lib/theme.js'
import { FONDS, getFond, getPhotoFond, getVoile, setFond, setPhotoFond, setVoile, supprimerPhotoFond } from '../lib/fond.js'

// Paramètres, façon Messenger : une page d'accueil (photo, nom, rubriques en liste avec une icône ronde de couleur),
// chaque rubrique s'ouvre sur sa propre page avec un retour « ‹ ». L'aide est un petit centre d'aide intégré.

const THEMES = { system: 'Système', light: 'Clair', dark: 'Sombre' }

function Ligne({ icone, couleur, titre, detail, onClick, danger, pastille }) {
  return (
    <button type="button" className={`param-ligne${danger ? ' is-danger' : ''}`} onClick={onClick}>
      <span className="param-ligne__icone" style={{ background: couleur }} aria-hidden="true">{icone}</span>
      <span className="param-ligne__texte">
        <b>{titre}</b>
        {detail && <small>{detail}</small>}
      </span>
      {pastille && <i className={`param-pastille param-pastille--${pastille}`} aria-label="À faire" />}
      {!danger && <span className="param-ligne__chevron" aria-hidden="true">›</span>}
    </button>
  )
}

function Groupe({ titre, children }) {
  return (
    <section className="param-groupe">
      {titre && <h3>{titre}</h3>}
      <div className="param-carte">{children}</div>
    </section>
  )
}

function Avatar({ me }) {
  const ini = `${(me.prenom || '?')[0]}${(me.nom || '')[0] || ''}`.toUpperCase()
  return me.photoUrl
    ? <img className="param-profil__photo" src={chatFileUrl(me.photoUrl)} alt="" />
    : <span className="param-profil__photo param-profil__photo--ini">{ini}</span>
}

// ---- Apparence ----
function PageApparence() {
  const [theme, choisir] = useState(getTheme)
  return (
    <>
      <Groupe titre="Mode sombre">
        {[['system', '🖥️', 'Système', "Suit le réglage de ton téléphone ou de ton ordinateur"], ['light', '☀️', 'Désactivé', 'Toujours en clair'], ['dark', '🌙', 'Activé', 'Toujours en sombre']].map(([v, ic, l, d]) => (
          <button key={v} type="button" role="radio" aria-checked={theme === v} className="param-ligne param-choix" onClick={() => { setTheme(v); choisir(v) }}>
            <span className="param-ligne__icone param-ligne__icone--neutre" aria-hidden="true">{ic}</span>
            <span className="param-ligne__texte"><b>{l}</b><small>{d}</small></span>
            <span className={`param-radio${theme === v ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
        ))}
      </Groupe>
      <ChoixFond />
      <p className="param-note">Ces choix sont mémorisés sur cet appareil.</p>
    </>
  )
}

// Aperçu d'un fond : deux bulles sur le fond, comme dans WhatsApp
function Apercu({ id, photo }) {
  return (
    <span className="param-fond__apercu" data-fond-apercu={id} style={photo ? { '--sl-photo': `url("${photo}")` } : undefined}>
      <i /><i />
    </span>
  )
}

function ChoixFond() {
  const [fond, choisir] = useState(getFond)
  const [photo, setPhoto] = useState(getPhotoFond)
  const [voile, changerVoile] = useState(getVoile)
  const [err, setErr] = useState('')
  const input = useRef(null)
  function prendre(id) { setFond(id); choisir(id); setErr('') }
  async function importer(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErr('')
    try {
      await setPhotoFond(f)
      setPhoto(getPhotoFond())
      choisir('photo')
    } catch (x) { setErr(x.message) }
  }
  return (
    <Groupe titre="Fond d'écran des discussions">
      <div className="param-fond">
        <div className="param-fond__grille" role="radiogroup" aria-label="Fond d'écran">
          {FONDS.map(([id, nom]) => (
            <button key={id} type="button" role="radio" aria-checked={fond === id} className={`param-fond__choix${fond === id ? ' is-on' : ''}`} onClick={() => prendre(id)}>
              <Apercu id={id} />
              <span>{nom}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={fond === 'photo'} className={`param-fond__choix${fond === 'photo' ? ' is-on' : ''}`}
            onClick={() => (photo ? prendre('photo') : input.current?.click())}>
            {photo ? <Apercu id="photo" photo={photo} /> : <span className="param-fond__apercu param-fond__ajout" aria-hidden="true">🖼️</span>}
            <span>Ma photo</span>
          </button>
        </div>
        <input ref={input} type="file" accept="image/*" hidden onChange={importer} />
        <div className="param-fond__actions">
          <button type="button" onClick={() => input.current?.click()}>{photo ? '🖼️ Changer de photo' : '🖼️ Choisir une photo'}</button>
          {photo && <button type="button" onClick={() => { supprimerPhotoFond(); setPhoto(''); choisir(getFond()) }}>Retirer la photo</button>}
        </div>
        {fond === 'photo' && (
          <label className="param-fond__voile">
            <span>Atténuer la photo pour mieux lire les messages</span>
            <input type="range" min="0" max="70" step="5" value={voile} onChange={(e) => { const v = Number(e.target.value); changerVoile(v); setVoile(v) }} />
          </label>
        )}
        {err && <p className="chat-error">{err}</p>}
      </div>
    </Groupe>
  )
}

// ---- Confidentialité ----
function PageConfidentialite({ chat, onAide }) {
  const { e2ee } = chat
  const [modal, setModal] = useState(null)
  const etat = {
    actif: e2ee.recup ? ['Actif', 'Pense à noter ta clé de récupération', 'orange'] : ['Actif', 'Tes messages privés sont chiffrés de bout en bout', ''],
    verrouille: ['Verrouillé', 'Déverrouille cet appareil pour lire tes messages privés', 'rouge'],
    absent: ['En cours d\'activation', 'Il s\'active tout seul à l\'ouverture de Sam Link', ''],
    indisponible: ['Indisponible', 'Ce navigateur ne permet pas le chiffrement', ''],
    chargement: ['…', '', ''],
  }[e2ee.etat] || ['…', '', '']
  return (
    <>
      <Groupe titre="Messages privés chiffrés">
        <Ligne icone="🔒" couleur="#0a7cff" titre={`Chiffrement de bout en bout · ${etat[0]}`} detail={etat[1]} pastille={etat[2]}
          onClick={() => setModal(e2ee.etat === 'verrouille' ? 'deverrouiller' : e2ee.etat === 'actif' ? 'gerer' : null)} />
        {e2ee.etat === 'actif' && <Ligne icone="🔑" couleur="#8e44ad" titre="Clé de récupération" detail="L'afficher pour la noter en lieu sûr" onClick={() => setModal('recup')} />}
        <Ligne icone="❓" couleur="#6b7b86" titre="Comment ça marche ?" detail="Clé de récupération, nouvel appareil, empreinte" onClick={onAide} />
      </Groupe>
      <Groupe titre="Ce qu'il faut savoir">
        <div className="param-texte">
          <p>Seuls toi et ton interlocuteur pouvez lire vos <b>messages privés</b> : ni le serveur, ni le bureau, ni l'administrateur n'y ont accès. Photos, documents, vocaux et positions envoyés en privé sont chiffrés aussi.</p>
          <p>Les <b>salons</b> (Tous les adhérents, Running…) ne sont pas chiffrés de bout en bout : n'y partage rien de confidentiel.</p>
          <p>Ta présence (« en ligne », « vu à … ») est visible des autres adhérents.</p>
        </div>
      </Groupe>
      {modal === 'recup' && <ModalRecuperation e2ee={e2ee} onClose={() => setModal(null)} />}
      {modal === 'deverrouiller' && <ModalDeverrouiller e2ee={e2ee} onClose={() => setModal(null)} onAide={() => { setModal(null); onAide() }} />}
      {modal === 'gerer' && <ModalGerer e2ee={e2ee} chat={chat} onClose={() => setModal(null)} onRecup={() => setModal('recup')} onAide={() => { setModal(null); onAide() }} />}
    </>
  )
}

// ---- Centre d'aide ----
const SUJETS = [
  {
    id: 'debuter', icone: '👋', couleur: '#0a7cff', titre: 'Premiers pas',
    corps: (
      <>
        <p>Tu te connectes avec ton <b>e-mail</b> ou ton <b>numéro de licence</b>, et le <b>mot de passe du site du club</b>. Seuls les adhérents dont l'adhésion de la saison est validée ont accès à Sam Link.</p>
        <p>Les salons du club (<b>Tous les adhérents</b>, <b>Running</b>, <b>Marche nordique</b>, <b>Bureau</b>) apparaissent tout seuls selon ton adhésion.</p>
        <p>Le bouton <b>＋</b> en haut de la liste ouvre une <b>nouvelle discussion</b> : un message privé avec un adhérent, ou un nouveau salon si tu en as le droit.</p>
        <p>Mot de passe oublié : il se change sur le site du club.</p>
      </>
    ),
  },
  {
    id: 'installer', icone: '📲', couleur: '#00a884', titre: "Installer l'application",
    corps: (
      <>
        <p><b>iPhone (Safari)</b> : bouton Partager › « Sur l'écran d'accueil ». Les notifications ne fonctionnent sur iPhone qu'une fois Sam Link installé ainsi.</p>
        <p><b>Android (Chrome)</b> : menu ⋮ › « Installer l'application ».</p>
        <p><b>Ordinateur (Chrome, Edge)</b> : icône d'installation dans la barre d'adresse.</p>
      </>
    ),
  },
  {
    id: 'messages', icone: '💬', couleur: '#0a7cff', titre: 'Écrire et gérer ses messages',
    corps: (
      <>
        <p>Touche une bulle (ou survole-la sur ordinateur) pour ses actions : 😊 réagir, ↩ répondre, ↪ transférer, ⭐ important, 📌 épingler, ✏️ modifier, 🗑 supprimer.</p>
        <p><b>Modifier ou supprimer</b> un message reste possible tant que personne d'autre ne l'a lu.</p>
        <p><b>Coches</b> : ✓ envoyé, ✓✓ reçu, ✓✓ bleues lu. Dans un salon, ℹ️ montre qui a lu ton message.</p>
        <p><b>Mentions</b> : tape @ puis choisis la personne ; elle est prévenue même si le salon est en sourdine.</p>
        <p><b>Épingler</b> : 3 messages au plus, affichés en haut de la discussion.</p>
        <p>Tous tes messages <b>importants</b> se retrouvent avec le bouton ⭐ en haut de la liste.</p>
      </>
    ),
  },
  {
    id: 'contenus', icone: '📎', couleur: '#f39c12', titre: 'Photos, documents, vocaux, sondages',
    corps: (
      <>
        <p>Le bouton <b>＋</b> à gauche de la zone de saisie envoie des <b>photos et vidéos</b> (10 par envoi), des <b>documents</b> (PDF, Office, GPX…), un <b>sondage</b>, un <b>événement</b> (Je viens / Peut-être / Non) ou ta <b>position</b>.</p>
        <p><b>Message vocal</b> : quand la zone de saisie est vide, le bouton micro 🎤 lance l'enregistrement (5 minutes au plus) ; ➤ l'envoie, 🗑 l'annule.</p>
        <p>Sondages et événements ne sont pas disponibles dans un message privé chiffré.</p>
      </>
    ),
  },
  {
    id: 'position', icone: '📍', couleur: '#e74c3c', titre: 'Partager sa position',
    corps: (
      <>
        <p>＋ › <b>Position</b> envoie ta position actuelle, avec des liens vers Google Maps, Plans et Waze.</p>
        <p><b>Position en direct</b> : choisis 15 minutes, 1 heure ou 8 heures. La carte suit tes déplacements <b>tant que Sam Link reste ouvert</b> sur ton téléphone. « Arrêter le partage » l'interrompt à tout moment.</p>
      </>
    ),
  },
  {
    id: 'appels', icone: '📞', couleur: '#00a884', titre: 'Appels audio et vidéo',
    corps: (
      <>
        <p>Dans un message privé, 📞 lance un appel audio, 🎥 un appel vidéo. L'autre adhérent reçoit une sonnerie et une notification.</p>
        <p>Pendant l'appel : couper le micro, couper ou retourner la caméra, raccrocher. Le son et l'image vont directement d'un appareil à l'autre, chiffrés.</p>
        <p>Les appels de groupe ne sont pas disponibles.</p>
      </>
    ),
  },
  {
    id: 'discussions', icone: '🗂️', couleur: '#6b7b86', titre: 'Organiser ses discussions',
    corps: (
      <>
        <p>Le menu <b>⋮</b> d'une discussion permet de voir les participants, de changer la photo du salon (créateur et modérateurs), de rechercher, de mettre en <b>sourdine</b>, d'<b>archiver</b> ou de supprimer la discussion de ton écran.</p>
        <p>Les discussions archivées sont regroupées sous « Archivées » en haut de la liste.</p>
        <p>Les boutons <b>Toutes</b>, <b>Non lues</b>, <b>Privés</b> et <b>Groupes</b> filtrent la liste. Avec <b>＋</b>, crée tes propres <b>listes</b> (Sorties, Bénévoles…) ; <b>✏️</b> modifie la liste affichée, et le menu ⋮ d'une discussion propose « Ranger dans une liste ». Les adhérents connectés apparaissent en haut : un appui ouvre le message privé.</p>
        <p>Pour changer le <b>fond d'écran</b> des discussions (couleur, motif ou ta photo) : Paramètres › Apparence.</p>
      </>
    ),
  },
  { id: 'chiffrement', icone: '🔒', couleur: '#8e44ad', titre: 'Messages privés chiffrés', corps: <AideChiffrement /> },
  {
    id: 'notifications', icone: '🔔', couleur: '#e74c3c', titre: 'Notifications',
    corps: (
      <>
        <p>Paramètres › <b>Notifications</b> : active les notifications sur cet appareil, et choisis notification et/ou e-mail.</p>
        <p>Un e-mail ne part que si le message n'est pas lu au bout d'une heure. Le contenu d'un message chiffré n'apparaît jamais dans une notification.</p>
      </>
    ),
  },
]

function texteDe(el) {
  if (el == null || typeof el === 'boolean') return ''
  if (typeof el === 'string' || typeof el === 'number') return String(el)
  if (Array.isArray(el)) return el.map(texteDe).join(' ')
  return texteDe(el.props?.children)
}
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function PageAide({ onSujet }) {
  const [q, setQ] = useState('')
  const sujets = useMemo(() => {
    const n = norm(q.trim())
    return n ? SUJETS.filter((s) => norm(s.titre + ' ' + texteDe(s.corps)).includes(n)) : SUJETS
  }, [q])
  return (
    <>
      <input className="chat-search param-recherche" placeholder="Rechercher dans l'aide" value={q} onChange={(e) => setQ(e.target.value)} />
      <Groupe titre={q ? `${sujets.length} résultat${sujets.length > 1 ? 's' : ''}` : 'Sujets'}>
        {sujets.map((s) => <Ligne key={s.id} icone={s.icone} couleur={s.couleur} titre={s.titre} onClick={() => onSujet(s.id)} />)}
        {sujets.length === 0 && <p className="param-texte">Aucun sujet ne correspond.</p>}
      </Groupe>
      <p className="param-note">Une question qui n'est pas ici ? Écris au bureau dans le salon « Tous les adhérents ».</p>
    </>
  )
}

const TITRES = { apparence: 'Apparence', notifications: 'Notifications', confidentialite: 'Confidentialité et sécurité', aide: "Centre d'aide", apropos: 'À propos' }

export default function Parametres({ me, token, chat, onClose, onDeconnexion, pageInitiale = null }) {
  const [pile, setPile] = useState(pageInitiale ? [pageInitiale] : [])
  const page = pile[pile.length - 1] || null
  const ouvrir = (p) => setPile((l) => [...l, p])
  const retour = () => setPile((l) => l.slice(0, -1))
  const sujet = page?.startsWith('aide:') ? SUJETS.find((s) => `aide:${s.id}` === page) : null
  const titre = sujet ? sujet.titre : page ? TITRES[page] : 'Paramètres'
  const etatChiffre = chat.e2ee.etat === 'verrouille' ? 'rouge' : chat.e2ee.etat === 'actif' && chat.e2ee.recup ? 'orange' : ''

  return (
    <Modal titre={titre} onClose={onClose} large>
      <div className="param">
        {page && (
          <button type="button" className="param-retour" onClick={retour}>
            ‹ {pile.length > 1 ? (pile[pile.length - 2].startsWith('aide:') ? "Centre d'aide" : TITRES[pile[pile.length - 2]]) : 'Paramètres'}
          </button>
        )}

        {!page && (
          <>
            <div className="param-profil">
              <Avatar me={me} />
              <b>{me.prenom} {me.nom}</b>
              <small>{me.email}</small>
            </div>
            <Groupe titre="Préférences">
              <Ligne icone="🌙" couleur="#5856d6" titre="Apparence" detail={`Mode sombre : ${THEMES[getTheme()] || 'Système'} · fond d'écran`} onClick={() => ouvrir('apparence')} />
              <Ligne icone="🔔" couleur="#e74c3c" titre="Notifications" detail="Sur cet appareil et par e-mail" onClick={() => ouvrir('notifications')} />
            </Groupe>
            <Groupe titre="Compte">
              <Ligne icone="🔒" couleur="#0a7cff" titre="Confidentialité et sécurité" detail="Messages privés chiffrés, clé de récupération" pastille={etatChiffre} onClick={() => ouvrir('confidentialite')} />
            </Groupe>
            <Groupe titre="Aide">
              <Ligne icone="❓" couleur="#00a884" titre="Centre d'aide" detail="Comment utiliser Sam Link" onClick={() => ouvrir('aide')} />
              <Ligne icone="ℹ️" couleur="#6b7b86" titre="À propos" detail={`Version ${APP_VERSION} et nouveautés`} onClick={() => ouvrir('apropos')} />
            </Groupe>
            <Groupe>
              <Ligne icone="⎋" couleur="#e74c3c" titre="Se déconnecter" danger onClick={() => onDeconnexion('')} />
            </Groupe>
          </>
        )}

        {page === 'apparence' && <PageApparence />}
        {page === 'notifications' && <NotificationsPanel token={token} />}
        {page === 'confidentialite' && <PageConfidentialite chat={chat} onAide={() => ouvrir('aide:chiffrement')} />}
        {page === 'aide' && <PageAide onSujet={(id) => ouvrir(`aide:${id}`)} />}
        {sujet && <div className="param-carte param-texte samlink-aide">{sujet.corps}</div>}
        {page === 'apropos' && <AboutContent />}
      </div>
    </Modal>
  )
}
