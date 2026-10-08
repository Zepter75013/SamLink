package annuaire

import (
	"database/sql"
	"errors"
	"log"
	"net/http"

	"samlink/backend/internal/auth"
	"samlink/backend/internal/httpx"
)

// Droits de la messagerie. Le bureau a les deux ; les autres adhérents les reçoivent un par un dans la table
// chat_droits (voir README).
const (
	SalonsCreer       = "messagerie.salons"
	MessagerieModerer = "messagerie.moderer"
)

type Droits struct {
	CreerSalons bool
	Moderer     bool
}

func (d Droits) Features() []string {
	out := []string{}
	if d.CreerSalons {
		out = append(out, SalonsCreer)
	}
	if d.Moderer {
		out = append(out, MessagerieModerer)
	}
	return out
}

// DroitsDe : droits de l'adhérent (bureau = tous les droits).
func DroitsDe(db *sql.DB, id int64, bureau bool) (Droits, error) {
	if bureau {
		return Droits{CreerSalons: true, Moderer: true}, nil
	}
	var d Droits
	err := db.QueryRow(`SELECT creer_salons, moderer FROM chat_droits WHERE member_id = ?`, id).Scan(&d.CreerSalons, &d.Moderer)
	if errors.Is(err, sql.ErrNoRows) {
		return Droits{}, nil
	}
	return d, err
}

type Membre struct {
	ID       int64    `json:"id"`
	Prenom   string   `json:"prenom"`
	Nom      string   `json:"nom"`
	PhotoURL string   `json:"photoUrl"`
	Groupe   string   `json:"groupe"`
	Sexe     string   `json:"sexe"`
	IsBureau bool     `json:"isBureau"`
	Email    string   `json:"email,omitempty"`
	Features []string `json:"features,omitempty"`
}

type Handler struct{ db *sql.DB }

func NewHandler(db *sql.DB) *Handler { return &Handler{db: db} }

const colonnes = `id, prenom, nom, photo_path, groupe, COALESCE(sexe, ''), is_bureau`

// Me : l'adhérent connecté, avec ses droits dans la messagerie.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	var m Membre
	err := h.db.QueryRow(`SELECT `+colonnes+`, email FROM `+Vue+` WHERE id = ?`, id).
		Scan(&m.ID, &m.Prenom, &m.Nom, &m.PhotoURL, &m.Groupe, &m.Sexe, &m.IsBureau, &m.Email)
	if errors.Is(err, sql.ErrNoRows) {
		// adhésion non renouvelée depuis la connexion : la session n'est plus valable
		httpx.Error(w, http.StatusUnauthorized, "ton adhésion n'est pas active pour cette saison")
		return
	}
	if err != nil {
		log.Printf("annuaire: me : %v", err)
		httpx.Error(w, http.StatusInternalServerError, "erreur serveur")
		return
	}
	d, err := DroitsDe(h.db, m.ID, m.IsBureau)
	if err != nil {
		log.Printf("annuaire: droits : %v", err)
	}
	m.Features = d.Features()
	httpx.JSON(w, http.StatusOK, m)
}

// Liste : les adhérents actifs, pour choisir un destinataire ou les participants d'un salon.
func (h *Handler) Liste(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT ` + colonnes + ` FROM ` + Vue + ` ORDER BY prenom, nom`)
	if err != nil {
		log.Printf("annuaire: liste : %v", err)
		httpx.Error(w, http.StatusInternalServerError, "erreur serveur")
		return
	}
	defer rows.Close()
	out := []Membre{}
	for rows.Next() {
		var m Membre
		if err := rows.Scan(&m.ID, &m.Prenom, &m.Nom, &m.PhotoURL, &m.Groupe, &m.Sexe, &m.IsBureau); err != nil {
			log.Printf("annuaire: liste : %v", err)
			httpx.Error(w, http.StatusInternalServerError, "erreur serveur")
			return
		}
		out = append(out, m)
	}
	httpx.JSON(w, http.StatusOK, out)
}
