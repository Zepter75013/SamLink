package chat

import (
	"fmt"

	"samlink/backend/internal/notif"
)

// SetNotifier branche les notifications (push et e-mail) sur la messagerie.
func (h *Handler) SetNotifier(n *notif.Service) { h.notif = n }

// notifier prévient les participants d'un nouveau message (sauf son auteur et ceux qui ont supprimé la discussion).
func (h *Handler) notifier(rr *roomRow, msg *Message) {
	if h.notif == nil {
		return
	}
	ids, err := h.repo.MemberIDs(rr)
	if err != nil {
		return
	}
	var dest []int64
	for _, id := range h.repo.Visible(rr.id, ids) {
		if id != msg.SenderID {
			dest = append(dest, id)
		}
	}
	apercu := notif.Apercu(msg.Texte)
	if estChiffre(msg.Texte) {
		apercu = "🔒 Message chiffré" // jamais le contenu (ni son chiffré) dans les notifications
	}
	switch msg.Kind {
	case "media":
		if estChiffre(msg.Texte) {
			apercu = "🔒 Pièce jointe chiffrée"
			break
		}
		if apercu == "" {
			apercu = "Photo ou document"
		}
		apercu = "📎 " + apercu
	case "poll":
		if msg.Poll != nil {
			apercu = "📊 Sondage : " + notif.Apercu(msg.Poll.Question)
		}
	case "event":
		if msg.Event != nil {
			apercu = "📅 " + notif.Apercu(msg.Event.Titre)
		}
	}
	titre, corps := msg.Auteur, apercu
	if rr.kind != "dm" {
		titre = rr.nom
		if titre == "" {
			titre = "Messagerie"
		}
		corps = fmt.Sprintf("%s : %s", msg.Auteur, apercu)
	}
	h.notif.Notify(notif.Event{
		Kind: notif.Message, RefID: rr.id, Membres: dest, Titre: titre, Corps: corps, Grouper: true,
		URL: fmt.Sprintf("/?salon=%d", rr.id),
	})
}
