# Sam Link — messagerie du SAM Paris 12

Application autonome de messagerie pour les adhérents du club, extraite de la messagerie de la refonte
samparis12.org (dossier `SamParis12`). Même principe de structure : un backend Go, un frontend React, une base MySQL.

Sam Link s'appuie sur la base réelle du club, **SamProd26db** : les adhérents sont ceux de la table `profil`,
et la connexion se fait avec l'e-mail et le mot de passe du site du club. Sam Link **ne modifie aucune table du club** :
il lit `profil` et `adhesion` à travers une vue, et range ses propres données dans des tables à lui.

## Fonctions

Salons automatiques (Tous les adhérents, Running, Marche nordique, Bureau), salons créés, messages privés, réponses,
modification et suppression, archivage, lus / non lus, pièces jointes (photos, vidéos, documents), sondages,
événements avec réponses, présence en ligne, notifications push et e-mail, chiffrement de bout en bout des messages
privés (voir [docs/chiffrement-messages-prives.md](docs/chiffrement-messages-prives.md)). Application installable
(PWA) sur téléphone.

## Stack

- **Backend** : Go (stdlib `net/http`), MySQL (`go-sql-driver/mysql`), temps réel par SSE
- **Frontend** : React + Vite, CSS repris de SamParis12 (`frontend/src/index.css`)
- **Base** : SamProd26db (MySQL), tables du club en lecture seule + tables de Sam Link

## Lien avec la base du club

| Sam Link | SamProd26db |
|---|---|
| adhérent | `profil.id_profil` |
| prénom, nom, sexe | `profil.prenom`, `profil.nom`, `profil.sexe` |
| connexion | `profil.email` + `profil.mdpCrypte` (bcrypt `$2y$`) — la colonne `mdp` n'est jamais lue |
| photo | `profil.photo` (chemin `../Contenus/uploads/profils/…`), affichée depuis `PHOTOS_BASE_URL` |
| adhérent actif | une adhésion validée pour la saison en cours : `adhesion.saison` = saison, `adhesion.statutAdhesion = 'V'` |
| groupe | `adhesion.activite` de la saison : RU, RF → Running ; MS, ML → Marche nordique |
| bureau | `profil.idRole` dans `BUREAU_ROLES` (9, « Gentil Organisateur », pour le moment) |

Tout cela est défini à un seul endroit, la vue `samlink_membres` (`backend/internal/annuaire/annuaire.go`), recréée à
chaque démarrage de l'API avec les réglages du `.env`.

**Saison** : 2027 désigne 2026-2027. Elle change le 1er septembre (`SAISON_MOIS_DEBUT=9`) ; on peut aussi la fixer avec
`SAISON=2027`. Un adhérent qui n'a pas encore renouvelé à la rentrée n'a plus accès à Sam Link jusqu'à la validation de
son adhésion.

> Pourquoi `adhesion` plutôt que `profil.derniereAdhesion` : dans la copie du 7 octobre 2026, seules 6 fiches ont
> `derniereAdhesion = 2027`, alors que la table `adhesion` compte 665 adhésions validées pour 2027. Si
> `derniereAdhesion` est tenue à jour dans SamProd26db, il suffit de changer la condition dans la vue.

**Droits** : le bureau peut créer des salons et modérer (supprimer les messages des autres). Pour donner ces droits à un
autre adhérent :

```sql
INSERT INTO chat_droits (member_id, creer_salons, moderer) VALUES (<id_profil>, 1, 0)
  ON DUPLICATE KEY UPDATE creer_salons = VALUES(creer_salons), moderer = VALUES(moderer);
```

