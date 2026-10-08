package chat

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ---- Liens signés : les fichiers de la messagerie sont privés ; l'API remet à chaque adhérent autorisé un lien
// valable une semaine (les balises <img> et <video> ne peuvent pas envoyer d'en-tête d'authentification). ----

type Signer struct{ secret []byte }

func NewSigner(secret string) *Signer { return &Signer{secret: []byte("chat-files:" + secret)} }

const linkTTL = 7 * 24 * time.Hour

func (s *Signer) sign(id, exp int64) string {
	mac := hmac.New(sha256.New, s.secret)
	fmt.Fprintf(mac, "%d.%d", id, exp)
	return hex.EncodeToString(mac.Sum(nil))[:32]
}

// URL : chemin (relatif à l'hôte) de téléchargement d'une pièce jointe.
func (s *Signer) URL(id int64) string {
	exp := time.Now().Add(linkTTL).Unix()
	return fmt.Sprintf("/api/chat/files/%d?t=%d.%s", id, exp, s.sign(id, exp))
}

// Valid vérifie un jeton « expiration.signature ».
func (s *Signer) Valid(id int64, token string) bool {
	expStr, sig, ok := strings.Cut(token, ".")
	if !ok {
		return false
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	return hmac.Equal([]byte(sig), []byte(s.sign(id, exp)))
}

// ---- Types ----

type Attachment struct {
	ID     int64  `json:"id"`
	Kind   string `json:"kind"` // image | video | file
	Nom    string `json:"nom"`
	Mime   string `json:"mime"`
	Taille int64  `json:"taille"`
	URL    string `json:"url"`
}

type PollOption struct {
	ID    int64  `json:"id"`
	Texte string `json:"texte"`
	Votes int    `json:"votes"`
}

type Poll struct {
	Question string       `json:"question"`
	Multiple bool         `json:"multiple"`
	Options  []PollOption `json:"options"`
	Votants  int          `json:"votants"` // adhérents ayant voté
	Mine     []int64      `json:"mine"`    // options choisies par l'adhérent qui consulte
}

type EventInfo struct {
	Titre       string   `json:"titre"`
	Debut       string   `json:"debut"` // « 2026-10-12T19:30 »
	Lieu        string   `json:"lieu"`
	Description string   `json:"description"`
	Oui         int      `json:"oui"`
	PeutEtre    int      `json:"peutEtre"`
	Non         int      `json:"non"`
	Mine        string   `json:"mine"`  // oui | peut-etre | non | ""
	Venus       []string `json:"venus"` // prénoms de ceux qui viennent
}

type SavedFile struct {
	Kind, Path, Nom, Mime string
	Size                  int64
}

// previewLabel : aperçu d'un message dans la liste des discussions.
func previewLabel(kind, body, question, titre, firstAtt string) string {
	if estChiffre(body) { // jamais le contenu chiffré dans un aperçu
		if kind == "media" {
			return "🔒 Pièce jointe chiffrée"
		}
		return "🔒 Message chiffré"
	}
	switch kind {
	case "poll":
		return "📊 " + shorten(question)
	case "event":
		return "📅 " + shorten(titre)
	case "media":
		icon, label := "📄", "Document"
		switch firstAtt {
		case "audio":
			icon, label = "🎤", "Message vocal"
		case "image":
			icon, label = "📷", "Photo"
		case "video":
			icon, label = "🎥", "Vidéo"
		}
		if body != "" {
			return icon + " " + shorten(body)
		}
		return icon + " " + label
	}
	return shorten(body)
}

func inClause(ids []int64) (string, []any) {
	ph := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		ph[i] = "?"
		args[i] = id
	}
	return strings.Join(ph, ","), args
}

