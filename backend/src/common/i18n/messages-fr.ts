// French translations of the API's user-facing error messages. The English text in the code stays the source of truth;
// a message with no entry here is returned unchanged (English). Keep new BadRequest/NotFound/... messages in sync.

// Exact-match messages.
export const FR_EXACT: Record<string, string> = {
  'A user with this email or mobile number already exists': 'Un utilisateur avec cet e-mail ou ce numéro de mobile existe déjà',
  'Enter a valid mobile number: 10 digits, or international with its + country code': 'Saisissez un numéro de mobile valide : 10 chiffres, ou au format international avec l\'indicatif + du pays',
  'Activate the itinerary first': "Activez d'abord l'itinéraire",
  'Add at least one valid WhatsApp number before enabling': 'Ajoutez au moins un numéro WhatsApp valide avant d\'activer',
  'An App Secret is 32 letters and numbers (0-9, a-f). Copy it again from App settings > Basic.': "Un secret d'application comporte 32 lettres et chiffres (0-9, a-f). Copiez-le à nouveau depuis Paramètres de l'application > Général.",
  'Booking not found': 'Réservation introuvable',
  'Checklist item not found': 'Élément de la liste de contrôle introuvable',
  'Could not identify the Meta app from the WhatsApp token': "Impossible d'identifier l'application Meta à partir du jeton WhatsApp",
  'Could not read the document': 'Impossible de lire le document',
  'Could not read the itinerary document for Meta submission': "Impossible de lire le document d'itinéraire pour l'envoi à Meta",
  'Could not resolve the Meta App ID from the configured WhatsApp token': "Impossible de déterminer l'identifiant de l'application Meta à partir du jeton WhatsApp configuré",
  'Customer not found': 'Client introuvable',
  'Enter an email address or mobile number': 'Saisissez une adresse e-mail ou un numéro de mobile',
  'Every button needs some text': "Chaque bouton a besoin d'un texte",
  'Failed to send WhatsApp message -- check WhatsApp configuration': "Échec de l'envoi du message WhatsApp -- vérifiez la configuration WhatsApp",
  'Give the quick reply a title and text': 'Donnez un titre et un texte à la réponse rapide',
  'Invalid credentials': 'Identifiants invalides',
  'Invalid or expired access token': "Jeton d'accès invalide ou expiré",
  'Invalid or expired refresh token': "Jeton d'actualisation invalide ou expiré",
  'Invalid preset': 'Préréglage invalide',
  'Invalid refresh token': "Jeton d'actualisation invalide",
  'Invalid thumbnail': 'Miniature invalide',
  'Invalid time': 'Heure invalide',
  'Invoice not found': 'Facture introuvable',
  'Itinerary not found': 'Itinéraire introuvable',
  'Lead not found': 'Prospect introuvable',
  'Meta could not confirm this right now (it is rate-limiting this check) — please try again in a minute.': "Meta n'a pas pu le confirmer pour l'instant (il limite cette vérification) — veuillez réessayer dans une minute.",
  'Meta template must be approved before testing': "Le modèle Meta doit être approuvé avant le test",
  'No document uploaded for this itinerary': "Aucun document téléversé pour cet itinéraire",
  'No file uploaded': 'Aucun fichier téléversé',
  'No numbers configured': 'Aucun numéro configuré',
  'No template submitted yet': "Aucun modèle soumis pour l'instant",
  'Not authenticated': 'Non authentifié',
  'Number is not in the approved test list': "Le numéro ne figure pas dans la liste de test approuvée",
  'Only PDF, Word, Excel, PowerPoint, text or image files are allowed': 'Seuls les fichiers PDF, Word, Excel, PowerPoint, texte ou image sont autorisés',
  'Package not found': 'Forfait introuvable',
  'Payment not found': 'Paiement introuvable',
  'Quotation not found': 'Devis introuvable',
  'Refresh token has been revoked': "Le jeton d'actualisation a été révoqué",
  'Switch to test mode first (with your test event code)': "Passez d'abord en mode test (avec votre code d'événement de test)",
  'Task not found': 'Tâche introuvable',
  'Template has not been submitted to Meta': "Le modèle n'a pas été soumis à Meta",
  'Template is not approved yet': "Le modèle n'est pas encore approuvé",
  'Test mode needs the test event code from Events Manager > Test events': "Le mode test nécessite le code d'événement de test d'Events Manager > Événements de test",
  'The Call button needs a valid phone number, for example 06 12 34 56 78 or +33 6 12 34 56 78': "Le bouton d'appel nécessite un numéro de téléphone valide, par exemple 06 12 34 56 78 ou +33 6 12 34 56 78",
  'The Chat button needs a valid WhatsApp number, for example 06 12 34 56 78 or +33 6 12 34 56 78': 'Le bouton de chat nécessite un numéro WhatsApp valide, par exemple 06 12 34 56 78 ou +33 6 12 34 56 78',
  'The Meta template must be approved before sending': "Le modèle Meta doit être approuvé avant l'envoi",
  'This lead has no phone number': "Ce prospect n'a pas de numéro de téléphone",
  'This lead has no valid WhatsApp number': "Ce prospect n'a pas de numéro WhatsApp valide",
  'This quotation has no customer/lead phone number to send to': "Ce devis n'a aucun numéro de téléphone de client/prospect auquel l'envoyer",
  'Type a message first': "Saisissez d'abord un message",
  'Unknown segment': 'Segment inconnu',
  'Unknown status': 'Statut inconnu',
  'Upload the itinerary before testing': "Téléversez l'itinéraire avant de tester",
  'Upload the itinerary document first': "Téléversez d'abord le document d'itinéraire",
  'Value required': 'Valeur requise',
  'Vendor not found': 'Fournisseur introuvable',
  'Website buttons need a full link starting with https://': 'Les boutons de site web nécessitent un lien complet commençant par https://',
  'WhatsApp Business Account ID is missing in Settings': "L'identifiant du compte WhatsApp Business est manquant dans les paramètres",
  'WhatsApp is not configured (Settings > WhatsApp) -- cannot send': "WhatsApp n'est pas configuré (Paramètres > WhatsApp) -- envoi impossible",
  'WhatsApp is not configured': "WhatsApp n'est pas configuré",
  'mode must be off, test or live': 'le mode doit être off, test ou live',
  'objectKey required': 'objectKey requis',
  'quality must be GOOD, NEUTRAL, BAD or null': 'la qualité doit être GOOD, NEUTRAL, BAD ou null',
  // HTTP status names returned in the "error" field
  'Bad Request': 'Requête invalide',
  'Unauthorized': 'Non autorisé',
  'Forbidden': 'Interdit',
  'Not Found': 'Introuvable',
  'Conflict': 'Conflit',
  'Internal Server Error': 'Erreur interne du serveur',
  'Bad Gateway': 'Passerelle invalide',
  'Service Unavailable': 'Service indisponible',
};

