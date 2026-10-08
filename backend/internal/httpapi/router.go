package httpapi

import (
	"context"
	"database/sql"
	"net/http"

	"samlink/backend/internal/annuaire"
	"samlink/backend/internal/auth"
	"samlink/backend/internal/chat"
	"samlink/backend/internal/config"
	"samlink/backend/internal/httpx"
	"samlink/backend/internal/mailer"
	"samlink/backend/internal/notif"
)

func NewRouter(db *sql.DB, cfg config.Config) http.Handler {
	mux := http.NewServeMux()

	authService := auth.NewAuthService(cfg.JWTSecret)
	login := auth.NewLogin(db, authService, annuaire.Vue)
	annuaireHandler := annuaire.NewHandler(db)
	chatHandler := chat.NewHandler(chat.NewRepository(db, cfg.JWTSecret))

	// Notifications push et e-mail des nouveaux messages ; tâche de fond chaque minute.
	notifService := notif.New(db, cfg, mailer.New(cfg))
	notifService.Demarrer(context.Background())
	chatHandler.SetNotifier(notifService)
	chatHandler.SetICE(chat.ICE{STUN: cfg.STUNURLs, TURN: cfg.TURNURLs, TURNSecret: cfg.TURNSecret})

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Connexion avec l'e-mail et le mot de passe du site du club ; annuaire des adhérents de la saison.
	mux.HandleFunc("POST /api/auth/login", login.Handle)
	mux.HandleFunc("GET /api/me", authService.RequireAuth(annuaireHandler.Me))
	mux.HandleFunc("GET /api/membres", authService.RequireAuth(annuaireHandler.Liste))

	mux.HandleFunc("GET /api/notifications/config", authService.RequireAuth(notifService.Config))
	mux.HandleFunc("GET /api/notifications/prefs", authService.RequireAuth(notifService.GetPrefs))
	mux.HandleFunc("PUT /api/notifications/prefs", authService.RequireAuth(notifService.PutPrefs))
	mux.HandleFunc("POST /api/notifications/subscriptions", authService.RequireAuth(notifService.Subscribe))
	mux.HandleFunc("DELETE /api/notifications/subscriptions", authService.RequireAuth(notifService.Unsubscribe))
	mux.HandleFunc("POST /api/notifications/test", authService.RequireAuth(notifService.Test))

	// Messagerie (salons par groupe, salons créés, messages privés).
	mux.HandleFunc("GET /api/chat/stream", authService.RequireAuth(chatHandler.Stream))
	mux.HandleFunc("GET /api/chat/rooms/{id}/en-clair", authService.RequireAuth(chatHandler.EnClair))
	mux.HandleFunc("POST /api/chat/rooms/{id}/chiffrer-historique", authService.RequireAuth(chatHandler.ChiffrerHistorique))
	mux.HandleFunc("POST /api/chat/liaisons", authService.RequireAuth(chatHandler.DemanderLiaison))
	mux.HandleFunc("GET /api/chat/liaisons", authService.RequireAuth(chatHandler.LiaisonsEnAttente))
	mux.HandleFunc("POST /api/chat/liaisons/{id}/reponse", authService.RequireAuth(chatHandler.RepondreLiaison))
	mux.HandleFunc("GET /api/chat/liaisons/{id}", authService.RequireAuth(chatHandler.ReponseLiaison))
	mux.HandleFunc("DELETE /api/chat/liaisons/{id}", authService.RequireAuth(chatHandler.SupprimerLiaison))
	mux.HandleFunc("GET /api/chat/keys/me", authService.RequireAuth(chatHandler.MesCles))
	mux.HandleFunc("PUT /api/chat/keys/me", authService.RequireAuth(chatHandler.EnregistrerMesCles))
	mux.HandleFunc("DELETE /api/chat/keys/me", authService.RequireAuth(chatHandler.ReinitialiserMesCles))
	mux.HandleFunc("GET /api/chat/keys/{id}", authService.RequireAuth(chatHandler.CleDe))
	mux.HandleFunc("POST /api/chat/presence", authService.RequireAuth(chatHandler.Presence))
	mux.HandleFunc("GET /api/chat/rooms", authService.RequireAuth(chatHandler.Rooms))
	mux.HandleFunc("POST /api/chat/rooms", authService.RequireAuth(chatHandler.CreateRoom))
	mux.HandleFunc("POST /api/chat/dm", authService.RequireAuth(chatHandler.OpenDM))
	mux.HandleFunc("GET /api/chat/rooms/{id}/messages", authService.RequireAuth(chatHandler.Messages))
	mux.HandleFunc("POST /api/chat/rooms/{id}/messages", authService.RequireAuth(chatHandler.Send))
	mux.HandleFunc("POST /api/chat/rooms/{id}/attachments", authService.RequireAuth(chatHandler.SendMedia))
	mux.HandleFunc("POST /api/chat/rooms/{id}/polls", authService.RequireAuth(chatHandler.SendPoll))
	mux.HandleFunc("POST /api/chat/rooms/{id}/events", authService.RequireAuth(chatHandler.SendEvent))
	mux.HandleFunc("POST /api/chat/messages/{id}/vote", authService.RequireAuth(chatHandler.Vote))
	mux.HandleFunc("POST /api/chat/messages/{id}/rsvp", authService.RequireAuth(chatHandler.RSVP))
	mux.HandleFunc("GET /api/chat/files/{id}", chatHandler.File) // lien signé : pas d'en-tête Authorization
	mux.HandleFunc("POST /api/chat/rooms/{id}/read", authService.RequireAuth(chatHandler.Read))
	mux.HandleFunc("POST /api/chat/rooms/{id}/archive", authService.RequireAuth(chatHandler.Archive))
	mux.HandleFunc("DELETE /api/chat/rooms/{id}", authService.RequireAuth(chatHandler.DeleteRoom))
	mux.HandleFunc("POST /api/chat/rooms/{id}/members", authService.RequireAuth(chatHandler.AddMembers))
	mux.HandleFunc("PUT /api/chat/messages/{id}", authService.RequireAuth(chatHandler.Edit))
	mux.HandleFunc("DELETE /api/chat/messages/{id}", authService.RequireAuth(chatHandler.Delete))
	mux.HandleFunc("PUT /api/chat/messages/{id}/reaction", authService.RequireAuth(chatHandler.React))
	mux.HandleFunc("POST /api/chat/messages/{id}/forward", authService.RequireAuth(chatHandler.Forward))
	mux.HandleFunc("POST /api/chat/rooms/{id}/typing", authService.RequireAuth(chatHandler.Typing))
	mux.HandleFunc("PUT /api/chat/messages/{id}/pin", authService.RequireAuth(chatHandler.Pin))
	mux.HandleFunc("PUT /api/chat/messages/{id}/star", authService.RequireAuth(chatHandler.Star))
	mux.HandleFunc("GET /api/chat/messages/{id}/info", authService.RequireAuth(chatHandler.Info))
	mux.HandleFunc("GET /api/chat/stars", authService.RequireAuth(chatHandler.StarsList))
	mux.HandleFunc("PUT /api/chat/messages/{id}/live", authService.RequireAuth(chatHandler.LiveUpdate))
	mux.HandleFunc("DELETE /api/chat/messages/{id}/live", authService.RequireAuth(chatHandler.LiveStop))
	mux.HandleFunc("GET /api/chat/ice", authService.RequireAuth(chatHandler.ICEServers))
	mux.HandleFunc("POST /api/chat/rooms/{id}/call", authService.RequireAuth(chatHandler.Signal))
	mux.HandleFunc("POST /api/chat/rooms/{id}/mute", authService.RequireAuth(chatHandler.Mute))
	mux.HandleFunc("PUT /api/chat/rooms/{id}/photo", authService.RequireAuth(chatHandler.RoomPhotoSet))
	mux.HandleFunc("DELETE /api/chat/rooms/{id}/photo", authService.RequireAuth(chatHandler.RoomPhotoDelete))
	mux.HandleFunc("GET /api/chat/room-photos/{id}", chatHandler.RoomPhotoFile) // lien signé (balise img)

	return httpx.CORS(cfg.FrontendURL, mux)
}
