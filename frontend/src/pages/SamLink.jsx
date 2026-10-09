import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { useChat } from '../lib/chat.js'
import ChatPanel from './Chat.jsx'
import Parametres from './Parametres.jsx'

// Écran principal de Sam Link : la messagerie en plein écran, et le bouton ☰ pour les paramètres (façon Messenger).
export default function SamLink({ token, onDeconnexion }) {
  const [me, setMe] = useState(null)
  const [members, setMembers] = useState([])
  const [erreur, setErreur] = useState('')
  // Paramètres ouverts : null (fermés), '' (accueil) ou une rubrique ('notifications' depuis le lien d'une notification)
  const [menu, setMenu] = useState(() => (new URLSearchParams(window.location.search).get('reglages') === 'notifications' ? 'notifications' : null))
  const chat = useChat(token, me?.id)

  useEffect(() => {
    let annule = false
    Promise.all([api.getMe(token), api.listMembres(token)])
      .then(([moi, membres]) => {
        if (annule) return
        setMe(moi)
        setMembers(membres)
      })
      .catch((e) => {
        if (annule) return
        if (e.status === 401) onDeconnexion(e.message) // session expirée ou adhésion plus active
        else setErreur('Sam Link ne répond pas pour le moment. Vérifie ta connexion puis recharge la page.')
      })
    return () => { annule = true }
  }, [token, onDeconnexion])

  // Nombre de messages à lire : dans le titre de l'onglet « (3) … » et sur l'icône de l'application installée.
  useEffect(() => {
    const n = chat.unreadTotal
    const titre = document.title.replace(/^\(\d+\+?\)\s*/, '')
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${titre}` : titre
    try {
      if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {})
      else navigator.clearAppBadge?.()?.catch?.(() => {})
    } catch { /* non pris en charge */ }
  }, [chat.unreadTotal])

  // Ouverture depuis une notification (lien de l'e-mail ou clic sur une notification push) : /?salon=…
  const { openRoom } = chat
  const ouvrirLien = useCallback((href) => {
    const u = new URL(href, window.location.origin)
    const salon = Number(u.searchParams.get('salon'))
    if (salon > 0) openRoom(salon)
    if (u.searchParams.get('reglages') === 'notifications') setMenu('notifications')
  }, [openRoom])
  const lienTraite = useRef(false)
  useEffect(() => {
    if (lienTraite.current) return
    lienTraite.current = true
    if (!window.location.search) return
    const salon = Number(new URLSearchParams(window.location.search).get('salon'))
    if (salon > 0) openRoom(salon) // ?reglages=… : les paramètres sont déjà ouverts (état initial)
    window.history.replaceState({}, '', window.location.pathname)
  }, [openRoom])
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined
    const onMessage = (e) => { if (e.data && e.data.type === 'notification-ouvrir') ouvrirLien(e.data.url) }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [ouvrirLien])

  if (!me) {
    return <div className="samlink-chargement"><img src="/logo.png" alt="" width="64" height="58" /><p>{erreur || 'Chargement…'}</p></div>
  }

  return (
    <>
      <ChatPanel chat={chat} token={token} me={me} members={members} onMenu={() => setMenu('')} />
      {menu !== null && (
        <Parametres key={menu} me={me} token={token} chat={chat} pageInitiale={menu || null} onClose={() => setMenu(null)} onDeconnexion={onDeconnexion} />
      )}
    </>
  )
}
