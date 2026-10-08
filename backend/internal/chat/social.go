package chat

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"samlink/backend/internal/httpx"
)

// ---- Réactions, sourdine, « en train d'écrire », transfert et mentions (Sam Link 1.3) ----

// Reaction : un emoji posé sur un message, avec ceux qui l'ont choisi.
type Reaction struct {
	Emoji string   `json:"emoji"`
	IDs   []int64  `json:"ids"`  // adhérents (le navigateur en déduit « ma réaction »)
	Noms  []string `json:"noms"` // prénoms et noms, pour l'infobulle
}

const maxEmoji = 16 // octets : un emoji, éventuellement composé (teinte, drapeau…)

func emojiValide(e string) bool {
	if e == "" || len(e) > maxEmoji || !utf8.ValidString(e) || strings.ContainsAny(e, " \t\r\n<>\"'&") {
		return false
	}
	for _, r := range e {
		if r < 0x80 { // lettres, chiffres, ponctuation : pas un emoji (sauf joints tels que # ou * des touches)
			if r != '#' && r != '*' && (r < '0' || r > '9') {
				return false
			}
		}
	}
	return true
}

// reactions charge les réactions d'une liste de messages.
func (r *Repository) reactions(ids []int64) (map[int64][]Reaction, error) {
	out := map[int64][]Reaction{}
	if len(ids) == 0 {
		return out, nil
	}
	in, args := inClause(ids)
	rows, err := r.db.Query(`
		SELECT rx.message_id, rx.emoji, rx.member_id, CONCAT(m.prenom, ' ', m.nom)
		FROM chat_reactions rx JOIN samlink_membres m ON m.id = rx.member_id
		WHERE rx.message_id IN (`+in+`) ORDER BY rx.message_id, rx.created_at`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var mid, member int64
		var emoji, nom string
		if err := rows.Scan(&mid, &emoji, &member, &nom); err != nil {
			return nil, err
		}
		list := out[mid]
		i := 0
		for i < len(list) && list[i].Emoji != emoji {
			i++
		}
		if i == len(list) {
			list = append(list, Reaction{Emoji: emoji})
		}
		list[i].IDs = append(list[i].IDs, member)
		list[i].Noms = append(list[i].Noms, nom)
		out[mid] = list
	}
	return out, rows.Err()
}

// forwarded : messages marqués « Transféré » parmi la liste.
func (r *Repository) forwarded(ids []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	in, args := inClause(ids)
	rows, err := r.db.Query(`SELECT message_id FROM chat_forwarded WHERE message_id IN (`+in+`)`, args...)
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

// enrichSocial complète enrich : réactions et mention « Transféré ».
func (r *Repository) enrichSocial(msgs []Message) error {
	ids := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		if !m.Deleted {
			ids = append(ids, m.ID)
		}
	}
	rx, err := r.reactions(ids)
	if err != nil {
		return err
	}
	fw, err := r.forwarded(ids)
	if err != nil {
		return err
	}
	for i := range msgs {
		msgs[i].Reactions = rx[msgs[i].ID]
		if msgs[i].Reactions == nil {
			msgs[i].Reactions = []Reaction{}
		}
		msgs[i].Forwarded = fw[msgs[i].ID]
	}
	return nil
}

// SetReaction pose, remplace ou retire (emoji vide) la réaction de l'adhérent sur un message.
func (r *Repository) SetReaction(messageID, member int64, emoji string) error {
	if emoji == "" {
		_, err := r.db.Exec(`DELETE FROM chat_reactions WHERE message_id = ? AND member_id = ?`, messageID, member)
		return err
	}
	_, err := r.db.Exec(`
		INSERT INTO chat_reactions (message_id, member_id, emoji) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), created_at = CURRENT_TIMESTAMP`, messageID, member, emoji)
	return err
}

// MarkForwarded marque un message comme transféré.
func (r *Repository) MarkForwarded(messageID int64) error {
	_, err := r.db.Exec(`INSERT IGNORE INTO chat_forwarded (message_id) VALUES (?)`, messageID)
	return err
}

// SetMuted met une discussion en sourdine pour l'adhérent, ou l'en sort.
func (r *Repository) SetMuted(roomID, member int64, muted bool) error {
	if muted {
		_, err := r.db.Exec(`INSERT IGNORE INTO chat_mutes (room_id, member_id) VALUES (?, ?)`, roomID, member)
		return err
	}
	_, err := r.db.Exec(`DELETE FROM chat_mutes WHERE room_id = ? AND member_id = ?`, roomID, member)
	return err
}

// Muted : adhérents qui ont mis la discussion en sourdine.
func (r *Repository) Muted(roomID int64) map[int64]bool {
	out := map[int64]bool{}
	rows, err := r.db.Query(`SELECT member_id FROM chat_mutes WHERE room_id = ?`, roomID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			out[id] = true
		}
	}
	return out
}

