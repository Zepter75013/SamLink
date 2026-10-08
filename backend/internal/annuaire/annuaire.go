// Package annuaire : les adhérents vus par Sam Link, lus dans la base du club (SamProd26db).
//
// Sam Link ne modifie jamais la table profil : elle passe par une vue, samlink_membres, recréée à chaque démarrage de
// l'API avec les réglages du .env (saison, rôles du bureau, adresse des photos). La vue présente les colonnes attendues
// par la messagerie : id, prenom, nom, email, password_hash, photo_path, groupe, sexe, is_bureau.
//
// Adhérent actif : une adhésion validée (adhesion.statutAdhesion = 'V') pour la saison en cours. La saison 2027 désigne
// 2026-2027 ; elle commence le 1er du mois SAISON_MOIS_DEBUT (septembre par défaut), sauf si SAISON la fixe.
package annuaire

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"

	"samlink/backend/internal/config"
)

const Vue = "samlink_membres"

// SaisonCourante : 2027 entre septembre 2026 et août 2027 (avec SAISON_MOIS_DEBUT = 9).
func SaisonCourante(cfg config.Config, t time.Time) int {
	if cfg.Saison > 0 {
		return cfg.Saison
	}
	debut := cfg.SaisonMoisDebut
	if debut < 1 || debut > 12 {
		debut = 9
	}
	if debut == 1 || int(t.Month()) >= debut {
		return t.Year() + boolInt(debut != 1)
	}
	return t.Year()
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// sqlTexte : chaîne SQL entre apostrophes (les valeurs viennent du .env, pas des adhérents).
func sqlTexte(s string) string {
	return "'" + strings.NewReplacer(`\`, `\\`, "'", "''").Replace(s) + "'"
}

// DefinitionVue : requête CREATE OR REPLACE VIEW de l'annuaire.
func DefinitionVue(cfg config.Config) string {
	saison := "YEAR(CURDATE()) + (MONTH(CURDATE()) >= " + strconv.Itoa(cfg.SaisonMoisDebut) + ")"
	if cfg.SaisonMoisDebut <= 1 || cfg.SaisonMoisDebut > 12 {
		saison = "YEAR(CURDATE())"
	}
	if cfg.Saison > 0 {
		saison = strconv.Itoa(cfg.Saison)
	}
	roles := make([]string, 0, len(cfg.BureauRoles))
	for _, r := range cfg.BureauRoles {
		roles = append(roles, strconv.FormatInt(r, 10))
	}
	if len(roles) == 0 {
		roles = []string{"-1"}
	}
	// profil.photo vaut par exemple « ../Contenus/uploads/profils/123.jpg » (chemin relatif du site actuel)
	photo := "''"
	if cfg.PhotosBaseURL != "" {
		photo = `CASE WHEN p.photo IS NULL OR p.photo = '' OR p.photo LIKE '%silhouette%' THEN ''
			ELSE CONCAT(` + sqlTexte(cfg.PhotosBaseURL+"/") + `, TRIM(LEADING '/' FROM TRIM(LEADING '../' FROM p.photo))) END`
	}
	return fmt.Sprintf(`CREATE OR REPLACE SQL SECURITY INVOKER VIEW %s AS
		SELECT p.id_profil AS id, p.prenom, p.nom, p.email, p.mdpCrypte AS password_hash,
			TRIM(p.numLicence) AS licence, TRIM(COALESCE(a.numLicence, '')) AS licence_saison,
			%s AS photo_path,
			CASE a.activite
				WHEN 'RU' THEN 'Running' WHEN 'RF' THEN 'Running'
				WHEN 'MS' THEN 'Marche Nordique Sportive' WHEN 'ML' THEN 'Marche Loisir'
				ELSE '' END AS groupe,
			p.sexe,
			COALESCE(p.idRole IN (%s), FALSE) AS is_bureau
		FROM profil p
		JOIN adhesion a ON a.idProfil = p.id_profil AND a.saison = %s AND a.statutAdhesion = 'V'`,
		Vue, photo, strings.Join(roles, ", "), saison)
}

// CreerVue (re)crée la vue de l'annuaire. Appelée au démarrage de l'API et par cmd/migrate.
func CreerVue(db *sql.DB, cfg config.Config) error {
	if _, err := db.Exec(DefinitionVue(cfg)); err != nil {
		return fmt.Errorf("vue %s : %w", Vue, err)
	}
	return nil
}
