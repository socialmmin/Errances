# Global Errances WhatsApp hotline

Hotline: +1 (775) 255-5600.

## Admin access

- Configuration: https://errances.socialmm.in/settings/whatsapp
- Human conversations: https://errances.socialmm.in/whatsapp
- Catalogue: https://errances.socialmm.in/tours
- Template approvals: https://errances.socialmm.in/whatsapp/templates

The Global hotline panel edits office hours, holidays and office-specific staff assignments. `whatsapp_knowledge.document` stores this structured configuration and policy in PostgreSQL. This is a rule-based workflow, not an unrestricted AI prompt. An unassigned office uses the shared pending inbox.

## Policy

Jennifer identifies herself as a virtual assistant. Customer-facing languages are French and English. Every automatic reply requires an active, approved Utility template. Pending, rejected or reclassified templates block delivery and show an inbox error. There is no free-text fallback.

Human advisors prepare quotations, confirm availability and bookings, and handle commercial decisions. Agent requests, complaints, payment issues, visa questions and booking changes pause the automated questions. They must never be stored as a person's name.

## Offices

| Office | Time zone | Days | Hours |
|---|---|---|---|
| Errances Voyages – Paris | Europe/Paris | Monday–Saturday | 10:00–19:00 |
| Errances Voyages – La Courneuve | Europe/Paris | Monday–Sunday | 10:00–19:00 |
| Errances Voyages – Jaffna – Sri Lanka | Asia/Colombo | Monday–Saturday | 10:00–19:00 |
| Errances Voyages – Pondicherry – India | Asia/Kolkata | Monday–Saturday | 10:00–19:00 |
| Errances Holidays – Paris | Europe/Paris | Monday–Saturday | 10:00–19:00 |

All offices close on applicable public/bank holidays. Enter country/local holiday dates and exceptional closures in Settings, then mark the calendar verified through a date. Until verified, the bot gives regular hours but cannot assert that an office is open. France's time zone includes daylight-saving changes. An unspecified office is requested explicitly; the US hotline number does not determine office location.

## Enquiry paths

- Flight: name, departure city/airport, destination, dates, passengers/child ages, cabin, baggage, advisor.
- Hotel: name, destination, dates, travellers, rooms/category, preferences, advisor.
- Custom trip: name, destination, dates, travellers, preferences/budget, advisor.
- Package: search real active catalogue records, inspect a match, SELECT/CHOISIR or NEXT/SUIVANT, qualify requirements, advisor.
- Office: choose one of the five offices, then receive its regular hours and local schedule check.

An agent can be requested at any point in natural French or English. STOP opts out. START, RESTART or MENU explicitly restarts the conversation under the existing opt-out rules. Conversation briefs include language, service, office, package reference, travel requirements and quotation status. They are saved on the lead and shown in the inbox.

## Catalogue provenance

Source: https://errancesholidays.com/packages. Imported records retain their individual source URLs, descriptions, itineraries, images and inclusions/exclusions. Source descriptions retain their published language. Get Quote records display Quote on request rather than a zero-price offer. Conflicting duration values require advisor review.

## Deployment and operational limits

Meta controls template approval and category decisions. Submitting a template does not make it deliverable. The Utility-only worker does not send a Marketing-classified template. Stale queued responses are not delivered after the current customer-service window expires.

This implementation covers inbound qualification and human handoff. Later quote follow-ups, booking confirmations, pre-departure and post-trip workflows require verified quote/booking events and approved templates before activation. Legacy free-text birthday/travel jobs are disabled.

Run `npm --prefix backend test` only against the isolated local test database. Tests mock external message delivery and cover bilingual intent, false-name prevention, office schedules, catalogue selection, persistent handoff, cancellation of stale questions and approval gating.