// enrich ajoute aux messages leurs pièces jointes, sondage et événement (chargés en lot). viewer = adhérent qui
// consulte (ses votes et sa réponse) ; 0 pour une diffusion à plusieurs destinataires.
func (r *Repository) enrich(msgs []Message, viewer int64) error {
	var mediaIDs, pollIDs, eventIDs []int64
	idx := map[int64]int{}
	for i, m := range msgs {
		idx[m.ID] = i
		if m.Deleted {
			continue
		}
		switch m.Kind {
		case "media":
			mediaIDs = append(mediaIDs, m.ID)
		case "poll":
			pollIDs = append(pollIDs, m.ID)
		case "event":
			eventIDs = append(eventIDs, m.ID)
		}
	}

	if len(mediaIDs) > 0 {
		in, args := inClause(mediaIDs)
		rows, err := r.db.Query(`SELECT id, message_id, kind, original_name, mime, size FROM chat_attachments WHERE message_id IN (`+in+`) ORDER BY id`, args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var a Attachment
			var mid int64
			if err := rows.Scan(&a.ID, &mid, &a.Kind, &a.Nom, &a.Mime, &a.Taille); err != nil {
				rows.Close()
				return err
			}
			a.URL = r.signer.URL(a.ID)
			msgs[idx[mid]].Attachments = append(msgs[idx[mid]].Attachments, a)
		}
		rows.Close()
	}

	if len(pollIDs) > 0 {
		in, args := inClause(pollIDs)
		rows, err := r.db.Query(`SELECT message_id, question, multiple FROM chat_polls WHERE message_id IN (`+in+`)`, args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var mid int64
			p := &Poll{Options: []PollOption{}, Mine: []int64{}}
			if err := rows.Scan(&mid, &p.Question, &p.Multiple); err != nil {
				rows.Close()
				return err
			}
			msgs[idx[mid]].Poll = p
		}
		rows.Close()

		rows, err = r.db.Query(`
			SELECT o.message_id, o.id, o.texte, COUNT(v.member_id)
			FROM chat_poll_options o LEFT JOIN chat_poll_votes v ON v.option_id = o.id
			WHERE o.message_id IN (`+in+`) GROUP BY o.id ORDER BY o.message_id, o.position`, args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var mid int64
			var o PollOption
			if err := rows.Scan(&mid, &o.ID, &o.Texte, &o.Votes); err != nil {
				rows.Close()
				return err
			}
			msgs[idx[mid]].Poll.Options = append(msgs[idx[mid]].Poll.Options, o)
		}
		rows.Close()

		rows, err = r.db.Query(`SELECT message_id, COUNT(DISTINCT member_id) FROM chat_poll_votes WHERE message_id IN (`+in+`) GROUP BY message_id`, args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var mid int64
			var n int
			if err := rows.Scan(&mid, &n); err != nil {
				rows.Close()
				return err
			}
			msgs[idx[mid]].Poll.Votants = n
		}
		rows.Close()

		if viewer > 0 {
			rows, err = r.db.Query(`SELECT message_id, option_id FROM chat_poll_votes WHERE member_id = ? AND message_id IN (`+in+`)`, append([]any{viewer}, args...)...)
			if err != nil {
				return err
			}
			for rows.Next() {
				var mid, oid int64
				if err := rows.Scan(&mid, &oid); err != nil {
					rows.Close()
					return err
				}
				msgs[idx[mid]].Poll.Mine = append(msgs[idx[mid]].Poll.Mine, oid)
			}
			rows.Close()
		}
	}

	if len(eventIDs) > 0 {
		in, args := inClause(eventIDs)
		rows, err := r.db.Query(`SELECT message_id, titre, DATE_FORMAT(debut, '%Y-%m-%dT%H:%i'), lieu, description FROM chat_events WHERE message_id IN (`+in+`)`, args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var mid int64
			e := &EventInfo{Venus: []string{}}
			if err := rows.Scan(&mid, &e.Titre, &e.Debut, &e.Lieu, &e.Description); err != nil {
				rows.Close()
				return err
			}
			msgs[idx[mid]].Event = e
		}
		rows.Close()

		rows, err = r.db.Query(`
			SELECT rv.message_id, rv.member_id, rv.reponse, m.prenom
			FROM chat_event_rsvps rv JOIN samlink_membres m ON m.id = rv.member_id
			WHERE rv.message_id IN (`+in+`) ORDER BY m.prenom`, args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var mid, member int64
			var rep, prenom string
			if err := rows.Scan(&mid, &member, &rep, &prenom); err != nil {
				rows.Close()
				return err
			}
			e := msgs[idx[mid]].Event
			switch rep {
			case "oui":
				e.Oui++
				if len(e.Venus) < 12 {
					e.Venus = append(e.Venus, prenom)
				}
			case "peut-etre":
				e.PeutEtre++
			case "non":
				e.Non++
			}
			if member == viewer {
				e.Mine = rep
			}
		}
		rows.Close()
	}
	return r.enrichSocial(msgs)
}

