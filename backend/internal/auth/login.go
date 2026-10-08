package auth

import (
	"database/sql"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"samlink/backend/internal/httpx"
)

// Connexion avec l'e-mail et le mot de passe du site du club (profil.email, profil.mdpCrypte en bcrypt « $2y$ »).
// Sam Link ne modifie jamais le mot de passe : il se change sur le site du club.

const (
	maxEchecs     = 8                // essais ratés tolérés…
	fenetreEchecs = 15 * time.Minute // … par adresse IP et par e-mail sur cette durée
)

type Login struct {
	db   *sql.DB
	auth *AuthService
	vue  string

	mu     sync.Mutex
	echecs map[string][]time.Time
}

func NewLogin(db *sql.DB, a *AuthService, vue string) *Login {
	return &Login{db: db, auth: a, vue: vue, echecs: map[string][]time.Time{}}
}

func ipDe(r *http.Request) string {
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// bloque : trop d'échecs récents pour cette clé ?
func (l *Login) bloque(cles ...string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	limite := time.Now().Add(-fenetreEchecs)
	for _, k := range cles {
		var recents []time.Time
		for _, t := range l.echecs[k] {
			if t.After(limite) {
				recents = append(recents, t)
			}
		}
		l.echecs[k] = recents
		if len(recents) >= maxEchecs {
			return true
		}
	}
	return false
}

func (l *Login) echec(cles ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, k := range cles {
		l.echecs[k] = append(l.echecs[k], time.Now())
	}
}

func (l *Login) reussite(cles ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, k := range cles {
		delete(l.echecs, k)
	}
}

func (l *Login) Handle(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	email := strings.TrimSpace(req.Email)
	if email == "" || req.Password == "" {
		httpx.Error(w, http.StatusBadRequest, "e-mail et mot de passe obligatoires")
		return
	}
	cles := []string{"ip:" + ipDe(r), "mail:" + strings.ToLower(email)}
	if l.bloque(cles...) {
		httpx.Error(w, http.StatusTooManyRequests, "trop d'essais : réessaie dans un quart d'heure")
		return
	}

	// Une même adresse peut figurer sur plusieurs fiches (famille) : on essaie chacune.
	rows, err := l.db.Query(`SELECT id, password_hash, is_bureau FROM `+l.vue+` WHERE email = ?`, email)
	if err != nil {
		log.Printf("auth: connexion : %v", err)
		httpx.Error(w, http.StatusInternalServerError, "erreur serveur")
		return
	}
	type fiche struct {
		id     int64
		hash   string
		bureau bool
	}
	var fiches []fiche
	for rows.Next() {
		var f fiche
		if rows.Scan(&f.id, &f.hash, &f.bureau) == nil {
			fiches = append(fiches, f)
		}
	}
	rows.Close()

	for _, f := range fiches {
		if bcrypt.CompareHashAndPassword([]byte(strings.TrimSpace(f.hash)), []byte(req.Password)) != nil {
			continue
		}
		token, err := l.auth.IssueToken(f.id, f.bureau)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "erreur serveur")
			return
		}
		l.reussite(cles...)
		httpx.JSON(w, http.StatusOK, map[string]any{"token": token})
		return
	}
	l.echec(cles...)
	httpx.Error(w, http.StatusUnauthorized, "e-mail ou mot de passe incorrect, ou adhésion non active pour cette saison")
}
