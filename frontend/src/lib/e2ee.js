// Chiffrement de bout en bout des messages privés (WebCrypto, rien d'autre que le navigateur).
//
//  - Chaque adhérent a une paire de clés ECDH P-256. La clé publique est envoyée au serveur ; la clé privée n'en sort JAMAIS en
//    clair : elle est chiffrée ici par une « phrase secrète » (PBKDF2-SHA256 600 000 tours + AES-GCM) avant d'être confiée au
//    serveur, pour qu'on puisse la retrouver sur un autre appareil. Sur l'appareil, elle est gardée dans IndexedDB sous une forme
//    non exportable.
//  - Pour une discussion privée, les deux adhérents calculent le même secret (ECDH entre ma clé privée et sa clé publique), dont
//    on tire (HKDF) une clé AES-GCM 256. Chaque message est chiffré avec un vecteur aléatoire (IV) ; l'identifiant de la
//    discussion est authentifié avec lui, un message ne peut donc pas être déplacé vers une autre discussion.
//  - Le serveur ne voit que du texte chiffré préfixé « e2ee:v1: ».
// Limite assumée : clés durables (pas de « secret d'avance » comme Signal). Vérifier l'empreinte protège d'une clé substituée.

const PREFIXE = 'e2ee:v1:'
const ITERATIONS = 600000
const enc = new TextEncoder()
const dec = new TextDecoder()
const subtle = () => globalThis.crypto.subtle

export const estChiffre = (t) => typeof t === 'string' && t.startsWith(PREFIXE)
export const e2eeDisponible = () => typeof globalThis.crypto !== 'undefined' && !!globalThis.crypto.subtle && typeof indexedDB !== 'undefined'

function versB64(buf) {
  const u = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000))
  return btoa(s)
}
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// Paire de clés d'un adhérent : clé publique (base64, 65 octets) et clé privée (PKCS8)
export async function genererPaire() {
  const paire = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  return {
    publique: versB64(await subtle().exportKey('raw', paire.publicKey)),
    privee: await subtle().exportKey('pkcs8', paire.privateKey),
  }
}

async function cleDePhrase(phrase, sel, iterations) {
  const base = await subtle().importKey('raw', enc.encode(phrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// Clé privée chiffrée par la phrase secrète (texte JSON à confier au serveur)
export async function emballer(privee, phrase, iterations = ITERATIONS) {
  const sel = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const cle = await cleDePhrase(phrase, sel, iterations)
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, cle, privee)
  return JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', it: iterations, sel: versB64(sel), iv: versB64(iv), ct: versB64(ct) })
}

// Retrouve la clé privée (PKCS8) ; échoue (« Phrase secrète incorrecte ») si la phrase n'est pas la bonne
export async function deballer(emballee, phrase) {
  const o = JSON.parse(emballee)
  const cle = await cleDePhrase(phrase, deB64(o.sel), o.it)
  try {
    return await subtle().decrypt({ name: 'AES-GCM', iv: deB64(o.iv) }, cle, deB64(o.ct))
  } catch {
    throw new Error('Clé de récupération ou phrase secrète incorrecte.')
  }
}

// Clé privée utilisable mais non exportable (celle qui reste sur l'appareil)
// exportable : la clé gardée sur l'appareil peut être ré-emballée avec une nouvelle clé de récupération (« Gérer »). Elle ne quitte
// jamais l'appareil autrement : le serveur ne reçoit que la version emballée.
export const importerPrivee = (pkcs8, exportable = false) => subtle().importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, exportable, ['deriveBits'])
export const exporterPrivee = (cle) => subtle().exportKey('pkcs8', cle)

// Clé AES de la discussion entre deux adhérents (la même des deux côtés)
export async function cleDiscussion(privee, publiqueAutreB64, idA, idB) {
  const pub = await subtle().importKey('raw', deB64(publiqueAutreB64), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const bits = await subtle().deriveBits({ name: 'ECDH', public: pub }, privee, 256)
  const hkdf = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  const [a, b] = [idA, idB].sort((x, y) => x - y)
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(`samparis12-dm:${a}:${b}`), info: enc.encode('samparis12-e2ee-v1') },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const aad = (roomId) => enc.encode(`dm:${roomId}`)

export async function chiffrer(cle, texte, roomId) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(roomId) }, cle, enc.encode(texte)))
  const tout = new Uint8Array(iv.length + ct.length)
  tout.set(iv)
  tout.set(ct, iv.length)
  return PREFIXE + versB64(tout)
}

export async function dechiffrer(cle, chiffre, roomId) {
  const tout = deB64(chiffre.slice(PREFIXE.length))
  const clair = await subtle().decrypt({ name: 'AES-GCM', iv: tout.slice(0, 12), additionalData: aad(roomId) }, cle, tout.slice(12))
  return dec.decode(clair)
}