// ForwardMedia copie un message avec pièces jointes (non chiffré) dans une autre discussion. Les fichiers ne sont pas
// dupliqués sur le disque : un message supprimé garde ses fichiers (suppression logique), le partage est donc sans risque.
func (r *Repository) ForwardMedia(src *Message, roomID, sender int64) (*Message, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO chat_messages (room_id, sender_id, body, kind) VALUES (?, ?, ?, 'media')`, roomID, sender, src.Texte)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if _, err := tx.Exec(`
		INSERT INTO chat_attachments (message_id, kind, file_path, original_name, mime, size)
		SELECT ?, kind, file_path, original_name, mime, size FROM chat_attachments WHERE message_id = ? ORDER BY id`, id, src.ID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO chat_forwarded (message_id) VALUES (?)`, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	_ = r.MarkRead(roomID, sender, id)
	return r.MessageFull(id, sender)
}

// ---- Points d'entrée HTTP ----

// React : PUT /api/chat/messages/{id}/reaction {emoji} (emoji vide : retire la réaction).
func (h *Handler) React(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	var in struct {
		Emoji string `json:"emoji"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	in.Emoji = strings.TrimSpace(in.Emoji)
	if in.Emoji != "" && !emojiValide(in.Emoji) {
		httpx.Error(w, http.StatusBadRequest, "réaction invalide")
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
	if msg.Deleted {
		httpx.Error(w, http.StatusConflict, "ce message a été supprimé")
		return
	}
	if err := h.repo.SetReaction(msg.ID, p.ID, in.Emoji); err != nil {
		h.fail(w, err)
		return
	}
	rx, err := h.repo.reactions([]int64{msg.ID})
	if err != nil {
		h.fail(w, err)
		return
	}
	list := rx[msg.ID]
	if list == nil {
		list = []Reaction{}
	}
	h.broadcast(rr, "reaction", map[string]any{"roomId": rr.id, "messageId": msg.ID, "reactions": list})
	httpx.JSON(w, http.StatusOK, map[string]any{"reactions": list})
}

// Typing : POST /api/chat/rooms/{id}/typing — « Prénom écrit… » chez les autres participants (rien n'est enregistré).
func (h *Handler) Typing(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	if ids, err := h.repo.MemberIDs(rr); err == nil {
		var dest []int64
		for _, id := range h.repo.Visible(rr.id, ids) {
			if id != p.ID {
				dest = append(dest, id)
			}
		}
		h.hub.publish(dest, "typing", map[string]any{"roomId": rr.id, "memberId": p.ID, "prenom": p.Prenom})
	}
	w.WriteHeader(http.StatusNoContent)
}

// Mute : POST /api/chat/rooms/{id}/mute {muted} — plus de notification pour cette discussion (sauf mention).
func (h *Handler) Mute(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	var in struct {
		Muted bool `json:"muted"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	if err := h.repo.SetMuted(rr.id, p.ID, in.Muted); err != nil {
		h.fail(w, err)
		return
	}
	h.hub.publish([]int64{p.ID}, "rooms", map[string]int64{"roomId": rr.id}) // synchronise ses autres appareils
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Forward : POST /api/chat/messages/{id}/forward {roomIds} — transfère des photos ou documents (non chiffrés).
// Les messages texte sont transférés par le navigateur (envoi normal marqué « transféré »), qui peut ainsi les
// chiffrer pour une discussion privée chiffrée.
func (h *Handler) Forward(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	var in struct {
		RoomIDs []int64 `json:"roomIds"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil || len(in.RoomIDs) == 0 || len(in.RoomIDs) > 10 {
		httpx.Error(w, http.StatusBadRequest, "choisis entre 1 et 10 discussions")
		return
	}
	src, err := h.repo.MessageFull(pathID(r, "id"), p.ID)
	if err != nil {
		h.fail(w, err)
		return
	}
	if _, err := h.repo.Access(src.RoomID, p); err != nil {
		h.fail(w, err)
		return
	}
	if src.Deleted || src.Kind != "media" || estChiffre(src.Texte) {
		httpx.Error(w, http.StatusBadRequest, "seuls les messages et les photos ou documents non chiffrés peuvent être transférés")
		return
	}
	var envoyes []int64
	var refus []string
	for _, id := range in.RoomIDs {
		rr, err := h.repo.Access(id, p)
		if err != nil {
			refus = append(refus, fmt.Sprintf("discussion %d inaccessible", id))
			continue
		}
		if h.repo.DMChiffre(rr) {
			refus = append(refus, "une discussion privée chiffrée (les pièces jointes n'y sont pas transférables)")
			continue
		}
		msg, err := h.repo.ForwardMedia(src, rr.id, p.ID)
		if err != nil {
			h.fail(w, err)
			return
		}
		h.publishMessage(rr, msg)
		envoyes = append(envoyes, rr.id)
	}
	if envoyes == nil {
		envoyes = []int64{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"envoyes": envoyes, "refus": refus})
}

// mentionsValides : ne garde que les participants de la discussion (hors auteur).
func (h *Handler) mentionsValides(rr *roomRow, auteur int64, ids []int64) []int64 {
	if len(ids) == 0 {
		return nil
	}
	membres, err := h.repo.MemberIDs(rr)
	if err != nil {
		return nil
	}
	ok := map[int64]bool{}
	for _, id := range h.repo.Visible(rr.id, membres) {
		ok[id] = true
	}
	var out []int64
	vu := map[int64]bool{}
	for _, id := range ids {
		if ok[id] && id != auteur && !vu[id] {
			vu[id] = true
			out = append(out, id)
		}
		if len(out) == 50 {
			break
		}
	}
	return out
}
