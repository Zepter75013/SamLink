// Package notif : notifications des nouveaux messages de Sam Link, par push (navigateur, téléphone) et par e-mail.
//
// Un nouveau message crée une notification par destinataire : le push part tout de suite vers ses appareils abonnés ;
// l'e-mail n'est envoyé qu'après un délai (NOTIF_DELAI_EMAIL_MIN, une heure par défaut), et seulement si l'adhérent n'a
// pas lu la discussion entre-temps. Chaque adhérent choisit ce qu'il reçoit par canal (par défaut : e-mail activé, push
// actif dès qu'il a abonné un appareil).
package notif

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"samlink/backend/internal/config"
	"samlink/backend/internal/mailer"
)

const (
	Message = "message"

	delaiReessaiMail = 15 // minutes avant un nouvel essai après un échec d'envoi
)

// categorie : préférence qui gouverne un type de notification (Sam Link n'a que les messages).
func categorie(string) string { return "messages" }

// Event : ce qui vient de se passer, et pour qui.
type Event struct {
	Kind    string
	RefID   int64   // discussion
	Membres []int64 // destinataires (l'auteur de l'événement est à exclure par l'appelant)
	Titre   string
	Corps   string
	URL     string // chemin dans le site, ouvert au clic sur la notification
	Grouper bool   // messages : une seule notification en attente par discussion, avec le nombre de messages
}

type Service struct {
	db     *sql.DB
	cfg    config.Config
	mail   *mailer.Mailer
	mailMu sync.Mutex         // un seul envoi d'e-mails à la fois (tâche de fond et envoi immédiat)
	client webpush.HTTPClient // client HTTP du push (nil : client par défaut)
}

func New(db *sql.DB, cfg config.Config, mail *mailer.Mailer) *Service {
	return &Service{db: db, cfg: cfg, mail: mail}
}

// DelaiEmail : minutes d'attente avant l'e-mail d'une notification non vue (0 : immédiat).
func (s *Service) DelaiEmail() int {
	return max(s.cfg.NotifDelaiMail, 0)
}

// PushActif : les clés VAPID sont configurées.
func (s *Service) PushActif() bool {
	return s != nil && s.cfg.VAPIDPublicKey != "" && s.cfg.VAPIDPrivateKey != ""
}

// Prefs : choix d'un adhérent (valeurs par défaut s'il n'a rien réglé).
type Prefs struct {
	Push map[string]bool `json:"push"`
	Mail map[string]bool `json:"mail"`
}

var categories = []string{"messages"}

func prefsParDefaut() Prefs {
	p := Prefs{Push: map[string]bool{}, Mail: map[string]bool{}}
	for _, c := range categories {
		p.Push[c], p.Mail[c] = true, true
	}
	return p
}

