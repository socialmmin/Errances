# WhatsApp enquiries

Inbound Twilio webhooks at `/api/webhooks/twilio` are signature-verified against
`PUBLIC_URL`. The endpoint commits the inbound message, conversation state, lead
answers and response queue together before returning TwiML. Duplicate MessageSid
values do not advance the workflow twice.

The enquiry asks for name, destination, departure date, travellers, departure city,
budget with currency, email and requirements, then asks for confirmation. Answers
are stored in `leads.enquiry_data` and shown in the inbox travel brief. The CRM's
numeric budget is EUR; other currencies remain explicitly labelled in the enquiry
data. Staff notes are preserved. A confirmed new/contacted lead becomes qualified.

Automation sends only active templates with current local status `approved` and
category `utility`. Twilio approval status is synced at startup and every five
minutes. Missing/pending/reclassified templates remain queued and are visible as
an action-required error. Approval remains controlled by Meta. A queued enquiry
reply expires when the customer service window closes; it does not initiate an
unsolicited follow-up. The inbox can still send approved templates manually.

`AGENT` pauses the bot and requests human assistance. `STOP`/`UNSUBSCRIBE` opts out
and blocks manual sends too. `START`/`MENU`/`RESTART` starts a new enquiry. Manual
agent replies pause automation. Pausing cancels queued replies; resuming allows
the next customer message to continue the stored step. Inspect failed/ambiguous
delivery before retrying; the queue never blindly resends after a process crash.

Use **Settings → WhatsApp → Create / submit Utility templates** for idempotent
template provisioning. **Sync approvals** refreshes review state immediately.
Changing the business name does not erase the default template. WhatsApp's
24-hour window is fixed and cannot be extended through settings.

## Checks

The integration suite uses only a disposable local PostgreSQL database and mocks
the Twilio transport. It does not send customer messages or use production data.

```sh
docker run -d --name errances-whatsapp-test \
  -e POSTGRES_PASSWORD=local-workflow-test -e POSTGRES_DB=errances_test \
  -p 127.0.0.1:55439:5432 postgres:16-alpine
cd backend
npm ci
npm test
```

Stop any local server using that test database before running tests, since the
suite resets its tables. Tests cover full capture, duplicate delivery, invalid
answers, country-code resolution, session expiry, approval gating, opt-out,
manual handoff, delivery callbacks, settings and signed webhooks. Live WhatsApp
delivery must be verified separately using an explicitly designated test number.
