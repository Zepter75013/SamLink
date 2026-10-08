// Génère une paire de clés VAPID pour les notifications push, à recopier dans le .env de l'API :
//
//	VAPID_PUBLIC_KEY=…
//	VAPID_PRIVATE_KEY=…
//
// À faire une seule fois : changer de clés désabonne tous les appareils (chacun devra réactiver les notifications).
// Usage : go run ./cmd/vapid
package main

import (
	"fmt"
	"log"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func main() {
	privee, publique, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		log.Fatalf("génération des clés : %v", err)
	}
	fmt.Printf("VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\n", publique, privee)
}