// MessageFull : un message avec ses pièces jointes, sondage et événement.
func (r *Repository) MessageFull(id, viewer int64) (*Message, error) {
	m, err := r.Message(id)
	if err != nil {
		return nil, err
	}
	list := []Message{*m}
	if err := r.enrich(list, viewer); err != nil {
		return nil, err
	}
	return &list[0], nil
}

func (r *Repository) validReply(roomID, replyTo int64) any {
	if replyTo <= 0 {
		return nil
	}
	var one int
	if err := r.db.QueryRow(`SELECT 1 FROM chat_messages WHERE id = ? AND room_id = ?`, replyTo, roomID).Scan(&one); err == nil {
		return replyTo
	}
	return nil
}

// AddMedia crée un message avec ses fichiers (déjà enregistrés sur le disque) et une légende facultative.
func (r *Repository) AddMedia(roomID, sender int64, caption string, replyTo int64, files []SavedFile) (*Message, error) {
	caption = strings.TrimSpace(caption)
	if estChiffre(caption) { // description chiffrée : légende, noms et types des fichiers
		if len([]rune(caption)) > maxChiffre {
			return nil, fmt.Errorf("description trop longue")
		}
	} else if len([]rune(caption)) > maxBody {
		return nil, fmt.Errorf("légende trop longue (%d caractères maximum)", maxBody)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("aucun fichier reçu")
	}
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO chat_messages (room_id, sender_id, body, kind, reply_to) VALUES (?, ?, ?, 'media', ?)`,
		roomID, sender, caption, r.validReply(roomID, replyTo))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	for _, f := range files {
		if _, err := tx.Exec(`INSERT INTO chat_attachments (message_id, kind, file_path, original_name, mime, size) VALUES (?, ?, ?, ?, ?, ?)`,
			id, f.Kind, f.Path, f.Nom, f.Mime, f.Size); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	_ = r.MarkRead(roomID, sender, id)
	return r.MessageFull(id, sender)
}

// AddPoll crée un sondage (2 à 12 options).
func (r *Repository) AddPoll(roomID, sender int64, question string, options []string, multiple bool, replyTo int64) (*Message, error) {
	question = strings.TrimSpace(question)
	if question == "" || len([]rune(question)) > 255 {
		return nil, fmt.Errorf("la question est obligatoire (255 caractères maximum)")
	}
	var clean []string
	seen := map[string]bool{}
	for _, o := range options {
		o = strings.TrimSpace(o)
		if o == "" || seen[strings.ToLower(o)] {
			continue
		}
		if len([]rune(o)) > 100 {
			return nil, fmt.Errorf("une option est trop longue (100 caractères maximum)")
		}
		seen[strings.ToLower(o)] = true
		clean = append(clean, o)
	}
	if len(clean) < 2 || len(clean) > 12 {
		return nil, fmt.Errorf("un sondage a entre 2 et 12 options différentes")
	}
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO chat_messages (room_id, sender_id, body, kind, reply_to) VALUES (?, ?, '', 'poll', ?)`,
		roomID, sender, r.validReply(roomID, replyTo))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if _, err := tx.Exec(`INSERT INTO chat_polls (message_id, question, multiple) VALUES (?, ?, ?)`, id, question, multiple); err != nil {
		return nil, err
	}
	for i, o := range clean {
		if _, err := tx.Exec(`INSERT INTO chat_poll_options (message_id, position, texte) VALUES (?, ?, ?)`, id, i, o); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	_ = r.MarkRead(roomID, sender, id)
	return r.MessageFull(id, sender)
}

