package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"samlink/backend/internal/auth"
	"samlink/backend/internal/httpx"
	"samlink/backend/internal/notif"
)

// Hub diffuse les événements en temps réel aux adhérents connectés (une seule instance de l'API : en mémoire).
type Hub struct {
	mu   sync.Mutex
	subs map[int64]map[chan []byte]struct{}
}

func NewHub() *Hub { return &Hub{subs: map[int64]map[chan []byte]struct{}{}} }

func (h *Hub) subscribe(id int64) (chan []byte, func()) {
	ch := make(chan []byte, 32)
	h.mu.Lock()
	if h.subs[id] == nil {
		h.subs[id] = map[chan []byte]struct{}{}
	}
	h.subs[id][ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs[id], ch)
		if len(h.subs[id]) == 0 {
			delete(h.subs, id)
		}
		h.mu.Unlock()
	}
}

func (h *Hub) publish(ids []int64, event string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	frame := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", event, data))
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, id := range ids {
		for ch := range h.subs[id] {
			select {
			case ch <- frame:
			default: // client trop lent : il se resynchronisera à la reconnexion
			}
		}
	}
}

type Handler struct {
	repo   *Repository
	hub    *Hub
	notif  *notif.Service // notifications push et e-mail (nil : désactivées)
	ice    ICE            // serveurs STUN/TURN des appels
	appels *appels        // appels qui sonnent encore
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo, hub: NewHub(), appels: &appels{parID: map[string]appelEnCours{}}}
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) *Person {
	id, _ := auth.MemberIDFromContext(r.Context())
	p, err := h.repo.Person(id)
	if err != nil {
		httpx.Error(w, http.StatusUnauthorized, "session invalide")
		return nil
	}
	return p
}

func (h *Handler) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotText):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrRoomDeleted):
		httpx.Error(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrAlreadyRead):
		httpx.Error(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrForbidden):
		httpx.Error(w, http.StatusForbidden, "accès refusé")
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "introuvable")
	default:
		log.Printf("chat: %v", err)
		httpx.Error(w, http.StatusInternalServerError, "erreur serveur")
	}
}

// failMsg : erreurs métier affichables telles quelles (409 pour une discussion supprimée, 400 sinon).
func (h *Handler) failMsg(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrRoomDeleted) {
		h.fail(w, err)
		return
	}
	httpx.Error(w, http.StatusBadRequest, err.Error())
}

func pathID(r *http.Request, name string) int64 {
	n, _ := strconv.ParseInt(r.PathValue(name), 10, 64)
	return n
}

func (h *Handler) room(w http.ResponseWriter, r *http.Request, p *Person) *roomRow {
	rr, err := h.repo.Access(pathID(r, "id"), p)
	if err != nil {
		h.fail(w, err)
		return nil
	}
	return rr
}

// Stream : flux d'événements (messages, lectures, suppressions, nouveaux salons) pour l'adhérent connecté.
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.MemberIDFromContext(r.Context())
	h.repo.Touch(id) // connecté à la messagerie
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Error(w, http.StatusInternalServerError, "flux non supporté")
		return
	}
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	fmt.Fprint(w, "retry: 3000\n\n: connecté\n\n")
	flusher.Flush()

	ch, cancel := h.hub.subscribe(id)
	defer cancel()
	h.relancerAppels(id) // un appel qui sonne encore (ouverture de Sam Link depuis la notification)
	tick := time.NewTicker(25 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case frame := <-ch:
			if _, err := w.Write(frame); err != nil {
				return
			}
			flusher.Flush()
		case <-tick.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

type roomsResponse struct {
	Rooms     []Room `json:"rooms"`
	CanCreate bool   `json:"canCreate"`
}

func (h *Handler) Rooms(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rooms, err := h.repo.Rooms(p)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, roomsResponse{Rooms: rooms, CanCreate: p.CanCreate})
}

type messagesResponse struct {
	Messages     []Message     `json:"messages"`
	Pinned       []Message     `json:"pinned"` // messages épinglés, le plus récent d'abord (premier chargement seulement)
	Participants []Participant `json:"participants"`
	OtherRead    int64         `json:"otherRead"`
	More         bool          `json:"more"`
}

