// Numéro de version de Sam Link (convention semver : MAJOR.MINOR.PATCH).
// Ajouter une entrée en haut de CHANGELOG à chaque changement notable : APP_VERSION en découle
// (c'est la version de la première entrée), il n'y a plus rien d'autre à mettre à jour.

export const CHANGELOG = [
  {
    version: '1.1.1',
    date: '8 octobre 2026',
    notes: "Le logo du club s'affiche de nouveau sur la page de connexion (ainsi que les icônes de l'application installée), et l'adresse de contact passe sous « Besoin d'aide pour vous connecter ? ». Dans « Nouvelle discussion », le bouton « Créer le salon » n'est plus collé au bord bas de la fenêtre. Aucune migration.",
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
