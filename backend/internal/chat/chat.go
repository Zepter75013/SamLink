// Package chat : messagerie de l'espace adhérent (salons par groupe, salons créés, messages privés),
// avec diffusion en temps réel par événements serveur (SSE).
package chat

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"samlink/backend/internal/annuaire"
)

const (
	maxBody    = 2000
	pageSize   = 50
	maxMembers = 200
)

var (
	ErrForbidden   = errors.New("accès refusé")
	ErrNotFound    = errors.New("introuvable")
	ErrNotText     = errors.New("seuls les messages texte peuvent être modifiés")
	ErrRoomDeleted = errors.New("cette discussion a été supprimée de ton écran : seul l'administrateur peut la réactiver")
	ErrAlreadyRead = errors.New("ce message a déjà été lu : il ne peut plus être modifié ni supprimé")
)

// Person : l'adhérent qui fait la requête (rechargé en base à chaque appel : groupe, bureau et droits peuvent changer).
type Person struct {
	ID          int64
	Prenom      string
	Nom         string
	PhotoURL    string
	Groupe      string
	IsBureau    bool // fait partie du bureau (salon automatique « Bureau »)
	CanCreate   bool // droit « Créer des salons de discussion » (bureau, ou table chat_droits)
	CanModerate bool // droit « Modérer la messagerie » (bureau, ou table chat_droits)
}

type Last struct {
	ID        int64     `json:"id"`
	Auteur    string    `json:"auteur"`
	Texte     string    `json:"texte"`
	CreatedAt time.Time `json:"createdAt"`
}

type Room struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"` // auto | custom | dm
	Nom       string `json:"nom"`
	PhotoURL  string `json:"photoUrl"`
	OtherID   int64  `json:"otherId,omitempty"` // message privé : l'autre adhérent
	Members   int    `json:"members"`
	Unread    int    `json:"unread"`
	Last      *Last  `json:"last"`
	CanAdd    bool   `json:"canAdd"`
	Archived  bool   `json:"archived"`
	CanDelete bool   `json:"canDelete"`
}

type Reply struct {
	ID     int64  `json:"id"`
	Auteur string `json:"auteur"`
	Texte  string `json:"texte"`
}

type Message struct {
	ID          int64        `json:"id"`
	RoomID      int64        `json:"roomId"`
	SenderID    int64        `json:"senderId"`
	Auteur      string       `json:"auteur"`
	PhotoURL    string       `json:"photoUrl"`
	Texte       string       `json:"texte"`
	Deleted     bool         `json:"deleted"`
	Edited      bool         `json:"edited"`
	Kind        string       `json:"kind"` // text | media | poll | event
	Reply       *Reply       `json:"reply"`
	Attachments []Attachment `json:"attachments"`
	Poll        *Poll        `json:"poll"`
	Event       *EventInfo   `json:"event"`
	CreatedAt   time.Time    `json:"createdAt"`
}

type Repository struct {
	db     *sql.DB
	signer *Signer
}

func NewRepository(db *sql.DB, secret string) *Repository {
	return &Repository{db: db, signer: NewSigner(secret)}
}

func (r *Repository) Person(id int64) (*Person, error) {
	var p Person
	err := r.db.QueryRow(`
		SELECT id, prenom, nom, photo_path, groupe, is_bureau
		FROM samlink_membres WHERE id = ?`, id).
		Scan(&p.ID, &p.Prenom, &p.Nom, &p.PhotoURL, &p.Groupe, &p.IsBureau)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	d, err := annuaire.DroitsDe(r.db, id, p.IsBureau)
	if err != nil {
		return nil, err
	}
	p.CanCreate = d.CreerSalons
	p.CanModerate = d.Moderer
	return &p, nil
}

// Prédicat SQL : « l'adhérent (groupe ?, bureau ?, id ?) fait partie du salon r ».
const memberOfRoom = `(
	(r.kind = 'auto' AND (
		r.auto_rule = 'all'
		OR (r.auto_rule = 'running' AND ? = 'Running')
		OR (r.auto_rule = 'marche' AND ? IN ('Marche Nordique Sportive', 'Marche Loisir'))
		OR (r.auto_rule = 'bureau' AND ?)))
	OR EXISTS (SELECT 1 FROM chat_room_members cm WHERE cm.room_id = r.id AND cm.member_id = ?)
)`

func memberArgs(p *Person) []any { return []any{p.Groupe, p.Groupe, p.IsBureau, p.ID} }