func (h *Handler) Messages(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	msgs, err := h.repo.Messages(rr.id, before, p.ID)
	if err != nil {
		h.fail(w, err)
		return
	}
	resp := messagesResponse{Messages: msgs, More: len(msgs) == pageSize}
	if resp.Messages == nil {
		resp.Messages = []Message{}
	}
	if before == 0 {
		if resp.Participants, err = h.repo.Participants(rr); err != nil {
			h.fail(w, err)
			return
		}
		resp.OtherRead = h.repo.OtherRead(rr.id, p.ID)
		if resp.Pinned, err = h.repo.Pinned(rr.id, p.ID); err != nil {
			h.fail(w, err)
			return
		}
	}
	httpx.JSON(w, http.StatusOK, resp)
}

func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	var in struct {
		Texte     string  `json:"texte"`
		ReplyTo   int64   `json:"replyTo"`
		Mentions  []int64 `json:"mentions"`  // adhérents mentionnés (@Prénom Nom) : notifiés même en sourdine
		Forwarded bool    `json:"forwarded"` // texte transféré depuis une autre discussion
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 48<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	if !h.verifierChiffrement(w, rr, in.Texte) {
		return
	}
	msg, err := h.repo.AddMessage(rr.id, p.ID, in.Texte, in.ReplyTo)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.Forwarded && h.repo.MarkForwarded(msg.ID) == nil {
		msg.Forwarded = true
	}
	if ids, err := h.repo.MemberIDs(rr); err == nil {
		h.hub.publish(h.repo.Visible(rr.id, ids), "message", map[string]any{"roomId": rr.id, "message": msg})
	}
	h.notifier(rr, msg, h.mentionsValides(rr, p.ID, in.Mentions))
	httpx.JSON(w, http.StatusCreated, msg)
}

