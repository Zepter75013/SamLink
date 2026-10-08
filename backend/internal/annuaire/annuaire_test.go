package annuaire

import (
	"strings"
	"testing"
	"time"

	"samlink/backend/internal/config"
)

func TestSaisonCourante(t *testing.T) {
	cfg := config.Config{SaisonMoisDebut: 9}
	cas := []struct {
		date string
		want int
	}{
		{"2026-08-31", 2026},
		{"2026-09-01", 2027},
		{"2026-10-08", 2027},
		{"2027-01-15", 2027},
	}
	for _, c := range cas {
		d, _ := time.Parse("2006-01-02", c.date)
		if got := SaisonCourante(cfg, d); got != c.want {
			t.Errorf("%s : saison %d, attendu %d", c.date, got, c.want)
		}
	}
	cfg.Saison = 2030
	if got := SaisonCourante(cfg, time.Now()); got != 2030 {
		t.Errorf("saison fixée : %d", got)
	}
}

func TestDefinitionVue(t *testing.T) {
	v := DefinitionVue(config.Config{SaisonMoisDebut: 9, BureauRoles: []int64{9, 1}, PhotosBaseURL: "https://exemple.fr/l'club"})
	for _, attendu := range []string{
		"a.saison = YEAR(CURDATE()) + (MONTH(CURDATE()) >= 9)",
		"p.idRole IN (9, 1)",
		"'https://exemple.fr/l''club/'",
		"a.statutAdhesion = 'V'",
	} {
		if !strings.Contains(v, attendu) {
			t.Errorf("la vue ne contient pas %q :\n%s", attendu, v)
		}
	}
	if strings.Contains(v, "mdp ") || strings.Contains(v, "p.mdp,") {
		t.Errorf("la vue ne doit jamais lire la colonne mdp")
	}
}
