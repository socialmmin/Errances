import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";

// This suite is deliberately restricted to the disposable local database.
process.env.DATABASE_URL =
  "postgres://postgres:local-workflow-test@127.0.0.1:55439/errances_test";
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET = "isolated-whatsapp-test-secret";
process.env.TWILIO_ACCOUNT_SID = "AC" + "0".repeat(32);
process.env.TWILIO_AUTH_TOKEN = "isolated-test-token";
process.env.TWILIO_WHATSAPP_NUMBER = "whatsapp:+15005550006";
process.env.SKIP_TWILIO_VALIDATION = "false";
process.env.ENABLE_BAILEYS = "false";
process.env.PUBLIC_URL = "https://test.example";

const { pool, migrate } = await import("../dist/db.js");
const { advanceEnquiry, workflowTemplates, parseTravelDate } = await import(
  "../dist/services/enquiryFlow.js"
);
const { captureEnquiry, drainEnquiryOutbox } = await import(
  "../dist/services/enquiryAutomation.js"
);
const { canonicalPhone, withinSession } = await import(
  "../dist/services/whatsappPhone.js"
);
const { applyStatusCallback } = await import(
  "../dist/services/whatsappMessageService.js"
);
const { getClient } = await import("../dist/services/twilioService.js");
const { signToken } = await import("../dist/auth/jwt.js");
const { authenticate } = await import("../dist/middleware/authenticate.js");
const whatsappRoutes = (await import("../dist/routes/whatsapp.js")).default;
const webhookRoutes = (await import("../dist/routes/webhooks.js")).default;
let server, base, token, actor;
let sent = [];
let counter = 0;
const recipient = "+447700900123";
const fakeSend = async (to, body, options) => {
  sent.push({ to, body, options });
  return { sid: "SM" + String(++counter).padStart(32, "0"), status: "queued" };
};