**Tables ajoutées** (migration `backend/migrations/0001_samlink.sql`) : `chat_rooms`, `chat_room_members`,
`chat_messages`, `chat_reads`, `chat_room_prefs`, `chat_attachments`, `chat_polls`, `chat_poll_options`,
`chat_poll_votes`, `chat_events`, `chat_event_rsvps`, `chat_droits`, `notif_prefs`, `push_subscriptions`,
`notifications`, `member_presence`, `member_keys`, `device_links`, plus la vue `samlink_membres`. Leurs clés étrangères
pointent vers `profil(id_profil)` (suppression d'une fiche = suppression de ses messages).

## Développement local

Comme pour SamParis12, le développement se fait **sans Docker**, avec le serveur MySQL local qui héberge SamProd26db.

1. Créer le fichier `backend/.env` (non versionné) à partir de [.env.example](.env.example) : identifiants de
   SamProd26db, `JWT_SECRET`, et `PHOTOS_BASE_URL` (ex. `https://www.samparis12.org`, laisser vide pour afficher des
   initiales).
2. Créer les tables de Sam Link et la vue (une seule fois, sans risque si relancé) :

   ```bash
   cd backend
   go run ./cmd/migrate
   ```

3. Démarrer l'API (port 8080) :

   ```bash
   go run ./cmd/api
   ```

   Au démarrage, le journal indique le nombre d'adhérents actifs trouvés pour la saison.

4. Dans un autre terminal, le frontend (http://localhost:5173) :

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   Le frontend appelle `http://localhost:8080/api` (modifiable dans `frontend/.env.local` avec `VITE_API_BASE_URL`).

Les pièces jointes sont enregistrées dans `backend/uploads/chat/` (non versionné).

## Notifications push

Générer une fois les clés VAPID (`cd backend && go run ./cmd/vapid`) et les recopier dans le `.env`. Sans clés, seuls les
e-mails partent (il faut alors le SMTP). Le délai avant l'e-mail d'un message non lu se règle avec
`NOTIF_DELAI_EMAIL_MIN` (60 minutes par défaut).

## Versions

Le numéro de version et l'historique des nouveautés sont dans `frontend/src/version.js` (comme SamParis12) : ajouter
une entrée en haut de `CHANGELOG` à chaque changement notable. Ils s'affichent dans la fenêtre « À propos » du menu ☰
et sous la page de connexion.

## Déploiement (NAS)

Comme SamParis12 : Docker Compose sur le NAS, sur le réseau `disques-manager_disques-network`, avec la base dans le
conteneur MySQL partagé `bdd-mysql`. Adresse publique : https://samlink.juliotte-app.fr ; le proxy inverse du NAS envoie ce nom
vers `http://localhost:8098` (frontend ; l'API répond aussi en direct sur 8097). Les ports 8091 à 8096 sont déjà pris
par Finance, SamParis12 et Fouléesdu12.

1. Envoyer les fichiers depuis le Mac (comme Fouléesdu12) :

   ```bash
   rsync -avz --delete -e "ssh -p 2222" --include='.env.example' --exclude='.env' --exclude='.env.*' --exclude='frontend/node_modules/' --exclude='frontend/dist/' --exclude='.git/' --exclude='.claude/' --exclude='/chat-files/' --exclude='backend/uploads/' --exclude='.*.tgz' --exclude='.DS_Store' ~/Documents/Developpement/SamLink/ Laurent@192.168.1.79:/share/CACHEDEV1_DATA/Container/SamLink/
   ```

2. Dans `bdd-mysql`, la base SamProd26db et un utilisateur `SamProd26Admin@'%'` avec tous les droits sur cette base.
3. Copier `.env.example` en `.env` à la racine et le remplir (`FRONTEND_URL=https://samlink.juliotte-app.fr`,
   `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`…). `DB_HOST` est imposé à `bdd-mysql` par `docker-compose.yml`.
4. Construire et démarrer, puis créer les tables de Sam Link et la vue (une seule fois, sans risque si relancé) :

   ```bash
   docker compose up --build -d
   docker exec samlink-backend /app/migrate
   docker restart samlink-backend
   ```

Mise à jour : relancer le rsync de l'étape 1, puis `docker compose up --build -d` sur le NAS. Les pièces jointes sont gardées dans `chat-files/` sur le NAS.

## Ce qui n'est pas repris de SamParis12

Gestion des comptes et des mots de passe (ils restent gérés par le site du club), rôles et droits de l'espace adhérent,
journal d'activité, statistiques, déconnexion automatique après 30 minutes, cloche de notifications des courses et
documents.
