import { useEffect, useState } from 'react'
import { Modal } from './ChatRich.jsx'

// Partage de position : un message texte lisible partout (lien OpenStreetMap), affiché comme une carte dans la bulle.
// Dans une discussion chiffrée, il est chiffré comme n'importe quel message.

const ZOOM = 16
const LIEN = /https:\/\/www\.openstreetmap\.org\/\?mlat=(-?\d{1,2}(?:\.\d+)?)&mlon=(-?\d{1,3}(?:\.\d+)?)/

export function textePosition(lat, lon, precision) {
  const la = lat.toFixed(6)
  const lo = lon.toFixed(6)
  const env = precision ? ` (à ${Math.round(precision)} m près)` : ''
  return `📍 Ma position${env}\nhttps://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}`
}

// Position contenue dans un message (null si ce n'en est pas une)
export function lirePosition(texte) {
  if (typeof texte !== 'string' || !texte.startsWith('📍')) return null
  const m = texte.match(LIEN)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null
  return { lat, lon, titre: texte.split('\n')[0].replace(/^📍\s*/, '') }
}

// Tuiles OpenStreetMap autour du point (3 × 3), le point au centre
function Carte({ lat, lon, hauteur = 150 }) {
  const n = 2 ** ZOOM
  const x = ((lon + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  const dx = (x - tx) * 256
  const dy = (y - ty) * 256
  const tuiles = []
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) tuiles.push([i, j])
  return (
    <div className="chat-carte" style={{ height: hauteur }}>
      <div className="chat-carte__tuiles" style={{ marginLeft: -(256 + dx), marginTop: -(256 + dy) }}>
        {tuiles.map(([i, j]) => (
          <img key={`${i}${j}`} alt="" loading="lazy" draggable="false" style={{ left: (i + 1) * 256, top: (j + 1) * 256 }}
            src={`https://tile.openstreetmap.org/${ZOOM}/${tx + i}/${ty + j}.png`} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        ))}
      </div>
      <span className="chat-carte__pin" aria-hidden="true">📍</span>
      <small className="chat-carte__credit">© OpenStreetMap</small>
    </div>
  )
}

export function CartePosition({ pos }) {
  const q = `${pos.lat},${pos.lon}`
  return (
    <div className="chat-position">
      <a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer" aria-label="Ouvrir la position dans une carte">
        <Carte lat={pos.lat} lon={pos.lon} />
      </a>
      <b className="chat-position__titre">📍 {pos.titre || 'Position'}</b>
      <span className="chat-position__liens">
        <a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer">Google Maps</a>
        <a href={`https://maps.apple.com/?q=${q}&ll=${q}`} target="_blank" rel="noreferrer">Plans</a>
        <a href={`https://waze.com/ul?ll=${q}&navigate=yes`} target="_blank" rel="noreferrer">Waze</a>
      </span>
    </div>
  )
}

// Fenêtre « Envoyer ma position » : localisation par le navigateur, aperçu, envoi
export function ModalPosition({ onSend, onClose }) {
  const [pos, setPos] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!navigator.geolocation) { setErr("Ce navigateur ne sait pas donner ta position."); return undefined }
    let fini = false
    const id = navigator.geolocation.watchPosition(
      (p) => { if (!fini) { setPos({ lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy }); setErr('') } },
      (e) => { if (!fini) setErr(e.code === 1 ? "Accès à la position refusé : autorise-le pour ce site dans les réglages du navigateur (ou du téléphone)." : 'Position introuvable pour le moment, réessaie dehors ou avec le Wi-Fi activé.') },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
    )
    return () => { fini = true; navigator.geolocation.clearWatch(id) }
  }, [])
  async function envoyer() {
    setBusy(true)
    try {
      await onSend(textePosition(pos.lat, pos.lon, pos.precision))
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <Modal titre="Envoyer ma position" onClose={onClose}>
      {err && <p className="chat-error">{err}</p>}
      {!pos && !err && <p className="chat-empty">Recherche de ta position…</p>}
      {pos && (
        <>
          <Carte lat={pos.lat} lon={pos.lon} hauteur={200} />
          <p className="chat-count">Précision : environ {Math.round(pos.precision)} m</p>
        </>
      )}
      <button type="button" className="btn btn--solid chat-create" disabled={!pos || busy} onClick={envoyer}>
        {busy ? 'Envoi…' : 'Envoyer ma position actuelle'}
      </button>
    </Modal>
  )
}