func (s *Service) prefs(ids []int64) map[int64]Prefs {
	out := map[int64]Prefs{}
	for _, id := range ids {
		out[id] = prefsParDefaut()
	}
	if len(ids) == 0 {
		return out
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := s.db.Query(`SELECT member_id, push_messages, mail_messages
		FROM notif_prefs WHERE member_id IN (?`+strings.Repeat(",?", len(ids)-1)+`)`, args...)
	if err != nil {
		log.Printf("notif: préférences : %v", err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var pm, mm bool
		if rows.Scan(&id, &pm, &mm) == nil {
			out[id] = Prefs{Push: map[string]bool{"messages": pm}, Mail: map[string]bool{"messages": mm}}
		}
	}
	return out
}

// Notify enregistre et envoie une notification à chaque destinataire, sans ralentir la requête qui l'a déclenchée.
func (s *Service) Notify(e Event) {
	if s == nil || len(e.Membres) == 0 {
		return
	}
	go s.notify(e)
}

func (s *Service) notify(e Event) {
	vus := map[int64]bool{}
	ids := make([]int64, 0, len(e.Membres))
	for _, id := range e.Membres {
		if id > 0 && !vus[id] {
			vus[id] = true
			ids = append(ids, id)
		}
	}
	prefs := s.prefs(ids)
	cat := categorie(e.Kind)
	delai := s.DelaiEmail()
	for _, id := range ids {
		p := prefs[id]
		titre, corps, nombre := e.Titre, e.Corps, 1
		groupe := false
		if e.Grouper {
			// une notification de cette discussion attend encore d'être vue : on la complète au lieu d'en créer une autre
			var nid int64
			if err := s.db.QueryRow(`SELECT id, nombre FROM notifications WHERE member_id = ? AND kind = ? AND ref_id = ? AND seen_at IS NULL AND mailed_at IS NULL ORDER BY id DESC LIMIT 1`,
				id, e.Kind, e.RefID).Scan(&nid, &nombre); err == nil {
				nombre++
				groupe = true
				if _, err := s.db.Exec(`UPDATE notifications SET nombre = ?, titre = ?, corps = ? WHERE id = ?`, nombre, titre, corps, nid); err != nil {
					log.Printf("notif: regroupement : %v", err)
				}
			}
		}
		if !groupe {
			// échéance de l'e-mail : maintenant + délai réglé ; NULL si l'adhérent ne veut pas d'e-mail pour ce type
			if _, err := s.db.Exec(`INSERT INTO notifications (member_id, kind, ref_id, titre, corps, url, mail_due_at) VALUES (?, ?, ?, ?, ?, ?, IF(?, NOW() + INTERVAL ? MINUTE, NULL))`,
				id, e.Kind, e.RefID, tronquer(titre, 200), tronquer(corps, 500), e.URL, p.Mail[cat], delai); err != nil {
				log.Printf("notif: enregistrement : %v", err)
			}
		}
		if p.Push[cat] && s.PushActif() {
			if nombre > 1 {
				corps = fmt.Sprintf("%d nouveaux messages · %s", nombre, corps)
			}
			s.pousser(id, Payload{Titre: titre, Corps: corps, URL: e.URL, Tag: fmt.Sprintf("%s-%d", e.Kind, e.RefID)})
		}
	}
	if delai == 0 {
		s.envoyerEmails() // délai « immédiat » : pas d'attente de la minute suivante
	}
}

// Payload : contenu reçu par le service worker du site (public/sw.js).
type Payload struct {
	Titre string `json:"titre"`
	Corps string `json:"corps"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
}

// pousser envoie le push à tous les appareils abonnés de l'adhérent ; un abonnement expiré ou révoqué est oublié.
// Renvoie le nombre d'appareils atteints.
func (s *Service) pousser(memberID int64, p Payload) int {
	rows, err := s.db.Query(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE member_id = ?`, memberID)
	if err != nil {
		log.Printf("notif: abonnements : %v", err)
		return 0
	}
	type abo struct {
		id                     int64
		endpoint, p256dh, auth string
	}
	var abos []abo
	for rows.Next() {
		var a abo
		if rows.Scan(&a.id, &a.endpoint, &a.p256dh, &a.auth) == nil {
			abos = append(abos, a)
		}
	}
	rows.Close()
	corps, _ := json.Marshal(p)
	ok := 0
	for _, a := range abos {
		res, err := webpush.SendNotification(corps, &webpush.Subscription{Endpoint: a.endpoint, Keys: webpush.Keys{P256dh: a.p256dh, Auth: a.auth}}, &webpush.Options{
			Subscriber:      strings.TrimPrefix(s.cfg.VAPIDSubject, "mailto:"),
			VAPIDPublicKey:  s.cfg.VAPIDPublicKey,
			VAPIDPrivateKey: s.cfg.VAPIDPrivateKey,
			TTL:             24 * 3600,
			Urgency:         webpush.UrgencyHigh,
			HTTPClient:      s.client,
		})
		if err != nil {
			log.Printf("notif: push vers l'appareil %d : %v", a.id, err)
			continue
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		switch {
		case res.StatusCode == 404 || res.StatusCode == 410: // abonnement expiré ou retiré par l'adhérent
			s.db.Exec(`DELETE FROM push_subscriptions WHERE id = ?`, a.id)
		case res.StatusCode >= 400:
			log.Printf("notif: push vers l'appareil %d refusé (%d)", a.id, res.StatusCode)
		default:
			ok++
		}
	}
	return ok
}

// Vu : l'adhérent a vu ces éléments (discussion lue, écran ouvert) ; plus d'e-mail à leur sujet.
// refID = 0 : toutes les notifications de ces types.
func (s *Service) Vu(memberID int64, refID int64, kinds ...string) {
	if s == nil || len(kinds) == 0 {
		return
	}
	args := []any{memberID}
	for _, k := range kinds {
		args = append(args, k)
	}
	q := `UPDATE notifications SET seen_at = NOW() WHERE member_id = ? AND seen_at IS NULL AND kind IN (?` + strings.Repeat(",?", len(kinds)-1) + `)`
	if refID > 0 {
		q += ` AND ref_id = ?`
		args = append(args, refID)
	}
	if _, err := s.db.Exec(q, args...); err != nil {
		log.Printf("notif: vu : %v", err)
	}
}

// Demarrer lance la tâche de fond (chaque minute) : e-mails des notifications non vues.
func (s *Service) Demarrer(ctx context.Context) {
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			s.envoyerEmails()
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
}

func (s *Service) envoyerEmails() {
	s.mailMu.Lock()
	defer s.mailMu.Unlock()
	rows, err := s.db.Query(`SELECT n.id, n.member_id, n.kind, n.titre, n.corps, n.url, n.nombre, m.email, m.prenom
		FROM notifications n JOIN samlink_membres m ON m.id = n.member_id
		WHERE n.mailed_at IS NULL AND n.seen_at IS NULL AND n.mail_due_at IS NOT NULL AND n.mail_due_at <= NOW()
		ORDER BY n.member_id, n.id LIMIT 500`)
	if err != nil {
		log.Printf("notif: e-mails en attente : %v", err)
		return
	}
	type ligne struct {
		id   int64
		kind string
		item mailer.NotifItem
	}
	parMembre := map[int64][]ligne{}
	adresses := map[int64][2]string{}
	var ordre []int64
	for rows.Next() {
		var l ligne
		var mid int64
		var url, email, prenom string
		var nombre int
		if rows.Scan(&l.id, &mid, &l.kind, &l.item.Titre, &l.item.Corps, &url, &nombre, &email, &prenom) != nil {
			continue
		}
		if nombre > 1 {
			l.item.Corps = fmt.Sprintf("%d nouveaux messages · dernier : %s", nombre, l.item.Corps)
		}
		l.item.URL = strings.TrimRight(s.cfg.FrontendURL, "/") + url
		if _, ok := parMembre[mid]; !ok {
			ordre = append(ordre, mid)
		}
		parMembre[mid] = append(parMembre[mid], l)
		adresses[mid] = [2]string{email, prenom}
	}
	rows.Close()
	prefs := s.prefs(ordre)
	delai := s.DelaiEmail()
	profil := strings.TrimRight(s.cfg.FrontendURL, "/") + "/?reglages=notifications"
	for _, mid := range ordre {
		var items []mailer.NotifItem
		var ids, ignores []any
		for _, l := range parMembre[mid] {
			if prefs[mid].Mail[categorie(l.kind)] { // l'adhérent peut avoir désactivé ces e-mails entre-temps
				items = append(items, l.item)
				ids = append(ids, l.id)
			} else {
				ignores = append(ignores, l.id)
			}
		}
		if len(ignores) > 0 {
			s.db.Exec(`UPDATE notifications SET mail_due_at = NULL WHERE id IN (?`+strings.Repeat(",?", len(ignores)-1)+`)`, ignores...)
		}
		if len(items) == 0 {
			continue
		}
		a := adresses[mid]
		if mailer.AdresseReservee(a[0]) { // adresse de démonstration ou de test : jamais d'e-mail, et plus rien à envoyer
			s.db.Exec(`UPDATE notifications SET mail_due_at = NULL WHERE id IN (?`+strings.Repeat(",?", len(ids)-1)+`)`, ids...)
			continue
		}
		if _, err := s.mail.SendNotifications(a[0], a[1], items, profil, delai); err != nil {
			log.Printf("notif: e-mail pour l'adhérent %d : %v (nouvel essai dans %d min)", mid, err, delaiReessaiMail)
			s.db.Exec(`UPDATE notifications SET mail_due_at = NOW() + INTERVAL ? MINUTE WHERE id IN (?`+strings.Repeat(",?", len(ids)-1)+`)`, append([]any{delaiReessaiMail}, ids...)...)
			continue
		}
		s.db.Exec(`UPDATE notifications SET mailed_at = NOW() WHERE id IN (?`+strings.Repeat(",?", len(ids)-1)+`)`, ids...)
	}
}

func tronquer(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	return string(r[:n-1]) + "…"
}

// Apercu : début d'un texte pour le corps d'une notification.
func Apercu(s string) string {
	return tronquer(strings.Join(strings.Fields(s), " "), 140)
}
