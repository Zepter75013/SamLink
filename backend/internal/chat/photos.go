package chat

import (
	"bufio"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"samlink/backend/internal/httpx"
)

// Photo d'un salon : choisie par le créateur du salon ou un modérateur (salons du club : modérateurs seulement).
// Un message privé n'a pas de photo propre : il montre celle de l'autre adhérent.

const maxRoomPhoto = 5 << 20

func peutChangerPhoto(rr *roomRow, p *Person) bool {
	switch rr.kind {
	case "dm":
		return false
	case "custom":
		return rr.createdBy == p.ID || p.CanModerate
	}
	return p.CanModerate
}

// photoURL : lien signé vers la photo d'un salon. L'échéance est arrondie au jour pour que le lien reste le même
// (et la photo en cache) d'un rechargement à l'autre ; la version change à chaque nouvelle photo.
func (s *Signer) photoURL(roomID int64, version time.Time) string {
	exp := (time.Now().Unix()/86400 + 8) * 86400
	return fmt.Sprintf("/api/chat/room-photos/%d?v=%d&t=%d.%s", roomID, version.Unix(), exp, s.sign(-roomID, exp))
}

// roomPhoto : lien de la photo d'un salon ("" s'il n'en a pas).
func (r *Repository) roomPhoto(roomID int64) string {
	var at time.Time
	if err := r.db.QueryRow(`SELECT updated_at FROM chat_room_photos WHERE room_id = ?`, roomID).Scan(&at); err != nil {
		return ""
	}
	return r.signer.photoURL(roomID, at)
}

// RoomPhotoSet : PUT /api/chat/rooms/{id}/photo (multipart, champ photo : JPEG, PNG ou WebP de 5 Mo au plus).
// RoomPhotoDelete : DELETE /api/chat/rooms/{id}/photo.
func (h *Handler) RoomPhotoSet(w http.ResponseWriter, r *http.Request)    { h.roomPhoto(w, r, false) }
func (h *Handler) RoomPhotoDelete(w http.ResponseWriter, r *http.Request) { h.roomPhoto(w, r, true) }

func (h *Handler) roomPhoto(w http.ResponseWriter, r *http.Request, retirer bool) {
	p := h.me(w, r)
	if p == nil {
		return
	}
	rr := h.room(w, r, p)
	if rr == nil {
		return
	}
	if !peutChangerPhoto(rr, p) {
		httpx.Error(w, http.StatusForbidden, "seuls le créateur du salon et les modérateurs peuvent changer sa photo")
		return
	}
	var ancien string
	_ = h.repo.db.QueryRow(`SELECT path FROM chat_room_photos WHERE room_id = ?`, rr.id).Scan(&ancien)

	if retirer {
		if _, err := h.repo.db.Exec(`DELETE FROM chat_room_photos WHERE room_id = ?`, rr.id); err != nil {
			h.fail(w, err)
			return
		}
	} else {
		rel, err := enregistrerPhoto(w, r)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := h.repo.db.Exec(`
			INSERT INTO chat_room_photos (room_id, path, updated_by, updated_at) VALUES (?, ?, ?, NOW())
			ON DUPLICATE KEY UPDATE path = VALUES(path), updated_by = VALUES(updated_by), updated_at = NOW()`, rr.id, rel, p.ID); err != nil {
			os.Remove(filepath.Join(uploadDir, rel))
			h.fail(w, err)
			return
		}
	}
	if ancien != "" {
		os.Remove(filepath.Join(uploadDir, ancien))
	}
	url := h.repo.roomPhoto(rr.id)
	h.broadcast(rr, "rooms", map[string]any{"roomId": rr.id}) // les autres participants rechargent la liste
	httpx.JSON(w, http.StatusOK, map[string]string{"photoUrl": url})
}

func enregistrerPhoto(w http.ResponseWriter, r *http.Request) (string, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRoomPhoto+1<<20)
	reader, err := r.MultipartReader()
	if err != nil {
		return "", errors.New("requête invalide")
	}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			return "", errors.New("aucune photo reçue")
		}
		if err != nil {
			return "", errors.New("photo trop volumineuse (5 Mo au plus)")
		}
		if part.FormName() != "photo" {
			continue
		}
		br := bufio.NewReaderSize(part, 4096)
		head, _ := br.Peek(512)
		ext := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[http.DetectContentType(head)]
		if ext == "" {
			return "", errors.New("la photo doit être une image JPEG, PNG ou WebP")
		}
		dir := filepath.Join(uploadDir, "salons")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", err
		}
		rnd := make([]byte, 12)
		if _, err := rand.Read(rnd); err != nil {
			return "", err
		}
		rel := filepath.Join("salons", hex.EncodeToString(rnd)+ext)
		full := filepath.Join(uploadDir, rel)
		f, err := os.OpenFile(full, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			return "", err
		}
		n, err := io.Copy(f, io.LimitReader(br, maxRoomPhoto+1))
		f.Close()
		if err != nil || n > maxRoomPhoto || n == 0 {
			os.Remove(full)
			return "", errors.New("photo trop volumineuse (5 Mo au plus) ou vide")
		}
		return rel, nil
	}
}

// RoomPhotoFile : GET /api/chat/room-photos/{id}?t=… — sert la photo d'un salon à qui présente un lien signé.
func (h *Handler) RoomPhotoFile(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if id <= 0 || !h.repo.signer.Valid(-id, r.URL.Query().Get("t")) {
		httpx.Error(w, http.StatusForbidden, "lien expiré ou invalide")
		return
	}
	var rel string
	if err := h.repo.db.QueryRow(`SELECT path FROM chat_room_photos WHERE room_id = ?`, id).Scan(&rel); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "pas de photo")
			return
		}
		h.fail(w, err)
		return
	}
	f, err := os.Open(filepath.Join(uploadDir, rel))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "photo introuvable")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "photo introuvable")
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(w, r, filepath.Base(rel), st.ModTime(), f)
}
