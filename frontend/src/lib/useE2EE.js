import { useCallback, useEffect, useRef, useState } from 'react'
import { api, chatFileUrl } from './api.js'
import {
  e2eeDisponible, genererPaire, emballer, deballer, importerPrivee, exporterPrivee, genererLiaison, codeLiaison, emballerPourLiaison, ouvrirLiaison, publiqueDepuisPrivee, cleDiscussion, chiffrer, dechiffrer, empreinte,
  chiffrerFichier, dechiffrerFichier, lirePrivee, ecrirePrivee, effacerPrivee, cleConnue, retenirCle,
  genererCodeRecuperation, normaliserCode, ressembleACode, lireRecup, ecrireRecup, effacerRecup,
} from './e2ee.js'

// État du chiffrement de bout en bout de l'adhérent connecté et opérations sur ses discussions privées.
//   etat : 'chargement' | 'indisponible' (navigateur sans WebCrypto) | 'absent' (pas encore activé)
//          | 'verrouille' (activé, mais la phrase secrète n'a pas été saisie sur cet appareil) | 'actif'
// Statut d'une discussion privée (statutDM) :
//   'chiffre' · 'moi-absent' (je n'ai pas activé) · 'moi-verrouille' · 'autre-absent' (l'interlocuteur n'a pas activé)
//   · 'cle-changee' (la clé de l'interlocuteur n'est plus celle que je connaissais : à vérifier)