func (r *Repository) roomCols() string {
	return `r.id, r.kind, COALESCE(r.auto_rule, ''), r.nom, COALESCE(r.created_by, 0)`
}

type roomRow struct {
	id        int64
	kind      string
	rule      string
	nom       string
	createdBy int64
}

func (r *Repository) loadRoom(id int64) (*roomRow, error) {
	var rr roomRow
	err := r.db.QueryRow(`SELECT id, kind, COALESCE(auto_rule, ''), nom, COALESCE(created_by, 0) FROM chat_rooms WHERE id = ?`, id).
		Scan(&rr.id, &rr.kind, &rr.rule, &rr.nom, &rr.createdBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &rr, err
}

// Access vérifie que l'adhérent fait partie du salon.
func (r *Repository) Access(roomID int64, p *Person) (*roomRow, error) {
	var one int
	args := memberArgs(p)
	args = append(args, roomID, p.ID)
	err := r.db.QueryRow(`SELECT 1 FROM chat_rooms r WHERE `+memberOfRoom+` AND r.id = ?
		AND NOT EXISTS (SELECT 1 FROM chat_room_prefs pr WHERE pr.room_id = r.id AND pr.member_id = ? AND pr.deleted = TRUE)`, args...).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrForbidden
	}
	if err != nil {
		return nil, err
	}
	return r.loadRoom(roomID)
}

func ruleMembersSQL(rule string) (string, []any) {
	switch rule {
	case "running":
		return `SELECT id FROM samlink_membres WHERE groupe = 'Running'`, nil
	case "marche":
		return `SELECT id FROM samlink_membres WHERE groupe IN ('Marche Nordique Sportive', 'Marche Loisir')`, nil
	case "bureau":
		return `SELECT id FROM samlink_membres WHERE is_bureau = TRUE`, nil
	default:
		return `SELECT id FROM samlink_membres`, nil
	}
}

