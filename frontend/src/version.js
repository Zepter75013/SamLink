// Numéro de version de Sam Link (convention semver : MAJOR.MINOR.PATCH).
// Ajouter une entrée en haut de CHANGELOG à chaque changement notable : APP_VERSION en découle
// (c'est la version de la première entrée), il n'y a plus rien d'autre à mettre à jour.

export const CHANGELOG = [
  {
    version: '1.6.0',
    date: '9 octobre 2026',
    notes: "Partage de position : ＋ › Position envoie ta position actuelle, affichée comme une carte dans la bulle avec des liens Google Maps, Plans et Waze (chiffrée dans les messages privés chiffrés). Messages importants : bouton ⭐ d'un message, et liste de tous tes messages importants avec le bouton ⭐ en haut des discussions (un clic ouvre la discussion sur le message). Infos d'un message : dans un salon, le bouton ℹ️ de tes messages montre qui les a lus et qui n'a pas encore lu, ainsi que les réactions. Migration à appliquer (0004 : une nouvelle table, chat_stars).",
  },
  {
    version: '1.5.1',
    date: '9 octobre 2026',
    notes: "Sur téléphone, le menu ⋮ d'une discussion privée était poussé hors de l'écran par les boutons d'appel : il reste maintenant toujours visible (le nom se raccourcit et le cadenas n'affiche plus que son icône). Aucune migration.",
  },
  {
    version: '1.5.0',
    date: '9 octobre 2026',
    notes: "Appels audio et vidéo dans les messages privés : boutons 📞 et 🎥 en haut de la discussion. L'appelé reçoit une notification et peut répondre en audio ou en vidéo ; pendant l'appel : couper le micro, couper ou retourner la caméra, raccrocher. Le son et l'image vont directement d'un appareil à l'autre, chiffrés de bout en bout. La discussion garde une trace (« 📞 Appel vocal · 2 min 05 s », « Appel manqué »). Relais TURN facultatif pour les réseaux qui bloquent les appels (voir README). Aucune migration.",
  },
  {
    version: '1.4.0',
    date: '9 octobre 2026',
    notes: "Messages vocaux : quand la zone de saisie est vide, le bouton 🎤 lance l'enregistrement (5 minutes au plus), ➤ l'envoie, 🗑 l'annule ; lecture dans la bulle avec vitesse 1×, 1,5× ou 2×. Dans une discussion privée chiffrée, le message vocal est chiffré comme une pièce jointe. Messages épinglés : bouton 📌 d'un message (3 au plus par discussion), bandeau en haut de la conversation qui mène au message ; dans un message privé les deux adhérents peuvent épingler, dans un salon créé son créateur et les modérateurs, dans les salons du club les modérateurs. Toucher une citation mène au message cité. Migration à appliquer (0003 : une nouvelle table, chat_pins).",
  },
  {
    version: '1.3.0',
    date: '8 octobre 2026',
    notes: "Fonctions à la WhatsApp : réactions sur les messages (bouton 😊 d'un message, puis 👍 ❤️ 😂 😮 😢 🙏 ou plus) ; « Prénom écrit… » en haut de la discussion et dans la liste ; mise en sourdine d'une discussion (menu ⋮, plus de notification sauf quand on te mentionne) ; transfert d'un message, d'une photo ou d'un document vers une ou plusieurs discussions (bouton ↪, mention « Transféré ») ; recherche dans la discussion ouverte (menu ⋮ › 🔍) ; mentions @ dans les salons (taper @ puis choisir le participant : il est prévenu même en sourdine). Migration à appliquer (0002 : trois nouvelles tables, aucune table existante modifiée).",
  },
  {
    version: '1.2.0',
    date: '8 octobre 2026',
    notes: "Connexion avec l'e-mail ou le numéro de licence (celui de la fiche adhérent ou de l'adhésion de la saison), et toujours le mot de passe du site du club. Nouvelle aide « Messages chiffrés » : dans « Mon compte », et par le lien « Comment ça marche ? » des fenêtres du bouton 🔒. Les textes du chiffrement parlent désormais de Sam Link et du bouton 🔒. Aucune migration (la vue des adhérents est recréée au démarrage).",
  },
  {
    version: '1.1.2',
    date: '8 octobre 2026',
    notes: "Fenêtre « Mon compte » : « À propos » et « Se déconnecter » deviennent une liste sobre au lieu de deux gros boutons. Dans « À propos », un lien « ‹ Mon compte » ramène à la fenêtre précédente. Aucune migration.",
  },
  {
    version: '1.1.1',
    date: '8 octobre 2026',
    notes: "Le logo du club s'affiche de nouveau sur la page de connexion (ainsi que les icônes de l'application installée), et l'adresse de contact passe sous « Besoin d'aide pour vous connecter ? ». Dans « Nouvelle discussion », le bouton « Créer le salon » n'est plus collé au bord bas de la fenêtre. Dans « Mon compte », « Se déconnecter » et « À propos » passent en haut, sous ton nom, et la fenêtre défile quand son contenu dépasse l'écran. Aucune migration.",
  },
  {
    version: '1.1.0',
    date: '8 octobre 2026',
    notes: "Fenêtre « À propos » dans le menu ☰, avec la version de Sam Link et l'historique des nouveautés. Mise en ligne sur le NAS du club (Docker, base dans le conteneur bdd-mysql) à l'adresse https://samlink.juliotte-app.fr. Aucune migration.",
  },
  {
    version: '1.0.0',
    date: '8 octobre 2026',
    notes: "Première version de Sam Link, la messagerie des adhérents du SAM Paris 12 reprise de l'espace adhérent : connexion avec l'e-mail et le mot de passe du site du club (base SamProd26db), salons automatiques (Tous les adhérents, Running, Marche nordique, Bureau), salons créés, messages privés chiffrés de bout en bout, pièces jointes, sondages, événements, notifications push et e-mail. Migration 0001_samlink.sql.",
  },
]

export const APP_VERSION = CHANGELOG[0].version
