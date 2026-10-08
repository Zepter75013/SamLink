package chat

import (
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"time"

	"samlink/backend/internal/httpx"
)

// ---- Position en direct (Sam Link 1.7) ----
// L'auteur partage sa position pendant 15 minutes, 1 heure ou 8 heures. Son navigateur envoie une mise à jour quand il
// bouge (tant que Sam Link est ouvert : un site web ne peut pas suivre la position en arrière-plan). Seule la dernière
// position est gardée ; dans un message privé chiffré, elle est chiffrée par le navigateur.

var dureesLive = map[int]bool{15: true, 60: true, 480: true}

const intervalleLive = 4 * time.Second // au plus une mise à jour toutes les 4 secondes par partage

type Live struct {
	Jusqua   time.Time  `json:"jusqua"`
	Arrete   bool       `json:"arrete"`
	Actif    bool       `json:"actif"`    // ni arrêté ni expiré
	Position string     `json:"position"` // JSON {lat, lon, acc} ou chiffré
	MajAt    *time.Time `json:"majAt"`
}

// lives : partages de position portés par les messages de la liste.
func (r *Repository) lives(ids []int64) (map[int64]*Live, error) {
	out := map[int64]*Live{}
	if len(ids) == 0 {
		return out, nil
	}
	in, args := inClause(ids)
	rows, err := r.db.Query(`SELECT message_id, jusqua, arrete, jusqua > NOW() AND NOT arrete, COALESCE(position, ''), maj_at
		FROM chat_live WHERE message_id IN (`+in+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var l Live
		var maj sql.NullTime
		if err := rows.Scan(&id, &l.Jusqua, &l.Arrete, &l.Actif, &l.Position, &maj); err != nil {
			return nil, err
		}
		if maj.Valid {
			l.MajAt = &maj.Time
		}
		out[id] = &l
	}
	return out, rows.Err()
}

// StartLive : le message vient d'être envoyé avec un partage en direct.
func (r *Repository) StartLive(m *Message, minutes int) error {
	_, err := r.db.Exec(`INSERT INTO chat_live (message_id, room_id, member_id, jusqua) VALUES (?, ?, ?, NOW() + INTERVAL ? MINUTE)`,
		m.ID, m.RoomID, m.SenderID, minutes)
	return err
}

func (r *Repository) liveDe(messageID int64) (*Live, int64, error) {
	l, err := r.lives([]int64{messageID})
	if err != nil {
		return nil, 0, err
	}
	if l[messageID] == nil {
		return nil, 0, ErrNotFound
	}
	var auteur int64
	err = r.db.QueryRow(`SELECT member_id FROM chat_live WHERE message_id = ?`, messageID).Scan(&auteur)
	return l[messageID], auteur, err
}

// positionValide : JSON {lat, lon, acc} plausible (texte en clair).
func positionValide(s string) bool {
	var p struct {
		Lat *float64 `json:"lat"`
		Lon *float64 `json:"lon"`
		Acc float64  `json:"acc"`
	}
	if len(s) > 200 || json.Unmarshal([]byte(s), &p) != nil || p.Lat == nil || p.Lon == nil {
		return false
	}
	return math.Abs(*p.Lat) <= 90 && math.Abs(*p.Lon) <= 180 && p.Acc >= 0 && p.Acc < 1e6
}

// LiveUpdate : PUT /api/chat/messages/{id}/live {position} — nouvelle position de l'auteur.
// LiveStop  : DELETE /api/chat/messages/{id}/live — l'auteur arrête le partage.
func (h *Handler) LiveUpdate(w http.ResponseWriter, r *http.Request) { h.live(w, r, false) }
func (h *Handler) LiveStop(w http.ResponseWriter, r *http.Request)   { h.live(w, r, true) }

func (h *Handler) live(w http.ResponseWriter, r *http.Request, arreter bool) {
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
	l, auteur, err := h.repo.liveDe(msg.ID)
	if err != nil {
		h.fail(w, err)
		return
	}
	if auteur != p.ID {
		h.fail(w, ErrForbidden)
		return
	}
	if arreter {
		if _, err := h.repo.db.Exec(`UPDATE chat_live SET arrete = TRUE WHERE message_id = ?`, msg.ID); err != nil {
			h.fail(w, err)
			return
		}
	} else {
		if !l.Actif {
			httpx.Error(w, http.StatusConflict, "ce partage de position est terminé")
			return
		}
		var in struct {
			Position string `json:"position"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in); err != nil {
			httpx.Error(w, http.StatusBadRequest, "requête invalide")
			return
		}
		chiffre := h.repo.DMChiffre(rr)
		if chiffre != estChiffre(in.Position) || (!chiffre && !positionValide(in.Position)) || len(in.Position) > 2000 {
			httpx.Error(w, http.StatusBadRequest, "position invalide")
			return
		}
		if l.MajAt != nil && time.Since(*l.MajAt) < intervalleLive {
			w.WriteHeader(http.StatusNoContent) // trop rapproché : ignoré
			return
		}
		if _, err := h.repo.db.Exec(`UPDATE chat_live SET position = ?, maj_at = NOW() WHERE message_id = ?`, in.Position, msg.ID); err != nil {
			h.fail(w, err)
			return
		}
	}
	l2, _, err := h.repo.liveDe(msg.ID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		h.fail(w, err)
		return
	}
	h.broadcast(rr, "live", map[string]any{"roomId": rr.id, "messageId": msg.ID, "live": l2})
	httpx.JSON(w, http.StatusOK, map[string]any{"live": l2})
}
