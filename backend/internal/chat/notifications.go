package chat

import (
	"fmt"
	"strings"

	"samlink/backend/internal/notif"
)

// SetNotifier branche les notifications (push et e-mail) sur la messagerie.
func (h *Handler) SetNotifier(n *notif.Service) { h.notif = n }

// notifier prévient les participants d'un nouveau message (sauf son auteur, ceux qui ont supprimé la discussion et ceux
// qui l'ont mise en sourdine). Les adhérents mentionnés sont prévenus même en sourdine.
func (h *Handler) notifier(rr *roomRow, msg *Message, mentions []int64) {
	if h.notif == nil {
		return
	}
	ids, err := h.repo.MemberIDs(rr)
	if err != nil {
		return
	}
	mentionne := map[int64]bool{}
	for _, id := range mentions {
		mentionne[id] = true
	}
	sourdine := h.repo.Muted(rr.id)
	var dest, destMention []int64
	for _, id := range h.repo.Visible(rr.id, ids) {
		switch {
		case id == msg.SenderID:
		case mentionne[id]:
			destMention = append(destMention, id)
		case !sourdine[id]:
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
			if len(msg.Attachments) > 0 && strings.HasPrefix(msg.Attachments[0].Mime, "audio/") {
				apercu = "Message vocal"
			}
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
	url := fmt.Sprintf("/?salon=%d", rr.id)
	if len(dest) > 0 {
		h.notif.Notify(notif.Event{Kind: notif.Message, RefID: rr.id, Membres: dest, Titre: titre, Corps: corps, Grouper: true, URL: url})
	}
	if len(destMention) > 0 {
		h.notif.Notify(notif.Event{Kind: notif.Message, RefID: rr.id, Membres: destMention, Titre: "📣 " + msg.Auteur + " t'a mentionné",
			Corps: corps, Grouper: true, URL: url})
	}
}
