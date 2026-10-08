package auth

import (
	"context"

	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"samlink/backend/internal/httpx"
)

type contextKey string

const memberIDContextKey contextKey = "memberID"
const isBureauContextKey contextKey = "isBureau"

type claims struct {
	MemberID int64 `json:"memberId"`
	IsBureau bool  `json:"isBureau"`
	jwt.RegisteredClaims
}

// AuthService émet et vérifie les jetons JWT de session pour l'espace adhérent.
type AuthService struct {
	secret []byte
}

func NewAuthService(secret string) *AuthService {
	return &AuthService{secret: []byte(secret)}
}

func (a *AuthService) IssueToken(memberID int64, isBureau bool) (string, error) {
	c := claims{
		MemberID: memberID,
		IsBureau: isBureau,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return token.SignedString(a.secret)
}

func (a *AuthService) parse(tokenString string) (*claims, error) {
	var c claims
	token, err := jwt.ParseWithClaims(tokenString, &c, func(t *jwt.Token) (any, error) {
		return a.secret, nil
	})
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("jeton invalide")
	}
	return &c, nil
}

// RequireAuth protège un handler : exige un jeton "Authorization: Bearer <token>" valide.
func (a *AuthService) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		token, ok := strings.CutPrefix(authHeader, "Bearer ")
		if !ok || token == "" {
			httpx.Error(w, http.StatusUnauthorized, "non authentifié")
			return
		}
		c, err := a.parse(token)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "session invalide ou expirée")
			return
		}
		ctx := context.WithValue(r.Context(), memberIDContextKey, c.MemberID)
		ctx = context.WithValue(ctx, isBureauContextKey, c.IsBureau)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

// RequireBureau protege un handler reserve aux membres du bureau
// (is_bureau) : exige une authentification valide et le statut bureau.
func (a *AuthService) RequireBureau(next http.HandlerFunc) http.HandlerFunc {
	return a.RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		if isBureau, _ := IsBureauFromContext(r.Context()); !isBureau {
			httpx.Error(w, http.StatusForbidden, "reserve aux membres du bureau")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func MemberIDFromContext(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(memberIDContextKey).(int64)
	return id, ok
}

func IsBureauFromContext(ctx context.Context) (bool, bool) {
	v, ok := ctx.Value(isBureauContextKey).(bool)
	return v, ok
}

// MemberIDFromRequest identifie l'adhérent d'une requête d'après son jeton (utilisé par le journal d'activité,
// avant même que RequireAuth ait pu poser l'identifiant dans le contexte).
func (a *AuthService) MemberIDFromRequest(r *http.Request) (int64, bool) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || token == "" {
		return 0, false
	}
	c, err := a.parse(token)
	if err != nil {
		return 0, false
	}
	return c.MemberID, true
}