// Empreinte à comparer de vive voix : 20 chiffres tirés des deux clés publiques (identique des deux côtés)
export async function empreinte(pubA, pubB) {
  const [a, b] = [pubA, pubB].sort()
  const h = new Uint8Array(await subtle().digest('SHA-256', enc.encode(`${a}|${b}`)))
  let n = 0n
  for (let i = 0; i < 9; i++) n = (n << 8n) | BigInt(h[i])
  const chiffres = (n % 10n ** 20n).toString().padStart(20, '0')
  return chiffres.match(/.{5}/g).join(' ')
}

// ---- Fichiers : chiffrés par blocs de 1 Mo (AES-GCM), chacun avec son propre IV et son rang authentifiés ----
// Format : « E2F1 » + 8 octets aléatoires, puis les blocs chiffrés (1 Mo + 16 octets d'étiquette ; le dernier peut être plus court).
// Le rang du bloc et la mention « dernier bloc » sont authentifiés : un fichier ne peut être ni réordonné ni tronqué.
const BLOC = 1 << 20
const MAGIE = [0x45, 0x32, 0x46, 0x31]
const aadFichier = (roomId, rang, dernier) => enc.encode(`file:${roomId}:${rang}:${dernier ? 1 : 0}`)
function ivBloc(prefixe, rang) {
  const iv = new Uint8Array(12)
  iv.set(prefixe)
  new DataView(iv.buffer).setUint32(8, rang)
  return iv
}

export async function chiffrerFichier(cle, blob, roomId) {
  const prefixe = globalThis.crypto.getRandomValues(new Uint8Array(8))
  const entete = new Uint8Array(12)
  entete.set(MAGIE)
  entete.set(prefixe, 4)
  const parts = [entete]
  const n = Math.max(1, Math.ceil(blob.size / BLOC))
  for (let i = 0; i < n; i++) {
    const clair = await blob.slice(i * BLOC, (i + 1) * BLOC).arrayBuffer()
    parts.push(new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: ivBloc(prefixe, i), additionalData: aadFichier(roomId, i, i === n - 1) }, cle, clair)))
  }
  return new Blob(parts, { type: 'application/octet-stream' })
}

export async function dechiffrerFichier(cle, blob, roomId, type = 'application/octet-stream') {
  const entete = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  if (entete.length < 12 || MAGIE.some((o, i) => entete[i] !== o)) throw new Error('fichier chiffré invalide')
  const prefixe = entete.slice(4, 12)
  const taille = BLOC + 16
  const n = Math.max(1, Math.ceil((blob.size - 12) / taille))
  const parts = []
  for (let i = 0; i < n; i++) {
    const bloc = await blob.slice(12 + i * taille, 12 + (i + 1) * taille).arrayBuffer()
    parts.push(new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: ivBloc(prefixe, i), additionalData: aadFichier(roomId, i, i === n - 1) }, cle, bloc)))
  }
  return new Blob(parts, { type })
}

// ---- Liaison d'un nouvel appareil (comme le QR code de WhatsApp) ----
// Le nouvel appareil crée une paire de clés éphémère et affiche un code court calculé à partir de sa clé publique. L'adhérent saisit
// ce code sur un appareil déjà déverrouillé : celui-ci retrouve la demande dont la clé publique donne ce code (le serveur ne peut donc
// pas y glisser une autre clé), puis envoie sa clé de chiffrement chiffrée pour la clé éphémère du nouvel appareil.
const SEL_LIAISON = 'samparis12-liaison'

export async function genererLiaison() {
  const paire = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  return { privee: paire.privateKey, publique: versB64(await subtle().exportKey('raw', paire.publicKey)) }
}

// Code à saisir sur l'ancien appareil : 50 bits tirés de la clé publique éphémère (10 caractères)
export async function codeLiaison(pubB64) {
  const h = new Uint8Array(await subtle().digest('SHA-256', enc.encode(`${SEL_LIAISON}:${pubB64}`)))
  let n = 0n
  for (let i = 0; i < 7; i++) n = (n << 8n) | BigInt(h[i])
  n >>= 6n // 56 bits -> 50 bits
  let c = ''
  for (let i = 0; i < 10; i++) { c = ALPHABET[Number(n & 31n)] + c; n >>= 5n }
  return `${c.slice(0, 5)}-${c.slice(5)}`
}

async function cleLiaison(priveeCle, pubAutreB64, id, pubNouveau, pubAncien) {
  const pub = await subtle().importKey('raw', deB64(pubAutreB64), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const bits = await subtle().deriveBits({ name: 'ECDH', public: pub }, priveeCle, 256)
  const hkdf = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(`${SEL_LIAISON}:${id}`), info: enc.encode(`${pubNouveau}|${pubAncien}`) },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// Ancien appareil : chiffre la clé de chiffrement (PKCS8) pour le nouvel appareil
export async function emballerPourLiaison(pkcs8, pubNouveauB64, id) {
  const eph = await genererLiaison()
  const cle = await cleLiaison(eph.privee, pubNouveauB64, id, pubNouveauB64, eph.publique)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`liaison:${id}`) }, cle, pkcs8))
  const tout = new Uint8Array(iv.length + ct.length)
  tout.set(iv)
  tout.set(ct, iv.length)
  return { publique: eph.publique, blob: versB64(tout) }
}

