package chat

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"samlink/backend/internal/auth"
	"samlink/backend/internal/httpx"
)

// Chiffrement de bout en bout des messages privés.
//
// Le serveur ne fait que stocker : la clé publique de chaque adhérent, sa clé privée déjà chiffrée par sa phrase secrète
// (illisible ici) et les messages chiffrés. Toute la cryptographie se passe dans le navigateur (public/…/lib/e2ee.js).

const (
	prefixeE2EE = "e2ee:v1:" // début du texte d'un message chiffré
	maxChiffre  = 12000      // longueur maximale d'un message chiffré (base64 : il est plus long que le texte clair)
	maxEmballee = 4096
)

func estChiffre(texte string) bool { return strings.HasPrefix(texte, prefixeE2EE) }

// corpsValide : longueur d'un message, clair (2000 caractères) ou chiffré (12000 caractères de base64).
func corpsValide(corps string) bool {
	n := len([]rune(corps))
	if n == 0 {
		return false
	}
	if estChiffre(corps) {
		return n <= maxChiffre
	}
	return n <= maxBody
}

// cleDe : clé publique et clé privée emballée d'un adhérent.
func (r *Repository) cleDe(id int64) (pub, emballee string, ok bool, err error) {
	err = r.db.QueryRow(`SELECT public_key, wrapped_private FROM member_keys WHERE member_id = ?`, id).Scan(&pub, &emballee)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", false, nil
	}
	return pub, emballee, err == nil, err
}

// DMChiffre : discussion privée dont les deux adhérents ont activé le chiffrement. Ses messages doivent alors être chiffrés
// (le serveur refuse le texte en clair) et elle n'accepte ni pièce jointe, sondage ni événement, que le serveur verrait en clair.
func (r *Repository) DMChiffre(rr *roomRow) bool {
	if rr == nil || rr.kind != "dm" {
		return false
	}
	ids, err := r.MemberIDs(rr)
	if err != nil || len(ids) != 2 {
		return false
	}
	var n int
	if err := r.db.QueryRow(`SELECT COUNT(*) FROM member_keys WHERE member_id IN (?, ?)`, ids[0], ids[1]).Scan(&n); err != nil {
		return false
	}
	return n == 2
}

func cleValide(pub string) bool {
	b, err := base64.StdEncoding.DecodeString(pub)
	return err == nil && len(b) == 65 && b[0] == 4 // point P-256 non compressé
}

type reponseCles struct {
	Configure bool   `json:"configure"`
	PublicKey string `json:"publicKey,omitempty"`
	Emballee  string `json:"emballee,omitempty"`
}

// MesCles : l'état du chiffrement de l'adhérent connecté (clé publique et clé privée emballée, s'il les a créées).
func (h *Handler) MesCles(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	pub, emb, ok, err := h.repo.cleDe(id)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, reponseCles{Configure: ok, PublicKey: pub, Emballee: emb})
}

