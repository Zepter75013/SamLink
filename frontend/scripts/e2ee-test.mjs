// Test du chiffrement de bout en bout : node scripts/e2ee-test.mjs
// (utilise uniquement les fonctions pures de src/lib/e2ee.js, sans navigateur)
import assert from 'node:assert/strict'
import { codeLiaison, genererLiaison, emballerPourLiaison, ouvrirLiaison, publiqueDepuisPrivee, formaterCodeLiaison, formaterCle, genererCodeRecuperation, normaliserCode, ressembleACode, genererPaire, emballer, deballer, importerPrivee, cleDiscussion, chiffrer, dechiffrer, empreinte, estChiffre, chiffrerFichier, dechiffrerFichier } from '../src/lib/e2ee.js'

const alice = await genererPaire()
const bob = await genererPaire()

// phrase secrète : ré-emballage, mauvaise phrase refusée
const emb = await emballer(alice.privee, 'une phrase secrète solide', 1000)
assert.equal(emb.includes('une phrase'), false)
const retrouvee = await deballer(emb, 'une phrase secrète solide')
assert.equal(Buffer.from(retrouvee).toString('hex'), Buffer.from(alice.privee).toString('hex'))
await assert.rejects(() => deballer(emb, 'mauvaise phrase'), /incorrecte/)

// les deux interlocuteurs dérivent la même clé et se lisent
const privA = await importerPrivee(alice.privee)
const privB = await importerPrivee(bob.privee)
const cleA = await cleDiscussion(privA, bob.publique, 1, 2)
const cleB = await cleDiscussion(privB, alice.publique, 2, 1)
const c = await chiffrer(cleA, 'Rendez-vous 18h30 au stade — café ☕ ?', 42)
assert.ok(estChiffre(c))
assert.equal(c.includes('stade'), false)
assert.equal(await dechiffrer(cleB, c, 42), 'Rendez-vous 18h30 au stade — café ☕ ?')

// deux chiffrements du même texte diffèrent (IV aléatoire)
assert.notEqual(await chiffrer(cleA, 'a', 42), await chiffrer(cleA, 'a', 42))
// un message ne peut pas être déplacé vers une autre discussion, ni lu par un tiers, ni modifié
await assert.rejects(() => dechiffrer(cleB, c, 43))
const eve = await genererPaire()
const cleE = await cleDiscussion(await importerPrivee(eve.privee), alice.publique, 3, 1)
await assert.rejects(() => dechiffrer(cleE, c, 42))
const altere = c.slice(0, -4) + (c.at(-4) === 'A' ? 'B' : 'A') + c.slice(-3)
await assert.rejects(() => dechiffrer(cleB, altere, 42))

// l'empreinte est la même des deux côtés et change si une clé est substituée
assert.equal(await empreinte(alice.publique, bob.publique), await empreinte(bob.publique, alice.publique))
assert.notEqual(await empreinte(alice.publique, bob.publique), await empreinte(alice.publique, eve.publique))
assert.match(await empreinte(alice.publique, bob.publique), /^\d{5} \d{5} \d{5} \d{5}$/)

// long message
const long = 'é'.repeat(2000)
assert.equal(await dechiffrer(cleB, await chiffrer(cleA, long, 7), 7), long)
// fichiers : aller-retour (petit, vide, plusieurs blocs), contenu illisible sans la clé, altérations détectées
const octets = (n) => { const u = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536))); return u }
const meme = async (a, b) => Buffer.compare(Buffer.from(await a.arrayBuffer()), Buffer.from(await b.arrayBuffer())) === 0
for (const taille of [0, 1, 1000, 1048576, 1048577, 3 * 1048576 + 17]) {
  const src = new Blob([octets(taille)])
  const chiffre = await chiffrerFichier(cleA, src, 9)
  assert.ok(await meme(await dechiffrerFichier(cleB, chiffre, 9, 'image/png'), src), `aller-retour ${taille} octets`)
  if (taille > 100) assert.equal(await meme(chiffre.slice(12, 12 + taille), src.slice(0, taille)), false)
}
const fichier = await chiffrerFichier(cleA, new Blob([octets(2 * 1048576 + 5)]), 9)
assert.equal((await dechiffrerFichier(cleB, fichier, 9, 'image/png')).type, 'image/png')
await assert.rejects(() => dechiffrerFichier(cleB, fichier, 10), undefined, 'autre discussion')
await assert.rejects(() => dechiffrerFichier(cleE, fichier, 9), undefined, 'tiers')
const tronque = fichier.slice(0, 12 + 1048576 + 16) // un seul bloc sur trois : le « dernier bloc » est authentifié
await assert.rejects(() => dechiffrerFichier(cleB, tronque, 9), undefined, 'troncature')
const octetsF = new Uint8Array(await fichier.arrayBuffer())
octetsF[5000] ^= 1
await assert.rejects(() => dechiffrerFichier(cleB, new Blob([octetsF]), 9), undefined, 'altération')
await assert.rejects(() => dechiffrerFichier(cleB, new Blob([new Uint8Array(40)]), 9), /invalide/)

