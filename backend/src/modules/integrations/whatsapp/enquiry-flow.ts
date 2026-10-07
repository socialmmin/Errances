// The WhatsApp enquiry: when someone writes in, the bot welcomes them and asks a few short
// questions (their name only if WhatsApp did not give one, then destination, departure date,
// travellers, type of trip), sums the answers up and hands over to sales. This file holds the
// wording in French and English and the reading of free-text answers; WhatsAppBotService runs it.

export type EnquiryLang = 'fr' | 'en';
export type EnquiryStep = 'name' | 'destination' | 'dates' | 'travellers' | 'type';

export interface EnquiryState {
  lang: EnquiryLang;
  step: EnquiryStep;
  steps: EnquiryStep[];
  answers: Partial<Record<EnquiryStep, string>>;
  // The stored travel type (family, couple...) once the last question is answered.
  travelType?: string | null;
  startedAt: string;
  // Times the current question was asked again after an answer that could not be used.
  retries: number;
}

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
    intro: (n: number) => `Pour vous proposer le voyage qui vous convient, j'ai ${n} petites questions.`,
    name: 'Quel est votre nom ?',
    destination: 'Quelle destination souhaitez-vous ? (pays ou ville)',
    dates: 'Quand souhaitez-vous partir ? Indiquez la date de départ, et la durée ou la date de retour si vous la connaissez.\n_Exemple : 12 août, 10 jours_',
    travellers: 'Combien de voyageurs ?\n_Exemple : 2 adultes et 1 enfant_',
    type: 'Dernière question : quel type de voyage ?',
    typeButton: 'Choisir',
    typeHint: 'Répondez par le numéro :',
    retry: "Je n'ai pas bien compris. ",
    unreadable: 'Pouvez-vous me répondre par un message écrit, s’il vous plaît ?',
    thanks: (name: string) => (name ? `Merci ${name} ! ` : 'Merci ! ') + 'Voici votre demande :',
    labels: { destination: 'Destination', dates: 'Départ', travellers: 'Voyageurs', type: 'Type de voyage' },
    closing: 'Un conseiller Errances Voyages vous contactera très vite ici avec une proposition. Vous pouvez ajouter d’autres précisions dans ce chat.',
    callButton: 'Être rappelé(e)',
    section: 'Type de voyage',
  },
  en: {
    welcomeNamed: (name: string) => `Hello ${name} 👋 Welcome to *Errances Voyages*!`,
    welcome: 'Hello 👋 Welcome to *Errances Voyages*!',
    intro: (n: number) => `To suggest the right trip for you, I have ${n} quick questions.`,
    name: 'May I have your name?',
    destination: 'Where would you like to go? (country or city)',
    dates: 'When would you like to leave? Give your departure date, and the trip length or return date if you know it.\n_Example: 12 August, 10 days_',
    travellers: 'How many travellers?\n_Example: 2 adults and 1 child_',
    type: 'Last question: what kind of trip is it?',
    typeButton: 'Choose',
    typeHint: 'Reply with the number:',
    retry: "Sorry, I didn't quite get that. ",
    unreadable: 'Could you answer with a written message, please?',
    thanks: (name: string) => (name ? `Thank you ${name}! ` : 'Thank you! ') + 'Here is your request:',
    labels: { destination: 'Destination', dates: 'Departure', travellers: 'Travellers', type: 'Type of trip' },
    closing: 'An Errances Voyages travel consultant will contact you here very soon with a proposal. You can add any other details in this chat.',
    callButton: 'Call me back',
    section: 'Type of trip',
  },
};

export function enquiryText(lang: EnquiryLang) { return T[lang]; }

export function welcomeText(state: EnquiryState, name: string | null) {
  const t = T[state.lang];
  return `${name ? t.welcomeNamed(name) : t.welcome}\n${t.intro(state.steps.length)}`;
}

// "*2/4* Quelle destination..." -- the customer sees how far along they are.
export function questionText(state: EnquiryState, step: EnquiryStep, retry = false) {
  const t = T[state.lang];
  const position = `*${state.steps.indexOf(step) + 1}/${state.steps.length}*`;
  return `${position} ${retry ? t.retry : ''}${t[step]}`;
}

export function travelTypeRows(lang: EnquiryLang) {
  return TRAVEL_TYPE_OPTIONS.map((o) => ({ id: `enq:${o.value}`, title: o[lang], description: '' }));
}

// The type question as plain text, for when the tappable list cannot be sent.
export function travelTypeFallback(state: EnquiryState) {
  const t = T[state.lang];
  return `${questionText(state, 'type')}\n${t.typeHint}\n${TRAVEL_TYPE_OPTIONS.map((o, i) => `${i + 1}. ${o[state.lang]}`).join('\n')}`;
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

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10,
};

// "2 adultes et 1 enfant", "we are four", "moi et ma femme" -> { adults, children }.
export function parseTravellers(text: string): { adults?: number; children?: number } {
  const t = text.toLowerCase().replace(/\b[a-zéèêûô]+\b/g, (w) => (NUMBER_WORDS[w] ? String(NUMBER_WORDS[w]) : w));
  const count = (re: RegExp) => { const m = re.exec(t); return m ? Math.min(Number(m[1]), 99) : undefined; };
  let adults = count(/(\d+)\s*(?:adultes?|adults?|grown[- ]?ups?|personnes?|people|persons?|pax|voyageurs?|travell?ers?)/);
  const children = count(/(\d+)\s*(?:enfants?|children|child|kids?|b[ée]b[ée]s?|babies|baby|infants?|ados?|teens?)/);
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
      if (children && /\b(dont|including|of which|incl)\b/.test(t)) adults = Math.max(adults - children, 1);
    }
  }
  return { ...(adults && adults > 0 ? { adults } : {}), ...(children !== undefined ? { children } : {}) };
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

// What the customer gets at the end: their answers back, and what happens next.
export function summaryText(state: EnquiryState, name: string) {
  const t = T[state.lang];
  const a = state.answers;
  const lines = [
    `📍 *${t.labels.destination}* : ${a.destination ?? '-'}`,
    `📅 *${t.labels.dates}* : ${a.dates ?? '-'}`,
    `👥 *${t.labels.travellers}* : ${a.travellers ?? '-'}`,
    `🧳 *${t.labels.type}* : ${travelTypeLabel(state.travelType, state.lang) ?? a.type ?? '-'}`,
  ];
  return `${t.thanks(name)}\n\n${lines.join('\n')}\n\n${t.closing}`;
}

// One line for the sales team (always English, like the rest of the staff alerts).
export function staffSummary(state: EnquiryState) {
  const a = state.answers;
  return [a.destination, a.dates, a.travellers, travelTypeLabel(state.travelType, 'en') ?? a.type].filter(Boolean).join(' · ');
}