// Vote remplace les votes de l'adhérent sur un sondage ; une liste vide retire son vote.
func (r *Repository) Vote(messageID, member int64, optionIDs []int64) (*Message, error) {
	m, err := r.Message(messageID)
	if err != nil {
		return nil, err
	}
	if m.Kind != "poll" || m.Deleted {
		return nil, ErrNotFound
	}
	var multiple bool
	if err := r.db.QueryRow(`SELECT multiple FROM chat_polls WHERE message_id = ?`, messageID).Scan(&multiple); err != nil {
		return nil, ErrNotFound
	}
	if !multiple && len(optionIDs) > 1 {
		return nil, fmt.Errorf("ce sondage n'accepte qu'une seule réponse")
	}
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM chat_poll_votes WHERE message_id = ? AND member_id = ?`, messageID, member); err != nil {
		return nil, err
	}
	done := map[int64]bool{}
	for _, oid := range optionIDs {
		if done[oid] {
			continue
		}
		done[oid] = true
		res, err := tx.Exec(`INSERT INTO chat_poll_votes (option_id, member_id, message_id) SELECT id, ?, message_id FROM chat_poll_options WHERE id = ? AND message_id = ?`, member, oid, messageID)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return nil, fmt.Errorf("option inconnue")
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r.MessageFull(messageID, member)
}

// AddEvent crée un événement. debut : « 2006-01-02T15:04 ».
func (r *Repository) AddEvent(roomID, sender int64, titre, debut, lieu, description string, replyTo int64) (*Message, error) {
	titre = strings.TrimSpace(titre)
	lieu = strings.TrimSpace(lieu)
	description = strings.TrimSpace(description)
	if titre == "" || len([]rune(titre)) > 150 {
		return nil, fmt.Errorf("le titre est obligatoire (150 caractères maximum)")
	}
	if len([]rune(lieu)) > 200 || len([]rune(description)) > 1000 {
		return nil, fmt.Errorf("lieu ou description trop long")
	}
	t, err := time.Parse("2006-01-02T15:04", debut)
	if err != nil {
		return nil, fmt.Errorf("date et heure invalides")
	}
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO chat_messages (room_id, sender_id, body, kind, reply_to) VALUES (?, ?, '', 'event', ?)`,
		roomID, sender, r.validReply(roomID, replyTo))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if _, err := tx.Exec(`INSERT INTO chat_events (message_id, titre, debut, lieu, description) VALUES (?, ?, ?, ?, ?)`,
		id, titre, t.Format("2006-01-02 15:04:00"), lieu, description); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	_ = r.MarkRead(roomID, sender, id)
	return r.MessageFull(id, sender)
}

// RSVP enregistre la réponse d'un adhérent à un événement ; "" retire sa réponse.
func (r *Repository) RSVP(messageID, member int64, reponse string) (*Message, error) {
	m, err := r.Message(messageID)
	if err != nil {
		return nil, err
	}
	if m.Kind != "event" || m.Deleted {
		return nil, ErrNotFound
	}
	switch reponse {
	case "":
		_, err = r.db.Exec(`DELETE FROM chat_event_rsvps WHERE message_id = ? AND member_id = ?`, messageID, member)
	case "oui", "peut-etre", "non":
		_, err = r.db.Exec(`INSERT INTO chat_event_rsvps (message_id, member_id, reponse) VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE reponse = VALUES(reponse)`, messageID, member, reponse)
	default:
		return nil, fmt.Errorf("réponse invalide")
	}
	if err != nil {
		return nil, err
	}
	return r.MessageFull(messageID, member)
}

// Attachment : une pièce jointe (chemin disque, type) à condition que son message existe encore.
func (r *Repository) AttachmentFile(id int64) (path, nom, mime, kind string, err error) {
	err = r.db.QueryRow(`
		SELECT a.file_path, a.original_name, a.mime, a.kind
		FROM chat_attachments a JOIN chat_messages m ON m.id = a.message_id
		WHERE a.id = ? AND m.deleted_at IS NULL`, id).Scan(&path, &nom, &mime, &kind)
	if err == sql.ErrNoRows {
		err = ErrNotFound
	}
	return
}
