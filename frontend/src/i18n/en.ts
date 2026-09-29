// English dictionary -- the source of truth for translation keys. fr.ts must define the same keys (enforced by its type).
// Add new user-facing strings here first, then translate them in fr.ts.
export const en = {
  // Common
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.close': 'Close',
  'common.search': 'Search',
  'common.loading': 'Loading…',
  'common.language': 'Language',
  'common.loadingWorkspace': 'Loading your workspace…',
  'common.settings': 'Settings',
  'common.logout': 'Log out',
  'common.showSidebar': 'Show sidebar',
  'common.hideSidebar': 'Hide sidebar',
  'common.dragToReorder': 'Drag to reorder',
  'common.openMenu': 'Open menu',
  'common.zoomOut': 'Zoom out',
  'common.zoomIn': 'Zoom in',
  'common.resetZoom': 'Reset zoom',
  'common.pageZoom': 'Page zoom: 50% to 200%',
  'common.searchPlaceholder': 'Search leads, customers…',

  // Navigation / page titles
  'nav.dashboard': 'Dashboard',
  'nav.leads': 'Leads',
  'nav.customers': 'Customers',
  'nav.packages': 'Packages & Itinerary',
  'nav.quotations': 'Quotations',
  'nav.whatsapp': 'WhatsApp Inbox',
  'nav.bookings': 'Bookings & Operations',
  'nav.finance': 'Finance',
  'nav.vendors': 'Vendors',
  'nav.reports': 'Reports',
  'nav.metaQuality': 'Meta Quality',
  'nav.callbacks': 'Callback Requests',
  'nav.followups': 'Follow-ups',
  'nav.failedWhatsapp': 'Failed WhatsApp',
  'nav.tasks': 'Tasks',
  'nav.settings': 'Settings',

  // Mobile navigation
  'mobile.home': 'Home',
  'mobile.whatsapp': 'WhatsApp',
  'mobile.failed': 'Failed',
  'mobile.more': 'More',
  'mobile.menu': 'Menu',
  'mobile.closeMenu': 'Close menu',

  // Login
  'login.title': 'Sign in to continue',
  'login.identifier': 'Mobile Number or Email',
  'login.password': 'Password',
  'login.showPassword': 'Show password',
  'login.hidePassword': 'Hide password',
  'login.signIn': 'Sign in',
  'login.signingIn': 'Signing in…',
  'login.success': 'Logged in successfully',
  'login.failed': 'Login failed',
  'login.poweredBy': 'Powered by SocialMM',
  'login.slide1': 'Taj Mahal, Agra',
  'login.slide2': 'Gateway of India, Mumbai',
  'login.slide3': 'Backwaters, Kerala',
  'login.slide4': 'Temple Gopuram, Tamil Nadu',

  // Settings page
  'settings.title': 'Settings',
} as const;

export type TranslationKey = keyof typeof en;
