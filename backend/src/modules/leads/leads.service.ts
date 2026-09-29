import { Injectable, NotFoundException } from '@nestjs/common';
import { LeadAccess, LeadsRepository } from './leads.repository';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import * as ExcelJS from 'exceljs';

@Injectable()
export class LeadsService {
  constructor(private repo: LeadsRepository) {}

  findAll(params: {
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
    page?: number;
    pageSize?: number;
    sortBy?: 'lead_date' | 'activity';
    ids?: string[];
  }, access?: LeadAccess) {
    return this.repo.findAll({
      branchId: params.branchId,
      status: params.status,
      search: params.search,
      campaignName: params.campaignName,
      noPhone: params.noPhone,
      itineraryStatus: params.itineraryStatus,
      source: params.source,
      assignedTo: params.assignedTo,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      page: params.page ?? 1,
      pageSize: params.ids?.length ? params.ids.length : (params.pageSize ?? 20),
      sortBy: params.sortBy,
      ids: params.ids,
      access,
    });
  }

  findDistinctCampaigns(access?: LeadAccess) {
    return this.repo.findDistinctCampaigns(access);
  }

  campaignSummary(campaignName: string, access?: LeadAccess) {
    return this.repo.campaignSummary(campaignName, access);
  }

  getStats(access?: LeadAccess) {
    return this.repo.getStats(access);
  }