// Nouvel appareil : retrouve la clé de chiffrement (PKCS8) envoyée par l'ancien
export async function ouvrirLiaison(priveeNouveau, pubNouveauB64, pubAncienB64, blob, id) {
  const cle = await cleLiaison(priveeNouveau, pubAncienB64, id, pubNouveauB64, pubAncienB64)
  const tout = deB64(blob)
  return subtle().decrypt({ name: 'AES-GCM', iv: tout.slice(0, 12), additionalData: enc.encode(`liaison:${id}`) }, cle, tout.slice(12))
}

// Clé publique (base64, 65 octets) d'une clé privée exportable : sert à vérifier qu'une clé reçue est bien celle du compte
export async function publiqueDepuisPrivee(cle) {
  const jwk = await subtle().exportKey('jwk', cle)
  const b = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  const raw = new Uint8Array(65)
  raw[0] = 4
  raw.set(b(jwk.x), 1)
  raw.set(b(jwk.y), 33)
  return versB64(raw)
}

// ---- Stockage de la clé privée sur l'appareil (IndexedDB, forme non exportable) ----
const BASE = 'samparis12-e2ee'
const MAGASIN = 'cles'
function ouvrir() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(MAGASIN)
    r.onsuccess = () => ok(r.result)
    r.onerror = () => ko(r.error)
  })
}
async function acces(mode, fn) {
  const db = await ouvrir()
  try {
    return await new Promise((ok, ko) => {
      const tx = db.transaction(MAGASIN, mode)
      const req = fn(tx.objectStore(MAGASIN))
      tx.oncomplete = () => ok(req && req.result)
      tx.onerror = () => ko(tx.error)
    })
  } finally {
    db.close()
  }
}
export const lirePrivee = (idAdherent) => acces('readonly', (s) => s.get(`prive:${idAdherent}`)) // { cle, publique } ou undefined
export const ecrirePrivee = (idAdherent, cle, publique) => acces('readwrite', (s) => s.put({ cle, publique }, `prive:${idAdherent}`))
export const effacerPrivee = (idAdherent) => acces('readwrite', (s) => s.delete(`prive:${idAdherent}`))

// ---- Clé de récupération : générée automatiquement à l'activation (100 bits), elle remplace la phrase secrète à inventer ----
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sans I, O, 0, 1 : pas de confusion à la recopie
export function genererCodeRecuperation() {
  const o = globalThis.crypto.getRandomValues(new Uint8Array(20))
  const c = Array.from(o, (x) => ALPHABET[x % 32]).join('')
  return c.match(/.{4}/g).join('-')
}
// Saisie de la clé de récupération : majuscules seulement, un « - » ajouté tout seul après chaque groupe de 4 caractères, 20 au plus.
// `precedent` est le texte avant la frappe : en effaçant, le tiret de fin n'est pas remis (sinon on ne pourrait plus l'effacer).
export function formaterGroupes(saisie, precedent = '', taille = 4, max = 20) {
  const chars = String(saisie).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max)
  const efface = String(saisie).length < String(precedent).length
  let out = (chars.match(new RegExp(`.{1,${taille}}`, 'g')) || []).join('-')
  if (!efface && chars.length > 0 && chars.length < max && chars.length % taille === 0) out += '-'
  return out
}
export const formaterCle = (saisie, precedent = '') => formaterGroupes(saisie, precedent, 4, 20)
export const formaterCodeLiaison = (saisie, precedent = '') => formaterGroupes(saisie, precedent, 5, 10)
export const normaliserCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const ressembleACode = (s) => /^[A-Z2-9]{20}$/.test(normaliserCode(s))

// Code à sauvegarder, gardé sur l'appareil seulement jusqu'à ce que l'adhérent confirme l'avoir noté
export const lireRecup = (idAdherent) => acces('readonly', (s) => s.get(`recup:${idAdherent}`))
export const ecrireRecup = (idAdherent, code) => acces('readwrite', (s) => s.put(code, `recup:${idAdherent}`))
export const effacerRecup = (idAdherent) => acces('readwrite', (s) => s.delete(`recup:${idAdherent}`))

// ---- Clés des interlocuteurs déjà vues (première rencontre : on les retient ; si elles changent, on prévient) ----
const cleTofu = (moi) => `samparis12_e2ee_tofu:${moi}`
export function cleConnue(moi, autre) {
  try { return JSON.parse(localStorage.getItem(cleTofu(moi)) || '{}')[autre] || null } catch { return null }
}
export function retenirCle(moi, autre, publique) {
  try {
    const m = JSON.parse(localStorage.getItem(cleTofu(moi)) || '{}')
    m[autre] = publique
    localStorage.setItem(cleTofu(moi), JSON.stringify(m))
  } catch { /* navigation privée : la clé ne sera pas retenue */ }
}
