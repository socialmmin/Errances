import { getKnowledge } from "./hotlineKnowledge.js";
import {
  advanceFrontdesk,
  frontdeskTemplates,
  deskControl,
} from "./frontdeskFlow.js";
import { pool } from "../db.js";
import { broadcastChange } from "../realtime.js";
import {
  advanceEnquiry,
  enquirySummary,
  parseTravelDate,
  questions,
  workflowTemplates,
} from "./enquiryFlow.js";
import { canonicalPhone, phoneDigits, withinSession } from "./whatsappPhone.js";
import { sendTwilioWhatsAppMessage } from "./twilioService.js";
import { recordOutboundMessage } from "./whatsappMessageService.js";
import {
  createTemplate,
  submitTemplateForApproval,
  syncTemplatesFromTwilio,
} from "./whatsappTemplateService.js";

const allTemplates = [...workflowTemplates, ...frontdeskTemplates];

export async function setupEnquiryTemplates(
  actorId: string,
  actorName: string,
) {
  await syncTemplatesFromTwilio(actorId, actorName);
  const results = [];
  for (const definition of allTemplates) {
    const { rows } = await pool.query(
      "SELECT * FROM whatsapp_templates WHERE name = $1 ORDER BY created_at LIMIT 1",
      [definition.name],
    );
    let template = rows[0];
    try {
      if (!template)
        template = await createTemplate({
          name: definition.name,
          language:
            "language" in definition ? String(definition.language) : "en",
          category: "utility",
          body: definition.body,
          sampleValues:
            "samples" in definition
              ? (definition.samples as Record<string, string>)
              : definition.key === "confirm"
                ? {
                    "1": "Full name: Priya; Destination: Bali; Travel date: 20/12/2026; Travellers: 2 adults; Departure city: Chennai; Total budget: INR 150000; Email: skip; Special requirements: none",
                  }
                : definition.key === "completed"
                  ? { "1": "EV-1024" }
                  : {},
          createdBy: actorId,
          createdByName: actorName,
        });
      if (template.status === "draft")
        template = await submitTemplateForApproval(template.id, "UTILITY");
      results.push({
        key: definition.key,
        id: template.id,
        status: template.status,
        category: template.category,
      });
    } catch (err: any) {
      results.push({
        key: definition.key,
        status: "error",
        error: err.message,
      });
    }
  }
  return results;
}