// Prefix messages: the English prefix is translated and the rest (usually a Meta/system detail) is kept as-is.
export const FR_PREFIX: [string, string][] = [
  ['Could not read Meta template status: ', 'Impossible de lire le statut du modèle Meta : '],
  ['Meta document upload failed: ', "Échec du téléversement du document vers Meta : "],
  ['Meta template submission failed: ', 'Échec de la soumission du modèle à Meta : '],
  ['Meta upload session failed: ', "Échec de la session de téléversement Meta : "],
  ['Missing required permission(s): ', 'Autorisation(s) requise(s) manquante(s) : '],
  ['Meta says this is not the App Secret of "', 'Meta indique que ce n\'est pas le secret d\'application de « '],
];

// class-validator default messages (the property name is kept as-is).
export const FR_VALIDATION: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(.+) should not be empty$/, (m) => `${m[1]} ne doit pas être vide`],
  [/^(.+) must be a string$/, (m) => `${m[1]} doit être une chaîne de caractères`],
  [/^(.+) must be an email$/, (m) => `${m[1]} doit être une adresse e-mail valide`],
  [/^(.+) must be a UUID$/, (m) => `${m[1]} doit être un UUID valide`],
  [/^(.+) must be a number conforming to the specified constraints$/, (m) => `${m[1]} doit être un nombre valide`],
  [/^(.+) must be an integer number$/, (m) => `${m[1]} doit être un nombre entier`],
  [/^(.+) must be a boolean value$/, (m) => `${m[1]} doit être une valeur booléenne`],
  [/^(.+) must be an array$/, (m) => `${m[1]} doit être une liste`],
  [/^(.+) must be an object$/, (m) => `${m[1]} doit être un objet`],
  [/^(.+) must be a valid ISO 8601 date string$/, (m) => `${m[1]} doit être une date valide (ISO 8601)`],
  [/^(.+) must be a Date instance$/, (m) => `${m[1]} doit être une date valide`],
  [/^(.+) must be longer than or equal to (\d+) characters$/, (m) => `${m[1]} doit contenir au moins ${m[2]} caractères`],
  [/^(.+) must be shorter than or equal to (\d+) characters$/, (m) => `${m[1]} doit contenir au plus ${m[2]} caractères`],
  [/^(.+) must not be less than (-?\d+(?:\.\d+)?)$/, (m) => `${m[1]} ne doit pas être inférieur à ${m[2]}`],
  [/^(.+) must not be greater than (-?\d+(?:\.\d+)?)$/, (m) => `${m[1]} ne doit pas être supérieur à ${m[2]}`],
  [/^(.+) must be one of the following values: (.+)$/, (m) => `${m[1]} doit être l'une des valeurs suivantes : ${m[2]}`],
  [/^property (.+) should not exist$/, (m) => `la propriété ${m[1]} ne doit pas exister`],
  [/^(.+) must be a positive number$/, (m) => `${m[1]} doit être un nombre positif`],
];

export function translateMessageFr(message: string): string {
  const exact = FR_EXACT[message];
  if (exact) return exact;
  for (const [prefix, fr] of FR_PREFIX) if (message.startsWith(prefix)) return fr + message.slice(prefix.length);
  for (const [re, fn] of FR_VALIDATION) {
    const m = message.match(re);
    if (m) return fn(m);
  }
  return message;
}
