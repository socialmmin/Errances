import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { RequireAccess } from '../../common/access/access.service';
import { BranchAccessService } from '../../common/guards/branch-access.service';
import { AuditService } from '../../common/audit/audit.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireAccess('invoices')
@Controller('finance')
export class FinanceController {
  constructor(private financeService: FinanceService, private branchAccess: BranchAccessService, private audit: AuditService) {}

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  findInvoices(@Query('branchId') branchId?: string, @Query('status') status?: string, @Query('type') type?: string, @Req() req?: any) {
    const effectiveBranchId = req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId;
    return this.financeService.findInvoices({ branchId: effectiveBranchId, status, type, visibleTo: req?.user?.roleName === 'super_admin' ? undefined : req?.user?.userId });
  }

  @Post('invoices')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  createInvoice(@Body() dto: CreateInvoiceDto, @Req() req: any) {
    return this.financeService.createInvoice(dto, req.user?.branchId, req.user?.userId ?? null);
  }

  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  async findInvoiceById(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('invoices', id, req.user);
    await this.financeService.assertInvoiceVisible(id, req.user);
    return this.financeService.findInvoiceById(id);
  }

  @Patch('invoices/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  async updateInvoice(@Param('id') id: string, @Body() dto: UpdateInvoiceDto, @Req() req: any) {
    await this.branchAccess.assertAccess('invoices', id, req.user);
    await this.financeService.assertInvoiceVisible(id, req.user);
    return this.financeService.updateInvoice(id, dto);
  }

