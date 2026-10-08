package main

import (
	"log"
	"net/http"
	"time"

	"github.com/joho/godotenv"

	"samlink/backend/internal/annuaire"
	"samlink/backend/internal/config"
	"samlink/backend/internal/db"
	"samlink/backend/internal/httpapi"
)

func main() {
	_ = godotenv.Load()

	cfg := config.Load()

	conn, err := db.Connect(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer conn.Close()

	// Vue des adhérents de la saison (table profil du club), recréée avec les réglages du .env.
	if err := annuaire.CreerVue(conn, cfg); err != nil {
		log.Fatalf("annuaire : %v", err)
	}
	var n int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM ` + annuaire.Vue).Scan(&n); err == nil {
		log.Printf("annuaire : %d adhérents actifs (saison %d)", n, annuaire.SaisonCourante(cfg, time.Now()))
	}
	var tables int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages'`).Scan(&tables); err == nil && tables == 0 {
		log.Printf("ATTENTION : tables de la messagerie absentes, lancer d'abord : go run ./cmd/migrate")
	}

	router := httpapi.NewRouter(conn, cfg)

	log.Printf("Sam Link API listening on :%s", cfg.AppPort)
	if err := http.ListenAndServe(":"+cfg.AppPort, router); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