  async exportCampaigns(campaigns: string[], dateFrom?: string, dateTo?: string, access?: LeadAccess) {
    const rows = await this.repo.findExportRows(campaigns, dateFrom, dateTo, access);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Errances Voyages CRM';
    workbook.created = new Date();

    const addSheet = (name: string, sheetRows: any[]) => {
      const used = new Set(workbook.worksheets.map((sheet) => sheet.name));
      const base = (name || 'Campaign').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Campaign';
      let safeName = base;
      let suffix = 2;
      while (used.has(safeName)) safeName = `${base.slice(0, 27)} ${suffix++}`;
      const sheet = workbook.addWorksheet(safeName);
      const contactFields = new Set(['phone', 'phone_number', 'mobile', 'mobile_number', 'whatsapp', 'whatsapp_number', 'full_name', 'name', 'email']);
      const questions = Array.from(new Set(sheetRows.flatMap((row) => Object.keys(row.answers || {}))))
        .filter((question) => !contactFields.has(question.toLowerCase()));
      sheet.columns = [
        { header: 'Lead Date & Time', key: 'submitted_at', width: 22 },
        { header: 'Meta Lead ID', key: 'meta_leadgen_id', width: 24 },
        { header: 'Campaign', key: 'campaign_name', width: 38 },
        { header: 'Ad', key: 'ad_name', width: 28 },
        { header: 'Instant Form', key: 'form_name', width: 32 },
        { header: 'Lead #', key: 'lead_number', width: 20 },
        { header: 'Name', key: 'customer_name', width: 24 },
        { header: 'Mobile Number', key: 'phone', width: 18 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Destination', key: 'destination', width: 20 },
        { header: 'Source', key: 'source', width: 14 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Priority', key: 'priority', width: 12 },
        { header: 'Assigned To', key: 'assigned_to_name', width: 22 },
        ...questions.map((question) => ({
          header: question.replace(/_/g, ' ').replace(/\s+/g, ' ').trim(),
          key: `answer:${question}`,
          width: 32,
        })),
      ];
      for (const row of sheetRows) {
        const output: Record<string, unknown> = {
          ...row,
          submitted_at: row.submitted_at ? new Date(row.submitted_at) : null,
          phone: row.phone || row.whatsapp_number || 'Not provided by Meta',
        };
        for (const question of questions) output[`answer:${question}`] = row.answers?.[question] ?? '';
        sheet.addRow(output);
      }
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columnCount).letter}1` };
      sheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      });
      sheet.getColumn('submitted_at').numFmt = 'dd-mm-yyyy hh:mm';
    };

    addSheet('Overall Leads', rows);
    for (const campaign of campaigns) addSheet(campaign, rows.filter((row) => row.campaign_name === campaign));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async importWorkbook(buffer: Buffer, userId: string | null) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const overall = workbook.worksheets.find((sheet) => sheet.name.toLowerCase() === 'overall leads');
    const sheets = overall ? [overall] : workbook.worksheets;
    const branchId = await this.repo.getDefaultBranchId();
    if (!branchId) throw new Error('No active branch is configured');
    let profilesCreated = 0;
    let enquiriesAdded = 0;
    let skipped = 0;
    const standard = new Set(['lead date & time', 'meta lead id', 'campaign', 'ad', 'instant form', 'lead #', 'name', 'mobile number', 'email', 'destination', 'source', 'status', 'priority', 'assigned to']);

    for (const sheet of sheets) {
      const headers: string[] = [];
      sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { headers[column] = String(cell.value ?? '').trim(); });
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const sourceRow = sheet.getRow(rowNumber);
        const data: Record<string, any> = {};
        headers.forEach((header, column) => { if (header) data[header.toLowerCase()] = sourceRow.getCell(column).value; });
        const phone = String(data['mobile number'] ?? '').trim();
        if (!phone) { skipped++; continue; }
        const submittedValue = data['lead date & time'];
        const submittedAt = submittedValue instanceof Date ? submittedValue : new Date(String(submittedValue || Date.now()));
        const answers: Record<string, string> = {};
        for (const [header, value] of Object.entries(data)) if (!standard.has(header) && value != null) answers[header] = String(value);
        let lead = await this.repo.findByContactNumber(phone);
        if (!lead) {
          lead = await this.repo.create({
            customerName: String(data.name || 'Imported Lead'), phone,
            email: data.email ? String(data.email) : undefined,
            destination: data.destination ? String(data.destination) : undefined,
            campaignName: data.campaign ? String(data.campaign) : undefined,
            source: 'meta_ads', status: 'new', priority: 'hot', branchId,
          }, userId);
          profilesCreated++;
        }
        enquiriesAdded += await this.repo.importRequirement(lead.id, {
          submittedAt: Number.isNaN(submittedAt.getTime()) ? new Date() : submittedAt,
          metaLeadId: data['meta lead id'] ? String(data['meta lead id']) : undefined,
          campaignName: data.campaign ? String(data.campaign) : sheet.name,
          adName: data.ad ? String(data.ad) : undefined,
          formName: data['instant form'] ? String(data['instant form']) : undefined,
          destination: data.destination ? String(data.destination) : undefined,
          answers,
        });
      }
    }
    return { profilesCreated, enquiriesAdded, skipped };
  }

  async bulkAssign(leadIds: string[], assignedTo: string) {
    if (!leadIds?.length) return { updated: 0 };
    const updated = await this.repo.bulkAssign(leadIds, assignedTo);
    return { updated };
  }

  async findOne(id: string, access?: LeadAccess) {
    const lead = await this.repo.findOne(id, access);
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  create(dto: CreateLeadDto, userId: string | null) {
    return this.repo.create(dto, userId);
  }

  findByWhatsAppNumber(number: string) {
    return this.repo.findByWhatsAppNumber(number);
  }

  setCollaborators(id: string, userIds: string[], userId: string | null) {
    return this.repo.setCollaborators(id, Array.from(new Set(userIds || [])), userId);
  }

  findByContactNumber(number: string) {
    return this.repo.findByContactNumber(number);
  }

  async addRequirement(id: string, dto: CreateRequirementDto, access?: LeadAccess) {
    await this.findOne(id, access);
    return this.repo.addRequirement(id, dto);
  }

  async update(id: string, dto: UpdateLeadDto, access?: LeadAccess) {
    await this.findOne(id, access);
    const updated = await this.repo.update(id, dto);
    if (!updated) throw new NotFoundException('Lead not found');
    return updated;
  }

  async remove(id: string, access?: LeadAccess) {
    await this.findOne(id, access);
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new NotFoundException('Lead not found');
    return { success: true };
  }
}
