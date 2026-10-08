import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { activerPush, desactiverPush, etatPush } from '../lib/push.js'
import { phraseDelai } from '../lib/notifDelai.js'

// Bloc « Notifications » : activer le push sur cet appareil, et choisir ce qu'on reçoit par notification et par e-mail
// (l'e-mail n'est envoyé que si la discussion n'a pas été lue dans le délai réglé par le club).

const TYPES = [
  { id: 'messages', label: 'Messages reçus', aide: 'Dans les discussions de Sam Link où tu participes.' },
]

const MESSAGES_ETAT = {
  indisponible: "Ce navigateur ne permet pas de recevoir des notifications. Les e-mails restent possibles.",
  'ios-a-installer': "Sur iPhone et iPad, ajoute d'abord Sam Link à ton écran d'accueil (bouton Partager, puis « Sur l'écran d'accueil »), ouvre-le depuis cette icône, puis reviens ici.",
  refuse: "Les notifications sont bloquées pour Sam Link dans ton navigateur. Autorise-les dans les réglages du navigateur (ou du téléphone), puis reviens ici.",
}

export default function NotificationsPanel({ token }) {
  const [prefs, setPrefs] = useState(null)
  const [config, setConfig] = useState(null)
  const [etat, setEtat] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    api.notifPrefs(token).then(setPrefs).catch(() => setMsg({ ok: false, texte: 'Préférences indisponibles pour le moment.' }))
    api.notifConfig(token).then(setConfig).catch(() => setConfig({ push: false }))
    etatPush().then(setEtat).catch(() => setEtat('indisponible'))
  }, [token])

  async function basculerAppareil() {
    setOccupe(true)
    setMsg(null)
    const etape = (texte) => setMsg({ ok: true, texte, enCours: true })
    try {
      if (etat === 'actif') {
        etape('Désactivation…')
        const endpoint = await desactiverPush()
        if (endpoint) await api.notifDesabonner(token, endpoint)
        setEtat('possible')
        setMsg({ ok: true, texte: 'Notifications désactivées sur cet appareil.' })
      } else {
        const abo = await activerPush(config.vapidPublicKey, etape)
        etape('Enregistrement…')
        await api.notifAbonner(token, abo)
        setEtat('actif')
        setMsg({ ok: true, texte: 'Notifications activées sur cet appareil. Clique sur « Tester » pour vérifier.' })
      }
      api.notifPrefs(token).then(setPrefs).catch(() => {}) // nombre d'appareils, sans faire attendre
    } catch (e) {
      setMsg({ ok: false, texte: e.message || 'Impossible de changer ce réglage.' })
      etatPush().then(setEtat).catch(() => setEtat('indisponible'))
    } finally {
      setOccupe(false)
    }
  }

  async function changer(canal, type, valeur) {
    const suivant = { ...prefs, [canal]: { ...prefs[canal], [type]: valeur } }
    setPrefs(suivant)
    try {
      setPrefs(await api.notifSavePrefs(token, { push: suivant.push, mail: suivant.mail }))
    } catch (e) {
      setMsg({ ok: false, texte: e.message || "Le réglage n'a pas pu être enregistré." })
    }
  }

  async function tester() {
    setOccupe(true)
    setMsg(null)
    try {
      const r = await api.notifTest(token)
      setMsg(r.appareils > 0
        ? { ok: true, texte: `Notification d'essai envoyée (${r.appareils} appareil${r.appareils > 1 ? 's' : ''}).` }
        : { ok: false, texte: "Aucun appareil n'a pu être joint : désactive puis réactive les notifications sur cet appareil." })
    } catch (e) {
      setMsg({ ok: false, texte: e.message })
    } finally {
      setOccupe(false)
    }
  }

  const pushDispo = config?.push
  const actif = etat === 'actif'

  return (
    <div className="notif-bloc">
      <span className="eyebrow" style={{ fontWeight: 'bold' }}>Notifications</span>
      <p className="notif-intro">
        Sois prévenu des nouveaux messages.{' '}
        {prefs?.delaiMail === 0
          ? "Le club envoie les e-mails immédiatement."
          : `Un e-mail ne part que si tu n'as pas lu le message ${phraseDelai(prefs?.delaiMail ?? 60)}.`}
      </p>

      <div className="notif-appareil">
        <div>
          <b>Sur cet appareil</b>
          <small>
            {!pushDispo ? "Les notifications push ne sont pas encore activées par le club. Les e-mails fonctionnent."
              : MESSAGES_ETAT[etat] || (actif ? `Activées${prefs?.appareils > 1 ? ` · ${prefs.appareils} appareils au total` : ''}.` : 'Reçois une notification même quand Sam Link est fermé.')}
          </small>
        </div>
        {pushDispo && (etat === 'possible' || etat === 'actif') && (
          <div className="notif-actions">
            {actif && <button type="button" className="btn btn--ghost notif-btn" onClick={tester} disabled={occupe}>Tester</button>}
            <button type="button" className={`btn notif-btn ${actif ? 'btn--ghost' : 'btn--solid'}`} onClick={basculerAppareil} disabled={occupe} aria-busy={occupe}>
              {occupe ? <span className="notif-roue" aria-hidden="true" /> : null}
              {occupe ? 'Un instant…' : actif ? 'Désactiver' : 'Activer'}
            </button>
          </div>
        )}
      </div>

      {prefs && (
        <table className="notif-table">
          <thead>
            <tr><th>Je veux être prévenu…</th><th>Notification</th><th>E-mail</th></tr>
          </thead>
          <tbody>
            {TYPES.map((t) => (
              <tr key={t.id}>
                <td><b>{t.label}</b><small>{t.aide}</small></td>
                <td>
                  <input type="checkbox" checked={!!prefs.push[t.id]} onChange={(e) => changer('push', t.id, e.target.checked)}
                    aria-label={`${t.label} : notification`} disabled={!pushDispo} />
                </td>
                <td>
                  <input type="checkbox" checked={!!prefs.mail[t.id]} onChange={(e) => changer('mail', t.id, e.target.checked)}
                    aria-label={`${t.label} : e-mail`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg && <p className={`notif-msg${msg.ok ? ' is-ok' : ' is-ko'}${msg.enCours ? ' is-encours' : ''}`} role="status">{msg.texte}</p>}
    </div>
  )
}
