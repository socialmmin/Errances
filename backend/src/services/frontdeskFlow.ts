import type { FlowState, FlowResult } from "./enquiryFlow.js";
import {
  findOffice,
  officeStatus,
  type Knowledge,
} from "./hotlineKnowledge.js";
export type CataloguePackage = {
  id: string;
  title: string;
  destination: string;
  duration: number;
  duration_note?: string;
  category?: string;
  description: string;
  inclusions?: string[];
  status: string;
};
const copy = {
  en: {
    welcome:
      "Hello and welcome to Errances Voyages! I am Jennifer, your virtual assistant. For your enquiry, reply FLIGHT, HOTEL, CUSTOM TRIP, PACKAGE, OFFICE or AGENT. You can reply FRANÇAIS for French. A human advisor prepares every quotation and confirms bookings.",
    name: "To record your travel enquiry, what is your full name?",
    origin:
      "For your flight enquiry, which city or airport will you depart from?",
    destination: "For your travel enquiry, what is the destination?",
    dates:
      "For your travel enquiry, what are your departure and return dates? Please include the year, or reply FLEXIBLE.",
    travellers:
      "How many adults and children are travelling? Please include the children’s ages.",
    cabin:
      "For your flight enquiry, which cabin would you prefer: economy, premium economy, business or first?",
    baggage:
      "For your flight enquiry, what checked baggage do you need? Reply UNSURE if you do not know.",
    rooms:
      "For your hotel enquiry, how many rooms and what hotel category do you prefer?",
    preferences:
      "For your travel enquiry, tell us your preferences, approximate budget and any special requirements. Reply NONE if there are none.",
    handoff:
      "Your request has been placed in the Errances Voyages advisor queue. The automated questions are paused. An advisor will review your request and reply here. Only an advisor can confirm prices, availability and bookings. You may send further details in this chat.",
    search:
      "For your package enquiry, please enter a destination or package name. We will check our published catalogue. Reply AGENT at any time to speak to an advisor.",
    package:
      "For your enquiry, the matching catalogue package is {{1}}. Destination: {{2}}. Duration: {{3}}. Published details: {{4}}. Reply SELECT to enquire about this package or NEXT for another match. An advisor must confirm availability and prepare your quotation.",
    no_packages:
      "We could not find a published package matching your enquiry in our connected catalogue. Your request has been placed in the advisor queue. Please send your destination and preferred dates; an advisor will help you.",
    office:
      "Which office is your enquiry for? Reply 1 for Errances Voyages – Paris, 2 for Errances Voyages – La Courneuve, 3 for Errances Voyages – Jaffna – Sri Lanka, 4 for Errances Voyages – Pondicherry – India, or 5 for Errances Holidays – Paris.",
    hours:
      "Office information for your enquiry: {{1}}. Regular opening days: {{2}}. Hours: {{3}}, local time ({{4}}). Closed on applicable public/bank holidays. Current schedule check: {{5}}. Reply AGENT to contact an advisor or MENU for another enquiry.",
  },
  fr: {
    welcome:
      "Bonjour et bienvenue chez Errances Voyages ! Je suis Jennifer, votre assistante virtuelle. Pour votre demande, répondez VOL, HÔTEL, VOYAGE SUR MESURE, CIRCUIT, AGENCE ou CONSEILLER. Répondez ENGLISH pour continuer en anglais. Un conseiller prépare chaque devis et confirme les réservations.",
    name: "Pour enregistrer votre demande de voyage, quel est votre nom complet ?",
    origin:
      "Pour votre demande de vol, quelle est votre ville ou votre aéroport de départ ?",
    destination: "Pour votre demande de voyage, quelle est votre destination ?",
    dates:
      "Pour votre demande de voyage, quelles sont les dates de départ et de retour ? Indiquez l’année, ou répondez FLEXIBLE.",
    travellers:
      "Combien d’adultes et d’enfants voyagent ? Merci de préciser l’âge des enfants.",
    cabin:
      "Pour votre demande de vol, quelle cabine souhaitez-vous : économique, premium, affaires ou première ?",
    baggage:
      "Pour votre demande de vol, quels bagages en soute souhaitez-vous ? Répondez INCERTAIN si vous ne savez pas.",
    rooms:
      "Pour votre demande d’hôtel, combien de chambres et quelle catégorie d’hôtel souhaitez-vous ?",
    preferences:
      "Pour votre demande de voyage, indiquez vos préférences, votre budget approximatif et vos besoins particuliers. Répondez AUCUN si vous n’en avez pas.",
    handoff:
      "Votre demande a été placée dans la file d’attente des conseillers Errances Voyages. Les questions automatiques sont suspendues. Un conseiller examinera votre demande et vous répondra ici. Seul un conseiller peut confirmer les prix, les disponibilités et les réservations. Vous pouvez ajouter des précisions dans cette conversation.",
    search:
      "Pour votre demande de circuit, indiquez une destination ou le nom d’un forfait. Nous consulterons notre catalogue publié. Répondez CONSEILLER à tout moment pour parler à notre équipe.",
    package:
      "Pour votre demande, voici le forfait du catalogue : {{1}}. Destination : {{2}}. Durée : {{3}}. Informations publiées : {{4}}. Répondez CHOISIR pour demander ce forfait ou SUIVANT pour un autre résultat. Un conseiller doit confirmer la disponibilité et préparer votre devis.",
    no_packages:
      "Aucun forfait publié correspondant à votre demande n’a été trouvé dans notre catalogue connecté. Votre demande a été placée dans la file des conseillers. Envoyez votre destination et vos dates souhaitées ; un conseiller vous aidera.",
    office:
      "Quelle agence souhaitez-vous contacter ? Répondez 1 pour Errances Voyages – Paris, 2 pour Errances Voyages – La Courneuve, 3 pour Errances Voyages – Jaffna – Sri Lanka, 4 pour Errances Voyages – Pondicherry – India, ou 5 pour Errances Holidays – Paris.",
    hours:
      "Informations pour votre demande : {{1}}. Jours habituels : {{2}}. Horaires : {{3}}, heure locale ({{4}}). Fermé les jours fériés applicables. Vérification des horaires : {{5}}. Répondez CONSEILLER pour contacter notre équipe ou MENU pour une autre demande.",
  },
};
export const frontdeskTemplates = Object.entries(copy).flatMap(
  ([language, messages]) =>
    Object.entries(messages).map(([key, body]) => ({
      key: `desk_${language}_${key}`,
      name: `ev_desk_${language}_${key}_v1`,
      body,
      language,
      samples:
        key === "package"
          ? {
              "1": "Paris Discovery",
              "2": "Paris, France",
              "3": "5 days",
              "4": "City walks and hotel accommodation. Details confirmed by an advisor.",
            }
          : key === "hours"
            ? {
                "1": "Errances Voyages – Paris",
                "2": "Monday to Saturday",
                "3": "10:00–19:00",
                "4": "Europe/Paris",
                "5": "Holiday calendar not verified; please confirm with an advisor.",
              }
            : {},
    })),
);
const plain = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function needsAgent(input: string) {
  return (
    /\b(agent|human|advisor|adviser|conseiller|conseillere|humain|representative|support|complaint|complain|reclamation|refund|remboursement|visa|payment|paiement|annulation|cancel|cancellation|reschedule)\b/.test(
      plain(input),
    ) ||
    /\b(change|modifier|modification)\b.*\b(booking|flight|ticket|reservation|vol|billet)\b/.test(
      plain(input),
    )
  );
}
export function serviceIntent(input: string) {
  const t = plain(input);
  if (/\b(flight|ticket|billet|vol|flights|tickets)\b/.test(t)) return "flight";
  if (/\b(hotel|hotels|chambre|room)\b/.test(t)) return "hotel";
  if (/\b(package|packages|circuit|circuits|forfait|tour)\b/.test(t))
    return "package";
  if (/custom|sur mesure/.test(t)) return "custom";
  return "";
}
export function deskControl(input: string) {
  return (
    needsAgent(input) ||
    Boolean(serviceIntent(input)) ||
    /^(hello|hi|bonjour|salut|menu|start|restart|stop|unsubscribe|arret|arrêt|english|francais|français)$/i.test(
      input.trim(),
    )
  );
}
export function advanceFrontdesk(
  state: FlowState,
  input: string,
  k: Knowledge,
  packages: CataloguePackage[],
  now = new Date(),
): FlowResult {
  const text = input.trim();
  const t = plain(text);
  const answers = { ...state.answers };
  const language =
    /\b(bonjour|salut|francais|conseiller|billet|je voudrais|je souhaite|horaires|agence)\b/.test(
      t,
    )
      ? "fr"
      : /^english$/.test(t)
        ? "en"
        : answers.language || "en";
  answers.language = language;
  const lang = language === "fr" ? "fr" : "en";
  const reply = (
    key: string,
    step = state.step,
    extra: Partial<FlowResult> = {},
  ): FlowResult => ({
    step,
    answers,
    templateKey: `desk_${lang}_${key}`,
    ...extra,
  });
  const handoff = (key = "handoff") => {
    answers.request = text;
    answers.quote_status = "agent_required";
    return reply(key, "desk_handoff", { paused: true });
  };
  if (/^(stop|unsubscribe|arret)$/i.test(t)) return { ...state, paused: true };
  if (needsAgent(text)) {
    answers.service = serviceIntent(text) || answers.service || "support";
    return handoff();
  }
  if (/^(menu|start|restart|english|francais)$/i.test(t))
    return {
      step: "desk_service",
      answers: { language: lang },
      paused: false,
      templateKey: `desk_${lang}_welcome`,
    };
  if (state.paused) return state;
  if (
    state.step === "desk_office" ||
    /\b(office|agence|bureau|opening|open|closed|hours|horaires|ouvert|ferme)\b/.test(
      t,
    )
  ) {
    const o =
      state.step === "desk_office" && /^[1-5]$/.test(t)
        ? k.offices[Number(t) - 1]
        : findOffice(text, k);
    if (!o) return reply("office", "desk_office");
    answers.office_id = o.id;
    answers.office = o.name;
    const days =
      lang === "fr"
        ? [
            "dimanche",
            "lundi",
            "mardi",
            "mercredi",
            "jeudi",
            "vendredi",
            "samedi",
          ]
        : [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ];
    return reply("hours", "desk_service", {
      variables: {
        "1": o.name,
        "2": o.open_days.map((d) => days[d]).join(", "),
        "3": `${o.opens}–${o.closes}`,
        "4": o.timezone,
        "5": officeStatus(o, lang, now),
      },
    });
  }
  const service = serviceIntent(text);
  if (
    (!state.step ||
      state.step === "welcome" ||
      state.step === "desk_service" ||
      state.step === "name" ||
      state.step === "desk_name") &&
    service
  ) {
    answers.service = service;
    answers.initial_request = text;
    return service === "package"
      ? reply("search", "desk_search")
      : reply("name", "desk_name");
  }
  if (
    !state.step ||
    state.step === "welcome" ||
    state.step === "desk_service" ||
    !state.step.startsWith("desk_")
  )
    return reply("welcome", "desk_service");
  if (state.step === "desk_search" || state.step === "desk_package") {
    const query =
      state.step === "desk_search" ? text : answers.package_search || "";
    answers.package_search = query;
    const q = plain(query);
    const matches = packages.filter(
      (p) =>
        p.status === "active" &&
        plain(`${p.title} ${p.destination} ${p.category || ""}`).includes(q),
    );
    if (!matches.length) {
      answers.service = "package";
      answers.destination = query;
      return handoff("no_packages");
    }
    let index =
      state.step === "desk_search" ? 0 : Number(answers.package_index || 0);
    if (/^(next|suivant)$/.test(t)) index = (index + 1) % matches.length;
    const selecting =
      state.step === "desk_package" && /^(select|choisir|yes|oui)$/.test(t);
    const pack = selecting
      ? packages.find(
          (p) => p.id === answers.package_offer_id && p.status === "active",
        )
      : matches[index] || matches[0];
    if (!pack) return handoff("no_packages");
    answers.package_index = String(index);
    if (state.step === "desk_package" && /^(select|choisir|yes|oui)$/.test(t)) {
      answers.package_id = pack.id;
      answers.package_title = pack.title;
      answers.destination = pack.destination;
      return reply("name", "desk_name");
    }
    answers.package_offer_id = pack.id;
    return reply("package", "desk_package", {
      variables: {
        "1": pack.title.slice(0, 180),
        "2": pack.destination || "—",
        "3": pack.duration_note
          ? lang === "fr"
            ? "À confirmer par un conseiller"
            : "To be confirmed by an advisor"
          : pack.duration
            ? `${pack.duration} ${lang === "fr" ? "jours" : "days"}`
            : "—",
        "4":
          String(pack.description || "")
            .replace(/<[^>]*>/g, "")
            .replace(/[\r\n\t]+/g, " ")
            .slice(0, 500) || "Details available from an advisor.",
      },
    });
  }
  const flows: Record<string, string[]> = {
    flight: [
      "name",
      "origin",
      "destination",
      "dates",
      "travellers",
      "cabin",
      "baggage",
    ],
    hotel: [
      "name",
      "destination",
      "dates",
      "travellers",
      "rooms",
      "preferences",
    ],
    custom: ["name", "destination", "dates", "travellers", "preferences"],
    package: ["name", "dates", "travellers", "origin", "preferences"],
  };
  const flow = flows[answers.service] || flows.custom;
  const current = state.step.replace("desk_", "");
  if (
    current === "name" &&
    (!/^[\p{L} .’'-]{2,100}$/u.test(text) ||
      /\b(book|booking|want|need|bonjour|hello|reserve|reserver|ticket|flight|hotel)\b/.test(
        t,
      ))
  )
    return reply("name");
  if (
    text.length < 2 ||
    text.length > 500 ||
    (current === "travellers" && !/[1-9]/.test(text))
  )
    return reply(current);
  answers[current] = text;
  const index = flow.indexOf(current);
  if (index < 0) return reply("welcome", "desk_service");
  if (index === flow.length - 1) return handoff();
  return reply(flow[index + 1], `desk_${flow[index + 1]}`);
}
