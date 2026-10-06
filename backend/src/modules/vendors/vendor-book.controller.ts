import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';

export const VENDOR_CATEGORIES = ['hotel', 'transport', 'activity', 'travel', 'other'] as const;
const KINDS = ['payment', 'vendor_refund'] as const;
const UUID = /^[0-9a-f-]{36}$/i;
const last10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
const list = (v: unknown): string[] => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);

// One row per "vendor on a trip", with everything needed to say where the money stands.
//  - paid: sent to the vendor for this trip (cash payments + credit used from another trip)
//  - cancelled: the trip's booking was cancelled, or its quotation was deleted
//  - a cancelled trip owes the vendor nothing more; what was already paid and not given back is
//    CREDIT the vendor holds for us, until it is used on another trip (credit_used).
const LINES = `
  SELECT tc.id, tc.quotation_id, tc.vendor_id, tc.category, tc.description, tc.agreed_amount::float AS agreed, tc.created_at,
         v.name AS vendor_name, v.phone AS vendor_phone, v.category AS vendor_category,
         q.quotation_number, q.requirement_no, q.destination, q.travel_from, q.travel_to, q.lead_id,
         COALESCE(c.full_name, l.customer_name) AS customer_name, COALESCE(c.phone, l.phone) AS customer_phone,
         i.id AS invoice_id, i.invoice_number,
         (i.cancelled_at IS NOT NULL OR q.is_deleted) AS cancelled,
         COALESCE((SELECT sum(p.amount) FROM trip_vendor_payments p WHERE p.cost_id = tc.id AND p.is_deleted = false AND p.kind IN ('payment','credit_applied')), 0)::float AS paid,
         COALESCE((SELECT sum(p.amount) FROM trip_vendor_payments p WHERE p.cost_id = tc.id AND p.is_deleted = false AND p.kind = 'credit_applied'), 0)::float AS paid_from_credit,
         COALESCE((SELECT sum(p.amount) FROM trip_vendor_payments p WHERE p.cost_id = tc.id AND p.is_deleted = false AND p.kind = 'vendor_refund'), 0)::float AS vendor_refunded,
         COALESCE((SELECT sum(p.amount) FROM trip_vendor_payments p WHERE p.source_cost_id = tc.id AND p.is_deleted = false AND p.kind = 'credit_applied'), 0)::float AS credit_used,
         (SELECT max(p.paid_at) FROM trip_vendor_payments p WHERE p.cost_id = tc.id AND p.is_deleted = false) AS last_paid_at
    FROM trip_vendor_costs tc
    JOIN vendors v ON v.id = tc.vendor_id
    JOIN quotations q ON q.id = tc.quotation_id
    LEFT JOIN leads l ON l.id = q.lead_id
    LEFT JOIN customers c ON c.id = q.customer_id
    LEFT JOIN LATERAL (SELECT * FROM invoices x WHERE x.quotation_id = q.id AND x.is_deleted = false ORDER BY x.created_at LIMIT 1) i ON true
   WHERE tc.is_deleted = false`;

