package chat

import (
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"samlink/backend/internal/auth"
	"samlink/backend/internal/httpx"
)

// Présence : la page ouverte d'un adhérent envoie un battement toutes les 30 secondes tant qu'elle est visible. Le dernier
// battement est conservé ; le client en déduit le cercle de couleur (vert, orange, rouge) et le texte « Vu hier à 14:09 ».

var (
	presenceMu     sync.Mutex
	presenceEcrite = map[int64]time.Time{} // dernier enregistrement par adhérent : évite d'écrire en base à chaque battement
)

const pasPresence = 20 * time.Second

// Touch note que l'adhérent est en ligne maintenant (au plus une écriture toutes les 20 secondes par adhérent).
func (r *Repository) Touch(memberID int64) {
	presenceMu.Lock()
	if time.Since(presenceEcrite[memberID]) < pasPresence {
		presenceMu.Unlock()
		return
	}
	presenceEcrite[memberID] = time.Now()
	presenceMu.Unlock()
	if _, err := r.db.Exec(`INSERT INTO member_presence (member_id, last_seen) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE last_seen = NOW()`, memberID); err != nil {
		log.Printf("chat: présence : %v", err)
	}
}

// Presences : pour chaque adhérent déjà vu en ligne, l'ancienneté en secondes de sa dernière présence (calculée par la base).
func (r *Repository) Presences() (map[string]int64, error) {
	rows, err := r.db.Query(`SELECT member_id, TIMESTAMPDIFF(SECOND, last_seen, NOW()) FROM member_presence`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var id, age int64
		if rows.Scan(&id, &age) == nil {
			out[strconv.FormatInt(id, 10)] = max(age, 0)
		}
	}
	return out, rows.Err()
}

// Presence : enregistre le battement de l'adhérent connecté et renvoie la présence de tous les adhérents.
func (h *Handler) Presence(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	if id <= 0 {
		httpx.Error(w, http.StatusUnauthorized, "session invalide")
		return
	}
	h.repo.Touch(id)
	p, err := h.repo.Presences()
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"presence": p})
}
