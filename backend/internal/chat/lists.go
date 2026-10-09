package chat

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"samlink/backend/internal/httpx"
)

// ---- Listes de discussions (Sam Link 1.10) ----
// Chaque adhérent range ses discussions dans des listes à lui (« Sorties », « Famille »…), affichées comme filtres
// en haut de la liste des discussions. Personne d'autre ne les voit.

const maxListes = 20

type Liste struct {
	ID      int64   `json:"id"`
	Nom     string  `json:"nom"`
	RoomIDs []int64 `json:"roomIds"`
}

func (r *Repository) Listes(member int64) ([]Liste, error) {
	rows, err := r.db.Query(`
		SELECT l.id, l.nom, lr.room_id FROM chat_lists l LEFT JOIN chat_list_rooms lr ON lr.list_id = l.id
		WHERE l.member_id = ? ORDER BY l.ordre, l.id, lr.room_id`, member)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Liste{}
	for rows.Next() {
		var id int64
		var nom string
		var room sql.NullInt64
		if err := rows.Scan(&id, &nom, &room); err != nil {
			return nil, err
		}
		if len(out) == 0 || out[len(out)-1].ID != id {
			out = append(out, Liste{ID: id, Nom: nom, RoomIDs: []int64{}})
		}
		if room.Valid {
			out[len(out)-1].RoomIDs = append(out[len(out)-1].RoomIDs, room.Int64)
		}
	}
	return out, rows.Err()
}

// enregistrerListe crée (id = 0) ou remplace une liste de l'adhérent ; seules les discussions auxquelles il a accès sont gardées.
func (r *Repository) enregistrerListe(p *Person, id int64, nom string, roomIDs []int64) (int64, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if id == 0 {
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM chat_lists WHERE member_id = ?`, p.ID).Scan(&n); err != nil {
			return 0, err
		}
		if n >= maxListes {
			return 0, errors.New("20 listes au plus")
		}
		res, err := tx.Exec(`INSERT INTO chat_lists (member_id, nom, ordre) VALUES (?, ?, ?)`, p.ID, nom, n)
		if err != nil {
			return 0, err
		}
		id, _ = res.LastInsertId()
	} else {
		res, err := tx.Exec(`UPDATE chat_lists SET nom = ? WHERE id = ? AND member_id = ?`, nom, id, p.ID)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			var one int
			if tx.QueryRow(`SELECT 1 FROM chat_lists WHERE id = ? AND member_id = ?`, id, p.ID).Scan(&one) != nil {
				return 0, ErrNotFound
			}
		}
		if _, err := tx.Exec(`DELETE FROM chat_list_rooms WHERE list_id = ?`, id); err != nil {
			return 0, err
		}
	}
	vus := map[int64]bool{}
	for _, room := range roomIDs {
		if vus[room] {
			continue
		}
		vus[room] = true
		if _, err := r.Access(room, p); err != nil {
			continue // discussion inconnue ou plus accessible : ignorée
		}
		if _, err := tx.Exec(`INSERT INTO chat_list_rooms (list_id, room_id) VALUES (?, ?)`, id, room); err != nil {
			return 0, err
		}
	}
	return id, tx.Commit()
}

// ListesGet : GET /api/chat/lists. ListeCreer : POST /api/chat/lists {nom, roomIds}.
// ListeModifier : PUT /api/chat/lists/{id} {nom, roomIds}. ListeSupprimer : DELETE /api/chat/lists/{id}.
func (h *Handler) ListesGet(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	l, err := h.repo.Listes(p.ID)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"lists": l})
}

func (h *Handler) ListeCreer(w http.ResponseWriter, r *http.Request) { h.liste(w, r, 0) }
func (h *Handler) ListeModifier(w http.ResponseWriter, r *http.Request) {
	h.liste(w, r, pathID(r, "id"))
}

func (h *Handler) liste(w http.ResponseWriter, r *http.Request, id int64) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	var in struct {
		Nom     string  `json:"nom"`
		RoomIDs []int64 `json:"roomIds"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	in.Nom = strings.TrimSpace(in.Nom)
	if in.Nom == "" || utf8.RuneCountInString(in.Nom) > 40 {
		httpx.Error(w, http.StatusBadRequest, "donne un nom de 40 caractères au plus à la liste")
		return
	}
	if len(in.RoomIDs) > 500 {
		httpx.Error(w, http.StatusBadRequest, "trop de discussions")
		return
	}
	id, err := h.repo.enregistrerListe(p, id, in.Nom, in.RoomIDs)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			h.fail(w, err)
			return
		}
		if err.Error() == "20 listes au plus" {
			httpx.Error(w, http.StatusBadRequest, "tu as déjà 20 listes : supprimes-en une d'abord")
			return
		}
		h.fail(w, err)
		return
	}
	h.listesChangees(w, p.ID, id)
}

func (h *Handler) ListeSupprimer(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	if _, err := h.repo.db.Exec(`DELETE FROM chat_lists WHERE id = ? AND member_id = ?`, pathID(r, "id"), p.ID); err != nil {
		h.fail(w, err)
		return
	}
	h.listesChangees(w, p.ID, 0)
}

// listesChangees renvoie les listes à jour et prévient les autres appareils de l'adhérent.
func (h *Handler) listesChangees(w http.ResponseWriter, member, id int64) {
	l, err := h.repo.Listes(member)
	if err != nil {
		h.fail(w, err)
		return
	}
	h.hub.publish([]int64{member}, "lists", map[string]any{"lists": l})
	httpx.JSON(w, http.StatusOK, map[string]any{"id": id, "lists": l})
}
