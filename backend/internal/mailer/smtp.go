package mailer

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

// Envoi des e-mails : un client SMTP maison au-dessus de net/smtp, pour deux raisons.
//   - la réponse finale du serveur (« 250 2.0.0 Ok: queued as … ») est conservée : elle prouve que le message a été pris en
//     charge et sert de repère pour le retrouver ;
//   - le message est construit comme le veulent les filtres anti-spam stricts (Free, Orange…) : objet et nom d'expéditeur
//     encodés (RFC 2047), corps en quoted-printable, identifiant de message au domaine de l'expéditeur.

const delaiSMTP = 45 * time.Second

// configTLS : paramètres TLS de la connexion au serveur d'envoi (remplacé dans les tests par un certificat de test).
var configTLS = func(hote string) *tls.Config { return &tls.Config{ServerName: hote} }

// Expediteur : l'adresse d'envoi configurée (SMTP_FROM, avec ou sans nom affiché) et son nom affiché.
func (m *Mailer) expediteur() (*mail.Address, error) {
	a, err := mail.ParseAddress(strings.TrimSpace(m.cfg.SMTPFrom))
	if err != nil {
		return nil, fmt.Errorf("SMTP_FROM invalide (%q) : %v", m.cfg.SMTPFrom, err)
	}
	if a.Name == "" {
		a.Name = "SAM Paris 12"
	}
	return a, nil
}

// Infos : serveur et expéditeur utilisés (jamais le mot de passe), pour l'écran de diagnostic.
func (m *Mailer) Infos() (serveur, expediteur string) {
	serveur = m.cfg.SMTPHost + ":" + m.cfg.SMTPPort
	if a, err := m.expediteur(); err == nil {
		return serveur, a.String()
	}
	return serveur, m.cfg.SMTPFrom
}

func domaineDe(adresse string) string {
	if i := strings.LastIndex(adresse, "@"); i >= 0 {
		return adresse[i+1:]
	}
	return "samparis12.org"
}

func idMessage(domaine string) string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), hex.EncodeToString(buf), domaine)
}

// construire assemble un message multipart/alternative (texte + HTML).
func construire(de *mail.Address, to, subject, texte, html string) []byte {
	const frontiere = "samparis12-boundary-7f3a9c"
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", de.String())
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", subject))
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	fmt.Fprintf(&b, "Message-Id: %s\r\n", idMessage(domaineDe(de.Address)))
	fmt.Fprintf(&b, "Auto-Submitted: auto-generated\r\n")
	fmt.Fprintf(&b, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=\"%s\"\r\n\r\n", frontiere)
	for _, p := range []struct{ typ, corps string }{{"text/plain", texte}, {"text/html", html}} {
		fmt.Fprintf(&b, "--%s\r\nContent-Type: %s; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", frontiere, p.typ)
		w := quotedprintable.NewWriter(&b)
		_, _ = w.Write([]byte(p.corps))
		_ = w.Close()
		b.WriteString("\r\n")
	}
	fmt.Fprintf(&b, "--%s--\r\n", frontiere)
	return []byte(b.String())
}

// envoyer remet le message au serveur d'envoi et renvoie sa réponse finale (par exemple « 250 2.0.0 Ok: queued as 4F… »).
func (m *Mailer) envoyer(to, subject, texte, html string) (string, error) {
	de, err := m.expediteur()
	if err != nil {
		return "", err
	}
	msg := construire(de, to, subject, texte, html)
	hote, port := m.cfg.SMTPHost, m.cfg.SMTPPort
	adresse := net.JoinHostPort(hote, port)

	var conn net.Conn
	if port == "465" { // TLS dès la connexion
		conn, err = tls.DialWithDialer(&net.Dialer{Timeout: 20 * time.Second}, "tcp", adresse, configTLS(hote))
	} else {
		conn, err = net.DialTimeout("tcp", adresse, 20*time.Second)
	}
	if err != nil {
		return "", fmt.Errorf("connexion à %s impossible : %v", adresse, err)
	}
	_ = conn.SetDeadline(time.Now().Add(delaiSMTP))
	c, err := smtp.NewClient(conn, hote)
	if err != nil {
		conn.Close()
		return "", fmt.Errorf("dialogue avec %s : %v", adresse, err)
	}
	defer c.Close()

	if err := c.Hello(domaineDe(de.Address)); err != nil {
		return "", fmt.Errorf("EHLO refusé : %v", err)
	}
	if port != "465" {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return "", fmt.Errorf("le serveur %s n'offre pas STARTTLS : connexion non chiffrée refusée", adresse)
		}
		if err := c.StartTLS(configTLS(hote)); err != nil {
			return "", fmt.Errorf("STARTTLS refusé : %v", err)
		}
	}
	if err := c.Auth(smtp.PlainAuth("", m.cfg.SMTPUsername, m.cfg.SMTPPassword, hote)); err != nil {
		return "", fmt.Errorf("identifiants SMTP refusés : %v", err)
	}
	if err := c.Mail(de.Address); err != nil {
		return "", fmt.Errorf("expéditeur %s refusé par le serveur : %v", de.Address, err)
	}
	if err := c.Rcpt(to); err != nil {
		return "", fmt.Errorf("destinataire %s refusé par le serveur : %v", to, err)
	}

	// DATA, en gardant la réponse finale du serveur (celle de net/smtp est jetée)
	id, err := c.Text.Cmd("DATA")
	if err != nil {
		return "", err
	}
	c.Text.StartResponse(id)
	_, _, err = c.Text.ReadResponse(354)
	c.Text.EndResponse(id)
	if err != nil {
		return "", fmt.Errorf("DATA refusé : %v", err)
	}
	w := c.Text.DotWriter()
	if _, err := w.Write(msg); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	code, reponse, err := c.Text.ReadResponse(250)
	if err != nil {
		return "", fmt.Errorf("message refusé par le serveur : %v", err)
	}
	_ = c.Quit()
	return fmt.Sprintf("%d %s", code, strings.TrimSpace(reponse)), nil
}

// SendTest envoie un message de contrôle (écran de diagnostic du super administrateur).
func (m *Mailer) SendTest(to, par string) (string, error) {
	if !m.SMTPConfigure() {
		return "", fmt.Errorf("le serveur d'e-mail n'est pas configuré (SMTP_HOST et SMTP_USERNAME absents du fichier .env)")
	}
	texte := fmt.Sprintf("Bonjour,\r\n\r\nCeci est un message de test envoyé depuis Sam Link (SAM Paris 12) par %s.\r\n\r\nSi tu lis ce message, l'envoi des e-mails (notifications) fonctionne.\r\n\r\nSAM Paris 12", par)
	html := fmt.Sprintf(`<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;border:2px solid #DE3327;border-radius:14px;padding:24px;color:#1C1917;"><h2 style="margin:0 0 12px;color:#DE3327;text-transform:uppercase;">Test d'envoi</h2><p style="font-size:14px;line-height:1.6;">Ceci est un message de test envoyé depuis Sam Link (SAM Paris 12) par %s.</p><p style="font-size:14px;line-height:1.6;">Si tu lis ce message, l'envoi des e-mails (notifications) fonctionne.</p></div>`, par)
	return m.envoyer(to, "Sam Link — Test d'envoi d'e-mail", texte, html)
}