func (h *Handler) Read(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	var in struct {
		UpTo int64 `json:"upTo"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&in); err != nil || in.UpTo <= 0 {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	if err := h.repo.MarkRead(rr.id, p.ID, in.UpTo); err != nil {
		h.fail(w, err)
		return
	}
	h.notif.Vu(p.ID, rr.id, notif.Message) // discussion lue : plus d'e-mail à son sujet
	if ids, err := h.repo.MemberIDs(rr); err == nil {
		h.hub.publish(h.repo.Visible(rr.id, ids), "read", map[string]any{"roomId": rr.id, "memberId": p.ID, "upTo": in.UpTo})
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) Edit(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	var in struct {
		Texte string `json:"texte"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 48<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	if cible, err := h.repo.Message(pathID(r, "id")); err == nil {
		if rr, err := h.repo.loadRoom(cible.RoomID); err == nil && !h.verifierChiffrement(w, rr, in.Texte) {
			return
		}
	}
	msg, err := h.repo.EditMessage(pathID(r, "id"), p, in.Texte)
	if err != nil {
		if strings.HasPrefix(err.Error(), "message vide") {
			httpx.Error(w, http.StatusBadRequest, err.Error())
			return
		}
		h.fail(w, err)
		return
	}
	rr, err := h.repo.loadRoom(msg.RoomID)
	if err == nil {
		if ids, err := h.repo.MemberIDs(rr); err == nil {
			h.hub.publish(h.repo.Visible(rr.id, ids), "edit", map[string]any{"roomId": rr.id, "message": msg})
		}
	}
	httpx.JSON(w, http.StatusOK, msg)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	msg, err := h.repo.Message(pathID(r, "id"))
	if err != nil {
		h.fail(w, err)
		return
	}
	rr, err := h.repo.Access(msg.RoomID, p)
	if err != nil {
		h.fail(w, err)
		return
	}
	if _, err := h.repo.DeleteMessage(msg.ID, p); err != nil {
		h.fail(w, err)
		return
	}
	if ids, err := h.repo.MemberIDs(rr); err == nil {
		h.hub.publish(h.repo.Visible(rr.id, ids), "delete", map[string]any{"roomId": rr.id, "messageId": msg.ID})
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) OpenDM(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	var in struct {
		MemberID int64 `json:"memberId"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	id, err := h.repo.OpenDM(p.ID, in.MemberID)
	if err != nil {
		h.failMsg(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]int64{"roomId": id})
}

func (h *Handler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	if !p.CanCreate {
		httpx.Error(w, http.StatusForbidden, "tu n'as pas le droit de créer un salon")
		return
	}
	var in struct {
		Nom       string  `json:"nom"`
		MemberIDs []int64 `json:"memberIds"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	id, err := h.repo.CreateRoom(in.Nom, p.ID, in.MemberIDs)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	h.hub.publish(append([]int64{p.ID}, in.MemberIDs...), "rooms", map[string]int64{"roomId": id})
	httpx.JSON(w, http.StatusCreated, map[string]int64{"roomId": id})
}

func (h *Handler) AddMembers(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	if rr.kind != "custom" || rr.createdBy != p.ID {
		httpx.Error(w, http.StatusForbidden, "seul le créateur du salon peut ajouter des participants")
		return
	}
	var in struct {
		MemberIDs []int64 `json:"memberIds"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil || len(in.MemberIDs) == 0 || len(in.MemberIDs) > maxMembers {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	if err := h.repo.AddMembers(rr.id, in.MemberIDs); err != nil {
		h.fail(w, err)
		return
	}
	h.hub.publish(in.MemberIDs, "rooms", map[string]int64{"roomId": rr.id})
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Archive range la discussion dans les archives de l'adhérent connecté, ou l'en sort.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	var in struct {
		Archived bool `json:"archived"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	if err := h.repo.SetArchived(rr.id, p.ID, in.Archived); err != nil {
		h.fail(w, err)
		return
	}
	h.hub.publish([]int64{p.ID}, "rooms", map[string]int64{"roomId": rr.id}) // synchronise ses autres appareils
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// DeleteRoom « supprime » la discussion pour l'adhérent connecté (drapeau en base, réactivation par l'administrateur
// de la base uniquement). Les salons automatiques du club ne sont pas supprimables.
func (h *Handler) DeleteRoom(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	if rr.kind == "auto" {
		httpx.Error(w, http.StatusForbidden, "ce salon du club ne peut pas être supprimé, seulement archivé")
		return
	}
	if err := h.repo.HideRoom(rr.id, p.ID); err != nil {
		h.fail(w, err)
		return
	}
	h.hub.publish([]int64{p.ID}, "rooms", map[string]int64{"roomId": rr.id})
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// verifierChiffrement : dans une discussion privée dont les deux adhérents ont activé le chiffrement, seul un message chiffré
// est accepté ; ailleurs, un message chiffré est refusé (personne ne pourrait le lire). Écrit la réponse d'erreur si refus.
func (h *Handler) verifierChiffrement(w http.ResponseWriter, rr *roomRow, texte string) bool {
	chiffre := h.repo.DMChiffre(rr)
	switch {
	case chiffre && !estChiffre(texte):
		httpx.Error(w, http.StatusConflict, "Cette discussion est chiffrée de bout en bout : ton message n'a pas été envoyé en clair. Recharge la page puis renvoie-le.")
		return false
	case !chiffre && estChiffre(texte):
		httpx.Error(w, http.StatusConflict, "Le chiffrement de bout en bout n'est pas actif dans cette discussion (il n'existe que pour les messages privés dont les deux adhérents l'ont activé) : ton message n'a pas été envoyé. Recharge la page.")
		return false
	}
	return true
}

// refuserSiChiffre : pièces jointes, sondages et événements ne sont pas disponibles dans une discussion privée chiffrée.
func (h *Handler) refuserSiChiffre(w http.ResponseWriter, rr *roomRow) bool {
	if h.repo.DMChiffre(rr) {
		httpx.Error(w, http.StatusConflict, "Les pièces jointes, sondages et événements ne sont pas disponibles dans une discussion privée chiffrée de bout en bout.")
		return true
	}
	return false
}
