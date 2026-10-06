import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { VendorPaymentDto } from './dto/vendor-payment.dto';
import { AssignPtaDto } from './dto/assign-pta.dto';
import { CreateChecklistItemDto, ToggleChecklistItemDto } from './dto/checklist-item.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { BranchAccessService } from '../../common/guards/branch-access.service';
import { AuditService } from '../../common/audit/audit.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private bookingsService: BookingsService, private branchAccess: BranchAccessService, private audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BOOKINGS_VIEW)
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Req() req?: any,
  ) {
    const effectiveBranchId = req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId;
    return this.bookingsService.findAll({
      branchId: effectiveBranchId,
      status,
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.BOOKINGS_VIEW)
  stats(@Query('branchId') branchId?: string, @Req() req?: any) {
    return this.bookingsService.stats(req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BOOKINGS_VIEW)
  async findOne(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    return this.bookingsService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BOOKINGS_CREATE)
  create(@Body() dto: CreateBookingDto, @Req() req: any) {
    return this.bookingsService.create(dto, req.user?.userId ?? null);
  }

  @Post('from-quotation/:quotationId')
  @RequirePermissions(PERMISSIONS.BOOKINGS_CREATE)
  async createFromQuotation(@Param('quotationId') quotationId: string, @Body() dto: CreateBookingDto, @Req() req: any) {
    await this.branchAccess.assertAccess('quotations', quotationId, req.user);
    return this.bookingsService.create({ ...dto, quotationId }, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  async update(@Param('id') id: string, @Body() dto: UpdateBookingDto, @Req() req: any) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    return this.bookingsService.update(id, dto);
  }

  @Patch(':id/approve')
  @RequirePermissions(PERMISSIONS.FINANCE_APPROVE_REFUND)
  async approve(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    const result = await this.bookingsService.approve(id, req.user?.userId ?? null);
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'booking.approved', resourceType: 'booking', resourceId: id, result: 'success' });
    return result;
  }

  @Patch(':id/assign-pta')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  async assignPta(@Param('id') id: string, @Body() dto: AssignPtaDto, @Req() req: any) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    return this.bookingsService.assignPta(id, dto.userId);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  async updateStatus(@Param('id') id: string, @Body('status') status: string, @Req() req: any) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    return this.bookingsService.updateStatus(id, status);
  }

  @Post(':id/checklist')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  async addChecklistItem(@Param('id') id: string, @Body() dto: CreateChecklistItemDto, @Req() req: any) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    return this.bookingsService.addChecklistItem(id, dto.item);
  }

  @Post(':id/checklist/:itemId/toggle')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  async toggleChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ToggleChecklistItemDto,
    @Req() req: any,
  ) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    return this.bookingsService.toggleChecklistItem(id, itemId, dto.isDone ?? true, req.user?.userId ?? null);
  }

  @Post(':id/payments')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  async recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto, @Req() req: any) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    return this.bookingsService.recordPayment(
      id,
      dto.amount,
      dto.method ?? null,
      dto.reference ?? null,
      req.user?.branchId,
      req.user?.userId ?? null,
      dto.status,
    );
  }

  @Post(':id/vendor-payments')
  @RequirePermissions(PERMISSIONS.BOOKINGS_EDIT)
  async addVendorPayment(@Param('id') id: string, @Body() dto: VendorPaymentDto, @Req() req: any) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    return this.bookingsService.addVendorPayment(
      id,
      dto.vendorId,
      dto.amount,
      dto.notes ?? null,
      req.user?.branchId,
      req.user?.userId ?? null,
    );
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BOOKINGS_CANCEL)
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('bookings', id, req.user);
    const result = await this.bookingsService.remove(id);
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'booking.cancelled', resourceType: 'booking', resourceId: id, result: 'success' });
    return result;
  }
}
