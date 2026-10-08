import { useEffect, useState } from 'react'
import { chatFileUrl } from '../lib/api.js'
import { Modal } from './ChatRich.jsx'

// Photo d'un salon : l'image choisie est recadrée au carré (centre) et réduite à 512 px dans le navigateur avant l'envoi.

const COTE = 512

async function recadrer(fichier) {
  const url = URL.createObjectURL(fichier)
  try {
    const img = await new Promise((ok, ko) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => ko(new Error("Cette image n'a pas pu être lue (choisis une photo JPEG, PNG ou WebP)."))
      i.src = url
    })
    const c = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = Math.min(COTE, c)
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - c) / 2, (img.naturalHeight - c) / 2, c, c, 0, 0, canvas.width, canvas.height)
    return await new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('Conversion de la photo impossible.'))), 'image/jpeg', 0.86))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ModalPhotoSalon({ room, onSave, onClose }) {
  const [blob, setBlob] = useState(null)
  const [apercu, setApercu] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => () => { if (apercu) URL.revokeObjectURL(apercu) }, [apercu])

  async function choisir(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErr('')
    try {
      const b = await recadrer(f)
      setBlob(b)
      setApercu(URL.createObjectURL(b))
    } catch (x) { setErr(x.message) }
  }
  async function enregistrer(b) {
    setBusy(true)
    setErr('')
    try {
      await onSave(b)
      onClose()
    } catch (x) { setErr(x.message); setBusy(false) }
  }
  const actuelle = apercu || (room.photoUrl ? chatFileUrl(room.photoUrl) : '')
  return (
    <Modal titre="Photo du salon" onClose={onClose}>
      <div className="chat-photo-salon">
        {actuelle
          ? <img className="chat-photo-salon__img" src={actuelle} alt="" />
          : <span className="chat-photo-salon__img chat-avatar--groupe">👥</span>}
        <b>{room.nom}</b>
        {err && <p className="chat-error">{err}</p>}
        <label className="btn btn--ghost chat-photo-salon__choisir">
          {room.photoUrl || apercu ? 'Choisir une autre photo' : 'Choisir une photo'}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/*" onChange={choisir} hidden />
        </label>
        {blob && (
          <button type="button" className="btn btn--solid chat-create" disabled={busy} onClick={() => enregistrer(blob)}>
            {busy ? 'Enregistrement…' : 'Enregistrer la photo'}
          </button>
        )}
        {!blob && room.photoUrl && (
          <button type="button" className="chat-photo-salon__retirer" disabled={busy} onClick={() => enregistrer(null)}>Retirer la photo</button>
        )}
        <small>La photo est visible par tous les participants du salon.</small>
      </div>
    </Modal>
  )
}
