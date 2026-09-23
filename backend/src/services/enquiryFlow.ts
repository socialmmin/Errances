import { needsAgent } from './frontdeskFlow.js';
export const questions = [
  {
    key: "name",
    label: "Full name",
    body: "Thank you for contacting Errances Voyages about your travel enquiry. To record your request, what is your full name?",
  },
  {
    key: "destination",
    label: "Destination / package",
    body: "For your travel enquiry, which destination or tour package are you enquiring about? Please reply with the destination or package name.",
  },
  {
    key: "travel_date",
    label: "Travel date",
    body: "We are processing the travel enquiry you sent to Errances Voyages. To complete your enquiry record, please reply with the requested travel date in DD/MM/YYYY format, or FLEXIBLE if it is not yet fixed.",
  },
  {
    key: "travellers",
    label: "Travellers",
    body: "For your travel enquiry, how many adults and children will be travelling? For example: 2 adults and 1 child, age 7.",
  },
  {
    key: "city",
    label: "Departure city",
    body: "For your travel enquiry, which city will you depart from?",
  },
  {
    key: "budget",
    label: "Total budget",
    body: "For your travel enquiry, what is your approximate total trip budget and currency? For example: INR 150000. You can reply undecided.",
  },
  {
    key: "email",
    label: "Email",
    body: "Which email address should we use for the details of your travel enquiry? Reply skip if you prefer WhatsApp only.",
  },
  {
    key: "requirements",
    label: "Special requirements",
    body: "For your travel enquiry, do you have any hotel, transport, accessibility or other requirements? Please describe them, or reply none.",
  },
] as const;

export const workflowTemplates = [
  ...questions.map((q) => ({
    key: q.key,
    name: `ev_enquiry_${q.key}_${q.key === "travel_date" ? "v2" : "v1"}`,
    body: q.body,
  })),
  {
    key: "confirm",
    name: "ev_enquiry_confirm_v1",
    body: "Your Errances Voyages enquiry has been recorded: {{1}}. Please reply CONFIRM if these details are correct, RESTART to enter them again, or AGENT to speak to our team.",
  },
  {
    key: "completed",
    name: "ev_enquiry_received_v1",
    body: "Your travel enquiry has been confirmed with Errances Voyages. Our travel consultant will review your requirements and reply here. Your enquiry reference is {{1}}. You can send any additional information in this chat.",
  },
  {
    key: "handoff",
    name: "ev_enquiry_agent_v1",
    body: "Your request to speak to an Errances Voyages travel consultant has been recorded. The automated questions are paused and our team will reply in this chat.",
  },
];

export type Answers = Record<string, string>;
export type FlowState = { step: string; answers: Answers; paused?: boolean };
export type FlowResult = FlowState & {
  templateKey?: string;
  variables?: Record<string, string>;
  completed?: boolean;
  error?: string;
};
const greeting =
  /^(hi+|hello|hey|bonjour|salut|start|menu|restart|good morning|good evening)$/i;

export function parseTravelDate(input: string): string | null {
  let date = input.trim();
  const local = date.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (local)
    date = `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

export function enquirySummary(answers: Answers): string {
  return questions
    .map((q) => `${q.label}: ${answers[q.key] || "Not provided"}`)
    .join("; ")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 950);
}

/** Pure state machine: only an inbound customer answer advances the enquiry. */
export function advanceEnquiry(
  state: FlowState,
  input: string,
  today = new Date().toISOString().slice(0, 10),
): FlowResult {
  const text = input.trim();
  if (/^(stop|unsubscribe)$/i.test(text)) return { ...state, paused: true };
  if (needsAgent(text) || /^(help)$/i.test(text))
    return { ...state, paused: true, templateKey: "handoff" };
  if (/^(restart|menu|start)$/i.test(text))
    return { step: "name", answers: {}, paused: false, templateKey: "name" };
  if (state.paused || state.step === "completed") return state;
  if (!state.step || state.step === "welcome")
    return { step: "name", answers: {}, templateKey: "name" };
  if (state.step === "confirm") {
    if (/^(confirm|yes|correct|ok|okay)$/i.test(text))
      return {
        ...state,
        step: "completed",
        completed: true,
        templateKey: "completed",
      };
    return {
      ...state,
      templateKey: "confirm",
      variables: { "1": enquirySummary(state.answers) },
    };
  }
  const index = questions.findIndex((q) => q.key === state.step);
  if (index < 0) return { step: "name", answers: {}, templateKey: "name" };
  let valid = text.length > 0 && text.length <= 400;
  if (state.step === "name")
    valid =
      valid && text.length >= 2 && !greeting.test(text) && /\p{L}/u.test(text);
  if (state.step === "destination" || state.step === "city")
    valid = valid && text.length >= 2 && !greeting.test(text);
  if (state.step === "travel_date")
    valid =
      /^(flexible|undecided)$/i.test(text) ||
      Boolean(parseTravelDate(text) && parseTravelDate(text)! >= today);
  if (state.step === "travellers") valid = valid && /\b[1-9]\d?\b/.test(text);
  if (state.step === "budget")
    valid =
      /^(undecided|flexible)$/i.test(text) || (valid && /[1-9]/.test(text));
  if (state.step === "email")
    valid = /^skip$/i.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  if (!valid) return { ...state, templateKey: state.step };
  const answers = { ...state.answers, [state.step]: text };
  const next =
    index === questions.length - 1 ? "confirm" : questions[index + 1].key;
  return {
    step: next,
    answers,
    templateKey: next,
    ...(next === "confirm"
      ? { variables: { "1": enquirySummary(answers) } }
      : {}),
  };
}