/** Save inbound, answers, lead and queued response in one transaction. Twilio retries cannot advance twice. */
export async function captureEnquiry(input: {
  from: string;
  body: string;
  sid: string;
  mediaUrl?: string;
  mediaType?: string;
}) {
  const phone = canonicalPhone(input.from);
  const digits = phoneDigits(phone);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [digits]);
    const duplicate = await client.query(
      "SELECT id FROM whatsapp_messages WHERE twilio_sid = $1",
      [input.sid],
    );
    if (duplicate.rowCount) {
      await client.query("COMMIT");
      return { duplicate: true };
    }
    const existing = await client.query(
      "SELECT * FROM whatsapp_conversations WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1 ORDER BY last_inbound_at DESC NULLS LAST LIMIT 1 FOR UPDATE",
      [digits],
    );
    let conversation = existing.rows[0];
    if (!conversation)
      conversation = (
        await client.query(
          "INSERT INTO whatsapp_conversations(phone, stage) VALUES($1, 'collect_name') RETURNING *",
          [phone],
        )
      ).rows[0];
    let lead = conversation.contact_lead_id
      ? (
          await client.query("SELECT * FROM leads WHERE id = $1 FOR UPDATE", [
            conversation.contact_lead_id,
          ])
        ).rows[0]
      : null;
    if (!lead) {
      const matches = await client.query(
        "SELECT * FROM leads WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1 AND notes IS DISTINCT FROM '[DELETED]'",
        [digits],
      );
      lead = matches.rows[0];
    }
    if (!lead)
      lead = (
        await client.query(
          "INSERT INTO leads(name, phone, whatsapp_number, source, status) VALUES($1,$2,$2,'WhatsApp','new') RETURNING *",
          [`WhatsApp enquiry (${phone})`, phone],
        )
      ).rows[0];
    const kind = input.mediaType?.startsWith("image/")
      ? "image"
      : input.mediaType?.startsWith("audio/")
        ? "audio"
        : input.mediaType?.startsWith("video/")
          ? "video"
          : input.mediaUrl
            ? "document"
            : "text";
    const message = (
      await client.query(
        `INSERT INTO whatsapp_messages(lead_id, conversation_id, sender, content, status, direction, message_type, media_url, media_content_type, twilio_sid)
            VALUES($1,$2,'contact',$3,'read','inbound',$4,$5,$6,$7) RETURNING *`,
        [
          lead.id,
          conversation.id,
          input.body,
          kind,
          input.mediaUrl || null,
          input.mediaType || null,
          input.sid,
        ],
      )
    ).rows[0];
    const settings = (
      await client.query(
        "SELECT automation_enabled FROM whatsapp_settings WHERE id = 1",
      )
    ).rows[0];
    const knowledge = await getKnowledge(client);
    const catalogue = knowledge.enabled
      ? (
          await client.query(
            "SELECT id,title,destination,duration,duration_note,category,description,inclusions,exclusions,price,price_on_request,day_wise_itinerary,itinerary_pdf_url,status FROM tours WHERE status='active' ORDER BY title",
          )
        ).rows
      : [];
    const restart = /^(start|restart|menu)$/i.test(input.body.trim());
    const stop = /^(stop|unsubscribe|arret|arrêt)$/i.test(input.body.trim());
    const state = {
      step: conversation.automation_step,
      answers: conversation.automation_data || {},
      paused: conversation.bot_paused || conversation.opted_out,
    };
    const outstanding = (
      await client.query(
        "SELECT id FROM whatsapp_automation_outbox WHERE conversation_id=$1 AND status IN ('queued','sending') LIMIT 1",
        [conversation.id],
      )
    ).rowCount;
    const control =
      deskControl(input.body) ||
      /^(start|restart|menu|stop|unsubscribe|agent|human|help)$/i.test(
        input.body.trim(),
      );
    // Do not mistake a second inbound message for the answer to a question not yet sent.
    let next =
      settings?.automation_enabled &&
      input.body.trim() &&
      (!outstanding || control)
        ? knowledge.enabled
          ? advanceFrontdesk(state, input.body, knowledge, catalogue)
          : advanceEnquiry(state, input.body)
        : state;
    // Approval category is provider-controlled. Use a genuine approved question or human handoff, never free text.
    if (knowledge.enabled && 'templateKey' in next && next.templateKey) {
      const desiredKey = next.templateKey;
      const wanted = allTemplates.find(t => t.key === desiredKey);
      const ready = wanted && (await client.query("SELECT 1 FROM whatsapp_templates WHERE name=$1 AND status='approved' AND lower(category)='utility' AND is_active=TRUE", [wanted.name])).rowCount;
      if (!ready) {
        const lang = next.answers.language === 'fr' ? 'fr' : 'en';
        const greeting = String(next.templateKey).endsWith('_welcome');
        const fallbackKey = greeting ? 'desk_' + lang + '_name' : 'desk_' + lang + '_handoff';
        const fallback = allTemplates.find(t => t.key === fallbackKey)!;
        const allowed = (await client.query("SELECT 1 FROM whatsapp_templates WHERE name=$1 AND status='approved' AND lower(category)='utility' AND is_active=TRUE", [fallback.name])).rowCount;
        if (allowed) next = { ...next, step: greeting ? 'desk_name' : 'desk_handoff', templateKey: fallbackKey, variables: {}, paused: !greeting, answers: { ...next.answers, ...(greeting ? {} : {quote_status:'agent_required', request:input.body}) } };
      }
    }
    const optedOut = stop ? true : restart ? false : conversation.opted_out;
    const answers = next.answers;
    const handoff =
      "templateKey" in next &&
      (String(next.templateKey).endsWith("handoff") ||
        String(next.templateKey).endsWith("no_packages"));
    const selectedOffice = knowledge.offices.find(
      (o) => o.id === answers.office_id,
    );
    let assignedStaff = conversation.assigned_staff_id;
    if (handoff && selectedOffice?.assigned_staff_id) {
      const staff = await client.query(
        "SELECT id FROM staffs WHERE id=$1 AND status='active'",
        [selectedOffice.assigned_staff_id],
      );
      if (staff.rowCount) assignedStaff = staff.rows[0].id;
    }
    // Answers also live on the lead, without overwriting staff notes.
    const date = parseTravelDate(answers.travel_date || "");
    const budgetMatch = (answers.budget || "").match(
      /^(?:EUR|€)\s*([\d,]+(?:\.\d{1,2})?)$/i,
    );
    lead = (
      await client.query(
        `UPDATE leads SET whatsapp_number=$2, name=COALESCE($3,name), tour_interest=COALESCE($4,tour_interest),
            travel_date=COALESCE($5,travel_date), city=COALESCE($6,city), email=COALESCE($7,email), budget=COALESCE($8,budget),
            enquiry_data=$9, requirement=COALESCE($10,requirement), last_contacted_at=NOW(),
            status=CASE WHEN $11 AND status IN ('new','contacted') THEN 'qualified' ELSE status END,
            next_action=CASE WHEN $11 THEN 'Review confirmed WhatsApp enquiry and contact traveller' ELSE next_action END
            WHERE id=$1 RETURNING *`,
        [
          lead.id,
          phone,
          answers.name || null,
          answers.package_title || answers.destination || null,
          date,
          answers.city || null,
          answers.email && !/^skip$/i.test(answers.email)
            ? answers.email
            : null,
          budgetMatch ? Number(budgetMatch[1].replace(/,/g, "")) : null,
          JSON.stringify(answers),
          Object.keys(answers).length
            ? knowledge.enabled
              ? Object.entries(answers)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join("; ")
                  .slice(0, 4000)
              : enquirySummary(answers)
            : null,
          "completed" in next && Boolean(next.completed),
        ],
      )
    ).rows[0];
    if (handoff) {
      lead = (
        await client.query(
          "UPDATE leads SET next_action='Advisor review: quotation / service request',priority='high',assigned_staff_id=COALESCE($2,assigned_staff_id) WHERE id=$1 RETURNING *",
          [lead.id, assignedStaff],
        )
      ).rows[0];
    }
    conversation = (
      await client.query(
        `UPDATE whatsapp_conversations SET phone=$2, contact_lead_id=$3, last_inbound_at=NOW(), last_message_at=NOW(),
            last_message_preview=$4, unread_count=unread_count+1, automation_step=$5, automation_data=$6, bot_paused=$7, opted_out=$8,
            stage=CASE WHEN $5='completed' THEN 'completed' ELSE stage END, status=CASE WHEN $7 OR $5='completed' THEN 'pending' ELSE 'open' END, updated_at=NOW()
            WHERE id=$1 RETURNING *`,
        [
          conversation.id,
          phone,
          lead.id,
          (input.body || "[media]").slice(0, 120),
          next.step,
          JSON.stringify(answers),
          Boolean(next.paused),
          optedOut,
        ],
      )
    ).rows[0];
    if (assignedStaff && assignedStaff !== conversation.assigned_staff_id) {
      conversation = (
        await client.query(
          "UPDATE whatsapp_conversations SET assigned_staff_id=$2 WHERE id=$1 RETURNING *",
          [conversation.id, assignedStaff],
        )
      ).rows[0];
    }
    if (stop || next.paused || restart || control)
      await client.query(
        "UPDATE whatsapp_automation_outbox SET status='cancelled', updated_at=NOW() WHERE conversation_id=$1 AND status='queued'",
        [conversation.id],
      );
    if ("templateKey" in next && next.templateKey && !optedOut) {
      const variables =
        next.templateKey === "completed"
          ? { "1": `EV-${lead.lead_number}` }
          : next.variables || {};
      await client.query(
        "INSERT INTO whatsapp_automation_outbox(inbound_sid,conversation_id,template_key,variables) VALUES($1,$2,$3,$4) ON CONFLICT(inbound_sid) DO NOTHING",
        [
          input.sid,
          conversation.id,
          next.templateKey,
          JSON.stringify(variables),
        ],
      );
    }
    await client.query("COMMIT");
    broadcastChange("whatsapp_messages", "INSERT", { new: message });
    broadcastChange(
      "whatsapp_conversations",
      existing.rows[0] ? "UPDATE" : "INSERT",
      { new: conversation },
    );
    broadcastChange("leads", "UPDATE", { new: lead });
    return { duplicate: false, conversationId: conversation.id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

let draining = false;
export async function drainEnquiryOutbox(send = sendTwilioWhatsAppMessage) {
  if (draining) return;
  draining = true;
  try {
    // Never blindly resend an ambiguous request after a crash: it may have reached Twilio.
    await pool.query(
      "UPDATE whatsapp_automation_outbox SET status='failed', error='Delivery outcome unknown after restart; review before retrying', updated_at=NOW() WHERE status='sending' AND updated_at < NOW() - INTERVAL '2 minutes'",
    );
    for (let i = 0; i < 10; i++) {
      const { rows } =
        await pool.query(`UPDATE whatsapp_automation_outbox SET status='sending', updated_at=NOW() WHERE id=(
                SELECT id FROM whatsapp_automation_outbox WHERE status='queued' AND available_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
      const job = rows[0];
      if (!job) break;
      try {
        const conversation = (
          await pool.query("SELECT * FROM whatsapp_conversations WHERE id=$1", [
            job.conversation_id,
          ])
        ).rows[0];
        const enabled = (
          await pool.query(
            "SELECT automation_enabled FROM whatsapp_settings WHERE id=1",
          )
        ).rows[0]?.automation_enabled;
        if (
          !enabled ||
          conversation.opted_out ||
          (conversation.bot_paused &&
            !job.template_key.endsWith("handoff") &&
            !job.template_key.endsWith("no_packages"))
        ) {
          await pool.query(
            "UPDATE whatsapp_automation_outbox SET status='cancelled',updated_at=NOW() WHERE id=$1",
            [job.id],
          );
          continue;
        }
        if (!withinSession(conversation.last_inbound_at))
          throw new Error(
            "Customer service window expired. Waiting for the customer to reply; no automatic follow-up sent.",
          );
        const definition = allTemplates.find(
          (t) => t.key === job.template_key,
        )!;
        const template = (
          await pool.query(
            "SELECT * FROM whatsapp_templates WHERE name=$1 ORDER BY created_at DESC LIMIT 1",
            [definition.name],
          )
        ).rows[0];
        if (!template || !template.is_active || template.status !== "approved" || template.category?.toLowerCase() !== "utility") {
          const error = `Utility-only automation blocked ${definition.name}: status=${template?.status || "missing"}, category=${template?.category || "unknown"}. Approval alone is insufficient; category must be Utility.`;
          await pool.query(
            "UPDATE whatsapp_automation_outbox SET status='queued',error=$2,available_at=NOW()+INTERVAL '1 minute',updated_at=NOW() WHERE id=$1",
            [job.id, error],
          );
          const c = (
            await pool.query(
              "UPDATE whatsapp_conversations SET automation_error=$2 WHERE id=$1 RETURNING *",
              [conversation.id, error],
            )
          ).rows[0];
          broadcastChange("whatsapp_conversations", "UPDATE", { new: c });
          continue;
        }
        const body = definition.body.replace(
          /\{\{(\d+)\}\}/g,
          (_, key) => job.variables[key] || "",
        );
        const sent = await send(conversation.phone, body, {
          contentSid: template.twilio_content_sid,
          contentVariables: job.variables,
        });
        await pool.query(
          "UPDATE whatsapp_automation_outbox SET twilio_sid=$2 WHERE id=$1",
          [job.id, sent.sid],
        );
        await recordOutboundMessage({
          phone: conversation.phone,
          leadId: conversation.contact_lead_id,
          body,
          contentSid: template.twilio_content_sid,
          twilioSid: sent.sid,
          twilioStatus: sent.status,
        });
        await pool.query(
          "UPDATE whatsapp_automation_outbox SET status='sent',error=NULL,updated_at=NOW() WHERE id=$1",
          [job.id],
        );
        const c = (
          await pool.query(
            "UPDATE whatsapp_conversations SET automation_error=NULL WHERE id=$1 RETURNING *",
            [conversation.id],
          )
        ).rows[0];
        broadcastChange("whatsapp_conversations", "UPDATE", { new: c });
      } catch (err: any) {
        await pool.query(
          "UPDATE whatsapp_automation_outbox SET status='failed',error=$2,updated_at=NOW() WHERE id=$1",
          [job.id, err.message],
        );
        const c = (
          await pool.query(
            "UPDATE whatsapp_conversations SET automation_error=$2,bot_paused=TRUE,status='pending' WHERE id=$1 RETURNING *",
            [job.conversation_id, err.message],
          )
        ).rows[0];
        if (c) broadcastChange("whatsapp_conversations", "UPDATE", { new: c });
      }
    }
  } finally {
    draining = false;
  }
}

export async function automationOverview() {
  const { rows } = await pool.query(
    "SELECT name,status,category,is_active,rejection_reason FROM whatsapp_templates WHERE name = ANY($1)",
    [allTemplates.map((t) => t.name)],
  );
  return {
    questions: questions.map((q) => ({ key: q.key, label: q.label })),
    templates: allTemplates.map((t) => ({
      key: t.key,
      name: t.name,
      ...rows.find((r) => r.name === t.name),
    })),
  };
}
