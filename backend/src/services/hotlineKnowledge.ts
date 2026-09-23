import { pool } from "../db.js";
import { z } from "zod";
export const officeSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  name: z.string().min(3).max(100),
  country: z.string().max(60),
  city: z.string().max(60),
  timezone: z.enum(["Europe/Paris", "Asia/Colombo", "Asia/Kolkata"]),
  open_days: z.array(z.number().int().min(0).max(6)).min(1),
  opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closes: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  holidays_verified_through: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  assigned_staff_id: z.string().uuid().nullable().default(null),
});
const policy = {
  hotline: "+17752555600",
  assistant_name: "Jennifer",
  assistant_kind: "virtual assistant",
  languages: ["fr", "en"],
  automated_replies: "approved_utility_templates_only",
  quotations: "human_only",
  catalogue_source: "https://errancesholidays.com/packages",
};
export const knowledgeSchema = z.object({
  policy: z
    .object({
      hotline: z.literal("+17752555600"),
      assistant_name: z.literal("Jennifer"),
      assistant_kind: z.literal("virtual assistant"),
      languages: z.array(z.enum(["fr", "en"])),
      automated_replies: z.literal("approved_utility_templates_only"),
      quotations: z.literal("human_only"),
      catalogue_source: z.literal("https://errancesholidays.com/packages"),
    })
    .default(policy as any),
  enabled: z.boolean(),
  offices: z.array(officeSchema).length(5),
});
export type Knowledge = z.infer<typeof knowledgeSchema>;
const office = (
  id: string,
  name: string,
  country: string,
  city: string,
  timezone: "Europe/Paris" | "Asia/Colombo" | "Asia/Kolkata",
  sunday = false,
) => ({
  id,
  name,
  country,
  city,
  timezone,
  open_days: sunday ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6],
  opens: "10:00",
  closes: "19:00",
  holidays: [],
  holidays_verified_through: null,
  assigned_staff_id: null,
});
export const defaultKnowledge: Knowledge = knowledgeSchema.parse({
  enabled: true,
  offices: [
    office(
      "paris",
      "Errances Voyages – Paris",
      "France",
      "Paris",
      "Europe/Paris",
    ),
    office(
      "la_courneuve",
      "Errances Voyages – La Courneuve",
      "France",
      "La Courneuve",
      "Europe/Paris",
      true,
    ),
    office(
      "jaffna",
      "Errances Voyages – Jaffna – Sri Lanka",
      "Sri Lanka",
      "Jaffna",
      "Asia/Colombo",
    ),
    office(
      "pondicherry",
      "Errances Voyages – Pondicherry – India",
      "India",
      "Pondicherry / Puducherry",
      "Asia/Kolkata",
    ),
    office(
      "holidays_paris",
      "Errances Holidays – Paris",
      "France",
      "Paris",
      "Europe/Paris",
    ),
  ],
});
export const hotlineRules = [
  "One global hotline: +1 (775) 255-5600. Never infer the office from the phone country code.",
  "Customer-facing languages: French and English. Preserve the selected language.",
  "Every automated reply must use an active approved Utility template. Never fall back to free text.",
  "Only human advisors prepare quotations, check availability, confirm bookings and commercial terms.",
  "Agent, ticket, complaint, change, visa and payment requests must not be treated as a customer name.",
  "Read published packages from this CRM database. Never invent a package, price or availability.",
  "All offices close on applicable public/bank holidays. Without a verified calendar, do not assert an office is open.",
  "An unassigned office request stays in the shared pending inbox until an agent takes ownership.",
];
export async function getKnowledge(
  db: Pick<typeof pool, "query"> = pool,
): Promise<Knowledge> {
  await db.query(
    "INSERT INTO whatsapp_knowledge(id,document) VALUES(1,$1) ON CONFLICT(id) DO NOTHING",
    [JSON.stringify(defaultKnowledge)],
  );
  const { rows } = await db.query(
    "SELECT document FROM whatsapp_knowledge WHERE id=1",
  );
  return knowledgeSchema.parse(rows[0].document);
}
export function findOffice(text: string, k: Knowledge) {
  const t = text.toLowerCase();
  if (/holidays?|vacances/.test(t) && /paris/.test(t))
    return k.offices.find((o) => o.id === "holidays_paris");
  if (/courneuve/.test(t))
    return k.offices.find((o) => o.id === "la_courneuve");
  if (/jaffna|sri lanka/.test(t))
    return k.offices.find((o) => o.id === "jaffna");
  if (/pondicherry|puducherry|pondichery/.test(t))
    return k.offices.find((o) => o.id === "pondicherry");
  if (/paris/.test(t)) return k.offices.find((o) => o.id === "paris");
}
export function officeStatus(
  o: Knowledge["offices"][number],
  language: string,
  now = new Date(),
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: o.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    p.weekday,
  );
  const closed =
    !o.open_days.includes(day) ||
    time < o.opens ||
    time >= o.closes ||
    o.holidays.includes(date);
  if (closed)
    return language === "fr"
      ? "Fermé selon les horaires ou jours de fermeture enregistrés."
      : "Closed according to the recorded schedule or closure dates.";
  if (!o.holidays_verified_through || date > o.holidays_verified_through)
    return language === "fr"
      ? "Ouverture à confirmer : le calendrier des jours fériés n’a pas été vérifié pour cette date."
      : "Opening must be confirmed: the public-holiday calendar has not been verified for this date.";
  return language === "fr"
    ? "Ouvert selon les horaires et le calendrier vérifiés, sous réserve de fermeture exceptionnelle."
    : "Open according to the verified schedule and holiday calendar, subject to exceptional closures.";
}
