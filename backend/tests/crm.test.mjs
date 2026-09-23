import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
process.env.DATABASE_URL =
  "postgres://postgres:local-workflow-test@127.0.0.1:55439/errances_test";
process.env.JWT_SECRET = "isolated-whatsapp-test-secret";
process.env.DATABASE_SSL = "false";
const { pool, migrate } = await import("../dist/db.js");
const { authenticate } = await import("../dist/middleware/authenticate.js");
const { signToken } = await import("../dist/auth/jwt.js");
let server, base, token, staffId, tourId;
const api = async (path, method = "GET", body, auth = token) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer " + auth } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
};
before(async () => {
  await migrate();
  const admin = (
    await pool.query(
      "SELECT * FROM staffs WHERE role='admin' AND status='active' LIMIT 1",
    )
  ).rows[0];
  token = signToken({ sub: admin.id, email: admin.email, role: admin.role });
  const app = express();
  app.use(express.json(), authenticate);
  app.use("/api/auth", (await import("../dist/routes/auth.js")).default);
  app.use("/api/staff", (await import("../dist/routes/staff.js")).default);
  app.use("/api/db", (await import("../dist/routes/db.js")).default);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (tourId) await pool.query("DELETE FROM tours WHERE id=$1", [tourId]);
  if (staffId) await pool.query("DELETE FROM staffs WHERE id=$1", [staffId]);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});
test("staff credentials, duplicate IDs, role protection, password reset and deactivation", async () => {
  const suffix = Date.now();
  const account = {
    full_name: "CRM Test Staff",
    email: `crm-${suffix}@example.com`,
    access_key: `crm.${suffix}`,
    role: "sales_executive",
    password: "TestPassword!234",
    status: "active",
  };
  const created = await api("/api/staff", "POST", account);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  staffId = created.data.id;
  assert.equal(created.data.password_hash, undefined);
  assert.equal((await api("/api/staff", "POST", account)).status, 409);
  assert.equal(
    (
      await api(
        "/api/auth/login",
        "POST",
        {
          identifier: account.access_key.toUpperCase(),
          password: account.password,
        },
        null,
      )
    ).status,
    200,
  );
  const login = await api(
    "/api/auth/login",
    "POST",
    { identifier: account.email, password: account.password },
    null,
  );
  assert.equal(login.status, 200);
  assert.equal(
    (
      await api(
        "/api/auth/login",
        "POST",
        { identifier: account.access_key, password: "wrong" },
        null,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await api(
        "/api/staff",
        "POST",
        { ...account, email: "unauthorized@example.com" },
        login.data.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (await api("/api/db/staffs", "POST", [account], login.data.token)).status,
    403,
  );
  const list = await api("/api/db/staffs");
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.data).includes("password_hash"));
  assert.equal(
    (
      await api("/api/staff/" + staffId, "PATCH", {
        password: "ChangedPassword!234",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        "/api/auth/login",
        "POST",
        { identifier: account.access_key, password: account.password },
        null,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await api(
        "/api/auth/login",
        "POST",
        { identifier: account.access_key, password: "ChangedPassword!234" },
        null,
      )
    ).status,
    200,
  );
  assert.equal(
    (await api("/api/staff/" + staffId, "PATCH", { status: "inactive" }))
      .status,
    200,
  );
  assert.equal(
    (
      await api(
        "/api/auth/login",
        "POST",
        { identifier: account.access_key, password: "ChangedPassword!234" },
        null,
      )
    ).status,
    403,
  );
  assert.equal(
    (await api("/api/auth/me", "GET", undefined, login.data.token)).status,
    401,
  );
  const mirror = (
    await pool.query("SELECT * FROM profiles WHERE id=$1", [staffId])
  ).rows[0];
  assert.equal(mirror.email, account.email);
});
test("package details persist through create, read and edit", async () => {
  const pack = {
    title: "CRM test package",
    destination: "Paris",
    duration: 5,
    price: 950,
    description: "Five days in Paris for testing",
    itinerary: "<p>Day 1: Arrival</p>",
    inclusions: ["Hotel", "Breakfast"],
    exclusions: ["Flights"],
    images: [],
    status: "active",
    departure_city: "Chennai",
    availability: "October on request",
    accommodation: "Twin room",
    meals: "Breakfast",
    transport: "Airport transfer",
    cancellation_policy: "Confirm before payment",
  };
  const created = await api("/api/db/tours", "POST", { rows: [pack] });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const row = Array.isArray(created.data)
    ? created.data[0]
    : created.data.data?.[0];
  assert.ok(row, JSON.stringify(created.data));
  tourId = row.id;
  assert.deepEqual(row.inclusions, pack.inclusions);
  assert.equal(row.departure_city, pack.departure_city);
  const edited = await api("/api/db/tours?eq_id=" + tourId, "PATCH", {
    values: { accommodation: "Family room" },
  });
  assert.equal(edited.status, 200);
  const saved = (await pool.query("SELECT * FROM tours WHERE id=$1", [tourId]))
    .rows[0];
  assert.equal(saved.accommodation, "Family room");
  assert.equal(saved.cancellation_policy, pack.cancellation_policy);
});
test('lead actions save assignments, status history, follow-ups, notes and payments', async () => {
  let leadId;
  try {
    const admin = (await pool.query("SELECT id FROM staffs WHERE role='admin' AND status='active' LIMIT 1")).rows[0];
    const created = await api('/api/db/leads', 'POST', { rows: [{ name: 'CRM workflow test', email: 'workflow-test@example.com', source: 'Website', status: 'new', assigned_staff_id: admin.id, tour_interest: 'CRM test package' }] });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    leadId = created.data.data[0].id;
    const updated = await api('/api/db/leads?eq_id=' + leadId, 'PATCH', { values: { status: 'contacted', requirement: 'Family trip with transfers' } });
    assert.equal(updated.status, 200);
    assert.ok((await pool.query('SELECT id FROM lead_status_history WHERE lead_id=$1 AND new_status=$2', [leadId, 'contacted'])).rowCount);
    const followup = await api('/api/db/lead_followups', 'POST', { rows: [{ lead_id: leadId, due_date: '2026-10-01', type: 'call', notes: 'Confirm dates', assigned_staff_id: admin.id }] });
    assert.equal(followup.status, 200, JSON.stringify(followup.data));
    const done = await api('/api/db/lead_followups?eq_id=' + followup.data.data[0].id, 'PATCH', { values: { status: 'done', completed_at: new Date().toISOString() } });
    assert.equal(done.status, 200);
    const note = await api('/api/db/lead_activities', 'POST', { rows: [{ lead_id: leadId, type: 'note', description: 'Requested family room', metadata: { room: 'family' } }] });
    assert.equal(note.status, 200, JSON.stringify(note.data));
    const payment = await api('/api/db/lead_payments', 'POST', { rows: [{ lead_id: leadId, amount: 100, method: 'bank', note: 'Test ledger entry' }] });
    assert.equal(payment.status, 200, JSON.stringify(payment.data));
    for (const table of ['leads','tours','staffs','profiles','lead_statuses','lead_activities','lead_followups','lead_documents','lead_payments','user_activity']) {
      assert.equal((await api('/api/db/' + table)).status, 200, table + ' read failed');
    }
  } finally { if (leadId) await pool.query('DELETE FROM leads WHERE id=$1', [leadId]); }
});
