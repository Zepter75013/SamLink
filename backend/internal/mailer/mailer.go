package mailer

import (
	"strings"

	"samlink/backend/internal/config"
)

// AdresseReservee : l'adresse appartient à un domaine réservé aux tests et à la démonstration (RFC 2606 : .test, .invalid,
// .example, .localhost, example.com/.org/.net — dont @demo-samparis12.test). Aucun e-mail n'est jamais envoyé vers elles :
// il partirait vers un domaine qui n'existe pas et reviendrait en erreur dans la boîte du club.
func AdresseReservee(adresse string) bool {
	adresse = strings.ToLower(strings.TrimSpace(adresse))
	if i := strings.LastIndex(adresse, "@"); i >= 0 {
		adresse = adresse[i+1:]
	}
	adresse = strings.TrimSuffix(adresse, ".")
	switch adresse {
	case "", "localhost", "example.com", "example.org", "example.net":
		return true
	}
	for _, fin := range []string{".test", ".invalid", ".example", ".localhost", ".example.com", ".example.org", ".example.net"} {
		if strings.HasSuffix(adresse, fin) {
			return true
		}
	}
	return false
}

// SMTPConfigure : un serveur d'envoi est renseigné (sinon aucun e-mail ne part : les messages sont seulement journalisés).
func (m *Mailer) SMTPConfigure() bool {
	return m.cfg.SMTPHost != "" && m.cfg.SMTPUsername != ""
}

type Mailer struct {
	cfg config.Config
}

func New(cfg config.Config) *Mailer {
	return &Mailer{cfg: cfg}
}
