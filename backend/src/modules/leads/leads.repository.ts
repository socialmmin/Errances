import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { PG_POOL } from '../../common/db/pool.module';
import { PERMISSIONS, roleHasPermission } from '../../common/rbac/role-permissions';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';

// Old ad-account leads often carry a generic source (Organic/Paid/Direct) instead of
// a real campaign name. When a real campaign is selected in a filter, also pull in
// any lead for the same destination so old-account traffic isn't left stranded.
const DESTINATIONS = [
  'Andaman','Amritsar','Ayodhya','Bhutan','Coorg','Darjeeling','Dubai','Europe','Goa','Gangtok','Himachal','Hyderabad',
  'Japan','Kashmir','Kasi','Kerala','Kodaikanal','Ladakh','Malaysia','Maldives','Manali','Meghalaya','Munnar','Mysore',
  'Nepal','Ooty','Rajasthan','Rameswaram','Rishikesh','Shimla','Sikkim','Singapore','Sri Lanka','Switzerland','Thailand',
  'Tirupati','Turkey','Udaipur','Varanasi','Vietnam',
];
function destinationInCampaignName(campaignName: string): string | null {
  return DESTINATIONS.find((place) => new RegExp(`\\b${place}\\b`, 'i').test(campaignName)) ?? null;
}

export interface LeadListParams {
  branchId?: string;
  status?: string;
  search?: string;
  campaignName?: string;
  noPhone?: boolean;
  itineraryStatus?: 'read' | 'delivered' | 'sent' | 'unconfirmed' | 'failed' | 'none';
  source?: string;
  assignedTo?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
  sortBy?: 'lead_date' | 'activity';
  ids?: string[];
  access?: LeadAccess;
}
export interface LeadAccess { userId: string; roleName: string; branchId?: string | null }

@Injectable()
export class LeadsRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async findAll(params: LeadListParams) {
    const conditions: string[] = ['l.is_deleted = false'];
    const values: any[] = [];
    const leadDateSql = `COALESCE(lr.lead_date, l.created_at)`;
    // 'activity' sorts by the most recent WhatsApp message (in or out), like a real chat
    // app's conversation list -- an old lead that just got a message jumps to the top.
    const sortByActivity = params.sortBy === 'activity';
    const orderSql = sortByActivity ? `COALESCE(wm.last_message_at, ${leadDateSql}) DESC` : `${leadDateSql} DESC`;
    this.addAccessCondition(conditions, values, params.access);

