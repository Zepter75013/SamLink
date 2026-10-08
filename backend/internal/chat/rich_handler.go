package chat

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"samlink/backend/internal/httpx"
)

func (h *Handler) broadcast(rr *roomRow, event string, payload map[string]any) {
	if ids, err := h.repo.MemberIDs(rr); err == nil {
		h.hub.publish(h.repo.Visible(rr.id, ids), event, payload)
	}
}

// publishMessage : diffuse un nouveau message (sans données personnelles : votes et réponses de l'expéditeur retirés).
func (h *Handler) publishMessage(rr *roomRow, msg *Message) {
	shared := *msg
	if shared.Poll != nil {
		p := *shared.Poll
		p.Mine = []int64{}
		shared.Poll = &p
	}
	if shared.Event != nil {
		e := *shared.Event
		e.Mine = ""
		shared.Event = &e
	}
	h.broadcast(rr, "message", map[string]any{"roomId": rr.id, "message": &shared})
	h.notifier(rr, msg, nil)
}

// SendMedia : un message avec une ou plusieurs photos, vidéos ou documents (multipart : champs files, texte, replyTo).
func (h *Handler) SendMedia(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	chiffreDM := h.repo.DMChiffre(rr) // les fichiers y sont chiffrés par le navigateur
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadTotal)
	mr, err := r.MultipartReader()
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "envoi invalide")
		return
	}
	var texte string
	var replyTo int64
	var chiffre bool // le navigateur annonce des fichiers déjà chiffrés
	var saved []SavedFile
	fail := func(status int, msg string) {
		removeFiles(saved)
		httpx.Error(w, status, msg)
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			fail(http.StatusBadRequest, "envoi interrompu ou trop volumineux")
			return
		}
		switch part.FormName() {
		case "chiffre":
			b, _ := io.ReadAll(io.LimitReader(part, 4))
			chiffre = strings.TrimSpace(string(b)) == "1"
		case "texte":
			b, _ := io.ReadAll(io.LimitReader(part, 40<<10))
			texte = string(b)
		case "replyTo":
			b, _ := io.ReadAll(io.LimitReader(part, 32))
			replyTo, _ = strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
		case "files":
			if part.FileName() == "" {
				continue
			}
			if len(saved) >= maxFiles {
				fail(http.StatusBadRequest, "10 fichiers au maximum par message")
				return
			}
			if chiffre != chiffreDM {
				fail(http.StatusConflict, mediaChiffreMsg(chiffreDM))
				return
			}
			var f *SavedFile
			var err error
			if chiffre {
				f, err = saveChiffre(part)
			} else {
				f, err = saveUpload(part)
			}
			if err != nil {
				fail(http.StatusBadRequest, err.Error())
				return
			}
			saved = append(saved, *f)
		}
	}
	if chiffreDM && (len(saved) == 0 || !estChiffre(strings.TrimSpace(texte))) {
		fail(http.StatusConflict, mediaChiffreMsg(true))
		return
	}
	if !chiffreDM && estChiffre(strings.TrimSpace(texte)) {
		fail(http.StatusConflict, mediaChiffreMsg(false))
		return
	}
	msg, err := h.repo.AddMedia(rr.id, p.ID, texte, replyTo, saved)
	if err != nil {
		fail(http.StatusBadRequest, err.Error())
		return
	}
	h.publishMessage(rr, msg)
	httpx.JSON(w, http.StatusCreated, msg)
}

func (h *Handler) SendPoll(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	if h.refuserSiChiffre(w, rr) {
		return
	}
	var in struct {
		Question string   `json:"question"`
		Options  []string `json:"options"`
		Multiple bool     `json:"multiple"`
		ReplyTo  int64    `json:"replyTo"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	msg, err := h.repo.AddPoll(rr.id, p.ID, in.Question, in.Options, in.Multiple, in.ReplyTo)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	h.publishMessage(rr, msg)
	httpx.JSON(w, http.StatusCreated, msg)
}

func (h *Handler) SendEvent(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	if h.refuserSiChiffre(w, rr) {
		return
	}
	var in struct {
		Titre       string `json:"titre"`
		Debut       string `json:"debut"`
		Lieu        string `json:"lieu"`
		Description string `json:"description"`
		ReplyTo     int64  `json:"replyTo"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	msg, err := h.repo.AddEvent(rr.id, p.ID, in.Titre, in.Debut, in.Lieu, in.Description, in.ReplyTo)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	h.publishMessage(rr, msg)
	httpx.JSON(w, http.StatusCreated, msg)
}

// messageRoom : le message visé et le salon, à condition que l'adhérent y ait accès.
func (h *Handler) messageRoom(w http.ResponseWriter, r *http.Request, p *Person) (*Message, *roomRow) {
	m, err := h.repo.Message(pathID(r, "id"))
	if err != nil {
		h.fail(w, err)
		return nil, nil
	}
	rr, err := h.repo.Access(m.RoomID, p)
	if err != nil {
		h.fail(w, err)
		return nil, nil
	}
	return m, rr
}

func (h *Handler) Vote(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	m, rr := h.messageRoom(w, r, p)
	if m == nil {
		return
	}
	var in struct {
		OptionIDs []int64 `json:"optionIds"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	msg, err := h.repo.Vote(m.ID, p.ID, in.OptionIDs)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			h.fail(w, err)
			return
		}
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	shared := *msg.Poll
	shared.Mine = []int64{}
	h.broadcast(rr, "poll", map[string]any{"roomId": rr.id, "messageId": m.ID, "poll": &shared, "by": p.ID})
	httpx.JSON(w, http.StatusOK, msg)
}

func (h *Handler) RSVP(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	m, rr := h.messageRoom(w, r, p)
	if m == nil {
		return
	}
	var in struct {
		Reponse string `json:"reponse"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	msg, err := h.repo.RSVP(m.ID, p.ID, in.Reponse)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			h.fail(w, err)
			return
		}
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	shared := *msg.Event
	shared.Mine = ""
	h.broadcast(rr, "event", map[string]any{"roomId": rr.id, "messageId": m.ID, "event": &shared, "by": p.ID})
	httpx.JSON(w, http.StatusOK, msg)
}

// File sert une pièce jointe à qui présente un lien signé valide (sans en-tête d'authentification : balises img/video).
func (h *Handler) File(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	if !h.repo.signer.Valid(id, r.URL.Query().Get("t")) {
		httpx.Error(w, http.StatusForbidden, "lien expiré ou invalide")
		return
	}
	path, nom, mimeType, kind, err := h.repo.AttachmentFile(id)
	if err != nil {
		h.fail(w, err)
		return
	}
	f, err := os.Open(filepath.Join(uploadDir, path))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "fichier introuvable")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "fichier introuvable")
		return
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Disposition", contentDisposition(kind == "image" || kind == "video" || r.URL.Query().Get("inline") == "1" && mimeType == "application/pdf", nom))
	http.ServeContent(w, r, nom, st.ModTime(), f)
}

func mediaChiffreMsg(dmChiffre bool) string {
	if dmChiffre {
		return "Cette discussion est chiffrée de bout en bout : les fichiers doivent être chiffrés par ton navigateur. Recharge la page puis renvoie-les."
	}
	return "Le chiffrement de bout en bout n'est pas actif dans cette discussion : fichiers chiffrés refusés. Recharge la page."
}