// EnregistrerMesCles : active le chiffrement (première fois) ou change la phrase secrète (même clé publique, clé privée
// ré-emballée). Une clé publique différente est refusée : il faut d'abord réinitialiser, ce qui rend les anciens messages illisibles.
func (h *Handler) EnregistrerMesCles(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	var in struct {
		PublicKey string `json:"publicKey"`
		Emballee  string `json:"emballee"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil || !cleValide(in.PublicKey) || in.Emballee == "" || len(in.Emballee) > maxEmballee {
		httpx.Error(w, http.StatusBadRequest, "clés invalides")
		return
	}
	pub, _, ok, err := h.repo.cleDe(id)
	if err != nil {
		h.fail(w, err)
		return
	}
	if ok && pub != in.PublicKey {
		httpx.Error(w, http.StatusConflict, "Une clé existe déjà : réinitialise le chiffrement avant d'en créer une nouvelle (tes anciens messages chiffrés seront perdus).")
		return
	}
	if _, err := h.repo.db.Exec(`INSERT INTO member_keys (member_id, public_key, wrapped_private) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE wrapped_private = VALUES(wrapped_private)`, id, in.PublicKey, in.Emballee); err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, reponseCles{Configure: true, PublicKey: in.PublicKey, Emballee: in.Emballee})
}

// ReinitialiserMesCles : supprime les clés de l'adhérent (phrase secrète oubliée, ou volonté d'arrêter). Ses messages déjà chiffrés
// deviennent illisibles pour tout le monde : personne ne peut les récupérer.
func (h *Handler) ReinitialiserMesCles(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	if _, err := h.repo.db.Exec(`DELETE FROM member_keys WHERE member_id = ?`, id); err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// CleDe : clé publique d'un autre adhérent. Une clé absente (il n'a pas encore ouvert l'espace adhérent) est une situation normale,
// pas une erreur : réponse 200 avec une clé vide, pour ne pas polluer la console des navigateurs.
func (h *Handler) CleDe(w http.ResponseWriter, r *http.Request) {
	pub, _, _, err := h.repo.cleDe(pathID(r, "id"))
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"publicKey": pub})
}

// ---- Chiffrement de l'historique : chaque adhérent chiffre, depuis son navigateur, ses propres anciens messages en clair ----

const maxLotHistorique = 200

// EnClair : mes messages texte encore en clair dans une discussion privée dont les deux adhérents ont activé le chiffrement
// (au plus 200 à la fois). Vide ailleurs : seul un message privé chiffrable est concerné.
func (h *Handler) EnClair(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	type ligne struct {
		ID    int64  `json:"id"`
		Texte string `json:"texte"`
	}
	out := []ligne{}
	if h.repo.DMChiffre(rr) {
		rows, err := h.repo.db.Query(`SELECT id, body FROM chat_messages WHERE room_id = ? AND sender_id = ? AND kind = 'text'
			AND deleted_at IS NULL AND body NOT LIKE ? ORDER BY id LIMIT ?`, rr.id, p.ID, prefixeE2EE+"%", maxLotHistorique)
		if err != nil {
			h.fail(w, err)
			return
		}
		defer rows.Close()
		for rows.Next() {
			var l ligne
			if rows.Scan(&l.ID, &l.Texte) == nil {
				out = append(out, l)
			}
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"messages": out})
}

// ChiffrerHistorique remplace le texte en clair de mes anciens messages par leur version chiffrée (calculée par mon navigateur).
// Refusé pour le message d'un autre, un message supprimé, ou hors d'une discussion privée chiffrée.
func (h *Handler) ChiffrerHistorique(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	var in struct {
		Messages []struct {
			ID    int64  `json:"id"`
			Texte string `json:"texte"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&in); err != nil || len(in.Messages) == 0 || len(in.Messages) > maxLotHistorique {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	if !h.repo.DMChiffre(rr) {
		httpx.Error(w, http.StatusConflict, "Le chiffrement de bout en bout n'est pas actif dans cette discussion.")
		return
	}
	n := 0
	for _, m := range in.Messages {
		if !estChiffre(m.Texte) || len([]rune(m.Texte)) > maxChiffre {
			continue
		}
		res, err := h.repo.db.Exec(`UPDATE chat_messages SET body = ? WHERE id = ? AND room_id = ? AND sender_id = ? AND kind = 'text'
			AND deleted_at IS NULL AND body NOT LIKE ?`, m.Texte, m.ID, rr.id, p.ID, prefixeE2EE+"%")
		if err != nil {
			h.fail(w, err)
			return
		}
		if k, _ := res.RowsAffected(); k > 0 {
			n++
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]int{"chiffres": n})
}

// ---- Liaison d'un nouvel appareil : le serveur ne fait que transmettre ----

const (
	dureeLiaison   = "5 MINUTE"
	maxLiaisons    = 5 // demandes en attente par adhérent
	maxBlobLiaison = 4096
)

type demandeLiaison struct {
	ID        int64  `json:"id"`
	PublicKey string `json:"publicKey"`
}

// purgerLiaisons supprime les demandes expirées de cet adhérent.
func (r *Repository) purgerLiaisons(id int64) {
	_, _ = r.db.Exec(`DELETE FROM device_links WHERE member_id = ? AND created_at < NOW() - INTERVAL `+dureeLiaison, id)
}

// DemanderLiaison : le nouvel appareil (verrouillé) dépose sa clé publique éphémère.
func (h *Handler) DemanderLiaison(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	var in struct {
		PublicKey string `json:"publicKey"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<10)).Decode(&in); err != nil || !cleValide(in.PublicKey) {
		httpx.Error(w, http.StatusBadRequest, "clé invalide")
		return
	}
	h.repo.purgerLiaisons(id)
	var n int
	_ = h.repo.db.QueryRow(`SELECT COUNT(*) FROM device_links WHERE member_id = ?`, id).Scan(&n)
	if n >= maxLiaisons {
		httpx.Error(w, http.StatusTooManyRequests, "Trop de demandes en cours : attends quelques minutes.")
		return
	}
	res, err := h.repo.db.Exec(`INSERT INTO device_links (member_id, new_pub) VALUES (?, ?)`, id, in.PublicKey)
	if err != nil {
		h.fail(w, err)
		return
	}
	lid, _ := res.LastInsertId()
	httpx.JSON(w, http.StatusCreated, map[string]int64{"id": lid})
}

// LiaisonsEnAttente : les demandes de mes appareils qui attendent une réponse (lues par l'appareil déjà déverrouillé).
func (h *Handler) LiaisonsEnAttente(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	h.repo.purgerLiaisons(id)
	rows, err := h.repo.db.Query(`SELECT id, new_pub FROM device_links WHERE member_id = ? AND reponse IS NULL ORDER BY id DESC`, id)
	if err != nil {
		h.fail(w, err)
		return
	}
	defer rows.Close()
	out := []demandeLiaison{}
	for rows.Next() {
		var d demandeLiaison
		if rows.Scan(&d.ID, &d.PublicKey) == nil {
			out = append(out, d)
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"demandes": out})
}

// RepondreLiaison : l'appareil déverrouillé dépose sa clé de chiffrement, chiffrée pour le nouvel appareil.
func (h *Handler) RepondreLiaison(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	var in struct {
		PublicKey string `json:"publicKey"`
		Blob      string `json:"blob"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in); err != nil || !cleValide(in.PublicKey) || in.Blob == "" || len(in.Blob) > maxBlobLiaison {
		httpx.Error(w, http.StatusBadRequest, "réponse invalide")
		return
	}
	res, err := h.repo.db.Exec(`UPDATE device_links SET resp_pub = ?, reponse = ? WHERE id = ? AND member_id = ? AND reponse IS NULL
		AND created_at >= NOW() - INTERVAL `+dureeLiaison, in.PublicKey, in.Blob, pathID(r, "id"), id)
	if err != nil {
		h.fail(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.Error(w, http.StatusNotFound, "Demande introuvable ou expirée.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ReponseLiaison : le nouvel appareil vient chercher la réponse (pas encore prête : pret = false).
func (h *Handler) ReponseLiaison(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	var pub, blob sql.NullString
	err := h.repo.db.QueryRow(`SELECT resp_pub, reponse FROM device_links WHERE id = ? AND member_id = ?
		AND created_at >= NOW() - INTERVAL `+dureeLiaison, pathID(r, "id"), id).Scan(&pub, &blob)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.Error(w, http.StatusNotFound, "Demande expirée.")
		return
	}
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"pret": blob.Valid, "publicKey": pub.String, "blob": blob.String})
}

// SupprimerLiaison : la demande est terminée ou abandonnée.
func (h *Handler) SupprimerLiaison(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	_, _ = h.repo.db.Exec(`DELETE FROM device_links WHERE id = ? AND member_id = ?`, pathID(r, "id"), id)
	w.WriteHeader(http.StatusNoContent)
}