before(async () => {
  await migrate();
  const {getKnowledge}=await import("../dist/services/hotlineKnowledge.js");
  const knowledge=await getKnowledge(); knowledge.enabled=false;
  await pool.query("UPDATE whatsapp_knowledge SET document=$1 WHERE id=1",[JSON.stringify(knowledge)]);
  await migrate(); // Boot migrations must remain idempotent.
  actor = (await pool.query("SELECT * FROM staffs LIMIT 1")).rows[0];
  token = signToken({ sub: actor.id, email: actor.email, role: "admin" });
  await pool.query(
    "TRUNCATE whatsapp_automation_outbox, whatsapp_messages, whatsapp_conversations, leads, whatsapp_templates CASCADE",
  );
  await pool.query("INSERT INTO whatsapp_settings(id,automation_enabled) VALUES(1,TRUE) ON CONFLICT(id) DO UPDATE SET automation_enabled=TRUE");
  for (const [index, t] of workflowTemplates.entries())
    await pool.query(
      `INSERT INTO whatsapp_templates(name,twilio_content_sid,category,body_preview,status)
        VALUES($1,$2,'utility',$3,'approved') ON CONFLICT(twilio_content_sid) DO UPDATE SET status='approved',is_active=TRUE,category='utility'`,
      [t.name, "HX" + String(index + 1).padStart(32, "0"), t.body],
    );
  // Mock only the external Twilio transport; application routes and Postgres are real.
  getClient().messages.create = async (payload) => {
    sent.push(payload);
    return {
      sid: "SM" + String(++counter).padStart(32, "0"),
      status: "queued",
    };
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(authenticate);
  app.use("/api/whatsapp", whatsappRoutes);
  app.use("/api/webhooks", webhookRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});
async function api(path, body, method = "POST") {
  const r = await fetch(base + "/api/whatsapp" + path, {
    method: body === undefined ? "GET" : method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json() };
}
async function incoming(body, sid = crypto.randomUUID(), phone = recipient) {
  return captureEnquiry({ from: "whatsapp:" + phone, body, sid });
}
async function conv(phone = recipient) {
  return (
    await pool.query("SELECT * FROM whatsapp_conversations WHERE phone=$1", [
      phone,
    ])
  ).rows[0];
}

test("Phone normalization never invents a country code; window boundary is exact", () => {
  assert.equal(canonicalPhone("whatsapp:+44 7700 900123"), recipient);
  assert.equal(canonicalPhone("00447700900123"), recipient);
  assert.throws(() => canonicalPhone("7700900123"), /country code/);
  assert.throws(() => canonicalPhone("group-123"), /valid WhatsApp/);
  const now = Date.now();
  assert.equal(
    withinSession(new Date(now - 86400000 + 1).toISOString(), now),
    true,
  );
  assert.equal(
    withinSession(new Date(now - 86400000).toISOString(), now),
    false,
  );
  assert.equal(withinSession(new Date(now + 1000).toISOString(), now), false);
  assert.equal(withinSession(null, now), false);
});
test("Validation re-asks invalid answers and handles dates safely", () => {
  assert.equal(parseTravelDate("31/02/2030"), null);
  assert.equal(parseTravelDate("25/12/2030"), "2030-12-25");
  assert.equal(
    advanceEnquiry({ step: "name", answers: {} }, "hi").step,
    "name",
  );
  assert.equal(
    advanceEnquiry({ step: "email", answers: {} }, "noemail").step,
    "email",
  );
  assert.equal(
    advanceEnquiry(
      { step: "travel_date", answers: {} },
      "01/01/2020",
      "2026-09-23",
    ).step,
    "travel_date",
  );
});
test("Full enquiry uses 10 template replies and persists every answer to one lead", async () => {
  const answers = [
    "Hi",
    "Priya Test",
    "Bali",
    "25/12/2030",
    "2 adults and 1 child age 7",
    "Chennai",
    "INR 150000",
    "priya@example.test",
    "Vegetarian meals",
    "CONFIRM",
  ];
  for (const answer of answers) {
    await incoming(answer);
    await drainEnquiryOutbox(fakeSend);
  }
  const c = await conv();
  const lead = (
    await pool.query("SELECT * FROM leads WHERE id=$1", [c.contact_lead_id])
  ).rows[0];
  assert.equal(c.automation_step, "completed");
  assert.equal(lead.name, "Priya Test");
  assert.equal(lead.tour_interest, "Bali");
  assert.equal(lead.email, "priya@example.test");
  assert.equal(lead.budget, null); // INR stays in enquiry_data; CRM numeric budget is EUR.
  assert.equal(lead.status, "qualified");
  assert.equal(Object.keys(lead.enquiry_data).length, 8);
  assert.equal(lead.enquiry_data.travellers, "2 adults and 1 child age 7");
  assert.equal(sent.length, 10);
  assert.ok(
    sent.every(
      (s) => s.to === recipient && s.options.contentSid.startsWith("HX"),
    ),
  );
  assert.equal(
    (await pool.query("SELECT COUNT(*)::int AS n FROM leads")).rows[0].n,
    1,
  );
});
test("Concurrent duplicate webhooks create one inbound and one response", async () => {
  const sid = crypto.randomUUID();
  const before = sent.length;
  const results = await Promise.all([
    incoming("START", sid),
    incoming("START", sid),
  ]);
  assert.equal(results.filter((r) => r.duplicate).length, 1);
  await drainEnquiryOutbox(fakeSend);
  assert.equal(sent.length, before + 1);
  assert.equal((await conv()).automation_step, "name");
});
test("Opt out blocks all sends; START re-enables; human request pauses questions", async () => {
  await incoming("STOP");
  assert.equal((await conv()).opted_out, true);
  let result = await api("/send", {
    to: recipient,
    message: "Test",
    conversationId: (await conv()).id,
  });
  assert.equal(result.status, 409);
  await incoming("START");
  await drainEnquiryOutbox(fakeSend);
  assert.equal((await conv()).opted_out, false);
  await incoming("AGENT");
  await drainEnquiryOutbox(fakeSend);
  assert.equal((await conv()).bot_paused, true);
  const before = sent.length;
  await incoming("I want help");
  await drainEnquiryOutbox(fakeSend);
  assert.equal(sent.length, before);
});
test("Manual send resolves full inbound address even when lead has a local number", async () => {
  const c = await conv();
  await pool.query("UPDATE leads SET phone=$2 WHERE id=$1", [
    c.contact_lead_id,
    "7700900123",
  ]);
  const r = await api("/send", {
    to: "7700900123",
    leadId: c.contact_lead_id,
    message: "Your itinerary is ready.",
  });
  assert.equal(r.status, 200);
  assert.equal(sent.at(-1).to, "whatsapp:" + recipient);
  assert.equal((await conv()).bot_paused, true);
});
test("Closed session blocks free text; templates require real approval and variables", async () => {
  const c = await conv();
  await pool.query(
    "UPDATE whatsapp_conversations SET last_inbound_at=NOW()-INTERVAL '25 hours' WHERE id=$1",
    [c.id],
  );
  assert.equal(
    (
      await api("/send", {
        to: recipient,
        conversationId: c.id,
        message: "Not allowed",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("/send", {
        to: recipient,
        conversationId: c.id,
        contentSid: "HXunknown",
      })
    ).status,
    400,
  );
  const template = (
    await pool.query("SELECT * FROM whatsapp_templates WHERE name=$1", [
      "ev_enquiry_received_v1",
    ])
  ).rows[0];
  assert.equal(
    (
      await api("/send", {
        to: recipient,
        conversationId: c.id,
        contentSid: template.twilio_content_sid,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("/send", {
        to: recipient,
        conversationId: c.id,
        contentSid: template.twilio_content_sid,
        contentVariables: { 1: "EV-TEST" },
      })
    ).status,
    200,
  );
  assert.match(sent.at(-1).contentVariables, /EV-TEST/);
  assert.equal(
    (await api("/window-status?phone=" + encodeURIComponent(recipient))).body
      .withinWindow,
    false,
  );
});
test("Pending or reclassified templates never send and show an actionable error", async () => {
  const c = await conv();
  await incoming("START");
  await pool.query(
    "UPDATE whatsapp_templates SET category='marketing' WHERE name='ev_enquiry_name_v1'",
  );
  const before = sent.length;
  await drainEnquiryOutbox(fakeSend);
  assert.equal(sent.length, before);
  assert.match((await conv()).automation_error, /Utility/);
  await pool.query(
    "UPDATE whatsapp_templates SET category='utility',status='approved' WHERE name='ev_enquiry_name_v1'",
  );
  await pool.query(
    "UPDATE whatsapp_automation_outbox SET available_at=NOW() WHERE conversation_id=$1 AND status='queued'",
    [c.id],
  );
  await drainEnquiryOutbox(fakeSend);
  assert.equal(sent.length, before + 1);
  assert.equal((await conv()).automation_error, null);
});
test("Status callbacks cannot downgrade read; failure surfaces in conversation", async () => {
  const m = (
    await pool.query(
      "SELECT * FROM whatsapp_messages WHERE direction='outbound' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  await applyStatusCallback(m.twilio_sid, "read");
  await applyStatusCallback(m.twilio_sid, "sent");
  assert.equal(
    (
      await pool.query("SELECT status FROM whatsapp_messages WHERE id=$1", [
        m.id,
      ])
    ).rows[0].status,
    "read",
  );
  await incoming("Another Test");
  await drainEnquiryOutbox(fakeSend);
  const last = (
    await pool.query(
      "SELECT * FROM whatsapp_messages WHERE direction='outbound' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  await applyStatusCallback(last.twilio_sid, "undelivered", "63024");
  assert.equal((await conv()).bot_paused, true);
  assert.match((await conv()).automation_error, /Recipient/);
});
test("Settings enforce 24 hours and preserve default template when omitted", async () => {
  const t = (await pool.query("SELECT id FROM whatsapp_templates LIMIT 1"))
    .rows[0];
  await pool.query("UPDATE whatsapp_settings SET default_template_id=$1", [
    t.id,
  ]);
  assert.equal(
    (await api("/settings", { sessionWindowHours: 48 }, "PATCH")).status,
    400,
  );
  const saved = await api(
    "/settings",
    { businessName: "Errances Voyages", automationEnabled: true },
    "PATCH",
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.default_template_id, t.id);
  assert.equal(saved.body.data.session_window_hours, 24);
});
test("Unsigned webhook rejected; signed webhook accepted and deduplicated without Twilio network calls", async () => {
  const params = {
    From: "whatsapp:+447700900124",
    To: process.env.TWILIO_WHATSAPP_NUMBER,
    Body: "Hi",
    MessageSid: "SMsigned-test",
  };
  const request = async (signature) =>
    fetch(base + "/api/webhooks/twilio", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(signature ? { "x-twilio-signature": signature } : {}),
      },
      body: new URLSearchParams(params),
    });
  assert.equal((await request()).status, 403);
  const payload =
    process.env.PUBLIC_URL +
    "/api/webhooks/twilio" +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const signature = crypto
    .createHmac("sha1", process.env.TWILIO_AUTH_TOKEN)
    .update(payload)
    .digest("base64");
  assert.equal((await request(signature)).status, 200);
  assert.equal((await request(signature)).status, 200);
  assert.equal(
    (
      await pool.query(
        "SELECT COUNT(*)::int n FROM whatsapp_messages WHERE twilio_sid=$1",
        ["SMsigned-test"],
      )
    ).rows[0].n,
    1,
  );
});

test('Global hotline pre-empts queued questions for agent requests and persists the shared handoff', async () => {
  const { getKnowledge } = await import('../dist/services/hotlineKnowledge.js');
  const { frontdeskTemplates } = await import('../dist/services/frontdeskFlow.js');
  const knowledge=await getKnowledge();knowledge.enabled=true;
  await pool.query('UPDATE whatsapp_knowledge SET document=$1 WHERE id=1',[JSON.stringify(knowledge)]);
  for(const [i,t] of frontdeskTemplates.entries()) await pool.query("INSERT INTO whatsapp_templates(name,twilio_content_sid,category,body_preview,status,language) VALUES($1,$2,'utility',$3,'approved',$4) ON CONFLICT(twilio_content_sid) DO UPDATE SET status='approved',category='utility',is_active=TRUE",[t.name,'HX'+String(i+100).padStart(32,'0'),t.body,t.language]);
  const from='+447700900155';
  await captureEnquiry({from,body:'Bonjour',sid:'SMglobal-welcome'});
  await captureEnquiry({from,body:'I like to book a ticket with an agent',sid:'SMglobal-agent'});
  const c=(await pool.query('SELECT * FROM whatsapp_conversations WHERE phone=$1',[from])).rows[0];
  const lead=(await pool.query('SELECT * FROM leads WHERE id=$1',[c.contact_lead_id])).rows[0];
  assert.equal(c.bot_paused,true);assert.equal(c.status,'pending');assert.equal(lead.priority,'high');assert.equal(lead.enquiry_data.service,'flight');assert.equal(lead.enquiry_data.language,'fr');assert.notEqual(lead.name,'I like to book a ticket with an agent');
  assert.equal((await pool.query("SELECT status FROM whatsapp_automation_outbox WHERE inbound_sid='SMglobal-welcome'")).rows[0].status,'cancelled');
  const previous=sent.length;await drainEnquiryOutbox(fakeSend);const outgoing=sent.slice(previous).filter(s=>s.to===from);assert.equal(outgoing.length,1);assert.match(outgoing[0].body,/conseillers/);assert.ok(outgoing[0].options.contentSid);
  const k=frontdeskTemplates.find(t=>t.key==='desk_fr_handoff');await pool.query("UPDATE whatsapp_templates SET status='pending' WHERE name=$1",[k.name]);
  await captureEnquiry({from,body:'conseiller',sid:'SMglobal-pending'});const beforeSend=sent.length;await drainEnquiryOutbox(fakeSend);assert.equal(sent.length,beforeSend);assert.match((await pool.query('SELECT automation_error FROM whatsapp_conversations WHERE id=$1',[c.id])).rows[0].automation_error,/Utility/);
});

test('Marketing welcome falls back to approved Utility name question',async()=>{await pool.query("UPDATE whatsapp_templates SET category='marketing' WHERE name='ev_desk_en_welcome_v1'");const from='+447700900779';await captureEnquiry({from,body:'Hi',sid:'SMutility-greeting'});const c=(await pool.query('SELECT * FROM whatsapp_conversations WHERE phone=$1',[from])).rows[0];assert.equal(c.automation_step,'desk_name');await drainEnquiryOutbox(fakeSend);assert.ok(sent.some(s=>s.to===from && /full name/.test(s.body) && s.options.contentSid));});