// clé de récupération : format, normalisation (casse, tirets, espaces), usage comme secret d'emballage
const code = genererCodeRecuperation()
assert.match(code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$/)
assert.notEqual(code, genererCodeRecuperation())
assert.equal(normaliserCode(code.toLowerCase().replaceAll('-', ' ')), normaliserCode(code))
assert.ok(ressembleACode(code.toLowerCase()) && !ressembleACode('phrase secrète personnelle'))
const embCode = await emballer(alice.privee, normaliserCode(code), 1000)
const viaMinuscules = await deballer(embCode, normaliserCode(code.toLowerCase().replaceAll('-', '')))
assert.equal(Buffer.from(viaMinuscules).toString('hex'), Buffer.from(alice.privee).toString('hex'))
await assert.rejects(() => deballer(embCode, normaliserCode(genererCodeRecuperation())), /incorrecte/)

// saisie de la clé : majuscules, tiret tous les 4 caractères, 20 au plus, effacement possible, collage
assert.equal(formaterCle('a'), 'A')
assert.equal(formaterCle('abc', 'ab'), 'ABC')
assert.equal(formaterCle('abcd', 'abc'), 'ABCD-')                 // 4e caractère : le tiret arrive tout seul
assert.equal(formaterCle('ABCD-e', 'ABCD-'), 'ABCD-E')
assert.equal(formaterCle('ABCD', 'ABCD-'), 'ABCD')                // effacer le tiret : il n'est pas remis
assert.equal(formaterCle('ABC', 'ABCD'), 'ABC')
assert.equal(formaterCle('abcd-efgh-2345-jklm-pqrs'), 'ABCD-EFGH-2345-JKLM-PQRS')   // collage, minuscules
assert.equal(formaterCle('abcd efgh 2345 jklm pqrs xyz'), 'ABCD-EFGH-2345-JKLM-PQRS') // espaces, trop long
assert.equal(formaterCle('abcdefghjklmnpqrstuv', 'abcdefghjklmnpqrstu'), 'ABCD-EFGH-JKLM-NPQR-STUV') // pas de tiret final
assert.equal(formaterCle('', 'A'), '')
assert.equal(normaliserCode(formaterCle('abcdefghjklmnpqrstuv')), 'ABCDEFGHJKLMNPQRSTUV')
// frappe caractère par caractère d'une clé entière
let champ = ''
for (const c of 'agl f-wslj9qy22hezyds5') champ = formaterCle(champ + c, champ)
assert.equal(champ, 'AGLF-WSLJ-9QY2-2HEZ-YDS5')

// liaison d'un nouvel appareil : la clé de chiffrement passe de l'ancien au nouvel appareil, sans que le serveur puisse la lire
const exportable = await importerPrivee(alice.privee, true)
assert.equal(await publiqueDepuisPrivee(exportable), alice.publique)
const nouveau = await genererLiaison()
const code2 = await codeLiaison(nouveau.publique)
assert.match(code2, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)
assert.equal(await codeLiaison(nouveau.publique), code2)
assert.notEqual(await codeLiaison((await genererLiaison()).publique), code2)
const envoi = await emballerPourLiaison(alice.privee, nouveau.publique, 77)
assert.equal(envoi.blob.includes(Buffer.from(alice.privee).toString('base64').slice(0, 20)), false)
const recu = await ouvrirLiaison(nouveau.privee, nouveau.publique, envoi.publique, envoi.blob, 77)
assert.equal(Buffer.from(recu).toString('hex'), Buffer.from(alice.privee).toString('hex'))
await assert.rejects(() => ouvrirLiaison(nouveau.privee, nouveau.publique, envoi.publique, envoi.blob, 78), undefined, 'autre demande')
const intrus = await genererLiaison()
await assert.rejects(() => ouvrirLiaison(intrus.privee, intrus.publique, envoi.publique, envoi.blob, 77), undefined, 'autre appareil')
assert.equal(formaterCodeLiaison('abcde'), 'ABCDE-')
assert.equal(formaterCodeLiaison('abcdefghjk'), 'ABCDE-FGHJK')
assert.equal(formaterCodeLiaison('abcde-fghjkxyz'), 'ABCDE-FGHJK')

console.log('chiffrement de bout en bout : OK')
