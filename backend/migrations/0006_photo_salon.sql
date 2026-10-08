SET NAMES utf8mb4;

-- Sam Link 1.8 : photo d'un salon (salons du club et salons créés ; un message privé montre la photo de l'autre adhérent).
-- path = fichier sous uploads/chat (photo recadrée et réduite par le navigateur).
-- Cette migration peut être relancée sans erreur.
CREATE TABLE IF NOT EXISTS chat_room_photos (
    room_id INT NOT NULL PRIMARY KEY,
    path VARCHAR(255) NOT NULL,
    updated_by INT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES profil(id_profil) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