    if (params.branchId) {
      values.push(params.branchId);
      conditions.push(`l.branch_id = $${values.length}`);
    }
    if (params.status) {
      values.push(params.status);
      conditions.push(`l.status = $${values.length}`);
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      conditions.push(`(l.customer_name ILIKE $${values.length} OR l.phone ILIKE $${values.length} OR l.whatsapp_number ILIKE $${values.length} OR l.email ILIKE $${values.length} OR l.destination ILIKE $${values.length} OR l.campaign_name ILIKE $${values.length} OR l.lead_number ILIKE $${values.length})`);
    }
    if (params.noPhone) conditions.push(`COALESCE(NULLIF(l.phone,''), NULLIF(l.whatsapp_number,'')) IS NULL`);
    // Used to pull specific leads (e.g. every unread WhatsApp chat) regardless of where they'd
    // otherwise fall in the normal activity/date sort and pagination -- so a lead with an unread
    // message can never silently scroll out of view during a busy sending window.
    if (params.ids?.length) {
      values.push(params.ids);
      conditions.push(`l.id = ANY($${values.length}::uuid[])`);
    }
    // Mirrors the same priority the "Auto WhatsApp" chip uses (read > delivered > sent/accepted > failed):
    // filtering by "Sent" means the best status ever reached for that lead's itinerary was Sent, not
    // Delivered/Viewed -- so a lead that later got read doesn't also show up under "Sent".
    if (params.itineraryStatus) {
      const itnLog = (statuses: string[]) =>
        `EXISTS (SELECT 1 FROM whatsapp_logs w WHERE w.lead_id = l.id AND w.message_type = 'itinerary' AND w.is_deleted = false AND w.status IN (${statuses.map((s) => `'${s}'`).join(',')}))`;
      if (params.itineraryStatus === 'none') conditions.push(`NOT ${itnLog(['accepted', 'sent', 'delivered', 'read', 'failed', 'test_mode_skipped', 'unconfirmed'])}`);
      else if (params.itineraryStatus === 'read') conditions.push(itnLog(['read']));
      else if (params.itineraryStatus === 'delivered') conditions.push(`${itnLog(['delivered'])} AND NOT ${itnLog(['read'])}`);
      else if (params.itineraryStatus === 'sent') conditions.push(`${itnLog(['sent', 'accepted'])} AND NOT ${itnLog(['delivered', 'read'])}`);
      else if (params.itineraryStatus === 'unconfirmed') conditions.push(`${itnLog(['unconfirmed'])} AND NOT ${itnLog(['accepted', 'sent', 'delivered', 'read'])}`);
      else if (params.itineraryStatus === 'failed') conditions.push(`${itnLog(['failed'])} AND NOT ${itnLog(['accepted', 'sent', 'delivered', 'read', 'unconfirmed'])}`);
    }
    if (params.campaignName) {
      values.push(params.campaignName);
      const campaignIdx = values.length;
      const destination = destinationInCampaignName(params.campaignName);
      if (destination) {
        values.push(`%${destination}%`);
        conditions.push(`(l.campaign_name = $${campaignIdx} OR l.destination ILIKE $${values.length})`);
      } else {
        conditions.push(`l.campaign_name = $${campaignIdx}`);
      }
    }
    if (params.source) {
      values.push(params.source);
      conditions.push(`l.source = $${values.length}`);
    }
    if (params.assignedTo === 'unassigned') {
      conditions.push(`l.assigned_to IS NULL`);
    } else if (params.assignedTo) {
      values.push(params.assignedTo);
      conditions.push(`l.assigned_to = $${values.length}`);
    }
    if (params.dateFrom) {
      values.push(params.dateFrom);
      conditions.push(`${leadDateSql} >= $${values.length}::date`);
    }
    if (params.dateTo) {
      values.push(params.dateTo);
      conditions.push(`${leadDateSql} < ($${values.length}::date + interval '1 day')`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.pageSize;

    values.push(params.pageSize);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const { rows } = await this.pool.query(
      `SELECT l.*, (SELECT v.quality FROM lead_quality_v v WHERE v.lead_id = l.id) AS quality, u.full_name AS assigned_to_name, ${leadDateSql} AS lead_date, it.itinerary_status,
              -- has the customer written back on WhatsApp, and when last
              (SELECT max(m.created_at) FROM whatsapp_messages m WHERE m.lead_id = l.id AND m.direction = 'in') AS last_reply_at${sortByActivity ? ', wm.last_message_at' : ''}
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       LEFT JOIN LATERAL (
         SELECT MAX(r.submitted_at) AS lead_date
         FROM lead_requirements r
         WHERE r.lead_id = l.id
       ) lr ON true
       LEFT JOIN LATERAL (
         SELECT w.status AS itinerary_status
         FROM whatsapp_logs w
         WHERE w.lead_id = l.id AND w.message_type = 'itinerary' AND w.is_deleted = false
         ORDER BY CASE w.status WHEN 'read' THEN 1 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 3 WHEN 'accepted' THEN 4 WHEN 'unconfirmed' THEN 5 WHEN 'failed' THEN 6 ELSE 7 END,
                  COALESCE(w.sent_at, w.created_at) DESC
         LIMIT 1
       ) it ON true
       ${sortByActivity ? `LEFT JOIN LATERAL (
         SELECT MAX(m.created_at) AS last_message_at
         FROM whatsapp_messages m
         WHERE m.lead_id = l.id
            OR right(regexp_replace(m.phone_number, '[^0-9]', '', 'g'), 10) = right(regexp_replace(COALESCE(NULLIF(l.whatsapp_number,''), l.phone, ''), '[^0-9]', '', 'g'), 10)
       ) wm ON true` : ''}
       ${where}
       ORDER BY ${orderSql} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    const countValues = values.slice(0, values.length - 2);
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total
       FROM leads l
       LEFT JOIN LATERAL (
         SELECT MAX(r.submitted_at) AS lead_date
         FROM lead_requirements r
         WHERE r.lead_id = l.id
       ) lr ON true
       ${where}`,
      countValues,
    );
    return { data: rows, total: countRows[0].total };
  }

  // Leads in one campaign, and how many already got their itinerary sent -- for the
  // "N leads, S sent, P not sent" strip shown when a campaign filter is applied.
  async campaignSummary(campaignName: string, access?: LeadAccess) {
    const values: any[] = [campaignName];
    const destination = destinationInCampaignName(campaignName);
    // NULL (not a NUL-byte pattern, which Postgres rejects) makes the destination test match nothing.
    values.push(destination ? `%${destination}%` : null);
    const accessSql = this.accessSql(access, values);
    const { rows } = await this.pool.query(
      `SELECT
         COUNT(DISTINCT l.id)::int AS total,
         COUNT(DISTINCT l.id) FILTER (WHERE it.itinerary_status IN ('accepted','sent','delivered','read'))::int AS sent
       FROM leads l
       LEFT JOIN lead_requirements r ON r.lead_id = l.id
       LEFT JOIN LATERAL (
         SELECT w.status AS itinerary_status
         FROM whatsapp_logs w
         WHERE w.lead_id = l.id AND w.message_type = 'itinerary' AND w.is_deleted = false
         ORDER BY CASE w.status WHEN 'read' THEN 1 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 3 WHEN 'accepted' THEN 4 WHEN 'unconfirmed' THEN 5 WHEN 'failed' THEN 6 ELSE 7 END,
                  COALESCE(w.sent_at, w.created_at) DESC
         LIMIT 1
       ) it ON true
       WHERE l.is_deleted = false AND (l.campaign_name = $1 OR r.campaign_name = $1 OR l.destination ILIKE $2) ${accessSql}`,
      values,
    );
    const total = rows[0]?.total ?? 0;
    const sent = rows[0]?.sent ?? 0;
    return { campaign: campaignName, total, sent, notSent: total - sent };
  }

  // Every lead closed as Not Interested / Lost with its reason, who marked it and when.
  async closedWithReasons(access?: LeadAccess) {
    const values: any[] = [];
    const accessSql = this.accessSql(access, values);
    const { rows } = await this.pool.query(
      `SELECT l.id, l.customer_name, l.phone, l.destination, l.status::text AS status, l.lost_reason, l.campaign_name, u.full_name AS assigned_name,
              COALESCE(ch.created_at, l.updated_at) AS closed_at, cu.full_name AS closed_by
         FROM leads l
         LEFT JOIN users u ON u.id = l.assigned_to
         LEFT JOIN LATERAL (SELECT c.created_at, c.changed_by FROM lead_changes c WHERE c.lead_id = l.id AND c.field = 'status' AND c.new_value = l.status::text ORDER BY c.created_at DESC LIMIT 1) ch ON true
         LEFT JOIN users cu ON cu.id::text = ch.changed_by::text
        WHERE l.is_deleted = false AND l.status IN ('not_interested', 'lost') ${accessSql}
        ORDER BY COALESCE(ch.created_at, l.updated_at) DESC LIMIT 3000`, values,
    );
    return rows;
  }

  async findDistinctCampaigns(access?: LeadAccess) {
    const values: any[] = [];
    const accessSql = this.accessSql(access, values);
    const { rows } = await this.pool.query(
      `SELECT r.campaign_name, COUNT(*)::int AS lead_count
       FROM lead_requirements r JOIN leads l ON l.id=r.lead_id
       WHERE r.campaign_name IS NOT NULL AND l.is_deleted=false ${accessSql}
       GROUP BY r.campaign_name
       ORDER BY r.campaign_name ASC`, values,
    );
    return rows;
  }

  async findExportRows(campaigns: string[], dateFrom?: string, dateTo?: string, access?: LeadAccess) {
    const values: any[] = [];
    const conditions = ['l.is_deleted = false'];
    if (campaigns.length) {
      values.push(campaigns);
      conditions.push(`COALESCE(r.campaign_name,l.campaign_name) = ANY($${values.length}::text[])`);
    }
    this.addAccessCondition(conditions, values, access);
    if (dateFrom) {
      values.push(dateFrom);
      conditions.push(`COALESCE(r.submitted_at,l.created_at) >= $${values.length}::date`);
    }
    if (dateTo) {
      values.push(dateTo);
      conditions.push(`COALESCE(r.submitted_at,l.created_at) < ($${values.length}::date + interval '1 day')`);
    }
    const { rows } = await this.pool.query(
      `SELECT COALESCE(r.submitted_at,l.created_at) AS submitted_at, r.meta_leadgen_id,
              COALESCE(r.campaign_name,l.campaign_name) AS campaign_name,
              COALESCE(r.ad_name,l.ad_name) AS ad_name, r.form_name,
              COALESCE(r.destination,l.destination) AS destination,
              COALESCE(r.source::text,l.source::text) AS source, COALESCE(r.answers,'{}'::jsonb) AS answers, l.lead_number, l.customer_name,
              COALESCE(NULLIF(l.phone,''), NULLIF(l.whatsapp_number,''),
                       NULLIF(r.answers->>'phone',''), NULLIF(r.answers->>'phone_number',''),
                       NULLIF(r.answers->>'mobile_number',''), NULLIF(r.answers->>'whatsapp_number','')) AS phone,
              l.whatsapp_number, l.email, l.status, l.priority,
              u.full_name AS assigned_to_name
       FROM leads l
       LEFT JOIN LATERAL (SELECT * FROM lead_requirements lr WHERE lr.lead_id=l.id ORDER BY lr.submitted_at DESC LIMIT 1) r ON true
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(r.submitted_at,l.created_at) DESC`,
      values,
    );
    return rows;
  }

  async getDefaultBranchId() {
    const { rows } = await this.pool.query(`SELECT id FROM branches WHERE is_active = true ORDER BY created_at LIMIT 1`);
    return rows[0]?.id ?? null;
  }

  async importRequirement(leadId: string, row: any) {
    const { rowCount } = await this.pool.query(
      `INSERT INTO lead_requirements
        (lead_id, destination, campaign_name, ad_name, form_name, meta_leadgen_id, source, answers, submitted_at)
       SELECT $1,$2,$3,$4,$5,$6,'meta_ads',$7,$8
       WHERE NOT EXISTS (
         SELECT 1 FROM lead_requirements existing
         WHERE existing.lead_id = $1
           AND (($6::text IS NOT NULL AND existing.meta_leadgen_id = $6)
             OR ($6::text IS NULL AND existing.campaign_name IS NOT DISTINCT FROM $3
                 AND existing.submitted_at = $8))
       )`,
      [leadId, row.destination ?? null, row.campaignName ?? null, row.adName ?? null,
       row.formName ?? null, row.metaLeadId ?? null, JSON.stringify(row.answers ?? {}), row.submittedAt],
    );
    return rowCount ?? 0;
  }

  async getStats(access?: LeadAccess) {
    const values: any[] = [];
    const accessSql = this.accessSql(access, values);
    const { rows } = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'new')::int AS new_leads,
         COUNT(*) FILTER (WHERE priority = 'hot')::int AS hot,
         COUNT(*) FILTER (WHERE assigned_to IS NULL)::int AS unassigned,
         COUNT(*) FILTER (WHERE source = 'meta_ads')::int AS meta_ads,
         COUNT(*) FILTER (WHERE COALESCE(lr.lead_date, l.created_at) >= CURRENT_DATE)::int AS today
       FROM leads l
       LEFT JOIN LATERAL (
         SELECT MAX(r.submitted_at) AS lead_date
         FROM lead_requirements r
         WHERE r.lead_id = l.id
       ) lr ON true
       WHERE l.is_deleted = false ${accessSql}`, values,
    );
    return rows[0];
  }

  // The database trigger has just recorded what changed on these leads; this adds who did it.
  async stampChanges(leadIds: string[], userId: string) {
    await this.pool.query(
      `UPDATE lead_changes SET changed_by = $2 WHERE lead_id = ANY($1::uuid[]) AND changed_by IS NULL AND created_at > now() - interval '10 seconds'`,
      [leadIds, userId],
    ).catch(() => undefined);
  }

  async bulkAssign(leadIds: string[], assignedTo: string) {
    const { rowCount } = await this.pool.query(
      `UPDATE leads SET assigned_to = $1, updated_at = now() WHERE id = ANY($2::uuid[]) AND is_deleted = false`,
      [assignedTo, leadIds],
    );
    return rowCount ?? 0;
  }

  async findOne(id: string, access?: LeadAccess) {
    const values: any[] = [id];
    const accessSql = this.accessSql(access, values);
    const { rows } = await this.pool.query(
      `SELECT l.*, (SELECT v.quality FROM lead_quality_v v WHERE v.lead_id = l.id) AS quality, (SELECT v.reason FROM lead_quality_v v WHERE v.lead_id = l.id) AS quality_reason,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', r.id,
                  'destination', r.destination,
                  'campaign_name', r.campaign_name,
                  'ad_name', r.ad_name,
                  'form_name', r.form_name,
                  'source', r.source,
                  'travel_from', r.travel_from,
                  'travel_to', r.travel_to,
                  'adults', r.adults,
                  'children', r.children,
                  'infants', r.infants,
                  'budget', r.budget,
                  'notes', r.notes,
                  'answers', r.answers,
                  'submitted_at', r.submitted_at
                ) ORDER BY r.submitted_at DESC)
                FROM lead_requirements r WHERE r.lead_id = l.id
              ), '[]'::jsonb) AS requirements
              ,u.full_name AS assigned_to_name,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id',cu.id,'full_name',cu.full_name) ORDER BY cu.full_name)
                FROM lead_collaborators lc JOIN users cu ON cu.id=lc.user_id WHERE lc.lead_id=l.id), '[]'::jsonb) AS collaborators
       FROM leads l LEFT JOIN users u ON u.id=l.assigned_to
       WHERE l.id = $1 AND l.is_deleted = false ${accessSql}`,
      values,
    );
    return rows[0] || null;
  }

  async create(dto: CreateLeadDto, createdBy: string | null) {
    // Webhooks can create multiple leads in the same millisecond. Add a
    // random suffix so concurrent imports cannot collide on lead_number.
    const leadNumber = `LD-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const assignedTo = dto.assignedTo ?? await this.getRoundRobinAssignee(dto.branchId);
    const { rows } = await this.pool.query(
      `INSERT INTO leads
        (lead_number, customer_name, phone, whatsapp_number, email, nationality, destination,
         travel_from, travel_to, adults, children, infants, budget, travel_type, source,
         assigned_to, priority, status, expected_revenue, remarks,
         whatsapp_contact_id, whatsapp_status, campaign_name, ad_name, lead_month, lead_year, meta_attribution,
         branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,$26,$27,$28,$29)
       RETURNING *`,
      [
        leadNumber,
        dto.customerName,
        dto.phone ?? null,
        dto.whatsappNumber ?? null,
        dto.email ?? null,
        dto.nationality ?? null,
        dto.destination ?? null,
        dto.travelFrom ?? null,
        dto.travelTo ?? null,
        dto.adults ?? 1,
        dto.children ?? 0,
        dto.infants ?? 0,
        dto.budget ?? 0,
        dto.travelType ?? null,
        dto.source ?? null,
        assignedTo,
        dto.priority ?? 'cold',
        dto.status ?? 'new',
        dto.expectedRevenue ?? 0,
        dto.remarks ?? null,
        dto.whatsappContactId ?? null,
        dto.whatsappStatus ?? 'new',
        dto.campaignName ?? null,
        dto.adName ?? null,
        dto.leadMonth ?? null,
        dto.leadYear ?? null,
        dto.metaAttribution ? JSON.stringify(dto.metaAttribution) : null,
        dto.branchId,
        createdBy,
      ],
    );
    return rows[0];
  }

  async findByWhatsAppNumber(number: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM leads WHERE whatsapp_number = $1 AND is_deleted = false ORDER BY created_at DESC LIMIT 1`,
      [number],
    );
    return rows[0] || null;
  }

  async addRequirement(leadId: string, dto: CreateRequirementDto) {
    const { rows } = await this.pool.query(
      `INSERT INTO lead_requirements
        (lead_id, destination, travel_from, travel_to, adults, children, infants, budget, notes, answers, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual') RETURNING *`,
      [leadId, dto.destination ?? null, dto.travelFrom ?? null, dto.travelTo ?? null,
       dto.adults ?? 1, dto.children ?? 0, dto.infants ?? 0, dto.budget ?? 0,
       dto.notes ?? null, JSON.stringify(dto.answers ?? {})],
    );
    await this.pool.query(
      `UPDATE leads SET destination=COALESCE($2,destination), travel_from=COALESCE($3,travel_from),
       travel_to=COALESCE($4,travel_to), adults=$5, children=$6, infants=$7, budget=$8, updated_at=now()
       WHERE id=$1 AND is_deleted=false`,
      [leadId, dto.destination ?? null, dto.travelFrom ?? null, dto.travelTo ?? null,
       dto.adults ?? 1, dto.children ?? 0, dto.infants ?? 0, dto.budget ?? 0],
    );
    return rows[0];
  }

  async findByContactNumber(number: string) {
    const digits = number.replace(/[^0-9]/g, '');
    const normalized = digits.length > 10 ? digits.slice(-10) : digits;
    if (!normalized) return null;
    const { rows } = await this.pool.query(
      `SELECT * FROM leads
       WHERE is_deleted = false
         AND (
           right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $1
           OR right(regexp_replace(COALESCE(whatsapp_number, ''), '[^0-9]', '', 'g'), 10) = $1
           OR right(regexp_replace(COALESCE(whatsapp_contact_id, ''), '[^0-9]', '', 'g'), 10) = $1
         )
       ORDER BY created_at DESC LIMIT 1`,
      [normalized],
    );
    return rows[0] || null;
  }

  // The reason a lead was closed, kept on its Notes tab with who marked it and when.
  async addClosingNote(leadId: string, body: string, userId: string | null) {
    await this.pool.query(`INSERT INTO lead_notes (lead_id, body, created_by) VALUES ($1, $2, $3)`, [leadId, body, userId]).catch(() => undefined);
  }

  async update(id: string, dto: UpdateLeadDto) {
    const fieldMap: Record<string, any> = {
      customer_name: dto.customerName,
      phone: dto.phone,
      whatsapp_number: dto.whatsappNumber,
      email: dto.email,
      nationality: dto.nationality,
      destination: dto.destination,
      travel_from: dto.travelFrom,
      travel_to: dto.travelTo,
      adults: dto.adults,
      children: dto.children,
      infants: dto.infants,
      budget: dto.budget,
      travel_type: dto.travelType,
      source: dto.source,
      assigned_to: dto.assignedTo,
      priority: dto.priority,
      status: dto.status,
      lost_reason: dto.lostReason,
      expected_revenue: dto.expectedRevenue,
      remarks: dto.remarks,
      whatsapp_contact_id: dto.whatsappContactId,
      whatsapp_status: dto.whatsappStatus,
      campaign_name: dto.campaignName,
      ad_name: dto.adName,
      lead_month: dto.leadMonth,
      lead_year: dto.leadYear,
      meta_attribution: dto.metaAttribution ? JSON.stringify(dto.metaAttribution) : undefined,
      branch_id: dto.branchId,
    };

    const setClauses: string[] = [];
    const values: any[] = [];
    for (const [col, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        values.push(val);
        setClauses.push(`${col} = $${values.length}`);
      }
    }
    if (setClauses.length === 0) return this.findOne(id);

    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE leads SET ${setClauses.join(', ')} WHERE id = $${values.length} AND is_deleted = false RETURNING *`,
      values,
    );
    return rows[0] || null;
  }

  async softDelete(id: string) {
    const { rows } = await this.pool.query(
      `UPDATE leads SET is_deleted = true WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] || null;
  }

  async setCollaborators(leadId: string, userIds: string[], addedBy: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM lead_collaborators WHERE lead_id=$1`, [leadId]);
      if (userIds.length) await client.query(
        `INSERT INTO lead_collaborators(lead_id,user_id,added_by) SELECT $1,unnest($2::uuid[]),$3`,
        [leadId, userIds, addedBy],
      );
      await client.query('COMMIT');
      return this.findOne(leadId);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async getRoundRobinAssignee(branchId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`lead-round-robin:${branchId}`]);
      // Eligibility comes from the role permission map in code (roles.permissions in the DB is an
      // unused placeholder, empty for every role -- checking it meant nobody was ever picked).
      const { rows: candidates } = await client.query(
        `SELECT u.id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id
         WHERE u.is_active=true AND u.is_deleted=false AND u.participate_round_robin=true AND u.branch_id=$1
           AND r.name <> 'super_admin'
         ORDER BY u.created_at,u.id`, [branchId],
      );
      const users = candidates.filter((u: any) => roleHasPermission(u.role_name, PERMISSIONS.LEADS_VIEW));
      if (!users.length) { await client.query('COMMIT'); return null; }
      const { rows: state } = await client.query(`SELECT last_user_id FROM lead_assignment_state WHERE branch_id=$1`, [branchId]);
      const previous = users.findIndex((user) => user.id === state[0]?.last_user_id);
      const selected = users[(previous + 1) % users.length].id;
      await client.query(
        `INSERT INTO lead_assignment_state(branch_id,last_user_id) VALUES($1,$2)
         ON CONFLICT(branch_id) DO UPDATE SET last_user_id=$2,updated_at=now()`,
        [branchId, selected],
      );
      await client.query('COMMIT');
      return selected;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private addAccessCondition(conditions: string[], values: any[], access?: LeadAccess) {
    if (!access || access.roleName === 'super_admin') return;
    values.push(access.userId);
    conditions.push(`(l.assigned_to=$${values.length} OR EXISTS (SELECT 1 FROM lead_collaborators lac WHERE lac.lead_id=l.id AND lac.user_id=$${values.length}))`);
  }
  private accessSql(access: LeadAccess | undefined, values: any[]) {
    if (!access || access.roleName === 'super_admin') return '';
    values.push(access.userId);
    return `AND (l.assigned_to=$${values.length} OR EXISTS (SELECT 1 FROM lead_collaborators lac WHERE lac.lead_id=l.id AND lac.user_id=$${values.length}))`;
  }
}
