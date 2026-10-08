package chat

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"samlink/backend/internal/httpx"
	"samlink/backend/internal/notif"
)

// ---- Appels audio et vidéo (Sam Link 1.5) ----
// Les appels passent directement d'un navigateur à l'autre (WebRTC, chiffré de bout en bout par DTLS-SRTP). L'API ne fait que
// transmettre la « signalisation » (offre, réponse, candidats réseau, raccrocher) entre les deux adhérents d'un message privé,
// et fournir les serveurs STUN/TURN qui permettent aux deux appareils de se joindre. Rien n'est enregistré en base.

const sonnerie = 45 * time.Second // durée de sonnerie avant « pas de réponse »

// ICE : serveurs STUN (découverte de l'adresse publique) et TURN (relais quand les deux appareils ne peuvent pas se joindre
// directement, par exemple derrière certains réseaux 4G). TURN : coturn avec « use-auth-secret » (identifiants temporaires).
type ICE struct {
	STUN       []string
	TURN       []string
	TURNSecret string
}

func (h *Handler) SetICE(ice ICE) { h.ice = ice }

type iceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// ICEServers : GET /api/chat/ice — serveurs à donner à RTCPeerConnection (identifiants TURN valables 12 heures).
func (h *Handler) ICEServers(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	servers := []iceServer{}
	if len(h.ice.STUN) > 0 {
		servers = append(servers, iceServer{URLs: h.ice.STUN})
	}
	if len(h.ice.TURN) > 0 && h.ice.TURNSecret != "" {
		user := fmt.Sprintf("%d:%d", time.Now().Add(12*time.Hour).Unix(), p.ID)
		mac := hmac.New(sha1.New, []byte(h.ice.TURNSecret))
		mac.Write([]byte(user))
		servers = append(servers, iceServer{URLs: h.ice.TURN, Username: user, Credential: base64.StdEncoding.EncodeToString(mac.Sum(nil))})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"iceServers": servers})
}

// appelEnCours : une offre qui sonne encore, rejouée à l'appelé s'il ouvre Sam Link pendant la sonnerie (après une notification).
type appelEnCours struct {
	appele  int64
	payload map[string]any
	fin     time.Time
}

type appels struct {
	mu    sync.Mutex
	parID map[string]appelEnCours // callId -> offre
}

func (a *appels) garder(callID string, c appelEnCours) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	for id, x := range a.parID {
		if now.After(x.fin) {
			delete(a.parID, id)
		}
	}
	a.parID[callID] = c
}

func (a *appels) oublier(callID string) {
	a.mu.Lock()
	delete(a.parID, callID)
	a.mu.Unlock()
}

func (a *appels) pour(member int64) []map[string]any {
	a.mu.Lock()
	defer a.mu.Unlock()
	var out []map[string]any
	now := time.Now()
	for _, x := range a.parID {
		if x.appele == member && now.Before(x.fin) {
			out = append(out, x.payload)
		}
	}
	return out
}

// relancerAppels : à la connexion au flux, l'adhérent reçoit les appels qui sonnent encore pour lui.
func (h *Handler) relancerAppels(member int64) {
	for _, p := range h.appels.pour(member) {
		h.hub.publish([]int64{member}, "call", p)
	}
}

var typesSignal = map[string]bool{"offer": true, "answer": true, "ice": true, "hangup": true, "reject": true, "busy": true}

// Signal : POST /api/chat/rooms/{id}/call — transmet un message de signalisation à l'autre adhérent du message privé
// (et aux autres appareils de l'expéditeur : un appel décroché sur le téléphone arrête la sonnerie de l'ordinateur).
func (h *Handler) Signal(w http.ResponseWriter, r *http.Request) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	if rr.kind != "dm" {
		httpx.Error(w, http.StatusBadRequest, "les appels ne sont possibles que dans un message privé")
		return
	}
	var in struct {
		Type      string          `json:"type"`
		CallID    string          `json:"callId"`
		Video     bool            `json:"video"`
		SDP       string          `json:"sdp"`
		Candidate json.RawMessage `json:"candidate"`
		From      string          `json:"from"` // identifiant de l'appareil (onglet) qui envoie
		To        string          `json:"to"`   // appareil destinataire (vide : tous)
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil || !typesSignal[in.Type] ||
		len(in.CallID) < 8 || len(in.CallID) > 64 || len(in.From) > 64 || len(in.To) > 64 || len(in.Candidate) > 4<<10 {
		httpx.Error(w, http.StatusBadRequest, "requête invalide")
		return
	}
	ids, err := h.repo.MemberIDs(rr)
	if err != nil {
		h.fail(w, err)
		return
	}
	var autre int64
	for _, id := range ids {
		if id != p.ID {
			autre = id
		}
	}
	if autre == 0 || len(h.repo.Visible(rr.id, []int64{autre})) == 0 {
		httpx.Error(w, http.StatusConflict, "ton correspondant ne peut pas recevoir d'appel dans cette discussion")
		return
	}
	payload := map[string]any{
		"type": in.Type, "callId": in.CallID, "video": in.Video, "from": in.From, "to": in.To,
		"roomId": rr.id, "memberId": p.ID, "nom": strings.TrimSpace(p.Prenom + " " + p.Nom), "photoUrl": p.PhotoURL,
	}
	if in.SDP != "" {
		payload["sdp"] = in.SDP
	}
	if len(in.Candidate) > 0 {
		payload["candidate"] = in.Candidate
	}
	switch in.Type {
	case "offer":
		h.appels.garder(in.CallID, appelEnCours{appele: autre, payload: payload, fin: time.Now().Add(sonnerie)})
		if h.notif != nil {
			quoi := "📞 Appel vocal"
			if in.Video {
				quoi = "🎥 Appel vidéo"
			}
			h.notif.Notify(notif.Event{Kind: notif.Message, RefID: rr.id, Membres: []int64{autre}, Titre: payload["nom"].(string),
				Corps: quoi + " entrant", URL: fmt.Sprintf("/?salon=%d", rr.id)})
		}
	case "answer", "hangup", "reject", "busy":
		h.appels.oublier(in.CallID)
	}
	h.hub.publish([]int64{p.ID, autre}, "call", payload)
	w.WriteHeader(http.StatusNoContent)
}
