// The WhatsApp enquiry: when someone writes in, the bot welcomes them, asks what they need --
// flight tickets, a visa, a package, or something else -- and then only the few questions that
// fit that (their name too, if WhatsApp did not give one). It sums the answers up and hands over
// to sales. A customer answering a promo that was sent with a service (a ticket flyer, say) is
// not asked what they need: the promo says it. This file holds the wording in French and English
// and the reading of free-text answers; WhatsAppBotService runs it.

export type EnquiryLang = 'fr' | 'en';
export type EnquiryService = 'ticket' | 'visa' | 'package' | 'other';
export type EnquiryStep = 'name' | 'service' | 'route' | 'destination' | 'nationality' | 'dates' | 'travellers' | 'type' | 'details';

export interface EnquiryState {
  lang: EnquiryLang;
  step: EnquiryStep;
  steps: EnquiryStep[];
  answers: Partial<Record<EnquiryStep, string>>;
  // What the customer needs, once known (asked, or taken from the promo they answered).
  service?: EnquiryService | null;
  // The promo (template) the customer answered, if any.
  promo?: string | null;
  // The stored travel type (family, couple...) once the package question is answered.
  travelType?: string | null;
  startedAt: string;
  // Times the current question was asked again after an answer that could not be used.
  retries: number;
}

// The questions asked for each service, after the name (and the service, when asked).
export const SERVICE_STEPS: Record<EnquiryService, EnquiryStep[]> = {
  ticket: ['route', 'dates', 'travellers'],
  visa: ['destination', 'nationality', 'dates', 'travellers'],
  package: ['destination', 'dates', 'travellers', 'type'],
  other: ['details'],
};

export const SERVICE_OPTIONS: { value: EnquiryService; fr: string; en: string; words: RegExp }[] = [
  { value: 'ticket', fr: "✈️ Billets d'avion", en: '✈️ Flight tickets', words: /\b(billets?|tickets?|vols?|flights?|avion|a[ée]rien|airline|air ?ticket|aller[- ]retour|aller simple|one[- ]way|return)\b/i },
  { value: 'visa', fr: '🛂 Visa', en: '🛂 Visa', words: /\b(visas?|e-?visa|passeport|passport)\b/i },
  { value: 'package', fr: '🌴 Séjour / circuit', en: '🌴 Holiday package', words: /\b(forfaits?|packages?|s[ée]jours?|circuits?|tours?|holidays?|vacances|voyage organis[ée]|h[ôo]tel)\b/i },
  { value: 'other', fr: '💬 Autre demande', en: '💬 Something else', words: /\b(autre|other|something else|question|information)\b/i },
];

