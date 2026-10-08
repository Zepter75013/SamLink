package chat

import (
	"encoding/json"
	"net/http"

	"samlink/backend/internal/httpx"
)

// ---- Messages épinglés (Sam Link 1.4) ----

const maxPins = 3 // comme WhatsApp : au-delà, le plus ancien épinglage est retiré

// peutEpingler : dans un message privé, les deux adhérents ; dans un salon créé, son créateur et les modérateurs ;
// dans un salon automatique du club, les modérateurs seulement.
func peutEpingler(rr *roomRow, p *Person) bool {
	switch rr.kind {
	case "dm":
		return true
	case "custom":
		return rr.createdBy == p.ID || p.CanModerate
	}
	return p.CanModerate
}

// Pinned : messages épinglés d'une discussion, le plus récemment épinglé d'abord.
func (r *Repository) Pinned(roomID, viewer int64) ([]Message, error) {
	rows, err := r.db.Query(`SELECT message_id FROM chat_pins WHERE room_id = ? ORDER BY created_at DESC, message_id DESC LIMIT ?`, roomID, maxPins)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	out := []Message{}
	for _, id := range ids {
		m, err := r.Message(id)
		if err != nil || m.Deleted {
			continue
		}
		out = append(out, *m)
	}
	return out, r.enrich(out, viewer)
}

// SetPinned épingle ou désépingle un message de la discussion.
func (r *Repository) SetPinned(roomID, messageID, member int64, pinned bool) error {
	if !pinned {
		_, err := r.db.Exec(`DELETE FROM chat_pins WHERE room_id = ? AND message_id = ?`, roomID, messageID)
		return err
	}
	if _, err := r.db.Exec(`
		INSERT INTO chat_pins (room_id, message_id, pinned_by) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE pinned_by = VALUES(pinned_by), created_at = CURRENT_TIMESTAMP`, roomID, messageID, member); err != nil {
		return err
	}
	// au-delà de maxPins, les plus anciens épinglages sont retirés
	_, err := r.db.Exec(`
		DELETE FROM chat_pins WHERE room_id = ? AND message_id NOT IN (
			SELECT message_id FROM (SELECT message_id FROM chat_pins WHERE room_id = ? ORDER BY created_at DESC, message_id DESC LIMIT ?) garde)`,
		roomID, roomID, maxPins)
	return err
}

// Pin : PUT /api/chat/messages/{id}/pin {pinned}.
func (h *Handler) Pin(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	var in struct {
		Pinned bool `json:"pinned"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	msg, err := h.repo.Message(pathID(r, "id"))
	if err != nil {
		h.fail(w, err)
		return
	}
	rr, err := h.repo.Access(msg.RoomID, p)
	if err != nil {
		h.fail(w, err)
		return
	}
	if !peutEpingler(rr, p) {
		httpx.Error(w, http.StatusForbidden, "seuls le créateur du salon et les modérateurs peuvent épingler un message ici")
		return
	}
	if msg.Deleted && in.Pinned {
		httpx.Error(w, http.StatusConflict, "ce message a été supprimé")
		return
	}
	if err := h.repo.SetPinned(rr.id, msg.ID, p.ID, in.Pinned); err != nil {
		h.fail(w, err)
		return
	}
	pinned, err := h.repo.Pinned(rr.id, 0)
	if err != nil {
		h.fail(w, err)
		return
	}
	h.broadcast(rr, "pins", map[string]any{"roomId": rr.id, "pinned": pinned})
	httpx.JSON(w, http.StatusOK, map[string]any{"pinned": pinned})
}
