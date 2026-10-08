SET NAMES utf8mb4;

-- Sam Link 1.7 : position en direct. Le message (texte « 📡 Position en direct ») porte un partage limité dans le temps ;
-- position = dernière position connue (JSON {lat, lon, acc}, ou chiffrée « e2ee:v1: » dans un message privé chiffré).
-- Cette migration peut être relancée sans erreur.
CREATE TABLE IF NOT EXISTS chat_live (
    message_id BIGINT NOT NULL PRIMARY KEY,
    room_id INT NOT NULL,
    member_id INT NOT NULL,
    jusqua DATETIME NOT NULL,
    arrete BOOLEAN NOT NULL DEFAULT FALSE,
    position TEXT NULL,
    maj_at DATETIME NULL,
    KEY idx_chat_live_room (room_id),
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES profil(id_profil) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