// Countries where the customer is addressed in French unless their message is clearly English.
const FRENCH_SPEAKING_CODES = ['33', '32', '41', '352', '377', '212', '213', '216', '221', '225', '237', '262', '590', '594', '596', '687', '689'];
const FRENCH_WORDS = /\b(bonjour|bonsoir|salut|coucou|merci|svp|s'il vous pla[iî]t|je|j'ai|j'aimerais|voudrais|souhaite|voyage|partir|s[ée]jour|oui|non|prix|tarif|renseignements?|devis|vacances)\b/i;
const ENGLISH_WORDS = /\b(hi|hello|hey|good (morning|afternoon|evening)|please|thanks|thank you|i|i'd|i'm|want|would like|trip|price|travel|holidays?|quote|looking)\b/i;

export function detectLanguage(text: string, phone: string): EnquiryLang {
  const fr = FRENCH_WORDS.test(text);
  const en = ENGLISH_WORDS.test(text);
  if (fr !== en) return fr ? 'fr' : 'en';
  return FRENCH_SPEAKING_CODES.some((code) => phone.startsWith(code)) ? 'fr' : 'en';
}

// A name worth greeting someone by: has letters, and is not just their phone number.
export function hasRealName(name: string | null | undefined) {
  return /\p{L}{2,}/u.test(String(name || ''));
}

// The steps for a customer: the name if needed, the service question unless the service is
// already known, then that service's questions.
export function stepsFor(needName: boolean, service: EnquiryService | null): EnquiryStep[] {
  return [...(needName ? ['name' as EnquiryStep] : []), ...(service ? SERVICE_STEPS[service] : ['service' as EnquiryStep])];
}

export const TRAVEL_TYPE_OPTIONS: { value: string; fr: string; en: string; words: RegExp }[] = [
  { value: 'couple', fr: 'En couple', en: 'Couple', words: /\b(couple|[àa] deux|ma femme|mon mari|my wife|my husband|partner|conjoint)/i },
  { value: 'family', fr: 'En famille', en: 'Family', words: /\b(famille|family|enfants?|kids?|children|parents)/i },
  { value: 'group', fr: 'Entre amis / groupe', en: 'Friends / group', words: /\b(amis?|amies|friends?|groupe?|copains|coll[èe]gues|colleagues)/i },
  { value: 'solo', fr: 'Seul(e)', en: 'Solo', words: /\b(seule?|solo|alone|myself|just me|tout seul)/i },
  { value: 'honeymoon', fr: 'Lune de miel', en: 'Honeymoon', words: /\b(lune de miel|honeymoon|voyage de noces|noces)/i },
  { value: 'corporate', fr: "Voyage d'affaires", en: 'Business trip', words: /\b(affaires|business|travail|work|professionnel|corporate|s[ée]minaire|seminar)/i },
];

const T = {
  fr: {
    welcomeNamed: (name: string) => `Bonjour ${name} 👋 Bienvenue chez *Errances Voyages* !`,
    welcome: 'Bonjour 👋 Bienvenue chez *Errances Voyages* !',
    intro: 'Pour bien vous répondre, j’ai quelques petites questions.',
    introPromo: { ticket: 'Merci pour votre intérêt pour nos billets d’avion ✈️ Quelques petites questions pour vérifier les disponibilités :', visa: 'Merci pour votre intérêt pour nos services visa 🛂 Quelques petites questions :', package: 'Merci pour votre intérêt pour cette offre 🌴 Quelques petites questions :', other: 'Merci pour votre message. Une petite question :' } as Record<EnquiryService, string>,
    name: 'Quel est votre nom ?',
    service: 'Que souhaitez-vous ?',
    route: 'Quel trajet ? Ville de départ et destination.\n_Exemple : Paris → Chennai_',
    destination: { visa: 'Pour quel pays avez-vous besoin d’un visa ?', package: 'Quelle destination souhaitez-vous ? (pays ou ville)' },
    nationality: 'Quelle est votre nationalité (pays du passeport) ?',
    dates: {
      ticket: 'Date de départ, et date de retour si c’est un aller-retour.\n_Exemple : 12 août – 30 août, ou 12 août aller simple_',
      visa: 'Quand prévoyez-vous de voyager ?\n_Exemple : 15 décembre_',
      package: 'Quand souhaitez-vous partir ? Indiquez la date de départ, et la durée ou la date de retour si vous la connaissez.\n_Exemple : 12 août, 10 jours_',
    },
    travellers: {
      ticket: 'Combien de passagers ?\n_Exemple : 2 adultes, 1 enfant et 1 bébé_',
      visa: 'Combien de personnes ont besoin du visa ?',
      package: 'Combien de voyageurs ?\n_Exemple : 2 adultes et 1 enfant_',
    },
    type: 'Dernière question : quel type de voyage ?',
    details: 'Dites-nous en quelques mots ce dont vous avez besoin.',
    choose: 'Choisir',
    typeHint: 'Répondez par le numéro :',
    retry: "Je n'ai pas bien compris. ",
    unreadable: 'Pouvez-vous me répondre par un message écrit, s’il vous plaît ?',
    thanks: (name: string) => (name ? `Merci ${name} ! ` : 'Merci ! ') + 'Voici votre demande :',
    labels: { service: 'Demande', route: 'Trajet', destination: 'Destination', visaCountry: 'Visa pour', nationality: 'Nationalité', dates: 'Dates', travellers: 'Voyageurs', passengers: 'Passagers', type: 'Type de voyage', details: 'Détails', promo: 'Offre' },
    closing: 'Un conseiller Errances Voyages vous contactera très vite ici. Vous pouvez ajouter d’autres précisions dans ce chat.',
    callButton: 'Être rappelé(e)',
    serviceSection: 'Votre demande',
    section: 'Type de voyage',
  },
  en: {
    welcomeNamed: (name: string) => `Hello ${name} 👋 Welcome to *Errances Voyages*!`,
    welcome: 'Hello 👋 Welcome to *Errances Voyages*!',
    intro: 'To help you best, I have a few quick questions.',
    introPromo: { ticket: 'Thank you for your interest in our flight tickets ✈️ A few quick questions to check availability:', visa: 'Thank you for your interest in our visa service 🛂 A few quick questions:', package: 'Thank you for your interest in this offer 🌴 A few quick questions:', other: 'Thank you for your message. One quick question:' } as Record<EnquiryService, string>,
    name: 'May I have your name?',
    service: 'What can we help you with?',
    route: 'Which route? Departure city and destination.\n_Example: Paris → Chennai_',
    destination: { visa: 'Which country do you need a visa for?', package: 'Where would you like to go? (country or city)' },
    nationality: 'What is your nationality (passport country)?',
    dates: {
      ticket: 'Departure date, and return date if it is a return trip.\n_Example: 12 August – 30 August, or 12 August one way_',
      visa: 'When are you planning to travel?\n_Example: 15 December_',
      package: 'When would you like to leave? Give your departure date, and the trip length or return date if you know it.\n_Example: 12 August, 10 days_',
    },
    travellers: {
      ticket: 'How many passengers?\n_Example: 2 adults, 1 child and 1 infant_',
      visa: 'How many people need the visa?',
      package: 'How many travellers?\n_Example: 2 adults and 1 child_',
    },
    type: 'Last question: what kind of trip is it?',
    details: 'Tell us in a few words what you need.',
    choose: 'Choose',
    typeHint: 'Reply with the number:',
    retry: "Sorry, I didn't quite get that. ",
    unreadable: 'Could you answer with a written message, please?',
    thanks: (name: string) => (name ? `Thank you ${name}! ` : 'Thank you! ') + 'Here is your request:',
    labels: { service: 'Request', route: 'Route', destination: 'Destination', visaCountry: 'Visa for', nationality: 'Nationality', dates: 'Dates', travellers: 'Travellers', passengers: 'Passengers', type: 'Type of trip', details: 'Details', promo: 'Offer' },
    closing: 'An Errances Voyages travel consultant will contact you here very soon. You can add any other details in this chat.',
    callButton: 'Call me back',
    serviceSection: 'Your request',
    section: 'Type of trip',
  },
};

export function enquiryText(lang: EnquiryLang) { return T[lang]; }

export function welcomeText(state: EnquiryState, name: string | null) {
  const t = T[state.lang];
  const intro = state.promo && state.service ? t.introPromo[state.service] : t.intro;
  return `${name ? t.welcomeNamed(name) : t.welcome}\n${intro}`;
}

// "*2/4* Quelle destination..." -- the customer sees how far along they are, once the number of
// questions is known (after the service is chosen).
export function questionText(state: EnquiryState, step: EnquiryStep, retry = false) {
  const t = T[state.lang];
  const s = (state.service && state.service !== 'other' ? state.service : 'package') as 'ticket' | 'visa' | 'package';
  const text = step === 'destination' ? t.destination[s === 'visa' ? 'visa' : 'package']
    : step === 'dates' ? t.dates[s]
    : step === 'travellers' ? t.travellers[s]
    : t[step as 'name' | 'service' | 'route' | 'nationality' | 'type' | 'details'];
  const own = state.service ? SERVICE_STEPS[state.service] : [];
  const position = own.length > 1 && own.includes(step) ? `*${own.indexOf(step) + 1}/${own.length}* ` : '';
  return `${position}${retry ? t.retry : ''}${text}`;
}

export function serviceRows(lang: EnquiryLang) {
  return SERVICE_OPTIONS.map((o) => ({ id: `enq:svc:${o.value}`, title: o[lang], description: '' }));
}

export function serviceFallback(state: EnquiryState, retry = false) {
  const t = T[state.lang];
  return `${questionText(state, 'service', retry)}\n${t.typeHint}\n${SERVICE_OPTIONS.map((o, i) => `${i + 1}. ${o[state.lang]}`).join('\n')}`;
}

// A tap on the list (enq:svc:visa), a number 1-4, or a typed word -> the service.
export function parseService(listId: string | undefined, text: string): EnquiryService | null {
  const fromList = /^enq:svc:(\w+)$/.exec(String(listId || ''))?.[1];
  if (fromList && SERVICE_OPTIONS.some((o) => o.value === fromList)) return fromList as EnquiryService;
  const digit = /^\s*([1-4])\s*[.)]?\s*$/.exec(text)?.[1];
  if (digit) return SERVICE_OPTIONS[Number(digit) - 1].value;
  const clean = text.replace(/[^\p{L}\s'/-]/gu, ' ').trim().toLowerCase();
  const exact = SERVICE_OPTIONS.find((o) => [o.fr, o.en].some((label) => label.replace(/[^\p{L}\s'/-]/gu, ' ').trim().toLowerCase() === clean));
  if (exact) return exact.value;
  // Visa before tickets ("visa et billet" is mostly about the visa); "other" only when said.
  for (const value of ['visa', 'ticket', 'package', 'other'] as EnquiryService[]) {
    if (SERVICE_OPTIONS.find((o) => o.value === value)!.words.test(text)) return value;
  }
  return null;
}

export function serviceLabel(value: EnquiryService | null | undefined, lang: EnquiryLang) {
  const label = SERVICE_OPTIONS.find((o) => o.value === value)?.[lang];
  return label ? label.replace(/^\P{L}+/u, '') : null;
}

export function travelTypeRows(lang: EnquiryLang) {
  return TRAVEL_TYPE_OPTIONS.map((o) => ({ id: `enq:${o.value}`, title: o[lang], description: '' }));
}

// The type question as plain text, for when the tappable list cannot be sent.
export function travelTypeFallback(state: EnquiryState, retry = false) {
  const t = T[state.lang];
  return `${questionText(state, 'type', retry)}\n${t.typeHint}\n${TRAVEL_TYPE_OPTIONS.map((o, i) => `${i + 1}. ${o[state.lang]}`).join('\n')}`;
}

// A tap on the list (enq:family), a number 1-6, or a typed word -> the stored travel type.
export function parseTravelType(listId: string | undefined, text: string): string | null {
  const fromList = /^enq:(\w+)$/.exec(String(listId || ''))?.[1];
  if (fromList && TRAVEL_TYPE_OPTIONS.some((o) => o.value === fromList)) return fromList;
  const digit = /^\s*([1-6])\s*[.)]?\s*$/.exec(text)?.[1];
  if (digit) return TRAVEL_TYPE_OPTIONS[Number(digit) - 1].value;
  const exact = TRAVEL_TYPE_OPTIONS.find((o) => [o.fr, o.en].some((label) => label.toLowerCase() === text.trim().toLowerCase()));
  if (exact) return exact.value;
  // Honeymoon before couple, solo before the rest: the more specific word wins.
  for (const value of ['honeymoon', 'corporate', 'solo', 'family', 'group', 'couple']) {
    const option = TRAVEL_TYPE_OPTIONS.find((o) => o.value === value)!;
    if (option.words.test(text)) return value;
  }
  return null;
}

export function travelTypeLabel(value: string | null | undefined, lang: EnquiryLang) {
  return TRAVEL_TYPE_OPTIONS.find((o) => o.value === value)?.[lang] ?? null;
}

// "Paris → Chennai", "de Paris à Chennai", "Paris - Chennai", "CDG to MAA" -> from / to.
// Anything else ("Chennai") is taken as the destination only.
export function parseRoute(text: string): { from?: string; to?: string } {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = /^(?:de |from )?(.+?)\s*(?:→|->|—|–| - |\/| to | vers | à | a | pour )\s*(.+)$/i.exec(t);
  const tidy = (s: string) => s.replace(/^(de|from|à|a|to|vers|pour)\s+/i, '').replace(/[.!?]+$/, '').trim().slice(0, 80);
  if (m && /\p{L}{2,}/u.test(m[1]) && /\p{L}{2,}/u.test(m[2])) return { from: tidy(m[1]), to: tidy(m[2]) };
  return /\p{L}{2,}/u.test(t) ? { to: tidy(t) } : {};
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10,
};

// "2 adultes, 1 enfant et 1 bébé", "we are four", "moi et ma femme" -> { adults, children, infants }.
export function parseTravellers(text: string): { adults?: number; children?: number; infants?: number } {
  const t = text.toLowerCase().replace(/\b[a-zéèêûô]+\b/g, (w) => (NUMBER_WORDS[w] ? String(NUMBER_WORDS[w]) : w));
  const count = (re: RegExp) => { const m = re.exec(t); return m ? Math.min(Number(m[1]), 99) : undefined; };
  let adults = count(/(\d+)\s*(?:adultes?|adults?|grown[- ]?ups?|personnes?|people|persons?|pax|passagers?|passengers?|voyageurs?|travell?ers?)/);
  const children = count(/(\d+)\s*(?:enfants?|children|child|kids?|ados?|teens?)/);
  // Babies under two: they fly on a lap at an infant fare, so tickets count them apart.
  const infants = count(/(\d+)\s*(?:b[ée]b[ée]s?|babies|baby|infants?|nourrissons?)/);
  if (adults === undefined) {
    // No "adults" word: "en couple" and "seul" say it themselves; otherwise the largest number
    // left once children and ages are set aside ("une famille de 4" -> 4, not the "une").
    const rest = t.replace(/(\d+)\s*(?:enfants?|children|child|kids?|b[ée]b[ée]s?|babies|baby|infants?|ados?|teens?|ans|years?|yo)\b/g, ' ');
    const bare = [...rest.matchAll(/(?:^|[^\d/.-])(\d{1,2})(?![\d/.-])/g)].map((m) => Number(m[1]));
    if (/\b(couple|ma femme|mon mari|my wife|my husband|nous deux)\b/.test(t) || /(?:^|\s)[àa] deux\b/.test(text.toLowerCase())) adults = 2;
    else if (/\b(seule?|alone|just me|myself|tout seul)\b/.test(t)) adults = 1;
    else if (bare.length) {
      adults = Math.max(...bare);
      // "nous sommes 4 dont 2 enfants": the number was the whole party, children included.
      if ((children || infants) && /\b(dont|including|of which|incl)\b/.test(t)) adults = Math.max(adults - (children ?? 0) - (infants ?? 0), 1);
    }
  }
  return { ...(adults && adults > 0 ? { adults } : {}), ...(children !== undefined ? { children } : {}), ...(infants !== undefined ? { infants } : {}) };
}

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, january: 1, 'février': 2, fevrier: 2, 'févr': 2, fev: 2, feb: 2, february: 2, mars: 3, mar: 3, march: 3,
  avril: 4, avr: 4, apr: 4, april: 4, mai: 5, may: 5, juin: 6, jun: 6, june: 6, juillet: 7, juil: 7, jul: 7, july: 7,
  'août': 8, aout: 8, aug: 8, august: 8, septembre: 9, sept: 9, sep: 9, september: 9, octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11, 'décembre': 12, decembre: 12, 'déc': 12, dec: 12, december: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

// "12 août, 10 jours", "12/08/2027 au 22/08", "August 12 for two weeks" -> ISO dates when the
// answer holds an exact day. A date with no year means its next occurrence. Anything vaguer
// ("en été", "mi-juillet") is kept as the customer wrote it and returns nothing here.
export function parseTravelDates(text: string, today = new Date()): { from?: string; to?: string } {
  const t = text.toLowerCase().replace(/\b1er\b/g, '1');
  const found: { at: number; date: Date }[] = [];
  const make = (day: number, month: number, year?: number) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let y = year ? (year < 100 ? 2000 + year : year) : today.getUTCFullYear();
    let d = new Date(Date.UTC(y, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return null;
    if (!year && d.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) { y += 1; d = new Date(Date.UTC(y, month - 1, day)); }
    return d;
  };
  const add = (at: number, d: Date | null) => { if (d) found.push({ at, date: d }); };
  for (const m of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(m.index!, make(Number(m[3]), Number(m[2]), Number(m[1])));
  for (const m of t.replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, (x) => ' '.repeat(x.length)).matchAll(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g)) add(m.index!, make(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${MONTH_NAMES})\\.?(?:\\s+(\\d{4}))?`, 'g'))) add(m.index!, make(Number(m[1]), MONTHS[m[2]], m[3] ? Number(m[3]) : undefined));
  for (const m of t.matchAll(new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'g'))) add(m.index!, make(Number(m[2]), MONTHS[m[1]], m[3] ? Number(m[3]) : undefined));
  found.sort((a, b) => a.at - b.at);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = found[0]?.date;
  if (!from) return {};
  let to = found.find((f) => f.date.getTime() > from.getTime())?.date;
  if (!to) {
    const withWords = t.replace(/\b[a-zéèêûô]+\b/g, (w) => (NUMBER_WORDS[w] ? String(NUMBER_WORDS[w]) : w));
    const length = /(\d{1,3})\s*(jours?|days?|nuits?|nights?|semaines?|weeks?)/.exec(withWords);
    if (length) {
      const days = Number(length[1]) * (/^(sem|week)/.test(length[2]) ? 7 : 1);
      if (days > 0 && days <= 365) to = new Date(from.getTime() + days * 86400000);
    }
  }
  return { from: iso(from), ...(to ? { to: iso(to) } : {}) };
}

// The answers as labelled lines, in the customer's language (or English for staff).
export function answerLines(state: EnquiryState, lang: EnquiryLang): string[] {
  const l = T[lang].labels;
  const a = state.answers;
  const service = state.service ?? null;
  const travellersLabel = service === 'ticket' ? l.passengers : l.travellers;
  return [
    service && `${l.service}: ${serviceLabel(service, lang)}`,
    state.promo && `${l.promo}: ${state.promo}`,
    a.route && `${l.route}: ${a.route}`,
    a.destination && `${service === 'visa' ? l.visaCountry : l.destination}: ${a.destination}`,
    a.nationality && `${l.nationality}: ${a.nationality}`,
    a.dates && `${l.dates}: ${a.dates}`,
    a.travellers && `${travellersLabel}: ${a.travellers}`,
    (state.travelType || a.type) && `${l.type}: ${travelTypeLabel(state.travelType, lang) ?? a.type}`,
    a.details && `${l.details}: ${a.details}`,
  ].filter((x): x is string => !!x);
}

// What the customer gets at the end: their answers back, and what happens next.
export function summaryText(state: EnquiryState, name: string) {
  const t = T[state.lang];
  const lines = answerLines(state, state.lang).map((line) => { const i = line.indexOf(': '); return `• *${line.slice(0, i)}* : ${line.slice(i + 2)}`; });
  return `${t.thanks(name)}\n\n${lines.join('\n')}\n\n${t.closing}`;
}

// One line for the sales team (always English, like the rest of the staff alerts).
export function staffSummary(state: EnquiryState) {
  const a = state.answers;
  return [serviceLabel(state.service, 'en'), a.route, a.destination, a.nationality && `${a.nationality} passport`, a.dates, a.travellers, travelTypeLabel(state.travelType, 'en') ?? a.type, a.details].filter(Boolean).join(' · ');
}
