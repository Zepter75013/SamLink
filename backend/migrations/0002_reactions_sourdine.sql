SET NAMES utf8mb4;

-- Sam Link 1.3 : réactions, sourdine et messages transférés. Tables ajoutées uniquement (aucune table existante
-- n'est modifiée). Cette migration peut être relancée sans erreur.

-- Une réaction (emoji) par adhérent et par message ; la changer remplace la précédente.
CREATE TABLE IF NOT EXISTS chat_reactions (
    message_id BIGINT NOT NULL,
    member_id INT NOT NULL,
    emoji VARCHAR(16) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, member_id),
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Discussions mises en sourdine par un adhérent : plus de notification, sauf quand on le mentionne (@Prénom Nom).
CREATE TABLE IF NOT EXISTS chat_mutes (
    room_id INT NOT NULL,
    member_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, member_id),
    KEY idx_chat_mutes_member (member_id),
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Messages transférés depuis une autre discussion (mention « Transféré » au-dessus de la bulle).
CREATE TABLE IF NOT EXISTS chat_forwarded (
    message_id BIGINT NOT NULL PRIMARY KEY,
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
