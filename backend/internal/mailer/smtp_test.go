package mailer

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"

	"samlink/backend/internal/config"
)

// serveurSMTPDeTest : un petit serveur SMTP (STARTTLS + AUTH PLAIN) qui garde le message reçu.
func serveurSMTPDeTest(t *testing.T) (port string, recu chan string, racines *x509.CertPool) {
	cle, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	modele := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "127.0.0.1"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, IsCA: true, BasicConstraintsValid: true}
	der, _ := x509.CreateCertificate(rand.Reader, modele, modele, &cle.PublicKey, cle)
	cert := tls.Certificate{Certificate: [][]byte{der}, PrivateKey: cle}
	racines = x509.NewCertPool()
	c, _ := x509.ParseCertificate(der)
	racines.AddCert(c)

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	recu = make(chan string, 1)
	go func() {
		conn, err := l.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		lire := bufio.NewReader(conn)
		ecrire := func(c net.Conn, s string) { c.Write([]byte(s + "\r\n")) }
		ecrire(conn, "220 test ESMTP")
		var cx net.Conn = conn
		for {
			ligne, err := lire.ReadString('\n')
			if err != nil {
				return
			}
			cmd := strings.ToUpper(strings.TrimSpace(ligne))
			switch {
			case strings.HasPrefix(cmd, "EHLO"):
				if _, ok := cx.(*tls.Conn); ok {
					ecrire(cx, "250-test\r\n250 AUTH PLAIN")
				} else {
					ecrire(cx, "250-test\r\n250 STARTTLS")
				}
			case cmd == "STARTTLS":
				ecrire(cx, "220 prêt")
				tc := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{cert}})
				if tc.Handshake() != nil {
					return
				}
				cx = tc
				lire = bufio.NewReader(tc)
			case strings.HasPrefix(cmd, "AUTH"):
				ecrire(cx, "235 2.7.0 ok")
			case strings.HasPrefix(cmd, "MAIL"), strings.HasPrefix(cmd, "RCPT"):
				ecrire(cx, "250 ok")
			case cmd == "DATA":
				ecrire(cx, "354 go")
				var corps strings.Builder
				for {
					l, err := lire.ReadString('\n')
					if err != nil || l == ".\r\n" {
						break
					}
					corps.WriteString(l)
				}
				recu <- corps.String()
				ecrire(cx, "250 2.0.0 Ok: queued as ABC123")
			case cmd == "QUIT":
				ecrire(cx, "221 bye")
				return
			}
		}
	}()
	_, port, _ = net.SplitHostPort(l.Addr().String())
	return port, recu, racines
}

func TestEnvoiSMTPReponseEtMessage(t *testing.T) {
	port, recu, racines := serveurSMTPDeTest(t)
	anciennes := configTLS
	configTLS = func(hote string) *tls.Config { return &tls.Config{ServerName: hote, RootCAs: racines} }
	defer func() { configTLS = anciennes }()

	m := New(config.Config{SMTPHost: "127.0.0.1", SMTPPort: port, SMTPUsername: "u", SMTPPassword: "p", SMTPFrom: "contact@samparis12.org"})
	reponse, err := m.SendTest("laurent@free.fr", "Laurent")
	if err != nil {
		t.Fatalf("envoi : %v", err)
	}
	if reponse != "250 2.0.0 Ok: queued as ABC123" {
		t.Fatalf("réponse = %q", reponse)
	}
	msg := <-recu
	for _, attendu := range []string{
		"From: \"SAM Paris 12\" <contact@samparis12.org>",
		"To: laurent@free.fr",
		"Subject: =?utf-8?q?Sam_Link_=E2=80=94_Test_d'envoi_d'e-mail?=",
		"Content-Transfer-Encoding: quoted-printable",
		"@samparis12.org>",
		"Auto-Submitted: auto-generated",
	} {
		if !strings.Contains(msg, attendu) {
			t.Errorf("le message ne contient pas %q :\n%s", attendu, msg[:min(len(msg), 700)])
		}
	}
	if !strings.Contains(msg, "Laurent.") {
		t.Errorf("le nom de l'expéditeur est absent du message")
	}
}

func TestEnvoiSMTPSansSTARTTLSRefuse(t *testing.T) {
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	defer l.Close()
	go func() {
		c, err := l.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		r := bufio.NewReader(c)
		c.Write([]byte("220 x\r\n"))
		for {
			ligne, err := r.ReadString('\n')
			if err != nil {
				return
			}
			if strings.HasPrefix(strings.ToUpper(ligne), "EHLO") {
				c.Write([]byte("250 x\r\n"))
			}
		}
	}()
	_, port, _ := net.SplitHostPort(l.Addr().String())
	m := New(config.Config{SMTPHost: "127.0.0.1", SMTPPort: port, SMTPUsername: "u", SMTPPassword: "p", SMTPFrom: "x@y.fr"})
	if _, err := m.SendTest("a@b.fr", "x"); err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("erreur attendue sur STARTTLS, obtenu : %v", err)
	}
}
