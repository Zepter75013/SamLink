# Chiffrement de bout en bout des messages privés

Les messages privés entre deux adhérents peuvent être chiffrés **dans leur navigateur** : le serveur, la base de données,
les sauvegardes et l'administrateur ne voient que du texte chiffré (`e2ee:v1:…`).

## Fonctionnement

- Le chiffrement s'**active automatiquement**, sans rien demander (comme WhatsApp), à la première ouverture de
  Sam Link : le navigateur crée une paire de clés ECDH P-256. La clé **publique** est enregistrée sur le serveur (table
  `member_keys`) ; la clé **privée** est chiffrée par une **clé de récupération** générée au hasard (20 caractères, 100 bits)
  — avec PBKDF2-SHA256 600 000 tours + AES-GCM, avant d'être
  confiée au serveur, qui ne peut pas la lire. Sur l'appareil, la clé privée est gardée dans IndexedDB sous forme non
  exportable. L'adhérent est invité à noter sa clé de récupération (affichée une seule fois) ; elle ne sert qu'à
  retrouver ses messages sur un autre appareil ou navigateur. Sur un ordinateur partagé, « Effacer la clé de cet
  appareil » (Gérer) retire la clé privée du navigateur ; la déconnexion, elle, la conserve (sinon il faudrait saisir la
  clé de récupération à chaque connexion).
- Pour une discussion privée, chacun calcule le même secret (ECDH entre sa clé privée et la clé publique de l'autre),
  dont on tire (HKDF) une clé AES-GCM 256. Chaque message a un IV aléatoire ; l'identifiant de la discussion est
  authentifié avec lui (un message ne peut pas être déplacé dans une autre discussion).
- La discussion est chiffrée quand **les deux** adhérents ont activé le chiffrement. Le serveur refuse alors tout
  message en clair (409), ainsi que les fichiers non chiffrés, les sondages et les événements (que le serveur verrait).
  Sinon, la discussion reste en clair et un cadenas « Non chiffré » le signale.
- **Pièces jointes** : chaque fichier est chiffré par le navigateur de l'expéditeur, par blocs de 1 Mo (AES-GCM, IV propre
  à chaque bloc, rang et « dernier bloc » authentifiés : pas de réordonnancement ni de troncature). Le serveur reçoit des
  fichiers binaires anonymes (`fichier-chiffre`, `application/octet-stream`). Le **nom, le type, la taille et la légende**
  sont dans une description chiffrée placée dans le corps du message. Le destinataire revérifie cette description (type et
  extension cohérents, liste blanche de types : photos, vidéos, PDF, documents Office, texte, GPX…) avant d'afficher ou
  d'enregistrer un fichier ; les photos sont déchiffrées à l'affichage, les vidéos et documents à la demande.
- Les notifications (push, e-mail) d'un message chiffré affichent « 🔒 Message chiffré », jamais son contenu.
- **Vérification** : le cadenas de la discussion affiche une **empreinte** de 20 chiffres, identique des deux côtés, à
  comparer de vive voix. Une clé qui change (nouvel appareil après réinitialisation, ou usurpation) bloque l'envoi
  jusqu'à ce que l'adhérent accepte la nouvelle empreinte.

## Ce que ça protège, et ce que ça ne protège pas

- ✔ Lecture des messages par l'administrateur de la base, par une fuite ou un vol de sauvegarde.
- ✔ Le bureau (même avec le droit « Modérer la messagerie », qui ne permet que de supprimer).
- ✔ Les **anciens messages privés** sont chiffrés à leur tour : à l'ouverture d'une discussion devenue chiffrée, le navigateur
  de chaque adhérent chiffre ses propres messages restés en clair (et le bouton « Chiffrer mes anciens messages privés »,
  dans Gérer, le fait pour toutes ses discussions). Tant que l'interlocuteur n'a pas activé le chiffrement, la discussion
  reste en clair. Les **pièces jointes** envoyées avant l'activation restent, elles, en clair.
