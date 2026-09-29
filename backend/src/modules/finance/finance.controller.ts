import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  findInvoices(@Query('branchId') branchId?: string, @Query('status') status?: string, @Query('type') type?: string) {
    return this.financeService.findInvoices({ branchId, status, type });
  }

  @Post('invoices')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  createInvoice(@Body() dto: CreateInvoiceDto, @Req() req: any) {
    return this.financeService.createInvoice(dto, req.user?.branchId, req.user?.userId ?? null);
  }

  @Patch('invoices/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  updateInvoice(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return this.financeService.updateInvoice(id, dto);
  }

  @Delete('invoices/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_COLLECT_PAYMENT)
  removeInvoice(@Param('id') id: string) {
    return this.financeService.removeInvoice(id);
  }

  @Get('kpis')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  kpis(@Query('branchId') branchId?: string) {
    return this.financeService.kpis(branchId);
  }

  @Get('payments')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  findPayments(@Query('branchId') branchId?: string, @Query('status') status?: string) {
    return this.financeService.findPayments({ branchId, status });
  }

  @Get('installments/overdue')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  overdueInstallments(@Query('branchId') branchId?: string) {
    return this.financeService.findOverdueInstallments(branchId);
  }

  @Get('pta-collections/today')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  todayPtaCollections(@Query('branchId') branchId?: string) {
    return this.financeService.findTodayPtaCollections(branchId);
  }

  @Patch('payments/:id/verify')
  @RequirePermissions(PERMISSIONS.FINANCE_APPROVE_REFUND)
  verifyPayment(@Param('id') id: string, @Req() req: any) {
    return this.financeService.verifyPayment(id, req.user?.userId ?? null);
  }

  @Patch('payments/:id/reject')
  @RequirePermissions(PERMISSIONS.FINANCE_APPROVE_REFUND)
  rejectPayment(@Param('id') id: string, @Body() dto: RejectPaymentDto, @Req() req: any) {
    return this.financeService.rejectPayment(id, req.user?.userId ?? null, dto.reason ?? null);
  }
}
