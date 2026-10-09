SET NAMES utf8mb4;

-- Sam Link 1.10 : listes de discussions propres à chaque adhérent (filtres en haut de la liste, comme WhatsApp).
-- Cette migration peut être relancée sans erreur.
CREATE TABLE IF NOT EXISTS chat_lists (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    member_id INT NOT NULL,
    nom VARCHAR(40) NOT NULL,
    ordre INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_chat_lists_member (member_id),
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_list_rooms (
    list_id INT NOT NULL,
    room_id INT NOT NULL,
    PRIMARY KEY (list_id, room_id),
    FOREIGN KEY (list_id) REFERENCES chat_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