- ✔ Un message **supprimé** est maintenant effacé de la base (avant, il n'était que masqué : son texte restait lisible).
- ✘ Les salons de groupe ne sont **pas** chiffrés.
- ✘ Les métadonnées restent visibles du serveur : qui écrit à qui, quand, la taille des messages et des fichiers, le nombre
  de pièces jointes, la présence.
- ✘ Les **sondages et événements** ne sont pas disponibles dans une discussion chiffrée.
- ✘ Le serveur ne peut pas vérifier le type d'un fichier chiffré (il ne le voit pas) : c'est le navigateur du
  destinataire qui le contrôle. Un fichier est déchiffré en mémoire : les très gros fichiers (vidéos de 100 Mo) sont lourds
  sur un vieux téléphone.
- ✘ Pas de « secret d'avance » (clés durables) : si la clé privée d'un adhérent fuit, ses messages passés et futurs de
  ces discussions sont lisibles. Générer une nouvelle clé de récupération ne change pas la clé de chiffrement ; **repartir de zéro** en crée une nouvelle.
- ✘ Un serveur malveillant pourrait substituer une clé publique la première fois : comparer l'empreinte pour les
  échanges sensibles.

## Lier un nouvel appareil (sans clé de récupération)

Deux possibilités existent pour déverrouiller un nouvel appareil : la **clé de récupération**, ou la **liaison** depuis un
appareil déjà déverrouillé (comme le QR code de WhatsApp).

1. Le nouvel appareil crée une paire de clés ECDH éphémère, dépose sa clé publique sur le serveur (`device_links`, migration
   0034, demande valable 5 minutes) et affiche un code de 10 caractères = 50 bits de `SHA-256(clé publique éphémère)`.
2. L'adhérent saisit ce code sur l'appareil déverrouillé. Celui-ci lit ses demandes en attente et retient celle dont la clé
   publique donne exactement ce code : le serveur ne peut donc pas y substituer une autre clé (il faudrait trouver une clé
   dont le condensé commence par les mêmes 50 bits).
3. L'appareil déverrouillé chiffre sa clé de chiffrement (AES-GCM, clé dérivée par ECDH + HKDF entre sa propre paire
   éphémère et celle du nouvel appareil, numéro de demande authentifié) et dépose le résultat. Le serveur ne fait que
   transmettre un message qu'il ne peut pas lire.
4. Le nouvel appareil le déchiffre, vérifie que la clé obtenue correspond à la clé publique du compte, la range dans
   IndexedDB et supprime la demande.

Seul un appareil dont la clé est exportable (créée à partir de la v1.53.3) peut en lier un autre ; sinon, utiliser la clé de
récupération.

## Clé de récupération perdue

Elle ne peut être récupérée par personne, mais **un appareil déverrouillé peut en générer une nouvelle** (Gérer › Générer une
nouvelle clé de récupération) : la clé privée de l'appareil, gardée exportable dans IndexedDB pour cet usage, est ré-emballée
par la nouvelle clé ; l'historique est conservé, l'ancienne clé ne fonctionne plus. (Les clés créées avant la v1.53.3 sont
non exportables : pour elles, il faut repartir de zéro.) Tant que l'adhérent a son appareil déverrouillé, il lit ses messages ; sur un
nouvel appareil, sans la clé, il ne peut pas. Il peut **repartir de zéro** (Gérer) : de nouvelles clés et une nouvelle clé
de récupération sont créées, les messages déjà chiffrés deviennent illisibles pour tous.

## Mise en service

1. Migrations `backend/migrations/0032_chiffrement.sql` (table `member_keys`), `0033_effacer_supprimes.sql` (efface le
   texte des messages déjà supprimés) et `0034_liaisons.sql` (table `device_links`).
2. `docker compose up -d --build`.
3. Test de la cryptographie : `cd frontend && npm run test:e2ee`.

Le navigateur doit offrir WebCrypto et IndexedDB (HTTPS requis hors `localhost`). Sinon le bandeau n'apparaît pas et les
messages restent en clair.

## Vérifier ce que contient la base

```sql
-- messages encore en clair, par type de discussion (dm = message privé, auto/custom = salons de groupe)
SELECT r.kind, SUM(m.body LIKE 'e2ee:v1:%') AS chiffres, SUM(m.body NOT LIKE 'e2ee:v1:%') AS en_clair
FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id
WHERE m.deleted_at IS NULL AND m.kind = 'text' GROUP BY r.kind;

-- adhérents qui ont activé le chiffrement
SELECT m.nom, m.prenom, k.created_at FROM member_keys k JOIN members m ON m.id = k.member_id;

-- messages privés encore en clair, par discussion (les deux adhérents ont-ils activé le chiffrement ?)
SELECT m.room_id, COUNT(*) AS en_clair FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id
WHERE r.kind = 'dm' AND m.deleted_at IS NULL AND m.kind = 'text' AND m.body NOT LIKE 'e2ee:v1:%' GROUP BY m.room_id;
```

Un message reste en clair dans l'un de ces cas : salon de groupe (jamais chiffré), discussion privée dont un des deux adhérents
n'a pas activé le chiffrement, ou message ancien dont l'auteur n'a pas encore rouvert la discussion depuis l'activation.
