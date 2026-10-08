package chat

import (
	"encoding/json"
	"net/http"

	"samlink/backend/internal/httpx"
)

// ---- Messages importants (étoile) et détail « lu par » (Sam Link 1.6) ----

const maxStars = 200 // messages importants affichés dans la liste

// starred : messages marqués importants par l'adhérent, parmi la liste.
func (r *Repository) starred(viewer int64, ids []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	if viewer == 0 || len(ids) == 0 {
		return out, nil
	}
	in, args := inClause(ids)
	rows, err := r.db.Query(`SELECT message_id FROM chat_stars WHERE member_id = ? AND message_id IN (`+in+`)`, append([]any{viewer}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

func (r *Repository) SetStar(member, messageID int64, on bool) error {
	if on {
		_, err := r.db.Exec(`INSERT IGNORE INTO chat_stars (member_id, message_id) VALUES (?, ?)`, member, messageID)
		return err
	}
	_, err := r.db.Exec(`DELETE FROM chat_stars WHERE member_id = ? AND message_id = ?`, member, messageID)
	return err
}

// StarredMessage : un message important, avec la discussion d'où il vient.
type StarredMessage struct {
	Message
	RoomNom string `json:"roomNom"`
}

// Stars : messages importants de l'adhérent, du plus récemment marqué au plus ancien, dans les discussions auxquelles il a
// encore accès (non supprimées).
func (r *Repository) Stars(p *Person) ([]StarredMessage, error) {
	rows, err := r.db.Query(`
		SELECT st.message_id FROM chat_stars st JOIN chat_messages m ON m.id = st.message_id
		WHERE st.member_id = ? AND m.deleted_at IS NULL ORDER BY st.created_at DESC, st.message_id DESC LIMIT ?`, p.ID, maxStars)
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
	rooms, err := r.Rooms(p)
	if err != nil {
		return nil, err
	}
	noms := map[int64]string{}
	for _, rm := range rooms {
		noms[rm.ID] = rm.Nom
	}
	var msgs []Message
	for _, id := range ids {
		m, err := r.Message(id)
		if err != nil {
			continue
		}
		if _, ok := noms[m.RoomID]; ok {
			msgs = append(msgs, *m)
		}
	}
	if err := r.enrich(msgs, p.ID); err != nil {
		return nil, err
	}
	out := make([]StarredMessage, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, StarredMessage{Message: m, RoomNom: noms[m.RoomID]})
	}
	return out, nil
}

// ReadBy : participants (hors auteur) qui ont lu le message, et nombre de ceux qui ne l'ont pas encore lu.
func (r *Repository) ReadBy(rr *roomRow, m *Message) ([]Participant, int, error) {
	membres, err := r.MemberIDs(rr)
	if err != nil {
		return nil, 0, err
	}
	membres = r.Visible(rr.id, membres)
	rows, err := r.db.Query(`
		SELECT s.id, CONCAT(s.prenom, ' ', s.nom), s.photo_path
		FROM chat_reads rd JOIN samlink_membres s ON s.id = rd.member_id
		WHERE rd.room_id = ? AND rd.member_id <> ? AND rd.last_read_id >= ?
		ORDER BY s.prenom, s.nom`, rr.id, m.SenderID, m.ID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	dans := map[int64]bool{}
	for _, id := range membres {
		dans[id] = true
	}
	lus := []Participant{}
	for rows.Next() {
		var p Participant
		if err := rows.Scan(&p.ID, &p.Nom, &p.PhotoURL); err != nil {
			return nil, 0, err
		}
		if dans[p.ID] {
			lus = append(lus, p)
		}
	}
	reste := 0
	for _, id := range membres {
		if id != m.SenderID {
			reste++
		}
	}
	return lus, reste - len(lus), rows.Err()
}

// Star : PUT /api/chat/messages/{id}/star {starred}.
func (h *Handler) Star(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	var in struct {
		Starred bool `json:"starred"`
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
	if _, err := h.repo.Access(msg.RoomID, p); err != nil {
		h.fail(w, err)
		return
	}
	if err := h.repo.SetStar(p.ID, msg.ID, in.Starred && !msg.Deleted); err != nil {
		h.fail(w, err)
		return
	}
	h.hub.publish([]int64{p.ID}, "stars", map[string]any{"messageId": msg.ID, "starred": in.Starred}) // ses autres appareils
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// StarsList : GET /api/chat/stars.
func (h *Handler) StarsList(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	list, err := h.repo.Stars(p)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"messages": list})
}

// Info : GET /api/chat/messages/{id}/info — qui a lu le message (réservé à son auteur, comme WhatsApp).
func (h *Handler) Info(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
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
	if msg.SenderID != p.ID {
		httpx.Error(w, http.StatusForbidden, "seul l'auteur d'un message voit qui l'a lu")
		return
	}
	lus, nonLus, err := h.repo.ReadBy(rr, msg)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"lus": lus, "nonLus": nonLus})
}