function settle(r: any) {
  const outstanding = r.cancelled ? 0 : Math.max(r.agreed - r.paid, 0);
  const credit = r.cancelled ? Math.max(r.paid - r.vendor_refunded - r.credit_used, 0) : 0;
  const status = r.cancelled ? (credit > 0 ? 'credit' : 'cancelled') : r.paid <= 0 ? 'not_paid' : outstanding > 0 ? 'part_paid' : 'paid';
  return { ...r, outstanding, credit, status };
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('vendor-book')
export class VendorBookController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private async lines(where: string, args: any[]) {
    const { rows } = await this.pool.query(`${LINES} ${where} ORDER BY tc.created_at DESC LIMIT 3000`, args);
    return rows.map(settle);
  }

  // ---------------- vendors ----------------
  // Every destination the CRM already knows (leads, itineraries, quotations, vendors), most used
  // first -- the list offered when choosing which destinations a vendor serves.
  @Get('destinations')
  @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  async destinations() {
    const { rows } = await this.pool.query(
      `SELECT min(name) AS name, sum(n)::int AS leads FROM (
         SELECT trim(destination) AS name, count(*) AS n FROM leads WHERE is_deleted = false AND COALESCE(trim(destination), '') <> '' GROUP BY 1
         UNION ALL SELECT trim(d), 0 FROM tour_packages tp, unnest(tp.destinations) d WHERE tp.is_deleted = false AND COALESCE(trim(d), '') <> ''
         UNION ALL SELECT trim(destination), 0 FROM quotations WHERE is_deleted = false AND COALESCE(trim(destination), '') <> ''
         UNION ALL SELECT trim(d), 0 FROM vendors v, unnest(v.destinations) d WHERE v.is_deleted = false AND COALESCE(trim(d), '') <> ''
       ) x GROUP BY lower(name) ORDER BY 2 DESC, 1 LIMIT 500`,
    ).catch(() => ({ rows: [] as any[] }));
    return { data: rows };
  }

  @Get('vendors')
  @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  async vendors(@Query('category') category?: string, @Query('destination') destination?: string, @Query('search') search?: string) {
    const conds = ['v.is_deleted = false'];
    const args: any[] = [];
    if (category && (VENDOR_CATEGORIES as readonly string[]).includes(category)) { args.push(category); conds.push(`v.category = $${args.length}`); }
    if (search?.trim()) { args.push(`%${search.trim()}%`); conds.push(`(v.name ILIKE $${args.length} OR v.phone ILIKE $${args.length} OR v.contact_person ILIKE $${args.length})`); }
    // "for this destination only these vendors": a vendor with no destination listed serves everywhere
    if (destination?.trim()) {
      args.push(destination.trim().toLowerCase());
      conds.push(`(cardinality(v.destinations) = 0 OR EXISTS (SELECT 1 FROM unnest(v.destinations) d WHERE lower(d) = $${args.length} OR $${args.length} LIKE '%' || lower(d) || '%' OR lower(d) LIKE '%' || $${args.length} || '%'))`);
    }
    const { rows } = await this.pool.query(
      `SELECT v.id, v.name, v.category, v.phone, v.email, v.address, v.gst_number, v.destinations, v.seaters, v.travel_modes, v.contact_person, v.notes, v.bank_details, v.created_at
         FROM vendors v WHERE ${conds.join(' AND ')} ORDER BY v.name LIMIT 2000`, args);
    const all = await this.lines('', []);
    const by = new Map<string, { trips: number; agreed: number; paid: number; outstanding: number; credit: number }>();
    for (const l of all) {
      const t = by.get(l.vendor_id) ?? { trips: 0, agreed: 0, paid: 0, outstanding: 0, credit: 0 };
      t.trips++; if (!l.cancelled) t.agreed += l.agreed; t.paid += l.paid - l.paid_from_credit - l.vendor_refunded; t.outstanding += l.outstanding; t.credit += l.credit;
      by.set(l.vendor_id, t);
    }
    return { data: rows.map((v) => ({ ...v, ...(by.get(v.id) ?? { trips: 0, agreed: 0, paid: 0, outstanding: 0, credit: 0 }) })) };
  }

  private async saveVendor(body: any, req: any, id?: string) {
    const name = String(body?.name ?? '').trim();
    const category = String(body?.category ?? '');
    if (!name) throw new BadRequestException('Enter the vendor name');
    if (!(VENDOR_CATEGORIES as readonly string[]).includes(category)) throw new BadRequestException('Choose the kind of vendor');
    const phone = String(body?.phone ?? '').trim();
    if (last10(phone).length !== 10) throw new BadRequestException('Enter a valid 10-digit mobile number');
    // the mobile number is the vendor's identity: the same vendor is never entered twice
    const { rows: dup } = await this.pool.query(`SELECT id, name FROM vendors WHERE is_deleted = false AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1 AND id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1`, [last10(phone), id ?? null]);
    if (dup[0]) throw new BadRequestException(`This mobile number already belongs to the vendor "${dup[0].name}"`);
    const values = [
      name, category, ['hotel', 'transport', 'activity'].includes(category) ? category : 'other', phone, String(body?.email ?? '').trim() || null, String(body?.address ?? '').trim() || null,
      String(body?.gstNumber ?? '').trim() || null, list(body?.destinations), list(body?.seaters).map((n) => parseInt(n, 10)).filter((n) => n > 0 && n < 100),
      list(body?.travelModes).filter((m) => ['flight', 'train', 'bus'].includes(m)), String(body?.contactPerson ?? '').trim() || null, String(body?.notes ?? '').trim() || null, String(body?.bankDetails ?? '').trim() || null,
    ];
    if (id) {
      const { rows } = await this.pool.query(
        `UPDATE vendors SET name=$1, category=$2, type=$3, phone=$4, email=$5, address=$6, gst_number=$7, destinations=$8, seaters=$9, travel_modes=$10, contact_person=$11, notes=$12, bank_details=$13, updated_at=now()
          WHERE id=$14 AND is_deleted=false RETURNING id`, [...values, id]).catch((e) => { throw new BadRequestException(`Could not save the vendor: ${e.message}`); });
      if (!rows[0]) throw new NotFoundException('Vendor not found');
      return rows[0];
    }
    let branchId = body?.branchId || req.user?.branchId;
    if (!branchId) branchId = (await this.pool.query(`SELECT id FROM branches WHERE is_deleted = false ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    const { rows } = await this.pool.query(
      `INSERT INTO vendors(name, category, type, phone, email, address, gst_number, destinations, seaters, travel_modes, contact_person, notes, bank_details, branch_id, created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, [...values, branchId, req.user?.userId ?? null]).catch((e) => { throw new BadRequestException(`Could not save the vendor: ${e.message}`); });
    return rows[0];
  }

  @Post('vendors')
  @RequirePermissions(PERMISSIONS.VENDORS_CREATE)
  createVendor(@Body() body: any, @Req() req: any) { return this.saveVendor(body, req); }

  @Patch('vendors/:id')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  updateVendor(@Param('id') id: string, @Body() body: any, @Req() req: any) { return this.saveVendor(body, req, id); }

  @Delete('vendors/:id')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  async removeVendor(@Param('id') id: string) {
    const { rows } = await this.pool.query(`UPDATE vendors SET is_deleted = true, updated_at = now() WHERE id = $1 AND is_deleted = false RETURNING id`, [id]);
    if (!rows[0]) throw new NotFoundException('Vendor not found');
    return { removed: true };
  }

  // One vendor's account: every trip given to them, what was agreed, paid and is still to pay,
  // the credit they hold from cancelled trips, and every payment in time order.
  @Get('vendors/:id')
  @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  async vendor(@Param('id') id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Vendor not found');
    const { rows } = await this.pool.query(`SELECT * FROM vendors WHERE id = $1 AND is_deleted = false`, [id]);
    if (!rows[0]) throw new NotFoundException('Vendor not found');
    const trips = await this.lines('AND tc.vendor_id = $1', [id]);
    const { rows: payments } = await this.pool.query(
      `SELECT p.id, p.cost_id, p.kind, p.amount::float AS amount, p.method, p.reference, p.note, p.paid_at, u.full_name AS by_name,
              q.quotation_number, COALESCE(c.full_name, l.customer_name) AS customer_name, q.destination,
              sq.quotation_number AS source_quotation, COALESCE(sc.full_name, sl.customer_name) AS source_customer
         FROM trip_vendor_payments p
         JOIN trip_vendor_costs tc ON tc.id = p.cost_id JOIN quotations q ON q.id = tc.quotation_id
         LEFT JOIN leads l ON l.id = q.lead_id LEFT JOIN customers c ON c.id = q.customer_id LEFT JOIN users u ON u.id = p.created_by
         LEFT JOIN trip_vendor_costs stc ON stc.id = p.source_cost_id LEFT JOIN quotations sq ON sq.id = stc.quotation_id
         LEFT JOIN leads sl ON sl.id = sq.lead_id LEFT JOIN customers sc ON sc.id = sq.customer_id
        WHERE p.vendor_id = $1 AND p.is_deleted = false ORDER BY p.paid_at DESC LIMIT 2000`, [id]);
    // Confirmed trips (an invoice exists, not cancelled) going where this vendor works that have
    // not been given to them yet -- so the vendor's page shows who is travelling there, and the
    // trip can be given from here. Nothing is assigned automatically: a destination usually has
    // several vendors of the same kind, and the amount is agreed per trip.
    const { rows: matching } = await this.pool.query(
      `SELECT q.id AS quotation_id, q.quotation_number, q.requirement_no, q.destination, q.travel_from, q.travel_to, q.adults, q.children,
              COALESCE(c.full_name, l.customer_name) AS customer_name, COALESCE(c.phone, l.phone) AS customer_phone,
              i.id AS invoice_id, i.invoice_number, i.total_amount::float AS invoice_total, i.created_at AS invoice_date,
              (SELECT string_agg(DISTINCT ov.name, ', ') FROM trip_vendor_costs oc JOIN vendors ov ON ov.id = oc.vendor_id
                WHERE oc.quotation_id = q.id AND oc.is_deleted = false AND oc.category = $2) AS same_kind_vendors
         FROM invoices i
         JOIN quotations q ON q.id = i.quotation_id AND q.is_deleted = false
         LEFT JOIN leads l ON l.id = q.lead_id LEFT JOIN customers c ON c.id = q.customer_id
        WHERE i.is_deleted = false AND i.cancelled_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM trip_vendor_costs tc WHERE tc.quotation_id = q.id AND tc.vendor_id = $1 AND tc.is_deleted = false)
          AND (cardinality($3::text[]) = 0 OR EXISTS (SELECT 1 FROM unnest($3::text[]) d
                WHERE COALESCE(trim(q.destination), '') <> '' AND trim(d) <> '' AND (lower(q.destination) LIKE '%' || lower(trim(d)) || '%' OR lower(trim(d)) LIKE '%' || lower(trim(q.destination)) || '%')))
        ORDER BY i.created_at DESC LIMIT 500`, [id, rows[0].category, rows[0].destinations ?? []]).catch(() => ({ rows: [] as any[] }));
    return { vendor: rows[0], trips, payments, matching };
  }

  // ---------------- finance: every confirmed trip, broken down ----------------
  // One row per invoice (a confirmed trip): what the customer was billed and paid, what went to
  // each kind of vendor, and the margin that is left. Period = invoice date, whole days, India time.
  @Get('finance')
  @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  async finance(@Query('from') from?: string, @Query('to') to?: string) {
    const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const args = [ok(from) ?? '2000-01-01', ok(to) ?? '2100-01-01'];
    const { rows: trips } = await this.pool.query(
      `SELECT i.id AS invoice_id, i.invoice_number, i.created_at AS invoice_date, i.status::text AS invoice_status, i.cancelled_at, i.cancel_reason,
              i.amount::float AS taxable, i.tax_amount::float AS gst, i.total_amount::float AS total,
              q.id AS quotation_id, q.quotation_number, q.requirement_no, q.destination, q.travel_from, q.travel_to, q.adults, q.children, q.lead_id,
              COALESCE(c.full_name, l.customer_name) AS customer_name, COALESCE(c.phone, l.phone) AS customer_phone, u.full_name AS handled_by,
              COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0)::float AS received,
              COALESCE((SELECT sum(rf.amount) FROM refunds rf WHERE rf.invoice_id = i.id AND rf.is_deleted = false), 0)::float AS refunded
         FROM invoices i
         JOIN quotations q ON q.id = i.quotation_id
         LEFT JOIN leads l ON l.id = q.lead_id LEFT JOIN customers c ON c.id = q.customer_id LEFT JOIN users u ON u.id = l.assigned_to
        WHERE i.is_deleted = false
          AND i.created_at >= ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AND i.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
        ORDER BY i.created_at DESC LIMIT 5000`, args);
    const ids = trips.map((t) => t.quotation_id);
    const lines = ids.length ? await this.lines('AND tc.quotation_id = ANY($1::uuid[])', [ids]) : [];
    const { rows: company } = await this.pool.query(`SELECT company_name, legal_name, gstin, address, phone, email FROM company_settings WHERE id = true`).catch(() => ({ rows: [] as any[] }));

    const data = trips.map((t) => {
      const own = lines.filter((l) => l.quotation_id === t.quotation_id);
      const byKind: Record<string, { agreed: number; paid: number }> = {};
      for (const k of VENDOR_CATEGORIES) byKind[k] = { agreed: 0, paid: 0 };
      for (const l of own) { const k = (VENDOR_CATEGORIES as readonly string[]).includes(l.category) ? l.category : 'other'; if (!l.cancelled) byKind[k].agreed += l.agreed; byKind[k].paid += l.paid - l.paid_from_credit - l.vendor_refunded; }
      const cancelled = !!t.cancelled_at;
      const kept = t.received - t.refunded;
      const vendorAgreed = own.filter((l) => !l.cancelled).reduce((n, l) => n + l.agreed, 0);
      const vendorPaid = own.reduce((n, l) => n + l.paid - l.paid_from_credit - l.vendor_refunded, 0);
      const vendorCreditUsed = own.reduce((n, l) => n + l.paid_from_credit, 0);
      const vendorOutstanding = own.reduce((n, l) => n + l.outstanding, 0);
      const vendorCredit = own.reduce((n, l) => n + l.credit, 0);
      // GST collected is not income: on what was actually received it is taken out in proportion.
      const gstInReceived = t.total > 0 ? Math.round((kept * t.gst) / t.total) : 0;
      return {
        ...t, cancelled, kept, balance: cancelled ? 0 : Math.max(t.total - t.received, 0),
        vendors: byKind, vendorAgreed, vendorPaid, vendorCreditUsed, vendorOutstanding, vendorCredit,
        // the trip's margin when everything is collected and paid: billed before tax, less every vendor
        margin: cancelled ? kept - gstInReceived - (vendorPaid - vendorCredit) : t.taxable - vendorAgreed,
        // what is in hand today: received (less GST and refunds) less what has gone to vendors
        cashInHand: kept - gstInReceived - vendorPaid,
        gstInReceived,
        vendorLines: own.map((l) => ({ vendor: l.vendor_name, vendor_phone: l.vendor_phone, category: l.category, description: l.description, agreed: l.agreed, paid: l.paid, paid_from_credit: l.paid_from_credit, outstanding: l.outstanding, credit: l.credit, status: l.status })),
      };
    });
    return { period: { from: ok(from), to: ok(to) }, company: company[0] ?? null, data };
  }

  // ---------------- a trip's vendors ----------------
  @Get('trips/:quotationId')
  @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  async trip(@Param('quotationId') quotationId: string) {
    if (!UUID.test(quotationId)) throw new NotFoundException('Quotation not found');
    const { rows: q } = await this.pool.query(
      `SELECT q.id, q.quotation_number, q.destination, q.final_amount::float AS final_amount, q.gst_amount::float AS gst_amount, q.is_deleted,
              i.id AS invoice_id, i.invoice_number, (i.cancelled_at IS NOT NULL) AS cancelled,
              COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0)::float AS received,
              COALESCE((SELECT sum(rf.amount) FROM refunds rf WHERE rf.invoice_id = i.id AND rf.is_deleted = false), 0)::float AS refunded
         FROM quotations q LEFT JOIN LATERAL (SELECT * FROM invoices x WHERE x.quotation_id = q.id AND x.is_deleted = false ORDER BY x.created_at LIMIT 1) i ON true
        WHERE q.id = $1`, [quotationId]);
    if (!q[0]) throw new NotFoundException('Quotation not found');
    const costs = await this.lines('AND tc.quotation_id = $1', [quotationId]);
    const { rows: payments } = await this.pool.query(
      `SELECT p.id, p.cost_id, p.kind, p.amount::float AS amount, p.method, p.reference, p.note, p.paid_at, u.full_name AS by_name,
              sq.quotation_number AS source_quotation, COALESCE(sc.full_name, sl.customer_name) AS source_customer
         FROM trip_vendor_payments p JOIN trip_vendor_costs tc ON tc.id = p.cost_id LEFT JOIN users u ON u.id = p.created_by
         LEFT JOIN trip_vendor_costs stc ON stc.id = p.source_cost_id LEFT JOIN quotations sq ON sq.id = stc.quotation_id
         LEFT JOIN leads sl ON sl.id = sq.lead_id LEFT JOIN customers sc ON sc.id = sq.customer_id
        WHERE tc.quotation_id = $1 AND p.is_deleted = false ORDER BY p.paid_at DESC`, [quotationId]);
    // credit each of this trip's vendors holds from other (cancelled) trips, ready to be used here
    const vendorIds = Array.from(new Set(costs.map((c) => c.vendor_id)));
    const credits = vendorIds.length ? (await this.lines('AND tc.vendor_id = ANY($1::uuid[]) AND tc.quotation_id <> $2', [vendorIds, quotationId])).filter((l) => l.credit > 0) : [];
    const agreed = costs.filter((c) => !c.cancelled).reduce((n, c) => n + c.agreed, 0);
    const paidCash = costs.reduce((n, c) => n + c.paid - c.paid_from_credit - c.vendor_refunded, 0);
    const outstanding = costs.reduce((n, c) => n + c.outstanding, 0);
    const taxable = q[0].final_amount - q[0].gst_amount;
    return {
      trip: q[0], costs, payments, credits,
      statement: {
        quoted: q[0].final_amount, taxable, received: q[0].received, refunded: q[0].refunded, kept: q[0].received - q[0].refunded,
        vendorAgreed: agreed, vendorPaid: paidCash, vendorOutstanding: outstanding, vendorCredit: costs.reduce((n, c) => n + c.credit, 0),
        // a cancelled trip earns what was kept from the customer less what went to vendors and is not coming back or reusable
        margin: q[0].cancelled ? q[0].received - q[0].refunded - costs.reduce((n, c) => n + c.credit_used, 0) : taxable - agreed,
      },
    };
  }

  @Post('trips/:quotationId/costs')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  async addCost(@Param('quotationId') quotationId: string, @Body() body: any, @Req() req: any) {
    // payNow: the trip is given and the first payment recorded in one step (from the vendor's own
    // page). With no total entered, the payment itself is the whole amount for the trip.
    const payNow = Math.round(Number(body?.payNow) || 0);
    const amount = Math.round(Number(body?.agreedAmount) || 0) || payNow;
    if (!UUID.test(String(body?.vendorId ?? ''))) throw new BadRequestException('Choose the vendor');
    if (amount <= 0) throw new BadRequestException('Enter the amount agreed with the vendor');
    if (payNow < 0 || payNow > amount) throw new BadRequestException('The payment cannot be more than the total for this trip');
    const paidAt = body?.paidAt ? new Date(body.paidAt) : new Date();
    if (isNaN(paidAt.getTime())) throw new BadRequestException('That date is not valid');
    const { rows: v } = await this.pool.query(`SELECT category FROM vendors WHERE id = $1 AND is_deleted = false`, [body.vendorId]);
    if (!v[0]) throw new BadRequestException('That vendor no longer exists');
    const { rows } = await this.pool.query(
      `INSERT INTO trip_vendor_costs(quotation_id, vendor_id, category, description, agreed_amount, created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [quotationId, body.vendorId, v[0].category, String(body?.description ?? '').trim().slice(0, 300) || null, amount, req.user?.userId ?? null],
    ).catch((e) => { throw new BadRequestException(`Could not add the vendor: ${e.message}`); });
    if (payNow > 0) {
      await this.pool.query(
        `INSERT INTO trip_vendor_payments(cost_id, vendor_id, kind, amount, method, reference, note, paid_at, created_by) VALUES($1,$2,'payment',$3,$4,$5,$6,$7,$8)`,
        [rows[0].id, body.vendorId, payNow, String(body?.method ?? 'bank_transfer'), String(body?.reference ?? '').trim() || null, String(body?.note ?? '').trim().slice(0, 300) || null, paidAt.toISOString(), req.user?.userId ?? null]);
    }
    return rows[0];
  }

  @Patch('costs/:id')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  async updateCost(@Param('id') id: string, @Body() body: any) {
    const amount = Math.round(Number(body?.agreedAmount) || 0);
    if (amount <= 0) throw new BadRequestException('Enter the amount agreed with the vendor');
    const { rows } = await this.pool.query(`UPDATE trip_vendor_costs SET agreed_amount = $2, description = $3, updated_at = now() WHERE id = $1 AND is_deleted = false RETURNING id`, [id, amount, String(body?.description ?? '').trim().slice(0, 300) || null]);
    if (!rows[0]) throw new NotFoundException('Not found');
    return rows[0];
  }

  @Delete('costs/:id')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  async removeCost(@Param('id') id: string) {
    const [line] = await this.lines('AND tc.id = $1', [id]);
    if (!line) throw new NotFoundException('Not found');
    if (line.paid > 0) throw new BadRequestException('Payments are recorded for this vendor on this trip. Remove those payments first.');
    await this.pool.query(`UPDATE trip_vendor_costs SET is_deleted = true, updated_at = now() WHERE id = $1`, [id]);
    return { removed: true };
  }

  // Money sent to the vendor for this trip (an advance or the rest), or money the vendor gave back.
  @Post('costs/:id/payments')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  async pay(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const [line] = await this.lines('AND tc.id = $1', [id]);
    if (!line) throw new NotFoundException('Not found');
    const kind = (KINDS as readonly string[]).includes(body?.kind) ? body.kind : 'payment';
    const amount = Math.round(Number(body?.amount) || 0);
    if (amount <= 0) throw new BadRequestException('Enter an amount above zero');
    if (kind === 'payment' && line.cancelled) throw new BadRequestException('This trip is cancelled, so nothing more is paid to the vendor for it');
    if (kind === 'payment' && amount > line.outstanding) throw new BadRequestException(`Only ₹${line.outstanding.toLocaleString('en-IN')} is still to be paid to this vendor for this trip`);
    if (kind === 'vendor_refund' && amount > Math.max(line.paid - line.vendor_refunded - line.credit_used, 0)) throw new BadRequestException('That is more than the vendor is holding for this trip');
    const paidAt = body?.paidAt ? new Date(body.paidAt) : new Date();
    if (isNaN(paidAt.getTime())) throw new BadRequestException('That date is not valid');
    await this.pool.query(
      `INSERT INTO trip_vendor_payments(cost_id, vendor_id, kind, amount, method, reference, note, paid_at, created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, line.vendor_id, kind, amount, String(body?.method ?? 'bank_transfer'), String(body?.reference ?? '').trim() || null, String(body?.note ?? '').trim().slice(0, 300) || null, paidAt.toISOString(), req.user?.userId ?? null]);
    return { saved: true };
  }

  // Use credit the vendor holds from a cancelled trip to pay (part of) this trip.
  @Post('costs/:id/apply-credit')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  async applyCredit(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const [line] = await this.lines('AND tc.id = $1', [id]);
    const [source] = UUID.test(String(body?.sourceCostId ?? '')) ? await this.lines('AND tc.id = $1', [body.sourceCostId]) : [];
    if (!line || !source) throw new NotFoundException('Not found');
    if (source.vendor_id !== line.vendor_id) throw new BadRequestException('That credit is with a different vendor');
    if (line.cancelled) throw new BadRequestException('This trip is cancelled');
    const amount = Math.round(Number(body?.amount) || 0);
    if (amount <= 0) throw new BadRequestException('Enter an amount above zero');
    if (amount > source.credit) throw new BadRequestException(`Only ₹${source.credit.toLocaleString('en-IN')} of credit is left from that trip`);
    if (amount > line.outstanding) throw new BadRequestException(`Only ₹${line.outstanding.toLocaleString('en-IN')} is still to be paid to this vendor for this trip`);
    await this.pool.query(
      `INSERT INTO trip_vendor_payments(cost_id, vendor_id, kind, amount, method, note, source_cost_id, created_by) VALUES($1,$2,'credit_applied',$3,'credit',$4,$5,$6)`,
      [id, line.vendor_id, amount, `Credit from ${source.customer_name || 'a cancelled trip'} (${source.quotation_number})`, source.id, req.user?.userId ?? null]);
    return { saved: true };
  }

  @Delete('payments/:id')
  @RequirePermissions(PERMISSIONS.VENDORS_EDIT)
  async removePayment(@Param('id') id: string) {
    const { rows } = await this.pool.query(`UPDATE trip_vendor_payments SET is_deleted = true WHERE id = $1 AND is_deleted = false RETURNING id`, [id]);
    if (!rows[0]) throw new NotFoundException('Payment not found');
    return { removed: true };
  }
}
