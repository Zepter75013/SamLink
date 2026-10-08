package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AppPort     string
	DBHost      string
	DBPort      string
	DBName      string
	DBUser      string
	DBPassword  string
	FrontendURL string

	JWTSecret string

	// Annuaire des adhérents, lu dans la base du club (table profil, adhésions de la saison).
	// Saison : 0 = calculée d'après la date (voir annuaire.SaisonCourante), sinon valeur fixe (ex. 2027 pour 2026-2027).
	Saison          int
	SaisonMoisDebut int     // mois où commence une nouvelle saison (9 = septembre)
	BureauRoles     []int64 // valeurs de profil.idRole qui font partie du salon « Bureau »
	PhotosBaseURL   string  // adresse publique des photos du site (profil.photo = ../Contenus/uploads/profils/…)

	// Notifications push (standard Web Push) : clés VAPID du club (go run ./cmd/vapid) et adresse de contact.
	// Sans clés, le push est désactivé ; les e-mails de notification fonctionnent quand même.
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
	NotifDelaiMail  int // minutes d'attente avant l'e-mail d'un message non lu (0 : immédiat)

	// Appels audio et vidéo : serveurs STUN et TURN (coturn, « use-auth-secret ») séparés par des virgules.
	STUNURLs   []string
	TURNURLs   []string
	TURNSecret string

	SMTPHost     string
	SMTPPort     string
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string
}

func Load() Config {
	return Config{
		AppPort:     getEnv("APP_PORT", "8080"),
		DBHost:      getEnv("DB_HOST", "127.0.0.1"),
		DBPort:      getEnv("DB_PORT", "3306"),
		DBName:      getEnv("DB_NAME", "SamProd26db"),
		DBUser:      getEnv("DB_USER", "samlink"),
		DBPassword:  os.Getenv("DB_PASSWORD"),
		FrontendURL: getEnv("FRONTEND_URL", "http://localhost:5173"),

		JWTSecret: getEnv("JWT_SECRET", "dev-insecure-secret-change-me"),

		Saison:          getInt("SAISON", 0),
		SaisonMoisDebut: getInt("SAISON_MOIS_DEBUT", 9),
		BureauRoles:     getInts("BUREAU_ROLES", []int64{9}),
		PhotosBaseURL:   strings.TrimRight(os.Getenv("PHOTOS_BASE_URL"), "/"),

		VAPIDPublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject:    getEnv("VAPID_SUBJECT", "contact@samparis12.org"),
		NotifDelaiMail:  getInt("NOTIF_DELAI_EMAIL_MIN", 60),

		STUNURLs:   getList("STUN_URLS", "stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478"),
		TURNURLs:   getList("TURN_URLS", ""),
		TURNSecret: os.Getenv("TURN_SECRET"),

		SMTPHost:     getEnv("SMTP_HOST", ""),
		SMTPPort:     getEnv("SMTP_PORT", "587"),
		SMTPUsername: getEnv("SMTP_USERNAME", ""),
		SMTPPassword: getEnv("SMTP_PASSWORD", ""),
		SMTPFrom:     getEnv("SMTP_FROM", ""),
	}
}

func (c Config) MySQLDSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4&loc=Local",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getInt(key string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil {
		return fallback
	}
	return n
}

// getInts lit une liste d'entiers séparés par des virgules (ex. « 1,2,9 »).
func getInts(key string, fallback []int64) []int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	var out []int64
	for _, s := range strings.Split(v, ",") {
		if n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
			out = append(out, n)
		}
	}
	if len(out) == 0 {
		return fallback
	}
	return out
}

// getList : liste séparée par des virgules (espaces ignorés).
func getList(key, fallback string) []string {
	var out []string
	for _, v := range strings.Split(getEnv(key, fallback), ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}
