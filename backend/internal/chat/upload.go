package chat

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
)

const (
	uploadDir      = "uploads/chat"
	maxFiles       = 10
	maxImageSize   = 20 << 20
	maxVideoSize   = 100 << 20
	maxFileSize    = 30 << 20
	maxUploadTotal = 300 << 20
)

// Types de documents acceptés (par extension) — pas de HTML, SVG ni exécutables.
var docTypes = map[string]string{
	".pdf":  "application/pdf",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt":  "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".odt":  "application/vnd.oasis.opendocument.text",
	".ods":  "application/vnd.oasis.opendocument.spreadsheet",
	".odp":  "application/vnd.oasis.opendocument.presentation",
	".txt":  "text/plain; charset=utf-8",
	".csv":  "text/csv; charset=utf-8",
	".rtf":  "application/rtf",
	".zip":  "application/zip",
	".gpx":  "application/gpx+xml",
	".tcx":  "application/xml",
	".kml":  "application/vnd.google-earth.kml+xml",
}

var imageTypes = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}
var videoExts = map[string]string{".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}

func cleanName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '"' {
			return -1
		}
		return r
	}, name)
	if r := []rune(name); len(r) > 150 {
		ext := filepath.Ext(name)
		name = string(r[:150-len([]rune(ext))]) + ext
	}
	if name == "" || name == "." {
		return "fichier"
	}
	return name
}

// saveUpload enregistre un fichier reçu (en flux) sur le disque après vérification de son type réel et de sa taille.
func saveUpload(part *multipart.Part) (*SavedFile, error) {
	nom := cleanName(part.FileName())
	ext := strings.ToLower(filepath.Ext(nom))
	br := bufio.NewReaderSize(part, 4096)
	head, _ := br.Peek(512)
	sniff := http.DetectContentType(head)

	var kind, mimeType, outExt string
	var limit int64
	switch {
	case imageTypes[sniff] != "":
		kind, mimeType, limit = "image", sniff, maxImageSize
		outExt = imageTypes[sniff]
	case videoExts[ext] != "" && (sniff == "video/mp4" || sniff == "video/webm" || sniff == "application/octet-stream" || strings.HasPrefix(sniff, "video/") || (len(head) > 12 && string(head[4:8]) == "ftyp")):
		kind, mimeType, limit = "video", videoExts[ext], maxVideoSize
		outExt = ext
	case docTypes[ext] != "":
		kind, mimeType, limit = "file", docTypes[ext], maxFileSize
		outExt = ext
	default:
		return nil, fmt.Errorf("« %s » : ce type de fichier n'est pas accepté (photos, vidéos, PDF, documents Office, texte, GPX)", nom)
	}

	sub := time.Now().Format("200601")
	if err := os.MkdirAll(filepath.Join(uploadDir, sub), 0o755); err != nil {
		return nil, err
	}
	rnd := make([]byte, 12)
	if _, err := rand.Read(rnd); err != nil {
		return nil, err
	}
	rel := filepath.Join(sub, hex.EncodeToString(rnd)+outExt)
	full := filepath.Join(uploadDir, rel)
	f, err := os.OpenFile(full, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return nil, err
	}
	n, err := io.Copy(f, io.LimitReader(br, limit+1))
	f.Close()
	if err != nil || n > limit {
		os.Remove(full)
		if err == nil {
			err = fmt.Errorf("« %s » est trop volumineux (maximum %d Mo)", nom, limit>>20)
		}
		return nil, err
	}
	if n == 0 {
		os.Remove(full)
		return nil, fmt.Errorf("« %s » est vide", nom)
	}
	return &SavedFile{Kind: kind, Path: rel, Nom: nom, Mime: mimeType, Size: n}, nil
}

func removeFiles(files []SavedFile) {
	for _, f := range files {
		os.Remove(filepath.Join(uploadDir, f.Path))
	}
}

func contentDisposition(inline bool, nom string) string {
	disp := "attachment"
	if inline {
		disp = "inline"
	}
	return disp + "; filename*=UTF-8''" + url.PathEscape(nom)
}

// saveChiffre enregistre un fichier déjà chiffré par le navigateur : le serveur ne connaît ni son nom, ni son type, ni son contenu
// (ils sont dans la description chiffrée du message). Il est rangé sous un nom neutre et servi comme un flux binaire quelconque.
func saveChiffre(part *multipart.Part) (*SavedFile, error) {
	sub := time.Now().Format("200601")
	if err := os.MkdirAll(filepath.Join(uploadDir, sub), 0o755); err != nil {
		return nil, err
	}
	rnd := make([]byte, 12)
	if _, err := rand.Read(rnd); err != nil {
		return nil, err
	}
	rel := filepath.Join(sub, hex.EncodeToString(rnd)+".bin")
	full := filepath.Join(uploadDir, rel)
	f, err := os.OpenFile(full, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return nil, err
	}
	limit := int64(maxVideoSize) + 1<<20 // la taille réelle (photo, vidéo, document) est contrôlée par le navigateur
	n, err := io.Copy(f, io.LimitReader(part, limit+1))
	f.Close()
	if err != nil || n > limit {
		os.Remove(full)
		if err == nil {
			err = fmt.Errorf("fichier chiffré trop volumineux (maximum %d Mo)", maxVideoSize>>20)
		}
		return nil, err
	}
	if n < 28 { // en-tête + une étiquette d'authentification au minimum
		os.Remove(full)
		return nil, fmt.Errorf("fichier chiffré invalide")
	}
	return &SavedFile{Kind: "file", Path: rel, Nom: "fichier-chiffre", Mime: "application/octet-stream", Size: n}, nil
}