// MemberIDs : tous les adhérents d'un salon (pour diffuser les événements).
func (r *Repository) MemberIDs(rr *roomRow) ([]int64, error) {
	var rows *sql.Rows
	var err error
	if rr.kind == "auto" {
		q, _ := ruleMembersSQL(rr.rule)
		rows, err = r.db.Query(q)
	} else {
		rows, err = r.db.Query(`SELECT member_id FROM chat_room_members WHERE room_id = ?`, rr.id)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *Repository) Rooms(p *Person) ([]Room, error) {
	// ordre des « ? » : sender_id, reads.member_id, prefs.member_id, puis le prédicat d'appartenance
	args := []any{p.ID, p.ID, p.ID}
	args = append(args, memberArgs(p)...)
	rows, err := r.db.Query(`
		SELECT `+r.roomCols()+`, COALESCE(pr.archived, FALSE),
			(SELECT COUNT(*) FROM chat_messages m
			  WHERE m.room_id = r.id AND m.id > COALESCE(rd.last_read_id, 0) AND m.sender_id <> ? AND m.deleted_at IS NULL)
		FROM chat_rooms r
		LEFT JOIN chat_reads rd ON rd.room_id = r.id AND rd.member_id = ?
		LEFT JOIN chat_room_prefs pr ON pr.room_id = r.id AND pr.member_id = ?
		WHERE `+memberOfRoom+` AND COALESCE(pr.deleted, FALSE) = FALSE`, args...)
	if err != nil {
		return nil, err
	}
	type tmp struct {
		rr       roomRow
		unread   int
		archived bool
	}
	var list []tmp
	for rows.Next() {
		var t tmp
		if err := rows.Scan(&t.rr.id, &t.rr.kind, &t.rr.rule, &t.rr.nom, &t.rr.createdBy, &t.archived, &t.unread); err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]Room, 0, len(list))
	for _, t := range list {
		room := Room{ID: t.rr.id, Kind: t.rr.kind, Nom: t.rr.nom, Unread: t.unread, Archived: t.archived,
			CanDelete: t.rr.kind != "auto"} // les salons automatiques du club peuvent être archivés, pas supprimés
		ids, err := r.MemberIDs(&t.rr)
		if err != nil {
			return nil, err
		}
		room.Members = len(ids)
		if t.rr.kind == "dm" {
			for _, id := range ids {
				if id != p.ID {
					room.OtherID = id
				}
			}
			if room.OtherID != 0 {
				_ = r.db.QueryRow(`SELECT CONCAT(prenom, ' ', nom), photo_path FROM samlink_membres WHERE id = ?`, room.OtherID).Scan(&room.Nom, &room.PhotoURL)
			}
		}
		room.CanAdd = t.rr.kind == "custom" && t.rr.createdBy == p.ID
		var l Last
		var kind, question, titre string
		var firstAtt sql.NullString
		err = r.db.QueryRow(`
			SELECT m.id, CONCAT(s.prenom, ' ', s.nom), m.body, m.kind, m.created_at,
			       COALESCE(p.question, ''), COALESCE(e.titre, ''),
			       (SELECT a.kind FROM chat_attachments a WHERE a.message_id = m.id ORDER BY a.id LIMIT 1)
			FROM chat_messages m
			JOIN samlink_membres s ON s.id = m.sender_id
			LEFT JOIN chat_polls p ON p.message_id = m.id
			LEFT JOIN chat_events e ON e.message_id = m.id
			WHERE m.room_id = ? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1`, t.rr.id).
			Scan(&l.ID, &l.Auteur, &l.Texte, &kind, &l.CreatedAt, &question, &titre, &firstAtt)
		if err == nil {
			l.Texte = previewLabel(kind, l.Texte, question, titre, firstAtt.String)
			room.Last = &l
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		out = append(out, room)
	}
	return out, nil
}

func shorten(s string) string {
	r := []rune(s)
	if len(r) > 140 {
		return string(r[:140]) + "…"
	}
	return s
}

const messageSelect = `
	SELECT m.id, m.room_id, m.sender_id, CONCAT(s.prenom, ' ', s.nom), s.photo_path,
	       m.body, m.deleted_at IS NOT NULL, m.edited_at IS NOT NULL, m.created_at, m.kind,
	       q.id, CONCAT(qs.prenom, ' ', qs.nom), q.body, q.deleted_at IS NOT NULL, q.kind, qp.question, qe.titre
	FROM chat_messages m
	JOIN samlink_membres s ON s.id = m.sender_id
	LEFT JOIN chat_messages q ON q.id = m.reply_to
	LEFT JOIN samlink_membres qs ON qs.id = q.sender_id
	LEFT JOIN chat_polls qp ON qp.message_id = q.id
	LEFT JOIN chat_events qe ON qe.message_id = q.id`

func scanMessage(scan func(...any) error) (*Message, error) {
	var m Message
	var qID sql.NullInt64
	var qAuteur, qTexte, qKind, qQuestion, qTitre sql.NullString
	var qDeleted sql.NullBool
	if err := scan(&m.ID, &m.RoomID, &m.SenderID, &m.Auteur, &m.PhotoURL, &m.Texte, &m.Deleted, &m.Edited, &m.CreatedAt, &m.Kind,
		&qID, &qAuteur, &qTexte, &qDeleted, &qKind, &qQuestion, &qTitre); err != nil {
		return nil, err
	}
	m.Attachments = []Attachment{}
	if m.Deleted {
		m.Texte = ""
	}
	if qID.Valid {
		m.Reply = &Reply{ID: qID.Int64, Auteur: qAuteur.String, Texte: replyLabel(qKind.String, qTexte.String, qQuestion.String, qTitre.String)}
		if qDeleted.Bool {
			m.Reply.Texte = ""
		}
	}
	return &m, nil
}

// replyLabel : texte affiché dans la citation d'une réponse, selon le type du message cité.
func replyLabel(kind, body, question, titre string) string {
	switch kind {
	case "poll":
		return "📊 " + shorten(question)
	case "event":
		return "📅 " + shorten(titre)
	case "media":
		if estChiffre(body) {
			return body // description chiffrée : le navigateur la déchiffre pour la citation
		}
		if body != "" {
			return "📎 " + shorten(body)
		}
		return "📎 Pièce jointe"
	}
	if estChiffre(body) {
		return body // message chiffré : le navigateur le déchiffre puis le raccourcit (tronqué, il serait illisible)
	}
	return shorten(body)
}

// Messages : une page de messages (les plus récents d'abord côté SQL, renvoyés du plus ancien au plus récent).
func (r *Repository) Messages(roomID, before, viewer int64) ([]Message, error) {
	q := messageSelect + ` WHERE m.room_id = ?`
	args := []any{roomID}
	if before > 0 {
		q += ` AND m.id < ?`
		args = append(args, before)
	}
	q += ` ORDER BY m.id DESC LIMIT ?`
	args = append(args, pageSize)
	rows, err := r.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := scanMessage(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	return out, r.enrich(out, viewer)
}

func (r *Repository) Message(id int64) (*Message, error) {
	m, err := scanMessage(r.db.QueryRow(messageSelect+` WHERE m.id = ?`, id).Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// OtherRead : jusqu'où l'autre adhérent d'un message privé a lu (coches bleues).
func (r *Repository) OtherRead(roomID, me int64) int64 {
	var n sql.NullInt64
	_ = r.db.QueryRow(`SELECT MAX(last_read_id) FROM chat_reads WHERE room_id = ? AND member_id <> ?`, roomID, me).Scan(&n)
	return n.Int64
}

func (r *Repository) AddMessage(roomID, sender int64, body string, replyTo int64) (*Message, error) {
	body = strings.TrimSpace(body)
	if !corpsValide(body) {
		return nil, fmt.Errorf("message vide ou trop long (%d caractères maximum)", maxBody)
	}
	var reply any
	if replyTo > 0 {
		var one int
		if err := r.db.QueryRow(`SELECT 1 FROM chat_messages WHERE id = ? AND room_id = ?`, replyTo, roomID).Scan(&one); err == nil {
			reply = replyTo
		}
	}
	res, err := r.db.Exec(`INSERT INTO chat_messages (room_id, sender_id, body, reply_to) VALUES (?, ?, ?, ?)`, roomID, sender, body, reply)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	// l'auteur a forcément lu ses propres messages
	_ = r.MarkRead(roomID, sender, id)
	return r.Message(id)
}

func (r *Repository) MarkRead(roomID, memberID, upTo int64) error {
	_, err := r.db.Exec(`
		INSERT INTO chat_reads (room_id, member_id, last_read_id) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, VALUES(last_read_id))`, roomID, memberID, upTo)
	return err
}

// readByOthers : au moins un autre adhérent a-t-il lu ce message ?
func (r *Repository) readByOthers(m *Message) (bool, error) {
	var one int
	err := r.db.QueryRow(`SELECT 1 FROM chat_reads WHERE room_id = ? AND member_id <> ? AND last_read_id >= ? LIMIT 1`,
		m.RoomID, m.SenderID, m.ID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// EditMessage : l'auteur peut corriger son message tant que personne d'autre ne l'a lu.
func (r *Repository) EditMessage(id int64, p *Person, body string) (*Message, error) {
	body = strings.TrimSpace(body)
	if !corpsValide(body) {
		return nil, fmt.Errorf("message vide ou trop long (%d caractères maximum)", maxBody)
	}
	m, err := r.Message(id)
	if err != nil {
		return nil, err
	}
	if m.SenderID != p.ID || m.Deleted {
		return nil, ErrForbidden
	}
	if m.Kind != "text" {
		return nil, ErrNotText
	}
	if read, err := r.readByOthers(m); err != nil {
		return nil, err
	} else if read {
		return nil, ErrAlreadyRead
	}
	if _, err := r.db.Exec(`UPDATE chat_messages SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`, body, id); err != nil {
		return nil, err
	}
	return r.Message(id)
}

// DeleteMessage : suppression logique. L'auteur ne peut supprimer que tant que personne d'autre n'a lu le message ;
// le bureau peut supprimer n'importe quel message (modération).
func (r *Repository) DeleteMessage(id int64, p *Person) (*Message, error) {
	m, err := r.Message(id)
	if err != nil {
		return nil, err
	}
	switch {
	case m.SenderID == p.ID:
		if read, err := r.readByOthers(m); err != nil {
			return nil, err
		} else if read && !p.CanModerate {
			return nil, ErrAlreadyRead
		}
	case !p.CanModerate:
		return nil, ErrForbidden
	}
	if _, err := r.db.Exec(`UPDATE chat_messages SET deleted_at = CURRENT_TIMESTAMP, body = '' WHERE id = ? AND deleted_at IS NULL`, id); err != nil {
		return nil, err
	}
	return m, nil
}

// OpenDM retrouve ou crée le message privé entre deux adhérents.
func (r *Repository) OpenDM(me, other int64) (int64, error) {
	if me == other {
		return 0, fmt.Errorf("impossible d'écrire à soi-même")
	}
	var one int
	if err := r.db.QueryRow(`SELECT 1 FROM samlink_membres WHERE id = ?`, other).Scan(&one); err != nil {
		return 0, ErrNotFound
	}
	lo, hi := me, other
	if lo > hi {
		lo, hi = hi, lo
	}
	key := fmt.Sprintf("%d-%d", lo, hi)
	var id int64
	err := r.db.QueryRow(`SELECT id FROM chat_rooms WHERE dm_key = ?`, key).Scan(&id)
	if err == nil {
		var gone bool
		if e := r.db.QueryRow(`SELECT deleted FROM chat_room_prefs WHERE room_id = ? AND member_id = ?`, id, me).Scan(&gone); e == nil && gone {
			return 0, ErrRoomDeleted
		}
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	res, err := r.db.Exec(`INSERT INTO chat_rooms (kind, dm_key, created_by) VALUES ('dm', ?, ?)`, key, me)
	if err != nil {
		// création simultanée par l'autre adhérent
		if err2 := r.db.QueryRow(`SELECT id FROM chat_rooms WHERE dm_key = ?`, key).Scan(&id); err2 == nil {
			return id, nil
		}
		return 0, err
	}
	id, _ = res.LastInsertId()
	if _, err := r.db.Exec(`INSERT IGNORE INTO chat_room_members (room_id, member_id) VALUES (?, ?), (?, ?)`, id, me, id, other); err != nil {
		return 0, err
	}
	return id, nil
}

func (r *Repository) CreateRoom(nom string, creator int64, memberIDs []int64) (int64, error) {
	nom = strings.TrimSpace(nom)
	if nom == "" || len([]rune(nom)) > 100 {
		return 0, fmt.Errorf("le nom du salon est obligatoire (100 caractères maximum)")
	}
	if len(memberIDs) > maxMembers {
		return 0, fmt.Errorf("trop de participants")
	}
	res, err := r.db.Exec(`INSERT INTO chat_rooms (kind, nom, created_by) VALUES ('custom', ?, ?)`, nom, creator)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	if err := r.AddMembers(id, append([]int64{creator}, memberIDs...)); err != nil {
		return 0, err
	}
	return id, nil
}

func (r *Repository) AddMembers(roomID int64, ids []int64) error {
	for _, id := range ids {
		if _, err := r.db.Exec(`INSERT IGNORE INTO chat_room_members (room_id, member_id) SELECT ?, id FROM samlink_membres WHERE id = ?`, roomID, id); err != nil {
			return err
		}
	}
	return nil
}

// Participants : liste des membres d'un salon (pour l'en-tête).
type Participant struct {
	ID       int64  `json:"id"`
	Nom      string `json:"nom"`
	PhotoURL string `json:"photoUrl"`
}

func (r *Repository) Participants(rr *roomRow) ([]Participant, error) {
	var rows *sql.Rows
	var err error
	if rr.kind == "auto" {
		q, _ := ruleMembersSQL(rr.rule)
		rows, err = r.db.Query(`SELECT id, CONCAT(prenom, ' ', nom), photo_path FROM samlink_membres WHERE id IN (` + q + `) ORDER BY prenom, nom`)
	} else {
		rows, err = r.db.Query(`
			SELECT m.id, CONCAT(m.prenom, ' ', m.nom), m.photo_path
			FROM chat_room_members cm JOIN samlink_membres m ON m.id = cm.member_id
			WHERE cm.room_id = ? ORDER BY m.prenom, m.nom`, rr.id)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Participant{}
	for rows.Next() {
		var p Participant
		if err := rows.Scan(&p.ID, &p.Nom, &p.PhotoURL); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetArchived range ou sort une discussion des archives de l'adhérent.
func (r *Repository) SetArchived(roomID, memberID int64, archived bool) error {
	_, err := r.db.Exec(`
		INSERT INTO chat_room_prefs (room_id, member_id, archived) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE archived = VALUES(archived)`, roomID, memberID, archived)
	return err
}

// HideRoom « supprime » la discussion pour l'adhérent : elle disparaît de son écran mais reste en base (drapeau
// deleted) ; seul l'administrateur de la base peut la réactiver, par requête SQL.
func (r *Repository) HideRoom(roomID, memberID int64) error {
	_, err := r.db.Exec(`
		INSERT INTO chat_room_prefs (room_id, member_id, deleted, deleted_at) VALUES (?, ?, TRUE, CURRENT_TIMESTAMP)
		ON DUPLICATE KEY UPDATE deleted = TRUE, deleted_at = CURRENT_TIMESTAMP`, roomID, memberID)
	return err
}

// Visible retire de la liste les adhérents qui ont supprimé la discussion (ils ne reçoivent plus rien).
func (r *Repository) Visible(roomID int64, ids []int64) []int64 {
	rows, err := r.db.Query(`SELECT member_id FROM chat_room_prefs WHERE room_id = ? AND deleted = TRUE`, roomID)
	if err != nil {
		return ids
	}
	defer rows.Close()
	gone := map[int64]bool{}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			gone[id] = true
		}
	}
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if !gone[id] {
			out = append(out, id)
		}
	}
	return out
}
