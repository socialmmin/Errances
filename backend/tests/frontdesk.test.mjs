import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceFrontdesk,
  needsAgent,
  deskControl,
  frontdeskTemplates,
} from "../dist/services/frontdeskFlow.js";
import {
  defaultKnowledge,
  officeStatus,
} from "../dist/services/hotlineKnowledge.js";
const start = { step: "welcome", answers: {} };
const go = (state, text, packs = []) =>
  advanceFrontdesk(
    state,
    text,
    defaultKnowledge,
    packs,
    new Date("2026-09-23T10:00:00Z"),
  );
test("Natural agent/ticket requests override name capture in either language", () => {
  for (const text of [
    "I like to book a ticket with an agent",
    "Je voudrais réserver un billet avec un conseiller",
    "I need a refund",
    "payment problem",
    "please change my flight",
  ]) {
    assert.ok(needsAgent(text));
    assert.ok(deskControl(text));
    const next = go({ step: "name", answers: {} }, text);
    assert.equal(next.paused, true);
    assert.equal(next.answers.name, undefined);
    assert.match(next.templateKey, /handoff$/);
  }
  assert.equal(
    go(start, "I like to book a ticket with an agent").answers.service,
    "flight",
  );
});
test("French greeting chooses French template and preserves language across answers", () => {
  let s = go(start, "Bonjour");
  assert.equal(s.templateKey, "desk_fr_welcome");
  s = go(s, "VOL");
  assert.equal(s.templateKey, "desk_fr_name");
  s = go(s, "Jean Dupont");
  assert.equal(s.templateKey, "desk_fr_origin");
  assert.equal(s.answers.name, "Jean Dupont");
});
test("Flight qualification captures separate fields then queues an advisor, never a package or quote", () => {
  let s = go(start, "I need a flight");
  for (const answer of [
    "Alex Traveller",
    "Paris CDG",
    "Colombo",
    "20/12/2030 to 05/01/2031",
    "2 adults",
    "economy",
    "2 checked bags",
  ])
    s = go(s, answer);
  assert.equal(s.step, "desk_handoff");
  assert.equal(s.paused, true);
  assert.equal(s.answers.origin, "Paris CDG");
  assert.equal(s.answers.baggage, "2 checked bags");
  assert.equal(s.answers.quote_status, "agent_required");
});
test("Name capture rejects travel requests and greetings instead of corrupting a lead", () => {
  for (const answer of ["Hello", "I want to book", "Bonjour"]) {
    const s = go({ step: "desk_name", answers: { service: "flight" } }, answer);
    assert.equal(s.answers.name, undefined);
  }
});
test("Office questions request an office, distinguish all five and disclose unverified holidays", () => {
  const choose = go(start, "Are you open today?");
  assert.equal(choose.templateKey, "desk_en_office");
  const answer = go(choose, "2");
  assert.equal(answer.answers.office_id, "la_courneuve");
  assert.equal(answer.variables["1"], "Errances Voyages – La Courneuve");
  assert.match(answer.variables["5"], /not been verified/);
  const holidays = go(start, "office Errances Holidays Paris");
  assert.equal(holidays.answers.office_id, "holidays_paris");
});
test("Local schedule checks Sunday, closing boundary, DST and verified public holidays", () => {
  const paris = defaultKnowledge.offices[0],
    courneuve = defaultKnowledge.offices[1];
  assert.match(
    officeStatus(paris, "en", new Date("2026-09-27T10:00:00Z")),
    /^Closed/,
  );
  assert.match(
    officeStatus(courneuve, "en", new Date("2026-09-27T10:00:00Z")),
    /not been verified/,
  );
  assert.match(
    officeStatus(paris, "en", new Date("2026-09-23T17:00:00Z")),
    /^Closed/,
  );
  assert.match(
    officeStatus(
      {
        ...paris,
        holidays: ["2026-09-23"],
        holidays_verified_through: "2026-12-31",
      },
      "en",
      new Date("2026-09-23T10:00:00Z"),
    ),
    /^Closed/,
  );
});
test("Catalogue flow reads only active real records and empty catalogue routes to advisor", () => {
  const packs = [
    {
      id: "p1",
      title: "Sri Lanka Discovery",
      destination: "Sri Lanka",
      duration: 8,
      description: "Guided visits",
      status: "active",
    },
    {
      id: "p2",
      title: "Sri Lanka Hidden",
      destination: "Sri Lanka",
      duration: 4,
      description: "Inactive",
      status: "inactive",
    },
  ];
  let s = go(start, "package");
  s = go(s, "Sri Lanka", packs);
  assert.equal(s.variables["1"], packs[0].title);
  s = go(s, "SELECT", packs);
  assert.equal(s.answers.package_id, "p1");
  assert.equal(s.step, "desk_name");
  const empty = go(
    { step: "desk_search", answers: { service: "package" } },
    "Bali",
  );
  assert.equal(empty.paused, true);
  assert.match(empty.templateKey, /no_packages$/);
});
test("Every reply resolves to a language-specific template; pause never resumes on ordinary messages", () => {
  for (const text of [
    "Bonjour",
    "hello",
    "office",
    "flight",
    "hotel",
    "custom trip",
    "package",
    "agent",
  ]) {
    const s = go(start, text);
    assert.ok(frontdeskTemplates.some((t) => t.key === s.templateKey));
  }
  const paused = {
    step: "desk_handoff",
    answers: { language: "fr" },
    paused: true,
  };
  assert.deepEqual(go(paused, "more details"), paused);
});