  @Post('invoices/:id/payments')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  async recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto, @Req() req: any) {
    await this.branchAccess.assertAccess('invoices', id, req.user);
    await this.financeService.assertInvoiceVisible(id, req.user);
    return this.financeService.recordPayment(id, dto, req.user?.branchId, req.user?.userId ?? null);
  }

  // Record a payment straight from a quotation (creates its invoice if there isn't one yet).
  @Post('quotations/:quotationId/payments')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  recordQuotationPayment(@Param('quotationId') quotationId: string, @Body() dto: RecordPaymentDto, @Req() req: any) {
    return this.financeService.recordQuotationPayment(quotationId, dto, req.user?.branchId, req.user?.userId ?? null, req.user);
  }

  @Get('templates')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  templates() { return this.financeService.getTemplates(); }

  @Post('templates/:kind/submit')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  submitTemplate(@Param('kind') kind: string) { return this.financeService.submitTemplate(kind); }

  @Post('templates/:kind/sync')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  syncTemplate(@Param('kind') kind: string) { return this.financeService.syncTemplate(kind); }

  @Get('reminder-template')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  reminderTemplate() { return this.financeService.getReminderTemplate(); }

  @Post('reminder-template/submit')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  submitReminderTemplate() { return this.financeService.submitReminderTemplate(); }

  @Post('reminder-template/sync')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  syncReminderTemplate() { return this.financeService.syncReminderTemplate(); }

  @Post('invoices/:id/remind')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  async sendReminder(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('invoices', id, req.user);
    await this.financeService.assertInvoiceVisible(id, req.user);
    return this.financeService.sendPaymentReminder(id, req.user?.userId ?? null);
  }

  // Every invoice with a balance, with its reminder: the Payment Reminders page and its sidebar count.
  @Get('payment-reminders')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  paymentReminders(@Req() req: any) {
    return this.financeService.paymentReminderBoard(req?.user?.roleName === 'super_admin' ? undefined : req?.user?.userId);
  }

  @Get('invoices/:id/reminders')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  async reminders(@Param('id') id: string, @Req() req: any) {
    await this.financeService.assertInvoiceVisible(id, req.user);
    return this.financeService.listReminders(id);
  }

  @Post('invoices/:id/reminders')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  async scheduleReminder(@Param('id') id: string, @Body() body: { sendAt: string }, @Req() req: any) {
    await this.branchAccess.assertAccess('invoices', id, req.user);
    await this.financeService.assertInvoiceVisible(id, req.user);
    return this.financeService.scheduleReminder(id, body?.sendAt, req.user?.userId ?? null);
  }

  @Delete('reminders/:reminderId')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  cancelReminder(@Param('reminderId') reminderId: string) {
    return this.financeService.cancelReminder(reminderId);
  }

  // Cancel the booking and/or refund money against this invoice.
  @Post('invoices/:id/cancel-refund')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  async cancelRefund(@Param('id') id: string, @Body() body: { cancel?: boolean; reason?: string; refundAmount?: number; method?: string; reference?: string; policyNote?: string; deductionAmount?: number }, @Req() req: any) {
    await this.branchAccess.assertAccess('invoices', id, req.user);
    await this.financeService.assertInvoiceVisible(id, req.user);
    return this.financeService.cancelOrRefund(id, body ?? {}, req.user?.userId ?? null);
  }

  @Post('invoices/:id/reopen')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  async reopen(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('invoices', id, req.user);
    await this.financeService.assertInvoiceVisible(id, req.user);
    return this.financeService.reopenInvoice(id);
  }

  // Correct or remove a payment that was entered by mistake; the invoice's paid/balance follow.
  @Patch('payments/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  async updatePayment(@Param('id') id: string, @Body() body: { amount?: number; method?: string; reference?: string; paidAt?: string }, @Req() req: any) {
    const invoiceId = await this.financeService.paymentInvoiceId(id);
    if (invoiceId) await this.financeService.assertInvoiceVisible(invoiceId, req.user);
    return this.financeService.updatePayment(id, body ?? {});
  }

  @Delete('payments/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  async removePayment(@Param('id') id: string, @Req() req: any) {
    const invoiceId = await this.financeService.paymentInvoiceId(id);
    if (invoiceId) await this.financeService.assertInvoiceVisible(invoiceId, req.user);
    return this.financeService.removePayment(id);
  }

  @Delete('invoices/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  async removeInvoice(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('invoices', id, req.user);
    await this.financeService.assertInvoiceVisible(id, req.user);
    const result = await this.financeService.removeInvoice(id);
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'invoice.deleted', resourceType: 'invoice', resourceId: id, result: 'success' });
    return result;
  }

  @Get('kpis')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  kpis(@Query('branchId') branchId?: string, @Req() req?: any) {
    return this.financeService.kpis(req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId);
  }

  @Get('payments')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  findPayments(@Query('branchId') branchId?: string, @Query('status') status?: string, @Req() req?: any) {
    const effectiveBranchId = req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId;
    return this.financeService.findPayments({ branchId: effectiveBranchId, status });
  }

  @Get('installments/overdue')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  overdueInstallments(@Query('branchId') branchId?: string, @Req() req?: any) {
    return this.financeService.findOverdueInstallments(req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId);
  }

  @Get('pta-collections/today')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  todayPtaCollections(@Query('branchId') branchId?: string, @Req() req?: any) {
    return this.financeService.findTodayPtaCollections(req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId);
  }

  @Patch('payments/:id/verify')
  @RequirePermissions(PERMISSIONS.FINANCE_APPROVE_REFUND)
  async verifyPayment(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('payments', id, req.user);
    const result = await this.financeService.verifyPayment(id, req.user?.userId ?? null);
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'payment.verified', resourceType: 'payment', resourceId: id, result: 'success' });
    return result;
  }

  @Patch('payments/:id/reject')
  @RequirePermissions(PERMISSIONS.FINANCE_APPROVE_REFUND)
  async rejectPayment(@Param('id') id: string, @Body() dto: RejectPaymentDto, @Req() req: any) {
    await this.branchAccess.assertAccess('payments', id, req.user);
    const result = await this.financeService.rejectPayment(id, req.user?.userId ?? null, dto.reason ?? null);
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'payment.rejected', resourceType: 'payment', resourceId: id, result: 'success', detail: { reason: dto.reason } });
    return result;
  }
}