export function useE2EE(token, meId) {
  const [etat, setEtat] = useState('chargement')
  const [recup, setRecup] = useState(null) // clé de récupération générée, à sauvegarder par l'adhérent (null : rien à sauvegarder)
  const prive = useRef(null) // { cle, publique } de cet appareil
  const autres = useRef(new Map()) // idAutre -> { publique, cle, vuLe } (clé publique de l'interlocuteur et clé de discussion dérivée)
  const absents = useRef(new Map()) // idAutre -> date de la dernière vérification « n'a pas activé »

  const charger = useCallback(async () => {
    if (!token || !meId) return
    if (!e2eeDisponible()) { setEtat('indisponible'); return }
    try {
      const k = await api.chatMesCles(token)
      autres.current.clear()
      absents.current.clear()
      if (!k.configure) {
        await effacerPrivee(meId).catch(() => {})
        prive.current = null
        setEtat('absent')
        return
      }
      setRecup((await lireRecup(meId).catch(() => null)) || null)
      const local = await lirePrivee(meId).catch(() => null)
      if (local && local.publique === k.publicKey) { prive.current = local; setEtat('actif') } else {
        if (local) await effacerPrivee(meId).catch(() => {}) // clé d'un ancien chiffrement réinitialisé
        prive.current = null
        setEtat('verrouille')
      }
    } catch {
      setEtat('indisponible')
    }
  }, [token, meId])
  useEffect(() => { charger() }, [charger])

  // Ma clé a-t-elle changé ailleurs (autre appareil qui repart de zéro, purge de la messagerie) ? Une page restée ouverte garderait
  // sinon en mémoire une clé périmée : empreintes différentes de celles de l'interlocuteur, messages reçus illisibles. On relit alors tout.
  const etatRef = useRef(etat)
  etatRef.current = etat
  const verifierCles = useCallback(async () => {
    if (!token || !meId || etatRef.current === 'chargement' || etatRef.current === 'indisponible') return
    try {
      const k = await api.chatMesCles(token)
      const periime = etatRef.current === 'actif' && (!k.configure || k.publicKey !== prive.current?.publique)
      const nouvelles = etatRef.current === 'absent' && k.configure // créées ailleurs entre-temps
      if (periime || nouvelles) await charger()
    } catch { /* hors connexion : on réessaiera */ }
  }, [token, meId, charger])
  useEffect(() => {
    if (!token || !meId) return undefined
    const retour = () => { if (document.visibilityState === 'visible') verifierCles() }
    const t = setInterval(verifierCles, 90000)
    document.addEventListener('visibilitychange', retour)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', retour) }
  }, [token, meId, verifierCles])

  // Crée les clés : la clé privée est emballée par un secret (clé de récupération générée, ou phrase choisie) puis confiée au serveur
  const creerCles = useCallback(async (secret) => {
    const { publique, privee } = await genererPaire()
    const emballee = await emballer(privee, secret)
    await api.chatEnregistrerCles(token, publique, emballee)
    const cle = await importerPrivee(privee, true)
    await ecrirePrivee(meId, cle, publique)
    prive.current = { cle, publique }
    autres.current.clear()
    setEtat('actif')
  }, [token, meId])

  // Activation automatique, sans rien demander (comme WhatsApp) : une clé de récupération est générée ; l'adhérent est invité à la
  // noter, elle ne sert que pour retrouver ses messages sur un autre appareil.
  const activerAuto = useCallback(async () => {
    const code = genererCodeRecuperation()
    await creerCles(normaliserCode(code))
    await ecrireRecup(meId, code).catch(() => {})
    setRecup(code)
  }, [creerCles, meId])
  const essaiAuto = useRef(false)
  useEffect(() => {
    if (etat !== 'absent' || essaiAuto.current) return
    essaiAuto.current = true
    activerAuto().catch(() => charger()) // clés créées entre-temps sur un autre appareil : on relit l'état
  }, [etat, activerAuto, charger])

  // Nouvel appareil (verrouillé) : demande à un appareil déjà déverrouillé de lui transmettre la clé. onCode reçoit le code à saisir sur
  // l'ancien appareil ; la fonction attend la réponse (5 minutes au plus) puis déverrouille cet appareil. signal.aborted : annulé.
  const lierNouvelAppareil = useCallback(async (onCode, signal) => {
    const eph = await genererLiaison()
    const { id } = await api.chatDemanderLiaison(token, eph.publique)
    onCode(await codeLiaison(eph.publique))
    try {
      const fin = Date.now() + 5 * 60 * 1000
      while (Date.now() < fin) {
        await new Promise((r) => setTimeout(r, 2000))
        if (signal.aborted) return false
        let r
        try { r = await api.chatReponseLiaison(token, id) } catch (e) { if (/expir/i.test(e.message || '')) break; continue }
        if (!r.pret) continue
        const pkcs8 = await ouvrirLiaison(eph.privee, eph.publique, r.publicKey, r.blob, id)
        const k = await api.chatMesCles(token)
        const cle = await importerPrivee(pkcs8, true)
        if ((await publiqueDepuisPrivee(cle)) !== k.publicKey) throw new Error('La clé reçue ne correspond pas à ton compte : recommence.')
        await ecrirePrivee(meId, cle, k.publicKey)
        prive.current = { cle, publique: k.publicKey }
        autres.current.clear()
        setEtat('actif')
        return true
      }
      throw new Error('Délai dépassé : recommence pour obtenir un nouveau code.')
    } finally {
      api.chatSupprimerLiaison(token, id).catch(() => {})
    }
  }, [token, meId])

  // Appareil déjà déverrouillé : l'adhérent saisit le code affiché par le nouvel appareil ; on lui transmet la clé, chiffrée pour lui
  const approuverLiaison = useCallback(async (saisie) => {
    if (!prive.current) throw new Error("Déverrouille d'abord cet appareil.")
    const code = normaliserCode(saisie)
    const { demandes } = await api.chatLiaisons(token)
    let cible = null
    for (const d of demandes) {
      if (normaliserCode(await codeLiaison(d.publicKey)) === code) { cible = d; break }
    }
    if (!cible) throw new Error('Code inconnu ou expiré : vérifie le code affiché sur le nouvel appareil (il est valable 5 minutes).')
    let pkcs8
    try {
      pkcs8 = await exporterPrivee(prive.current.cle)
    } catch {
      throw new Error("La clé de cet appareil a été créée par une ancienne version et ne peut pas être transmise : utilise la clé de récupération sur le nouvel appareil.")
    }
    const { publique, blob } = await emballerPourLiaison(pkcs8, cible.publicKey, cible.id)
    await api.chatRepondreLiaison(token, cible.id, publique, blob)
  }, [token])

  // Nouvelle clé de récupération (ancienne perdue) : possible depuis un appareil déverrouillé, sans perdre l'historique. L'ancienne
  // clé (ou phrase) ne fonctionne plus. Impossible si la clé de l'appareil date d'avant cette fonction (non exportable).
  const regenererRecuperation = useCallback(async () => {
    if (!prive.current) throw new Error('Déverrouille d\'abord cet appareil.')
    let pkcs8
    try {
      pkcs8 = await exporterPrivee(prive.current.cle)
    } catch {
      throw new Error("La clé de cet appareil a été créée avant cette fonction : impossible d'en générer une nouvelle clé de récupération. Utilise « Repartir de zéro » (tes messages chiffrés actuels seront perdus).")
    }
    const code = genererCodeRecuperation()
    await api.chatEnregistrerCles(token, prive.current.publique, await emballer(pkcs8, normaliserCode(code)))
    await ecrireRecup(meId, code).catch(() => {})
    setRecup(code)
    return code
  }, [token, meId])

  const confirmerRecuperation = useCallback(async () => {
    setRecup(null) // d'abord à l'écran, puis l'effacement sur l'appareil (qui ne doit jamais bloquer l'interface)
    await effacerRecup(meId).catch(() => {})
  }, [meId])

  // Sur un nouvel appareil : retrouve la clé privée avec la phrase secrète
  const deverrouiller = useCallback(async (phrase) => {
    const k = await api.chatMesCles(token)
    let pkcs8
    try {
      pkcs8 = await deballer(k.emballee, phrase)
    } catch (e) {
      if (!ressembleACode(phrase)) throw e
      pkcs8 = await deballer(k.emballee, normaliserCode(phrase)) // clé de récupération saisie avec ou sans tirets, en minuscules…
    }
    const cle = await importerPrivee(pkcs8, true)
    await ecrirePrivee(meId, cle, k.publicKey)
    prive.current = { cle, publique: k.publicKey }
    autres.current.clear()
    setEtat('actif')
  }, [token, meId])

  const reinitialiser = useCallback(async () => {
    await api.chatReinitialiserCles(token)
    await effacerPrivee(meId).catch(() => {})
    await effacerRecup(meId).catch(() => {})
    prive.current = null
    autres.current.clear()
    setRecup(null)
    essaiAuto.current = false // de nouvelles clés (et une nouvelle clé de récupération) sont créées aussitôt
    setEtat('absent')
  }, [token, meId])

  // Clé publique de l'interlocuteur (null s'il n'a pas activé le chiffrement)
  const clePublique = useCallback(async (idAutre, forcer = false) => {
    const connu = autres.current.get(idAutre)
    if (connu && !forcer) return connu.publique
    const vu = absents.current.get(idAutre)
    if (!forcer && vu && Date.now() - vu < 30000) return null
    try {
      const r = await api.chatCleDe(token, idAutre)
      if (!r.publicKey) throw new Error('pas de clé') // il n'a pas encore ouvert Sam Link
      absents.current.delete(idAutre)
      const ancienne = autres.current.get(idAutre)
      if (!ancienne || ancienne.publique !== r.publicKey) autres.current.set(idAutre, { publique: r.publicKey, cle: null })
      return r.publicKey
    } catch {
      absents.current.set(idAutre, Date.now())
      autres.current.delete(idAutre)
      return null
    }
  }, [token])

  const statutDM = useCallback(async (room, forcer = false) => {
    if (etat === 'absent' || etat === 'indisponible' || etat === 'chargement') return { statut: 'moi-absent' }
    const pub = await clePublique(room.otherId, forcer)
    if (etat === 'verrouille') return { statut: pub ? 'moi-verrouille' : 'moi-absent' }
    if (!pub) return { statut: 'autre-absent' }
    const vue = cleConnue(meId, room.otherId)
    const emp = await empreinte(prive.current.publique, pub)
    if (vue && vue !== pub) return { statut: 'cle-changee', empreinte: emp }
    if (!vue) retenirCle(meId, room.otherId, pub) // première rencontre : on retient la clé
    return { statut: 'chiffre', empreinte: emp }
  }, [etat, clePublique, meId])

  const accepterCle = useCallback(async (room) => {
    const pub = await clePublique(room.otherId, true)
    if (pub) retenirCle(meId, room.otherId, pub)
  }, [clePublique, meId])

  const cleDeLaDiscussion = useCallback(async (room) => {
    if (!prive.current) throw new Error('verrouille')
    const pub = await clePublique(room.otherId)
    if (!pub) throw new Error('autre-absent')
    const entree = autres.current.get(room.otherId)
    if (!entree.cle) entree.cle = await cleDiscussion(prive.current.cle, pub, meId, room.otherId)
    return entree.cle
  }, [clePublique, meId])

  const chiffrerPour = useCallback(async (room, texte) => chiffrer(await cleDeLaDiscussion(room), texte, room.id), [cleDeLaDiscussion])
  const dechiffrerPour = useCallback(async (room, texte) => dechiffrer(await cleDeLaDiscussion(room), texte, room.id), [cleDeLaDiscussion])

  // Fichiers d'une discussion chiffrée : chiffrés avant l'envoi, déchiffrés à la lecture (résultat gardé pendant la session)
  const chiffrerFichierPour = useCallback(async (room, blob) => chiffrerFichier(await cleDeLaDiscussion(room), blob, room.id), [cleDeLaDiscussion])
  const fichiersLus = useRef(new Map()) // id de la pièce jointe -> promesse du fichier déchiffré
  const lireFichierPour = useCallback((room, piece, type) => {
    if (!fichiersLus.current.has(piece.id)) {
      const p = (async () => {
        const rep = await fetch(chatFileUrl(piece.url))
        if (!rep.ok) throw new Error('Fichier indisponible (lien expiré ?)')
        return dechiffrerFichier(await cleDeLaDiscussion(room), await rep.blob(), room.id, type)
      })()
      p.catch(() => fichiersLus.current.delete(piece.id))
      fichiersLus.current.set(piece.id, p)
    }
    return fichiersLus.current.get(piece.id)
  }, [cleDeLaDiscussion])

  // Effacer la clé de cet appareil (ordinateur partagé) : elle se retrouve ensuite avec la clé de récupération
  const oublierAppareil = useCallback(async () => {
    await effacerPrivee(meId).catch(() => {})
    prive.current = null
    autres.current.clear()
    setEtat('verrouille')
  }, [meId])

  return { etat, recup, confirmerRecuperation, regenererRecuperation, lierNouvelAppareil, approuverLiaison, charger, verifierCles, deverrouiller, reinitialiser, statutDM, accepterCle, chiffrerPour, dechiffrerPour, chiffrerFichierPour, lireFichierPour, oublierAppareil }
}
