import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { CreatePackageDto, HotelItemDto, FlightItemDto, TransferItemDto, ItineraryDayItemDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';

export interface PackageListParams {
  branchId?: string;
  search?: string;
  type?: string;
  isTemplate?: boolean;
  page: number;
  pageSize: number;
}

const PACKAGE_FIELD_MAP: Record<string, keyof CreatePackageDto> = {
  name: 'name',
  package_code: 'packageCode',
  type: 'type',
  destinations: 'destinations',
  duration_days: 'durationDays',
  duration_nights: 'durationNights',
  start_date: 'startDate',
  end_date: 'endDate',
  max_pax: 'maxPax',
  language: 'language',
  is_active: 'isActive',
  is_template: 'isTemplate',
  description: 'description',
  highlights: 'highlights',
  net_price: 'netPrice',
  base_price_adult: 'basePriceAdult',
  base_price_child: 'basePriceChild',
  price_child_nobed: 'priceChildNobed',
  price_infant: 'priceInfant',
  price_extra_adult: 'priceExtraAdult',
  markup_pct: 'markupPct',
  tax_type: 'taxType',
  currency: 'currency',
  pricing_notes: 'pricingNotes',
  inclusions: 'inclusions',
  exclusions: 'exclusions',
  cancellation_policy: 'cancellationPolicy',
  refund_policy: 'refundPolicy',
  terms_and_conditions: 'termsAndConditions',
  cover_image_url: 'coverImageUrl',
  gallery_urls: 'galleryUrls',
  itinerary_pdf_object_key: 'itineraryPdfObjectKey',
  itinerary_pdf_file_name: 'itineraryPdfFileName',
  campaign_name: 'campaignName',
  contact_number: 'contactNumber',
  contact_name: 'contactName',
  contact_button_text: 'contactButtonText',
  branch_id: 'branchId',
};

@Injectable()
export class PackagesRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async saveThumbnail(packageId: string, dataUrl: string) {
    await this.pool.query(
      `INSERT INTO package_thumbnails(package_id, data_url) VALUES($1,$2)
       ON CONFLICT (package_id) DO UPDATE SET data_url = EXCLUDED.data_url, updated_at = now()`,
      [packageId, dataUrl],
    );
    return { ok: true };
  }

  async getPdfObjectKey(packageId: string): Promise<string | null> {
    const { rows } = await this.pool.query(`SELECT itinerary_pdf_object_key FROM tour_packages WHERE id = $1 AND is_deleted = false`, [packageId]);
    return rows[0]?.itinerary_pdf_object_key ?? null;
  }

  async getThumbnail(packageId: string) {
    const { rows } = await this.pool.query(`SELECT data_url FROM package_thumbnails WHERE package_id = $1`, [packageId]);
    return { dataUrl: rows[0]?.data_url ?? null };
  }

  async listPresets() {
    const { rows } = await this.pool.query(`SELECT id, kind, value FROM itinerary_presets ORDER BY kind, created_at`);
    return rows;
  }

  async addPreset(kind: string, value: string) {
    const { rows } = await this.pool.query(
      `INSERT INTO itinerary_presets(kind, value) VALUES($1,$2)
       ON CONFLICT (kind, value) DO UPDATE SET value = EXCLUDED.value RETURNING id, kind, value`,
      [kind, value],
    );
    return rows[0];
  }

  async updatePreset(id: string, value: string) {
    const { rows } = await this.pool.query(
      `UPDATE itinerary_presets SET value=$2 WHERE id=$1 RETURNING id, kind, value`, [id, value],
    );
    return rows[0];
  }

  async deletePreset(id: string) {
    await this.pool.query(`DELETE FROM itinerary_presets WHERE id=$1`, [id]);
    return { ok: true };
  }

  async findAll(params: PackageListParams) {
    const conditions: string[] = ['is_deleted = false'];
    const values: any[] = [];

    if (params.branchId) {
      values.push(params.branchId);
      conditions.push(`branch_id = $${values.length}`);
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      conditions.push(`(name ILIKE $${values.length} OR package_code ILIKE $${values.length} OR EXISTS (SELECT 1 FROM unnest(COALESCE(destinations, ARRAY[]::text[])) d WHERE d ILIKE $${values.length}))`);
    }
    if (params.type) {
      values.push(params.type);
      conditions.push(`type = $${values.length}`);
    }
    if (params.isTemplate !== undefined) {
      values.push(params.isTemplate);
      conditions.push(`is_template = $${values.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (params.page - 1) * params.pageSize;

    values.push(params.pageSize);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const { rows } = await this.pool.query(
      `SELECT * FROM tour_packages ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    const countValues = values.slice(0, values.length - 2);
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM tour_packages ${where}`,
      countValues,
    );
    return { data: rows, total: countRows[0].total };
  }

  async findOne(id: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM tour_packages WHERE id = $1 AND is_deleted = false`,
      [id],
    );
    const pkg = rows[0];
    if (!pkg) return null;

    const [hotelsRes, flightsRes, transfersRes, daysRes] = await Promise.all([
      this.pool.query(`SELECT * FROM package_hotels WHERE package_id = $1 ORDER BY created_at`, [id]),
      this.pool.query(`SELECT * FROM package_flights WHERE package_id = $1 ORDER BY created_at`, [id]),
      this.pool.query(`SELECT * FROM package_transfers WHERE package_id = $1 ORDER BY created_at`, [id]),
      this.pool.query(
        `SELECT * FROM itinerary_days WHERE package_id = $1 AND is_deleted = false ORDER BY day_number`,
        [id],
      ),
    ]);

    return {
      ...pkg,
      hotels: hotelsRes.rows,
      flights: flightsRes.rows,
      transfers: transfersRes.rows,
      itinerary: daysRes.rows,
    };
  }

  async create(dto: CreatePackageDto, createdBy: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO tour_packages
          (name, package_code, type, destinations, duration_days, duration_nights,
           start_date, end_date, max_pax, language, is_active, is_template,
           description, highlights, net_price, base_price_adult, base_price_child,
           price_child_nobed, price_infant, price_extra_adult, markup_pct, tax_type,
           currency, pricing_notes, inclusions, exclusions, cancellation_policy,
           refund_policy, terms_and_conditions, cover_image_url, gallery_urls,
           itinerary_pdf_object_key, itinerary_pdf_file_name, campaign_name, contact_number, contact_name, contact_button_text,
           branch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                 $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39)
         RETURNING *`,
        [
          dto.name,
          dto.packageCode ?? null,
          dto.type ?? null,
          dto.destinations ?? [],
          dto.durationDays ?? null,
          dto.durationNights ?? null,
          dto.startDate ?? null,
          dto.endDate ?? null,
          dto.maxPax ?? null,
          dto.language ?? 'English',
          dto.isActive ?? true,
          dto.isTemplate ?? false,
          dto.description ?? null,
          dto.highlights ?? null,
          dto.netPrice ?? null,
          dto.basePriceAdult ?? 0,
          dto.basePriceChild ?? 0,
          dto.priceChildNobed ?? null,
          dto.priceInfant ?? null,
          dto.priceExtraAdult ?? null,
          dto.markupPct ?? 15,
          dto.taxType ?? 'GST 5%',
          dto.currency ?? 'INR',
          dto.pricingNotes ?? null,
          dto.inclusions ?? [],
          dto.exclusions ?? [],
          dto.cancellationPolicy ?? null,
          dto.refundPolicy ?? null,
          dto.termsAndConditions ?? null,
          dto.coverImageUrl ?? null,
          dto.galleryUrls ?? [],
          dto.itineraryPdfObjectKey ?? null,
          dto.itineraryPdfFileName ?? null,
          dto.campaignName ?? null,
          dto.contactNumber ?? null,
          dto.contactName ?? null,
          dto.contactButtonText ?? null,
          dto.branchId,
          createdBy,
        ],
      );
      const pkg = rows[0];
      if (dto.buttons !== undefined) await client.query(`UPDATE tour_packages SET buttons = $2::jsonb WHERE id = $1`, [pkg.id, JSON.stringify(dto.buttons)]);
      await this.saveChildren(client, pkg.id, dto, createdBy);
      await client.query('COMMIT');
      return this.findOne(pkg.id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async update(id: string, dto: UpdatePackageDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const setClauses: string[] = [];
      const values: any[] = [];
      for (const [col, key] of Object.entries(PACKAGE_FIELD_MAP)) {
        const val = (dto as any)[key];
        if (val !== undefined) {
          values.push(val);
          setClauses.push(`${col} = $${values.length}`);
        }
      }
      // The call button's number lives inside the approved WhatsApp template,
      // so changing the number means this itinerary needs its own template.
      let resetTemplate = false;
      if (dto.contactNumber !== undefined || dto.contactButtonText !== undefined || dto.buttons !== undefined) {
        const { rows: current } = await client.query(`SELECT contact_number, contact_button_text, buttons FROM tour_packages WHERE id = $1`, [id]);
        if (dto.contactNumber !== undefined && String(current[0]?.contact_number || '') !== String(dto.contactNumber || '')) resetTemplate = true;
        if (dto.contactButtonText !== undefined && String(current[0]?.contact_button_text || '') !== String(dto.contactButtonText || '')) resetTemplate = true;
        if (dto.buttons !== undefined) {
          const next = JSON.stringify(dto.buttons);
          // The reply text is ours to send, so only Meta-visible fields need re-approval.
          const meta = (list: any) => JSON.stringify((Array.isArray(list) ? list : []).map((b: any) => ({ type: b.type, text: b.text, phone: b.type === 'call' ? (b.phone || '') : '', url: b.type === 'url' ? (b.url || '') : '' })));
          const before = current[0]?.buttons ? meta(current[0].buttons) : null;
          if (before !== meta(dto.buttons)) resetTemplate = true;
          values.push(next);
          setClauses.push(`buttons = $${values.length}::jsonb`);
        }
      }
      if (resetTemplate) {
        setClauses.push(
          `whatsapp_template_id = NULL`,
          `whatsapp_template_name = NULL`,
          `whatsapp_template_status = 'NOT_SUBMITTED'`,
          `whatsapp_template_rejection_reason = NULL`,
        );
      }
      if (setClauses.length > 0) {
        values.push(id);
        await client.query(
          `UPDATE tour_packages SET ${setClauses.join(', ')} WHERE id = $${values.length} AND is_deleted = false`,
          values,
        );
      }

      await this.saveChildren(client, id, dto as CreatePackageDto, null, true);

      await client.query('COMMIT');
      return this.findOne(id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // Fuzzy-matches a Meta ad campaign name against tagged packages, for the
  // WhatsApp bot's auto-itinerary feature. Bidirectional ILIKE since staff
  // may tag a package with a shorter/longer variant of the real campaign name.
  async findByCampaignName(campaignName: string) {
    return (await this.findManyByCampaignName(campaignName))[0] || null;
  }

  // A destination can legitimately have more than one itinerary package tagged
  // to it -- e.g. a "5 Days 4 Nights" and a "2 Days 1 Night" variant, each its
  // own uploaded document and its own Meta-approved template (Meta only allows
  // one document per template, so multiple documents genuinely means multiple
  // packages/templates). The auto-send path sends every match, not just one.
  async findManyByCampaignName(campaignName: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM tour_packages
       WHERE is_deleted = false AND is_active = true AND campaign_name IS NOT NULL
         AND ($1 ILIKE '%' || campaign_name || '%' OR campaign_name ILIKE '%' || $1 || '%')
       ORDER BY length(campaign_name) DESC`,
      [campaignName],
    );
    return rows;
  }

  async findByDestination(destination: string) {
    return (await this.findManyByDestination(destination))[0] || null;
  }

  async findManyByDestination(destination: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM tour_packages p
       WHERE p.is_deleted = false AND p.is_active = true
         AND p.itinerary_pdf_object_key IS NOT NULL
         AND (
           p.name ILIKE '%' || $1 || '%'
           OR EXISTS (SELECT 1 FROM unnest(COALESCE(p.destinations, ARRAY[]::text[])) d WHERE d ILIKE '%' || $1 || '%')
         )
       ORDER BY CASE WHEN p.name ILIKE '%' || $1 || '%' THEN 0 ELSE 1 END, p.created_at DESC`,
      [destination],
    );
    return rows;
  }

  private async saveChildren(
    client: PoolClient,
    packageId: string,
    dto: CreatePackageDto,
    createdBy: string | null,
    isUpdate = false,
  ) {
    if (dto.hotels !== undefined) {
      await client.query(`DELETE FROM package_hotels WHERE package_id = $1`, [packageId]);
      for (const h of dto.hotels as HotelItemDto[]) {
        await client.query(
          `INSERT INTO package_hotels
            (package_id, option_label, hotel_name, star_category, location, checkin_date,
             checkout_date, rooms, meal_plan, room_category, room_occupancy, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            packageId,
            h.optionLabel ?? 'OPT 1',
            h.hotelName,
            h.starCategory ?? null,
            h.location ?? null,
            h.checkinDate ?? null,
            h.checkoutDate ?? null,
            h.rooms ?? 1,
            h.mealPlan ?? null,
            h.roomCategory ?? null,
            h.roomOccupancy ?? null,
            h.notes ?? null,
          ],
        );
      }
    }

    if (dto.flights !== undefined) {
      await client.query(`DELETE FROM package_flights WHERE package_id = $1`, [packageId]);
      for (const f of dto.flights as FlightItemDto[]) {
        await client.query(
          `INSERT INTO package_flights
            (package_id, flight_no, airline, class, from_city, from_datetime, to_city, to_datetime, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            packageId,
            f.flightNo ?? null,
            f.airline ?? null,
            f.class ?? 'Economy',
            f.fromCity ?? null,
            f.fromDatetime ?? null,
            f.toCity ?? null,
            f.toDatetime ?? null,
            f.notes ?? null,
          ],
        );
      }
    }

    if (dto.transfers !== undefined) {
      await client.query(`DELETE FROM package_transfers WHERE package_id = $1`, [packageId]);
      for (const t of dto.transfers as TransferItemDto[]) {
        await client.query(
          `INSERT INTO package_transfers
            (package_id, transfer_name, vehicle_type, from_location, to_location, transfer_datetime, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            packageId,
            t.transferName ?? null,
            t.vehicleType ?? 'Car',
            t.fromLocation ?? null,
            t.toLocation ?? null,
            t.transferDatetime ?? null,
            t.notes ?? null,
          ],
        );
      }
    }

    if (dto.itinerary !== undefined) {
      await client.query(`DELETE FROM itinerary_days WHERE package_id = $1`, [packageId]);
      for (const d of dto.itinerary as ItineraryDayItemDto[]) {
        const meals = {
          breakfast: !!d.meals?.breakfast,
          lunch: !!d.meals?.lunch,
          dinner: !!d.meals?.dinner,
        };
        const activities = (d.stops ?? []).map((s) => ({
          time: s.time ?? '',
          place_name: s.placeName ?? '',
          description: s.description ?? '',
          image_url: s.imageUrl ?? null,
        }));
        await client.query(
          `INSERT INTO itinerary_days
            (package_id, day_number, title, description, date, meals, activities)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            packageId,
            d.dayNumber,
            d.title ?? null,
            d.description ?? null,
            d.date ?? null,
            JSON.stringify(meals),
            JSON.stringify(activities),
          ],
        );
      }
    }
  }

  async softDelete(id: string) {
    const { rows } = await this.pool.query(
      `UPDATE tour_packages SET is_deleted = true WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] || null;
  }
}
