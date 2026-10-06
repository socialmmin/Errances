import type { TranslationKey } from './en';

// French dictionary. Typed against the English keys, so a missing translation is a compile error.
export const fr: Record<TranslationKey, string> = {
  // Common
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.delete': 'Supprimer',
  'common.edit': 'Modifier',
  'common.close': 'Fermer',
  'common.search': 'Rechercher',
  'common.loading': 'Chargement…',
  'common.language': 'Langue',
  'common.loadingWorkspace': 'Chargement de votre espace de travail…',
  'common.settings': 'Paramètres',
  'common.logout': 'Se déconnecter',
  'common.showSidebar': 'Afficher le menu latéral',
  'common.hideSidebar': 'Masquer le menu latéral',
  'common.dragToReorder': 'Glisser pour réorganiser',
  'common.openMenu': 'Ouvrir le menu',
  'common.zoomOut': 'Dézoomer',
  'common.zoomIn': 'Zoomer',
  'common.resetZoom': 'Réinitialiser le zoom',
  'common.pageZoom': 'Zoom de la page : 50 % à 200 %',
  'common.searchPlaceholder': 'Rechercher des prospects, clients…',

  // Navigation / page titles
  'nav.dashboard': 'Tableau de bord',
  'nav.leads': 'Prospects',
  'nav.customers': 'Clients',
  'nav.packages': 'Forfaits et itinéraires',
  'nav.quotations': 'Devis',
  'nav.whatsapp': 'Boîte WhatsApp',
  'nav.bookings': 'Réservations et opérations',
  'nav.finance': 'Finances',
  'nav.vendors': 'Fournisseurs',
  'nav.reports': 'Rapports',
  'nav.metaQuality': 'Qualité Meta',
  'nav.callbacks': 'Demandes de rappel',
  'nav.followups': 'Suivis',
  'nav.failedWhatsapp': 'Échecs WhatsApp',
  'nav.tasks': 'Tâches',
  'nav.settings': 'Paramètres',

  // Mobile navigation
  'mobile.home': 'Accueil',
  'mobile.whatsapp': 'WhatsApp',
  'mobile.failed': 'Échecs',
  'mobile.more': 'Plus',
  'mobile.menu': 'Menu',
  'mobile.closeMenu': 'Fermer le menu',

  // Login
  'login.title': 'Connectez-vous pour continuer',
  'login.identifier': 'Numéro de mobile ou e-mail',
  'login.password': 'Mot de passe',
  'login.showPassword': 'Afficher le mot de passe',
  'login.hidePassword': 'Masquer le mot de passe',
  'login.signIn': 'Se connecter',
  'login.signingIn': 'Connexion…',
  'login.success': 'Connexion réussie',
  'login.failed': 'Échec de la connexion',
  'login.poweredBy': 'Propulsé par SocialMM',
  'login.slide1': 'Taj Mahal, Agra',
  'login.slide2': 'Porte de l’Inde, Mumbai',
  'login.slide3': 'Backwaters, Kerala',
  'login.slide4': 'Gopuram d’un temple, Tamil Nadu',

  // Settings page
  'settings.title': 'Paramètres',
};
