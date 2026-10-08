SET NAMES utf8mb4;

-- Sam Link 1.6 : messages importants (étoile), propres à chaque adhérent. La position partagée est un message texte
-- (lien de carte) et « lu par » se lit dans chat_reads : pas d'autre table. Cette migration peut être relancée sans erreur.
CREATE TABLE IF NOT EXISTS chat_stars (
    member_id INT NOT NULL,
    message_id BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id, message_id),
    KEY idx_chat_stars_msg (message_id),
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
