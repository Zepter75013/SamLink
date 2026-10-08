// Numéro de version de Sam Link (convention semver : MAJOR.MINOR.PATCH).
// Ajouter une entrée en haut de CHANGELOG à chaque changement notable : APP_VERSION en découle
// (c'est la version de la première entrée), il n'y a plus rien d'autre à mettre à jour.

export const CHANGELOG = [
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
