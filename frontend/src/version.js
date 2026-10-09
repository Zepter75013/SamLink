// Numéro de version de Sam Link (convention semver : MAJOR.MINOR.PATCH).
// Ajouter une entrée en haut de CHANGELOG à chaque changement notable : APP_VERSION en découle
// (c'est la version de la première entrée), il n'y a plus rien d'autre à mettre à jour.

export const CHANGELOG = [
  {
    version: '1.11.2',
    date: '9 octobre 2026',
    notes: "Les fenêtres avec une liste d'adhérents ou de discussions (nouvelle discussion, nouveau salon, ajout de participants, transfert, listes) prennent presque toute la hauteur de l'écran et les lignes sont plus serrées : on voit environ deux fois plus d'adhérents d'un coup. Aucune migration.",
  },
  {
    version: '1.11.1',
    date: '9 octobre 2026',
    notes: "Fenêtre « Nouvelle discussion » plus soignée : photo et nom des adhérents alignés à gauche (le picto d'activité reste à droite), cases à cocher rondes, bouton « Créer le salon · n participants » arrondi sur une seule ligne, avec de l'espace en dessous. Les autres boutons des fenêtres (Ajouter, Envoyer, Enregistrer…) prennent le même style. Aucune migration.",
  },
  {
    version: '1.11.0',
    date: '9 octobre 2026',
    notes: "Fond d'écran des discussions, comme WhatsApp : Paramètres › Apparence propose des couleurs (Ciel, Menthe, Lavande, Pêche, Rose, Sable, Ardoise, Rouge Sam), des motifs (Pois, Aurore, Piste) ou ta propre photo, avec un réglage pour l'atténuer ; s'adapte au mode sombre et est mémorisé sur l'appareil. Les boutons de filtre (Toutes, Non lues…) passent à la ligne au lieu d'être coupés sur ordinateur. Aucune migration.",
  },
  {
    version: '1.10.0',
    date: '9 octobre 2026',
    notes: "Filtres en haut des discussions, comme WhatsApp : Toutes, Non lues (avec le nombre), Privés, Groupes, puis tes propres listes. Listes de discussions : ＋ dans la barre des filtres pour en créer une (nom et discussions cochées), ✏️ pour la modifier ou la supprimer, et menu ⋮ d'une discussion › 🗂️ Ranger dans une liste. Tes listes ne sont visibles que de toi et suivent sur tous tes appareils. Adhérents en ligne en haut de la liste, comme Messenger : un appui ouvre le message privé. Migration à appliquer (0007 : deux nouvelles tables, chat_lists et chat_list_rooms).",
  },
  {
    version: '1.9.0',
    date: '9 octobre 2026',
    notes: "Paramètres façon Messenger : le bouton ☰ ouvre une page avec ta photo et ton nom, puis des rubriques en liste (Apparence, Notifications, Confidentialité et sécurité, Centre d'aide, À propos, Se déconnecter) qui s'ouvrent chacune sur leur page avec un retour ‹. Confidentialité et sécurité regroupe l'état du chiffrement, la clé de récupération et les explications. Nouveau Centre d'aide avec recherche : premiers pas, installation, messages, contenus, position, appels, organisation des discussions, chiffrement, notifications. Plein écran sur téléphone. Aucune migration.",
  },
  {
    version: '1.8.1',
    date: '9 octobre 2026',
    notes: "Couleurs harmonisées : les fenêtres « Mon compte », « À propos », l'aide et les autres fenêtres prennent les mêmes gris que la messagerie (en clair comme en sombre) au lieu des tons beiges et bruns du site du club ; la liste des versions d'« À propos » suit aussi le thème. Aucune migration.",
  },
  {
    version: '1.8.0',
    date: '9 octobre 2026',
    notes: "Apparence au choix dans « Mon compte » : Système (suit le téléphone ou l'ordinateur), Clair ou Sombre, mémorisé sur l'appareil. Photo d'un salon : menu ⋮ › 🖼️ Photo du salon (créateur du salon et modérateurs ; salons du club : modérateurs), recadrée au carré et allégée avant l'envoi, visible dans la liste et en haut de la discussion ; « Retirer la photo » revient à l'icône 👥. Sur ordinateur, les en-têtes de la liste et de la discussion ont la même hauteur (ils se chevauchaient en décalé). « 1 participant » au singulier. Migration à appliquer (0006 : une nouvelle table, chat_room_photos).",
  },
  {
    version: '1.7.0',
    date: '9 octobre 2026',
    notes: "Position en direct : ＋ › Position › « Partager ma position en direct » pendant 15 minutes, 1 heure ou 8 heures. La bulle montre une carte qui suit tes déplacements (« En direct jusqu'à 18:30 · mis à jour à l'instant ») et le bouton « Arrêter le partage » ; à la fin, la dernière position reste affichée. La position n'est envoyée que tant que Sam Link reste ouvert sur ton téléphone (un site web ne peut pas suivre la position en arrière-plan). Chiffrée dans les messages privés chiffrés. Migration à appliquer (0005 : une nouvelle table, chat_live).",
  },
  {
    version: '1.6.1',
    date: '9 octobre 2026',
    notes: "Le menu ⋮ d'une discussion s'ouvre de nouveau par-dessus la conversation (l'en-tête reprenait par erreur le style du bandeau du site, qui le cachait sur certains navigateurs). La fenêtre « Mon compte » est plus large et plus haute : tout tient sans défiler sur ordinateur. Aucune migration.",
  },
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
