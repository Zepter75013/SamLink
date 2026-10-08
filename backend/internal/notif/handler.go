package notif

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"net/url"

	"samlink/backend/internal/auth"
	"samlink/backend/internal/httpx"
)

func (s *Service) moi(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, ok := auth.MemberIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "non authentifié")
	}
	return id, ok
}

// Config : le push est-il disponible, et avec quelle clé publique s'abonner.
func (s *Service) Config(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.moi(w, r); !ok {
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"push": s.PushActif(), "vapidPublicKey": s.cfg.VAPIDPublicKey})
}

// GetPrefs : préférences de l'adhérent et nombre d'appareils abonnés.
func (s *Service) GetPrefs(w http.ResponseWriter, r *http.Request) {
	id, ok := s.moi(w, r)
	if !ok {
		return
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM push_subscriptions WHERE member_id = ?`, id).Scan(&n)
	p := s.prefs([]int64{id})[id]
	httpx.JSON(w, http.StatusOK, map[string]any{"push": p.Push, "mail": p.Mail, "appareils": n, "delaiMail": s.DelaiEmail()})
}

// PutPrefs : enregistre les choix de l'adhérent.
func (s *Service) PutPrefs(w http.ResponseWriter, r *http.Request) {
	id, ok := s.moi(w, r)
	if !ok {
		return
	}
	var in Prefs
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil || in.Push == nil || in.Mail == nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	_, err := s.db.Exec(`INSERT INTO notif_prefs (member_id, push_messages, mail_messages) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE push_messages = VALUES(push_messages), mail_messages = VALUES(mail_messages)`,
		id, in.Push["messages"], in.Mail["messages"])
	if err != nil {
		log.Printf("notif: enregistrement des préférences : %v", err)
		httpx.Error(w, http.StatusInternalServerError, "erreur serveur")
		return
	}
	s.GetPrefs(w, r)
}

type abonnement struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	Appareil string `json:"appareil"`
}

func empreinte(endpoint string) string {
	h := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(h[:])
}

// Subscribe : enregistre l'appareil courant pour le push (un appareil passé à un autre adhérent lui est réattribué).
func (s *Service) Subscribe(w http.ResponseWriter, r *http.Request) {
	id, ok := s.moi(w, r)
	if !ok {
		return
	}
	var in abonnement
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	u, err := url.Parse(in.Endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || len(in.Endpoint) > 2000 || in.Keys.P256dh == "" || in.Keys.Auth == "" {
		httpx.Error(w, http.StatusBadRequest, "abonnement invalide")
		return
	}
	appareil := tronquer(in.Appareil, 120)
	_, err = s.db.Exec(`INSERT INTO push_subscriptions (member_id, endpoint_hash, endpoint, p256dh, auth, appareil) VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE member_id = VALUES(member_id), p256dh = VALUES(p256dh), auth = VALUES(auth), appareil = VALUES(appareil)`,
		id, empreinte(in.Endpoint), in.Endpoint, in.Keys.P256dh, in.Keys.Auth, appareil)
	if err != nil {
		log.Printf("notif: abonnement : %v", err)
		httpx.Error(w, http.StatusInternalServerError, "erreur serveur")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Unsubscribe : oublie l'appareil courant.
func (s *Service) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	id, ok := s.moi(w, r)
	if !ok {
		return
	}
	var in struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil || in.Endpoint == "" {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	s.db.Exec(`DELETE FROM push_subscriptions WHERE member_id = ? AND endpoint_hash = ?`, id, empreinte(in.Endpoint))
	w.WriteHeader(http.StatusNoContent)
}

// Test : envoie une notification d'essai sur tous les appareils abonnés de l'adhérent.
func (s *Service) Test(w http.ResponseWriter, r *http.Request) {
	id, ok := s.moi(w, r)
	if !ok {
		return
	}
	if !s.PushActif() {
		httpx.Error(w, http.StatusServiceUnavailable, "Les notifications push ne sont pas encore activées par le club.")
		return
	}
	n := s.pousser(id, Payload{Titre: "Sam Link", Corps: "Les notifications fonctionnent sur cet appareil.", URL: "/", Tag: "test"})
	httpx.JSON(w, http.StatusOK, map[string]int{"appareils": n})
}
