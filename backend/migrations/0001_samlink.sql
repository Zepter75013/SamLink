SET NAMES utf8mb4;

-- Sam Link : tables de la messagerie, créées dans la base du club (SamProd26db) à côté de ses tables existantes.
-- Les adhérents sont ceux de la table profil (clé id_profil) ; aucune table du club n'est modifiée.
-- Les tables créées ici sont la liste exhaustive de ce que Sam Link ajoute (plus la vue samlink_membres, créée par
-- cmd/migrate et au démarrage de l'API).
-- Cette migration peut être relancée sans erreur.

-- Salons : automatiques (par groupe d'activité), créés par un adhérent, ou messages privés (dm, un par paire d'adhérents).
CREATE TABLE IF NOT EXISTS chat_rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    kind ENUM('auto', 'custom', 'dm') NOT NULL,
    auto_rule ENUM('all', 'running', 'marche', 'bureau') NULL,
    nom VARCHAR(100) NOT NULL DEFAULT '',
    dm_key VARCHAR(40) NULL,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_chat_dm_key (dm_key),
    UNIQUE KEY uq_chat_auto_rule (auto_rule),
    FOREIGN KEY (created_by) REFERENCES profil(id_profil) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_room_members (
    room_id INT NOT NULL,
    member_id INT NOT NULL,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, member_id),
    KEY idx_chat_rm_member (member_id),
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un message peut être modifié ou supprimé par son auteur tant qu'aucun autre adhérent ne l'a lu (edited_at : mention
-- « modifié »). Un message supprimé perd aussi son texte. Les messages privés chiffrés sont stockés tels quels (« e2ee:v1: »).
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_id INT NOT NULL,
    sender_id INT NOT NULL,
    body TEXT NOT NULL,
    kind ENUM('text', 'media', 'poll', 'event') NOT NULL DEFAULT 'text',
    reply_to BIGINT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    edited_at TIMESTAMP NULL,
    KEY idx_chat_msg_room (room_id, id),
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_reads (
    room_id INT NOT NULL,
    member_id INT NOT NULL,
    last_read_id BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, member_id),
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Préférences de chaque adhérent sur chaque discussion :
--   archived = 1 : discussion rangée dans « Archivées » (l'adhérent peut la désarchiver) ;
--   deleted  = 1 : discussion « supprimée » pour cet adhérent (elle reste en base). Réactivation par requête SQL :
--     UPDATE chat_room_prefs SET deleted = 0, deleted_at = NULL WHERE room_id = <salon> AND member_id = <adhérent>;
CREATE TABLE IF NOT EXISTS chat_room_prefs (
    room_id INT NOT NULL,
    member_id INT NOT NULL,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, member_id),
    KEY idx_chat_prefs_member (member_id),
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pièces jointes, sondages et événements (messages kind = media, poll, event).
CREATE TABLE IF NOT EXISTS chat_attachments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_id BIGINT NOT NULL,
    kind ENUM('image', 'video', 'file') NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime VARCHAR(100) NOT NULL,
    size BIGINT NOT NULL,
    KEY idx_chat_att_msg (message_id),
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_polls (
    message_id BIGINT NOT NULL PRIMARY KEY,
    question VARCHAR(255) NOT NULL,
    multiple BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_poll_options (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_id BIGINT NOT NULL,
    position INT NOT NULL,
    texte VARCHAR(100) NOT NULL,
    KEY idx_chat_opt_msg (message_id, position),
    FOREIGN KEY (message_id) REFERENCES chat_polls(message_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_poll_votes (
    option_id BIGINT NOT NULL,
    member_id INT NOT NULL,
    message_id BIGINT NOT NULL,
    PRIMARY KEY (option_id, member_id),
    KEY idx_chat_vote_msg (message_id, member_id),
    FOREIGN KEY (option_id) REFERENCES chat_poll_options(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_events (
    message_id BIGINT NOT NULL PRIMARY KEY,
    titre VARCHAR(150) NOT NULL,
    debut DATETIME NOT NULL,
    lieu VARCHAR(200) NOT NULL DEFAULT '',
    description VARCHAR(1000) NOT NULL DEFAULT '',
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_event_rsvps (
    message_id BIGINT NOT NULL,
    member_id INT NOT NULL,
    reponse ENUM('oui', 'peut-etre', 'non') NOT NULL,
    PRIMARY KEY (message_id, member_id),
    FOREIGN KEY (message_id) REFERENCES chat_events(message_id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Droits donnés à un adhérent hors bureau (le bureau, BUREAU_ROLES, a déjà les deux) :
--   creer_salons : créer des salons et choisir leurs participants ;
--   moderer      : supprimer les messages des autres adhérents.
--   INSERT INTO chat_droits (member_id, creer_salons, moderer) VALUES (<id_profil>, 1, 0)
--     ON DUPLICATE KEY UPDATE creer_salons = VALUES(creer_salons), moderer = VALUES(moderer);
CREATE TABLE IF NOT EXISTS chat_droits (
    member_id INT NOT NULL PRIMARY KEY,
    creer_salons BOOLEAN NOT NULL DEFAULT FALSE,
    moderer BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notifications des nouveaux messages : push (navigateur, téléphone) et e-mail.
--   notif_prefs        : choix de chaque adhérent par canal. Sans ligne : e-mail activé, push activé dès qu'un appareil est abonné.
--   push_subscriptions : appareils abonnés au push (ordinateur, téléphone…).
--   notifications      : chaque notification, pour savoir si elle a été vue et, sinon, l'envoyer par e-mail après le délai
--                        (mail_due_at). Les messages d'une même discussion sont regroupés (nombre).
CREATE TABLE IF NOT EXISTS notif_prefs (
    member_id INT NOT NULL PRIMARY KEY,
    push_messages BOOLEAN NOT NULL DEFAULT TRUE,
    mail_messages BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id INT NOT NULL,
    endpoint_hash CHAR(64) NOT NULL,     -- SHA-256 de l'adresse d'abonnement (l'adresse est trop longue pour un index)
    endpoint TEXT NOT NULL,
    p256dh VARCHAR(255) NOT NULL,
    auth VARCHAR(255) NOT NULL,
    appareil VARCHAR(120) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_push_endpoint (endpoint_hash),
    KEY idx_push_member (member_id),
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id INT NOT NULL,
    kind VARCHAR(20) NOT NULL,           -- message
    ref_id INT NOT NULL,                 -- discussion concernée
    titre VARCHAR(200) NOT NULL,
    corps VARCHAR(500) NOT NULL DEFAULT '',
    url VARCHAR(255) NOT NULL DEFAULT '',
    nombre INT NOT NULL DEFAULT 1,       -- messages regroupés dans la même notification
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    seen_at TIMESTAMP NULL,
    mail_due_at TIMESTAMP NULL,          -- NULL : pas d'e-mail prévu (adhérent qui ne les veut pas)
    mailed_at TIMESTAMP NULL,
    KEY idx_notif_member (member_id, kind, ref_id),
    KEY idx_notif_mail (mailed_at, seen_at, mail_due_at),
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Présence : dernier moment où chaque adhérent a été vu en ligne (cercle vert, orange ou rouge dans la messagerie).
CREATE TABLE IF NOT EXISTS member_presence (
    member_id INT NOT NULL PRIMARY KEY,
    last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chiffrement de bout en bout des messages privés (voir docs/chiffrement-messages-prives.md).
--   public_key      : clé publique ECDH P-256 de l'adhérent ;
--   wrapped_private : clé privée chiffrée dans son navigateur par sa clé de récupération (illisible pour le serveur).
CREATE TABLE IF NOT EXISTS member_keys (
    member_id INT NOT NULL PRIMARY KEY,
    public_key VARCHAR(255) NOT NULL,
    wrapped_private TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Liaison d'un nouvel appareil au chiffrement (le serveur transmet un message qu'il ne peut pas lire ; expire en 5 minutes).
CREATE TABLE IF NOT EXISTS device_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id INT NOT NULL,
    new_pub VARCHAR(255) NOT NULL,
    resp_pub VARCHAR(255) NULL,
    reponse TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_links_member (member_id, created_at),
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Salons automatiques du club.
INSERT IGNORE INTO chat_rooms (kind, auto_rule, nom) VALUES
    ('auto', 'all', 'Tous les adhérents'),
    ('auto', 'running', 'Running'),
    ('auto', 'marche', 'Marche nordique'),
    ('auto', 'bureau', 'Bureau');
