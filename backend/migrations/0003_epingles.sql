SET NAMES utf8mb4;

-- Sam Link 1.4 : messages épinglés (3 au plus par discussion, en haut de la conversation). Les messages vocaux n'ont pas
-- besoin de table : ce sont des pièces jointes de type audio. Cette migration peut être relancée sans erreur.
CREATE TABLE IF NOT EXISTS chat_pins (
    room_id INT NOT NULL,
    message_id BIGINT NOT NULL,
    pinned_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, message_id),
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (pinned_by) REFERENCES profil(id_profil) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
